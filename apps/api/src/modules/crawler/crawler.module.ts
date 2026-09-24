import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { RedisModule } from '../../common/redis.service';
import { CrawlerController } from './crawler.controller';
import { CrawlerService } from './crawler.service';
import { CrawlerSchedulerService } from './crawler-scheduler.service';
import { DifferService } from './differ.service';
import { FetcherService } from './fetcher.service';
import { GuardService } from './guard.service';
import { MatcherService } from './matcher.service';
import { PublisherService } from './publisher.service';
import { CssParser } from './parser/css.parser';
import { JsonApiParser } from './parser/json-api.parser';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [CrawlerController],
  providers: [
    CrawlerService,
    CrawlerSchedulerService,
    FetcherService,
    DifferService,
    CssParser,
    JsonApiParser,
    MatcherService,
    GuardService,
    PublisherService,
  ],
  exports: [CrawlerService],
})
export class CrawlerModule {}
