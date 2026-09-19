import { Injectable, NotFoundException } from '@nestjs/common';
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
    return this.prisma.announcement.create({
      data: { title: dto.title, content: dto.content, createdBy: adminId },
    });
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
