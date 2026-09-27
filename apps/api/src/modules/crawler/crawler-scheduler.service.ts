import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CrawlerService } from './crawler.service';

const TZ = 'Asia/Shanghai';

@Injectable()
export class CrawlerSchedulerService {
  private readonly logger = new Logger(CrawlerSchedulerService.name);

  constructor(private readonly crawler: CrawlerService) {}

  /**
   * 每 6 小时运行成电聚合源和补充校内源。
   * 采用串行执行与 Redis 锁，避免内存尖峰与重复执行
   */
  @Cron('0 15 */6 * * *', { timeZone: TZ })
  async scheduledCrawl() {
    this.logger.log('触发定时竞赛采集任务...');
    try {
      const summaries = [...await this.crawler.runAll(1), ...await this.crawler.runAll(3)];
      this.logger.log(`定时竞赛采集完成，执行了 ${summaries.length} 个源`);
    } catch (err) {
      this.logger.error(`定时竞赛采集异常: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  @Cron('0 0 3 * * *', { timeZone: TZ })
  async scheduledOfficialSites() {
    try {
      const summaries = await this.crawler.runAll(2);
      this.logger.log(`赛事官网采集完成，执行了 ${summaries.length} 个源`);
    } catch (err) {
      this.logger.error(`赛事官网采集异常: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
