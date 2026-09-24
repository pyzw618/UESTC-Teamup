import type { TimelineStageCandidate } from './crawler.types';

interface DateToken {
  year: number | null;
  month: number;
  day: number;
  index: number;
  end: number;
}

const DATE_TOKEN_RE =
  /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?|(?:(\d{4})\s*[./-]\s*)?(\d{1,2})\s*[./-]\s*(\d{1,2})(?:日)?/g;

function validUtcDate(year: number, month: number, day: number): Date | null {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

function toPublishDate(publishTime?: Date | string | null): Date | null {
  if (!publishTime) return null;
  const date = publishTime instanceof Date ? publishTime : new Date(publishTime);
  return Number.isNaN(date.getTime()) ? null : date;
}

function inferYear(month: number, day: number, publishTime?: Date | string | null): number | null {
  const publishDate = toPublishDate(publishTime);
  if (!publishDate) return null;

  const baseYear = publishDate.getUTCFullYear();
  const candidates = [baseYear - 1, baseYear, baseYear + 1]
    .map((year) => validUtcDate(year, month, day))
    .filter((date): date is Date => date !== null)
    .sort(
      (left, right) =>
        Math.abs(left.getTime() - publishDate.getTime()) -
        Math.abs(right.getTime() - publishDate.getTime()),
    );

  return candidates[0]?.getUTCFullYear() ?? null;
}

function readDateTokens(text: string): DateToken[] {
  const tokens: DateToken[] = [];
  DATE_TOKEN_RE.lastIndex = 0;

  for (const match of text.matchAll(DATE_TOKEN_RE)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const yearText = match[1] ?? match[4];
    const monthText = match[2] ?? match[5];
    const dayText = match[3] ?? match[6];
    if (!monthText || !dayText) continue;

    tokens.push({
      year: yearText ? Number(yearText) : null,
      month: Number(monthText),
      day: Number(dayText),
      index,
      end: index + raw.length,
    });
  }

  return tokens;
}

function resolveToken(
  token: DateToken,
  publishTime?: Date | string | null,
  fallbackYear?: number | null,
): Date | null {
  const year = token.year ?? fallbackYear ?? inferYear(token.month, token.day, publishTime);
  if (year == null) return null;
  return validUtcDate(year, token.month, token.day);
}

function isRangeConnector(value: string): boolean {
  return /^(?:\s*(?:至|到|—|–|～|~|－|-|至于|through|to)\s*)$/i.test(value);
}

export function extractDateRange(
  text: string,
  publishTime?: Date | string | null,
): { startAt: Date | null; endAt: Date | null } {
  const tokens = readDateTokens(text);
  if (!tokens.length) return { startAt: null, endAt: null };

  const first = tokens[0];
  const second = tokens[1];
  const pairIsRange =
    second !== undefined && isRangeConnector(text.slice(first.end, second.index));

  const startAt = resolveToken(first, publishTime);
  if (!pairIsRange) return { startAt, endAt: startAt };

  let endAt = resolveToken(second, publishTime, first.year);
  if (
    startAt &&
    endAt &&
    endAt.getTime() < startAt.getTime() &&
    second.year == null &&
    first.month >= 10 &&
    second.month <= 3
  ) {
    endAt = validUtcDate(endAt.getUTCFullYear() + 1, second.month, second.day);
  }

  return { startAt, endAt };
}

export function extractFirstExplicitDate(
  text: string,
  publishTime?: Date | string | null,
): Date | null {
  return extractDateRange(text, publishTime).startAt;
}

function stageName(segment: string): string | null {
  const rules: Array<[RegExp, string]> = [
    [/(报名|注册|参赛确认|报名确认)/, '报名'],
    [/(初赛|预赛|校赛|选拔赛)/, '初赛'],
    [/(复赛|半决赛|区域赛)/, '复赛'],
    [/(决赛|总决赛|全国赛)/, '决赛'],
    [/(提交|作品提交|材料提交|申报|作品上传)/, '提交'],
  ];

  for (const [pattern, name] of rules) {
    if (pattern.test(segment)) return name;
  }
  return null;
}

export function extractTimelineStages(
  text: string,
  publishTime?: Date | string | null,
): TimelineStageCandidate[] {
  const segments = text
    .split(/[\r\n。；;]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const result: TimelineStageCandidate[] = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    const stage = stageName(segment);
    if (!stage) continue;

    const dates = extractDateRange(segment, publishTime);
    const key = `${stage}:${dates.startAt?.toISOString() ?? ''}:${dates.endAt?.toISOString() ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      stage,
      startAt: dates.startAt,
      endAt: dates.endAt,
    });
  }

  return result;
}
