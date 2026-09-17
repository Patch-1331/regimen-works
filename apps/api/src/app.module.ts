import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ClerkAuthGuard } from './auth/clerk-auth.guard';
import { ProxyAwareThrottlerGuard } from './common/proxy-aware-throttler.guard';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { ExercisesModule } from './exercises/exercises.module';
import { WodsModule } from './wods/wods.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SessionsModule } from './sessions/sessions.module';
import { SubstitutionsModule } from './substitutions/substitutions.module';
import { HistoryModule } from './history/history.module';
import { LogsModule } from './logs/logs.module';
import { SkillLevelsModule } from './skill-levels/skill-levels.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    // Two tiers, because one number can't express both shapes of abuse. The
    // burst tier stops a hot loop; the sustained tier stops a slow drip that
    // stays under it. Limits are per client IP (see ProxyAwareThrottlerGuard)
    // and sized well above real use — a workout taps a handful of requests a
    // minute, so these should only ever be felt by something automated.
    //
    // Storage is in-process, so the counters reset on deploy and would not be
    // shared if this service ever ran more than one instance. Both are fine at
    // numInstances: 1; a second instance wants a shared store.
    ThrottlerModule.forRoot([
      { name: 'burst', ttl: 10_000, limit: 40 },
      { name: 'sustained', ttl: 60_000, limit: 200 },
    ]),
    PrismaModule,
    AuthModule,
    ExercisesModule,
    WodsModule,
    SchedulerModule,
    SessionsModule,
    SubstitutionsModule,
    LogsModule,
    HistoryModule,
    SkillLevelsModule,
    SettingsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Order is execution order. Throttling first means a flood of unverifiable
    // tokens is rejected before it costs a JWT verification, which is the
    // expensive half of an unauthenticated request.
    { provide: APP_GUARD, useClass: ProxyAwareThrottlerGuard },
    { provide: APP_GUARD, useClass: ClerkAuthGuard },
  ],
})
export class AppModule {}
