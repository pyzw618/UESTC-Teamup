import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ApplicationStatus, RoleType, TeamGoal, TeamStatus, type Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { NotificationService } from '../notification/notification.service';

export interface CreateTeamInput {
  competitionId?: string;
  /** 手动填写竞赛名（找不到对应竞赛时自动建档） */
  competitionName?: string;
  goal: TeamGoal;
  requirement?: string;
  contact?: string;
  deadline?: Date;
  teamSize?: number;
  currentSize?: number;
  slots: { role: RoleType; note?: string }[];
  members?: {
    displayName?: string;
    userId?: string;
    role?: RoleType;
    rank?: string;
    grade?: number;
    college?: string;
    note?: string;
  }[];
}

const DAILY_POST_LIMIT = 5;
const REAPPLY_COOLDOWN_HOURS = 24;

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
  ) {}

  // ---------- 查询 ----------

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
    // 默认只显示招募中/沟通中（僵尸帖防线，MODULE_MATCH §2）
    const statuses = q.statuses?.length ? q.statuses : [TeamStatus.RECRUITING, TeamStatus.NEGOTIATING];

    const where: Prisma.TeamWhereInput = {
      status: { in: statuses },
      competition: { status: 'PUBLISHED' },
      ...(q.competitionId ? { competitionId: q.competitionId } : {}),
      ...(q.goal ? { goal: q.goal } : {}),
      // 缺口角色：存在未招满且角色命中的 slot
      ...(q.roles?.length ? { slots: { some: { role: { in: q.roles }, filled: false } } } : {}),
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
          leader: { select: { id: true, nickname: true, college: true, grade: true, major: true } },
          slots: true,
          members: true,
          _count: { select: { applications: { where: { status: 'PENDING' } } } },
        },
      }),
      this.prisma.team.count({ where }),
    ]);

    return {
      items: rows.map((t) => ({
        id: t.id,
        goal: t.goal,
        status: t.status,
        deadline: t.deadline,
        teamSize: t.teamSize,
        currentSize: t.currentSize,
        expired: t.deadline != null && t.deadline < now,
        competition: t.competition,
        leader: t.leader,
        slots: t.slots,
        openRoles: t.slots.filter((s) => !s.filled).map((s) => s.role),
        memberCount: t.members.length,
        pendingCount: t._count.applications,
        createdAt: t.createdAt,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async detail(id: string) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        competition: { include: { levels: true } },
        leader: { include: { skills: true, memberships: { select: { teamId: true } } } },
        slots: true,
        members: { include: { user: { include: { skills: true, memberships: { select: { teamId: true } } } } } },
        applications: { where: { status: 'PENDING' }, include: { user: true }, orderBy: { createdAt: 'desc' } },
        invitations: { include: { user: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!team) throw new NotFoundException('队伍不存在');
    return team;
  }

  // ---------- 发布 ----------

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
          data: {
            name,
            sourceUrl: '用户手动填写',
            status: 'PUBLISHED',
          },
        });
        competitionId = created.id;
      }
    }
    if (!competitionId) throw new BadRequestException('请选择竞赛或手动填写竞赛名称');

    const competition = await this.prisma.competition.findUnique({ where: { id: competitionId } });
    if (!competition || competition.status === 'ARCHIVED') throw new NotFoundException('竞赛不存在或已下线');

    // 防刷（MODULE_MATCH §6）
    const activeCount = await this.prisma.team.count({
      where: { leaderId, status: { in: [TeamStatus.RECRUITING, TeamStatus.NEGOTIATING] } },
    });
    if (activeCount >= DAILY_POST_LIMIT) throw new BadRequestException('你已有 5 支招募中的队伍，请先处理现有队伍');

    const dup = await this.prisma.team.findFirst({
      where: {
        leaderId,
        competitionId,
        createdAt: { gte: new Date(Date.now() - 24 * 3600_000) },
      },
    });
    if (dup) throw new BadRequestException('你在 24 小时内已为该竞赛发布过组队，请勿重复发帖');

    // 招募截止默认填竞赛报名截止时间
    let deadline = input.deadline ?? null;
    if (!deadline) {
      const signup = await this.prisma.competitionTimeline.findFirst({
        where: { competitionId, stage: { contains: '报名' }, endAt: { gt: new Date() } },
        orderBy: { endAt: 'asc' },
      });
      deadline = signup?.endAt ?? null;
    }

    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: {
          competitionId,
          leaderId,
          goal: input.goal,
          requirement: input.requirement ?? null,
          contact: input.contact ?? null,
          deadline,
          teamSize: input.teamSize ?? null,
          currentSize: input.currentSize ?? null,
          slots: {
            create: (input.slots ?? []).slice(0, 10).map((s) => ({ role: s.role })),
          },
        },
      });

      // 已有成员（队长自己必占一行）
      const memberRows = [
        { teamId: team.id, userId: leaderId, displayName: null, role: null as RoleType | null, note: '队长' },
        ...(input.members ?? []).map((m) => ({
          teamId: team.id,
          userId: m.userId ?? null,
          displayName: m.displayName ?? null,
          role: m.role ?? null,
          rank: m.rank ?? null,
          grade: m.grade ?? null,
          college: m.college ?? null,
          note: m.note ?? null,
        })),
      ];
      await tx.teamMember.createMany({ data: memberRows as never });

      return tx.team.findUnique({ where: { id: team.id }, include: { slots: true, members: true } });
    });
  }

  // ---------- 状态机（队长操作） ----------

  async transition(actorId: string, teamId: string, action: 'NEGOTIATE' | 'COMPETE' | 'DISBAND' | 'REOPEN') {
    const team = await this.mustOwn(actorId, teamId);

    const next: Record<typeof action, TeamStatus | null> = {
      NEGOTIATE: TeamStatus.NEGOTIATING,
      COMPETE: TeamStatus.COMPETING,
      DISBAND: TeamStatus.DISBANDED,
      REOPEN: TeamStatus.RECRUITING,
    };
    const target = next[action];
    if (!target) throw new BadRequestException('不支持的状态');
    const allowed: Record<typeof action, TeamStatus[]> = {
      NEGOTIATE: [TeamStatus.RECRUITING],
      COMPETE: [TeamStatus.RECRUITING, TeamStatus.NEGOTIATING, TeamStatus.FULL],
      DISBAND: [TeamStatus.RECRUITING, TeamStatus.NEGOTIATING, TeamStatus.FULL, TeamStatus.COMPETING],
      REOPEN: [TeamStatus.NEGOTIATING],
    };
    if (!allowed[action].includes(team.status)) {
      throw new BadRequestException(`当前状态「${team.status}」不能执行 ${action}`);
    }

    return this.prisma.team.update({ where: { id: teamId }, data: { status: target } });
  }

  // ---------- 申请-审批流 ----------

  async apply(userId: string, teamId: string, pitch: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('队伍不存在');
    if (team.leaderId === userId) throw new BadRequestException('这是你自己的队伍');

    const now = new Date();
    if (team.deadline && team.deadline < now) {
      throw new BadRequestException('该队伍招募已截止');
    }
    if (team.status !== TeamStatus.RECRUITING) throw new BadRequestException('该队伍当前不在招募中');

    const existing = await this.prisma.application.findFirst({
      where: { teamId, userId, status: ApplicationStatus.PENDING },
    });
    if (existing) throw new BadRequestException('你已提交过申请，请等待队长处理');

    const rejected = await this.prisma.application.findFirst({
      where: { teamId, userId, status: ApplicationStatus.REJECTED, createdAt: { gte: new Date(now.getTime() - REAPPLY_COOLDOWN_HOURS * 3600_000) } },
      orderBy: { createdAt: 'desc' },
    });
    if (rejected) throw new BadRequestException('申请刚被婉拒，请过一天再试');

    const application = await this.prisma.application.create({
      data: { teamId, userId, pitch },
    });

    await this.notify.notify(team.leaderId, 'APPLICATION_NEW', {
      teamId,
      applicationId: application.id,
      applicantId: userId,
    });
    return application;
  }

  /** 审批：事务内检查 slot 防超额录取（MODULE_MATCH §3 并发问题） */
  async reviewApplication(leaderId: string, applicationId: string, accept: boolean, reason?: string) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { team: true },
    });
    if (!application) throw new NotFoundException('申请不存在');
    if (application.team.leaderId !== leaderId) throw new ForbiddenException('只有队长可以审批');
    if (application.status !== ApplicationStatus.PENDING) throw new BadRequestException('该申请已处理过');

    const applicant = await this.prisma.user.findUnique({ where: { id: application.userId } });

    if (!accept) {
      await this.prisma.application.update({
        where: { id: applicationId },
        data: { status: ApplicationStatus.REJECTED, reason: reason ?? null },
      });
      await this.notify.notify(application.userId, 'APPLICATION_RESULT', {
        teamId: application.teamId,
        applicationId,
        accepted: false,
        reason: reason ?? null,
      });
      return { accepted: false };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 行锁语义：事务内重查队伍 + 未满 slot，防两人同时申请最后一个位置
      const fresh = await tx.team.findUnique({
        where: { id: application.teamId },
        include: { slots: { where: { filled: false }, orderBy: { role: 'asc' } } },
      });
      if (!fresh) throw new NotFoundException('队伍不存在');
      if (fresh.status !== TeamStatus.RECRUITING) throw new BadRequestException('队伍已不在招募中');

      const slot = fresh.slots[0];
      if (slot) {
        await tx.teamSlot.update({ where: { id: slot.id }, data: { filled: true } });
      }

      await tx.teamMember.create({
        data: { teamId: fresh.id, userId: application.userId, role: slot?.role ?? null },
      });

      // 所有 slot 满了 → 自动转已满员
      const remaining = await tx.teamSlot.count({ where: { teamId: fresh.id, filled: false } });
      const status = remaining === 0 && fresh.slots.length > 0 ? TeamStatus.FULL : fresh.status;

      await tx.team.update({ where: { id: fresh.id }, data: { status } });
      await tx.application.update({
        where: { id: applicationId },
        data: { status: ApplicationStatus.ACCEPTED },
      });
      // 同队伍后：其他 PENDING 申请若已无空位，保留由队长逐个婉拒（不自动拒，避免误伤）
      return { accepted: true, teamStatus: status };
    });

    await this.notify.notify(application.userId, 'APPLICATION_RESULT', {
      teamId: application.teamId,
      applicationId,
      accepted: true,
    });
    void applicant;
    return result;
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

  // ---------- 邀请流 ----------

  async invite(leaderId: string, teamId: string, inviteeId: string) {
    const team = await this.mustOwn(leaderId, teamId);
    if (team.leaderId === inviteeId) throw new BadRequestException('不能邀请自己');
    const invitee = await this.prisma.user.findUnique({ where: { id: inviteeId } });
    if (!invitee) throw new NotFoundException('用户不存在');

    const pending = await this.prisma.invitation.findFirst({
      where: { teamId, userId: inviteeId, status: ApplicationStatus.PENDING },
    });
    if (pending) throw new BadRequestException('已发出过邀请，等待对方处理');

    const invitation = await this.prisma.invitation.create({ data: { teamId, userId: inviteeId } });
    await this.notify.notify(inviteeId, 'INVITATION_NEW', { teamId, invitationId: invitation.id });
    return invitation;
  }

  async respondInvitation(userId: string, invitationId: string, accept: boolean) {
    const invitation = await this.prisma.invitation.findUnique({ where: { id: invitationId }, include: { team: true } });
    if (!invitation || invitation.userId !== userId) throw new NotFoundException('邀请不存在');
    if (invitation.status !== ApplicationStatus.PENDING) throw new BadRequestException('该邀请已处理过');

    if (!accept) {
      await this.prisma.invitation.update({ where: { id: invitationId }, data: { status: ApplicationStatus.REJECTED } });
      await this.notify.notify(invitation.team.leaderId, 'APPLICATION_RESULT', {
        teamId: invitation.teamId,
        invitationId,
        accepted: false,
        kind: 'invitation',
      });
      return { accepted: false };
    }

    await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.team.findUnique({
        where: { id: invitation.teamId },
        include: { slots: { where: { filled: false }, orderBy: { role: 'asc' } } },
      });
      if (!fresh) throw new NotFoundException('队伍不存在');

      const slot = fresh.slots[0];
      if (slot) await tx.teamSlot.update({ where: { id: slot.id }, data: { filled: true } });
      await tx.teamMember.create({
        data: { teamId: fresh.id, userId, role: slot?.role ?? null },
      });
      const remaining = await tx.teamSlot.count({ where: { teamId: fresh.id, filled: false } });
      if (remaining === 0 && fresh.slots.length > 0) {
        await tx.team.update({ where: { id: fresh.id }, data: { status: TeamStatus.FULL } });
      }
      await tx.invitation.update({ where: { id: invitationId }, data: { status: ApplicationStatus.ACCEPTED } });
    });

    await this.notify.notify(invitation.team.leaderId, 'APPLICATION_RESULT', {
      teamId: invitation.teamId,
      invitationId,
      accepted: true,
      kind: 'invitation',
    });
    return { accepted: true };
  }

  // ---------- cron 自动流转（MODULE_MATCH §2） ----------

  /** 每日执行：过期截止/竞赛报名结束 30 天/参赛结束 60 天 */
  async archiveExpired() {
    const now = new Date();
    const teams = await this.prisma.team.findMany({
      where: { status: { in: [TeamStatus.RECRUITING, TeamStatus.NEGOTIATING, TeamStatus.COMPETING] } },
      include: {
        competition: {
          include: { timelines: { where: { stage: { contains: '报名' } }, orderBy: { endAt: 'desc' }, take: 1 } },
        },
      },
    });

    let disbanded = 0;
    for (const team of teams) {
      const signupEnd = team.competition.timelines[0]?.endAt ?? null;
      let disband = false;

      if (team.status === 'COMPETING') {
        // 竞赛结束 60 天后自动归档：以赛程最后节点为参考，无节点则不处理
        const raceEnd = await this.prisma.competitionTimeline.findFirst({
          where: { competitionId: team.competitionId },
          orderBy: { endAt: 'desc' },
        });
        if (raceEnd?.endAt && now.getTime() - raceEnd.endAt.getTime() > 60 * 86400_000) disband = true;
      } else if (signupEnd && now.getTime() - signupEnd.getTime() > 30 * 86400_000) {
        disband = true; // 报名都结束了还挂着招募，纯噪音
      }

      if (disband) {
        await this.prisma.team.update({ where: { id: team.id }, data: { status: TeamStatus.DISBANDED } });
        disbanded++;
      }
    }
    return { disbanded };
  }

  async myTeams(userId: string) {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });
    const teamIds = [...new Set([...memberships.map((m) => m.teamId)])];
    const rows = await this.prisma.team.findMany({
      where: { OR: [{ leaderId: userId }, { id: { in: teamIds } }] },
      include: {
        competition: { select: { id: true, name: true } },
        slots: true,
        members: true,
        _count: { select: { applications: { where: { status: 'PENDING' } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((t) => ({
      ...t,
      isLeader: t.leaderId === userId,
      openRoles: t.slots.filter((s) => !s.filled).map((s) => s.role),
    }));
  }

  async myApplications(userId: string) {
    const [sent, received] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where: { userId },
        include: { team: { include: { competition: { select: { name: true } }, leader: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      // 收到的：我担任队长的队伍的申请
      this.prisma.application.findMany({
        where: { team: { leaderId: userId } },
        include: { team: { include: { competition: { select: { name: true } } } }, user: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    return { sent, received };
  }

  async myInvitations(userId: string) {
    return this.prisma.invitation.findMany({
      where: { userId },
      include: { team: { include: { competition: { select: { name: true } }, leader: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async mustOwn(actorId: string, teamId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('队伍不存在');
    if (team.leaderId !== actorId) throw new ForbiddenException('只有队长可以操作');
    return team;
  }
}
