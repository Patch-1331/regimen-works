import { Module } from '@nestjs/common';
import { ChecklistEntriesController } from './checklist-entries.controller';
import { ChecklistEntriesService } from './checklist-entries.service';

@Module({
  controllers: [ChecklistEntriesController],
  providers: [ChecklistEntriesService],
})
export class ChecklistsModule {}
