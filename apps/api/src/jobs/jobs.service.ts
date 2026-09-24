import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';
import { NotificationService } from '../modules/notification/notification.service';
import { TeamsService } from '../modules/match/teams.service';

/** 容器默认时区是 UTC：cron 必须显式指定，否则「早上 8:05」实际会在北京时间 16:05 触发 */
const TZ = 'Asia/Shanghai';

/** cron worker：DDL 提醒 + 队伍状态归档（TECH_STACK §5 内置 cron） */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
    private readonly teams: TeamsService,
    private readonly redis: RedisService,
  ) {}

  /**
   * 每日 08:05 DDL 提醒：关注的竞赛截止前 7/3/1 天。
   * 多实例部署下用 Redis 锁防重入；查询全部批量化，避免逐节点/逐关注者 N+1。
   */
  @Cron('0 5 8 * * *', { timeZone: TZ })
  async ddlReminders() {
    const lockKey = 'job:ddl';
    const locked = await this.redis.lock(lockKey, 3600);
    if (!locked) {
      this.logger.warn('DDL 提醒任务已由其他实例执行，本次跳过');
      return;
    }

    try {
      const now = new Date();
      const windows = [7, 3, 1].map((d) => ({
        d,
        from: new Date(now.getTime() + d * 86400_000 - 3600_000),
        to: new Date(now.getTime() + d * 86400_000 + 3600_000),
      }));

      // 1) 一次取回三个窗口内的「报名」节点（仅已发布竞赛）
      const timelines = await this.prisma.competitionTimeline.findMany({
        where: {
          stage: { contains: '报名' },
          competition: { status: 'PUBLISHED' },
          OR: windows.map((w) => ({ endAt: { gte: w.from, lte: w.to } })),
        },
        include: { competition: { select: { name: true } } },
      });
      if (!timelines.length) {
        this.logger.log('DDL 提醒发送 0 条');
        return;
      }

      // 2) 一次取回这些竞赛的全部关注者，按竞赛分组
      const compIds = [...new Set(timelines.map((t) => t.competitionId))];
      const favs = await this.prisma.favorite.findMany({
        where: { targetType: 'COMPETITION', targetId: { in: compIds } },
        select: { userId: true, targetId: true },
      });
      const favUsersByComp = new Map<string, string[]>();
      for (const f of favs) {
        const list = favUsersByComp.get(f.targetId);
        if (list) list.push(f.userId);
        else favUsersByComp.set(f.targetId, [f.userId]);
      }
      if (!favs.length) {
        this.logger.log('DDL 提醒发送 0 条（无关注者）');
        return;
      }

      // 3) 一次取回当天这些用户已有的 DDL 提醒，内存判重（同一天同一节点不重复提醒）
      const targetUserIds = [...new Set(favs.map((f) => f.userId))];
      const existing = await this.prisma.notification.findMany({
        where: {
          userId: { in: targetUserIds },
          kind: 'DDL_REMINDER',
          createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) },
        },
        select: { userId: true, payload: true },
      });
      const sentKeys = new Set<string>();
      for (const n of existing) {
        const timelineId = (n.payload as { timelineId?: string } | null)?.timelineId;
        if (timelineId) sentKeys.add(`${n.userId}:${timelineId}`);
      }

      // 4) 内存组装后一次性批量写入
      const rows: Prisma.NotificationCreateManyInput[] = [];
      for (const tl of timelines) {
        if (!tl.endAt) continue;
        const daysLeft = windows.find((w) => tl.endAt! >= w.from && tl.endAt! <= w.to)?.d;
        if (daysLeft == null) continue;
        for (const userId of favUsersByComp.get(tl.competitionId) ?? []) {
          const key = `${userId}:${tl.id}`;
          if (sentKeys.has(key)) continue;
          sentKeys.add(key); // 同一批次内也防重
          rows.push({
            userId,
            kind: 'DDL_REMINDER',
            payload: {
              timelineId: tl.id,
              competitionName: tl.competition.name,
              stage: tl.stage,
              endAt: tl.endAt,
              daysLeft,
            },
          });
        }
      }

      await this.notify.notifyBatch(rows);
      this.logger.log(`DDL 提醒发送 ${rows.length} 条`);
    } finally {
      await this.redis.unlock(lockKey);
    }
  }

  /** 每日 03:30 按竞赛时间线自动把招募帖置为「已参赛」 */
  @Cron('0 30 3 * * *', { timeZone: TZ })
  async autoCompeteTeams() {
    const result = await this.teams.autoCompete();
    if (result.updated > 0) this.logger.log(`自动置为已参赛的帖子 ${result.updated} 条`);
  }
}
