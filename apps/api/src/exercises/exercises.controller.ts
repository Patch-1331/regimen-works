import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  alternativeSuggestionsRequestSchema,
  createExerciseSchema,
  exerciseSearchQuerySchema,
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

  /**
   * `?includeArchived=true` adds this caller's retired movements (DN-28).
   *
   * Opt-in by the exact string, not by truthiness: `?includeArchived=false`
   * and `?includeArchived=0` both read as "no" the way anyone writing them
   * means them, and a bare `?includeArchived` is not an accident that quietly
   * puts retired movements back in a pool.
   */
  @Get()
  findAll(
    @CurrentUser() userId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.exercisesService.findAll(userId, includeArchived === 'true');
  }

  /**
   * The library page's search (DN-171). Declared before `:id` so the router
   * never reads "search" as a movement's id.
   */
  @Get('search')
  search(@CurrentUser() userId: string, @Query() query: unknown) {
    return this.exercisesService.search(
      userId,
      validateBody(exerciseSearchQuerySchema, query),
    );
  }

  @Get('retired')
  retired(@CurrentUser() userId: string) {
    return this.exercisesService.retired(userId);
  }

  @Get(':id')
  findOne(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.exercisesService.findOne(userId, id);
  }

  /**
   * Alternatives for a movement still being written (DN-205). A POST because
   * the draft is a body, not a lookup; it writes nothing. Declared before the
   * `:id` routes so "suggest-alternatives" is never read as a movement's id.
   */
  @Post('suggest-alternatives')
  suggestAlternatives(@CurrentUser() userId: string, @Body() body: unknown) {
    return this.exercisesService.suggestAlternatives(
      { ownerId: userId },
      validateBody(alternativeSuggestionsRequestSchema, body),
    );
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
