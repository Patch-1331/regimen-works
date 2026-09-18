import { Module } from '@nestjs/common';
import { WodsController } from './wods.controller';
import { AdminWodsController } from './admin-wods.controller';
import { WodsService } from './wods.service';

@Module({
  controllers: [WodsController, AdminWodsController],
  providers: [WodsService],
  exports: [WodsService],
})
export class WodsModule {}
