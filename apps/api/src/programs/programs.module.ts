import { Module } from '@nestjs/common';
import { AdminProgramsController } from './admin-programs.controller';
import { ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';

@Module({
  controllers: [ProgramsController, AdminProgramsController],
  providers: [ProgramsService],
})
export class ProgramsModule {}
