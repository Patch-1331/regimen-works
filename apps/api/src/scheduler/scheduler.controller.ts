import { Body, Controller, Get, Post } from '@nestjs/common';
import { chooseTodayRequestSchema } from '@regimen-works/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { todayIsoDate } from '../common/today';
import { validateBody } from '../common/validate';
import { SchedulerService } from './scheduler.service';

@Controller()
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Get('today')
  getToday(@CurrentUser() userId: string) {
    return this.schedulerService.getToday(userId, todayIsoDate());
  }

  @Post('today/skip')
  skipToday(@CurrentUser() userId: string) {
    return this.schedulerService.skipToday(userId, todayIsoDate());
  }

  /** Start a program that is waiting for its start date today instead (DN-200). */
  @Post('today/start-program')
  startProgramToday(@CurrentUser() userId: string) {
    return this.schedulerService.startProgramToday(userId, todayIsoDate());
  }

  /** Train on a rest day while the week is short (DN-17). */
  @Post('today/makeup')
  trainMakeup(@CurrentUser() userId: string) {
    return this.schedulerService.trainMakeup(userId, todayIsoDate());
  }

  /** Train a workout picked from the library today instead (DN-201). */
  @Post('today/choose')
  chooseToday(@CurrentUser() userId: string, @Body() body: unknown) {
    const { wodId } = validateBody(chooseTodayRequestSchema, body);
    return this.schedulerService.chooseToday(userId, todayIsoDate(), wodId);
  }

  @Get('schedule-rule')
  getScheduleRule(@CurrentUser() userId: string) {
    return this.schedulerService.getScheduleCap(userId);
  }
}
