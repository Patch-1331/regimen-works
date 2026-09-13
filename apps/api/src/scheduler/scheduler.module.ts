import { Module } from '@nestjs/common';
import { WodsModule } from '../wods/wods.module';
import { MovementResolutionService } from './movement-resolution.service';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [WodsModule],
  controllers: [SchedulerController],
  providers: [SchedulerService, MovementResolutionService],
  // Session start snapshots the same resolution the Today plate shows (DN-90).
  exports: [MovementResolutionService],
})
export class SchedulerModule {}
