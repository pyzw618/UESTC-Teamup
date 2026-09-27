import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_ADMIN_KEY, IS_PUBLIC_KEY, ROLES_KEY } from './decorators';

declare module 'express' {
  interface Request {
    user?: import('@prisma/client').User;
    sid?: string;
  }
}

/**
 * 会话守卫：默认要求登录，@Public() 标记公开路由；@Admin() 标记管理员路由；
 * @Roles('ADMIN', 'CONTRIBUTOR') 标记角色白名单路由（同时出现时优先于 @Admin()）。
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
    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.user;

    if (isPublic) {
      if (roles?.length) return this.assertRole(user, roles);
      if (needAdmin && user?.role !== 'ADMIN') throw new ForbiddenException('需要管理员权限');
      return true;
    }

    if (!user) throw new UnauthorizedException('请先登录');
    // 角色白名单优先于 ADMIN 判定（用于把个别路由放宽到 CONTRIBUTOR）
    if (roles?.length) return this.assertRole(user, roles);
    if (needAdmin && user.role !== 'ADMIN') throw new ForbiddenException('需要管理员权限');
    return true;
  }

  private assertRole(user: import('@prisma/client').User | undefined, roles: string[]): boolean {
    if (!user) throw new UnauthorizedException('请先登录');
    if (!roles.includes(user.role)) throw new ForbiddenException('没有权限执行此操作');
    return true;
  }
}
