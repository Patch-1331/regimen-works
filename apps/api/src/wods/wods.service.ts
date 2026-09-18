import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateWod,
  CreateWodMovement,
  UpdateWod,
} from '@regimen-works/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  libraryOwnedBy,
  libraryVisibleTo,
  referenceableBy,
  type LibraryWriter,
} from '../library/visible-to';
import {
  buildCooldownChecklist,
  buildWarmupChecklist,
} from './checklist.logic';

/** What every write hands back, so a client never has to re-read to see it. */
const WITH_MOVEMENTS = {
  movements: { include: { exercise: true }, orderBy: { order: 'asc' } },
} as const;

/** The formats `resolveIntervalConfig` answers for. */
const INTERVAL_TYPES = new Set(['emom', 'tabata']);

/** The three columns that only mean something on an interval format. */
const INTERVAL_FIELDS = [
  'workSeconds',
  'restSeconds',
  'intervalCount',
] as const;

/**
 * The movement rows as they will be stored.
 *
 * `order` comes from the array's own indices and `reps` from the ladder, so
 * neither is a number the caller and the database have to agree about. The
 * CHECK constraint `WodMovement_repScheme_sums_to_reps` is enforced by
 * Postgres rather than by validation, which means a write that let the two
 * drift would fail as an opaque constraint violation rather than as anything
 * a person could act on. Deriving it is how that stops being possible.
 */
function movementRows(movements: CreateWodMovement[]) {
  return movements.map((m, order) => ({
    exerciseId: m.exerciseId,
    order,
    reps: m.repScheme.length
      ? m.repScheme.reduce((sum, r) => sum + r, 0)
      : // Non-null wherever the scheme is empty — `createWodMovementSchema`
        // accepts exactly one of the two.
        (m.reps as number),
    repScheme: m.repScheme,
  }));
}

/**
 * Refuses interval structure on a format that has no intervals.
 *
 * `resolveIntervalConfig` returns null for AMRAP and For Time, so values
 * stored here would be written, never read, and never reported — the silent
 * shape of gap DN-83 is about. Better to say so at the one moment someone is
 * in a position to fix it.
 */
function assertIntervalCoherent(row: {
  type: string;
  workSeconds: number | null;
  restSeconds: number | null;
  intervalCount: number | null;
}) {
  if (INTERVAL_TYPES.has(row.type)) return;

  const set = INTERVAL_FIELDS.filter((f) => row[f] !== null);
  if (set.length === 0) return;

  throw new BadRequestException(
    `${set.join(', ')} describe an interval timer, and a ${row.type} WOD does not run one — these would be stored and never read`,
  );
}

@Injectable()
export class WodsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The global library plus this athlete's own WODs (DN-93).
   *
   * `includeArchived` is for the editor screen and nothing else (DN-29), on
   * the same reasoning as `ExercisesService.findAll`: every other caller is a
   * pool the scheduler picks from, and a pool offering a retired workout is
   * the bug the soft delete exists to prevent. It defaults to false, so the
   * one page that wants retired rows is the one that has to say so.
   */
  findAll(userId: string, includeArchived = false) {
    return this.prisma.wod.findMany({
      where: includeArchived
        ? libraryOwnedBy(userId)
        : libraryVisibleTo(userId),
      include: {
        movements: { include: { exercise: true }, orderBy: { order: 'asc' } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(writer: LibraryWriter, body: CreateWod) {
    const { movements, ...fields } = body;

    await this.assertNameFree(writer, body.name);
    assertIntervalCoherent(body);
    await this.assertReferenceable(writer, movements);

    return this.prisma.wod.create({
      data: {
        ...fields,
        ownerId: writer.ownerId,
        movements: { create: movementRows(movements) },
      },
      include: WITH_MOVEMENTS,
    });
  }

  async update(writer: LibraryWriter, id: string, patch: UpdateWod) {
    const existing = await this.loadWritable(writer, id);
    const { movements, ...fields } = patch;

    // Only when it actually moves: a PATCH that restates the current name is
    // not a collision with itself.
    if (patch.name !== undefined && patch.name !== existing.name) {
      await this.assertNameFree(writer, patch.name);
    }
    assertIntervalCoherent({
      type: patch.type ?? existing.type,
      workSeconds:
        patch.workSeconds === undefined
          ? existing.workSeconds
          : patch.workSeconds,
      restSeconds:
        patch.restSeconds === undefined
          ? existing.restSeconds
          : patch.restSeconds,
      intervalCount:
        patch.intervalCount === undefined
          ? existing.intervalCount
          : patch.intervalCount,
    });
    if (movements) await this.assertReferenceable(writer, movements);

    return this.prisma.wod.update({
      where: { id },
      data: {
        ...fields,
        // Present, the list replaces the old one whole; absent, it is left
        // alone. Prisma runs the delete and the creates inside the update's
        // own transaction, so there is no moment at which the WOD exists with
        // half a list.
        ...(movements && {
          movements: { deleteMany: {}, create: movementRows(movements) },
        }),
      },
      include: WITH_MOVEMENTS,
    });
  }

  /**
   * Retires a workout without deleting it.
   *
   * Nothing is refused here, which is the difference from
   * `ExercisesService.archive`. A `DailyAssignment` pointing at this WOD is a
   * session an athlete already trained, and it keeps resolving through the
   * relation rather than through `libraryVisibleTo` — so their history still
   * renders. Archiving means "stop offering this", not "unsay it".
   */
  async archive(writer: LibraryWriter, id: string) {
    const existing = await this.loadWritable(writer, id);
    if (existing.archivedAt) return existing;

    return this.prisma.wod.update({
      where: { id },
      data: { archivedAt: new Date() },
      include: WITH_MOVEMENTS,
    });
  }

  /**
   * Brings a retired workout back.
   *
   * Its own endpoint rather than a PATCH field, for the reason `archivedAt`
   * is not in `updateWodSchema` at all: retiring a workout and editing one
   * are different acts, and the edit form should not be able to do it by
   * echoing back a field it happened to read.
   *
   * The movement list is re-checked on the way in, because an exercise it
   * names may have been archived while the WOD was away — un-archiving into
   * a movement the pool no longer offers is the gap this exists to stop.
   */
  async unarchive(writer: LibraryWriter, id: string) {
    const existing = await this.loadWritable(writer, id);
    if (!existing.archivedAt) return existing;

    await this.assertReferenceable(writer, existing.movements);

    return this.prisma.wod.update({
      where: { id },
      data: { archivedAt: null },
      include: WITH_MOVEMENTS,
    });
  }

  /**
   * The WOD this writer is allowed to change, or the reason they are not.
   *
   * Archived rows load here on purpose — `libraryVisibleTo` is for pools, and
   * un-archiving something you cannot load is impossible. The movements come
   * with it because `unarchive` has to judge them.
   *
   * This is also the whole of a `WodMovement`'s authorization: a movement
   * carries no `ownerId`, and the only way to write one is through the list
   * on its parent, so every movement write passes through this check.
   *
   * The 403 is deliberate and is not a leak: the caller can already read this
   * row through `GET /wods`, so 404 would conceal nothing and would instead
   * tell an athlete their own workout had vanished. It is also what an admin
   * gets for an athlete's own row — admin means "curates the shared library",
   * not "edits anyone's anything".
   */
  private async loadWritable(writer: LibraryWriter, id: string) {
    const row = await this.prisma.wod.findUnique({
      where: { id },
      include: { movements: { select: { exerciseId: true } } },
    });
    if (!row) throw new NotFoundException('Wod not found');

    if (row.ownerId !== writer.ownerId) {
      throw new ForbiddenException(
        writer.ownerId === null
          ? 'That WOD belongs to an athlete, not to the shared library'
          : 'Global library content is edited by an admin',
      );
    }
    return row;
  }

  /**
   * Refuses a name already taken in this writer's own tier.
   *
   * Archived rows count, because the unique index counts them: archiving does
   * not free a name. Said out loud rather than left to a raw constraint
   * violation, since "there is a retired workout called that" and "there is
   * one in use called that" have completely different fixes.
   *
   * `findFirst` rather than the compound unique key, which Prisma types with
   * a non-nullable `ownerId` — "the WOD named X with no owner" cannot be
   * expressed as a unique `where` at all (DN-93).
   *
   * A personal name may still shadow a global one; the tiers are separate
   * namespaces.
   */
  private async assertNameFree(writer: LibraryWriter, name: string) {
    const clash = await this.prisma.wod.findFirst({
      where: { ownerId: writer.ownerId, name },
      select: { archivedAt: true },
    });
    if (!clash) return;

    throw new ConflictException(
      clash.archivedAt
        ? `A retired WOD is already called "${name}" — un-archive it instead of creating a second one`
        : `A WOD is already called "${name}"`,
    );
  }

  /**
   * The one-way reference rule, at the first endpoint able to break it
   * (DN-93, carried into DN-26).
   *
   * A global WOD is the scheduler's candidate pool for every athlete. Let one
   * name a personal exercise and that athlete's archive breaks everyone's
   * scheduler — so `referenceableBy` shows an admin nothing but global,
   * unarchived content, and the rule holds by what the query can see rather
   * than by a comparison that has to be remembered.
   *
   * One query for the whole list rather than one per movement, and the misses
   * are counted rather than named: an id that resolves for someone else tells
   * a caller about rows they have no business reading.
   */
  private async assertReferenceable(
    writer: LibraryWriter,
    movements: { exerciseId: string }[],
  ) {
    const ids = [...new Set(movements.map((m) => m.exerciseId))];

    const found = await this.prisma.exercise.findMany({
      where: { ...referenceableBy(writer), id: { in: ids } },
      select: { id: true },
    });
    if (found.length === ids.length) return;

    const missing = ids.length - found.length;
    throw new BadRequestException(
      `${missing} of ${ids.length} movements name an exercise this write cannot point at — not in the library, retired, or another athlete's own`,
    );
  }

  /** Warm-up/cool-down checklists for a WOD's dominant pattern (Feature #63). */
  async getChecklists(userId: string, dominantPattern: string) {
    const pool = await this.prisma.exercise.findMany({
      where: { ...libraryVisibleTo(userId), phase: { not: null } },
      select: {
        id: true,
        name: true,
        pattern: true,
        phase: true,
        instructions: true,
      },
    });

    return {
      warmup: buildWarmupChecklist(pool, dominantPattern),
      cooldown: buildCooldownChecklist(pool, dominantPattern),
    };
  }
}
