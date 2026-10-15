import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { ProgramsService } from './programs.service';

/**
 * The athlete's own programs (DN-145, ADR 0006 decision 1).
 *
 * Everything written here lands with `ownerId` set to the caller -- an admin
 * included. The tier is a property of the route, as on exercises and WODs,
 * and the global tier has its own admin controller (DN-148).
 *
 * The body is validated by the service rather than here, because the service
 * method is the one every future path (copy, import) goes through.
 *
 * `/programs` is shared with EnrollmentsController's runs (`completed`,
 * `active/rest`, `:enrollmentId/…`). Only `GET completed` could also match
 * `GET :id`; the `/programs/completed` e2e tests in app.e2e-spec.ts pin that
 * it reaches the runs, and are what notice if a change here ever takes it.
 */
@Controller('programs')
export class ProgramsController {
  constructor(private readonly programsService: ProgramsService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.programsService.listOwn(userId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() body: unknown) {
    return this.programsService.create({ ownerId: userId }, body);
  }

  /**
   * The global programs an athlete may copy into their own (DN-149). Read
   * routes on the athlete's controller rather than the admin one: copying is
   * for everyone, and these only ever return global rows.
   */
  @Get('library')
  library() {
    return this.programsService.listCopyable();
  }

  /** A global program as the editor prefills a copy from it. */
  @Get('library/:id')
  libraryProgram(@Param('id') id: string) {
    return this.programsService.getForCopy(id);
  }

  /** One of the caller's programs, as the editor loads it (DN-146). */
  @Get(':id')
  get(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.programsService.getForEditing({ ownerId: userId }, id);
  }

  /**
   * Saves the whole program as the editor holds it. PUT rather than PATCH:
   * the body is the complete program, and the service decides from it
   * whether the save edits in place or forks (DN-146).
   */
  @Put(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.programsService.update({ ownerId: userId }, id, body);
  }

  /** "Remove" on Your programs (DN-147). Archives; nothing is ever deleted. */
  @Post(':id/archive')
  archive(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.programsService.archive({ ownerId: userId }, id);
  }

  @Post(':id/unarchive')
  unarchive(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.programsService.restore({ ownerId: userId }, id);
  }
}
