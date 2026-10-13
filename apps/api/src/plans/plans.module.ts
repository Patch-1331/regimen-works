import { Module } from '@nestjs/common';
import { AdminRoutinesController } from './admin-routines.controller';
import { RoutinesController } from './routines.controller';
import { RoutinesService } from './routines.service';

@Module({
  controllers: [RoutinesController, AdminRoutinesController],
  providers: [RoutinesService],
})
export class PlansModule {}
