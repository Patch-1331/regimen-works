import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { createWodSchema, updateWodSchema } from '@regimen-works/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { validateBody } from '../common/validate';
import { WodsService } from './wods.service';

/**
 * The athlete's own half of the WOD library (DN-26). Everything written here
 * lands with `ownerId` set to the caller, which is why there is no `ownerId`
 * in any of these bodies: the tier is a property of the route, not of the
 * request.
 *
 * The global half is `AdminWodsController`, behind `@AdminOnly()`.
 *
 * There are no `WodMovement` routes. A movement carries no `ownerId` of its
 * own, so it is only ever authorized through the WOD that owns it — writing
 * the list as a field of its parent is what makes that true by construction.
 */
@Controller('wods')
export class WodsController {
  constructor(private readonly wodsService: WodsService) {}

  /**
   * `?includeArchived=true` adds this caller's retired workouts (DN-29).
   *
   * Opt-in by the exact string, for the reason spelled out on
   * `ExercisesController.findAll`: `=false`, `=0` and a bare
   * `?includeArchived` all read as no, so a flag that got mangled on its way
   * into a URL cannot quietly put retired workouts back in the pool the
   * scheduler picks from.
   */
  @Get()
  findAll(
    @CurrentUser() userId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.wodsService.findAll(userId, includeArchived === 'true');
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() body: unknown) {
    return this.wodsService.create(
      { ownerId: userId },
      validateBody(createWodSchema, body),
    );
  }

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.wodsService.update(
      { ownerId: userId },
      id,
      validateBody(updateWodSchema, body),
    );
  }

  @Post(':id/archive')
  archive(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.wodsService.archive({ ownerId: userId }, id);
  }

  @Post(':id/unarchive')
  unarchive(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.wodsService.unarchive({ ownerId: userId }, id);
  }
}
