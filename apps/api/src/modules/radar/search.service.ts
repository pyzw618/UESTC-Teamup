import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/**
 * 统一搜索（P1）：竞赛名/别名。ILIKE 粗筛 + pg_trgm 相似度排序。
 * 中文分词可用 zhparser 增强，当前用 trgm 已可满足"输入竞赛名片段"场景。
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: string, kind = 'competition') {
    const query = (q ?? '').trim();
    if (query.length < 1) return { competitions: [] };

    if (kind === 'competition') {
      // 先 trgm 相似度找近似名，再 ILIKE 补充（保证部分匹配也命中）
      const similar = await this.prisma.$queryRaw<{ id: string; similarity: number }[]>`
        SELECT id, similarity(name, ${query}) AS similarity
        FROM "Competition"
        WHERE status = 'PUBLISHED' AND name % ${query}
        ORDER BY similarity DESC
        LIMIT 10`;
      const likeRows = await this.prisma.competition.findMany({
        where: {
          status: 'PUBLISHED',
          OR: [{ name: { contains: query } }, { aliases: { has: query } }, { aliases: { hasSome: [query] } }],
        },
        select: { id: true },
        take: 10,
      });

      const ids = [...new Set([...similar.map((s) => s.id), ...likeRows.map((r) => r.id)])].slice(0, 15);
      if (ids.length === 0) return { competitions: [] };

      const rows = await this.prisma.competition.findMany({
        where: { id: { in: ids } },
        include: { levels: true, tags: true, _count: { select: { teams: { where: { status: 'RECRUITING' } } } } },
      });
      const order = new Map(ids.map((id, i) => [id, i]));
      const competitions = rows
        .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
        .map((c) => ({
          id: c.id,
          name: c.name,
          organizer: c.organizer,
          levels: c.levels.map((l) => l.level),
          tags: c.tags.map((t) => t.tag),
          recruitingTeams: c._count.teams,
        }));
      return { competitions };
    }

    return { competitions: [] };
  }
}

// 保留 Prisma 引用，避免未使用报错
void Prisma;
