import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { updateRestPaceSchema } from '@regimen-works/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { todayIsoDate } from '../common/today';
import { validateBody } from '../common/validate';
import { EnrollmentsService } from './enrollments.service';

/**
 * What the athlete has finished, and what to do about it (DN-18).
 *
 * Mounted on `programs` rather than `enrollments` because that is the word
 * the athlete's screens use -- the Completed list is a list of programs, and
 * the enrollment is the record of their run at one. The id in the path is
 * still the enrollment's, since running the same program twice is two rows
 * and the card belongs to one of them.
 *
 * The card itself is not here: it rides on `GET /today` beside the day it
 * sits above, so Today assembles in one request.
 */
@Controller('programs')
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get('completed')
  listCompleted(@CurrentUser() userId: string) {
    return this.enrollments.listCompleted(userId);
  }

  /**
   * The rest pace of the program being run (ADR 0005). `active` rather than an
   * id, because there is exactly one run it can mean and a client holding a
   * stale id should not be able to edit a finished one.
   */
  @Patch('active/rest')
  updateRestPace(@CurrentUser() userId: string, @Body() body: unknown) {
    return this.enrollments.updateRestPace(
      userId,
      validateBody(updateRestPaceSchema, body),
    );
  }

  @Post(':enrollmentId/dismiss')
  async dismiss(
    @CurrentUser() userId: string,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    await this.enrollments.dismiss(userId, enrollmentId);
    return { dismissed: true };
  }

  @Post(':enrollmentId/run-again')
  runAgain(
    @CurrentUser() userId: string,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.enrollments.runAgain(userId, enrollmentId, todayIsoDate());
  }
}
