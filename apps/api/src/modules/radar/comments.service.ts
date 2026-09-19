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
      include: { author: true },
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

    return { ...comment, author: this.stripAuthor(comment.author), likes: 0, liked: false };
  }

  async list(targetType: CommentTarget, targetId: string, viewerId?: string) {
    const rows = await this.prisma.comment.findMany({
      where: { targetType, targetId, parentId: null },
      orderBy: [{ likes: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      include: { author: true },
    });
    const ids = rows.map((r) => r.id);
    const replies = ids.length
      ? await this.prisma.comment.findMany({
          where: { parentId: { in: ids } },
          orderBy: { createdAt: 'asc' },
          include: { author: true },
        })
      : [];

    const likedIds = await this.likedCommentIds(viewerId, [...ids, ...replies.map((r) => r.id)]);

    const shape = (c: (typeof rows)[number]) => ({
      id: c.id,
      content: c.content,
      parentId: c.parentId,
      likes: c.likes,
      liked: likedIds.has(c.id),
      createdAt: c.createdAt,
      author: this.stripAuthor(c.author),
    });

    return rows.map((r) => ({ ...shape(r), replies: replies.filter((x) => x.parentId === r.id).map(shape) }));
  }

  /** 点赞 / 取消点赞（幂等切换），返回最新状态 */
  async toggleLike(userId: string, commentId: string) {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('评论不存在');

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.commentLike.findUnique({
        where: { userId_commentId: { userId, commentId } },
      });
      if (existing) {
        await tx.commentLike.delete({ where: { userId_commentId: { userId, commentId } } });
        const updated = await tx.comment.update({
          where: { id: commentId },
          data: { likes: { decrement: 1 } },
          select: { likes: true },
        });
        return { liked: false, likes: Math.max(0, updated.likes) };
      }
      await tx.commentLike.create({ data: { userId, commentId } });
      const updated = await tx.comment.update({
        where: { id: commentId },
        data: { likes: { increment: 1 } },
        select: { likes: true },
      });
      return { liked: true, likes: updated.likes };
    });
  }

  async delete(userId: string, id: string) {
    const comment = await this.prisma.comment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException();
    if (comment.authorId !== userId) throw new ForbiddenException('只能删除自己的评论');
    await this.prisma.comment.delete({ where: { id } });
    await this.prisma.comment.deleteMany({ where: { parentId: id } });
    return { deleted: true };
  }

  /** 当前用户点过赞的评论集合 */
  private async likedCommentIds(viewerId: string | undefined, commentIds: string[]): Promise<Set<string>> {
    if (!viewerId || !commentIds.length) return new Set();
    const rows = await this.prisma.commentLike.findMany({
      where: { userId: viewerId, commentId: { in: commentIds } },
      select: { commentId: true },
    });
    return new Set(rows.map((r) => r.commentId));
  }

  private stripAuthor(author: { id: string; nickname: string | null; college: string | null; grade: number | null; major: string | null }) {
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
      if (!(await this.prisma.team.findUnique({ where: { id: targetId } }))) throw new NotFoundException('招募帖不存在');
    } else if (targetType === CommentTarget.POST) {
      if (!(await this.prisma.post.findUnique({ where: { id: targetId } }))) throw new NotFoundException('帖子不存在');
    }
  }
}
