import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { SessionService } from './session.service';
import { ViewerContext } from './viewer.context';

/**
 * 每个请求：解析会话 → 挂 req.user → 进入 viewer 上下文
 * 下游（守卫/序列化器）只读上下文，不重复查库
 */
@Injectable()
export class ViewerMiddleware implements NestMiddleware {
  constructor(
    private readonly sessions: SessionService,
    private readonly viewer: ViewerContext,
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

    // 广告牌模式下没有「同队」概念，teamIds 恒为空集（保留序列化器兼容）
    this.viewer.run({ userId: user.id, role: user.role, teamIds: new Set() }, () => next());
  }
}
