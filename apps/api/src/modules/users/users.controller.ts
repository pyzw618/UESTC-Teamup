import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Put, Query, Req } from '@nestjs/common';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole } from '@teamup/shared';
import type { Request } from 'express';
import { Admin, CurrentUser, Public } from '../../common/auth/decorators';
import type { User } from '@prisma/client';
import { RedisService } from '../../common/redis.service';
import { UsersService } from './users.service';

/** M11：技能项校验（level 1-5，与业务层取值一致） */
class SkillDto {
  @IsString()
  @MaxLength(50)
  skill!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  level?: number;
}

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 20, { message: '昵称 1-20 字' })
  nickname?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  college?: string;

  @IsOptional()
  @IsInt()
  @Min(2015)
  @Max(2035)
  grade?: number;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  major?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500, { message: '自我介绍最多 500 字' })
  bio?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkillDto)
  skills?: SkillDto[];
}

class BanDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class SetRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}

/** 名片页（广告牌模式对游客公开）按 viewer/IP 每分钟限流，防批量爬取 */
const CARD_RATE_LIMIT = 60;

function clientIp(req: Request): string {
  // main.ts 设置了 trust proxy=1，req.ip 已从 XFF 右侧取第一个不可信地址
  return req.ip ?? 'unknown';
}

function minuteBucket(): number {
  return Math.floor(Date.now() / 60_000);
}

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly redis: RedisService,
  ) {}

  @Get('me')
  me(@CurrentUser() user: User) {
    return this.users.myProfile(user.id);
  }

  @Put('me')
  updateMe(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  @Get()
  @Admin()
  adminList(@Query('page') page = '1', @Query('pageSize') pageSize = '20', @Query('q') q?: string) {
    return this.users.adminList({ page: Number(page) || 1, pageSize: Number(pageSize) || 20, q });
  }

  @Post(':id/ban')
  @Admin()
  ban(@CurrentUser() admin: User, @Param('id') id: string, @Body() dto: BanDto) {
    return this.users.ban(admin, id, dto.reason);
  }

  @Post(':id/role')
  @Admin()
  setRole(@CurrentUser() admin: User, @Param('id') id: string, @Body() dto: SetRoleDto) {
    return this.users.setRole(admin, id, dto.role);
  }

  /** 公开名片（H1 广告牌模式：游客可见） */
  @Public()
  @Get(':id')
  async publicCard(@Param('id') id: string, @Req() req: Request) {
    // 防批量爬取：按 viewer id（已登录）或 IP（游客）每分钟计数
    const who = req.user?.id ?? clientIp(req);
    const hits = await this.redis.incrWithTtl(`card:rl:${who}:${minuteBucket()}`, 60);
    if (hits > CARD_RATE_LIMIT) {
      throw new HttpException('请求过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.users.publicCard(id);
  }

  @Get(':id/teams')
  publicTeams(@Param('id') id: string) {
    return this.users.publicTeams(id);
  }
}
