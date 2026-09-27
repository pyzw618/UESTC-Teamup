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
  /** 具体要求：传 null 表示清空（PATCH 中缺省才表示不更新） */
  requirement?: string | null;
  /** 联系方式：QQ 与微信至少填写一项 */
  qq?: string | null;
  wechat?: string | null;
  deadline?: Date | null;
  /** 计划招募人数（含队长本人，展示用） */
  targetSize?: number | null;
  /** 已有成员情况（队长手填，纯展示，不关联平台账号） */
  members?: { grade?: number | null; college?: string | null; major?: string | null; rank?: string | null; intro?: string | null }[];
}

/** 队长可手动切换的状态；COMPETING 由系统根据比赛时间设置，不在其中 */
export type ManualTeamStatus = 'RECRUITING' | 'FULL' | 'DISBANDED';

const MAX_ROLES = 10;

/** 队长可手动切换的状态；COMPETING 由系统根据比赛时间设置，不在其中 */
const MANUAL_STATUSES: TeamStatus[] = [TeamStatus.RECRUITING, TeamStatus.FULL, TeamStatus.DISBANDED];

/**
 * 用户字段投影：只用于避免把 Prisma User 对象整份返回（会带上 passwordHash / email）。
 * 学号随 SAFE_USER_SELECT 查出，由 UserSerializer 按登录态裁剪（游客不下发）。
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

/**
 * 已有人数口径（B1）：targetSize 语义是「计划招募人数（含自己）」，
 * 队长本人是队伍第 1 人，因此 memberCount = 1 + TeamMember 行数。
 */
function memberCount(rows: number): number {
  return 1 + rows;
}

/** 帖子的招募截止已过（B3）：公开发现流不再展示，避免「招募中」列表出现僵尸帖 */
function deadlinePassed(deadline: Date | null, now: Date): boolean {
  return deadline != null && deadline < now;
}

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

  /**
   * 公开发现列表（2026-09-27 可见性收敛 Issue 4）：
   * 只返回「招募中」的帖子 —— FULL / COMPETING / DISBANDED 一律不出现，
   * 前端也不再提供勾选展示其他状态的入口。
   * 招募截止已过的 RECRUITING 帖同样不出现在默认流（B3：陈旧帖子破坏可信度）。
   */
  async list(q: {
    competitionId?: string;
    roles?: RoleType[];
    goal?: TeamGoal;
    sort?: 'DEADLINE' | 'LATEST';
    /** 发布日期范围（含边界，ISO 字符串） */
    postedFrom?: string;
    postedTo?: string;
    page: number;
    pageSize: number;
  }) {
    const now = new Date();

    const where: Prisma.TeamWhereInput = {
      status: TeamStatus.RECRUITING,
      competition: { status: 'PUBLISHED' },
      OR: [{ deadline: null }, { deadline: { gte: now } }],
      ...(q.competitionId ? { competitionId: q.competitionId } : {}),
      ...(q.goal ? { goal: q.goal } : {}),
      // 招募方向：帖子的 neededRoles 标签命中即可
      ...(q.roles?.length ? { neededRoles: { hasSome: q.roles } } : {}),
      // 发布日期范围（postedTo 按「当天 23:59:59」闭包）
      ...(q.postedFrom || q.postedTo
        ? {
            createdAt: {
              ...(q.postedFrom ? { gte: new Date(q.postedFrom) } : {}),
              ...(q.postedTo ? { lte: new Date(new Date(q.postedTo).getTime() + 24 * 3600_000 - 1) } : {}),
            },
          }
        : {}),
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
          _count: { select: { members: true, intents: true } },
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
        expired: deadlinePassed(t.deadline, now),
        targetSize: t.targetSize,
        memberCount: memberCount(t._count.members),
        intentCount: t._count.intents,
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

  /**
   * 帖子详情。游客可访问（公开壳：状态/方向/人数/意愿计数），但「招募正文」分层：
   * - 联系方式：仅队长 / 管理员 / 已登记组队意愿的用户可见（Issue 1）
   * - requirement 与成员名单：登录用户可见（A3：招募正文不向互联网公开）
   * - 非 RECRUITING 帖子（FULL/COMPETING/DISBANDED）：仅发布者本人与管理员可访问，
   *   其他人按「不存在」处理（Issue 4，不暴露帖子存在性）
   */
  async detail(id: string, viewerId?: string, viewerRole?: string) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        competition: { include: { levels: true } },
        leader: { select: SAFE_USER_SELECT },
        members: { orderBy: { createdAt: 'asc' } },
        _count: { select: { members: true, intents: true } },
      },
    });
    if (!team) throw new NotFoundException('招募帖不存在');

    const isLeader = viewerId != null && team.leaderId === viewerId;
    const isAdmin = viewerRole === 'ADMIN';

    // Issue 4：非招募中帖子的直链访问收敛到发布者与管理员
    if (team.status !== TeamStatus.RECRUITING && !isLeader && !isAdmin) {
      throw new NotFoundException('招募帖不存在');
    }

    let hasIntent = false;
    if (viewerId != null && !isLeader) {
      hasIntent = !!(await this.prisma.teamIntent.findUnique({
        where: { teamId_userId: { teamId: id, userId: viewerId } },
        select: { teamId: true },
      }));
    }
    // 联系方式解锁：队长 / 管理员 / 已登记意愿的登录用户
    const contactUnlocked = isLeader || isAdmin || hasIntent;
    const loggedIn = viewerId != null;
    const commentCounts = await this.commentCounts([team.id]);

    return {
      id: team.id,
      goal: team.goal,
      status: team.status,
      neededRoles: team.neededRoles,
      // 招募正文：游客不可见（A3 边界：招募信息校园账号登录后可见）
      requirement: loggedIn ? team.requirement : null,
      // Issue 1：未解锁时联系方式不下发（服务端实施，不靠前端遮挡）
      qq: contactUnlocked ? team.qq : null,
      wechat: contactUnlocked ? team.wechat : null,
      contactUnlocked,
      deadline: team.deadline,
      expired: deadlinePassed(team.deadline, new Date()),
      targetSize: team.targetSize,
      memberCount: memberCount(team._count.members),
      intentCount: team._count.intents,
      members: loggedIn
        ? team.members.map((m) => ({
            id: m.id,
            grade: m.grade,
            college: m.college,
            major: m.major,
            rank: m.rank,
            intro: m.intro,
          }))
        : [],
      commentCount: commentCounts.get(team.id) ?? 0,
      createdAt: team.createdAt,
      competition: {
        id: team.competition.id,
        name: team.competition.name,
        levels: team.competition.levels.map((l) => l.level),
        officialUrl: team.competition.officialUrl,
      },
      leader: loggedIn ? this.serialize(team.leader) : null,
      viewer: { isLeader, isAdmin, hasIntent },
    };
  }

  // ==================================================================
  // 组队意愿（Issue 1）
  // ==================================================================

  /**
   * 登记「我想组队」：一人一帖只计一次（数据库唯一约束兜底），重复调用幂等。
   * 同时给招募人发一条聚合站内消息：同一帖子未读消息只更新计数，不刷屏。
   */
  async registerIntent(teamId: string, userId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, leaderId: true, status: true, competition: { select: { name: true } } },
    });
    if (!team) throw new NotFoundException('招募帖不存在');
    if (team.status !== TeamStatus.RECRUITING) throw new BadRequestException('该帖子当前不在招募中');
    if (team.leaderId === userId) throw new BadRequestException('不能对自己的帖子登记组队意愿');

    try {
      await this.prisma.teamIntent.create({ data: { teamId, userId } });
    } catch (e) {
      // 唯一键冲突：已登记过，视为幂等成功
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }

    const count = await this.prisma.teamIntent.count({ where: { teamId } });
    await this.notifyLeaderIntent(team.leaderId, teamId, team.competition.name, count);
    return { hasIntent: true, intentCount: count };
  }

  /** 撤销组队意愿；同步把招募人未读消息的计数减下来（减到 0 则移除消息） */
  async revokeIntent(teamId: string, userId: string) {
    await this.prisma.teamIntent.deleteMany({ where: { teamId, userId } });
    const count = await this.prisma.teamIntent.count({ where: { teamId } });

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { leaderId: true },
    });
    if (team) await this.syncLeaderIntentCount(team.leaderId, teamId, count);

    return { hasIntent: false, intentCount: count };
  }

  /**
   * 聚合通知：同一 (leader, team) 只保留一条未读消息，反复更新计数与时间；
   * 已读之后再有意愿则新建一条（保留已读历史）。
   */
  private async notifyLeaderIntent(leaderId: string, teamId: string, competitionName: string, count: number) {
    const unread = await this.prisma.notification.findFirst({
      where: {
        userId: leaderId,
        kind: NotificationKind.TEAM_INTENT,
        readAt: null,
        payload: { path: ['teamId'], equals: teamId },
      },
      orderBy: { createdAt: 'desc' },
    });
    const payload: Prisma.InputJsonValue = {
      teamId,
      competitionName,
      count,
      message: `「${competitionName}」的招募帖已有 ${count} 人登记组队意愿`,
    };
    if (unread) {
      await this.prisma.notification.update({
        where: { id: unread.id },
        data: { payload, createdAt: new Date() },
      });
      return;
    }
    await this.notify.notify(leaderId, NotificationKind.TEAM_INTENT, payload);
  }

  /** 撤销意愿时同步未读消息计数；计数归零直接移除该条未读消息 */
  private async syncLeaderIntentCount(leaderId: string, teamId: string, count: number) {
    const unread = await this.prisma.notification.findFirst({
      where: {
        userId: leaderId,
        kind: NotificationKind.TEAM_INTENT,
        readAt: null,
        payload: { path: ['teamId'], equals: teamId },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!unread) return;
    if (count <= 0) {
      await this.prisma.notification.delete({ where: { id: unread.id } });
      return;
    }
    const p = (unread.payload ?? {}) as Record<string, unknown>;
    await this.prisma.notification.update({
      where: { id: unread.id },
      data: {
        payload: { ...p, count, message: `「${String(p.competitionName ?? '')}」的招募帖已有 ${count} 人登记组队意愿` },
        createdAt: new Date(),
      },
    });
  }

  // ==================================================================
  // 发布 / 编辑
  // ==================================================================

  async create(leaderId: string, input: UpsertTeamInput) {
    const { qq, wechat } = this.assertContacts(input.qq, input.wechat);
    const neededRoles = this.normalizeRoles(input.neededRoles);

    const competitionId = await this.resolveCompetition(input);

    // 招募截止默认填竞赛报名截止时间
    let deadline = input.deadline ?? null;
    if (!deadline) {
      const signup = await this.prisma.competitionTimeline.findFirst({
        where: { competitionId, stage: { contains: '报名' }, endAt: { gt: new Date() } },
        orderBy: { endAt: 'asc' },
      });
      deadline = signup?.endAt ?? null;
    }

    const team = await this.prisma.team.create({
      data: {
        competitionId,
        leaderId,
        goal: input.goal,
        neededRoles,
        requirement: input.requirement?.trim() || null,
        qq,
        wechat,
        deadline,
        targetSize: this.normalizeTargetSize(input.targetSize),
        members: { create: this.normalizeMembers(input.members) },
      },
    });
    return team;
  }

  async update(actorId: string, teamId: string, input: UpsertTeamInput) {
    const team = await this.mustOwn(actorId, teamId);
    if (team.status === TeamStatus.DISBANDED) throw new BadRequestException('帖子已解散归档，不能编辑');

    // 联系方式：任一字段提交即整体校验（与存量合并后仍需至少一项）
    let contacts: { qq: string | null; wechat: string | null } | undefined;
    if (input.qq !== undefined || input.wechat !== undefined) {
      contacts = this.assertContacts(
        input.qq !== undefined ? input.qq : team.qq,
        input.wechat !== undefined ? input.wechat : team.wechat,
      );
    }
    const neededRoles = input.neededRoles !== undefined ? this.normalizeRoles(input.neededRoles) : undefined;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.team.update({
        where: { id: teamId },
        data: {
          ...(input.goal ? { goal: input.goal } : {}),
          ...(neededRoles ? { neededRoles } : {}),
          // requirement 允许显式 null（清空）；?.trim() 防 null 触发 TypeError
          ...(input.requirement !== undefined ? { requirement: input.requirement?.trim() || null } : {}),
          ...(contacts !== undefined ? { qq: contacts.qq, wechat: contacts.wechat } : {}),
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

  /** 我的招募帖：全部状态可见可管理（含已解散的归档仓库） */
  async myTeams(userId: string) {
    const rows = await this.prisma.team.findMany({
      where: { leaderId: userId },
      include: {
        competition: { select: { id: true, name: true } },
        leader: { select: SAFE_USER_SELECT },
        _count: { select: { members: true, intents: true } },
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
      expired: deadlinePassed(t.deadline, now),
      targetSize: t.targetSize,
      memberCount: memberCount(t._count.members),
      intentCount: t._count.intents,
      commentCount: commentCounts.get(t.id) ?? 0,
      createdAt: t.createdAt,
      competition: { id: t.competition.id, name: t.competition.name },
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

  /**
   * 选择竞赛或手动填写竞赛名（二选一）；手动填写时按名称自动建档（当年届次）。
   * 2026-09-27 产品确认：用户手动建档**免审核、即时发布**（PUBLISHED），
   * 仅通知管理员知悉；命中同届同名的历史 DRAFT 档案时一并转为发布。
   * 唯一索引为 (name, year)：并发建档撞 P2002 时回退取当年已存在的那条。
   */
  private async resolveCompetition(input: UpsertTeamInput): Promise<string> {
    let competitionId = input.competitionId;
    if (!competitionId && input.competitionName?.trim()) {
      const name = input.competitionName.trim().slice(0, 120);
      const year = new Date().getFullYear();
      const existing = await this.prisma.competition.findFirst({ where: { name, year } });
      if (existing) {
        competitionId = existing.id;
        if (existing.status === 'DRAFT') {
          await this.prisma.competition.update({
            where: { id: existing.id },
            data: { status: 'PUBLISHED' },
          });
        }
      } else {
        let createdId: string | undefined;
        try {
          const created = await this.prisma.competition.create({
            data: { name, year, sourceUrl: '用户手动填写', status: 'PUBLISHED' },
          });
          createdId = created.id;
        } catch (e) {
          // 唯一索引冲突：另一个请求刚建了同届同名竞赛，回退取它
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            const dup = await this.prisma.competition.findFirst({ where: { name, year } });
            if (!dup) throw e;
            createdId = dup.id;
          } else {
            throw e;
          }
        }
        competitionId = createdId;

        // 知会全体管理员（免审核策略下的建档留痕，仅通知不阻塞发布）
        const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
        await this.notify.notifyMany(
          admins.map((a) => a.id),
          NotificationKind.CRAWL_ANOMALY,
          {
            competitionId,
            name,
            rule: 'USER_CREATED_COMPETITION',
            message: `用户手动建档竞赛「${name}」（${year} 届），已即时发布`,
          },
        );
      }
    }
    if (!competitionId) throw new BadRequestException('请选择竞赛或手动填写竞赛名称');

    const competition = await this.prisma.competition.findUnique({ where: { id: competitionId } });
    if (!competition || competition.status === 'ARCHIVED') throw new NotFoundException('竞赛不存在或已下线');
    return competitionId;
  }

  /** QQ / 微信两个属性，至少填写一项；返回入库用的 trim 结果 */
  private assertContacts(qq?: string | null, wechat?: string | null): { qq: string | null; wechat: string | null } {
    const q = qq?.trim() || null;
    const w = wechat?.trim() || null;
    if (!q && !w) throw new BadRequestException('请至少填写一项联系方式（QQ / 微信），感兴趣的同学需要直接联系你');
    if (q && q.length > 64) throw new BadRequestException('QQ 号最长 64 字');
    if (w && w.length > 64) throw new BadRequestException('微信号最长 64 字');
    return { qq: q, wechat: w };
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
