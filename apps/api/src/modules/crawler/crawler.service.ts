import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ParseStrategy, Prisma, SourceHealth } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { CRAWLER_PRESETS } from './crawler.presets';
import { OFFICIAL_COMPETITION_PRESETS } from './official-competition.presets';
import type { CrawlParsedItem, CrawlRunSummary, FetchResult, ParserSource } from './crawler.types';
import { CssParser } from './parser/css.parser';
import { JsonApiParser } from './parser/json-api.parser';
import { FetcherService } from './fetcher.service';
import { DifferService } from './differ.service';
import { MatcherService } from './matcher.service';
import { PublisherService } from './publisher.service';

const LOCK_TTL_SECONDS = 15 * 60;
const LOCK_PREFIX = 'crawl:lock:';

type SeenCrawlItem = { link: string; externalId?: string | null; processed: boolean };

function itemKey(item: Pick<CrawlParsedItem, 'link' | 'externalId'>): string {
  return item.externalId ? `id:${item.externalId}` : `url:${item.link}`;
}

export function filterUnseenCrawlItems(items: CrawlParsedItem[], previous: SeenCrawlItem[]): CrawlParsedItem[] {
  const seen = new Set(previous.filter((item) => item.processed).map(itemKey));
  return items.filter((item) => {
    const key = itemKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

@Injectable()
export class CrawlerService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly fetcher: FetcherService,
    private readonly differ: DifferService,
    private readonly cssParser: CssParser,
    private readonly jsonParser: JsonApiParser,
    private readonly matcher: MatcherService,
    private readonly publisher: PublisherService,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const preset of [...CRAWLER_PRESETS, ...OFFICIAL_COMPETITION_PRESETS]) {
      const existing = await this.prisma.crawlSource.findFirst({
        where: { name: preset.name },
        select: { id: true },
      });
      if (!existing) await this.prisma.crawlSource.create({ data: preset });
      else {
        // Presets are code-managed; keep selectors, list URLs and rollout state
        // in sync on upgrades without resetting health or crawl history.
        await this.prisma.crawlSource.update({
          where: { id: existing.id },
          data: {
            url: preset.url,
            kind: preset.kind,
            cron: preset.cron,
            parseStrategy: preset.parseStrategy,
            selectorConf: preset.selectorConf,
            enabled: preset.enabled,
            priority: preset.priority,
          },
        });
      }
    }
  }

  async sources() {
    return this.prisma.crawlSource.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        url: true,
        kind: true,
        priority: true,
        cron: true,
        parseStrategy: true,
        selectorConf: true,
        enabled: true,
        lastRunAt: true,
        consecutiveFails: true,
        health: true,
      },
    });
  }

  async runSource(
    sourceId: string,
    options: { force?: boolean } = {},
  ): Promise<CrawlRunSummary> {
    const source = await this.prisma.crawlSource.findUnique({ where: { id: sourceId } });
    if (!source) throw new NotFoundException('爬虫源不存在');
    if (!source.enabled) throw new BadRequestException('该爬虫源已停用');
    if (source.health === SourceHealth.SUSPENDED && !options.force) {
      return {
        sourceId,
        sourceName: source.name,
        skipped: true,
        reason: 'circuit-open',
        fetched: 0,
        created: 0,
        updated: 0,
        anomalies: 0,
        finishedAt: new Date(),
      };
    }

    const lockKey = `${LOCK_PREFIX}${sourceId}`;
    const lockToken = randomUUID();
    const acquired = await this.redis.client.set(
      lockKey,
      lockToken,
      'EX',
      LOCK_TTL_SECONDS,
      'NX',
    );

    if (acquired !== 'OK') {
      return {
        sourceId,
        sourceName: source.name,
        skipped: true,
        reason: 'already-running',
        fetched: 0,
        created: 0,
        updated: 0,
        anomalies: 0,
        finishedAt: new Date(),
      };
    }

    try {
      const result = await this.fetcher.fetch(source.url);
      const difference = await this.differ.check(source.id, result.rawBody);
      if (!difference.changed) {
        await this.recordSuccess(source.id);
        return {
          sourceId,
          sourceName: source.name,
          skipped: true,
          reason: 'unchanged',
          fetched: 0,
          created: 0,
          updated: 0,
          anomalies: 0,
          finishedAt: new Date(),
        };
      }

      const parser = this.parserFor(source.parseStrategy);
      const parserSource = this.toParserSource(source);
      const items = parser.parseList(result, parserSource);
      if (items.length === 0) {
        throw new Error(`Parser returned no items for source "${source.name}"`);
      }

      const externalIds = items.flatMap((item) => item.externalId ? [item.externalId] : []);
      const links = items.filter((item) => !item.externalId).map((item) => item.link);
      const previous = await this.prisma.crawlItem.findMany({
        where: {
          sourceId: source.id,
          OR: [
            ...(externalIds.length ? [{ externalId: { in: externalIds } }] : []),
            ...(links.length ? [{ link: { in: links } }] : []),
          ],
        },
        select: { link: true, externalId: true, processed: true },
      });
      const unseen = filterUnseenCrawlItems(items, previous);
      if (unseen.length === 0) {
        await this.differ.storeSuccessful(source.id, difference.contentHash);
        await this.recordSuccess(source.id);
        return {
          sourceId,
          sourceName: source.name,
          skipped: true,
          reason: 'no-new-items',
          fetched: items.length,
          created: 0,
          updated: 0,
          anomalies: 0,
          finishedAt: new Date(),
        };
      }

      let created = 0;
      let updated = 0;
      const config = this.sourceConfig(source.selectorConf);
      // Lists are normally newest-first (including the optional date sort).
      // Publish oldest first so sourceUrl ends on the newest unseen notice.
      for (const listedItem of unseen.reverse()) {
        const item = await this.enrichDetail(listedItem, source, parserSource);
        const crawlItem = await this.prisma.crawlItem.create({
          data: {
            sourceId: source.id,
            title: item.title,
            link: item.link,
            externalId: item.externalId ?? null,
            rawText: item.rawText ?? item.content ?? null,
          },
        });

        const decision = await this.matcher.match(
          typeof config.competitionName === 'string' ? config.competitionName : item.title,
        );
        const published = await this.publisher.publish(source.id, decision, item);
        if (published.published) {
          if (decision.action === 'CREATE_DRAFT') created += 1;
          else updated += 1;
        }

        await this.prisma.crawlItem.update({
          where: { id: crawlItem.id },
          data: { processed: true },
        });
      }

      await this.differ.storeSuccessful(source.id, difference.contentHash);
      await this.recordSuccess(source.id);

      return {
        sourceId,
        sourceName: source.name,
        skipped: false,
        fetched: items.length,
        created,
        updated,
        anomalies: await this.countRecentAnomalies(source.id, result.fetchedAt),
        finishedAt: new Date(),
      };
    } catch (error) {
      await this.recordFailure(source.id);
      throw error;
    } finally {
      await this.redis.client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockToken,
      );
    }
  }

  async runAll(priority?: number): Promise<CrawlRunSummary[]> {
    const sources = await this.prisma.crawlSource.findMany({
      where: { enabled: true, ...(priority === undefined ? {} : { priority }) },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });

    const results: CrawlRunSummary[] = [];
    for (const source of sources) {
      try {
        results.push(await this.runSource(source.id));
      } catch (error) {
        results.push({
          sourceId: source.id,
          sourceName: source.id,
          skipped: false,
          reason: error instanceof Error ? error.message : String(error),
          fetched: 0,
          created: 0,
          updated: 0,
          anomalies: 0,
          finishedAt: new Date(),
        });
      }
    }
    return results;
  }

  async preview(sourceId: string) {
    const source = await this.prisma.crawlSource.findUnique({ where: { id: sourceId } });
    if (!source) throw new NotFoundException('爬虫源不存在');

    const result = await this.fetcher.fetch(source.url);
    const parser = this.parserFor(source.parseStrategy);
    const parserSource = this.toParserSource(source);
    const items = parser.parseList(result, parserSource);
    return {
      sourceId: source.id,
      sourceName: source.name,
      fetchedAt: result.fetchedAt,
      status: result.status,
      charset: result.charset,
      count: items.length,
      items,
    };
  }

  private parserFor(strategy: ParseStrategy) {
    if (strategy === ParseStrategy.CSS) return this.cssParser;
    if (strategy === ParseStrategy.JSON_API) return this.jsonParser;
    throw new BadRequestException(`暂不支持解析策略：${strategy}`);
  }

  private sourceConfig(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private async enrichDetail(
    item: CrawlParsedItem,
    source: { url: string; parseStrategy: ParseStrategy; selectorConf: Prisma.JsonValue },
    parserSource: ParserSource,
  ): Promise<CrawlParsedItem> {
    const config = this.sourceConfig(source.selectorConf);
    if (source.parseStrategy !== ParseStrategy.CSS || config.fetchDetail !== true) return item;
    if (new URL(item.link).hostname !== new URL(source.url).hostname) return item;
    try {
      const detail = this.cssParser.parseDetail(await this.fetcher.fetch(item.link), parserSource);
      return {
        ...item,
        publishTime: item.publishTime ?? detail.publishTime,
        content: detail.content?.slice(0, 20_000) ?? item.content,
        rawText: detail.rawText?.slice(0, 20_000) ?? item.rawText,
        stages: detail.content && detail.stages?.length ? detail.stages : item.stages,
      };
    } catch {
      // A list item remains useful when its detail page is temporarily unavailable.
      return item;
    }
  }

  private toParserSource(source: {
    id: string;
    name: string;
    url: string;
    selectorConf: Prisma.JsonValue;
    parseStrategy: ParseStrategy;
  }): ParserSource {
    return {
      id: source.id,
      name: source.name,
      url: source.url,
      selectorConf: source.selectorConf,
      parseStrategy: source.parseStrategy,
    };
  }

  private async recordSuccess(sourceId: string): Promise<void> {
    await this.prisma.crawlSource.update({
      where: { id: sourceId },
      data: {
        lastRunAt: new Date(),
        consecutiveFails: 0,
        health: SourceHealth.HEALTHY,
      },
    });
  }

  private async recordFailure(sourceId: string): Promise<void> {
    const source = await this.prisma.crawlSource.findUnique({
      where: { id: sourceId },
      select: { consecutiveFails: true },
    });
    if (!source) return;

    const consecutiveFails = source.consecutiveFails + 1;
    const health =
      consecutiveFails >= 10
        ? SourceHealth.SUSPENDED
        : consecutiveFails >= 5
          ? SourceHealth.FAILING
          : consecutiveFails >= 2
            ? SourceHealth.DEGRADED
            : SourceHealth.HEALTHY;

    await this.prisma.crawlSource.update({
      where: { id: sourceId },
      data: { consecutiveFails, health, lastRunAt: new Date() },
    });
  }

  private async countRecentAnomalies(sourceId: string, since: Date): Promise<number> {
    return this.prisma.crawlAnomaly.count({
      where: { sourceId, detectedAt: { gte: since } },
    });
  }
}
