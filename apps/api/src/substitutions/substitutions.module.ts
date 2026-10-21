import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExerciseAlternativesController } from './exercise-alternatives.controller';
import { SubstitutionsController } from './substitutions.controller';
import { SubstitutionsService } from './substitutions.service';

@Module({
  imports: [PrismaModule],
  controllers: [SubstitutionsController, ExerciseAlternativesController],
  providers: [SubstitutionsService],
})
export class SubstitutionsModule {}
