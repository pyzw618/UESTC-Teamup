import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/auth/decorators';
import { PrismaService } from '../../common/prisma.service';
import { NotificationKindLabel } from '@teamup/shared';
import type { User } from '@prisma/client';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: User, @Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    const p = Math.max(1, Number(page) || 1);
    const size = Math.min(60, Math.max(1, Number(pageSize) || 20));
    const [items, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * size,
        take: size,
      }),
      this.prisma.notification.count({ where: { userId: user.id } }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return {
      items: items.map((n) => ({ ...n, kindLabel: NotificationKindLabel[n.kind] ?? n.kind })),
      total,
      unread,
      page: p,
      pageSize: size,
    };
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: User) {
    const unread = await this.prisma.notification.count({ where: { userId: user.id, readAt: null } });
    return { unread };
  }

  @Post(':id/read')
  async read(@CurrentUser() user: User, @Param('id') id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  @Post('read-all')
  async readAll(@CurrentUser() user: User) {
    await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
