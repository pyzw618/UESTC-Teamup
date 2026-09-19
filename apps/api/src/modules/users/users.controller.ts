import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Admin, CurrentUser } from '../../common/auth/decorators';
import type { User } from '@prisma/client';
import { UsersService } from './users.service';

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
  skills?: { skill: string; level?: number }[];
}

class BanDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class SetRoleDto {
  @IsString()
  role!: 'STUDENT' | 'CONTRIBUTOR' | 'ADMIN';
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
  setRole(@Param('id') id: string, @Body() dto: SetRoleDto) {
    return this.users.setRole(id, dto.role);
  }

  @Get(':id')
  publicCard(@Param('id') id: string) {
    return this.users.publicCard(id);
  }

  @Get(':id/teams')
  publicTeams(@Param('id') id: string) {
    return this.users.publicTeams(id);
  }
}
