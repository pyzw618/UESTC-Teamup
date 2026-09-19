import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { SessionService } from '../../common/auth/session.service';
import { UserSerializer } from '../../common/auth/viewer.context';
import type { User } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly serializer: UserSerializer,
  ) {}

  /** 本人完整资料（含技能） */
  async myProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { skills: true },
    });
    if (!user) throw new NotFoundException();
    return {
      id: user.id,
      email: user.email,
      studentNo: user.studentNo,
      nickname: user.nickname,
      college: user.college,
      grade: user.grade,
      major: user.major,
      bio: user.bio,
      role: user.role,
      skills: user.skills.map((s) => ({ skill: s.skill, level: s.level })),
    };
  }

  async updateProfile(
    userId: string,
    data: {
      nickname?: string;
      college?: string;
      grade?: number;
      major?: string;
      bio?: string;
      skills?: { skill: string; level?: number }[];
    },
  ) {
    const { skills, ...profile } = data;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          nickname: profile.nickname?.trim() || null,
          college: profile.college?.trim() || null,
          grade: profile.grade ?? null,
          major: profile.major?.trim() || null,
          bio: profile.bio?.trim() || null,
        },
      });

      if (skills) {
        await tx.userSkill.deleteMany({ where: { userId } });
        const valid = skills
          .map((s) => ({ skill: s.skill.trim(), level: s.level ?? null }))
          .filter((s) => s.skill.length > 0 && s.skill.length <= 20)
          .slice(0, 20);
        if (valid.length > 0) {
          await tx.userSkill.createMany({
            data: valid.map((s) => ({ userId, skill: s.skill, level: s.level })),
          });
        }
      }
    });

    return this.myProfile(userId);
  }

  /** 公开名片：半匿名，同队解锁完整信息 */
  async publicCard(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        skills: true,
        memberships: { select: { teamId: true } },
      },
    });
    if (!user) throw new NotFoundException('用户不存在');

    return this.serializer.serialize({
      id: user.id,
      nickname: user.nickname,
      college: user.college,
      grade: user.grade,
      major: user.major,
      bio: user.bio,
      studentNo: user.studentNo,
      skills: user.skills,
      teamIds: user.memberships.map((m) => m.teamId),
    });
  }

  /** 名片上的"正在参与的队伍"（招募中/已参赛） */
  async publicTeams(id: string) {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId: id },
      select: { teamId: true },
    });
    const teamIds = memberships.map((m) => m.teamId);
    const led = await this.prisma.team.findMany({ where: { leaderId: id }, select: { id: true } });
    const all = [...new Set([...teamIds, ...led.map((t) => t.id)])];
    if (all.length === 0) return [];

    return this.prisma.team.findMany({
      where: { id: { in: all }, status: { in: ['RECRUITING', 'COMPETING'] } },
      select: {
        id: true,
        goal: true,
        status: true,
        competition: { select: { id: true, name: true } },
      },
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 管理员：用户列表 */
  async adminList(query: { page: number; pageSize: number; q?: string }) {
    const where = query.q
      ? {
          OR: [
            { email: { contains: query.q } },
            { studentNo: { contains: query.q } },
            { nickname: { contains: query.q } },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          email: true,
          studentNo: true,
          nickname: true,
          college: true,
          grade: true,
          role: true,
          banned: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** 管理员：封禁/解封（封禁同时强制下线） */
  async ban(admin: User, userId: string, reason?: string) {
    if (admin.id === userId) throw new BadRequestException('不能封禁自己');
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('用户不存在');
    if (target.role === 'ADMIN') throw new BadRequestException('不能封禁管理员');

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { banned: !target.banned } }),
      this.prisma.banRecord.create({
        data: { userId, actorId: admin.id, reason },
      }),
    ]);

    if (!target.banned) await this.sessions.destroyByUserId(userId);
    return { banned: !target.banned };
  }

  /** 管理员：调整角色 */
  async setRole(userId: string, role: 'STUDENT' | 'CONTRIBUTOR' | 'ADMIN') {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { role } });
    return { id: user.id, role: user.role };
  }
}
