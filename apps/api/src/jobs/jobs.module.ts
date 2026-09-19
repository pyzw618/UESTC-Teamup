import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { MatchModule } from '../modules/match/match.module';

@Module({
  imports: [MatchModule],
  providers: [JobsService],
})
export class JobsModule {}
