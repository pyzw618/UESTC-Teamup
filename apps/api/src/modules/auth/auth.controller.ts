import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, Length, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { Public, CurrentUser } from '../../common/auth/decorators';
import { SessionService, setSessionCookie, clearSessionCookie } from '../../common/auth/session.service';
import { UserSerializer } from '../../common/auth/viewer.context';
import { AuthService } from './auth.service';
import type { User } from '@prisma/client';

class SendCodeDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;
}

class LoginCodeDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  @IsString()
  @Length(6, 6, { message: '验证码为 6 位数字' })
  code!: string;
}

class LoginPasswordDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  @IsString()
  @MinLength(1, { message: '请输入密码' })
  password!: string;
}

class SetPasswordDto {
  @IsString()
  @MinLength(8, { message: '密码长度需在 8-64 位之间' })
  newPassword!: string;

  @IsOptional()
  @IsString()
  oldPassword?: string;
}

class ResetPasswordDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  @IsString()
  @Length(6, 6, { message: '验证码为 6 位数字' })
  code!: string;

  @IsString()
  @MinLength(8, { message: '密码长度需在 8-64 位之间' })
  newPassword!: string;
}

function clientIp(req: Request): string {
  // main.ts 设置了 trust proxy=1：Express 会从 X-Forwarded-For 右侧取第一个不可信地址，
  // 直接信任 req.ip，避免客户端伪造 XFF 左侧值绕过 IP 限流。
  return req.ip ?? 'unknown';
}

/** 登录成功后的统一用户视图（含 hasPassword 引导前端） */
function authUserView(user: User) {
  return {
    id: user.id,
    email: user.email,
    studentNo: user.studentNo,
    nickname: user.nickname,
    college: user.college,
    grade: user.grade,
    major: user.major,
    role: user.role,
    hasPassword: !!user.passwordHash,
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly serializer: UserSerializer,
  ) {}

  @Public()
  @Post('send-code')
  @HttpCode(200)
  async sendCode(@Body() dto: SendCodeDto, @Req() req: Request) {
    const { devCode } = await this.auth.sendCode(dto.email.toLowerCase(), clientIp(req));
    // 无论是否已注册响应一致（防邮箱枚举）；DEV 下附 dev.devCode 供联调
    return devCode ? { dev: { devCode }, message: '验证码已发送' } : { message: '验证码已发送' };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async loginWithCode(@Body() dto: LoginCodeDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, isNew } = await this.auth.loginWithCode(dto.email.toLowerCase(), dto.code, clientIp(req));
    const sid = await this.sessions.create(user.id);
    setSessionCookie(res, sid);
    // 本人视角：登录瞬间直接返回完整自见视图
    return { isNew, user: authUserView(user) };
  }

  @Public()
  @Post('login-password')
  @HttpCode(200)
  async loginWithPassword(@Body() dto: LoginPasswordDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user } = await this.auth.loginWithPassword(dto.email.toLowerCase(), dto.password);
    const sid = await this.sessions.create(user.id);
    setSessionCookie(res, sid);
    return { isNew: false, user: authUserView(user) };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: SendCodeDto, @Req() req: Request) {
    const { devCode } = await this.auth.sendResetCode(dto.email.toLowerCase(), clientIp(req));
    return devCode ? { dev: { devCode }, message: '找回验证码已发送' } : { message: '若该邮箱已注册，找回验证码已发送' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.email.toLowerCase(), dto.code, dto.newPassword);
    return { message: '密码已重置，请使用新密码登录' };
  }

  /** 设置/修改密码（需登录；已有密码须校验旧密码） */
  @Post('password')
  @HttpCode(200)
  setPassword(@CurrentUser() user: User, @Body() dto: SetPasswordDto) {
    return this.auth.setPassword(user.id, dto.newPassword, dto.oldPassword);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (req.sid) await this.sessions.destroy(req.sid);
    clearSessionCookie(res);
    return { message: '已退出登录' };
  }

  @Public()
  @Get('me')
  me(@CurrentUser() user?: User) {
    if (!user) return { user: null };
    // 本人视角必然可见全部字段；附加 email/role/hasPassword 供前端使用
    return {
      user: {
        ...this.serializer.serialize({ ...user, teamIds: [] }),
        email: user.email,
        role: user.role,
        hasPassword: !!user.passwordHash,
      },
    };
  }
}
