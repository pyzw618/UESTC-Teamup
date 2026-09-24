import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 用户举报（队伍招募帖 / 评论 / 帖子）；同一用户对同一目标仅一条未处理举报 */
  async submit(
    reporterId: string,
    dto: { targetType: 'TEAM' | 'COMMENT' | 'POST'; targetId: string; reason: string },
  ) {
    const { targetType, targetId } = dto;
    const reason = dto.reason?.trim() || '未填写原因';
    if (reason.length > 500) throw new BadRequestException('举报原因最多 500 字');

    // 目标存在性校验
    if (targetType === 'TEAM') {
      if (!(await this.prisma.team.findUnique({ where: { id: targetId } })))
        throw new NotFoundException('举报对象不存在');
    } else if (targetType === 'COMMENT') {
      if (!(await this.prisma.comment.findUnique({ where: { id: targetId } })))
        throw new NotFoundException('举报对象不存在');
    } else if (targetType === 'POST') {
      if (!(await this.prisma.post.findUnique({ where: { id: targetId } })))
        throw new NotFoundException('举报对象不存在');
    }

    const dup = await this.prisma.report.findFirst({
      where: { reporterId, targetType, targetId, handled: false },
    });
    if (dup) throw new BadRequestException('你已举报过该内容，请等待管理员处理');

    return this.prisma.report.create({
      data: { reporterId, targetType, targetId, reason },
    });
  }

  async adminList(query: { handled?: boolean; page: number; pageSize: number }) {
    const where = query.handled === undefined ? {} : { handled: query.handled };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.report.count({ where }),
    ]);

    // 批量装填目标摘要
    const teamIds = items.filter((r) => r.targetType === 'TEAM').map((r) => r.targetId);
    const commentIds = items.filter((r) => r.targetType === 'COMMENT').map((r) => r.targetId);
    const [teams, comments, reporters] = await Promise.all([
      teamIds.length
        ? this.prisma.team.findMany({
            where: { id: { in: teamIds } },
            include: { competition: { select: { name: true } }, leader: { select: { nickname: true } } },
          })
        : Promise.resolve([] as { id: string; competition: { name: string }; leader: { nickname: string | null }; status: string }[]),
      commentIds.length
        ? this.prisma.comment.findMany({ where: { id: { in: commentIds } } })
        : Promise.resolve([] as { id: string; content: string }[]),
      this.prisma.user.findMany({
        where: { id: { in: items.map((r) => r.reporterId) } },
        select: { id: true, nickname: true, college: true },
      }),
    ]);

    return {
      items: items.map((r) => ({
        ...r,
        reporter: reporters.find((u) => u.id === r.reporterId) ?? null,
        team:
          r.targetType === 'TEAM'
            ? (() => {
                const t = teams.find((x) => x.id === r.targetId);
                return t ? { id: t.id, name: t.competition.name, leader: t.leader.nickname, status: t.status } : null;
              })()
            : null,
        comment:
          r.targetType === 'COMMENT'
            ? (() => {
                const c = comments.find((x) => x.id === r.targetId);
                return c ? { id: c.id, content: c.content.slice(0, 120) } : null;
              })()
            : null,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * 处理举报：
   * - dismiss：驳回（仅标记已处理）
   * - delete-content：删除被举报内容（组队帖 = 删除队伍；评论 = 删除评论）并标记已处理
   */
  async handle(reportId: string, action: 'dismiss' | 'delete-content') {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('举报不存在');
    if (report.handled) throw new BadRequestException('该举报已处理');

    if (action === 'delete-content') {
      if (report.targetType === 'TEAM') {
        const team = await this.prisma.team.findUnique({ where: { id: report.targetId } });
        if (team) {
          // Comment / Favorite 为多态关联（无外键），删除帖子时同事务清理，避免孤儿数据
          await this.prisma.$transaction([
            this.prisma.comment.deleteMany({ where: { targetType: 'TEAM', targetId: report.targetId } }),
            this.prisma.favorite.deleteMany({ where: { targetType: 'TEAM', targetId: report.targetId } }),
            this.prisma.team.delete({ where: { id: report.targetId } }),
          ]);
        }
      } else if (report.targetType === 'COMMENT') {
        // 主评论与楼中楼回复必须同一事务删除，避免只删一半
        await this.prisma.$transaction([
          this.prisma.comment.deleteMany({ where: { id: report.targetId } }),
          this.prisma.comment.deleteMany({ where: { parentId: report.targetId } }),
        ]);
      } else if (report.targetType === 'POST') {
        await this.prisma.post.deleteMany({ where: { id: report.targetId } });
      }
    }

    await this.prisma.report.update({ where: { id: reportId }, data: { handled: true } });
    return { handled: true, deletedContent: action === 'delete-content' };
  }
}
