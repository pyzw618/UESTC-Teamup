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
import { TeamsService, type CreateTeamInput, type TeamTransitionAction } from './teams.service';

class SlotInputDto {
  @IsEnum(RoleType) role!: RoleType;
  @IsOptional() @IsString() @Length(0, 200) note?: string;
}

class ExternalMemberDto {
  @IsOptional() @IsString() @Length(0, 40) displayName?: string;
  @IsOptional() @IsEnum(RoleType) role?: RoleType;
  @IsOptional() @IsString() @Length(0, 40) rank?: string;
  @IsOptional() @IsInt() @Min(2015) @Max(2035) grade?: number;
  @IsOptional() @IsString() @Length(0, 40) college?: string;
  @IsOptional() @IsString() @Length(0, 200) note?: string;
}

class CreateTeamDto {
  @IsOptional() @IsString() competitionId?: string;
  @IsOptional() @IsString() @Length(1, 120) competitionName?: string;
  @IsEnum(TeamGoal) goal!: TeamGoal;
  @IsOptional() @IsString() @Length(0, 2000) requirement?: string;
  @IsOptional() @IsString() @Length(0, 200) contact?: string;
  @IsOptional() @IsDateString() deadline?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => SlotInputDto) slots!: SlotInputDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ExternalMemberDto) members?: ExternalMemberDto[];
}

class ListTeamsDto {
  @IsOptional() @IsString() competitionId?: string;
  @IsOptional() @TransformStringArray() roles?: RoleType[];
  @IsOptional() @IsEnum(TeamGoal) goal?: TeamGoal;
  @IsOptional() @TransformStringArray() statuses?: TeamStatus[];
  @IsOptional() @IsInt() @Min(2015) @Max(2035) grade?: number;
  @IsOptional() @IsIn(['DEADLINE', 'LATEST']) sort?: 'DEADLINE' | 'LATEST';
  @IsOptional() @IsInt() @Min(1) page: number = 1;
  @IsOptional() @IsInt() @Min(1) @Max(60) pageSize: number = 12;
}

class ApplyDto {
  @IsEnum(RoleType) desiredRole!: RoleType;
  @IsString() @Length(1, 2000, { message: '请填写自我介绍（1-2000 字）' }) pitch!: string;
}

class ReviewDto {
  @IsString() applicationId!: string;
  @IsString() @IsIn(['accept', 'reject']) action!: 'accept' | 'reject';
  @IsOptional() @IsString() @Length(0, 200) reason?: string;
}

class TransitionDto {
  @IsString() @IsIn(['PAUSE', 'RESUME', 'COMPETE', 'ADJUST', 'DISBAND']) action!: TeamTransitionAction;
}

class InviteDto {
  @IsString() userId!: string;
  @IsEnum(RoleType) role!: RoleType;
  @IsOptional() @IsString() @Length(0, 500) message?: string;
}

class InvitationActionDto {
  @IsString() @IsIn(['accept', 'reject']) action!: 'accept' | 'reject';
}

class TransferLeadershipDto {
  @IsString() userId!: string;
}

class UpdateSlotDto {
  @IsOptional() @IsEnum(RoleType) role?: RoleType;
  @IsOptional() @IsString() @Length(0, 200) note?: string | null;
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

  @Get('me/applications')
  myApplications(@CurrentUser() user: User) {
    return this.teams.myApplications(user.id);
  }

  @Get('me/invitations')
  myInvitations(@CurrentUser() user: User) {
    return this.teams.myInvitations(user.id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateTeamDto) {
    const input: CreateTeamInput = {
      competitionId: dto.competitionId,
      competitionName: dto.competitionName,
      goal: dto.goal,
      requirement: dto.requirement,
      contact: dto.contact,
      deadline: dto.deadline ? new Date(dto.deadline) : undefined,
      slots: dto.slots ?? [],
      members: dto.members,
    };
    return this.teams.create(user.id, input);
  }

  @Get(':id')
  detail(@CurrentUser() user: User, @Param('id') id: string) {
    return this.teams.detail(id, user?.id, user?.role);
  }

  // ---------- 状态机 ----------

  @Post(':id/transition')
  transition(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: TransitionDto) {
    return this.teams.transition(user.id, id, dto.action);
  }

  // ---------- 申请流 ----------

  @Post(':id/applications')
  apply(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ApplyDto) {
    return this.teams.apply(user.id, id, dto.desiredRole, dto.pitch);
  }

  @Post('applications/review')
  review(@CurrentUser() user: User, @Body() dto: ReviewDto) {
    return this.teams.reviewApplication(user.id, dto.applicationId, dto.action === 'accept', dto.reason);
  }

  @Post('applications/:id/withdraw')
  withdraw(@CurrentUser() user: User, @Param('id') id: string) {
    return this.teams.withdraw(user.id, id);
  }

  // ---------- 邀请流 ----------

  @Post(':id/invitations')
  invite(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: InviteDto) {
    return this.teams.invite(user.id, id, dto.userId, dto.role, dto.message);
  }

  @Post('invitations/:id/respond')
  respondInvitation(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: InvitationActionDto) {
    return this.teams.respondInvitation(user.id, id, dto.action === 'accept');
  }

  // ---------- 成员生命周期 ----------

  @Post(':id/leave')
  leave(@CurrentUser() user: User, @Param('id') id: string) {
    return this.teams.leaveTeam(user.id, id);
  }

  @Post(':id/members/:memberId/remove')
  removeMember(@CurrentUser() user: User, @Param('id') id: string, @Param('memberId') memberId: string) {
    return this.teams.removeMember(user.id, id, memberId);
  }

  @Post(':id/transfer-leadership')
  transferLeadership(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: TransferLeadershipDto) {
    return this.teams.transferLeadership(user.id, id, dto.userId);
  }

  // ---------- TeamSlot 编辑 ----------

  @Post(':id/slots')
  addSlot(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: SlotInputDto) {
    return this.teams.addSlot(user.id, id, dto.role, dto.note);
  }

  @Patch(':id/slots/:slotId')
  updateSlot(@CurrentUser() user: User, @Param('id') id: string, @Param('slotId') slotId: string, @Body() dto: UpdateSlotDto) {
    return this.teams.updateSlot(user.id, id, slotId, { role: dto.role, note: dto.note });
  }

  @Post(':id/slots/:slotId/close')
  closeSlot(@CurrentUser() user: User, @Param('id') id: string, @Param('slotId') slotId: string) {
    return this.teams.closeSlot(user.id, id, slotId);
  }
}
