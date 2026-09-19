import { Module } from '@nestjs/common';
import { RadarController } from './radar.controller';
import { CompetitionsService } from './competitions.service';
import { CalendarService } from './calendar.service';
import { CommentsService } from './comments.service';
import { CorrectionsService } from './corrections.service';
import { FavoritesService } from './favorites.service';
import { SearchService } from './search.service';

@Module({
  controllers: [RadarController],
  providers: [
    CompetitionsService,
    CalendarService,
    CommentsService,
    CorrectionsService,
    FavoritesService,
    SearchService,
  ],
  exports: [CompetitionsService],
})
export class RadarModule {}
