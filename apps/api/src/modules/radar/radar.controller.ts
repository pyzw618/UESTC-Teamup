import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { CommentTarget } from '@teamup/shared';
import { TransformBoolean, TransformStringArray } from '../../common/query.transform';
import { CurrentUser, Public } from '../../common/auth/decorators';
import type { User } from '@prisma/client';
import type { Response } from 'express';
import { UserSerializer } from '../../common/auth/viewer.context';
import { CompetitionsService } from './competitions.service';
import { CalendarService } from './calendar.service';
import { CommentsService } from './comments.service';
import { CorrectionsService } from './corrections.service';
import { FavoritesService } from './favorites.service';
import { SearchService } from './search.service';

class ListQueryDto {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @TransformStringArray() levels?: string[];
  @IsOptional() @TransformStringArray() tags?: string[];
  @IsOptional() @IsIn(['UNDERGRAD', 'POSTGRAD', 'MIXED']) audience?: string;
  @IsOptional() @IsIn(['INDIVIDUAL', 'TEAM']) format?: string;
  @IsOptional() @TransformBoolean() bonusOnly?: boolean;
  @IsOptional() @IsIn(['OPEN', 'UPCOMING', 'ENDED']) status?: 'OPEN' | 'UPCOMING' | 'ENDED';
  @IsOptional() @IsIn(['DEADLINE', 'LATEST', 'DIFFICULTY', 'HOT']) sort?: string;
  @IsOptional() @IsInt() @Min(1) page: number = 1;
  @IsOptional() @IsInt() @Min(1) @Max(60) pageSize: number = 12;
}

class CorrectionDto {
  @IsString() @Length(1, 60) field!: string;
  @IsOptional() @IsString() @Length(1, 500) proposedValue?: string;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

class CommentDto {
  @IsIn(Object.values(CommentTarget)) targetType!: CommentTarget;
  @IsString() targetId!: string;
  @IsString() @Length(1, 2000) content!: string;
  @IsOptional() @IsString() parentId?: string;
}

class FavoriteDto {
  @IsIn(Object.values(CommentTarget)) targetType!: CommentTarget;
  @IsString() targetId!: string;
}

class CalendarQueryDto {
  @IsOptional() @IsString() start?: string;
  @IsOptional() @IsString() end?: string;
  @IsOptional() @TransformStringArray() levels?: string[];
}

@Controller()
export class RadarController {
  constructor(
    private readonly competitions: CompetitionsService,
    private readonly calendarSvc: CalendarService,
    private readonly comments: CommentsService,
    private readonly corrections: CorrectionsService,
    private readonly favorites: FavoritesService,
    private readonly searchSvc: SearchService,
    private readonly serializer: UserSerializer,
  ) {}

  @Public()
  @Get('home')
  home(@CurrentUser() user?: User) {
    return this.competitions.home(user?.id);
  }

  @Public()
  @Get('competitions')
  list(@Query() query: ListQueryDto) {
    return this.competitions.list({
      ...query,
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 12,
    } as never);
  }

  @Public()
  @Get('competitions/:id')
  async detail(@CurrentUser() user: User | undefined, @Param('id') id: string) {
    const detail = await this.competitions.detail(id);
    const recruitingTeamsCount = detail.recruitingTeams.length;
    // 组队招募信息不是互联网公开信息：游客只能看到“有多少支队伍正在招募”，
    // 拿不到帖子详情 / 队长 / 联系方式。权限在服务端实施，不能只靠前端遮挡。
    if (!user) {
      return { ...detail, recruitingTeams: [], recruitingTeamsCount };
    }
    return {
      ...detail,
      recruitingTeamsCount,
      recruitingTeams: detail.recruitingTeams.map((t) => ({
        id: t.id,
        goal: t.goal,
        status: t.status,
        deadline: t.deadline,
        neededRoles: t.neededRoles,
        targetSize: t.targetSize,
        memberCount: t._count.members,
        leader: this.serializer.serialize({ ...t.leader, teamIds: [] }),
      })),
    };
  }

  /** 提交纠错（全自动模式的事后纠错入口） */
  @Post('competitions/:id/corrections')
  submitCorrection(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: CorrectionDto) {
    return this.corrections.submit(user.id, id, dto);
  }

  @Public()
  @Get('calendar')
  calendar(@Query() query: CalendarQueryDto) {
    return this.calendarSvc.range(query);
  }

  /** 订阅到手机日历（比站内提醒有用 10 倍） */
  @Public()
  @Get('calendar.ics')
  async ics(@Res() res: Response) {
    const text = await this.calendarSvc.ics();
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="uestc-teamup.ics"');
    res.send(text);
  }

  @Public()
  @Get('search')
  search(@Query('q') q: string, @Query('kind') kind = 'competition') {
    return this.searchSvc.search(q, kind);
  }

  @Public()
  @Get('comments')
  listComments(@CurrentUser() user?: User, @Query('targetType') targetType?: CommentTarget, @Query('targetId') targetId?: string) {
    return this.comments.list(targetType as CommentTarget, targetId as string, user?.id);
  }

  @Post('comments')
  createComment(@CurrentUser() user: User, @Body() dto: CommentDto) {
    return this.comments.create(user.id, dto);
  }

  /** 点赞 / 取消点赞（幂等切换） */
  @Post('comments/:id/like')
  toggleCommentLike(@CurrentUser() user: User, @Param('id') id: string) {
    return this.comments.toggleLike(user.id, id);
  }

  @Delete('comments/:id')
  deleteComment(@CurrentUser() user: User, @Param('id') id: string) {
    return this.comments.delete(user.id, id);
  }

  /** 关注（竞赛 = 接收 DDL 提醒）与收藏；重复调用即取消 */
  @Post('favorites')
  toggleFavorite(@CurrentUser() user: User, @Body() dto: FavoriteDto) {
    return this.favorites.toggle(user.id, dto.targetType, dto.targetId);
  }

  @Get('favorites')
  myFavorites(@CurrentUser() user: User, @Query('targetType') targetType?: CommentTarget) {
    return this.favorites.listMine(user.id, targetType);
  }
}
