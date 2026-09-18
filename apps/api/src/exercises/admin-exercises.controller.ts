import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import {
  createExerciseSchema,
  updateExerciseSchema,
} from '@regimen-works/shared';
import { AdminOnly } from '../common/admin-only.decorator';
import { validateBody } from '../common/validate';
import { ExercisesService } from './exercises.service';

/**
 * The shared library's write side (DN-25) — the first routes to carry the
 * admin guard DN-92 shipped ahead of them.
 *
 * `@AdminOnly()` sits on the class rather than on each handler, so a route
 * added here later is closed by default instead of by remembering. The
 * decorator is enough on its own: `AdminGuard` is registered globally, and
 * `@AdminOnly()` plus a forgotten `@UseGuards` would type-check and be open.
 *
 * Every write here lands with `ownerId: null`. That is the whole reason this
 * is a separate controller from the athlete's own one: with the tier decided
 * by the route, no request body ever gets a say in it.
 *
 * There is no `GET` here. Global content is already in `GET /exercises` for
 * everyone, and an admin-only read of the same rows would be a second listing
 * to keep in step for no one's benefit.
 */
@Controller('admin/exercises')
@AdminOnly()
export class AdminExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Post()
  create(@Body() body: unknown) {
    return this.exercisesService.create(
      { ownerId: null },
      validateBody(createExerciseSchema, body),
    );
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.exercisesService.update(
      { ownerId: null },
      id,
      validateBody(updateExerciseSchema, body),
    );
  }

  @Post(':id/archive')
  archive(@Param('id') id: string) {
    return this.exercisesService.archive({ ownerId: null }, id);
  }

  @Post(':id/unarchive')
  unarchive(@Param('id') id: string) {
    return this.exercisesService.unarchive({ ownerId: null }, id);
  }
}
