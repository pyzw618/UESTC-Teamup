import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsArray, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { RoleType, TeamGoal, TeamStatus } from '@teamup/shared';
import { TransformStringArray } from '../../common/query.transform';
import { CurrentUser } from '../../common/auth/decorators';
import { UserSerializer } from '../../common/auth/viewer.context';
import type { User } from '@prisma/client';
import { TeamsService, type CreateTeamInput } from './teams.service';

class CreateTeamDto {
  @IsOptional() @IsString() competitionId?: string;
  @IsOptional() @IsString() @Length(1, 120) competitionName?: string;
  @IsEnum(TeamGoal) goal!: TeamGoal;
  @IsOptional() @IsString() @Length(0, 2000) requirement?: string;
  @IsOptional() @IsString() @Length(0, 200) contact?: string;
  @IsOptional() @IsDateString() deadline?: string;
  @IsOptional() @IsInt() @Min(1) @Max(99) teamSize?: number;
  @IsOptional() @IsInt() @Min(0) @Max(99) currentSize?: number;
  @IsArray()
  slots!: { role: RoleType; note?: string }[];
  @IsOptional() @IsArray() members?: CreateTeamInput['members'];
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
  @IsString() @Length(1, 2000, { message: '请填写自我介绍（1-2000 字）' }) pitch!: string;
}

class ReviewDto {
  @IsString() applicationId!: string;
  @IsString() action!: 'accept' | 'reject';
  @IsOptional() @IsString() @Length(0, 200) reason?: string;
}

class TransitionDto {
  @IsString() action!: 'NEGOTIATE' | 'COMPETE' | 'DISBAND' | 'REOPEN';
}

class InviteDto {
  @IsString() userId!: string;
}

class InvitationActionDto {
  @IsString() action!: 'accept' | 'reject';
}

@Controller('teams')
export class TeamsController {
  constructor(
    private readonly teams: TeamsService,
    private readonly serializer: UserSerializer,
  ) {}

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
      teamSize: dto.teamSize,
      currentSize: dto.currentSize,
      slots: dto.slots ?? [],
      members: dto.members,
    };
    return this.teams.create(user.id, input);
  }

  @Get(':id')
  async detail(@CurrentUser() user: User, @Param('id') id: string) {
    void user;
    const team = await this.teams.detail(id);

    const isMember =
      team.leaderId === user?.id ||
      user != null && team.members.some((m) => m.userId === user.id);
    const isLeader = team.leaderId === user?.id;

    // Q8：联系方式申请通过（=入队）后站内可见
    const contact = isMember ? team.contact : null;

    return {
      id: team.id,
      goal: team.goal,
      status: team.status,
      requirement: team.requirement,
      contact,
      contactVisible: isMember,
      deadline: team.deadline,
      teamSize: team.teamSize,
      currentSize: team.currentSize,
      createdAt: team.createdAt,
      competition: {
        id: team.competition.id,
        name: team.competition.name,
        levels: team.competition.levels.map((l) => l.level),
        officialUrl: team.competition.officialUrl,
      },
      leader: this.serializer.serialize({
        ...team.leader,
        teamIds: team.leader.memberships.map((m) => m.teamId),
      }),
      slots: team.slots,
      members: team.members.map((m) => ({
        id: m.id,
        role: m.role,
        rank: m.rank,
        grade: m.grade,
        college: m.college,
        note: m.note,
        displayName: m.displayName,
        user: m.user
          ? this.serializer.serialize({
              ...m.user,
              teamIds: m.user.memberships.map((x) => x.teamId),
            })
          : null,
      })),
      applications: isLeader
        ? team.applications.map((a) => ({
            id: a.id,
            pitch: a.pitch,
            createdAt: a.createdAt,
            user: this.serializer.serialize({ ...a.user, teamIds: [] }),
          }))
        : undefined,
      invitations: isLeader
        ? team.invitations.map((i) => ({
            id: i.id,
            status: i.status,
            createdAt: i.createdAt,
            user: this.serializer.serialize({ ...i.user, teamIds: [] }),
          }))
        : undefined,
      viewer: { isLeader, isMember },
    };
  }

  @Post(':id/transition')
  transition(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: TransitionDto) {
    return this.teams.transition(user.id, id, dto.action);
  }

  @Post(':id/applications')
  apply(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ApplyDto) {
    return this.teams.apply(user.id, id, dto.pitch);
  }

  @Post('applications/review')
  review(@CurrentUser() user: User, @Body() dto: ReviewDto) {
    return this.teams.reviewApplication(user.id, dto.applicationId, dto.action === 'accept', dto.reason);
  }

  @Post('applications/:id/withdraw')
  withdraw(@CurrentUser() user: User, @Param('id') id: string) {
    return this.teams.withdraw(user.id, id);
  }

  @Post(':id/invitations')
  invite(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: InviteDto) {
    return this.teams.invite(user.id, id, dto.userId);
  }

  @Post('invitations/:id/respond')
  respondInvitation(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: InvitationActionDto) {
    return this.teams.respondInvitation(user.id, id, dto.action === 'accept');
  }
}
