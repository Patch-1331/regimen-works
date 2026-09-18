import { Module } from '@nestjs/common';
import { ExercisesController } from './exercises.controller';
import { AdminExercisesController } from './admin-exercises.controller';
import { ExercisesService } from './exercises.service';

@Module({
  controllers: [ExercisesController, AdminExercisesController],
  providers: [ExercisesService],
})
export class ExercisesModule {}
