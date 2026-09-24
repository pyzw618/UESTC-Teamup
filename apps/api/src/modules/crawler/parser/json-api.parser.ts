import { Injectable } from '@nestjs/common';
import {
  extractFirstExplicitDate,
  extractTimelineStages,
} from '../chinese-date.extractor';
import type {
  CrawlParsedItem,
  FetchResult,
  JsonApiParserConfig,
  ParserConfig,
  ParserSource,
} from '../crawler.types';
import type { CrawlerParser } from './crawler-parser.interface';

function asConfig(value: unknown): JsonApiParserConfig {
  return value && typeof value === 'object' ? (value as ParserConfig as JsonApiParserConfig) : {};
}

function pathValue(value: unknown, path?: string): unknown {
  if (!path) return undefined;

  return path.split('.').reduce<unknown>((current, key) => {
    if (current == null || typeof current !== 'object') return undefined;
    if (Array.isArray(current) && /^\d+$/.test(key)) return current[Number(key)];
    return (current as Record<string, unknown>)[key];
  }, value);
}

function firstValue(record: Record<string, unknown>, candidates: string[]): unknown {
  for (const key of candidates) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function toDate(value: unknown, publishTime: Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const exact = extractFirstExplicitDate(value, publishTime);
    if (exact) return exact;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function findItems(root: unknown, configuredPath?: string): unknown[] {
  const configured = pathValue(root, configuredPath);
  if (Array.isArray(configured)) return configured;

  const fallbackPaths = [
    'data.records',
    'data.list',
    'data.rows',
    'data.items',
    'records',
    'list',
    'rows',
    'items',
    'result.records',
    'result.list',
    'result.rows',
    'result.items',
  ];

  for (const path of fallbackPaths) {
    const value = pathValue(root, path);
    if (Array.isArray(value)) return value;
  }

  return Array.isArray(root) ? root : [];
}

function safeUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

@Injectable()
export class JsonApiParser implements CrawlerParser {
  parseList(result: FetchResult, source: ParserSource): CrawlParsedItem[] {
    let root: unknown;
    try {
      root = JSON.parse(result.body) as unknown;
    } catch (error) {
      throw new Error(
        `Invalid JSON response from ${source.url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const config = asConfig(source.selectorConf);
    return findItems(root, config.itemsPath).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const title = asText(
        pathValue(item, config.titlePath) ??
          firstValue(record, ['title', 'newsTitle', 'competitionName', 'name']),
      );
      const rawLink = asText(
        pathValue(item, config.urlPath) ??
          firstValue(record, ['url', 'link', 'detailUrl', 'outLink', 'href']),
      );
      const link = safeUrl(rawLink ?? config.defaultUrl ?? null, result.url || source.url);
      if (!title || !link) return [];

      const content =
        asText(
          pathValue(item, config.contentPath) ??
            firstValue(record, ['content', 'summary', 'description', 'intro']),
        ) ?? null;
      const rawTime =
        pathValue(item, config.publishTimePath) ??
        firstValue(record, ['publishTime', 'publishDate', 'createTime', 'date', 'time']);
      const publishTime = toDate(rawTime, result.fetchedAt);

      return [
        {
          title,
          link,
          publishTime,
          content,
          rawText: content,
          organizer:
            asText(pathValue(item, config.organizerPath) ?? record.organizer) ?? null,
          externalId:
            asText(pathValue(item, config.externalIdPath) ?? record.id) ?? null,
          stages: extractTimelineStages(`${title} ${content ?? ''}`, publishTime),
        },
      ];
    });
  }

  parseDetail(result: FetchResult, source: ParserSource): CrawlParsedItem {
    const items = this.parseList(
      {
        ...result,
        body: JSON.stringify(JSON.parse(result.body) as unknown),
      },
      source,
    );
    if (items[0]) return items[0];

    return {
      title: '',
      link: result.url || source.url,
      rawText: result.body,
      publishTime: null,
      stages: [],
    };
  }
}
