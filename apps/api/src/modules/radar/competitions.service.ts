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
  /** 竞赛类别（校教〔2026〕39号口径）：学科竞赛 / 文体竞赛 */
  category?: string;
  status?: 'OPEN' | 'UPCOMING' | 'ENDED';
  /** CATALOG = 认定文件顺序（默认，学科在前文体在后） */
  sort?: 'DEADLINE' | 'LATEST' | 'DIFFICULTY' | 'HOT' | 'CATALOG';
  /** 届次年份：缺省 = 当前年份 */
  year?: number;
  page: number;
  pageSize: number;
}

/** 列表 include：招募队伍计数与详情页同口径（只排除已归档帖子，不按时间自动失效） */
const listInclude = (now: Date) => ({
  levels: true,
  tags: true,
  events: { select: { id: true, nodeType: true, startAt: true, endAt: true } },
  _count: {
    select: {
      teams: { where: { status: { not: 'DISBANDED' as const } } },
    },
  },
});

type ListRow = Prisma.CompetitionGetPayload<{ include: ReturnType<typeof listInclude> }>;

/** 报名截止：最近一个「报名截止」节点且仍在未来 */
export function nextSignupDeadline(
  events: { nodeType: string; endAt: Date | null }[],
  now = new Date(),
): Date | null {
  return (
    events
      .filter((e) => e.nodeType === 'SIGNUP_END' && e.endAt && e.endAt > now)
      .sort((a, b) => a.endAt!.getTime() - b.endAt!.getTime())[0]?.endAt ?? null
  );
}

/** 给列表项附加计算字段 */
export function decorateListItem(row: ListRow, now = new Date()) {
  const nextDeadline = nextSignupDeadline(row.events, now);

  const hasFuture = row.events.some((e) => (e.endAt && e.endAt > now) || (e.startAt && e.startAt > now));
  const hasAny = row.events.length > 0;
  const status = !hasAny ? 'UNKNOWN' : hasFuture ? (nextDeadline ? 'OPEN' : 'UPCOMING') : 'ENDED';

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    year: row.year,
    organizer: row.organizer,
    format: row.format,
    audience: row.audience,
    difficulty: row.difficulty,
    effort: row.effort,
    hasTracks: row.hasTracks,
    stageChain: row.stageChain,
    isBonusEligible: row.isBonusEligible,
    bonusCategory: row.bonusCategory,
    levels: row.levels.map((l) => l.level),
    tags: row.tags.map((t) => t.tag),
    recruitingTeams: row._count.teams,
    nextDeadline,
    status,
    updatedAt: row.updatedAt,
  };
}

/** 列表默认展示的届次：当前年份（跨年后历史数据不与当年混排） */
export function currentEditionYear(): number {
  return new Date().getFullYear();
}

@Injectable()
export class CompetitionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListCompetitionsQuery) {
    const now = new Date();
    const where: Prisma.CompetitionWhereInput = {
      status: 'PUBLISHED',
      // 届次筛选：默认当前年份；前端提供年份切换查看历史届次
      year: query.year ?? currentEditionYear(),
    };

    if (query.q) {
      where.OR = [{ name: { contains: query.q } }, { aliases: { has: query.q } }];
    }
    if (query.levels?.length) where.levels = { some: { level: { in: query.levels as never[] } } };
    if (query.tags?.length) where.tags = { some: { tag: { in: query.tags } } };
    if (query.audience) where.audience = query.audience as never;
    if (query.format) where.format = query.format as never;
    if (query.bonusOnly) where.isBonusEligible = true;
    if (query.category) where.bonusCategory = query.category;

    // 状态筛选：基于时间节点推导
    if (query.status) {
      const futureDeadline = { events: { some: { endAt: { gt: now }, nodeType: 'SIGNUP_END' as const } } };
      const futureAny = { events: { some: { OR: [{ endAt: { gt: now } }, { startAt: { gt: now } }] } } };
      const allPast = {
        events: { none: { OR: [{ endAt: { gt: now } }, { startAt: { gt: now } }] } },
        NOT: { events: { none: {} } },
      };
      if (query.status === 'OPEN') where.AND = [futureDeadline];
      else if (query.status === 'UPCOMING') where.AND = [futureAny, { NOT: futureDeadline }];
      else if (query.status === 'ENDED') where.AND = [allPast];
    }

    // DEADLINE 排序键是节点派生值，数据库排不了：
    // 全量取候选 → 内存算 nextDeadline / 过滤 / 排序 → 按页切片 → 仅对当页批量取完整数据。
    if (query.sort === 'DEADLINE') return this.listByDeadline(query, where, now);

    const orderBy: Prisma.CompetitionOrderByWithRelationInput[] = [];
    switch (query.sort) {
      case 'DIFFICULTY':
        orderBy.push({ difficulty: 'desc' });
        break;
      case 'HOT':
        orderBy.push({ teams: { _count: 'desc' } });
        break;
      case 'LATEST':
        orderBy.push({ updatedAt: 'desc' });
        break;
      default:
        // 认定文件顺序（默认）：种子按校教〔2026〕39号文顺序逐条写入，
        // createdAt 随插入单调递增 → createdAt asc 即文件顺序（学科竞赛在前、文体竞赛在后）；
        // 用户/管理员新建的竞赛 createdAt 更晚，自然排在末尾。id 作次级键保证分页稳定。
        orderBy.push({ createdAt: 'asc' }, { id: 'asc' });
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.competition.findMany({
        where,
        include: listInclude(now),
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

  /** 已收录的届次年份（降序），供列表页年份切换器 */
  async years(): Promise<number[]> {
    const rows = await this.prisma.competition.groupBy({
      by: ['year'],
      where: { status: 'PUBLISHED' },
      orderBy: { year: 'desc' },
    });
    return rows.map((r) => r.year);
  }

  /** 报名截止升序分页：total 与 items 同源（都基于过滤后的 nextDeadline 集合） */
  private async listByDeadline(
    query: ListCompetitionsQuery,
    where: Prisma.CompetitionWhereInput,
    now: Date,
  ) {
    const candidates = await this.prisma.competition.findMany({
      where,
      select: { id: true, events: { select: { nodeType: true, endAt: true } } },
    });

    const ranked = candidates
      .map((c) => ({ id: c.id, nextDeadline: nextSignupDeadline(c.events, now) }))
      .filter((c): c is { id: string; nextDeadline: Date } => c.nextDeadline != null)
      .sort((a, b) => a.nextDeadline.getTime() - b.nextDeadline.getTime());

    const total = ranked.length;
    const pageIds = ranked
      .slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
      .map((c) => c.id);

    const rows = pageIds.length
      ? await this.prisma.competition.findMany({ where: { id: { in: pageIds } }, include: listInclude(now) })
      : [];
    const order = new Map(pageIds.map((id, i) => [id, i]));
    const items = rows
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
      .map((r) => decorateListItem(r, now));

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /**
   * 详情：赛道 / 赛程阶段 / 时间节点 + 招募队伍 + 自定义字段 + 同名其他届次。
   * Issue 11：DRAFT 竞赛仅管理员可预览，普通用户与游客按「不存在」处理，
   * 避免未发布的竞赛信息（时间节点 / 奖项 / 材料）被直链读取。
   */
  async detail(id: string, viewerRole?: string) {
    const row = await this.prisma.competition.findUnique({
      where: { id },
      include: {
        levels: true,
        tags: true,
        bonusStandard: true,
        tracks: {
          orderBy: [{ sortOrder: 'asc' }],
          include: {
            stages: {
              orderBy: { sequence: 'asc' },
              include: { events: { orderBy: [{ startAt: 'asc' }, { endAt: 'asc' }] } },
            },
          },
        },
        stages: {
          where: { trackId: null },
          orderBy: { sequence: 'asc' },
          include: { events: { orderBy: [{ startAt: 'asc' }, { endAt: 'asc' }] } },
        },
        awards: { orderBy: { year: 'desc' } },
        materials: true,
        customFields: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row || row.status === 'ARCHIVED') throw new NotFoundException('竞赛不存在或已下线');
    if (row.status === 'DRAFT' && viewerRole !== 'ADMIN') throw new NotFoundException('竞赛不存在或已下线');
    const now = new Date();

    // 同名赛事的其他届次
    const editions = await this.prisma.competition.findMany({
      where: { code: row.code, status: 'PUBLISHED', id: { not: row.id } },
      select: { id: true, year: true },
      orderBy: { year: 'desc' },
    });

    // 组队帖展示口径：只排除已归档；已满员 / 历史 COMPETING 仍展示（不再按竞赛或截止时间自动失效）
    // 列表仅展示前 20 条，总量由独立 count 提供（Issue 17：数组长度 ≠ 总量）
    const recruitingWhere = {
      competitionId: id,
      status: { not: 'DISBANDED' as const },
    };
    const [recruitingTeams, recruitingTeamsCount] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        where: recruitingWhere,
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
          _count: { select: { members: true, intents: true } },
        },
      }),
      this.prisma.team.count({ where: recruitingWhere }),
    ]);

    // 共享阶段（trackId = null）与赛道专属阶段合并成前端易消费的结构
    const tracks = row.tracks.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      shortName: t.shortName,
      description: t.description,
      sortOrder: t.sortOrder,
      parentId: t.parentId,
      format: t.format ?? row.format,
      teamSizeMin: t.teamSizeMin ?? row.teamSizeMin,
      teamSizeMax: t.teamSizeMax ?? row.teamSizeMax,
      stages: t.stages.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        stageKind: s.stageKind,
        scope: s.scope,
        sequence: s.sequence,
        bonusTier: s.bonusTier,
        note: s.note,
        events: s.events,
      })),
    }));

    const sharedStages = row.stages.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      stageKind: s.stageKind,
      scope: s.scope,
      sequence: s.sequence,
      bonusTier: s.bonusTier,
      note: s.note,
      events: s.events,
    }));

    // 派生字段：与列表同口径的报名截止与状态（V2 事件分散在各阶段/赛道下，需合并计算）
    const allEvents = [
      ...row.stages.flatMap((s) => s.events),
      ...row.tracks.flatMap((t) => t.stages.flatMap((s) => s.events)),
    ];
    const nextDeadline = nextSignupDeadline(allEvents, now);
    const hasFuture = allEvents.some((e) => (e.endAt && e.endAt > now) || (e.startAt && e.startAt > now));
    const derivedStatus: 'OPEN' | 'UPCOMING' | 'ENDED' | 'UNKNOWN' =
      allEvents.length === 0 ? 'UNKNOWN' : hasFuture ? (nextDeadline ? 'OPEN' : 'UPCOMING') : 'ENDED';

    // 同一认定文件 + 类别下的两档加分标准（国家级 + 省级），详情页加分表按此渲染，
    // 学科竞赛与文体竞赛详情页自然各自展示本类别的分值
    const siblingStandards = row.bonusStandard
      ? await this.prisma.bonusStandard.findMany({
          where: { documentRef: row.bonusStandard.documentRef, category: row.bonusStandard.category },
        })
      : [];
    const bonusStandards = [
      ...siblingStandards.filter((s) => s.level === 'NATIONAL'),
      ...siblingStandards.filter((s) => s.level === 'PROVINCIAL'),
    ];

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      shortName: row.shortName,
      year: row.year,
      aliases: row.aliases,
      organizer: row.organizer,
      officialUrl: row.officialUrl,
      sourceUrl: row.sourceUrl,
      format: row.format,
      teamSizeMin: row.teamSizeMin,
      teamSizeMax: row.teamSizeMax,
      audience: row.audience,
      intro: row.intro,
      difficulty: row.difficulty,
      effort: row.effort,
      hasTracks: row.hasTracks,
      stageChain: row.stageChain,
      isBonusEligible: row.isBonusEligible,
      bonusCategory: row.bonusCategory,
      bonusSpecialRule: row.bonusSpecialRule,
      bonusStandard: row.bonusStandard,
      bonusStandards,
      status: derivedStatus,
      nextDeadline,
      updatedAt: row.updatedAt,
      levels: row.levels.map((l) => l.level),
      tags: row.tags.map((t) => t.tag),
      tracks,
      sharedStages,
      editions,
      awards: row.awards,
      materials: row.materials,
      customFields: row.customFields,
      recruitingTeams: recruitingTeams.map((t) => ({
        id: t.id,
        goal: t.goal,
        status: t.status,
        deadline: t.deadline,
        neededRoles: t.neededRoles,
        targetSize: t.targetSize,
        // memberCount 含队长本人，与 targetSize「计划招募人数（含自己）」同口径
        memberCount: 1 + t._count.members,
        intentCount: t._count.intents,
        leader: t.leader,
      })),
      // 独立 count，不受 take: 20 分页限制（Issue 17）
      recruitingTeamsCount,
    };
  }

  /** 首页聚合数据 */
  async home(userId?: string) {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86400_000);

    const [deadlines, hotTeams, bonus, byLevel] = await this.prisma.$transaction([
      // 近期 DDL：未来 30 天报名截止，升序
      this.prisma.competitionEvent.findMany({
        where: {
          nodeType: 'SIGNUP_END',
          endAt: { gte: now, lte: in30 },
          competition: { status: 'PUBLISHED' },
        },
        orderBy: { endAt: 'asc' },
        take: 8,
        include: {
          stage: { select: { name: true } },
          competition: {
            select: { id: true, name: true, levels: true },
          },
        },
      }),
      // 热招帖子：所有未归档的帖子，不再按招募截止时间过滤
      this.prisma.team.findMany({
        where: {
          status: { not: 'DISBANDED' },
          competition: { status: 'PUBLISHED' },
        },
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
          _count: { select: { members: true, intents: true } },
        },
      }),
      // 只看能加分的比赛（核心入口）：首页位固定展示学科竞赛，按认定文件顺序
      this.prisma.competition.findMany({
        where: {
          status: 'PUBLISHED',
          isBonusEligible: true,
          bonusCategory: '学科竞赛',
          year: currentEditionYear(),
        },
        orderBy: { createdAt: 'asc' },
        take: 6,
        include: { levels: true, tags: true },
      }),
      this.prisma.competitionLevel.groupBy({
        by: ['level'],
        _count: { _all: true },
        where: { competition: { status: 'PUBLISHED', year: currentEditionYear() } },
        orderBy: { level: 'asc' },
      }),
    ]);

    return {
      deadlines: deadlines.map((e) => ({
        competitionId: e.competition.id,
        competitionName: e.competition.name,
        levels: e.competition.levels.map((l) => l.level),
        stage: e.stage.name,
        endAt: e.endAt,
        daysLeft: Math.ceil((e.endAt!.getTime() - now.getTime()) / 86400_000),
      })),
      // 队友招募信息仅登录可见：游客拿到空数组，前端展示磨砂玻璃提示
      hotTeams: userId
        ? hotTeams.map((t) => ({
            ...t,
            memberCount: 1 + t._count.members,
            intentCount: t._count.intents,
          }))
        : [],
      bonusCompetitions: bonus.map((c) => ({
        id: c.id,
        name: c.name,
        bonusCategory: c.bonusCategory,
        levels: c.levels.map((l) => l.level),
        tags: c.tags.map((t) => t.tag),
      })),
      levelCounts: Object.fromEntries(
        byLevel.map((g) => [g.level, (g._count as unknown as { _all: number })._all]),
      ),
      recommend: userId ? await this.recommendFor(userId) : [],
    };
  }

  /** 规则筛选（非算法推荐）：按学院/年级/学科标签匹配 */
  async recommendFor(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { skills: true },
    });
    if (!user) return [];
    const now = new Date();

    const where: Prisma.CompetitionWhereInput = {
      status: 'PUBLISHED',
      year: currentEditionYear(),
      events: { some: { endAt: { gt: now } } },
    };
    // 年级匹配：本科生优先推 MIXED/UNDERGRAD；研究生同理
    if (user.grade) {
      const isPostgrad = user.grade <= new Date().getFullYear() - 4;
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
