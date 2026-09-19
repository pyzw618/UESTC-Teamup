import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Audience,
  CompetitionFormat,
  CorrectionStatus,
  Level,
  PublishStatus,
  RevisionOrigin,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { CompetitionsService } from '../radar/competitions.service';
import { decorateListItem } from '../radar/competitions.service';

export interface UpsertCompetitionInput {
  name: string;
  aliases?: string[];
  organizer?: string;
  officialUrl?: string;
  format?: CompetitionFormat;
  teamSizeMin?: number;
  teamSizeMax?: number;
  audience?: Audience;
  intro?: string;
  difficulty?: number;
  effort?: number;
  isBonusEligible?: boolean;
  bonusCategory?: string;
  bonusPoints?: string;
  sourceUrl?: string;
  status?: PublishStatus;
  levels?: Level[];
  tags?: string[];
  timelines?: { id?: string; stage: string; level?: Level; startAt?: Date | null; endAt?: Date | null }[];
}

/** 竞赛主体上需要记版本的字段 */
const TRACKED_FIELDS = [
  'name',
  'organizer',
  'officialUrl',
  'format',
  'audience',
  'intro',
  'isBonusEligible',
  'bonusCategory',
  'bonusPoints',
] as const;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
    private readonly competitions: CompetitionsService,
  ) {}

  // ---------- 竞赛录入 / 编辑 ----------

  async createCompetition(input: UpsertCompetitionInput) {
    const { levels, tags, timelines, ...fields } = input;
    return this.prisma.$transaction(async (tx) => {
      const comp = await tx.competition.create({
        data: {
          ...fields,
          aliases: fields.aliases ?? [],
          status: fields.status ?? PublishStatus.PUBLISHED,
          levels: { create: (levels ?? []).map((level) => ({ level })) },
          tags: { create: (tags ?? []).map((tag) => ({ tag })) },
          timelines: {
            create: (timelines ?? []).map((t) => ({ stage: t.stage, level: t.level, startAt: t.startAt ?? null, endAt: t.endAt ?? null })),
          },
        },
        include: { levels: true, tags: true, timelines: true },
      });
      return comp;
    });
  }

  /** 编辑：字段变更记 MANUAL revision；时间轴节点人工编辑自动 isLocked（Q9） */
  async updateCompetition(id: string, input: UpsertCompetitionInput, actorId: string) {
    const existing = await this.prisma.competition.findUnique({
      where: { id },
      include: { timelines: true, levels: true, tags: true },
    });
    if (!existing) throw new NotFoundException('竞赛不存在');
    const { levels, tags, timelines, ...fields } = input;

    await this.prisma.$transaction(async (tx) => {
      // 主体字段 diff → MANUAL revision
      const revisions: Prisma.CrawlRevisionCreateManyInput[] = [];
      for (const f of TRACKED_FIELDS) {
        const oldV = (existing as unknown as Record<string, unknown>)[f];
        const newV = (fields as Record<string, unknown>)[f];
        if (newV !== undefined && String(oldV ?? '') !== String(newV ?? '')) {
          revisions.push({
            competitionId: id,
            field: f,
            oldValue: oldV == null ? null : String(oldV),
            newValue: newV == null ? null : String(newV),
            origin: RevisionOrigin.MANUAL,
          });
        }
      }
      if (revisions.length) await tx.crawlRevision.createMany({ data: revisions });

      await tx.competition.update({ where: { id }, data: { ...fields } });

      if (levels) {
        await tx.competitionLevel.deleteMany({ where: { competitionId: id } });
        await tx.competitionLevel.createMany({ data: levels.map((level) => ({ competitionId: id, level })) });
      }
      if (tags) {
        await tx.competitionTag.deleteMany({ where: { competitionId: id } });
        await tx.competitionTag.createMany({ data: tags.map((tag) => ({ competitionId: id, tag })) });
      }

      if (timelines) {
        const keepIds = new Set(timelines.filter((t) => t.id && !t.id.startsWith('new-')).map((t) => t.id!));
        // 删除被移除的节点（非锁定）
        for (const tl of existing.timelines) {
          if (!keepIds.has(tl.id) && !tl.isLocked) await tx.competitionTimeline.delete({ where: { id: tl.id } });
        }
        for (const t of timelines) {
          const data = { stage: t.stage, level: t.level, startAt: t.startAt ?? null, endAt: t.endAt ?? null };
          if (t.id && !t.id.startsWith('new-')) {
            const old = existing.timelines.find((x) => x.id === t.id);
            const changed =
              old &&
              (String(old.startAt ?? '') !== String(t.startAt ?? '') ||
                String(old.endAt ?? '') !== String(t.endAt ?? '') ||
                old.stage !== t.stage);
            if (changed) {
              // 人工修正自动加锁 + 记版本（防下次采集改回去）
              await tx.competitionTimeline.update({ where: { id: t.id }, data: { ...data, isLocked: true, isAuto: false } });
              await tx.crawlRevision.createMany({
                data: [
                  {
                    competitionId: id,
                    timelineId: t.id,
                    field: 'startAt',
                    oldValue: old?.startAt?.toISOString() ?? null,
                    newValue: t.startAt?.toISOString() ?? null,
                    origin: RevisionOrigin.MANUAL,
                  },
                  {
                    competitionId: id,
                    timelineId: t.id,
                    field: 'endAt',
                    oldValue: old?.endAt?.toISOString() ?? null,
                    newValue: t.endAt?.toISOString() ?? null,
                    origin: RevisionOrigin.MANUAL,
                  },
                ],
              });
            } else if (old) {
              await tx.competitionTimeline.update({ where: { id: t.id }, data });
            }
          } else {
            await tx.competitionTimeline.create({ data: { competitionId: id, ...data } });
          }
        }
      }
    });

    void actorId;
    return this.prisma.competition.findUnique({
      where: { id },
      include: { levels: true, tags: true, timelines: true },
    });
  }

  async archiveCompetition(id: string) {
    await this.prisma.competition.update({ where: { id }, data: { status: PublishStatus.ARCHIVED } });
    return { archived: true };
  }

  /** 管理员删除组队帖（硬删除，级联清理成员/申请/邀请） */
  async deleteTeam(id: string) {
    const team = await this.prisma.team.findUnique({ where: { id }, select: { id: true, competition: { select: { name: true } } } });
    if (!team) throw new NotFoundException('组队帖不存在');
    await this.prisma.team.delete({ where: { id } });
    return { deleted: true, name: team.competition.name };
  }

  async adminList(query: { page: number; pageSize: number; q?: string; status?: string }) {
    const where: Prisma.CompetitionWhereInput = {};
    if (query.q) where.OR = [{ name: { contains: query.q } }, { aliases: { has: query.q } }];
    if (query.status) where.status = query.status as never;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.competition.findMany({
        where,
        include: { levels: true, tags: true, timelines: true, _count: { select: { teams: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.competition.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        ...decorateListItem(r as never),
        status: r.status,
        sourceUrl: r.sourceUrl,
        teamCount: r._count.teams,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 管理台列表项复用公开筛选（绕过 PUBLISHED 限制的简化版） */
  async adminDetail(id: string) {
    return this.prisma.competition.findUnique({
      where: { id },
      include: { levels: true, tags: true, timelines: true },
    });
  }

  // ---------- 纠错处理 ----------

  async correctionsList(query: { status?: CorrectionStatus; page: number; pageSize: number }) {
    const where: Prisma.CorrectionReportWhereInput = query.status ? { status: query.status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.correctionReport.findMany({
        where,
        include: {
          competition: { select: { id: true, name: true } },
          reporter: { select: { id: true, nickname: true, college: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.correctionReport.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** 采纳：写入目标 + isLocked + MANUAL revision；驳回：仅状态 */
  async reviewCorrection(adminId: string, reportId: string, accept: boolean, note?: string) {
    const report = await this.prisma.correctionReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('纠错不存在');
    if (report.status !== CorrectionStatus.PENDING) throw new BadRequestException('该纠错已处理');

    if (!accept) {
      await this.prisma.correctionReport.update({ where: { id: reportId }, data: { status: CorrectionStatus.REJECTED } });
      return { accepted: false };
    }
    if (report.proposedValue == null) throw new BadRequestException('该纠错未提供建议值，无法采纳');

    const [head, timelineId, tlField] = report.field.split(':');

    await this.prisma.$transaction(async (tx) => {
      if (head === 'timeline' && timelineId) {
        const tl = await tx.competitionTimeline.findUnique({ where: { id: timelineId } });
        if (!tl) throw new NotFoundException('时间节点不存在');
        const newDate = new Date(report.proposedValue!);
        if (Number.isNaN(newDate.getTime())) throw new BadRequestException('建议值不是合法日期');
        await tx.competitionTimeline.update({
          where: { id: timelineId },
          data: tlField === 'endAt' ? { endAt: newDate, isLocked: true, isAuto: false } : { startAt: newDate, isLocked: true, isAuto: false },
        });
        await tx.crawlRevision.create({
          data: {
            competitionId: report.competitionId,
            timelineId,
            field: tlField!,
            oldValue: report.currentValue,
            newValue: report.proposedValue,
            origin: RevisionOrigin.MANUAL,
          },
        });
      } else if (head === 'isBonusEligible') {
        const v = report.proposedValue!.toLowerCase() === 'true';
        await tx.competition.update({ where: { id: report.competitionId }, data: { isBonusEligible: v } });
        await tx.crawlRevision.create({
          data: {
            competitionId: report.competitionId,
            field: head,
            oldValue: report.currentValue,
            newValue: report.proposedValue,
            origin: RevisionOrigin.MANUAL,
          },
        });
      } else if (CORRECTABLE_SIMPLE.has(head)) {
        await tx.competition.update({
          where: { id: report.competitionId },
          data: { [head]: report.proposedValue } as never,
        });
        await tx.crawlRevision.create({
          data: {
            competitionId: report.competitionId,
            field: head,
            oldValue: report.currentValue,
            newValue: report.proposedValue,
            origin: RevisionOrigin.MANUAL,
          },
        });
      } else {
        throw new BadRequestException('不支持的纠错字段');
      }

      await tx.correctionReport.update({
        where: { id: reportId },
        data: { status: CorrectionStatus.ACCEPTED, note: note ?? report.note },
      });
    });

    await this.notify.notify(report.reporterId, 'CORRECTION_NEW', {
      reportId,
      accepted: true,
      message: '你提交的纠错已被采纳，感谢贡献！',
    });
    return { accepted: true };
  }

  // ---------- 版本历史与回滚 ----------

  async revisions(query: { competitionId?: string; page: number; pageSize: number }) {
    const where: Prisma.CrawlRevisionWhereInput = query.competitionId ? { competitionId: query.competitionId } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.crawlRevision.findMany({
        where,
        include: {
          competition: { select: { id: true, name: true } },
          timeline: { select: { id: true, stage: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.crawlRevision.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** 一键回滚：把字段写回旧值；回滚动作本身记为 ROLLBACK revision（ROADMAP 2.1） */
  async rollback(revisionId: string) {
    const rev = await this.prisma.crawlRevision.findUnique({ where: { id: revisionId } });
    if (!rev) throw new NotFoundException('版本记录不存在');
    if (rev.oldValue == null) throw new BadRequestException('该记录没有旧值可回滚');

    if (rev.timelineId) {
      const tl = await this.prisma.competitionTimeline.findUnique({ where: { id: rev.timelineId } });
      if (!tl) throw new NotFoundException('时间节点已不存在');
      const d = new Date(rev.oldValue);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('旧值不是合法日期');
      await this.prisma.competitionTimeline.update({
        where: { id: rev.timelineId },
        data: rev.field === 'endAt' ? { endAt: d, isLocked: true } : { startAt: d, isLocked: true },
      });
    } else if (rev.competitionId) {
      const value: string | boolean | null = rev.field === 'isBonusEligible' ? rev.oldValue.toLowerCase() === 'true' : rev.oldValue;
      await this.prisma.competition.update({
        where: { id: rev.competitionId },
        data: { [rev.field]: value } as never,
      });
    } else {
      throw new BadRequestException('该记录没有关联对象');
    }

    await this.prisma.crawlRevision.create({
      data: {
        competitionId: rev.competitionId,
        timelineId: rev.timelineId,
        field: rev.field,
        oldValue: rev.newValue,
        newValue: rev.oldValue,
        origin: RevisionOrigin.ROLLBACK,
      },
    });
    return { rolledBack: true };
  }
}

const CORRECTABLE_SIMPLE = new Set(['name', 'organizer', 'officialUrl', 'intro', 'bonusCategory', 'bonusPoints']);
