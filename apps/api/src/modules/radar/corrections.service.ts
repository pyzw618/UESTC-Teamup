import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
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

@Injectable()
export class CorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
  ) {}

  async submit(reporterId: string, competitionId: string, dto: { field: string; proposedValue?: string; note?: string }) {
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
