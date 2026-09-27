import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FeedbackType } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/** 反馈内容与联系方式长度约束 */
const CONTENT_MAX = 2000;
const CONTACT_MAX = 100;
/** pagePath 最长（当前页面路径，FUNCTION 类型自动附带） */
const PAGE_PATH_MAX = 300;

/** 单日（Asia/Shanghai 时区）的起止时间 */
function dayRange(date: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('日期格式应为 YYYY-MM-DD');
  const start = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime())) throw new BadRequestException('日期不合法');
  const end = new Date(start.getTime() + 24 * 3600_000);
  return { start, end };
}

/** 以 +08:00 固定偏移输出 ISO 时间（导出文件对脚本消费方保持稳定） */
export function toIsoCst(d: Date): string {
  return new Date(d.getTime() + 8 * 3600_000).toISOString().replace(/\.\d{3}Z$/, '+08:00');
}

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 提交反馈（游客可提交，附选填联系方式）。
   * COMPETITION_INFO 类型：服务端按 competitionId 读取当前竞赛名做快照，不信任客户端传名。
   */
  async submit(
    input: {
      type: FeedbackType;
      competitionId?: string;
      pagePath?: string;
      content: string;
      contact?: string;
    },
    userId?: string,
  ) {
    const content = input.content.trim();
    if (!content) throw new BadRequestException('请填写反馈内容');
    if (content.length > CONTENT_MAX) throw new BadRequestException(`反馈内容最长 ${CONTENT_MAX} 字`);

    let competitionId: string | null = null;
    let competitionName: string | null = null;
    if (input.type === FeedbackType.COMPETITION_INFO) {
      if (!input.competitionId) throw new BadRequestException('缺少竞赛信息');
      const comp = await this.prisma.competition.findUnique({
        where: { id: input.competitionId },
        select: { id: true, name: true },
      });
      if (!comp) throw new NotFoundException('竞赛不存在');
      competitionId = comp.id;
      competitionName = comp.name; // 提交时名称快照（防竞赛改名后对不上）
    }

    const pagePath = input.pagePath?.trim().slice(0, PAGE_PATH_MAX) || null;
    const contact = input.contact?.trim().slice(0, CONTACT_MAX) || null;

    return this.prisma.feedback.create({
      data: { type: input.type, competitionId, competitionName, pagePath, content, contact, userId: userId ?? null },
    });
  }

  /** 某一天的反馈列表（后台导出/查看同源） */
  async listByDate(date: string) {
    const { start, end } = dayRange(date);
    const rows = await this.prisma.feedback.findMany({
      where: { createdAt: { gte: start, lt: end } },
      include: { user: { select: { id: true, nickname: true } }, competition: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      competitionId: r.competitionId,
      competitionName: r.competitionName,
      pagePath: r.pagePath,
      content: r.content,
      contact: r.contact,
      submittedBy: r.user ? { userId: r.user.id, nickname: r.user.nickname } : null,
      createdAt: r.createdAt,
    }));
  }

  /** 导出格式（docs/ISSUES_PRODUCT_FIXES.md Issue 5）：meta + items，+08:00 固定偏移 */
  async exportByDate(date: string) {
    const items = await this.listByDate(date);
    return {
      meta: {
        exportedAt: toIsoCst(new Date()),
        date,
        total: items.length,
      },
      items: items.map((r) => ({
        id: r.id,
        type: r.type,
        pagePath: r.pagePath,
        competition:
          r.competitionId != null || r.competitionName != null
            ? { id: r.competitionId, name: r.competitionName }
            : null,
        content: r.content,
        contact: r.contact ?? '',
        submittedBy: r.submittedBy,
        createdAt: toIsoCst(r.createdAt),
      })),
    };
  }

  /** 一个月内每天的反馈条数（用于后台日期选择器把无反馈日期置灰） */
  async countsByMonth(month: string): Promise<Record<string, number>> {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('月份格式应为 YYYY-MM');
    const start = new Date(`${month}-01T00:00:00+08:00`);
    if (Number.isNaN(start.getTime())) throw new BadRequestException('月份不合法');
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    const rows = await this.prisma.$queryRaw<{ day: string; count: bigint }[]>`
      SELECT to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS day, count(*) AS count
      FROM "Feedback"
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
      GROUP BY day`;
    return Object.fromEntries(rows.map((r) => [r.day, Number(r.count)]));
  }
}
