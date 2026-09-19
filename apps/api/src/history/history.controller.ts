import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { HistoryService } from './history.service';

@Controller()
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  /** Per-movement training history for the signed-in athlete (DN-89). */
  @Get('movement-history')
  movements(@CurrentUser() userId: string) {
    return this.historyService.movements(userId);
  }

  /** Per-movement volume, from the sets that were actually recorded (DN-22). */
  @Get('movement-volume')
  movementVolume(@CurrentUser() userId: string) {
    return this.historyService.movementVolume(userId);
  }
}
