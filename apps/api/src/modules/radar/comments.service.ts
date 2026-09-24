import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CommentTarget } from '@teamup/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { NotificationService } from '../notification/notification.service';

/** 评论发布限流：每分钟上限 */
const COMMENT_RATE_LIMIT = 10;

/** 唯一键冲突（并发下另一个请求已点赞） */
const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
/** 目标行不存在（并发下已被另一个请求取消点赞） */
const isRecordNotFound = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025';

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
    private readonly redis: RedisService,
  ) {}

  /** 多态评论（Q7）：存在性校验在应用层 */
  async create(authorId: string, dto: { targetType: CommentTarget; targetId: string; content: string; parentId?: string }) {
    // UGC 限流：10 条/分钟（M14）
    const hits = await this.redis.incrWithTtl(`rl:comment:create:${authorId}`, 60);
    if (hits > COMMENT_RATE_LIMIT) throw new BadRequestException('操作太频繁，请稍后再试');

    await this.assertTarget(dto.targetType, dto.targetId);

    // 楼中楼拍平：回复的回复挂到根评论下，真实回复对象记在 replyToId
    let rootId: string | null = null;
    let replyToId: string | null = null;
    if (dto.parentId) {
      const parent = await this.prisma.comment.findUnique({ where: { id: dto.parentId } });
      if (!parent || parent.targetId !== dto.targetId) throw new BadRequestException('父评论不存在');
      rootId = parent.parentId ?? parent.id;
      replyToId = parent.parentId ? parent.id : null;
    }

    const comment = await this.prisma.comment.create({
      data: {
        authorId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        content: dto.content,
        parentId: rootId,
        replyToId,
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

    // 批量取「回复的回复」的真实对象昵称（replyToId 指向的评论作者）
    const replyToIds = [...new Set(replies.map((r) => r.replyToId).filter((x): x is string => !!x))];
    const replyToAuthors = replyToIds.length
      ? await this.prisma.comment.findMany({
          where: { id: { in: replyToIds } },
          select: { id: true, author: { select: { nickname: true } } },
        })
      : [];
    const replyToMap = new Map(replyToAuthors.map((a) => [a.id, a.author.nickname]));

    const shape = (c: (typeof rows)[number]) => ({
      id: c.id,
      content: c.content,
      parentId: c.parentId,
      replyTo: c.replyToId ? { id: c.replyToId, nickname: replyToMap.get(c.replyToId) ?? null } : null,
      likes: c.likes,
      liked: likedIds.has(c.id),
      createdAt: c.createdAt,
      author: this.stripAuthor(c.author),
    });

    return rows.map((r) => ({ ...shape(r), replies: replies.filter((x) => x.parentId === r.id).map(shape) }));
  }

  /**
   * 点赞 / 取消点赞（幂等切换），返回最新状态。
   * 不再「事务内先读后写」：两个并发事务都能通过读检查，最终仍会撞联合主键。
   * 改为让数据库唯一键裁决 —— create 撞 P2002 即视为已点赞，delete 撞 P2025 即视为已取消，
   * 计数只在写入真正成功时增减，避免并发下计数漂移。
   */
  async toggleLike(userId: string, commentId: string) {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId }, select: { id: true } });
    if (!comment) throw new NotFoundException('评论不存在');

    const key = { userId_commentId: { userId, commentId } };
    try {
      // 点赞行与计数同事务：唯一键冲突时整体回滚，计数不会因半途失败而漂移
      const [, updated] = await this.prisma.$transaction([
        this.prisma.commentLike.create({ data: { userId, commentId } }),
        this.prisma.comment.update({
          where: { id: commentId },
          data: { likes: { increment: 1 } },
          select: { likes: true },
        }),
      ]);
      return { liked: true, likes: updated.likes };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // 已点赞 → 本次视为取消
      try {
        const [, updated] = await this.prisma.$transaction([
          this.prisma.commentLike.delete({ where: key }),
          this.prisma.comment.update({
            where: { id: commentId },
            data: { likes: { decrement: 1 } },
            select: { likes: true },
          }),
        ]);
        return { liked: false, likes: Math.max(0, updated.likes) };
      } catch (e2) {
        if (!isRecordNotFound(e2)) throw e2;
        // 已被并发取消：计数未被触碰，直接回读当前值
        const current = await this.prisma.comment.findUnique({ where: { id: commentId }, select: { likes: true } });
        return { liked: false, likes: Math.max(0, current?.likes ?? 0) };
      }
    }
  }

  /** 删除评论：主评论与楼中楼回复同一事务删除；作者本人或管理员可删 */
  async delete(userId: string, id: string, viewerRole?: string) {
    const comment = await this.prisma.comment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException();
    if (comment.authorId !== userId && viewerRole !== 'ADMIN') {
      throw new ForbiddenException('只能删除自己的评论');
    }
    await this.prisma.$transaction([
      this.prisma.comment.delete({ where: { id } }),
      this.prisma.comment.deleteMany({ where: { parentId: id } }),
    ]);
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
