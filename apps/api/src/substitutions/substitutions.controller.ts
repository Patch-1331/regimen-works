import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  setSubstitutionRequestSchema,
  swapOptionsQuerySchema,
} from '@regimen-works/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { validateBody } from '../common/validate';
import { SubstitutionsService } from './substitutions.service';

@Controller('assignments/:assignmentId/substitutions')
export class SubstitutionsController {
  constructor(private readonly substitutionsService: SubstitutionsService) {}

  /**
   * Read before the completion screen renders. Declared above the
   * `:wodMovementId` routes so "movement-changes" is never taken for a
   * movement id.
   */
  @Get('movement-changes')
  proposedMovementChanges(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.substitutionsService.proposedMovementChanges(
      userId,
      assignmentId,
    );
  }

  /**
   * The swap panel's options for one movement (DN-170), read when the panel
   * opens. Above the `:wodMovementId` routes for the reason the read above is.
   */
  @Get('options')
  options(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
    @Query() query: unknown,
  ) {
    // The same validator as a body: a query string is an object of strings
    // too, and the either-or is the schema's to state.
    const { wodMovementId, programSlotMovementId } = validateBody(
      swapOptionsQuerySchema,
      query,
    );
    return this.substitutionsService.options(userId, assignmentId, {
      wodMovementId,
      programSlotMovementId: programSlotMovementId,
    });
  }

  @Post()
  set(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: unknown,
  ) {
    const { wodMovementId, programSlotMovementId, exerciseId } = validateBody(
      setSubstitutionRequestSchema,
      body,
    );
    return this.substitutionsService.set(
      userId,
      assignmentId,
      { wodMovementId, programSlotMovementId: programSlotMovementId },
      exerciseId,
    );
  }

  /**
   * Undoing a swap on a prescribed day (DN-125). Its own route rather than a
   * discriminator on the one below, because a bare id in the path cannot say
   * which table it came from — and declared above it for the same reason
   * "movement-changes" is, so the prefix is never taken for a movement id.
   */
  @Delete('prescribed/:programSlotMovementId')
  @HttpCode(204)
  clearPrescribed(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
    @Param('programSlotMovementId') programSlotMovementId: string,
  ) {
    return this.substitutionsService.clear(userId, assignmentId, {
      wodMovementId: null,
      programSlotMovementId,
    });
  }

  @Delete(':wodMovementId')
  @HttpCode(204)
  clear(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
    @Param('wodMovementId') wodMovementId: string,
  ) {
    return this.substitutionsService.clear(userId, assignmentId, {
      wodMovementId,
      programSlotMovementId: null,
    });
  }
}
