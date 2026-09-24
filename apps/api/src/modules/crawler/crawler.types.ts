import type { Level, ParseStrategy, SourceHealth, SourceKind } from '@prisma/client';

export interface TimelineStageCandidate {
  stage: string;
  level?: Level | null;
  startAt: Date | null;
  endAt: Date | null;
}

export interface CrawlParsedItem {
  title: string;
  link: string;
  publishTime?: Date | null;
  rawText?: string | null;
  content?: string | null;
  organizer?: string | null;
  stages?: TimelineStageCandidate[];
  externalId?: string | null;
}

export interface FetchResult {
  url: string;
  status: number;
  headers: Record<string, string>;
  charset: string;
  body: string;
  rawBody: Buffer;
  fetchedAt: Date;
}

export interface GuardRuleViolation {
  rule: 'date-out-of-range' | 'epoch-date' | 'end-before-start' | 'jump-too-large' | 'null-overwrite';
  field: string;
  currentValue?: unknown;
  proposedValue?: unknown;
  message: string;
}

export interface CssParserConfig {
  itemSelector?: string;
  titleSelector?: string;
  linkSelector?: string;
  publishTimeSelector?: string;
  contentSelector?: string;
  detailTitleSelector?: string;
  detailContentSelector?: string;
}

export interface JsonApiParserConfig {
  itemsPath?: string;
  titlePath?: string;
  urlPath?: string;
  publishTimePath?: string;
  contentPath?: string;
  organizerPath?: string;
  externalIdPath?: string;
  defaultUrl?: string;
}

export type ParserConfig = CssParserConfig | JsonApiParserConfig | Record<string, unknown>;

export interface ParserSource {
  id?: string;
  name?: string;
  url: string;
  kind?: SourceKind;
  parseStrategy?: ParseStrategy;
  selectorConf: unknown;
}

export interface CompetitionCandidate {
  id: string;
  name: string;
  aliases: string[];
}

export type MatchAction = 'UPDATE' | 'CREATE_DRAFT';

export interface CompetitionMatchDecision {
  action: MatchAction;
  competitionId: string | null;
  score: number;
  matchedBy: 'name' | 'alias' | 'similarity' | 'none';
}

export interface CrawlSourceHealth {
  id: string;
  name: string;
  enabled: boolean;
  health: SourceHealth;
  consecutiveFails: number;
  lastRunAt: Date | null;
}

export interface CrawlRunSummary {
  sourceId: string;
  sourceName: string;
  skipped: boolean;
  reason?: string;
  fetched: number;
  created: number;
  updated: number;
  anomalies: number;
  finishedAt: Date;
}
