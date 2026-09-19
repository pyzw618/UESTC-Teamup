import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ApplicationStatus,
  NotificationKind,
  Prisma,
  RoleType,
  SlotStatus,
  TeamGoal,
  TeamStatus,
  type Team,
  type TeamMember,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { UserSerializer, type SerializableUser } from '../../common/auth/viewer.context';
import { NotificationService } from '../notification/notification.service';

export interface CreateTeamInput {
  competitionId?: string;
  /** 手动填写竞赛名（找不到对应竞赛时自动建档） */
  competitionName?: string;
  goal: TeamGoal;
  requirement?: string;
  contact?: string;
  deadline?: Date;
  /** 招募名额，允许同一 role 出现多次（例如 算法 ×2、论文 ×1） */
  slots: { role: RoleType; note?: string }[];
  /** 仅允许录入平台外成员（不允许传 userId 直接把平台用户拉进队伍） */
  members?: {
    displayName?: string;
    role?: RoleType;
    rank?: string;
    grade?: number;
    college?: string;
    note?: string;
  }[];
}

export type TeamTransitionAction = 'PAUSE' | 'RESUME' | 'COMPETE' | 'ADJUST' | 'DISBAND';

const DAILY_POST_LIMIT = 5;
const REAPPLY_COOLDOWN_HOURS = 24;
const MAX_SLOTS = 20;

/** 状态转换表：集中定义，避免散落到 controller */
const TRANSITIONS: Record<TeamTransitionAction, { from: TeamStatus[]; to: TeamStatus }> = {
  PAUSE: { from: [TeamStatus.RECRUITING], to: TeamStatus.PAUSED },
  RESUME: { from: [TeamStatus.PAUSED], to: TeamStatus.RECRUITING },
  COMPETE: { from: [TeamStatus.RECRUITING, TeamStatus.PAUSED, TeamStatus.FULL], to: TeamStatus.COMPETING },
  // 重新调整阵容：回到 PAUSED，之后由队长决定是否恢复 RECRUITING
  ADJUST: { from: [TeamStatus.COMPETING], to: TeamStatus.PAUSED },
  DISBAND: {
    from: [TeamStatus.RECRUITING, TeamStatus.PAUSED, TeamStatus.FULL, TeamStatus.COMPETING],
    to: TeamStatus.DISBANDED,
  },
};

/** 允许完成“已存在的加入请求”的状态：RECRUITING 正常，PAUSED 可继续处理已有候选人 */
const JOINABLE_STATUSES: TeamStatus[] = [TeamStatus.RECRUITING, TeamStatus.PAUSED];

/** 禁止任何成员/结构变更的状态 */
const TERMINAL_STATUSES: TeamStatus[] = [TeamStatus.DISBANDED, TeamStatus.ARCHIVED];

/**
 * 用户安全字段投影：供 Application / Invitation / Team 相关接口使用，
 * 绝不直接返回 Prisma User 对象（会泄漏 passwordHash / email 等）。
 * studentNo 交由 UserSerializer 按“半匿名规则”决定是否输出。
 */
const SAFE_USER_SELECT = {
  id: true,
  nickname: true,
  college: true,
  grade: true,
  major: true,
  bio: true,
  studentNo: true,
  skills: { select: { skill: true, level: true } },
  memberships: { where: { active: true }, select: { teamId: true } },
} satisfies Prisma.UserSelect;

type SafeUser = Prisma.UserGetPayload<{ select: typeof SAFE_USER_SELECT }>;

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
    private readonly serializer: UserSerializer,
  ) {}

  // ==================================================================
  // 查询
  // ==================================================================

  async list(q: {
    competitionId?: string;
    roles?: RoleType[];
    goal?: TeamGoal;
    statuses?: TeamStatus[];
    grade?: number;
    sort?: 'DEADLINE' | 'LATEST';
    page: number;
    pageSize: number;
  }) {
    const now = new Date();
    // 默认只展示 RECRUITING。DISBANDED / ARCHIVED 永不出现在公共发现列表。
    const allowed: TeamStatus[] = [TeamStatus.RECRUITING, TeamStatus.PAUSED, TeamStatus.FULL, TeamStatus.COMPETING];
    const statuses = q.statuses?.length
      ? q.statuses.filter((s) => allowed.includes(s))
      : [TeamStatus.RECRUITING];

    const where: Prisma.TeamWhereInput = {
      status: { in: statuses.length ? statuses : [TeamStatus.RECRUITING] },
      competition: { status: 'PUBLISHED' },
      ...(q.competitionId ? { competitionId: q.competitionId } : {}),
      ...(q.goal ? { goal: q.goal } : {}),
      // 缺口角色：存在 status=OPEN 且角色命中的 slot
      ...(q.roles?.length ? { slots: { some: { role: { in: q.roles }, status: SlotStatus.OPEN } } } : {}),
      ...(q.grade ? { leader: { grade: q.grade } } : {}),
    };

    const orderBy: Prisma.TeamOrderByWithRelationInput =
      q.sort === 'DEADLINE' ? { deadline: 'asc' } : { createdAt: 'desc' };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        where,
        orderBy: [orderBy],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          competition: { select: { id: true, name: true } },
          leader: { select: SAFE_USER_SELECT },
          slots: { select: { id: true, role: true, status: true, note: true } },
          members: { where: { active: true }, select: { id: true, userId: true } },
          _count: { select: { applications: { where: { status: ApplicationStatus.PENDING } } } },
        },
      }),
      this.prisma.team.count({ where }),
    ]);

    return {
      items: rows.map((t) => {
        const derived = this.derive(t.members, t.slots);
        return {
          id: t.id,
          goal: t.goal,
          status: t.status,
          deadline: t.deadline,
          expired: t.deadline != null && t.deadline < now,
          competition: t.competition,
          leader: this.serialize(t.leader),
          slots: t.slots,
          ...derived,
          pendingCount: t._count.applications,
          createdAt: t.createdAt,
        };
      }),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async detail(id: string, viewerId?: string, viewerRole?: string) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        competition: { include: { levels: true } },
        leader: { select: SAFE_USER_SELECT },
        slots: { select: { id: true, role: true, status: true, note: true }, orderBy: { createdAt: 'asc' } },
        members: {
          where: { active: true },
          include: { user: { select: SAFE_USER_SELECT } },
          orderBy: { joinedAt: 'asc' },
        },
        applications: {
          where: { status: ApplicationStatus.PENDING },
          include: { user: { select: SAFE_USER_SELECT } },
          orderBy: { createdAt: 'desc' },
        },
        invitations: {
          where: { status: ApplicationStatus.PENDING },
          include: { user: { select: SAFE_USER_SELECT } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!team) throw new NotFoundException('队伍不存在');

    const isMember = viewerId != null && team.members.some((m) => m.userId === viewerId);
    const isLeader = viewerId != null && team.leaderId === viewerId;
    const derived = this.derive(team.members, team.slots);

    return {
      id: team.id,
      goal: team.goal,
      status: team.status,
      requirement: team.requirement,
      // Q8：团队联系方式仅同队/队长/管理员可见
      contact: isMember || isLeader || viewerRole === 'ADMIN' ? team.contact : null,
      contactVisible: isMember || isLeader || viewerRole === 'ADMIN',
      deadline: team.deadline,
      ...derived,
      archivedAt: team.archivedAt,
      createdAt: team.createdAt,
      competition: {
        id: team.competition.id,
        name: team.competition.name,
        levels: team.competition.levels.map((l) => l.level),
        officialUrl: team.competition.officialUrl,
      },
      leader: this.serialize(team.leader),
      slots: team.slots,
      members: team.members.map((m) => ({
        id: m.id,
        role: m.role,
        rank: m.rank,
        grade: m.grade,
        college: m.college,
        note: m.note,
        displayName: m.displayName,
        userId: m.userId,
        isLeader: m.userId != null && m.userId === team.leaderId,
        user: m.user ? this.serialize(m.user) : null,
      })),
      applications: isLeader
        ? team.applications.map((a) => ({
            id: a.id,
            desiredRole: a.desiredRole,
            pitch: a.pitch,
            status: a.status,
            createdAt: a.createdAt,
            user: this.serialize(a.user),
          }))
        : undefined,
      invitations: isLeader
        ? team.invitations.map((i) => ({
            id: i.id,
            role: i.role,
            message: i.message,
            status: i.status,
            createdAt: i.createdAt,
            user: this.serialize(i.user),
          }))
        : undefined,
      viewer: { isLeader, isMember },
    };
  }

  // ==================================================================
  // 发布
  // ==================================================================

  async create(leaderId: string, input: CreateTeamInput) {
    // 选择竞赛或手动填写竞赛名（二选一）；手动填写时按名称自动建档
    let competitionId = input.competitionId;
    if (!competitionId && input.competitionName?.trim()) {
      const name = input.competitionName.trim().slice(0, 120);
      const existing = await this.prisma.competition.findFirst({ where: { name } });
      if (existing) {
        competitionId = existing.id;
      } else {
        const created = await this.prisma.competition.create({
          data: { name, sourceUrl: '用户手动填写', status: 'PUBLISHED' },
        });
        competitionId = created.id;
      }
    }
    if (!competitionId) throw new BadRequestException('请选择竞赛或手动填写竞赛名称');

    const competition = await this.prisma.competition.findUnique({ where: { id: competitionId } });
    if (!competition || competition.status === 'ARCHIVED') throw new NotFoundException('竞赛不存在或已下线');

    // 防刷（MODULE_MATCH §6）
    const activeCount = await this.prisma.team.count({
      where: { leaderId, status: { in: [TeamStatus.RECRUITING, TeamStatus.PAUSED, TeamStatus.FULL] } },
    });
    if (activeCount >= DAILY_POST_LIMIT) throw new BadRequestException('你已有 5 支招募中的队伍，请先处理现有队伍');

    const dup = await this.prisma.team.findFirst({
      where: { leaderId, competitionId, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    });
    if (dup) throw new BadRequestException('你在 24 小时内已为该竞赛发布过组队，请勿重复发帖');

    // 不允许队长通过传 userId 直接拉人入队
    if ((input.members ?? []).some((m) => (m as { userId?: string }).userId)) {
      throw new BadRequestException('不能直接通过 userId 添加平台注册用户，请使用申请或邀请流程');
    }

    // 同竞赛一人一队（数据库部分唯一索引兜底）
    const alreadyIn = await this.prisma.teamMember.findFirst({
      where: { userId: leaderId, competitionId, active: true },
    });
    if (alreadyIn) throw new BadRequestException('你在该竞赛下已属于另一支有效队伍');

    // 招募截止默认填竞赛报名截止时间
    let deadline = input.deadline ?? null;
    if (!deadline) {
      const signup = await this.prisma.competitionTimeline.findFirst({
        where: { competitionId, stage: { contains: '报名' }, endAt: { gt: new Date() } },
        orderBy: { endAt: 'asc' },
      });
      deadline = signup?.endAt ?? null;
    }

    const slots = (input.slots ?? []).slice(0, MAX_SLOTS);
    if (slots.length === 0) throw new BadRequestException('请至少添加一个招募名额');

    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: {
          competitionId: competitionId!,
          leaderId,
          goal: input.goal,
          requirement: input.requirement ?? null,
          contact: input.contact ?? null,
          deadline,
          slots: { create: slots.map((s) => ({ role: s.role, note: s.note ?? null })) },
        },
      });

      // 队长必占一行注册成员（leader 必须是本 Team 的注册 TeamMember）
      await tx.teamMember.create({
        data: {
          teamId: team.id,
          userId: leaderId,
          competitionId: competitionId!,
          note: '队长',
          role: null,
        },
      });

      // 平台外成员（userId 恒为 null）
      const externals = input.members ?? [];
      if (externals.length) {
        await tx.teamMember.createMany({
          data: externals.slice(0, 20).map((m) => ({
            teamId: team.id,
            userId: null,
            competitionId: competitionId!,
            displayName: m.displayName ?? null,
            role: m.role ?? null,
            rank: m.rank ?? null,
            grade: m.grade ?? null,
            college: m.college ?? null,
            note: m.note ?? null,
          })),
        });
      }

      return tx.team.findUnique({
        where: { id: team.id },
        include: { slots: true, members: { where: { active: true } } },
      });
    });
  }

  // ==================================================================
  // 状态机（队长操作）
  // ==================================================================

  async transition(actorId: string, teamId: string, action: TeamTransitionAction) {
    const rule = TRANSITIONS[action];
    if (!rule) throw new BadRequestException('不支持的状态转换');

    return this.prisma.$transaction(async (tx) => {
      await this.lockTeam(tx, teamId);
      const team = await tx.team.findUnique({ where: { id: teamId } });
      if (!team) throw new NotFoundException('队伍不存在');
      if (team.leaderId !== actorId) throw new ForbiddenException('只有队长可以操作');
      if (!rule.from.includes(team.status)) {
        throw new BadRequestException(`当前状态「${team.status}」不能执行 ${action}`);
      }

      // 没有空缺名额就没有“恢复招募”的意义
      if (action === 'RESUME') {
        const open = await tx.teamSlot.count({ where: { teamId, status: SlotStatus.OPEN } });
        if (open === 0) throw new BadRequestException('当前没有 OPEN 招募名额，请先新增名额');
      }

      const updated = await tx.team.update({ where: { id: teamId }, data: { status: rule.to } });

      // 解散：所有未兑现的申请/邀请全部失效；成员关系软删除（保留历史行）
      if (action === 'DISBAND') {
        await tx.application.updateMany({
          where: { teamId, status: ApplicationStatus.PENDING },
          data: { status: ApplicationStatus.EXPIRED },
        });
        await tx.invitation.updateMany({
          where: { teamId, status: ApplicationStatus.PENDING },
          data: { status: ApplicationStatus.EXPIRED },
        });
        await this.deactivateAllMembers(tx, teamId);
      }

      return updated;
    });
  }

  // ==================================================================
  // 申请流
  // ==================================================================

  async apply(userId: string, teamId: string, desiredRole: RoleType, pitch: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('队伍不存在');
    if (team.leaderId === userId) throw new BadRequestException('这是你自己的队伍');
    if (team.status !== TeamStatus.RECRUITING) throw new BadRequestException('该队伍当前不在招募中');
    if (team.deadline && team.deadline < new Date()) throw new BadRequestException('该队伍招募已截止');

    const alreadyMember = await this.prisma.teamMember.findFirst({
      where: { userId, competitionId: team.competitionId, active: true },
    });
    if (alreadyMember) throw new BadRequestException('你已加入本竞赛的一支队伍');

    const openSlot = await this.prisma.teamSlot.findFirst({
      where: { teamId, role: desiredRole, status: SlotStatus.OPEN },
    });
    if (!openSlot) throw new BadRequestException('该方向已无名额');

    const existing = await this.prisma.application.findFirst({
      where: { teamId, userId, status: ApplicationStatus.PENDING },
    });
    if (existing) throw new BadRequestException('你已提交过申请，请等待队长处理');

    const rejected = await this.prisma.application.findFirst({
      where: {
        teamId,
        userId,
        status: ApplicationStatus.REJECTED,
        createdAt: { gte: new Date(Date.now() - REAPPLY_COOLDOWN_HOURS * 3600_000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (rejected) throw new BadRequestException('申请刚被婉拒，请过一天再试');

    let application;
    try {
      application = await this.prisma.application.create({
        data: { teamId, userId, desiredRole, pitch },
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) throw new BadRequestException('你已提交过申请，请等待队长处理');
      throw e;
    }

    await this.notify.notify(team.leaderId, NotificationKind.APPLICATION_NEW, {
      teamId,
      applicationId: application.id,
      applicantId: userId,
      desiredRole,
    });
    return application;
  }

  /** 审批申请。接受时进入统一的 joinTeam 事务（与邀请接受共用同一不变量）。 */
  async reviewApplication(leaderId: string, applicationId: string, accept: boolean, reason?: string) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { team: true },
    });
    if (!application) throw new NotFoundException('申请不存在');
    if (application.team.leaderId !== leaderId) throw new ForbiddenException('只有队长可以审批');
    if (application.status !== ApplicationStatus.PENDING) throw new BadRequestException('该申请已处理过');

    if (!accept) {
      await this.prisma.application.update({
        where: { id: applicationId },
        data: { status: ApplicationStatus.REJECTED, reason: reason ?? null },
      });
      await this.notify.notify(application.userId, NotificationKind.APPLICATION_RESULT, {
        teamId: application.teamId,
        applicationId,
        accepted: false,
        reason: reason ?? null,
      });
      return { accepted: false };
    }

    const result = await this.joinTeam(application.teamId, { kind: 'APPLICATION', id: applicationId });

    await this.notify.notify(application.userId, NotificationKind.APPLICATION_RESULT, {
      teamId: application.teamId,
      applicationId,
      accepted: true,
      role: application.desiredRole,
    });
    return { accepted: true, teamStatus: result.teamStatus };
  }

  /** 申请人撤回 */
  async withdraw(userId: string, applicationId: string) {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!application || application.userId !== userId) throw new NotFoundException('申请不存在');
    if (application.status !== ApplicationStatus.PENDING) throw new BadRequestException('该申请已处理过');
    await this.prisma.application.update({
      where: { id: applicationId },
      data: { status: ApplicationStatus.WITHDRAWN },
    });
    return { withdrawn: true };
  }

  // ==================================================================
  // 邀请流
  // ==================================================================

  async invite(leaderId: string, teamId: string, inviteeId: string, role: RoleType, message?: string) {
    const team = await this.mustOwn(leaderId, teamId);
    if (team.status !== TeamStatus.RECRUITING) throw new BadRequestException('只有招募中才能发出新邀请');
    if (team.leaderId === inviteeId) throw new BadRequestException('不能邀请自己');

    const invitee = await this.prisma.user.findUnique({ where: { id: inviteeId } });
    if (!invitee) throw new NotFoundException('用户不存在');

    const alreadyMember = await this.prisma.teamMember.findFirst({
      where: { userId: inviteeId, competitionId: team.competitionId, active: true },
    });
    if (alreadyMember) throw new BadRequestException('该用户已加入本竞赛的一支队伍');

    const openSlot = await this.prisma.teamSlot.findFirst({
      where: { teamId, role, status: SlotStatus.OPEN },
    });
    if (!openSlot) throw new BadRequestException('该方向已无名额');

    const pending = await this.prisma.invitation.findFirst({
      where: { teamId, userId: inviteeId, status: ApplicationStatus.PENDING },
    });
    if (pending) throw new BadRequestException('已发出过邀请，等待对方处理');

    let invitation;
    try {
      invitation = await this.prisma.invitation.create({
        data: { teamId, userId: inviteeId, role, message: message ?? null },
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) throw new BadRequestException('已发出过邀请，等待对方处理');
      throw e;
    }

    await this.notify.notify(inviteeId, NotificationKind.INVITATION_NEW, {
      teamId,
      invitationId: invitation.id,
      role,
    });
    return invitation;
  }

  /** 被邀请人回应。接受时进入统一的 joinTeam 事务。 */
  async respondInvitation(userId: string, invitationId: string, accept: boolean) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
      include: { team: true },
    });
    if (!invitation || invitation.userId !== userId) throw new NotFoundException('邀请不存在');
    if (invitation.status !== ApplicationStatus.PENDING) throw new BadRequestException('该邀请已处理过');

    if (!accept) {
      await this.prisma.invitation.update({
        where: { id: invitationId },
        data: { status: ApplicationStatus.REJECTED },
      });
      await this.notify.notify(invitation.team.leaderId, NotificationKind.APPLICATION_RESULT, {
        teamId: invitation.teamId,
        invitationId,
        accepted: false,
        kind: 'invitation',
      });
      return { accepted: false };
    }

    const result = await this.joinTeam(invitation.teamId, { kind: 'INVITATION', id: invitationId });

    await this.notify.notify(invitation.team.leaderId, NotificationKind.APPLICATION_RESULT, {
      teamId: invitation.teamId,
      invitationId,
      accepted: true,
      kind: 'invitation',
      role: invitation.role,
    });
    void result;
    return { accepted: true };
  }

  // ==================================================================
  // 统一加入流程（Application 接受 / Invitation 接受 共用）
  // ==================================================================

  /**
   * joinTeam：唯一允许“把平台注册用户变成 TeamMember”的入口。
   *
   * 并发安全说明：
   * - 第一句即对 Team 行 `SELECT ... FOR UPDATE`，同一队伍的成员/状态变更被串行化，
   *   因此“两个 ACCEPT 争抢最后一个 slot”不可能同时通过。
   * - 占用 slot 使用 compare-and-swap（`updateMany where status=OPEN` 并检查 affected rows），
   *   即使将来去掉行锁也不会出现两人同时读到同一个 OPEN slot 后都写成功。
   * - “同竞赛一人一队”由 TeamMember 上的部分唯一索引在数据库层兜底（两个 Team 并发接受同一用户）。
   */
  private async joinTeam(
    teamId: string,
    request: { kind: 'APPLICATION' | 'INVITATION'; id: string },
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. 锁定队伍行，串行化同一队伍的所有变更
        await this.lockTeam(tx, teamId);

        // 2. 锁内重新读取加入请求，确保它仍然 PENDING（防两个并发 ACCEPT 都通过外层检查）
        let userId: string;
        let role: RoleType;
        if (request.kind === 'APPLICATION') {
          const fresh = await tx.application.findUnique({ where: { id: request.id } });
          if (!fresh || fresh.teamId !== teamId) throw new NotFoundException('申请不存在');
          if (fresh.status !== ApplicationStatus.PENDING) throw new BadRequestException('该申请已处理过');
          userId = fresh.userId;
          role = fresh.desiredRole;
        } else {
          const fresh = await tx.invitation.findUnique({ where: { id: request.id } });
          if (!fresh || fresh.teamId !== teamId) throw new NotFoundException('邀请不存在');
          if (fresh.status !== ApplicationStatus.PENDING) throw new BadRequestException('该邀请已处理过');
          userId = fresh.userId;
          role = fresh.role;
        }

        // 3. 队伍状态与截止时间
        const team = await tx.team.findUnique({ where: { id: teamId } });
        if (!team) throw new NotFoundException('队伍不存在');
        if (!JOINABLE_STATUSES.includes(team.status)) {
          // FULL / COMPETING / DISBANDED / ARCHIVED 都不能再通过旧请求加入
          throw new BadRequestException('队伍当前状态不接受新成员');
        }
        if (team.deadline && team.deadline < new Date()) throw new BadRequestException('该队伍招募已截止');

        // 4. 用户当前还不是本队有效成员
        const existingMember = await tx.teamMember.findFirst({
          where: { teamId, userId, active: true },
        });
        if (existingMember) throw new BadRequestException('该用户已经是队伍成员');

        // 5. 用户没有加入同竞赛下的其他有效队伍
        const otherMembership = await tx.teamMember.findFirst({
          where: { userId, competitionId: team.competitionId, active: true, teamId: { not: teamId } },
        });
        if (otherMembership) throw new BadRequestException('该用户已加入本竞赛的另一支队伍');

        // 6. 原子占用一个 role 匹配的 OPEN slot
        const slot = await this.claimSlot(tx, teamId, role);
        if (!slot) throw new BadRequestException('该方向已无名额');

        // 7. 创建 / 复用成员行（若此前退出过则重新激活）
        const membership = await tx.teamMember.upsert({
          where: { teamId_userId: { teamId, userId } },
          create: {
            teamId,
            userId,
            competitionId: team.competitionId,
            role,
            active: true,
            joinedAt: new Date(),
          },
          update: { active: true, leftAt: null, role, joinedAt: new Date() },
        });

        // 8. 回填 slot 占据者
        await tx.teamSlot.update({
          where: { id: slot.id },
          data: { filledByMemberId: membership.id, filledAt: new Date() },
        });

        // 9. 请求置为 ACCEPTED
        if (request.kind === 'APPLICATION') {
          await tx.application.update({ where: { id: request.id }, data: { status: ApplicationStatus.ACCEPTED } });
        } else {
          await tx.invitation.update({ where: { id: request.id }, data: { status: ApplicationStatus.ACCEPTED } });
        }

        // 10. 同竞赛下该用户的其他 pending 申请 / 邀请自动失效
        await tx.application.updateMany({
          where: { userId, status: ApplicationStatus.PENDING, team: { competitionId: team.competitionId } },
          data: { status: ApplicationStatus.EXPIRED },
        });
        await tx.invitation.updateMany({
          where: { userId, status: ApplicationStatus.PENDING, team: { competitionId: team.competitionId } },
          data: { status: ApplicationStatus.EXPIRED },
        });

        // 11. 填满最后一个名额 -> FULL，并让本队其他无法兑现的请求失效
        const openCount = await tx.teamSlot.count({ where: { teamId, status: SlotStatus.OPEN } });
        const totalSlots = await tx.teamSlot.count({ where: { teamId } });
        let teamStatus: TeamStatus = team.status;
        if (totalSlots > 0 && openCount === 0) {
          teamStatus = TeamStatus.FULL;
          await tx.application.updateMany({
            where: { teamId, status: ApplicationStatus.PENDING },
            data: { status: ApplicationStatus.EXPIRED },
          });
          await tx.invitation.updateMany({
            where: { teamId, status: ApplicationStatus.PENDING },
            data: { status: ApplicationStatus.EXPIRED },
          });
        }
        if (teamStatus !== team.status) {
          await tx.team.update({ where: { id: teamId }, data: { status: teamStatus } });
        }

        return { teamId, memberId: membership.id, slotId: slot.id, teamStatus, leaderId: team.leaderId };
      });
    } catch (e) {
      // 数据库层“同竞赛一人一队”的部分唯一索引会在并发下直接拒绝其中一个事务
      if (this.isUniqueViolation(e)) {
        throw new BadRequestException('该用户已加入本竞赛的一支队伍，该请求无法完成');
      }
      throw e;
    }
  }

  /**
   * 原子占用一个 OPEN slot。
   * compare-and-swap：只在 `status = OPEN` 时更新，并检查 affected rows === 1。
   * 被并发抢走时重试下一个候选人，直到无名额。
   */
  private async claimSlot(
    tx: Prisma.TransactionClient,
    teamId: string,
    role: RoleType,
  ): Promise<{ id: string } | null> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = await tx.teamSlot.findFirst({
        where: { teamId, role, status: SlotStatus.OPEN },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!candidate) return null;
      const claimed = await tx.teamSlot.updateMany({
        where: { id: candidate.id, status: SlotStatus.OPEN },
        data: { status: SlotStatus.FILLED, filledAt: new Date() },
      });
      if (claimed.count === 1) return candidate;
    }
    return null;
  }

  // ==================================================================
  // 成员生命周期：退出 / 移除 / 转让队长
  // ==================================================================

  /** 普通成员主动退出。FULL -> PAUSED，绝不自动回到 RECRUITING。 */
  async leaveTeam(userId: string, teamId: string) {
    const { leaderId } = await this.prisma.$transaction(async (tx) => {
      await this.lockTeam(tx, teamId);
      const team = await tx.team.findUnique({ where: { id: teamId } });
      if (!team) throw new NotFoundException('队伍不存在');
      this.assertMutable(team);

      const member = await tx.teamMember.findFirst({ where: { teamId, userId, active: true } });
      if (!member) throw new BadRequestException('你不是该队伍成员');
      if (member.userId === team.leaderId) {
        throw new BadRequestException('队长不能直接退出，请先转让队长或解散队伍');
      }

      await this.releaseSlotAndDeactivate(tx, team, member);
      const teamStatus = await this.statusAfterMemberGone(tx, team);
      return { leaderId: team.leaderId, teamStatus };
    });

    // 通知队长（事务外：通知失败不应回滚成员关系）
    await this.notify.notify(leaderId, NotificationKind.MEMBER_LEFT, { teamId, userId });
    return { left: true };
  }

  /** 队长移除普通成员。COMPETING 下禁止直接移除（需先“重新调整阵容”）。 */
  async removeMember(actorId: string, teamId: string, memberId: string) {
    const removedUserId = await this.prisma.$transaction(async (tx) => {
      await this.lockTeam(tx, teamId);
      const team = await tx.team.findUnique({ where: { id: teamId } });
      if (!team) throw new NotFoundException('队伍不存在');
      if (team.leaderId !== actorId) throw new ForbiddenException('只有队长可以操作');
      this.assertMutable(team);
      if (team.status === TeamStatus.COMPETING) {
        throw new BadRequestException('参赛中不能直接移除成员，请先“重新调整阵容”回到暂停招募');
      }

      const member = await tx.teamMember.findFirst({ where: { id: memberId, teamId, active: true } });
      if (!member) throw new NotFoundException('成员不存在');
      if (member.userId === team.leaderId) throw new BadRequestException('不能移除队长');

      await this.releaseSlotAndDeactivate(tx, team, member);
      // 若因此产生空缺：FULL -> PAUSED（不自动恢复公开招募）
      await this.statusAfterMemberGone(tx, team);
      return member.userId;
    });

    // 平台外成员无 userId，跳过通知
    if (removedUserId) {
      await this.notify.notify(removedUserId, NotificationKind.MEMBER_REMOVED, { teamId });
    }
    return { removed: true };
  }

  /** 转让队长：只能转给该 Team 的注册成员；原队长保留成员身份。 */
  async transferLeadership(actorId: string, teamId: string, newLeaderUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTeam(tx, teamId);
      const team = await tx.team.findUnique({ where: { id: teamId } });
      if (!team) throw new NotFoundException('队伍不存在');
      if (team.leaderId !== actorId) throw new ForbiddenException('只有队长可以转让');
      this.assertMutable(team);
      if (team.leaderId === newLeaderUserId) throw new BadRequestException('对方已经是队长');

      const target = await tx.teamMember.findFirst({
        where: { teamId, userId: newLeaderUserId, active: true },
      });
      if (!target) throw new BadRequestException('只能转让给本队伍的注册成员');
      if (!target.userId) throw new BadRequestException('不能转让给平台外成员');

      await tx.team.update({ where: { id: teamId }, data: { leaderId: target.userId } });
      return { leaderId: target.userId };
    });
  }

  // ==================================================================
  // TeamSlot 编辑（队长）
  // ==================================================================

  async addSlot(actorId: string, teamId: string, role: RoleType, note?: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTeam(tx, teamId);
      const team = await tx.team.findUnique({ where: { id: teamId } });
      if (!team) throw new NotFoundException('队伍不存在');
      if (team.leaderId !== actorId) throw new ForbiddenException('只有队长可以操作');
      this.assertMutable(team);
      if (team.status === TeamStatus.COMPETING) {
        throw new BadRequestException('参赛中不能调整招募名额，请先“重新调整阵容”');
      }
      const count = await tx.teamSlot.count({ where: { teamId } });
      if (count >= MAX_SLOTS) throw new BadRequestException(`最多 ${MAX_SLOTS} 个名额`);

      const slot = await tx.teamSlot.create({ data: { teamId, role, note: note ?? null } });
      // FULL 队伍新增名额：退回 PAUSED，由队长明确点击“恢复招募”
      if (team.status === TeamStatus.FULL) {
        await tx.team.update({ where: { id: teamId }, data: { status: TeamStatus.PAUSED } });
      }
      return slot;
    });
  }

  async updateSlot(actorId: string, teamId: string, slotId: string, data: { role?: RoleType; note?: string | null }) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTeam(tx, teamId);
      const team = await tx.team.findUnique({ where: { id: teamId } });
      if (!team) throw new NotFoundException('队伍不存在');
      if (team.leaderId !== actorId) throw new ForbiddenException('只有队长可以操作');
      this.assertMutable(team);
      if (team.status === TeamStatus.COMPETING) {
        throw new BadRequestException('参赛中不能调整招募名额，请先“重新调整阵容”');
      }
      const slot = await tx.teamSlot.findFirst({ where: { id: slotId, teamId } });
      if (!slot) throw new NotFoundException('名额不存在');
      if (slot.status === SlotStatus.FILLED) throw new BadRequestException('已招到的名额不能修改');
      return tx.teamSlot.update({
        where: { id: slotId },
        data: {
          ...(data.role ? { role: data.role } : {}),
          ...(data.note !== undefined ? { note: data.note } : {}),
        },
      });
    });
  }

  /** 关闭一个 OPEN 名额（取消招募需求，不等于招到人）。不能关闭 FILLED。 */
  async closeSlot(actorId: string, teamId: string, slotId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTeam(tx, teamId);
      const team = await tx.team.findUnique({ where: { id: teamId } });
      if (!team) throw new NotFoundException('队伍不存在');
      if (team.leaderId !== actorId) throw new ForbiddenException('只有队长可以操作');
      this.assertMutable(team);
      if (team.status === TeamStatus.COMPETING) {
        throw new BadRequestException('参赛中不能调整招募名额，请先“重新调整阵容”');
      }
      const slot = await tx.teamSlot.findFirst({ where: { id: slotId, teamId } });
      if (!slot) throw new NotFoundException('名额不存在');
      if (slot.status === SlotStatus.FILLED) {
        throw new BadRequestException('已招到的名额不能直接关闭，请先移除对应成员');
      }
      await tx.teamSlot.update({ where: { id: slotId }, data: { status: SlotStatus.CLOSED } });

      // 关掉最后一个 OPEN 名额后不再对外招募：RECRUITING -> PAUSED
      const open = await tx.teamSlot.count({ where: { teamId, status: SlotStatus.OPEN } });
      if (open === 0 && team.status === TeamStatus.RECRUITING) {
        await tx.team.update({ where: { id: teamId }, data: { status: TeamStatus.PAUSED } });
      }
      return { closed: true };
    });
  }

  // ==================================================================
  // cron 自动流转（MODULE_MATCH §2）
  // ==================================================================

  /**
   * 每日执行：过期截止/竞赛报名结束 30 天/参赛结束 60 天。
   * 正常生命周期结束一律归档为 ARCHIVED，只有队长主动解散才是 DISBANDED。
   */
  async archiveExpired() {
    const now = new Date();
    const teams = await this.prisma.team.findMany({
      where: {
        status: { in: [TeamStatus.RECRUITING, TeamStatus.PAUSED, TeamStatus.FULL, TeamStatus.COMPETING] },
      },
      include: {
        competition: {
          include: { timelines: { where: { stage: { contains: '报名' } }, orderBy: { endAt: 'desc' }, take: 1 } },
        },
      },
    });

    let archived = 0;
    for (const team of teams) {
      const signupEnd = team.competition.timelines[0]?.endAt ?? null;
      let shouldArchive = false;

      if (team.status === TeamStatus.COMPETING) {
        const raceEnd = await this.prisma.competitionTimeline.findFirst({
          where: { competitionId: team.competitionId },
          orderBy: { endAt: 'desc' },
        });
        if (raceEnd?.endAt && now.getTime() - raceEnd.endAt.getTime() > 60 * 86400_000) shouldArchive = true;
      } else if (signupEnd && now.getTime() - signupEnd.getTime() > 30 * 86400_000) {
        shouldArchive = true; // 报名都结束了还挂着招募，纯噪音
      }

      if (shouldArchive) {
        await this.prisma.$transaction(async (tx) => {
          await this.lockTeam(tx, team.id);
          await tx.team.update({
            where: { id: team.id },
            data: { status: TeamStatus.ARCHIVED, archivedAt: now },
          });
          await tx.application.updateMany({
            where: { teamId: team.id, status: ApplicationStatus.PENDING },
            data: { status: ApplicationStatus.EXPIRED },
          });
          await tx.invitation.updateMany({
            where: { teamId: team.id, status: ApplicationStatus.PENDING },
            data: { status: ApplicationStatus.EXPIRED },
          });
          // 归档后队伍不再是“有效 Team”：软删除成员关系，释放“同竞赛一人一队”约束，
          // 同时保留历史行（不 hard delete）
          await this.deactivateAllMembers(tx, team.id);
        });
        archived++;
      }
    }
    return { archived };
  }

  // ==================================================================
  // “我的”视图
  // ==================================================================

  async myTeams(userId: string) {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId, active: true },
      select: { teamId: true },
    });
    const teamIds = [...new Set(memberships.map((m) => m.teamId))];
    // 会员关系（含已解散/归档的历史队伍）都应可见，因此不按状态过滤
    const rows = await this.prisma.team.findMany({
      where: { OR: [{ leaderId: userId }, { id: { in: teamIds } }] },
      include: {
        competition: { select: { id: true, name: true } },
        leader: { select: SAFE_USER_SELECT },
        slots: { select: { id: true, role: true, status: true, note: true } },
        members: { where: { active: true }, select: { id: true, userId: true } },
        _count: { select: { applications: { where: { status: ApplicationStatus.PENDING } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((t) => ({
      id: t.id,
      goal: t.goal,
      status: t.status,
      deadline: t.deadline,
      createdAt: t.createdAt,
      competition: t.competition,
      leader: this.serialize(t.leader),
      slots: t.slots,
      ...this.derive(t.members, t.slots),
      isLeader: t.leaderId === userId,
      pendingCount: t._count.applications,
    }));
  }

  async myApplications(userId: string) {
    const [sent, received] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where: { userId },
        include: {
          team: {
            include: {
              competition: { select: { id: true, name: true } },
              leader: { select: SAFE_USER_SELECT },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.application.findMany({
        where: { team: { leaderId: userId }, status: ApplicationStatus.PENDING },
        include: {
          team: { include: { competition: { select: { id: true, name: true } } } },
          user: { select: SAFE_USER_SELECT },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    return {
      sent: sent.map((a) => ({
        id: a.id,
        desiredRole: a.desiredRole,
        pitch: a.pitch,
        status: a.status,
        reason: a.reason,
        createdAt: a.createdAt,
        team: {
          id: a.team.id,
          status: a.team.status,
          competition: a.team.competition,
          leader: this.serialize(a.team.leader),
        },
      })),
      received: received.map((a) => ({
        id: a.id,
        desiredRole: a.desiredRole,
        pitch: a.pitch,
        status: a.status,
        createdAt: a.createdAt,
        team: { id: a.team.id, competition: a.team.competition },
        user: this.serialize(a.user),
      })),
    };
  }

  async myInvitations(userId: string) {
    const rows = await this.prisma.invitation.findMany({
      where: { userId },
      include: {
        team: {
          include: {
            competition: { select: { id: true, name: true } },
            leader: { select: SAFE_USER_SELECT },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((i) => ({
      id: i.id,
      role: i.role,
      message: i.message,
      status: i.status,
      createdAt: i.createdAt,
      team: {
        id: i.team.id,
        status: i.team.status,
        competition: i.team.competition,
        leader: this.serialize(i.team.leader),
      },
    }));
  }

  // ==================================================================
  // 内部工具
  // ==================================================================

  /** 对 Team 行加排他锁，串行化同一队伍的所有成员/状态变更 */
  private async lockTeam(tx: Prisma.TransactionClient, teamId: string) {
    await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`;
  }

  private async mustOwn(actorId: string, teamId: string): Promise<Team> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('队伍不存在');
    if (team.leaderId !== actorId) throw new ForbiddenException('只有队长可以操作');
    return team;
  }

  private assertMutable(team: Team) {
    if (TERMINAL_STATUSES.includes(team.status)) {
      throw new BadRequestException('队伍已解散/归档，不能再变更成员');
    }
  }

  /** 队伍终止（解散/归档）时软删除所有成员关系，保留历史但不计入有效成员 */
  private async deactivateAllMembers(tx: Prisma.TransactionClient, teamId: string) {
    await tx.teamMember.updateMany({
      where: { teamId, active: true },
      data: { active: false, leftAt: new Date() },
    });
  }

  /** 释放成员占据的 slot 并软删除成员关系 */
  private async releaseSlotAndDeactivate(tx: Prisma.TransactionClient, team: Team, member: TeamMember) {
    const slot = await tx.teamSlot.findFirst({ where: { teamId: team.id, filledByMemberId: member.id } });
    if (slot) {
      // 名额恢复为 OPEN，可以重新招募
      await tx.teamSlot.update({
        where: { id: slot.id },
        data: { status: SlotStatus.OPEN, filledByMemberId: null, filledAt: null },
      });
    }
    await tx.teamMember.update({ where: { id: member.id }, data: { active: false, leftAt: new Date() } });
  }

  /** 成员离开后：FULL -> PAUSED（绝不自动回 RECRUITING）；其他状态保持不变 */
  private async statusAfterMemberGone(tx: Prisma.TransactionClient, team: Team): Promise<TeamStatus> {
    if (team.status === TeamStatus.FULL) {
      await tx.team.update({ where: { id: team.id }, data: { status: TeamStatus.PAUSED } });
      return TeamStatus.PAUSED;
    }
    return team.status;
  }

  private isUniqueViolation(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }

  private serialize(user: SafeUser) {
    const serializable: SerializableUser = {
      id: user.id,
      nickname: user.nickname,
      college: user.college,
      grade: user.grade,
      major: user.major,
      bio: user.bio,
      studentNo: user.studentNo,
      skills: user.skills,
      teamIds: user.memberships.map((m) => m.teamId),
    };
    return this.serializer.serialize(serializable);
  }

  /** 由真实关系推导人数，绝不读取可伪造的 currentSize */
  private derive(
    members: { id: string; userId?: string | null }[],
    slots: { id: string; role: RoleType; status: SlotStatus; note?: string | null }[],
  ) {
    const openSlots = slots.filter((s) => s.status === SlotStatus.OPEN);
    const memberCount = members.length;
    const remaining = openSlots.length;
    return {
      memberCount,
      remaining,
      targetSize: memberCount + remaining,
      openRoles: [...new Set(openSlots.map((s) => s.role))],
    };
  }
}
