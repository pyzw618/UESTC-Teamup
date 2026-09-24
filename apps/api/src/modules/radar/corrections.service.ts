import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { NotificationService } from '../notification/notification.service';

/** 允许纠错的字段（竞赛详情页每个字段旁的「报告错误」入口） */
const CORRECTABLE_FIELDS: Record<string, 'text' | 'date'> = {
  name: 'text',
  organizer: 'text',
  officialUrl: 'text',
  intro: 'text',
  isBonusEligible: 'text',
  bonusCategory: 'text',
  bonusPoints: 'text',
};

/** URL 类字段：提交时必须校验 scheme，阻止 javascript: 等存储型 XSS */
const URL_FIELDS = new Set(['officialUrl', 'sourceUrl']);

/** 纠错提交限流：每分钟上限 */
const CORRECTION_RATE_LIMIT = 5;

@Injectable()
export class CorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
    private readonly redis: RedisService,
  ) {}

  async submit(reporterId: string, competitionId: string, dto: { field: string; proposedValue?: string; note?: string }) {
    // UGC 限流：5 条/分钟（M14）
    const hits = await this.redis.incrWithTtl(`rl:correction:submit:${reporterId}`, 60);
    if (hits > CORRECTION_RATE_LIMIT) throw new BadRequestException('操作太频繁，请稍后再试');

    const competition = await this.prisma.competition.findUnique({ where: { id: competitionId } });
    if (!competition) throw new NotFoundException('竞赛不存在');

    // field 形如 "name"（竞赛字段）或 "timeline:<id>:endAt"（时间轴节点字段）
    let currentValue: string | null = null;
    let timelineId: string | null = null;
    const [head, tlId, tlField] = dto.field.split(':');

    if (head === 'timeline') {
      if (!tlId || !['startAt', 'endAt'].includes(tlField ?? '')) throw new BadRequestException('不支持的纠错字段');
      const tl = await this.prisma.competitionTimeline.findUnique({ where: { id: tlId } });
      if (!tl || tl.competitionId !== competitionId) throw new BadRequestException('时间节点不存在');
      currentValue = (tlField === 'endAt' ? tl.endAt : tl.startAt)?.toISOString() ?? null;
      timelineId = tlId;
    } else {
      if (!CORRECTABLE_FIELDS[head]) throw new BadRequestException('不支持的纠错字段');
      // URL 类字段：只接受 http/https，防止 javascript: 之类被采纳后写入库（存储型 XSS）
      if (URL_FIELDS.has(head) && dto.proposedValue != null && !/^https?:\/\//i.test(dto.proposedValue.trim())) {
        throw new BadRequestException('链接必须以 http:// 或 https:// 开头');
      }
      currentValue = (competition as unknown as Record<string, string | null>)[head] ?? null;
      if (head === 'isBonusEligible') currentValue = String(competition.isBonusEligible ?? '');
    }

    if (dto.proposedValue != null && dto.proposedValue === currentValue) {
      throw new BadRequestException('你填写的值与当前值相同');
    }

    const report = await this.prisma.correctionReport.create({
      data: {
        competitionId,
        field: dto.field,
        currentValue,
        proposedValue: dto.proposedValue ?? null,
        note: dto.note ?? null,
        reporterId,
      },
    });

    // 通知管理员处理（纠错优先级高于采集任务）
    const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    await this.notify.notifyMany(
      admins.map((a) => a.id),
      'CORRECTION_NEW',
      { reportId: report.id, competitionId, field: dto.field, proposedValue: dto.proposedValue },
    );

    return report;
  }
}
