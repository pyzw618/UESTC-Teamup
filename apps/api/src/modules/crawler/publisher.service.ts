import { Injectable } from '@nestjs/common';
import { Prisma, type CompetitionTimeline } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import type { CrawlParsedItem, CompetitionMatchDecision, TimelineStageCandidate } from './crawler.types';
import { GuardService } from './guard.service';

const COMPETITION_FIELDS = ['name', 'organizer', 'officialUrl', 'intro', 'sourceUrl'] as const;
type CompetitionField = (typeof COMPETITION_FIELDS)[number];

function serialize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return serialize(left) === serialize(right);
}

function timelineWouldChange(
  existing: Pick<CompetitionTimeline, 'startAt' | 'endAt'>,
  candidate: TimelineStageCandidate,
): boolean {
  return (
    (candidate.startAt !== null && !sameValue(existing.startAt, candidate.startAt)) ||
    (candidate.endAt !== null && !sameValue(existing.endAt, candidate.endAt))
  );
}

export function isLockedTimelineChangeAllowed(
  existing: Pick<CompetitionTimeline, 'startAt' | 'endAt'> & { isLocked: boolean },
  candidate: TimelineStageCandidate,
): boolean {
  return !existing.isLocked || !timelineWouldChange(existing, candidate);
}

@Injectable()
export class PublisherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: GuardService,
  ) {}

  async publish(
    sourceId: string,
    decision: CompetitionMatchDecision,
    item: CrawlParsedItem,
  ): Promise<{ published: boolean; competitionId: string | null; changed: number }> {
    const existing =
      decision.competitionId === null
        ? null
        : await this.prisma.competition.findUnique({
            where: { id: decision.competitionId },
            include: { timelines: true },
          });

    const proposedFields: Partial<Record<CompetitionField, string>> = {
      name: item.title.trim(),
      officialUrl: item.link,
      sourceUrl: item.link,
    };
    if (item.organizer?.trim()) proposedFields.organizer = item.organizer.trim();
    if (item.content?.trim()) proposedFields.intro = item.content.trim();

    const currentFields: Record<string, unknown> = {};
    if (existing) {
      for (const field of COMPETITION_FIELDS) {
        currentFields[field] = existing[field];
      }
    }

    const fieldViolations = await this.guard.checkAndRecord(
      sourceId,
      existing?.id ?? null,
      currentFields,
      proposedFields,
    );
    if (fieldViolations.length) {
      return { published: false, competitionId: existing?.id ?? null, changed: 0 };
    }

    const timelines = existing?.timelines ?? [];
    for (const candidate of item.stages ?? []) {
      const current = timelines.find(
        (timeline) => timeline.stage === candidate.stage && timeline.level === (candidate.level ?? null),
      );
      if (!current) {
        const violations = await this.guard.checkAndRecord(
          sourceId,
          existing?.id ?? null,
          {},
          { startAt: candidate.startAt, endAt: candidate.endAt },
        );
        if (violations.length) {
          return { published: false, competitionId: existing?.id ?? null, changed: 0 };
        }
        continue;
      }

      const proposedDates: Record<string, unknown> = {};
      if (candidate.startAt) proposedDates.startAt = candidate.startAt;
      if (candidate.endAt) proposedDates.endAt = candidate.endAt;
      const violations = await this.guard.checkAndRecord(
        sourceId,
        existing?.id ?? null,
        { startAt: current.startAt, endAt: current.endAt },
        proposedDates,
      );
      if (violations.length) {
        return { published: false, competitionId: existing?.id ?? null, changed: 0 };
      }

      if (current.isLocked && timelineWouldChange(current, candidate)) {
        await this.guard.recordConflict(sourceId, current.competitionId, current.id, {
          stage: current.stage,
          currentStartAt: current.startAt,
          currentEndAt: current.endAt,
          proposedStartAt: candidate.startAt,
          proposedEndAt: candidate.endAt,
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      let competitionId = existing?.id ?? null;
      let changed = 0;

      if (!existing) {
        const data: Prisma.CompetitionUncheckedCreateInput = {
          name: item.title.trim(),
          aliases: [],
          status: 'DRAFT',
        };
        const values: Partial<Record<CompetitionField, string>> = {
          name: item.title.trim(),
          officialUrl: item.link,
          sourceUrl: item.link,
        };
        if (item.organizer?.trim()) values.organizer = item.organizer.trim();
        if (item.content?.trim()) values.intro = item.content.trim();

        for (const [field, value] of Object.entries(values)) {
          (data as Record<string, unknown>)[field] = value;
        }

        const created = await tx.competition.create({ data });
        competitionId = created.id;
        changed = Object.keys(values).length;

        await tx.crawlRevision.createMany({
          data: Object.entries(values).map(([field, value]) => ({
            competitionId: created.id,
            field,
            oldValue: null,
            newValue: serialize(value),
            origin: 'CRAWL',
          })),
        });
      } else {
        const updateData: Record<string, unknown> = {};
        const revisions: Prisma.CrawlRevisionCreateManyInput[] = [];

        for (const [field, value] of Object.entries(proposedFields)) {
          const oldValue = existing[field as CompetitionField];
          if (sameValue(oldValue, value)) continue;
          updateData[field] = value;
          revisions.push({
            competitionId: existing.id,
            field,
            oldValue: serialize(oldValue),
            newValue: serialize(value),
            origin: 'CRAWL',
          });
        }

        if (Object.keys(updateData).length) {
          updateData.lastSyncedAt = new Date();
          await tx.competition.update({
            where: { id: existing.id },
            data: updateData as Prisma.CompetitionUncheckedUpdateInput,
          });
        }
        if (revisions.length) await tx.crawlRevision.createMany({ data: revisions });
        changed = revisions.length;
      }

      for (const candidate of item.stages ?? []) {
        const current = await tx.competitionTimeline.findFirst({
          where: {
            competitionId: competitionId!,
            stage: candidate.stage,
            level: candidate.level ?? null,
          },
        });

        if (!current) {
          const createdTimeline = await tx.competitionTimeline.create({
            data: {
              competitionId: competitionId!,
              stage: candidate.stage,
              level: candidate.level ?? null,
              startAt: candidate.startAt,
              endAt: candidate.endAt,
              isAuto: true,
              isLocked: false,
            },
          });

          const revisions: Prisma.CrawlRevisionCreateManyInput[] = [];
          if (candidate.startAt) {
            revisions.push({
              timelineId: createdTimeline.id,
              field: 'startAt',
              oldValue: null,
              newValue: serialize(candidate.startAt),
              origin: 'CRAWL',
            });
          }
          if (candidate.endAt) {
            revisions.push({
              timelineId: createdTimeline.id,
              field: 'endAt',
              oldValue: null,
              newValue: serialize(candidate.endAt),
              origin: 'CRAWL',
            });
          }
          if (revisions.length) await tx.crawlRevision.createMany({ data: revisions });
          changed += 1;
          continue;
        }

        if (current.isLocked) {
          // Locked nodes are immutable to the crawler; the conflict was recorded above.
          continue;
        }

        const timelineData: Record<string, unknown> = {};
        const revisions: Prisma.CrawlRevisionCreateManyInput[] = [];
        if (candidate.startAt && !sameValue(current.startAt, candidate.startAt)) {
          timelineData.startAt = candidate.startAt;
          revisions.push({
            timelineId: current.id,
            field: 'startAt',
            oldValue: serialize(current.startAt),
            newValue: serialize(candidate.startAt),
            origin: 'CRAWL',
          });
        }
        if (candidate.endAt && !sameValue(current.endAt, candidate.endAt)) {
          timelineData.endAt = candidate.endAt;
          revisions.push({
            timelineId: current.id,
            field: 'endAt',
            oldValue: serialize(current.endAt),
            newValue: serialize(candidate.endAt),
            origin: 'CRAWL',
          });
        }

        if (Object.keys(timelineData).length) {
          timelineData.isAuto = true;
          await tx.competitionTimeline.update({
            where: { id: current.id },
            data: timelineData as Prisma.CompetitionTimelineUncheckedUpdateInput,
          });
          if (revisions.length) await tx.crawlRevision.createMany({ data: revisions });
          changed += revisions.length;
        }
      }

      return { published: true, competitionId, changed };
    });
  }
}
