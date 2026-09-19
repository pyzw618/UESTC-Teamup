import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
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
import { CurrentUser } from '../../common/auth/decorators';
import type { User } from '@prisma/client';
import { TeamsService, type UpsertTeamInput, type ManualTeamStatus } from './teams.service';

class UpsertTeamDto {
  @IsOptional() @IsString() competitionId?: string;
  @IsOptional() @IsString() @Length(1, 120) competitionName?: string;
  @IsEnum(TeamGoal) goal!: TeamGoal;
  @IsOptional() @IsArray() @IsEnum(RoleType, { each: true }) neededRoles?: RoleType[];
  @IsOptional() @IsString() @Length(0, 2000) requirement?: string;
  @IsString() @Length(1, 200, { message: '请填写联系方式（微信/QQ）' }) contact!: string;
  @IsOptional() @IsDateString() deadline?: string;
  @IsOptional() @IsInt() @Min(1) @Max(99) targetSize?: number;
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
  @IsOptional() @IsInt() @Min(1) page: number = 1;
  @IsOptional() @IsInt() @Min(1) @Max(60) pageSize: number = 12;
}

class SetStatusDto {
  @IsEnum(TeamStatus) status!: TeamStatus;
}

@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  list(@Query() query: ListTeamsDto) {
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
  detail(@CurrentUser() user: User, @Param('id') id: string) {
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

  private toInput(dto: UpsertTeamDto): UpsertTeamInput {
    return {
      competitionId: dto.competitionId,
      competitionName: dto.competitionName,
      goal: dto.goal,
      neededRoles: dto.neededRoles,
      requirement: dto.requirement,
      contact: dto.contact,
      deadline: dto.deadline ? new Date(dto.deadline) : undefined,
      targetSize: dto.targetSize,
      members: dto.members,
    };
  }
}
