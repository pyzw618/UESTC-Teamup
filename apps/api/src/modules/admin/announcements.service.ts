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

  /**
   * 编辑公告（展示中的也能改）。
   * 发布时正文已随消息中心的通知一起投递，只改公告表会让「站内横幅」与「消息中心历史」
   * 说两套话，所以同事务把仍指向本条公告的通知 payload 一并改掉。
   */
  async update(id: string, dto: { title: string; content: string }) {
    const ann = await this.prisma.announcement.findUnique({ where: { id }, select: { id: true } });
    if (!ann) throw new NotFoundException('公告不存在');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.announcement.update({
        where: { id },
        data: { title: dto.title, content: dto.content },
      });
      // payload 是部署在 Postgres 的 jsonb，用 || 合并而不是整条覆盖：
      // announcementId 是投递锚点，丢了就再也关联不上后续编辑
      await tx.$executeRaw`
        UPDATE "Notification"
        SET payload = payload || jsonb_build_object('title', ${dto.title}::text, 'content', ${dto.content}::text)
        WHERE payload ->> 'announcementId' = ${id}
      `;
      return updated;
    });
  }

  async remove(id: string) {
    const ann = await this.prisma.announcement.findUnique({ where: { id }, select: { id: true } });
    if (!ann) throw new NotFoundException('公告不存在');
    await this.prisma.announcement.delete({ where: { id } });
    return { deleted: true };
  }
}
