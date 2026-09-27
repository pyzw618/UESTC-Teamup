import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RoleType, TeamGoal, TeamStatus } from '@teamup/shared';
import { TransformStringArray } from '../../common/query.transform';
import { CurrentUser, Public } from '../../common/auth/decorators';
import type { User } from '@prisma/client';
import { TeamsService, type UpsertTeamInput, type ManualTeamStatus } from './teams.service';

class UpsertTeamDto {
  @IsOptional() @IsString() competitionId?: string;
  @IsOptional() @IsString() @Length(1, 120) competitionName?: string;
  @IsEnum(TeamGoal) goal!: TeamGoal;
  @IsOptional() @IsArray() @IsEnum(RoleType, { each: true }) neededRoles?: RoleType[];
  @IsOptional() @IsString() @Length(0, 2000) requirement?: string | null;
  @IsOptional() @IsString() @Length(0, 64, { message: 'QQ 号最长 64 字' }) qq?: string | null;
  @IsOptional() @IsString() @Length(0, 64, { message: '微信号最长 64 字' }) wechat?: string | null;
  @IsOptional() @IsDateString() deadline?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(99) targetSize?: number | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MemberDto) members?: MemberDto[];
}

class MemberDto {
  @IsOptional() @IsInt() @Min(2015) @Max(2035) grade?: number;
  @IsOptional() @IsString() @Length(0, 40) college?: string;
  @IsOptional() @IsString() @Length(0, 40) major?: string;
  @IsOptional() @IsString() @Length(0, 40) rank?: string;
  @IsOptional() @IsString() @Length(0, 500) intro?: string;
}

class ListTeamsDto {
  @IsOptional() @IsString() competitionId?: string;
  @IsOptional() @TransformStringArray() roles?: RoleType[];
  @IsOptional() @IsEnum(TeamGoal) goal?: TeamGoal;
  // 可见性收敛（Issue 4）：公开列表固定只返回 RECRUITING，不再接受 statuses 参数
  @IsOptional() @IsIn(['DEADLINE', 'LATEST']) sort?: 'DEADLINE' | 'LATEST';
  @IsOptional() @IsDateString() postedFrom?: string;
  @IsOptional() @IsDateString() postedTo?: string;
  @IsOptional() @IsInt() @Min(1) page: number = 1;
  @IsOptional() @IsInt() @Min(1) @Max(60) pageSize: number = 12;
}

class SetStatusDto {
  @IsEnum(TeamStatus) status!: 'RECRUITING' | 'FULL' | 'DISBANDED';
}

@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  /** 发现列表（登录可见，A3 匿名边界）：固定只返回「招募中」（Issue 4） */
  @Get()
  list(@Query() query: ListTeamsDto) {
    return this.teams.list({
      ...query,
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 12,
      roles: query.roles as RoleType[],
    });
  }

  @Get('me/teams')
  myTeams(@CurrentUser() user: User) {
    return this.teams.myTeams(user.id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: UpsertTeamDto) {
    return this.teams.create(user.id, this.toInput(dto));
  }

  /**
   * 详情公开（游客可看帖子壳与组队意愿计数；联系方式 / 招募正文按登录与意愿状态在服务端裁剪）。
   * 非「招募中」帖子仅发布者与管理员可访问，其他人得到 404（Issue 4）。
   */
  @Public()
  @Get(':id')
  detail(@CurrentUser() user: User | undefined, @Param('id') id: string) {
    return this.teams.detail(id, user?.id, user?.role);
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpsertTeamDto) {
    return this.teams.update(user.id, id, this.toInput(dto));
  }

  /** 队长手动切换状态：RECRUITING / FULL / DISBANDED（COMPETING 由系统自动设置） */
  @Post(':id/status')
  setStatus(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.teams.setStatus(user.id, id, dto.status as ManualTeamStatus);
  }

  // ==================================================================
  // 组队意愿（Issue 1）：点击「我想组队」登记一条，可撤销；联系人据此解锁联系方式
  // ==================================================================

  @Post(':id/intent')
  registerIntent(@CurrentUser() user: User, @Param('id') id: string) {
    return this.teams.registerIntent(id, user.id);
  }

  @Delete(':id/intent')
  revokeIntent(@CurrentUser() user: User, @Param('id') id: string) {
    return this.teams.revokeIntent(id, user.id);
  }

  private toInput(dto: UpsertTeamDto): UpsertTeamInput {
    return {
      competitionId: dto.competitionId,
      competitionName: dto.competitionName,
      goal: dto.goal,
      neededRoles: dto.neededRoles,
      requirement: dto.requirement,
      qq: dto.qq,
      wechat: dto.wechat,
      // M10：区分「缺省=不更新」与「null=清空」。原写法把 null 也转成 undefined，
      // 导致队长永远删不掉已填的截止日期。
      deadline: dto.deadline === undefined ? undefined : dto.deadline ? new Date(dto.deadline) : null,
      targetSize: dto.targetSize,
      members: dto.members,
    };
  }
}
