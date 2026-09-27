import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import type { Response } from 'express';
import { FeedbackType } from '@prisma/client';
import { Admin, CurrentUser, Public } from '../../common/auth/decorators';
import type { User } from '@prisma/client';
import { FeedbackService } from './feedback.service';

class SubmitFeedbackDto {
  @IsEnum(FeedbackType) type!: FeedbackType;
  /** COMPETITION_INFO 类型必填：反馈针对的竞赛（服务端按 id 读取名称快照） */
  @IsOptional() @IsString() competitionId?: string;
  /** FUNCTION 类型自动附带：提交时的页面路径 */
  @IsOptional() @IsString() @Length(0, 300) pagePath?: string;
  @IsString() @Length(1, 2000, { message: '反馈内容最长 2000 字' }) content!: string;
  /** 选填回访联系方式 */
  @IsOptional() @IsString() @Length(0, 100) contact?: string;
}

@Controller()
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  /** 双入口共用：游客可提交（附选填联系方式）；登录用户自动关联账号 */
  @Public()
  @Post('feedback')
  submit(@CurrentUser() user: User | undefined, @Body() dto: SubmitFeedbackDto) {
    return this.feedback.submit(dto, user?.id);
  }

  // ---------- 后台：查看 / 导出（Issue 5） ----------

  @Admin()
  @Get('admin/feedback')
  listByDate(@Query('date') date: string) {
    return this.feedback.listByDate(date);
  }

  /** 每日反馈条数（后台日期选择器把无反馈日期置灰） */
  @Admin()
  @Get('admin/feedback/counts')
  countsByMonth(@Query('month') month: string) {
    return this.feedback.countsByMonth(month);
  }

  /** 单日反馈 JSON 导出（一次只能下载一天；无反馈的日期前端禁用下载） */
  @Admin()
  @Get('admin/feedback/export')
  async exportByDate(@Query('date') date: string, @Res() res: Response) {
    const data = await this.feedback.exportByDate(date);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="feedback-${date}.json"`);
    res.send(JSON.stringify(data, null, 2));
  }
}
