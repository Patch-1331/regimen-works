import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  advanceIntervalSchema,
  editSetLogsSchema,
  logRoundSplitSchema,
  logSetSchema,
  setRoundSplitRequestSchema,
} from '@regimen-works/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { validateBody } from '../common/validate';
import { SessionsService } from './sessions.service';

@Controller('assignments/:assignmentId/session')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  get(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.sessionsService.get(userId, assignmentId);
  }

  @Post()
  start(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.sessionsService.start(userId, assignmentId);
  }

  @Post('rounds')
  logRound(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: unknown,
  ) {
    const round = validateBody(logRoundSplitSchema, body);
    return this.sessionsService.logRound(userId, assignmentId, round);
  }

  @Post('sets')
  logSet(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: unknown,
  ) {
    const next = validateBody(logSetSchema, body);
    return this.sessionsService.logSet(userId, assignmentId, next);
  }

  /**
   * The sets recorded against this session (DN-21) -- read by the log screen,
   * which lets the athlete correct what the runner tracked.
   */
  @Get('sets')
  setLogs(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.sessionsService.setLogs(userId, assignmentId);
  }

  /** Corrections to sets already recorded. Updates only -- see `editSetLogs`. */
  @Patch('sets')
  editSetLogs(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: unknown,
  ) {
    const edits = validateBody(editSetLogsSchema, body);
    return this.sessionsService.editSetLogs(userId, assignmentId, edits);
  }

  @Post('interval')
  advanceInterval(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: unknown,
  ) {
    const next = validateBody(advanceIntervalSchema, body);
    return this.sessionsService.advanceInterval(userId, assignmentId, next);
  }

  @Post('finish')
  finish(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.sessionsService.finish(userId, assignmentId);
  }

  @Post('warmup-complete')
  completeWarmup(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.sessionsService.completeWarmup(userId, assignmentId);
  }

  @Post('cooldown-complete')
  completeCooldown(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.sessionsService.completeCooldown(userId, assignmentId);
  }

  @Delete()
  @HttpCode(204)
  cancel(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.sessionsService.cancel(userId, assignmentId);
  }

  @Post('split')
  setRoundSplit(
    @CurrentUser() userId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: unknown,
  ) {
    const { roundSplitCount } = validateBody(setRoundSplitRequestSchema, body);
    return this.sessionsService.setRoundSplit(
      userId,
      assignmentId,
      roundSplitCount,
    );
  }
}
