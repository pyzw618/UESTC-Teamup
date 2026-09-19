import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 当前生效的公告（站内横幅） */
  async active() {
    return this.prisma.announcement.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async adminList() {
    return this.prisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  }

  async create(adminId: string, dto: { title: string; content: string }) {
    // 新公告发布时自动下线旧公告（站内只展示一条横幅）
    await this.prisma.announcement.updateMany({ where: { active: true }, data: { active: false } });
    const ann = await this.prisma.announcement.create({
      data: { title: dto.title, content: dto.content, createdBy: adminId },
    });

    // 同步投递到全体用户的消息中心（SYSTEM_NOTIFICATION），横幅只在首页弹一次
    const users = await this.prisma.user.findMany({ where: { banned: false }, select: { id: true } });
    if (users.length) {
      await this.prisma.notification.createMany({
        data: users.map((u) => ({
          userId: u.id,
          kind: NotificationKind.SYSTEM_NOTIFICATION,
          payload: { announcementId: ann.id, title: ann.title, content: ann.content },
        })),
      });
    }
    return ann;
  }

  async toggle(id: string) {
    const ann = await this.prisma.announcement.findUnique({ where: { id } });
    if (!ann) throw new NotFoundException('公告不存在');
    if (!ann.active) {
      await this.prisma.announcement.updateMany({ where: { active: true }, data: { active: false } });
    }
    return this.prisma.announcement.update({ where: { id }, data: { active: !ann.active } });
  }

  async remove(id: string) {
    await this.prisma.announcement.delete({ where: { id } });
    return { deleted: true };
  }
}
