import { Injectable } from '@nestjs/common';
import { CommentTarget } from '@teamup/shared';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  /** toggle：关注竞赛（=接收 DDL 提醒）或收藏 */
  async toggle(userId: string, targetType: CommentTarget, targetId: string) {
    const existing = await this.prisma.favorite.findUnique({
      where: { userId_targetType_targetId: { userId, targetType, targetId } },
    });
    if (existing) {
      await this.prisma.favorite.delete({
        where: { userId_targetType_targetId: { userId, targetType, targetId } },
      });
      return { favorited: false };
    }
    await this.prisma.favorite.create({ data: { userId, targetType, targetId } });
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
