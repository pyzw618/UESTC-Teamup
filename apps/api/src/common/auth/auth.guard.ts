import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_ADMIN_KEY, IS_PUBLIC_KEY } from './decorators';

declare module 'express' {
  interface Request {
    user?: import('@prisma/client').User;
    sid?: string;
  }
}

/**
 * 会话守卫：默认要求登录，@Public() 标记公开路由；@Admin() 标记管理员路由
 * req.user 由 ViewerMiddleware 预先解析
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const needAdmin = this.reflector.getAllAndOverride<boolean>(IS_ADMIN_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.user;

    if (isPublic) {
      if (needAdmin && user?.role !== 'ADMIN') throw new ForbiddenException('需要管理员权限');
      return true;
    }

    if (!user) throw new UnauthorizedException('请先登录');
    if (needAdmin && user.role !== 'ADMIN') throw new ForbiddenException('需要管理员权限');
    return true;
  }
}
