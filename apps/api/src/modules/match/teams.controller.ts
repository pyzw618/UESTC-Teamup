import { Body, Controller, Get, HttpException, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
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
import { RedisService } from '../../common/redis.service';
import { CurrentUser } from '../../common/auth/decorators';
import type { User } from '@prisma/client';
import type { Request } from 'express';
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
  @IsOptional() @TransformStringArray() statuses?: TeamStatus[];
  @IsOptional() @IsIn(['DEADLINE', 'LATEST']) sort?: 'DEADLINE' | 'LATEST';
  @IsOptional() @IsDateString() postedFrom?: string;
  @IsOptional() @IsDateString() postedTo?: string;
  @IsOptional() @IsInt() @Min(1) page: number = 1;
  @IsOptional() @IsInt() @Min(1) @Max(60) pageSize: number = 12;
}

class SetStatusDto {
  @IsEnum(TeamStatus) status!: TeamStatus;
}

@Controller('teams')
export class TeamsController {
  constructor(
    private readonly teams: TeamsService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async list(@CurrentUser() user: User, @Req() req: Request, @Query() query: ListTeamsDto) {
    // 防批量爬取：列表 30 次/分钟（登录用户按 id，未登录按 IP）
    await this.rateLimit(`rl:team:list:${user?.id ?? req.ip}`, 30, 60);
    return this.teams.list({
      ...query,
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 12,
      roles: query.roles as RoleType[],
      statuses: query.statuses as TeamStatus[],
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

  @Get(':id')
  async detail(@CurrentUser() user: User, @Req() req: Request, @Param('id') id: string) {
    // 防批量爬取：详情 60 次/分钟（登录用户按 id，未登录按 IP）
    await this.rateLimit(`rl:team:detail:${user?.id ?? req.ip}`, 60, 60);
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

  /** Redis 计数限流：窗口内超限抛 429 */
  private async rateLimit(key: string, limit: number, ttlSeconds: number) {
    const hits = await this.redis.incrWithTtl(key, ttlSeconds);
    if (hits > limit) throw new HttpException('请求过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
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
