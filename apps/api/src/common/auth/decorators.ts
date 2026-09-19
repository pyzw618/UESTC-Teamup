import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@prisma/client';

export const IS_PUBLIC_KEY = 'isPublic';
export const IS_ADMIN_KEY = 'isAdmin';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const Admin = () => SetMetadata(IS_ADMIN_KEY, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User | undefined => {
  return ctx.switchToHttp().getRequest().user;
});
