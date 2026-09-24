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
import type { CrawlRunSummary, FetchResult, ParserSource } from './crawler.types';
import { CssParser } from './parser/css.parser';
import { JsonApiParser } from './parser/json-api.parser';
import { FetcherService } from './fetcher.service';
import { DifferService } from './differ.service';
import { MatcherService } from './matcher.service';
import { PublisherService } from './publisher.service';

const LOCK_TTL_SECONDS = 15 * 60;
const LOCK_PREFIX = 'crawl:lock:';

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
    for (const preset of CRAWLER_PRESETS) {
      const existing = await this.prisma.crawlSource.findFirst({
        where: { url: preset.url },
        select: { id: true },
      });
      if (!existing) await this.prisma.crawlSource.create({ data: preset });
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
        cron: true,
        parseStrategy: true,
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
      const items = parser.parseList(result, this.toParserSource(source));
      if (items.length === 0) {
        throw new Error(`Parser returned no items for source "${source.name}"`);
      }

      let created = 0;
      let updated = 0;
      for (const item of items) {
        const crawlItem = await this.prisma.crawlItem.create({
          data: {
            sourceId: source.id,
            title: item.title,
            link: item.link,
            rawText: item.rawText ?? item.content ?? null,
          },
        });

        const decision = await this.matcher.match(item.title);
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

  async runAll(): Promise<CrawlRunSummary[]> {
    const sources = await this.prisma.crawlSource.findMany({
      where: { enabled: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
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
    const items = parser.parseList(result, this.toParserSource(source));
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
