import { Injectable } from '@nestjs/common';
import { Prisma, type Competition } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import type { GuardRuleViolation } from './crawler.types';

type GuardRecord = Record<string, unknown>;

function dateValue(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function jsonSafe(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]),
    );
  }
  return value;
}

export function evaluateGuardRules(
  current: GuardRecord,
  proposed: GuardRecord,
  now = new Date(),
): GuardRuleViolation[] {
  const violations: GuardRuleViolation[] = [];
  const merged: GuardRecord = { ...current, ...proposed };
  const minimumDate = now.getTime() - 365 * 24 * 60 * 60 * 1_000;
  const maximumDate = now.getTime() + 5 * 365 * 24 * 60 * 60 * 1_000;

  for (const [field, proposedValue] of Object.entries(proposed)) {
    const currentValue = current[field];

    if (proposedValue === null && currentValue !== null && currentValue !== undefined) {
      violations.push({
        rule: 'null-overwrite',
        field,
        currentValue,
        proposedValue,
        message: `Crawler refused to replace existing ${field} with null`,
      });
      continue;
    }

    if (!/(?:At|Date)$/i.test(field) || proposedValue == null) continue;

    const candidateDate = dateValue(proposedValue);
    if (!candidateDate) {
      violations.push({
        rule: 'date-out-of-range',
        field,
        currentValue,
        proposedValue,
        message: `Crawler proposed an invalid date for ${field}`,
      });
      continue;
    }

    if (candidateDate.getUTCFullYear() === 1970 || candidateDate.getTime() === 0) {
      violations.push({
        rule: 'epoch-date',
        field,
        currentValue,
        proposedValue,
        message: `Crawler proposed an epoch date for ${field}`,
      });
    }

    if (candidateDate.getTime() < minimumDate || candidateDate.getTime() > maximumDate) {
      violations.push({
        rule: 'date-out-of-range',
        field,
        currentValue,
        proposedValue,
        message: `Crawler proposed an out-of-range date for ${field}`,
      });
    }

    const existingDate = dateValue(currentValue);
    if (
      existingDate &&
      Math.abs(candidateDate.getTime() - existingDate.getTime()) > 180 * 24 * 60 * 60 * 1_000
    ) {
      violations.push({
        rule: 'jump-too-large',
        field,
        currentValue,
        proposedValue,
        message: `Crawler proposed a date jump greater than 180 days for ${field}`,
      });
    }
  }

  const startAt = dateValue(merged.startAt);
  const endAt = dateValue(merged.endAt);
  if (startAt && endAt && endAt.getTime() < startAt.getTime()) {
    violations.push({
      rule: 'end-before-start',
      field: 'endAt',
      currentValue: current.endAt,
      proposedValue: proposed.endAt,
      message: 'Timeline endAt must not be earlier than startAt',
    });
  }

  return violations;
}

@Injectable()
export class GuardService {
  constructor(private readonly prisma: PrismaService) {}

  async checkAndRecord(
    sourceId: string,
    competitionId: string | null,
    current: GuardRecord,
    proposed: GuardRecord,
  ): Promise<GuardRuleViolation[]> {
    const violations = evaluateGuardRules(current, proposed);
    for (const violation of violations) {
      await this.prisma.crawlAnomaly.create({
        data: {
          sourceId,
          competitionId,
          rule: violation.rule,
          payload: {
            field: violation.field,
            currentValue: jsonSafe(violation.currentValue) as Prisma.InputJsonValue,
            proposedValue: jsonSafe(violation.proposedValue) as Prisma.InputJsonValue,
            message: violation.message,
          },
        },
      });
    }
    return violations;
  }

  async recordConflict(
    sourceId: string,
    competitionId: string,
    timelineId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.crawlAnomaly.create({
      data: {
        sourceId,
        competitionId,
        rule: 'locked-timeline-conflict',
        payload: jsonSafe({ timelineId, ...payload }) as Prisma.InputJsonValue,
      },
    });
  }

  async currentCompetition(competitionId: string): Promise<Competition | null> {
    return this.prisma.competition.findUnique({ where: { id: competitionId } });
  }
}
