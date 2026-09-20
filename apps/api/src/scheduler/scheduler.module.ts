import { Module } from '@nestjs/common';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { WodsModule } from '../wods/wods.module';
import { MovementResolutionService } from './movement-resolution.service';
import { SchedulerController } from './scheduler.controller';
import { rngProvider } from './rng';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [WodsModule, EnrollmentsModule],
  controllers: [SchedulerController],
  providers: [SchedulerService, MovementResolutionService, rngProvider],
  // Session start snapshots the same resolution the Today plate shows (DN-90).
  exports: [MovementResolutionService],
})
export class SchedulerModule {}
