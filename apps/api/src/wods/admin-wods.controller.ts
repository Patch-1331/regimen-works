import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { createWodSchema, updateWodSchema } from '@regimen-works/shared';
import { AdminOnly } from '../common/admin-only.decorator';
import { validateBody } from '../common/validate';
import { WodsService } from './wods.service';

/**
 * The shared WOD library's write side (DN-26).
 *
 * `@AdminOnly()` sits on the class rather than on each handler, so a route
 * added here later is closed by default instead of by remembering. The
 * decorator is enough on its own: `AdminGuard` is registered globally, and
 * `@AdminOnly()` plus a forgotten `@UseGuards` would type-check and be open.
 *
 * What is behind it matters more here than on the exercise library. Global
 * WODs are the scheduler's candidate pool for every athlete, so an unmarked
 * route would let any signed-in athlete change what everyone trains.
 *
 * Every write here lands with `ownerId: null`. That is the whole reason this
 * is a separate controller from the athlete's own one: with the tier decided
 * by the route, no request body ever gets a say in it.
 *
 * There is no `GET` here, for the reason there is none on
 * `AdminExercisesController`: global content is already in `GET /wods` for
 * everyone.
 */
@Controller('admin/wods')
@AdminOnly()
export class AdminWodsController {
  constructor(private readonly wodsService: WodsService) {}

  @Post()
  create(@Body() body: unknown) {
    return this.wodsService.create(
      { ownerId: null },
      validateBody(createWodSchema, body),
    );
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.wodsService.update(
      { ownerId: null },
      id,
      validateBody(updateWodSchema, body),
    );
  }

  @Post(':id/archive')
  archive(@Param('id') id: string) {
    return this.wodsService.archive({ ownerId: null }, id);
  }

  @Post(':id/unarchive')
  unarchive(@Param('id') id: string) {
    return this.wodsService.unarchive({ ownerId: null }, id);
  }
}
