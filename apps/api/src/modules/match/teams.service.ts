import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationKind, Prisma, RoleType, TeamGoal, TeamStatus, type Team } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { UserSerializer, type SerializableUser } from '../../common/auth/viewer.context';
import { NotificationService } from '../notification/notification.service';

export interface UpsertTeamInput {
  competitionId?: string;
  /** 手动填写竞赛名（找不到对应竞赛时自动建档） */
  competitionName?: string;
  goal: TeamGoal;
  neededRoles?: RoleType[];
  requirement?: string;
  /** 广告牌模式下必填：微信/QQ 等直接公开的联系方式 */
  contact: string;
  deadline?: Date | null;
  /** 计划招募人数（展示用） */
  targetSize?: number | null;
  /** 已有成员情况（队长手填，纯展示，不关联平台账号） */
  members?: { grade?: number | null; college?: string | null; major?: string | null; rank?: string | null; intro?: string | null }[];
}

/** 队长可手动切换的状态；COMPETING 由系统根据比赛时间设置，不在其中 */
export type ManualTeamStatus = 'RECRUITING' | 'FULL' | 'DISBANDED';

const DAILY_POST_LIMIT = 5;
const MAX_ROLES = 10;

/** 队长可手动切换的状态；COMPETING 由系统根据比赛时间设置，不在其中 */
const MANUAL_STATUSES: TeamStatus[] = [TeamStatus.RECRUITING, TeamStatus.FULL, TeamStatus.DISBANDED];

/** 公共发现列表允许出现的状态；DISBANDED 只在队长的归档仓库可见 */
const DISCOVERABLE_STATUSES: TeamStatus[] = [TeamStatus.RECRUITING, TeamStatus.FULL, TeamStatus.COMPETING];

/**
 * 用户安全字段投影：绝不直接返回 Prisma User 对象（会泄漏 passwordHash / email 等）。
 * studentNo 交由 UserSerializer 按可见规则决定是否输出。
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
    sort?: 'DEADLINE' | 'LATEST';
    page: number;
    pageSize: number;
  }) {
    const now = new Date();
    // 默认只展示招募中；已解散（归档仓库）永不出现在公共发现列表
    const statuses = q.statuses?.length
      ? q.statuses.filter((s) => DISCOVERABLE_STATUSES.includes(s))
      : [TeamStatus.RECRUITING];

    const where: Prisma.TeamWhereInput = {
      status: { in: statuses.length ? statuses : [TeamStatus.RECRUITING] },
      competition: { status: 'PUBLISHED' },
      ...(q.competitionId ? { competitionId: q.competitionId } : {}),
      ...(q.goal ? { goal: q.goal } : {}),
      // 招募方向：帖子的 neededRoles 标签命中即可
      ...(q.roles?.length ? { neededRoles: { hasSome: q.roles } } : {}),
    };

    const orderBy: Prisma.TeamOrderByWithRelationInput =
      q.sort === 'DEADLINE' ? { deadline: 'asc' } : { createdAt: 'desc' };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        where,
        orderBy: [orderBy],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          goal: true,
          status: true,
          neededRoles: true,
          deadline: true,
          targetSize: true,
          createdAt: true,
          competition: { select: { id: true, name: true } },
          leader: { select: SAFE_USER_SELECT },
          _count: { select: { members: true } },
        },
      }),
      this.prisma.team.count({ where }),
    ]);

    const commentCounts = await this.commentCounts(rows.map((t) => t.id));

    return {
      items: rows.map((t) => ({
        id: t.id,
        goal: t.goal,
        status: t.status,
        neededRoles: t.neededRoles,
        deadline: t.deadline,
        expired: t.deadline != null && t.deadline < now,
        targetSize: t.targetSize,
        memberCount: t._count.members,
        competition: t.competition,
        leader: this.serialize(t.leader),
        commentCount: commentCounts.get(t.id) ?? 0,
        createdAt: t.createdAt,
      })),
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
        members: { orderBy: { createdAt: 'asc' } },
        _count: { select: { members: true } },
      },
    });
    if (!team) throw new NotFoundException('招募帖不存在');

    const isLeader = viewerId != null && (team.leaderId === viewerId || viewerRole === 'ADMIN');
    const commentCounts = await this.commentCounts([team.id]);

    return {
      id: team.id,
      goal: team.goal,
      status: team.status,
      neededRoles: team.neededRoles,
      requirement: team.requirement,
      // 广告牌模式：联系方式直接公开，任何人可见
      contact: team.contact,
      deadline: team.deadline,
      expired: team.deadline != null && team.deadline < new Date(),
      targetSize: team.targetSize,
      memberCount: team._count.members,
      members: team.members.map((m) => ({
        id: m.id,
        grade: m.grade,
        college: m.college,
        major: m.major,
        rank: m.rank,
        intro: m.intro,
      })),
      commentCount: commentCounts.get(team.id) ?? 0,
      createdAt: team.createdAt,
      competition: {
        id: team.competition.id,
        name: team.competition.name,
        levels: team.competition.levels.map((l) => l.level),
        officialUrl: team.competition.officialUrl,
      },
      leader: this.serialize(team.leader),
      viewer: { isLeader },
    };
  }

  // ==================================================================
  // 发布 / 编辑
  // ==================================================================

  async create(leaderId: string, input: UpsertTeamInput) {
    const contact = this.assertContact(input.contact);
    const competitionId = await this.resolveCompetition(input);
    const neededRoles = this.normalizeRoles(input.neededRoles);

    // 防刷：活跃帖上限（MODULE_MATCH §6）
    const activeCount = await this.prisma.team.count({
      where: { leaderId, status: { in: [TeamStatus.RECRUITING, TeamStatus.FULL] } },
    });
    if (activeCount >= DAILY_POST_LIMIT) throw new BadRequestException('你已有 5 条招募中的帖子，请先处理现有帖子');

    const dup = await this.prisma.team.findFirst({
      where: { leaderId, competitionId, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
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

    return this.prisma.team.create({
      data: {
        competitionId,
        leaderId,
        goal: input.goal,
        neededRoles,
        requirement: input.requirement?.trim() || null,
        contact,
        deadline,
        targetSize: this.normalizeTargetSize(input.targetSize),
        members: { create: this.normalizeMembers(input.members) },
      },
    });
  }

  async update(actorId: string, teamId: string, input: UpsertTeamInput) {
    const team = await this.mustOwn(actorId, teamId);
    if (team.status === TeamStatus.DISBANDED) throw new BadRequestException('帖子已解散归档，不能编辑');

    const contact = input.contact !== undefined ? this.assertContact(input.contact) : undefined;
    const neededRoles = input.neededRoles !== undefined ? this.normalizeRoles(input.neededRoles) : undefined;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.team.update({
        where: { id: teamId },
        data: {
          ...(input.goal ? { goal: input.goal } : {}),
          ...(neededRoles ? { neededRoles } : {}),
          ...(input.requirement !== undefined ? { requirement: input.requirement.trim() || null } : {}),
          ...(contact !== undefined ? { contact } : {}),
          ...(input.deadline !== undefined ? { deadline: input.deadline } : {}),
          ...(input.targetSize !== undefined ? { targetSize: this.normalizeTargetSize(input.targetSize) } : {}),
        },
      });
      // 成员名单为整表替换（队长在编辑弹窗中一次性维护）
      if (input.members !== undefined) {
        await tx.teamMember.deleteMany({ where: { teamId } });
        const rows = this.normalizeMembers(input.members);
        if (rows.length) await tx.teamMember.createMany({ data: rows.map((m) => ({ ...m, teamId })) });
      }
      return updated;
    });
  }

  // ==================================================================
  // 状态切换（队长手动）
  // ==================================================================

  /**
   * 队长手动切换状态：RECRUITING / FULL / DISBANDED。
   * COMPETING 由系统按竞赛时间线自动设置；DISBANDED 是终态（帖子进入归档仓库）。
   */
  async setStatus(actorId: string, teamId: string, status: TeamStatus) {
    if (!MANUAL_STATUSES.includes(status)) {
      throw new BadRequestException('参赛状态由系统根据比赛时间自动设置，无需手动操作');
    }
    const team = await this.mustOwn(actorId, teamId);
    if (team.status === status) return team;
    if (team.status === TeamStatus.DISBANDED) {
      throw new BadRequestException('帖子已解散归档，不能变更状态');
    }
    if (team.status === TeamStatus.COMPETING && status === TeamStatus.FULL) {
      throw new BadRequestException('参赛中的帖子不能改为已满员，可直接解散');
    }
    return this.prisma.team.update({ where: { id: teamId }, data: { status } });
  }

  // ==================================================================
  // cron 自动流转
  // ==================================================================

  /**
   * 按竞赛时间线自动把帖子置为 COMPETING：
   * 招募中/已满员的帖子，其所属竞赛的第一个非报名节点（比赛类）已开始 → COMPETING。
   * 比赛前已解散的帖子（DISBANDED）不在扫描范围内，无需处理。
   */
  async autoCompete() {
    const now = new Date();
    const teams = await this.prisma.team.findMany({
      where: { status: { in: [TeamStatus.RECRUITING, TeamStatus.FULL] } },
      select: { id: true, competitionId: true },
    });
    if (!teams.length) return { updated: 0 };

    const compIds = [...new Set(teams.map((t) => t.competitionId))];
    const raceStarts = new Map<string, Date>();
    const timelines = await this.prisma.competitionTimeline.findMany({
      where: {
        competitionId: { in: compIds },
        startAt: { lte: now },
        NOT: { stage: { contains: '报名' } },
      },
      orderBy: { startAt: 'asc' },
      select: { competitionId: true, startAt: true },
    });
    for (const tl of timelines) {
      if (!raceStarts.has(tl.competitionId) && tl.startAt) raceStarts.set(tl.competitionId, tl.startAt);
    }

    const toCompete = teams.filter((t) => raceStarts.has(t.competitionId)).map((t) => t.id);
    if (!toCompete.length) return { updated: 0 };

    await this.prisma.team.updateMany({
      where: { id: { in: toCompete } },
      data: { status: TeamStatus.COMPETING },
    });
    return { updated: toCompete.length };
  }

  // ==================================================================
  // 「我的」视图
  // ==================================================================

  /** 我的招募帖：含已解散（前端把 DISBANDED 展示为「归档仓库」分区） */
  async myTeams(userId: string) {
    const rows = await this.prisma.team.findMany({
      where: { leaderId: userId },
      include: {
        competition: { select: { id: true, name: true } },
        leader: { select: SAFE_USER_SELECT },
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const commentCounts = await this.commentCounts(rows.map((t) => t.id));
    const now = new Date();

    return rows.map((t) => ({
      id: t.id,
      goal: t.goal,
      status: t.status,
      neededRoles: t.neededRoles,
      deadline: t.deadline,
      expired: t.deadline != null && t.deadline < now,
      targetSize: t.targetSize,
      memberCount: t._count.members,
      commentCount: commentCounts.get(t.id) ?? 0,
      createdAt: t.createdAt,
      competition: t.competition,
      leader: this.serialize(t.leader),
      isLeader: true,
    }));
  }

  // ==================================================================
  // 内部工具
  // ==================================================================

  /** 多态评论无外键，评论数用 groupBy 一次取回 */
  private async commentCounts(teamIds: string[]): Promise<Map<string, number>> {
    if (!teamIds.length) return new Map();
    const groups = await this.prisma.comment.groupBy({
      by: ['targetId'],
      where: { targetType: 'TEAM', targetId: { in: teamIds } },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.targetId, g._count._all]));
  }

  /** 选择竞赛或手动填写竞赛名（二选一）；手动填写时按名称自动建档 */
  private async resolveCompetition(input: UpsertTeamInput): Promise<string> {
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
    return competitionId;
  }

  private assertContact(contact?: string | null): string {
    const trimmed = contact?.trim();
    if (!trimmed) throw new BadRequestException('请填写联系方式（微信/QQ），感兴趣的同学需要直接联系你');
    if (trimmed.length > 200) throw new BadRequestException('联系方式最长 200 字');
    return trimmed;
  }

  private normalizeRoles(roles?: RoleType[]): RoleType[] {
    const valid = [...new Set((roles ?? []).filter((r) => Object.values(RoleType).includes(r)))];
    if (valid.length > MAX_ROLES) throw new BadRequestException(`招募方向最多 ${MAX_ROLES} 个`);
    return valid;
  }

  /** 计划招募人数：1-99，空为 null */
  private normalizeTargetSize(size?: number | null): number | null {
    if (size == null) return null;
    if (!Number.isInteger(size) || size < 1 || size > 99) throw new BadRequestException('计划招募人数应为 1-99 的整数');
    return size;
  }

  /** 成员名单：全空行丢弃，字符串去空白，最多 20 行 */
  private normalizeMembers(members?: UpsertTeamInput['members']) {
    return (members ?? [])
      .slice(0, 20)
      .map((m) => ({
        grade: m.grade ?? null,
        college: m.college?.trim() || null,
        major: m.major?.trim() || null,
        rank: m.rank?.trim() || null,
        intro: m.intro?.trim() || null,
      }))
      .filter((m) => m.grade != null || m.college || m.major || m.rank || m.intro);
  }

  private async mustOwn(actorId: string, teamId: string): Promise<Team> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('招募帖不存在');
    if (team.leaderId !== actorId) throw new ForbiddenException('只有发帖人可以操作');
    return team;
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
      teamIds: [],
    };
    return this.serializer.serialize(serializable);
  }
}
