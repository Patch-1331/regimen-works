import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AthleteChecklistEntry,
  ChecklistKind,
  CreateChecklistEntry,
  MovementPattern,
  ReorderChecklistEntries,
} from '@regimen-works/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { libraryVisibleTo } from '../library/visible-to';

const LIST_NAME: Record<ChecklistKind, string> = {
  warmup: 'warm-up',
  cooldown: 'cool-down',
};

const ENTRY_SELECT = {
  id: true,
  kind: true,
  pattern: true,
  sortOrder: true,
  exercise: { select: { id: true, name: true } },
} satisfies Prisma.ChecklistEntrySelect;

type EntryRow = Prisma.ChecklistEntryGetPayload<{ select: typeof ENTRY_SELECT }>;

/** `kind` and `pattern` are plain strings in the table, validated on the way in. */
function toEntry(row: EntryRow): AthleteChecklistEntry {
  return {
    ...row,
    kind: row.kind as ChecklistKind,
    pattern: row.pattern as MovementPattern | null,
  };
}

/**
 * The athlete's own tier of the warm-up and cool-down lists (DN-173,
 * ADR-0008).
 *
 * Every method writes or reads `ownerId: userId` and nothing else. The global
 * lists are not edited here or anywhere in the app: they belong to
 * `checklist-seed.ts`, and the deploy owns the rows it writes (ADR-0010).
 * Which entries the checklist screens then show is `WodsService.getChecklists`.
 */
@Injectable()
export class ChecklistEntriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Both of the athlete's lists, each in the order they set. */
  async list(userId: string): Promise<AthleteChecklistEntry[]> {
    const rows = await this.prisma.checklistEntry.findMany({
      where: { ownerId: userId },
      select: ENTRY_SELECT,
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toEntry);
  }

  /**
   * Puts a movement at the end of one of the athlete's lists.
   *
   * The movement must be one they can see: global or their own, and not
   * retired. Anything else is a 404, the same answer as a movement that does
   * not exist, so another athlete's ids reveal nothing.
   */
  async create(
    userId: string,
    body: CreateChecklistEntry,
  ): Promise<AthleteChecklistEntry> {
    const exercise = await this.prisma.exercise.findFirst({
      where: { id: body.exerciseId, ...libraryVisibleTo(userId) },
      select: { id: true, name: true },
    });
    if (!exercise) throw new NotFoundException('No such movement.');

    const last = await this.prisma.checklistEntry.aggregate({
      where: { ownerId: userId, kind: body.kind },
      _max: { sortOrder: true },
    });
    const sortOrder = (last._max.sortOrder ?? -1) + 1;

    try {
      const row = await this.prisma.checklistEntry.create({
        data: {
          ownerId: userId,
          exerciseId: exercise.id,
          kind: body.kind,
          pattern: body.pattern,
          sortOrder,
        },
        select: ENTRY_SELECT,
      });
      return toEntry(row);
    } catch (error) {
      // The compound unique over (ownerId, exerciseId, kind): a movement is on
      // each of an athlete's lists once (ADR-0008).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `${exercise.name} is already on your ${LIST_NAME[body.kind]}.`,
        );
      }
      throw error;
    }
  }

  /** Takes an entry off the list. The movement itself is untouched. */
  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.checklistEntry.deleteMany({
      where: { id, ownerId: userId },
    });
    if (count === 0) throw new NotFoundException('No such entry.');
  }

  /**
   * Sets the order of one of the athlete's lists.
   *
   * `entryIds` must be exactly their entries of that kind. A list with one
   * missing or one extra was sent from a screen that is out of date, and a
   * 409 tells it to reload rather than leaving the positions half-written.
   */
  async reorder(
    userId: string,
    { kind, entryIds }: ReorderChecklistEntries,
  ): Promise<AthleteChecklistEntry[]> {
    const current = await this.prisma.checklistEntry.findMany({
      where: { ownerId: userId, kind },
      select: { id: true },
    });
    const owned = new Set(current.map((e) => e.id));
    if (
      entryIds.length !== owned.size ||
      entryIds.some((id) => !owned.has(id))
    ) {
      throw new ConflictException(
        `Your ${LIST_NAME[kind]} has changed since it was loaded. Reload and try again.`,
      );
    }

    await this.prisma.$transaction(
      entryIds.map((id, sortOrder) =>
        this.prisma.checklistEntry.updateMany({
          where: { id, ownerId: userId },
          data: { sortOrder },
        }),
      ),
    );

    return (await this.list(userId)).filter((e) => e.kind === kind);
  }
}
