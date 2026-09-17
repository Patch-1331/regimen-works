import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { WodsService } from './wods.service';

@Controller('wods')
export class WodsController {
  constructor(private readonly wodsService: WodsService) {}

  @Get()
  findAll(@CurrentUser() userId: string) {
    return this.wodsService.findAll(userId);
  }
}
