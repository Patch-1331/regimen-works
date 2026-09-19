import { Body, Controller, Get, Post } from '@nestjs/common';
import { commitSetupSchema } from '@regimen-works/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { todayIsoDate } from '../common/today';
import { validateBody } from '../common/validate';
import { SetupService } from './setup.service';

/**
 * The first-run wizard's two endpoints (DN-15): what to ask, and the answers.
 *
 * Nothing here is admin-only or first-run-only. An athlete who has already
 * onboarded can re-run setup, and that is deliberate -- it is how they change
 * programs until the Settings surface for it exists (DN-18), and a gate that
 * refused would make the wizard a screen they can reach and not use.
 */
@Controller('setup')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  @Get()
  options(@CurrentUser() userId: string) {
    return this.setupService.options(userId, todayIsoDate());
  }

  @Post()
  commit(@CurrentUser() userId: string, @Body() body: unknown) {
    const answers = validateBody(commitSetupSchema, body);
    return this.setupService.commit(userId, answers, todayIsoDate());
  }
}
