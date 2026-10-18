import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Audience,
  BonusTier,
  CompetitionFormat,
  CorrectionStatus,
  EventNodeType,
  Level,
  Prisma,
  PublishStatus,
  RevisionOrigin,
  StageKind,
  TeamStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { CompetitionsService } from '../radar/competitions.service';
import { decorateListItem } from '../radar/competitions.service';

export interface UpsertEventInput {
  id?: string;
  stageId: string;
  nodeType: EventNodeType;
  label?: string;
  startAt?: string | null;
  endAt?: string | null;
  location?: string;
}

export interface UpsertCompetitionInput {
  name: string;
  code?: string;
  /** 届次年份：同一赛事可存在多个年度档案 */
  year?: number;
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
  bonusSpecialRule?: string;
  sourceUrl?: string;
  status?: PublishStatus;
  levels?: Level[];
  tags?: string[];
  /** 时间节点：按 stageId 归属，支持增删改（人工维护赛程的核心入口） */
  events?: UpsertEventInput[];
}

/** 赛道维护入参：字段缺省表示「不改」，显式 null 表示「清空」 */
export interface TrackInput {
  code?: string;
  name?: string;
  shortName?: string | null;
  description?: string | null;
  sortOrder?: number;
  format?: CompetitionFormat | null;
  teamSizeMin?: number | null;
  teamSizeMax?: number | null;
  isActive?: boolean;
}

/** 赛程阶段维护入参；trackId = null 表示全赛事共享阶段 */
export interface StageInput {
  trackId?: string | null;
  code?: string;
  name?: string;
  stageKind?: StageKind;
  scope?: string | null;
  sequence?: number;
  bonusTier?: BonusTier | null;
  note?: string | null;
}

/** 时间节点维护入参 */
export interface EventInput {
  stageId?: string;
  nodeType?: EventNodeType;
  label?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  location?: string | null;
}

/** 竞赛主体上需要记版本的字段 */
const TRACKED_FIELDS = [
  'name',
  'year',
  'organizer',
  'officialUrl',
  'format',
  'audience',
  'intro',
  'isBonusEligible',
  'bonusCategory',
  'bonusSpecialRule',
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
    const { levels, tags, events, ...fields } = input;
    return this.prisma.$transaction(async (tx) => {
      let comp;
      try {
        comp = await tx.competition.create({
          data: {
            ...fields,
            code: fields.code ?? `C-${Date.now()}`,
            // 届次年份必填：后台未传时默认当前年份
            year: fields.year ?? new Date().getFullYear(),
            aliases: fields.aliases ?? [],
            status: fields.status ?? PublishStatus.PUBLISHED,
            levels: { create: (levels ?? []).map((level) => ({ level })) },
            tags: { create: (tags ?? []).map((tag) => ({ tag })) },
          },
        });
      } catch (e) {
        // (code, year) 唯一约束：同编号同届次已存在（Issue 10）
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new BadRequestException('该竞赛编号在此年份已存在，请换用其他编号或直接编辑已有届次');
        }
        throw e;
      }

      for (const e of events ?? []) {
        await tx.competitionEvent.create({
          data: {
            competitionId: comp.id,
            stageId: e.stageId,
            nodeType: e.nodeType,
            label: e.label ?? null,
            location: e.location ?? null,
            startAt: e.startAt ? new Date(e.startAt) : null,
            endAt: e.endAt ? new Date(e.endAt) : null,
          },
        });
      }

      return tx.competition.findUnique({
        where: { id: comp.id },
        include: { levels: true, tags: true, events: true },
      });
    });
  }

  /** 编辑：字段变更记 MANUAL revision；时间节点人工编辑自动 isLocked */
  async updateCompetition(id: string, input: UpsertCompetitionInput, actorId: string) {
    const existing = await this.prisma.competition.findUnique({
      where: { id },
      include: { events: true, levels: true, tags: true },
    });
    if (!existing) throw new NotFoundException('竞赛不存在');
    const { levels, tags, events, ...fields } = input;

    try {
      await this.prisma.$transaction(async (tx) => {
        // 主体字段 diff → MANUAL revision
        const revisions: Prisma.CompetitionRevisionCreateManyInput[] = [];
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
        if (revisions.length) await tx.competitionRevision.createMany({ data: revisions });

        await tx.competition.update({ where: { id }, data: { ...fields } });

        if (levels) {
          await tx.competitionLevel.deleteMany({ where: { competitionId: id } });
          await tx.competitionLevel.createMany({ data: levels.map((level) => ({ competitionId: id, level })) });
        }
        if (tags) {
          await tx.competitionTag.deleteMany({ where: { competitionId: id } });
          await tx.competitionTag.createMany({ data: tags.map((tag) => ({ competitionId: id, tag })) });
        }

        if (events) {
          const keepIds = new Set(events.filter((e) => e.id && !e.id.startsWith('new-')).map((e) => e.id!));
          // 删除被移除的节点（非锁定）
          for (const ev of existing.events) {
            if (!keepIds.has(ev.id) && !ev.isLocked) await tx.competitionEvent.delete({ where: { id: ev.id } });
          }
          for (const e of events) {
            const evStartAt = e.startAt ? new Date(e.startAt) : null;
            const evEndAt = e.endAt ? new Date(e.endAt) : null;
            assertDateOrder(evStartAt, evEndAt);
            const data = {
              stageId: e.stageId,
              nodeType: e.nodeType,
              label: e.label ?? null,
              location: e.location ?? null,
              startAt: evStartAt,
              endAt: evEndAt,
            };
            if (e.id && !e.id.startsWith('new-')) {
              const old = existing.events.find((x) => x.id === e.id);
              const changed =
                old &&
                (String(old.startAt ?? '') !== String(data.startAt ?? '') ||
                  String(old.endAt ?? '') !== String(data.endAt ?? '') ||
                  old.nodeType !== e.nodeType);
              if (changed) {
                // 人工修正自动加锁 + 记版本（防未来采集改回去）
                // eventId 随版本落库（Issue 15）：回滚必须精确定位到事件本身，
                // 只靠 stageId 在多事件阶段会改错节点
                await tx.competitionEvent.update({ where: { id: e.id }, data: { ...data, isLocked: true } });
                await tx.competitionRevision.createMany({
                  data: [
                    {
                      competitionId: id,
                      stageId: e.stageId,
                      eventId: e.id,
                      field: 'startAt',
                      oldValue: old?.startAt?.toISOString() ?? null,
                      newValue: data.startAt?.toISOString() ?? null,
                      origin: RevisionOrigin.MANUAL,
                    },
                    {
                      competitionId: id,
                      stageId: e.stageId,
                      eventId: e.id,
                      field: 'endAt',
                      oldValue: old?.endAt?.toISOString() ?? null,
                      newValue: data.endAt?.toISOString() ?? null,
                      origin: RevisionOrigin.MANUAL,
                    },
                  ],
                });
              } else if (old) {
                await tx.competitionEvent.update({ where: { id: e.id }, data });
              }
            } else {
              await tx.competitionEvent.create({ data: { competitionId: id, ...data } });
            }
          }
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('该竞赛编号在此年份已存在，不能重复使用');
      }
      throw e;
    }

    void actorId;
    return this.prisma.competition.findUnique({
      where: { id },
      include: {
        levels: true,
        tags: true,
        events: { include: { stage: { select: { id: true, name: true } } } },
        customFields: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  // ---------- 赛道 / 赛程阶段 / 时间节点（结构维护） ----------
  //
  // 后台此前只能改赛事级标量和「挂在已有阶段上」的时间节点：赛道只读、阶段无法新增，
  // 导致没有阶段骨架的竞赛根本没法录入赛程。这里补齐三维结构的完整增删改：
  // Competition → CompetitionTrack（赛道）→ CompetitionStage（阶段）→ CompetitionEvent（时间节点）。
  // 结构变更后重算竞赛的派生字段 hasTracks / stageChain（列表与详情页直接读这两个字段）。

  /** 重算派生字段：hasTracks（是否有赛道）与 stageChain（主链展示缓存） */
  async recomputeStructure(competitionId: string) {
    const [trackCount, sharedStages, firstTrack] = await this.prisma.$transaction([
      this.prisma.competitionTrack.count({ where: { competitionId } }),
      this.prisma.competitionStage.findMany({
        where: { competitionId, trackId: null },
        orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
        select: { name: true },
      }),
      this.prisma.competitionTrack.findFirst({
        where: { competitionId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { stages: { orderBy: [{ sequence: 'asc' }, { id: 'asc' }], select: { name: true } } },
      }),
    ]);
    // 主链优先取全赛事共享阶段；没有共享阶段时用第一条赛道的阶段链
    const source = sharedStages.length ? sharedStages : firstTrack?.stages ?? [];
    const names: string[] = [];
    for (const s of source) if (!names.includes(s.name)) names.push(s.name);
    await this.prisma.competition.update({
      where: { id: competitionId },
      data: { hasTracks: trackCount > 0, stageChain: names.length ? names.join(' → ') : null },
    });
  }

  private async requireCompetition(competitionId: string) {
    const comp = await this.prisma.competition.findUnique({ where: { id: competitionId }, select: { id: true } });
    if (!comp) throw new NotFoundException('竞赛不存在');
    return comp;
  }

  private async requireTrack(competitionId: string, trackId: string) {
    const track = await this.prisma.competitionTrack.findFirst({
      where: { id: trackId, competitionId },
      select: { id: true },
    });
    if (!track) throw new BadRequestException('赛道不存在或不属于该竞赛');
    return track;
  }

  // ----- 赛道 -----

  async createTrack(competitionId: string, input: TrackInput) {
    await this.requireCompetition(competitionId);
    const code = (input.code ?? '').trim();
    if (!code) throw new BadRequestException('赛道编码不能为空（跨届次稳定标识，如 A / PRACTICE）');
    const max = await this.prisma.competitionTrack.aggregate({
      where: { competitionId },
      _max: { sortOrder: true },
    });
    try {
      const track = await this.prisma.competitionTrack.create({
        data: {
          competitionId,
          code,
          name: (input.name ?? '').trim() || code,
          shortName: input.shortName?.trim() || null,
          description: input.description?.trim() || null,
          sortOrder: input.sortOrder ?? (max._max.sortOrder ?? -1) + 1,
          format: input.format ?? null,
          teamSizeMin: input.teamSizeMin ?? null,
          teamSizeMax: input.teamSizeMax ?? null,
          isActive: input.isActive ?? true,
        },
      });
      await this.recomputeStructure(competitionId);
      return track;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException(`赛道编码「${code}」在该竞赛下已存在`);
      }
      throw e;
    }
  }

  async updateTrack(trackId: string, input: TrackInput) {
    const track = await this.prisma.competitionTrack.findUnique({ where: { id: trackId } });
    if (!track) throw new NotFoundException('赛道不存在');

    const data: Prisma.CompetitionTrackUncheckedUpdateInput = {};
    if (input.code !== undefined) {
      const code = input.code.trim();
      if (!code) throw new BadRequestException('赛道编码不能为空');
      data.code = code;
    }
    if (input.name !== undefined) data.name = input.name.trim() || track.name;
    if (input.shortName !== undefined) data.shortName = input.shortName?.trim() || null;
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.format !== undefined) data.format = input.format;
    if (input.teamSizeMin !== undefined) data.teamSizeMin = input.teamSizeMin;
    if (input.teamSizeMax !== undefined) data.teamSizeMax = input.teamSizeMax;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    try {
      const updated = await this.prisma.competitionTrack.update({ where: { id: trackId }, data });
      await this.recomputeStructure(track.competitionId);
      return updated;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('赛道编码在该竞赛下已存在');
      }
      throw e;
    }
  }

  /** 删除赛道：其下阶段与时间节点由外键级联清理（前端需二次确认并提示影响面） */
  async deleteTrack(trackId: string) {
    const track = await this.prisma.competitionTrack.findUnique({
      where: { id: trackId },
      select: { competitionId: true, _count: { select: { stages: true } } },
    });
    if (!track) throw new NotFoundException('赛道不存在');
    await this.prisma.competitionTrack.delete({ where: { id: trackId } });
    await this.recomputeStructure(track.competitionId);
    return { deleted: true, removedStages: track._count.stages };
  }

  // ----- 赛程阶段 -----

  async createStage(competitionId: string, input: StageInput) {
    await this.requireCompetition(competitionId);
    const trackId = input.trackId ?? null;
    if (trackId) await this.requireTrack(competitionId, trackId);
    const code = (input.code ?? '').trim();
    if (!code) throw new BadRequestException('阶段编码不能为空（稳定标识，如 SIGNUP / FINAL）');
    if (!input.stageKind) throw new BadRequestException('请选择阶段类型');
    // Postgres 唯一约束在 trackId 为 NULL 时不生效，共享阶段需应用层查重
    const dup = await this.prisma.competitionStage.findFirst({
      where: { competitionId, trackId, code },
      select: { id: true },
    });
    if (dup) throw new BadRequestException(`该作用域下阶段编码「${code}」已存在`);

    const max = await this.prisma.competitionStage.aggregate({
      where: { competitionId, trackId },
      _max: { sequence: true },
    });
    const stage = await this.prisma.competitionStage.create({
      data: {
        competitionId,
        trackId,
        code,
        name: (input.name ?? '').trim() || code,
        stageKind: input.stageKind,
        scope: input.scope?.trim() || null,
        sequence: input.sequence ?? (max._max.sequence ?? -1) + 1,
        bonusTier: input.bonusTier ?? null,
        note: input.note?.trim() || null,
      },
    });
    await this.recomputeStructure(competitionId);
    return stage;
  }

  async updateStage(stageId: string, input: StageInput) {
    const stage = await this.prisma.competitionStage.findUnique({ where: { id: stageId } });
    if (!stage) throw new NotFoundException('赛程阶段不存在');

    // trackId 显式给出时校验归属，并同步该阶段下所有节点的 trackId
    let movedTrackId: string | null | undefined;
    if (input.trackId !== undefined) {
      const next = input.trackId ?? null;
      if (next) await this.requireTrack(stage.competitionId, next);
      movedTrackId = next;
    }
    const nextTrackId = movedTrackId === undefined ? stage.trackId : movedTrackId;
    const nextCode = input.code !== undefined ? input.code.trim() : stage.code;
    if (input.code !== undefined && !nextCode) throw new BadRequestException('阶段编码不能为空');
    if (input.code !== undefined || movedTrackId !== undefined) {
      const dup = await this.prisma.competitionStage.findFirst({
        where: { competitionId: stage.competitionId, trackId: nextTrackId, code: nextCode, id: { not: stageId } },
        select: { id: true },
      });
      if (dup) throw new BadRequestException(`该作用域下阶段编码「${nextCode}」已存在`);
    }

    const data: Prisma.CompetitionStageUncheckedUpdateInput = {};
    if (input.code !== undefined) data.code = nextCode;
    if (input.name !== undefined) data.name = input.name.trim() || stage.name;
    if (movedTrackId !== undefined) data.trackId = movedTrackId;
    if (input.stageKind !== undefined) data.stageKind = input.stageKind;
    if (input.scope !== undefined) data.scope = input.scope?.trim() || null;
    if (input.sequence !== undefined) data.sequence = input.sequence;
    if (input.bonusTier !== undefined) data.bonusTier = input.bonusTier;
    if (input.note !== undefined) data.note = input.note?.trim() || null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const s = await tx.competitionStage.update({ where: { id: stageId }, data });
      if (movedTrackId !== undefined && movedTrackId !== stage.trackId) {
        await tx.competitionEvent.updateMany({ where: { stageId }, data: { trackId: movedTrackId } });
      }
      return s;
    });
    await this.recomputeStructure(stage.competitionId);
    return updated;
  }

  /** 删除阶段：其下时间节点由外键级联清理 */
  async deleteStage(stageId: string) {
    const stage = await this.prisma.competitionStage.findUnique({
      where: { id: stageId },
      select: { competitionId: true, _count: { select: { events: true } } },
    });
    if (!stage) throw new NotFoundException('赛程阶段不存在');
    await this.prisma.competitionStage.delete({ where: { id: stageId } });
    await this.recomputeStructure(stage.competitionId);
    return { deleted: true, removedEvents: stage._count.events };
  }

  // ----- 时间节点 -----

  async createEvent(competitionId: string, input: EventInput) {
    if (!input.stageId) throw new BadRequestException('请选择所属阶段');
    if (!input.nodeType) throw new BadRequestException('请选择节点类型');
    const stage = await this.prisma.competitionStage.findFirst({
      where: { id: input.stageId, competitionId },
      select: { id: true, trackId: true },
    });
    if (!stage) throw new BadRequestException('阶段不存在或不属于该竞赛');
    const startAt = input.startAt ? new Date(input.startAt) : null;
    const endAt = input.endAt ? new Date(input.endAt) : null;
    assertDateOrder(startAt, endAt);
    return this.prisma.competitionEvent.create({
      data: {
        competitionId,
        stageId: stage.id,
        trackId: stage.trackId,
        nodeType: input.nodeType,
        label: input.label?.trim() || null,
        location: input.location?.trim() || null,
        startAt,
        endAt,
      },
    });
  }

  /** 修改节点：日期变化自动加锁 + 记 MANUAL 版本（与主编辑入口同口径） */
  async updateEvent(eventId: string, input: EventInput) {
    const old = await this.prisma.competitionEvent.findUnique({ where: { id: eventId } });
    if (!old) throw new NotFoundException('时间节点不存在');

    let stageId = old.stageId;
    let trackId = old.trackId;
    if (input.stageId !== undefined && input.stageId !== old.stageId) {
      const stage = await this.prisma.competitionStage.findFirst({
        where: { id: input.stageId, competitionId: old.competitionId },
        select: { id: true, trackId: true },
      });
      if (!stage) throw new BadRequestException('阶段不存在或不属于该竞赛');
      stageId = stage.id;
      trackId = stage.trackId;
    }

    const startAt = input.startAt !== undefined ? (input.startAt ? new Date(input.startAt) : null) : old.startAt;
    const endAt = input.endAt !== undefined ? (input.endAt ? new Date(input.endAt) : null) : old.endAt;
    assertDateOrder(startAt, endAt);
    const nodeType = input.nodeType ?? old.nodeType;
    const dateChanged =
      String(old.startAt ?? '') !== String(startAt ?? '') || String(old.endAt ?? '') !== String(endAt ?? '');

    const updated = await this.prisma.competitionEvent.update({
      where: { id: eventId },
      data: {
        stageId,
        trackId,
        nodeType,
        label: input.label !== undefined ? input.label?.trim() || null : old.label,
        location: input.location !== undefined ? input.location?.trim() || null : old.location,
        startAt,
        endAt,
        isLocked: dateChanged ? true : old.isLocked,
      },
    });

    if (dateChanged) {
      await this.prisma.competitionRevision.createMany({
        data: [
          {
            competitionId: old.competitionId,
            stageId,
            eventId,
            field: 'startAt',
            oldValue: old.startAt?.toISOString() ?? null,
            newValue: startAt?.toISOString() ?? null,
            origin: RevisionOrigin.MANUAL,
          },
          {
            competitionId: old.competitionId,
            stageId,
            eventId,
            field: 'endAt',
            oldValue: old.endAt?.toISOString() ?? null,
            newValue: endAt?.toISOString() ?? null,
            origin: RevisionOrigin.MANUAL,
          },
        ],
      });
    }
    return updated;
  }

  async deleteEvent(eventId: string) {
    const ev = await this.prisma.competitionEvent.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!ev) throw new NotFoundException('时间节点不存在');
    await this.prisma.competitionEvent.delete({ where: { id: eventId } });
    return { deleted: true };
  }

  // ---------- 竞赛自定义字段 ----------

  /**
   * 键名约束：1-30 字，中文 / 字母 / 数字 / 下划线 / 连字符 / 空格；
   * 值为纯文本（前端展示转义），入库前 trim，最长 500 字。
   */
  static normalizeCustomKey(key: string): string {
    const k = key.trim();
    if (!k) throw new BadRequestException('字段名不能为空');
    if (k.length > 30) throw new BadRequestException('字段名最长 30 字');
    if (!/^[\u4e00-\u9fa5A-Za-z0-9_\-\s]+$/.test(k)) {
      throw new BadRequestException('字段名只能包含中文、字母、数字、下划线、连字符');
    }
    return k;
  }

  /** 新增 / 更新单个自定义键值；每次变更写入 MANUAL revision（field = "custom:<key>"），可回滚 */
  async upsertCustomField(competitionId: string, key: string, value: string, actorId: string) {
    const k = AdminService.normalizeCustomKey(key);
    const v = value.trim();
    if (!v) throw new BadRequestException('字段值不能为空');
    if (v.length > 500) throw new BadRequestException('字段值最长 500 字');

    const competition = await this.prisma.competition.findUnique({ where: { id: competitionId }, select: { id: true } });
    if (!competition) throw new NotFoundException('竞赛不存在');

    const field = await this.prisma.competitionCustomField.upsert({
      where: { competitionId_key: { competitionId, key: k } },
      create: { competitionId, key: k, value: v, updatedById: actorId },
      update: { value: v, updatedById: actorId },
    });

    // 版本留痕（与主体字段同一套 revision 体系，origin=MANUAL，可回滚）
    const oldValue = await this.prisma.competitionRevision.findFirst({
      where: { competitionId, field: `custom:${k}` },
      orderBy: { createdAt: 'desc' },
      select: { newValue: true },
    });
    await this.prisma.competitionRevision.create({
      data: {
        competitionId,
        field: `custom:${k}`,
        oldValue: oldValue?.newValue ?? null,
        newValue: v,
        origin: RevisionOrigin.MANUAL,
      },
    });
    return field;
  }

  /** 删除自定义键值；同样留痕（newValue=null），回滚可恢复 */
  async deleteCustomField(competitionId: string, key: string) {
    const k = AdminService.normalizeCustomKey(key);
    const existing = await this.prisma.competitionCustomField.findUnique({
      where: { competitionId_key: { competitionId, key: k } },
    });
    if (!existing) throw new NotFoundException('自定义字段不存在');

    await this.prisma.$transaction([
      this.prisma.competitionCustomField.delete({ where: { id: existing.id } }),
      this.prisma.competitionRevision.create({
        data: {
          competitionId,
          field: `custom:${k}`,
          oldValue: existing.value,
          newValue: null,
          origin: RevisionOrigin.MANUAL,
        },
      }),
    ]);
    return { deleted: true };
  }

  async archiveCompetition(id: string) {
    const existing = await this.prisma.competition.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('竞赛不存在');
    await this.prisma.competition.update({ where: { id }, data: { status: PublishStatus.ARCHIVED } });
    return { archived: true };
  }

  /**
   * 管理员删除组队帖（硬删除）。
   * TeamMember 由外键级联清理；Comment / Favorite 是多态关联（无外键），需同事务手工清理，避免孤儿数据。
   */
  async deleteTeam(id: string) {
    const team = await this.prisma.team.findUnique({ where: { id }, select: { id: true, competition: { select: { name: true } } } });
    if (!team) throw new NotFoundException('组队帖不存在');
    await this.prisma.$transaction([
      this.prisma.comment.deleteMany({ where: { targetType: 'TEAM', targetId: id } }),
      this.prisma.favorite.deleteMany({ where: { targetType: 'TEAM', targetId: id } }),
      this.prisma.team.delete({ where: { id } }),
    ]);
    return { deleted: true, name: team.competition.name };
  }

  /**
   * 招募帖管理（管理员）：只做归档 / 恢复，不提供内容编辑。
   * 搜索支持竞赛名、队长昵称、学号；状态筛选按 TeamStatus。
   */
  async adminTeamsList(query: { page: number; pageSize: number; q?: string; status?: string }) {
    const where: Prisma.TeamWhereInput = {};
    if (query.q) {
      where.OR = [
        { competition: { name: { contains: query.q, mode: 'insensitive' } } },
        { leader: { nickname: { contains: query.q, mode: 'insensitive' } } },
        { leader: { studentNo: { contains: query.q, mode: 'insensitive' } } },
      ];
    }
    if (query.status && (Object.values(TeamStatus) as string[]).includes(query.status)) {
      where.status = query.status as TeamStatus;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          goal: true,
          status: true,
          deadline: true,
          createdAt: true,
          competition: { select: { id: true, name: true, year: true } },
          leader: { select: { id: true, nickname: true, studentNo: true, college: true } },
          _count: { select: { members: true, intents: true } },
        },
      }),
      this.prisma.team.count({ where }),
    ]);

    return {
      items: rows.map((t) => ({
        id: t.id,
        goal: t.goal,
        status: t.status,
        deadline: t.deadline,
        createdAt: t.createdAt,
        competition: t.competition,
        leader: t.leader,
        memberCount: 1 + t._count.members,
        intentCount: t._count.intents,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 管理员归档 / 恢复招募帖：归档即进入公共列表之外的归档仓库，恢复为招募中 */
  async setTeamArchived(id: string, archived: boolean) {
    const team = await this.prisma.team.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!team) throw new NotFoundException('招募帖不存在');

    const next = archived ? TeamStatus.DISBANDED : TeamStatus.RECRUITING;
    if (team.status !== next) {
      await this.prisma.team.update({ where: { id }, data: { status: next } });
    }
    return { id, archived, status: next };
  }

  async adminList(query: { page: number; pageSize: number; q?: string; status?: string }) {
    const where: Prisma.CompetitionWhereInput = {};
    if (query.q) where.OR = [{ name: { contains: query.q } }, { aliases: { has: query.q } }];
    if (query.status) where.status = query.status as never;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.competition.findMany({
        where,
        include: {
          levels: true,
          tags: true,
          events: { select: { id: true, nodeType: true, startAt: true, endAt: true } },
          _count: { select: { teams: true } },
        },
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

  /** 管理台详情：levels / tags 摊平成字符串数组；tracks / stages / events 供结构维护（赛道与时间节点） */
  async adminDetail(id: string) {
    const row = await this.prisma.competition.findUnique({
      where: { id },
      include: {
        levels: true,
        tags: true,
        // 赛道完整标量字段：编辑页需要 sortOrder / 赛制 / 人数等
        tracks: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        stages: {
          orderBy: [{ sequence: 'asc' }],
          include: { events: { orderBy: [{ startAt: 'asc' }] } },
        },
        // 顶层事件列表：编辑页直接以此初始化（含 stageId，提交时原样回传）
        events: { orderBy: [{ startAt: 'asc' }, { endAt: 'asc' }] },
        customFields: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) return null;
    return {
      ...row,
      levels: row.levels.map((l) => l.level),
      tags: row.tags.map((t) => t.tag),
    };
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

    const [head, eventId, evField] = report.field.split(':');

    // 纵深防御：URL 类字段采纳前再次校验 scheme
    if (URL_FIELDS.has(head)) assertHttpUrl(report.proposedValue);

    await this.prisma.$transaction(async (tx) => {
      if (head === 'event' && eventId) {
        const ev = await tx.competitionEvent.findUnique({ where: { id: eventId } });
        if (!ev) throw new NotFoundException('时间节点不存在');
        const newDate = new Date(report.proposedValue!);
        if (Number.isNaN(newDate.getTime())) throw new BadRequestException('建议值不是合法日期');
        await tx.competitionEvent.update({
          where: { id: eventId },
          data: evField === 'endAt' ? { endAt: newDate, isLocked: true } : { startAt: newDate, isLocked: true },
        });
        await tx.competitionRevision.create({
          data: {
            competitionId: report.competitionId,
            stageId: ev.stageId,
            eventId: ev.id,
            field: evField!,
            oldValue: report.currentValue,
            newValue: report.proposedValue,
            origin: RevisionOrigin.MANUAL,
          },
        });
      } else if (head === 'isBonusEligible') {
        const v = report.proposedValue!.toLowerCase() === 'true';
        await tx.competition.update({ where: { id: report.competitionId }, data: { isBonusEligible: v } });
        await tx.competitionRevision.create({
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
        await tx.competitionRevision.create({
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

    void adminId;
    await this.notify.notify(report.reporterId, 'CORRECTION_NEW', {
      reportId,
      accepted: true,
      message: '你提交的纠错已被采纳，感谢贡献！',
    });
    return { accepted: true };
  }

  // ---------- 版本历史与回滚 ----------

  async revisions(query: { competitionId?: string; page: number; pageSize: number }) {
    const where: Prisma.CompetitionRevisionWhereInput = query.competitionId ? { competitionId: query.competitionId } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.competitionRevision.findMany({
        where,
        include: {
          competition: { select: { id: true, name: true } },
          stage: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.competitionRevision.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /**
   * 一键回滚：把字段写回旧值；回滚动作本身记为 ROLLBACK revision（Issue 15）。
   * 时间节点字段优先按 eventId 精确定位 —— 一个阶段可以有多个事件，只按 stageId
   * 取「最近更新的一条」会改错节点；eventId 缺失的存量记录回退 stageId 口径。
   * 回滚写入与 ROLLBACK 版本记录在同一事务中完成。
   */
  async rollback(revisionId: string) {
    const rev = await this.prisma.competitionRevision.findUnique({ where: { id: revisionId } });
    if (!rev) throw new NotFoundException('版本记录不存在');
    if (rev.oldValue == null) throw new BadRequestException('该记录没有旧值可回滚');

    if (rev.field.startsWith('custom:')) {
      // 自定义字段回滚：写回旧值；旧值为空表示该键当时不存在 → 删除
      if (!rev.competitionId) throw new BadRequestException('该记录没有关联对象');
      const key = rev.field.slice('custom:'.length);
      await this.prisma.$transaction(async (tx) => {
        if (rev.oldValue!.trim()) {
          await tx.competitionCustomField.upsert({
            where: { competitionId_key: { competitionId: rev.competitionId!, key } },
            create: { competitionId: rev.competitionId!, key, value: rev.oldValue! },
            update: { value: rev.oldValue! },
          });
        } else {
          await tx.competitionCustomField.deleteMany({
            where: { competitionId: rev.competitionId!, key },
          });
        }
        await tx.competitionRevision.create({ data: this.rollbackRevisionOf(rev) });
      });
    } else if (rev.eventId || rev.stageId) {
      // 时间节点字段：优先按 eventId 精确定位（Issue 15），存量无 eventId 的记录
      // 回退为「该阶段最近更新的一条」（旧口径，仅用于历史数据）
      await this.prisma.$transaction(async (tx) => {
        const ev = rev.eventId
          ? await tx.competitionEvent.findFirst({
              where: { id: rev.eventId, competitionId: rev.competitionId ?? undefined },
            })
          : await tx.competitionEvent.findFirst({
              where: { competitionId: rev.competitionId ?? undefined, stageId: rev.stageId ?? undefined },
              orderBy: { updatedAt: 'desc' },
            });
        if (!ev) throw new NotFoundException('时间节点已不存在');
        const d = new Date(rev.oldValue!);
        if (Number.isNaN(d.getTime())) throw new BadRequestException('旧值不是合法日期');
        await tx.competitionEvent.update({
          where: { id: ev.id },
          data: rev.field === 'endAt' ? { endAt: d, isLocked: true } : { startAt: d, isLocked: true },
        });
        await tx.competitionRevision.create({
          data: { ...this.rollbackRevisionOf(rev), eventId: ev.id },
        });
      });
    } else if (rev.competitionId) {
      let value: string | boolean | number = rev.oldValue;
      if (rev.field === 'isBonusEligible') value = rev.oldValue.toLowerCase() === 'true';
      // Int 字段：Prisma 不接受字符串，需转回数字
      else if (rev.field === 'year') {
        const y = Number(rev.oldValue);
        if (!Number.isInteger(y)) throw new BadRequestException('旧值不是合法年份');
        value = y;
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.competition.update({
          where: { id: rev.competitionId! },
          data: { [rev.field]: value } as never,
        });
        await tx.competitionRevision.create({ data: this.rollbackRevisionOf(rev) });
      });
    } else {
      throw new BadRequestException('该记录没有关联对象');
    }
    return { rolledBack: true };
  }

  /** ROLLBACK 版本记录：与被回滚记录同字段/同定位，旧值新值互换 */
  private rollbackRevisionOf(rev: {
    competitionId: string | null;
    stageId: string | null;
    field: string;
    oldValue: string | null;
    newValue: string | null;
  }) {
    return {
      competitionId: rev.competitionId,
      stageId: rev.stageId,
      field: rev.field,
      oldValue: rev.newValue,
      newValue: rev.oldValue,
      origin: RevisionOrigin.ROLLBACK,
    };
  }
}

const CORRECTABLE_SIMPLE = new Set(['name', 'organizer', 'officialUrl', 'intro', 'bonusCategory', 'bonusSpecialRule']);

/** 时间节点区间校验：前端已拦，但接口可被直接调用，服务端必须自己兜底 */
function assertDateOrder(startAt: Date | null, endAt: Date | null): void {
  if (startAt && endAt && endAt.getTime() < startAt.getTime()) {
    throw new BadRequestException('截止时间不能早于开始时间');
  }
}

/** URL 类字段：采纳写入前必须校验 scheme，只允许 http/https */
const URL_FIELDS = new Set(['officialUrl', 'sourceUrl']);

function assertHttpUrl(value: string): void {
  if (!/^https?:\/\//i.test(value.trim())) {
    throw new BadRequestException('链接必须以 http:// 或 https:// 开头');
  }
}
