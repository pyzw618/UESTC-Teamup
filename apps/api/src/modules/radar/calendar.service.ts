import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { Level, LevelLabel } from '@teamup/shared';

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  /** 区间内的时间节点（FullCalendar 数据源）；按级别配色由前端处理 */
  async range(query: { start?: string; end?: string; levels?: string[] }) {
    const start = query.start ? new Date(query.start) : new Date(Date.now() - 30 * 86400_000);
    const end = query.end ? new Date(query.end) : new Date(Date.now() + 120 * 86400_000);

    const rows = await this.prisma.competitionTimeline.findMany({
      where: {
        OR: [{ startAt: { lte: end, gte: start } }, { endAt: { lte: end, gte: start } }, { startAt: { lte: start }, endAt: { gte: end } }],
        competition: { status: 'PUBLISHED' },
        ...(query.levels?.length ? { level: { in: query.levels as never[] } } : {}),
      },
      include: { competition: { select: { id: true, name: true, levels: true } } },
      orderBy: { startAt: 'asc' },
      take: 500,
    });

    return rows.map((t) => ({
      id: t.id,
      competitionId: t.competition.id,
      competitionName: t.competition.name,
      stage: t.stage,
      level: t.level,
      competitionLevels: t.competition.levels.map((l) => l.level),
      startAt: t.startAt,
      endAt: t.endAt,
      isLocked: t.isLocked,
      // 报名期与赛程期两类样式区分（PAGES.md §2.4）
      kind: (t.stage ?? '').includes('报名') ? 'signup' : 'race',
    }));
  }

  /** 导出 .ics（手机日历订阅） */
  async ics(): Promise<string> {
    const rows = await this.prisma.competitionTimeline.findMany({
      where: {
        endAt: { gte: new Date() },
        competition: { status: 'PUBLISHED' },
      },
      include: { competition: { select: { name: true } } },
      orderBy: { endAt: 'asc' },
      take: 300,
    });

    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//UESTC TeamUp//Competition Radar//CN',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:成电竞赛雷达',
      'X-WR-TIMEZONE:Asia/Shanghai',
    ];

    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s: string) => s.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

    for (const t of rows) {
      if (!t.endAt) continue;
      const start = t.startAt ?? t.endAt;
      lines.push(
        'BEGIN:VEVENT',
        `UID:timeline-${t.id}@uestc-teamup`,
        `DTSTAMP:${fmt(new Date())}`,
        `DTSTART:${fmt(start)}`,
        `DTEND:${fmt(t.endAt)}`,
        `SUMMARY:${esc(`${t.competition.name} · ${t.stage}${t.level ? `（${LevelLabel[t.level as Level] ?? t.level}）` : ''}`)}`,
        `DESCRIPTION:${esc('来自 UESTC TeamUp 竞赛雷达')}`,
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }
}
