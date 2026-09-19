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

  // 邮件通道（留空）：接入后在此统一发送，避免业务代码散落
  async notifyByEmail(_to: string, _kind: string, _payload: Record<string, unknown>) {
    this.logger.debug('邮件通道未接入（本次留空），仅记录');
  }
}
