import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@prisma/client';

export const IS_PUBLIC_KEY = 'isPublic';
export const IS_ADMIN_KEY = 'isAdmin';
/** 角色白名单（Issue 2：ADMIN / CONTRIBUTOR 可编辑竞赛等场景） */
export const ROLES_KEY = 'roles';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const Admin = () => SetMetadata(IS_ADMIN_KEY, true);
/** 允许访问的角色集合，如 @Roles('ADMIN', 'CONTRIBUTOR')；与 @Admin() 同时出现时以本装饰器为准 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User | undefined => {
  return ctx.switchToHttp().getRequest().user;
});
