import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  createChecklistEntrySchema,
  reorderChecklistEntriesSchema,
} from '@regimen-works/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { validateBody } from '../common/validate';
import { ChecklistEntriesService } from './checklist-entries.service';

/**
 * The athlete's own warm-up and cool-down entries (DN-173). Every route
 * writes the caller's tier and no other; there is no admin half, because the
 * global lists are the seed's (ADR-0010).
 */
@Controller('checklist-entries')
export class ChecklistEntriesController {
  constructor(private readonly entries: ChecklistEntriesService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.entries.list(userId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() body: unknown) {
    return this.entries.create(
      userId,
      validateBody(createChecklistEntrySchema, body),
    );
  }

  /** Declared before `:id` so "order" is never read as an entry id. */
  @Put('order')
  reorder(@CurrentUser() userId: string, @Body() body: unknown) {
    return this.entries.reorder(
      userId,
      validateBody(reorderChecklistEntriesSchema, body),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.entries.remove(userId, id);
  }
}
