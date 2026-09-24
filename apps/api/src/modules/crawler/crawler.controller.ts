import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { Admin } from '../../common/auth/decorators';
import { CrawlerService } from './crawler.service';

class RunCrawlerDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

class PreviewCrawlerDto {
  sourceId!: string;
}

@Admin()
@Controller('admin/crawler')
export class CrawlerController {
  constructor(private readonly crawler: CrawlerService) {}

  @Get('sources')
  sources() {
    return this.crawler.sources();
  }

  @Post('run/:sourceId')
  run(@Param('sourceId') sourceId: string, @Body() body: RunCrawlerDto) {
    return this.crawler.runSource(sourceId, { force: body?.force ?? true });
  }

  @Post('preview')
  preview(@Body() body: PreviewCrawlerDto) {
    return this.crawler.preview(body.sourceId);
  }
}
