import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { RoutinesService } from './routines.service';

/**
 * The athlete's own routines (DN-145, ADR 0006 decision 1).
 *
 * Everything written here lands with `ownerId` set to the caller -- an admin
 * included. The tier is a property of the route, as on exercises and WODs,
 * and there is no global-tier route yet: promoting a routine to global is a
 * later, one-way admin act.
 *
 * The body is validated by the service rather than here, because the service
 * method is the one every future path (copy, import) goes through.
 */
@Controller('routines')
export class RoutinesController {
  constructor(private readonly routinesService: RoutinesService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.routinesService.listOwn(userId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() body: unknown) {
    return this.routinesService.create({ ownerId: userId }, body);
  }
}
