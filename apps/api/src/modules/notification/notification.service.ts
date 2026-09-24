import { Injectable, Logger } from '@nestjs/common';
import { NotificationKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/**
 * 站内通知（邮件通道留空为 no-op，接入 MailProvider 后补 pushEmail）
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async notify(userId: string, kind: NotificationKind, payload: Prisma.InputJsonValue) {
    await this.prisma.notification.create({ data: { userId, kind, payload } });
  }

  async notifyMany(userIds: string[], kind: NotificationKind, payload: Prisma.InputJsonValue) {
    if (userIds.length === 0) return;
    await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({ userId, kind, payload })),
    });
  }

  /** 批量投递：每个用户 payload 不同的场景（如 DDL 提醒），一次 createMany 落库 */
  async notifyBatch(rows: Prisma.NotificationCreateManyInput[]) {
    if (rows.length === 0) return;
    await this.prisma.notification.createMany({ data: rows });
  }

  /**
   * 消息中心列表：unread=true 时只返回未读（readAt 为空）。
   * total 与 items 使用同一 where，保证分页契约一致；unread 始终是未读总数（角标用）。
   */
  async list(userId: string, query: { page: number; pageSize: number; unread?: boolean }) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unread ? { readAt: null } : {}),
    };
    const [items, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, total, unread, page: query.page, pageSize: query.pageSize };
  }

  // 邮件通道（留空）：接入后在此统一发送，避免业务代码散落
  async notifyByEmail(_to: string, _kind: string, _payload: Record<string, unknown>) {
    this.logger.debug('邮件通道未接入（本次留空），仅记录');
  }
}
