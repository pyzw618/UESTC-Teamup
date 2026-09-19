import { Module } from '@nestjs/common';
import { AdminController, ReportsController, AnnouncementsController } from './admin.controller';
import { AdminService } from './admin.service';
import { ReportsService } from './reports.service';
import { AnnouncementsService } from './announcements.service';
import { RadarModule } from '../radar/radar.module';

@Module({
  imports: [RadarModule],
  controllers: [AdminController, ReportsController, AnnouncementsController],
  providers: [AdminService, ReportsService, AnnouncementsService],
})
export class AdminModule {}
