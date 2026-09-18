import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  createExerciseSchema,
  updateExerciseSchema,
} from '@regimen-works/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { validateBody } from '../common/validate';
import { ExercisesService } from './exercises.service';

/**
 * The athlete's own half of the library (DN-25). Everything written here lands
 * with `ownerId` set to the caller, which is why there is no `ownerId` in any
 * of these bodies: the tier is a property of the route, not of the request.
 *
 * The global half is `AdminExercisesController`, behind `@AdminOnly()`.
 */
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get()
  findAll(@CurrentUser() userId: string) {
    return this.exercisesService.findAll(userId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() body: unknown) {
    return this.exercisesService.create(
      { ownerId: userId },
      validateBody(createExerciseSchema, body),
    );
  }

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.exercisesService.update(
      { ownerId: userId },
      id,
      validateBody(updateExerciseSchema, body),
    );
  }

  @Post(':id/archive')
  archive(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.exercisesService.archive({ ownerId: userId }, id);
  }

  @Post(':id/unarchive')
  unarchive(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.exercisesService.unarchive({ ownerId: userId }, id);
  }
}
