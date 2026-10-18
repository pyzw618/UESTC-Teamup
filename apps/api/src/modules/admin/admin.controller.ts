import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
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
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Admin, CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { Audience, BonusTier, CompetitionFormat, EventNodeType, Level, PublishStatus, StageKind } from '@prisma/client';
import {
  AdminService,
  type UpsertCompetitionInput,
  type UpsertEventInput,
  type TrackInput,
  type StageInput,
  type EventInput,
} from './admin.service';
import { ReportsService } from './reports.service';
import { AnnouncementsService } from './announcements.service';

/**
 * 时间节点（Issue 8）：与前端 AdminCompetitionEdit 提交的 events 数组同构 ——
 * 挂在赛程阶段（stageId）上，支持 id（已有节点）/ 无 id（新增）。旧的
 * timelines DTO 是 V1 遗留，events 字段曾被白名单静默丢弃导致编辑不生效。
 */
class EventItemDto {
  @IsOptional() @IsString() id?: string;
  @IsString() stageId!: string;
  @IsEnum(EventNodeType) nodeType!: EventNodeType;
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsDateString() startAt?: string | null;
  @IsOptional() @IsDateString() endAt?: string | null;
}

class CompetitionDto {
  @IsString() @Length(1, 120) name!: string;
  /** 竞赛稳定编号（Issue 10）：跨届次沿用（如 NUEDC），(code, year) 唯一 */
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,60}$/, { message: '编号只能包含字母、数字、下划线、连字符，最长 60 字' })
  code?: string;
  /** 届次年份（Issue 6）：同一赛事按年份建多份档案 */
  @IsOptional() @IsInt() @Min(2000) @Max(2100) year?: number;
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
  /** 特殊加分规则（Issue 10）：此前被白名单过滤无法持久化 */
  @IsOptional() @IsString() @Length(0, 500) bonusSpecialRule?: string;
  @IsOptional() @IsString() bonusPoints?: string;
  @IsOptional() @IsString() sourceUrl?: string;
  @IsOptional() @IsEnum(PublishStatus) status?: PublishStatus;
  @IsOptional() @IsArray() @IsEnum(Level, { each: true }) levels?: Level[];
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => EventItemDto)
  events?: EventItemDto[];
}

class CorrectionReviewDto {
  @IsString() action!: 'accept' | 'reject';
  @IsOptional() @IsString() note?: string;
}

/** 赛道（赛道/赛项）维护：字段缺省=不改，显式 null=清空 */
class TrackDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,60}$/, { message: '赛道编码只能包含字母、数字、下划线、连字符，最长 60 字' })
  code?: string;

  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsString() @Length(0, 120) shortName?: string | null;
  @IsOptional() @IsString() @Length(0, 2000) description?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @IsOptional() @IsEnum(CompetitionFormat) format?: CompetitionFormat | null;
  @IsOptional() @IsInt() @Min(1) @Max(99) teamSizeMin?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(99) teamSizeMax?: number | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/** 赛程阶段维护：trackId 为 null / 缺省 = 全赛事共享阶段 */
class StageDto {
  @IsOptional() @IsString() trackId?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,60}$/, { message: '阶段编码只能包含字母、数字、下划线、连字符，最长 60 字' })
  code?: string;

  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsEnum(StageKind) stageKind?: StageKind;
  @IsOptional() @IsString() @Length(0, 200) scope?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(9999) sequence?: number;
  @IsOptional() @IsEnum(BonusTier) bonusTier?: BonusTier | null;
  @IsOptional() @IsString() @Length(0, 1000) note?: string | null;
}

/** 时间节点维护（挂在阶段上） */
class AdminEventDto {
  @IsOptional() @IsString() stageId?: string;
  @IsOptional() @IsEnum(EventNodeType) nodeType?: EventNodeType;
  @IsOptional() @IsString() @Length(0, 120) label?: string | null;
  @IsOptional() @IsString() @Length(0, 200) location?: string | null;
  @IsOptional() @IsDateString() startAt?: string | null;
  @IsOptional() @IsDateString() endAt?: string | null;
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

/** 招募帖归档开关：只切换是否归档，不编辑帖子内容 */
class ArchiveTeamDto {
  @IsBoolean() archived!: boolean;
}

/** 竞赛自定义字段（Issue 2）：键 1-30 字（中文/字母/数字/下划线/连字符），值 ≤500 字纯文本 */
class CustomFieldDto {
  @IsString() @Length(1, 30) @Matches(/^[\u4e00-\u9fa5A-Za-z0-9_\-\s]+$/, {
    message: '字段名只能包含中文、字母、数字、下划线、连字符',
  })
  key!: string;

  @IsString() @Length(1, 500) value!: string;
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

  /** 列表 / 详情对 CONTRIBUTOR 开放只读（Issue 2：贡献者编辑竞赛信息的前置） */
  @Roles('ADMIN', 'CONTRIBUTOR')
  @Get('competitions')
  listCompetitions(@Query() q: PageDto) {
    return this.admin.adminList({ page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 20, q: q.q, status: q.status });
  }

  @Roles('ADMIN', 'CONTRIBUTOR')
  @Get('competitions/:id')
  detailCompetition(@Param('id') id: string) {
    return this.admin.adminDetail(id);
  }

  @Post('competitions')
  createCompetition(@Body() dto: CompetitionDto) {
    return this.admin.createCompetition(this.toInput(dto));
  }

  /** 编辑竞赛对 CONTRIBUTOR 开放（Issue 2）；变更照常进入版本留痕，可由管理员回滚 */
  @Roles('ADMIN', 'CONTRIBUTOR')
  @Put('competitions/:id')
  updateCompetition(@CurrentUser() user: import('@prisma/client').User, @Param('id') id: string, @Body() dto: CompetitionDto) {
    return this.admin.updateCompetition(id, this.toInput(dto), user.id);
  }

  @Delete('competitions/:id')
  archiveCompetition(@Param('id') id: string) {
    return this.admin.archiveCompetition(id);
  }

  // ---------- 竞赛自定义字段（Issue 2） ----------

  @Roles('ADMIN', 'CONTRIBUTOR')
  @Put('competitions/:id/fields')
  upsertCustomField(
    @CurrentUser() user: import('@prisma/client').User,
    @Param('id') id: string,
    @Body() dto: CustomFieldDto,
  ) {
    return this.admin.upsertCustomField(id, dto.key, dto.value, user.id);
  }

  @Roles('ADMIN', 'CONTRIBUTOR')
  @Delete('competitions/:id/fields/:key')
  deleteCustomField(@Param('id') id: string, @Param('key') key: string) {
    return this.admin.deleteCustomField(id, key);
  }

  // ---------- 赛道 / 赛程阶段 / 时间节点（结构维护） ----------
  //
  // 三维结构：Competition → Track（赛道）→ Stage（阶段）→ Event（时间节点）。
  // 时间节点也可随竞赛主体的 PUT 一起提交（events 字段），这里的独立端点供编辑页
  // 逐条即时落库使用，避免整表单 diff 的连带影响。

  @Roles('ADMIN', 'CONTRIBUTOR')
  @Post('competitions/:id/tracks')
  createTrack(@Param('id') id: string, @Body() dto: TrackDto) {
    return this.admin.createTrack(id, dto as TrackInput);
  }

  @Roles('ADMIN', 'CONTRIBUTOR')
  @Put('tracks/:trackId')
  updateTrack(@Param('trackId') trackId: string, @Body() dto: TrackDto) {
    return this.admin.updateTrack(trackId, dto as TrackInput);
  }

  @Roles('ADMIN', 'CONTRIBUTOR')
  @Delete('tracks/:trackId')
  deleteTrack(@Param('trackId') trackId: string) {
    return this.admin.deleteTrack(trackId);
  }

  @Roles('ADMIN', 'CONTRIBUTOR')
  @Post('competitions/:id/stages')
  createStage(@Param('id') id: string, @Body() dto: StageDto) {
    return this.admin.createStage(id, dto as StageInput);
  }

  @Roles('ADMIN', 'CONTRIBUTOR')
  @Put('stages/:stageId')
  updateStage(@Param('stageId') stageId: string, @Body() dto: StageDto) {
    return this.admin.updateStage(stageId, dto as StageInput);
  }

  @Roles('ADMIN', 'CONTRIBUTOR')
  @Delete('stages/:stageId')
  deleteStage(@Param('stageId') stageId: string) {
    return this.admin.deleteStage(stageId);
  }

  @Roles('ADMIN', 'CONTRIBUTOR')
  @Post('competitions/:id/events')
  createEvent(@Param('id') id: string, @Body() dto: AdminEventDto) {
    return this.admin.createEvent(id, dto as EventInput);
  }

  @Roles('ADMIN', 'CONTRIBUTOR')
  @Put('events/:eventId')
  updateEvent(@Param('eventId') eventId: string, @Body() dto: AdminEventDto) {
    return this.admin.updateEvent(eventId, dto as EventInput);
  }

  @Roles('ADMIN', 'CONTRIBUTOR')
  @Delete('events/:eventId')
  deleteEvent(@Param('eventId') eventId: string) {
    return this.admin.deleteEvent(eventId);
  }

  // ---------- 组队帖管理（列表 / 归档 / 删除） ----------

  /** 招募帖列表：支持竞赛名 / 队长昵称 / 学号搜索与状态筛选 */
  @Get('teams')
  teams(@Query() q: PageDto) {
    return this.admin.adminTeamsList({
      page: Number(q.page) || 1,
      pageSize: Number(q.pageSize) || 20,
      q: q.q,
      status: q.status,
    });
  }

  /** 归档 / 恢复招募帖（只切换是否归档，不编辑内容） */
  @Post('teams/:id/archive')
  archiveTeam(@Param('id') id: string, @Body() dto: ArchiveTeamDto) {
    return this.admin.setTeamArchived(id, dto.archived);
  }

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

  /** 编辑公告内容（展示中的公告也可改，改完同步消息中心里已投递的那条通知） */
  @Patch('announcements/:id')
  updateAnnouncement(@Param('id') id: string, @Body() dto: AnnouncementDto) {
    return this.announcementsSvc.update(id, dto);
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
    const events: UpsertEventInput[] | undefined = dto.events?.map((e) => ({
      id: e.id,
      stageId: e.stageId,
      nodeType: e.nodeType,
      label: e.label,
      location: e.location,
      startAt: e.startAt ?? null,
      endAt: e.endAt ?? null,
    }));
    const { events: _raw, ...rest } = dto;
    return { ...rest, events };
  }
}
