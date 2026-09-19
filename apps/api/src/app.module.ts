import { PrismaModule } from './common/prisma.module';
import { RedisModule } from './common/redis.service';
import { AuthModule } from './modules/auth/auth.module';
import { MailModule } from './modules/mail/mail.module';
import { UsersModule } from './modules/users/users.module';
import { NotificationModule } from './modules/notification/notification.module';
import { RadarModule } from './modules/radar/radar.module';
import { MatchModule } from './modules/match/match.module';
import { AdminModule } from './modules/admin/admin.module';
import { JobsModule } from './jobs/jobs.module';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { AuthCommonModule } from './common/auth/auth-common.module';
import { AuthGuard } from './common/auth/auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    AuthCommonModule,
    MailModule,
    UsersModule,
    AuthModule,
    NotificationModule,
    RadarModule,
    MatchModule,
    AdminModule,
    JobsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
