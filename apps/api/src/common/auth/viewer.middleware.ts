import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { SessionService } from './session.service';
import { ViewerContext } from './viewer.context';
import { PrismaService } from '../prisma.service';

/**
 * 每个请求：解析会话 → 挂 req.user → 一次性查出所在队伍 → 进入 viewer 上下文
 * 下游（守卫/序列化器）只读上下文，不重复查库
 */
@Injectable()
export class ViewerMiddleware implements NestMiddleware {
  constructor(
    private readonly sessions: SessionService,
    private readonly viewer: ViewerContext,
    private readonly prisma: PrismaService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const sid = (req as Request & { cookies?: Record<string, string> }).cookies?.['teamup_sid'];
    const user = await this.sessions.resolve(sid);
    req.user = user ?? undefined;
    req.sid = sid;

    if (!user) {
      next();
      return;
    }

    const memberships = await this.prisma.teamMember.findMany({
      where: { userId: user.id },
      select: { teamId: true },
    });
    this.viewer.run({ userId: user.id, role: user.role, teamIds: new Set(memberships.map((m) => m.teamId)) }, () =>
      next(),
    );
  }
}
