import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { NotificationService } from '../modules/notification/notification.service';
import { TeamsService } from '../modules/match/teams.service';

/** cron worker：DDL 提醒 + 队伍状态归档（TECH_STACK §5 内置 cron） */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
    private readonly teams: TeamsService,
  ) {}

  /** 每日 08:05 DDL 提醒：关注的竞赛截止前 7/3/1 天 */
  @Cron('0 5 8 * * *')
  async ddlReminders() {
    const now = new Date();
    const days = [7, 3, 1];
    let sent = 0;

    for (const d of days) {
      const from = new Date(now.getTime() + d * 86400_000 - 3600_000);
      const to = new Date(now.getTime() + d * 86400_000 + 3600_000);
      const timelines = await this.prisma.competitionTimeline.findMany({
        where: { endAt: { gte: from, lte: to }, stage: { contains: '报名' } },
        include: { competition: { select: { name: true } } },
      });

      for (const tl of timelines) {
        const favs = await this.prisma.favorite.findMany({
          where: { targetType: 'COMPETITION', targetId: tl.competitionId },
          select: { userId: true },
        });
        for (const fav of favs) {
          // 幂等：同一天同一节点不重复提醒
          const dup = await this.prisma.notification.findFirst({
            where: {
              userId: fav.userId,
              kind: 'DDL_REMINDER',
              createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) },
              payload: { path: ['timelineId'], equals: tl.id },
            },
          });
          if (dup) continue;
          await this.notify.notify(fav.userId, 'DDL_REMINDER', {
            timelineId: tl.id,
            competitionName: tl.competition.name,
            stage: tl.stage,
            endAt: tl.endAt,
            daysLeft: d,
          });
          sent++;
        }
      }
    }
    this.logger.log(`DDL 提醒发送 ${sent} 条`);
  }

  /** 每日 03:30 队伍状态归档 */
  @Cron('0 30 3 * * *')
  async archiveTeams() {
    const result = await this.teams.archiveExpired();
    if (result.archived > 0) this.logger.log(`自动归档过期队伍 ${result.archived} 支`);
  }
}
