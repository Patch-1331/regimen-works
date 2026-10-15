import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { AdminOnly } from '../common/admin-only.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { ProgramsService } from './programs.service';

/**
 * The global program library's write side (DN-148, ADR 0006 decisions 2, 4
 * and 5) -- how anything gets into it, now the seeded programs are retired.
 *
 * `@AdminOnly()` on the class, as on `AdminExercisesController`, so a route
 * added here later is closed by default. Every write lands with
 * `ownerId: null`: the tier is which controller was called, never a field of
 * the body, so nothing an athlete posts to `/programs` can make a global row.
 *
 * Each handler calls the same service method as the owner's route. Just WODs
 * is listed but refused by every one of them, by the service.
 */
@Controller('admin/programs')
@AdminOnly()
export class AdminProgramsController {
  constructor(private readonly programsService: ProgramsService) {}

  /** Live and archived, Just WODs first and marked built in. */
  @Get()
  list() {
    return this.programsService.listGlobal();
  }

  @Post()
  create(@Body() body: unknown) {
    return this.programsService.create({ ownerId: null }, body);
  }

  /**
   * The ticked global programs as one file, live or archived (DN-150). A
   * POST because the ticks are a body; it changes nothing. Personal programs
   * cannot be exported by this route or any other.
   */
  @Post('export')
  @HttpCode(200)
  export(@Body() body: unknown) {
    return this.programsService.exportGlobal(body);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.programsService.getForEditing({ ownerId: null }, id);
  }

  /** In place or a fork, by the same rule as an athlete's own (DN-146). */
  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.programsService.update({ ownerId: null }, id, body);
  }

  /** `running` answers for the admin's own run, the one person asking. */
  @Post(':id/archive')
  archive(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.programsService.archive({ ownerId: null }, id, userId);
  }

  @Post(':id/unarchive')
  unarchive(@Param('id') id: string) {
    return this.programsService.restore({ ownerId: null }, id);
  }

  /**
   * Publishes one of the admin's *own* programs -- `:id` is a personal row,
   * found under the caller's id, and becomes global in place. One-way: there
   * is no demote route.
   */
  @Post(':id/promote')
  promote(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.programsService.promote(userId, id);
  }
}
