import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CrawlerService } from './crawler.service';

const TZ = 'Asia/Shanghai';

@Injectable()
export class CrawlerSchedulerService {
  private readonly logger = new Logger(CrawlerSchedulerService.name);

  constructor(private readonly crawler: CrawlerService) {}

  /**
   * 定时抓取：每 6 小时自动运行全部启用的爬虫源（符合 presets 设定的频率）
   * 采用串行执行与 Redis 锁，避免内存尖峰与重复执行
   */
  @Cron('0 15 */6 * * *', { timeZone: TZ })
  async scheduledCrawl() {
    this.logger.log('触发定时竞赛采集任务...');
    try {
      const summaries = await this.crawler.runAll();
      this.logger.log(`定时竞赛采集完成，执行了 ${summaries.length} 个源`);
    } catch (err) {
      this.logger.error(`定时竞赛采集异常: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
