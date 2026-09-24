import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser } from '../../common/auth/decorators';
import { PrismaService } from '../../common/prisma.service';
import { TransformBoolean } from '../../common/query.transform';
import { NotificationService } from './notification.service';
import { NotificationKindLabel } from '@teamup/shared';
import type { User } from '@prisma/client';

class ListNotificationsDto {
  @IsOptional() @IsInt() @Min(1) page: number = 1;
  @IsOptional() @IsInt() @Min(1) @Max(60) pageSize: number = 20;
  /**
   * 只看未读：unread=true / unread=1。
   * TransformBoolean 已改为从原始 plain object 取值，可安全声明为 boolean
   * （隐式转换陷阱见 common/query.transform.ts 内注释）。
   */
  @IsOptional() @TransformBoolean() unread?: boolean;
}

@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  @Get()
  async list(@CurrentUser() user: User, @Query() query: ListNotificationsDto) {
    const p = Math.max(1, Number(query.page) || 1);
    const size = Math.min(60, Math.max(1, Number(query.pageSize) || 20));
    const result = await this.notifications.list(user.id, { page: p, pageSize: size, unread: query.unread });
    return {
      ...result,
      items: result.items.map((n) => ({ ...n, kindLabel: NotificationKindLabel[n.kind] ?? n.kind })),
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
