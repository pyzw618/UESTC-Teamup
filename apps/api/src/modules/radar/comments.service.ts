import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CommentTarget } from '@teamup/shared';
import { PrismaService } from '../../common/prisma.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
  ) {}

  /** 多态评论（Q7）：存在性校验在应用层 */
  async create(authorId: string, dto: { targetType: CommentTarget; targetId: string; content: string; parentId?: string }) {
    await this.assertTarget(dto.targetType, dto.targetId);

    if (dto.parentId) {
      const parent = await this.prisma.comment.findUnique({ where: { id: dto.parentId } });
      if (!parent || parent.targetId !== dto.targetId) throw new BadRequestException('父评论不存在');
    }

    const comment = await this.prisma.comment.create({
      data: {
        authorId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        content: dto.content,
        parentId: dto.parentId ?? null,
      },
      include: { author: { include: { memberships: { select: { teamId: true } } } } },
    });

    // 楼中楼回复通知
    if (dto.parentId) {
      const parent = await this.prisma.comment.findUnique({ where: { id: dto.parentId } });
      if (parent && parent.authorId !== authorId) {
        await this.notify.notify(parent.authorId, 'COMMENT_REPLY', {
          targetType: dto.targetType,
          targetId: dto.targetId,
          commentId: comment.id,
        });
      }
    }

    return { ...comment, author: this.stripAuthor(comment.author) };
  }

  async list(targetType: CommentTarget, targetId: string) {
    const rows = await this.prisma.comment.findMany({
      where: { targetType, targetId, parentId: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        author: { include: { memberships: { select: { teamId: true } } } },
      },
    });
    const ids = rows.map((r) => r.id);
    const replies = ids.length
      ? await this.prisma.comment.findMany({
          where: { parentId: { in: ids } },
          orderBy: { createdAt: 'asc' },
          include: { author: { include: { memberships: { select: { teamId: true } } } } },
        })
      : [];

    const shape = (c: (typeof rows)[number]) => ({
      id: c.id,
      content: c.content,
      parentId: c.parentId,
      createdAt: c.createdAt,
      author: this.stripAuthor(c.author),
    });

    return rows.map((r) => ({ ...shape(r), replies: replies.filter((x) => x.parentId === r.id).map(shape) }));
  }

  async delete(userId: string, id: string) {
    const comment = await this.prisma.comment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException();
    if (comment.authorId !== userId) throw new ForbiddenException('只能删除自己的评论');
    await this.prisma.comment.delete({ where: { id } });
    await this.prisma.comment.deleteMany({ where: { parentId: id } });
    return { deleted: true };
  }

  private stripAuthor(author: { id: string; nickname: string | null; college: string | null; grade: number | null; major: string | null; memberships: { teamId: string }[] }) {
    // 公开评论区一律半匿名（评论不是队内场景）
    return {
      id: author.id,
      nickname: author.nickname,
      college: author.college,
      grade: author.grade,
      major: author.major,
    };
  }

  private async assertTarget(targetType: CommentTarget, targetId: string) {
    if (targetType === CommentTarget.COMPETITION) {
      if (!(await this.prisma.competition.findUnique({ where: { id: targetId } })))
        throw new NotFoundException('竞赛不存在');
    } else if (targetType === CommentTarget.TEAM) {
      if (!(await this.prisma.team.findUnique({ where: { id: targetId } }))) throw new NotFoundException('队伍不存在');
    } else if (targetType === CommentTarget.POST) {
      if (!(await this.prisma.post.findUnique({ where: { id: targetId } }))) throw new NotFoundException('帖子不存在');
    }
  }
}
