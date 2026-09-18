import { Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { todayIsoDate } from '../common/today';
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

  @Get('schedule-rule')
  getScheduleRule(@CurrentUser() userId: string) {
    return this.schedulerService.getScheduleCap(userId);
  }
}
