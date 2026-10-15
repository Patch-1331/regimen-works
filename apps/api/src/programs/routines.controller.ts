import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { RoutinesService } from './routines.service';

/**
 * The athlete's own routines (DN-145, ADR 0006 decision 1).
 *
 * Everything written here lands with `ownerId` set to the caller -- an admin
 * included. The tier is a property of the route, as on exercises and WODs,
 * and the global tier has its own admin controller (DN-148).
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

  /**
   * The global routines an athlete may copy into their own (DN-149). Read
   * routes on the athlete's controller rather than the admin one: copying is
   * for everyone, and these only ever return global rows.
   */
  @Get('library')
  library() {
    return this.routinesService.listCopyable();
  }

  /** A global routine as the editor prefills a copy from it. */
  @Get('library/:id')
  libraryRoutine(@Param('id') id: string) {
    return this.routinesService.getForCopy(id);
  }

  /** One of the caller's routines, as the editor loads it (DN-146). */
  @Get(':id')
  get(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.routinesService.getForEditing({ ownerId: userId }, id);
  }

  /**
   * Saves the whole routine as the editor holds it. PUT rather than PATCH:
   * the body is the complete routine, and the service decides from it
   * whether the save edits in place or forks (DN-146).
   */
  @Put(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.routinesService.update({ ownerId: userId }, id, body);
  }

  /** "Remove" on My routines (DN-147). Archives; nothing is ever deleted. */
  @Post(':id/archive')
  archive(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.routinesService.archive({ ownerId: userId }, id);
  }

  @Post(':id/unarchive')
  unarchive(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.routinesService.restore({ ownerId: userId }, id);
  }
}
