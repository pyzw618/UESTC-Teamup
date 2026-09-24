import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export interface ListCompetitionsQuery {
  q?: string;
  levels?: string[];
  tags?: string[];
  audience?: string;
  format?: string;
  bonusOnly?: boolean;
  status?: 'OPEN' | 'UPCOMING' | 'ENDED';
  sort?: 'DEADLINE' | 'LATEST' | 'DIFFICULTY' | 'HOT';
  page: number;
  pageSize: number;
}

const listInclude = {
  levels: true,
  tags: true,
  timelines: { orderBy: { startAt: 'asc' as const } },
  _count: { select: { teams: { where: { status: 'RECRUITING' as const } } } },
};

type ListRow = Prisma.CompetitionGetPayload<{ include: typeof listInclude }>;

/** 报名截止：时间轴里最近一个「报名」节点的 endAt（须在未来） */
export function nextSignupDeadline(
  timelines: { stage: string | null; endAt: Date | null }[],
  now = new Date(),
): Date | null {
  return (
    timelines
      .filter((t) => (t.stage ?? '').includes('报名') && t.endAt && t.endAt > now)
      .sort((a, b) => a.endAt!.getTime() - b.endAt!.getTime())[0]?.endAt ?? null
  );
}

/** 给列表项附加计算字段 */
export function decorateListItem(row: ListRow, now = new Date()) {
  const nextDeadline = nextSignupDeadline(row.timelines, now);

  const hasFuture = row.timelines.some((t) => (t.endAt && t.endAt > now) || (t.startAt && t.startAt > now));
  const hasAny = row.timelines.length > 0;
  const status = !hasAny ? 'UNKNOWN' : hasFuture ? (nextDeadline ? 'OPEN' : 'UPCOMING') : 'ENDED';

  return {
    id: row.id,
    name: row.name,
    organizer: row.organizer,
    format: row.format,
    audience: row.audience,
    difficulty: row.difficulty,
    effort: row.effort,
    isBonusEligible: row.isBonusEligible,
    bonusCategory: row.bonusCategory,
    bonusPoints: row.bonusPoints,
    levels: row.levels.map((l) => l.level),
    tags: row.tags.map((t) => t.tag),
    recruitingTeams: row._count.teams,
    nextDeadline,
    status,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class CompetitionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListCompetitionsQuery) {
    const now = new Date();
    const where: Prisma.CompetitionWhereInput = { status: 'PUBLISHED' };

    if (query.q) {
      where.OR = [{ name: { contains: query.q } }, { aliases: { has: query.q } }];
    }
    if (query.levels?.length) where.levels = { some: { level: { in: query.levels as never[] } } };
    if (query.tags?.length) where.tags = { some: { tag: { in: query.tags } } };
    if (query.audience) where.audience = query.audience as never;
    if (query.format) where.format = query.format as never;
    if (query.bonusOnly) where.isBonusEligible = true;

    // 状态筛选：基于时间轴推导
    if (query.status) {
      const futureDeadline = { timelines: { some: { endAt: { gt: now }, stage: { contains: '报名' } } } };
      const futureAny = { timelines: { some: { OR: [{ endAt: { gt: now } }, { startAt: { gt: now } }] } } };
      const allPast = {
        timelines: { none: { OR: [{ endAt: { gt: now } }, { startAt: { gt: now } }] } },
        NOT: { timelines: { none: {} } },
      };
      if (query.status === 'OPEN') where.AND = [futureDeadline];
      else if (query.status === 'UPCOMING') where.AND = [futureAny, { NOT: futureDeadline }];
      else if (query.status === 'ENDED') where.AND = [allPast];
    }

    // DEADLINE 排序键是时间轴派生值，数据库排不了：
    // 全量取候选 → 内存算 nextDeadline / 过滤 / 排序 → 按页切片 → 仅对当页批量取完整数据。
    // 竞赛总量百级，全量可接受；保证 total 与 items 一致、跨页顺序稳定、页码可用。
    if (query.sort === 'DEADLINE') return this.listByDeadline(query, where, now);

    const orderBy: Prisma.CompetitionOrderByWithRelationInput[] = [];
    switch (query.sort) {
      case 'DIFFICULTY':
        orderBy.push({ difficulty: 'desc' });
        break;
      case 'HOT':
        orderBy.push({ teams: { _count: 'desc' } });
        break;
      default:
        orderBy.push({ updatedAt: 'desc' });
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.competition.findMany({
        where,
        include: listInclude,
        orderBy: orderBy.length ? orderBy : [{ updatedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.competition.count({ where }),
    ]);

    return {
      items: rows.map((r) => decorateListItem(r, now)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 报名截止升序分页：total 与 items 同源（都基于过滤后的 nextDeadline 集合） */
  private async listByDeadline(
    query: ListCompetitionsQuery,
    where: Prisma.CompetitionWhereInput,
    now: Date,
  ) {
    const candidates = await this.prisma.competition.findMany({
      where,
      select: { id: true, timelines: { select: { stage: true, endAt: true } } },
    });

    const ranked = candidates
      .map((c) => ({ id: c.id, nextDeadline: nextSignupDeadline(c.timelines, now) }))
      .filter((c): c is { id: string; nextDeadline: Date } => c.nextDeadline != null)
      .sort((a, b) => a.nextDeadline.getTime() - b.nextDeadline.getTime());

    const total = ranked.length;
    const pageIds = ranked
      .slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
      .map((c) => c.id);

    const rows = pageIds.length
      ? await this.prisma.competition.findMany({ where: { id: { in: pageIds } }, include: listInclude })
      : [];
    const order = new Map(pageIds.map((id, i) => [id, i]));
    const items = rows
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
      .map((r) => decorateListItem(r, now));

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** 详情：全区块数据 + 正在招募的队伍（双向联动另一半） */
  async detail(id: string) {
    const row = await this.prisma.competition.findUnique({
      where: { id },
      include: {
        levels: true,
        tags: true,
        timelines: { orderBy: { startAt: 'asc' } },
        awards: { orderBy: { year: 'desc' } },
        materials: true,
      },
    });
    if (!row || row.status === 'ARCHIVED') throw new NotFoundException('竞赛不存在或已下线');

    // “正在招募”只统计 RECRUITING
    const recruitingTeams = await this.prisma.team.findMany({
      where: { competitionId: id, status: 'RECRUITING' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        goal: true,
        status: true,
        deadline: true,
        neededRoles: true,
        targetSize: true,
        leader: {
          select: {
            id: true,
            nickname: true,
            college: true,
            grade: true,
            major: true,
            bio: true,
            studentNo: true,
          },
        },
        _count: { select: { members: true } },
      },
    });

    return {
      ...row,
      levels: row.levels.map((l) => l.level),
      tags: row.tags.map((t) => t.tag),
      recruitingTeams,
    };
  }

  /** 首页聚合数据 */
  async home(userId?: string) {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86400_000);

    const [deadlines, hotTeams, bonus, byLevel] = await this.prisma.$transaction([
      // 近期 DDL：未来 30 天报名截止，升序
      this.prisma.competitionTimeline.findMany({
        where: { endAt: { gte: now, lte: in30 }, stage: { contains: '报名' }, competition: { status: 'PUBLISHED' } },
        orderBy: { endAt: 'asc' },
        take: 8,
        include: {
          competition: {
            select: { id: true, name: true, levels: true },
          },
        },
      }),
      // 热招帖子
      this.prisma.team.findMany({
        where: { status: 'RECRUITING', competition: { status: 'PUBLISHED' } },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          goal: true,
          status: true,
          deadline: true,
          neededRoles: true,
          createdAt: true,
          competition: { select: { id: true, name: true } },
          leader: { select: { id: true, nickname: true, college: true, grade: true } },
        },
      }),
      // 只看能加分的比赛（核心入口）
      this.prisma.competition.findMany({
        where: { status: 'PUBLISHED', isBonusEligible: true },
        orderBy: { updatedAt: 'desc' },
        take: 6,
        include: { levels: true, tags: true },
      }),
      this.prisma.competitionLevel.groupBy({
        by: ['level'],
        _count: { _all: true },
        where: { competition: { status: 'PUBLISHED' } },
        orderBy: { level: 'asc' },
      }),
    ]);

    return {
      deadlines: deadlines.map((t) => ({
        competitionId: t.competition.id,
        competitionName: t.competition.name,
        levels: t.competition.levels.map((l) => l.level),
        stage: t.stage,
        endAt: t.endAt,
        daysLeft: Math.ceil((t.endAt!.getTime() - now.getTime()) / 86400_000),
      })),
      // 队友招募信息仅登录可见：游客拿到空数组，前端展示磨砂玻璃提示
      hotTeams: userId ? hotTeams : [],
      bonusCompetitions: bonus.map((c) => ({
        id: c.id,
        name: c.name,
        bonusCategory: c.bonusCategory,
        bonusPoints: c.bonusPoints,
        levels: c.levels.map((l) => l.level),
        tags: c.tags.map((t) => t.tag),
      })),
      levelCounts: Object.fromEntries(
        byLevel.map((g) => [g.level, (g._count as unknown as { _all: number })._all]),
      ),
      recommend: userId ? await this.recommendFor(userId) : [],
    };
  }

  /** 规则筛选（非算法推荐）：按学院/年级/学科标签匹配（README 决策） */
  async recommendFor(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { skills: true },
    });
    if (!user) return [];
    const now = new Date();

    const where: Prisma.CompetitionWhereInput = {
      status: 'PUBLISHED',
      timelines: { some: { endAt: { gt: now } } },
    };
    // 年级匹配：本科生优先推 MIXED/UNDERGRAD；研究生同理
    if (user.grade) {
      const isPostgrad = user.grade <= new Date().getFullYear() - 4; // 粗略：入学超 4 年视为研究生概率高
      where.audience = isPostgrad ? { in: ['POSTGRAD', 'MIXED'] } : { in: ['UNDERGRAD', 'MIXED'] };
    }

    const rows = await this.prisma.competition.findMany({ where, include: { levels: true, tags: true }, take: 6 });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      levels: r.levels.map((l) => l.level),
      tags: r.tags.map((t) => t.tag),
      reason: '按你的年级筛选',
    }));
  }
}
