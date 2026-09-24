import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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
import { Admin, CurrentUser, Public } from '../../common/auth/decorators';
import { Audience, CompetitionFormat, Level, PublishStatus } from '@prisma/client';
import { AdminService, type UpsertCompetitionInput } from './admin.service';
import { ReportsService } from './reports.service';
import { AnnouncementsService } from './announcements.service';

class TimelineItemDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @Length(1, 60) stage!: string;
  @IsOptional() @IsEnum(Level) level?: Level;
  @IsOptional() @IsDateString() startAt?: string | null;
  @IsOptional() @IsDateString() endAt?: string | null;
}

class CompetitionDto {
  @IsString() @Length(1, 120) name!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) aliases?: string[];
  @IsOptional() @IsString() organizer?: string;
  @IsOptional() @IsString() officialUrl?: string;
  @IsOptional() @IsEnum(CompetitionFormat) format?: CompetitionFormat;
  @IsOptional() @IsInt() @Min(1) @Max(99) teamSizeMin?: number;
  @IsOptional() @IsInt() @Min(1) @Max(99) teamSizeMax?: number;
  @IsOptional() @IsEnum(Audience) audience?: Audience;
  @IsOptional() @IsString() intro?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) difficulty?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) effort?: number;
  @IsOptional() @IsBoolean() isBonusEligible?: boolean;
  @IsOptional() @IsString() bonusCategory?: string;
  @IsOptional() @IsString() bonusPoints?: string;
  @IsOptional() @IsString() sourceUrl?: string;
  @IsOptional() @IsEnum(PublishStatus) status?: PublishStatus;
  @IsOptional() @IsArray() @IsEnum(Level, { each: true }) levels?: Level[];
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TimelineItemDto)
  timelines?: TimelineItemDto[];
}

class CorrectionReviewDto {
  @IsString() action!: 'accept' | 'reject';
  @IsOptional() @IsString() note?: string;
}

class PageDto {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() competitionId?: string;
  @IsOptional() @IsString() handled?: string;
  @IsOptional() @IsInt() @Min(1) page: number = 1;
  @IsOptional() @IsInt() @Min(1) @Max(100) pageSize: number = 20;
}

class AnnouncementDto {
  @IsString() @Length(1, 60) title!: string;
  @IsString() @Length(1, 2000) content!: string;
}

/** 用户侧：举报 */
class SubmitReportDto {
  @IsIn(['TEAM', 'COMMENT', 'POST']) targetType!: 'TEAM' | 'COMMENT' | 'POST';
  @IsString() targetId!: string;
  @IsString() @Length(1, 500) reason!: string;
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  submit(@CurrentUser() user: import('@prisma/client').User, @Body() dto: SubmitReportDto) {
    return this.reports.submit(user.id, dto);
  }
}

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Public()
  @Get('active')
  active() {
    return this.announcements.active();
  }
}

@Admin()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly reportsSvc: ReportsService,
    private readonly announcementsSvc: AnnouncementsService,
  ) {}

  // ---------- 竞赛管理 ----------

  @Get('competitions')
  listCompetitions(@Query() q: PageDto) {
    return this.admin.adminList({ page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 20, q: q.q, status: q.status });
  }

  @Get('competitions/:id')
  detailCompetition(@Param('id') id: string) {
    return this.admin.adminDetail(id);
  }

  @Post('competitions')
  createCompetition(@Body() dto: CompetitionDto) {
    return this.admin.createCompetition(this.toInput(dto));
  }

  @Put('competitions/:id')
  updateCompetition(@Param('id') id: string, @Body() dto: CompetitionDto) {
    return this.admin.updateCompetition(id, this.toInput(dto), 'admin');
  }

  @Delete('competitions/:id')
  archiveCompetition(@Param('id') id: string) {
    return this.admin.archiveCompetition(id);
  }

  // ---------- 组队帖管理（删除帖子） ----------

  @Delete('teams/:id')
  deleteTeam(@Param('id') id: string) {
    return this.admin.deleteTeam(id);
  }

  // ---------- 举报处理 ----------

  @Get('reports')
  reports(@Query() q: PageDto) {
    return this.reportsSvc.adminList({
      handled: q.handled === undefined || q.handled === '' ? undefined : q.handled === 'true',
      page: Number(q.page) || 1,
      pageSize: Number(q.pageSize) || 20,
    });
  }

  @Post('reports/:id/handle')
  handleReport(@Param('id') id: string) {
    return this.reportsSvc.handle(id, 'dismiss');
  }

  @Post('reports/:id/delete-content')
  deleteReportedContent(@Param('id') id: string) {
    return this.reportsSvc.handle(id, 'delete-content');
  }

  // ---------- 系统公告 ----------

  @Get('announcements')
  announcements() {
    return this.announcementsSvc.adminList();
  }

  @Post('announcements')
  createAnnouncement(@CurrentUser() admin: import('@prisma/client').User, @Body() dto: AnnouncementDto) {
    return this.announcementsSvc.create(admin.id, dto);
  }

  @Post('announcements/:id/toggle')
  toggleAnnouncement(@Param('id') id: string) {
    return this.announcementsSvc.toggle(id);
  }

  @Delete('announcements/:id')
  deleteAnnouncement(@Param('id') id: string) {
    return this.announcementsSvc.remove(id);
  }

  // ---------- 纠错处理 ----------

  @Get('corrections')
  corrections(@Query() q: PageDto) {
    return this.admin.correctionsList({
      status: q.status as never,
      page: Number(q.page) || 1,
      pageSize: Number(q.pageSize) || 20,
    });
  }

  @Post('corrections/:id/review')
  reviewCorrection(@Param('id') id: string, @Body() dto: CorrectionReviewDto) {
    return this.admin.reviewCorrection('admin', id, dto.action === 'accept', dto.note);
  }

  // ---------- 版本历史与回滚 ----------

  @Get('revisions')
  revisions(@Query() q: PageDto) {
    return this.admin.revisions({
      competitionId: q.competitionId,
      page: Number(q.page) || 1,
      pageSize: Number(q.pageSize) || 20,
    });
  }

  @Post('revisions/:id/rollback')
  rollback(@Param('id') id: string) {
    return this.admin.rollback(id);
  }

  private toInput(dto: CompetitionDto): UpsertCompetitionInput {
    return {
      ...dto,
      timelines: dto.timelines?.map((t) => ({
        ...t,
        startAt: t.startAt ? new Date(t.startAt) : null,
        endAt: t.endAt ? new Date(t.endAt) : null,
      })),
    } as UpsertCompetitionInput;
  }
}
