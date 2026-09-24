import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import type {
  CompetitionCandidate,
  CompetitionMatchDecision,
} from './crawler.types';

const DEFAULT_SIMILARITY_THRESHOLD = 0.76;

export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^\s*关于\s*/u, '')
    .replace(/(?:19|20)\d{2}\s*年?/g, '')
    .replace(/\b(?:19|20)\d{2}\b/g, '')
    .replace(/第\s*[0-9一二三四五六七八九十百零〇]+\s*(?:届|季|轮|期|次)/gu, '')
    .replace(/(?:校内选拔赛|选拔赛|校内赛|校赛)/gu, '')
    .replace(/\s*的通知\s*$/u, '')
    .replace(/\s*(?:报名|参赛|参赛选拔|初赛|决赛|校内选拔)?\s*(?:通知|公告|启事|通告)\s*$/u, '')
    .replace(/[“”"'‘’【】\[\]（）()《》<>：:，,。.!！?？、·—_\-]/gu, '')
    .replace(/\s+/g, '')
    .trim();
}

function bigrams(value: string): string[] {
  if (value.length < 2) return value ? [value] : [];
  const result: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    result.push(value.slice(index, index + 2));
  }
  return result;
}

export function textSimilarity(left: string, right: string): number {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const leftBigrams = bigrams(a);
  const rightBigrams = bigrams(b);
  const counts = new Map<string, number>();
  for (const gram of leftBigrams) counts.set(gram, (counts.get(gram) ?? 0) + 1);

  let overlap = 0;
  for (const gram of rightBigrams) {
    const count = counts.get(gram) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(gram, count - 1);
    }
  }

  return (2 * overlap) / (leftBigrams.length + rightBigrams.length);
}

export function matchCompetition(
  title: string,
  candidates: CompetitionCandidate[],
  threshold = DEFAULT_SIMILARITY_THRESHOLD,
): CompetitionMatchDecision {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) {
    return { action: 'CREATE_DRAFT', competitionId: null, score: 0, matchedBy: 'none' };
  }

  for (const candidate of candidates) {
    if (normalizeTitle(candidate.name) === normalizedTitle) {
      return {
        action: 'UPDATE',
        competitionId: candidate.id,
        score: 1,
        matchedBy: 'name',
      };
    }
    if (candidate.aliases.some((alias) => normalizeTitle(alias) === normalizedTitle)) {
      return {
        action: 'UPDATE',
        competitionId: candidate.id,
        score: 1,
        matchedBy: 'alias',
      };
    }
  }

  let best: { candidate: CompetitionCandidate; score: number } | null = null;
  for (const candidate of candidates) {
    const score = Math.max(
      textSimilarity(title, candidate.name),
      ...candidate.aliases.map((alias) => textSimilarity(title, alias)),
    );
    if (!best || score > best.score) best = { candidate, score };
  }

  if (best && best.score >= threshold) {
    return {
      action: 'UPDATE',
      competitionId: best.candidate.id,
      score: best.score,
      matchedBy: 'similarity',
    };
  }

  return { action: 'CREATE_DRAFT', competitionId: null, score: best?.score ?? 0, matchedBy: 'none' };
}

@Injectable()
export class MatcherService {
  constructor(private readonly prisma: PrismaService) {}

  async match(title: string): Promise<CompetitionMatchDecision> {
    const rows = await this.prisma.competition.findMany({
      where: { status: { not: 'ARCHIVED' } },
      select: { id: true, name: true, aliases: true },
    });
    return matchCompetition(title, rows);
  }
}
