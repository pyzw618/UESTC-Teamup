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

/** 给列表项附加计算字段 */
export function decorateListItem(row: ListRow, now = new Date()) {
  const nextDeadline = row.timelines
    .filter((t) => (t.stage ?? '').includes('报名') && t.endAt && t.endAt > now)
    .sort((a, b) => (a.endAt!.getTime() ?? 0) - (b.endAt!.getTime() ?? 0))[0];

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
    nextDeadline: nextDeadline?.endAt ?? null,
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

    const orderBy: Prisma.CompetitionOrderByWithRelationInput[] = [];
    switch (query.sort) {
      case 'DIFFICULTY':
        orderBy.push({ difficulty: 'desc' });
        break;
      case 'HOT':
        orderBy.push({ teams: { _count: 'desc' } });
        break;
      case 'DEADLINE':
        break; // 内存中按 nextDeadline 排
      default:
        orderBy.push({ updatedAt: 'desc' });
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.competition.findMany({
        where,
        include: listInclude,
        orderBy: orderBy.length ? orderBy : [{ updatedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize * 4, // DEADLINE 排序需要多一点候选
      }),
      this.prisma.competition.count({ where }),
    ]);

    let items = rows.map((r) => decorateListItem(r, now));
    if (query.sort === 'DEADLINE') {
      items = items
        .filter((i) => i.nextDeadline)
        .sort((a, b) => a.nextDeadline!.getTime() - b.nextDeadline!.getTime())
        .slice(0, query.pageSize);
    }

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

    const recruitingTeams = await this.prisma.team.findMany({
      where: { competitionId: id, status: { in: ['RECRUITING', 'NEGOTIATING'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        leader: { include: { memberships: { select: { teamId: true } } } },
        slots: true,
        members: true,
        _count: { select: { applications: { where: { status: 'PENDING' } } } },
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
      // 热招队伍
      this.prisma.team.findMany({
        where: { status: 'RECRUITING', competition: { status: 'PUBLISHED' } },
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: {
          competition: { select: { id: true, name: true } },
          leader: { select: { id: true, nickname: true, college: true, grade: true } },
          slots: true,
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
