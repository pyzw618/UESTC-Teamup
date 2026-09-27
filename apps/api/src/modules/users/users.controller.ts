import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
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
import { Admin, CurrentUser, Public } from '../../common/auth/decorators';
import type { User } from '@prisma/client';
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

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

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

  /** 公开名片（游客可见；2026-09-27 起不含学号，见 UserSerializer A1 注释） */
  @Public()
  @Get(':id')
  publicCard(@Param('id') id: string) {
    return this.users.publicCard(id);
  }

  /** 名片页的「TA 发布的招募帖」。游客访问得到 401，由前端单独容错（A3：不拖垮整页） */
  @Get(':id/teams')
  publicTeams(@Param('id') id: string) {
    return this.users.publicTeams(id);
  }
}
