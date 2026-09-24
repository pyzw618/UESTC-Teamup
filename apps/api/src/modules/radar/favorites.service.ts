import { Injectable } from '@nestjs/common';
import { CommentTarget } from '@teamup/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/** 唯一键冲突（并发下另一个请求已插入） */
const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
/** 目标行不存在（并发下已被另一个请求删除） */
const isRecordNotFound = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * toggle：关注竞赛（=接收 DDL 提醒）或收藏。
   * 联合主键天然防重，写操作直接执行并捕获 P2002 / P2025 视为幂等成功，
   * 避免 check-then-act 竞态下并发请求 500。
   */
  async toggle(userId: string, targetType: CommentTarget, targetId: string) {
    const key = { userId_targetType_targetId: { userId, targetType, targetId } };
    const existing = await this.prisma.favorite.findUnique({ where: key });
    if (existing) {
      try {
        await this.prisma.favorite.delete({ where: key });
      } catch (e) {
        if (!isRecordNotFound(e)) throw e; // 已被并发取消 → 幂等
      }
      return { favorited: false };
    }
    try {
      await this.prisma.favorite.create({ data: { userId, targetType, targetId } });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // 已被并发创建 → 幂等
    }
    return { favorited: true };
  }

  async listMine(userId: string, targetType?: CommentTarget) {
    const rows = await this.prisma.favorite.findMany({
      where: { userId, ...(targetType ? { targetType } : {}) },
      orderBy: { createdAt: 'desc' },
    });

    // 批量装填目标摘要
    const compIds = rows.filter((r) => r.targetType === 'COMPETITION').map((r) => r.targetId);
    const teamIds = rows.filter((r) => r.targetType === 'TEAM').map((r) => r.targetId);
    const [comps, teams] = await Promise.all([
      compIds.length
        ? this.prisma.competition.findMany({
            where: { id: { in: compIds } },
            select: { id: true, name: true, levels: true },
          })
        : Promise.resolve([] as { id: string; name: string; levels: { level: never }[] }[]),
      teamIds.length
        ? this.prisma.team.findMany({
            where: { id: { in: teamIds } },
            select: { id: true, goal: true, status: true, competition: { select: { id: true, name: true } } },
          })
        : Promise.resolve(
            [] as { id: string; goal: string; status: string; competition: { id: string; name: string } }[],
          ),
    ]);

    return rows.map((r) => {
      if (r.targetType === 'COMPETITION') {
        const c = comps.find((x) => x.id === r.targetId);
        return { ...r, competition: c ?? null };
      }
      if (r.targetType === 'TEAM') {
        const t = teams.find((x) => x.id === r.targetId);
        return { ...r, team: t ?? null };
      }
      return { ...r, post: null };
    });
  }
}
