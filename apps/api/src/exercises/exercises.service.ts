import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_EQUIPMENT,
  LIBRARY_PAGE_SIZE,
  equipment as equipmentEnum,
  type CreateExercise,
  type ExerciseSearchPage,
  type ExerciseSearchQuery,
  type UpdateExercise,
} from '@regimen-works/shared';
import type { Exercise, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  libraryOwnedBy,
  libraryVisibleTo,
  referenceableBy,
  type LibraryWriter,
} from '../library/visible-to';

/** The row as it will be once a PATCH is applied — what the rules judge. */
function merged(existing: Exercise, patch: UpdateExercise) {
  return {
    name: patch.name ?? existing.name,
    pattern: patch.pattern === undefined ? existing.pattern : patch.pattern,
    equipment: patch.equipment ?? existing.equipment,
    scalable: patch.scalable ?? existing.scalable,
    unit: patch.unit ?? existing.unit,
    instructions:
      patch.instructions === undefined
        ? existing.instructions
        : patch.instructions,
    movementGroup:
      patch.movementGroup === undefined
        ? existing.movementGroup
        : patch.movementGroup,
    sortOrder:
      patch.sortOrder === undefined ? existing.sortOrder : patch.sortOrder,
    fallbackExerciseId:
      patch.fallbackExerciseId === undefined
        ? existing.fallbackExerciseId
        : patch.fallbackExerciseId,
  };
}

@Injectable()
export class ExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The global library plus this athlete's own movements (DN-93).
   *
   * `includeArchived` is for the management screen and nothing else (DN-28).
   * Every other caller is a pool, and a pool offering a retired movement is
   * the bug the soft delete exists to prevent — so it defaults to false and
   * the page that wants retired rows has to say so.
   */
  findAll(userId: string, includeArchived = false) {
    return this.prisma.exercise.findMany({
      where: includeArchived
        ? libraryOwnedBy(userId)
        : libraryVisibleTo(userId),
      include: { fallbackExercise: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * One page of the library page's search (DN-171): the global library plus
   * this athlete's own movements, narrowed by every filter the query names.
   *
   * Filtered and paged here rather than in the browser, so the page never
   * holds the whole library: ~800 rows is what the search exists to spare it.
   * Ordered by name, then id, so a page boundary never falls between two rows
   * whose order is a coin toss.
   *
   * The filters go under `AND` beside `libraryVisibleTo` rather than being
   * spread over it: the muscle filter carries an `OR` of its own, and a
   * spread would replace the ownership one (the DN-93 failure).
   */
  async search(
    userId: string,
    query: ExerciseSearchQuery,
  ): Promise<
    ExerciseSearchPage<Exercise & { fallbackExercise: Exercise | null }>
  > {
    const filters: Prisma.ExerciseWhereInput[] = [libraryVisibleTo(userId)];
    if (query.q) {
      filters.push({ name: { contains: query.q, mode: 'insensitive' } });
    }
    if (query.muscle) {
      filters.push({
        OR: [
          { primaryMuscles: { has: query.muscle } },
          { secondaryMuscles: { has: query.muscle } },
        ],
      });
    }
    if (query.equipment) filters.push({ equipment: { has: query.equipment } });
    if (query.category) filters.push({ category: query.category });
    if (query.level) filters.push({ level: query.level });
    if (query.pattern) filters.push({ pattern: query.pattern });
    if (query.owned) {
      const rule = await this.prisma.scheduleRule.findUnique({
        where: { userId },
        select: { equipment: true },
      });
      // No rule is the baseline, not owning nothing -- the scheduler's reading.
      const owned = new Set<string>(rule?.equipment ?? DEFAULT_EQUIPMENT);
      filters.push({
        NOT: {
          equipment: {
            hasSome: equipmentEnum.options.filter((piece) => !owned.has(piece)),
          },
        },
      });
    }

    const where = { AND: filters };
    const [total, items] = await Promise.all([
      this.prisma.exercise.count({ where }),
      this.prisma.exercise.findMany({
        where,
        include: { fallbackExercise: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * LIBRARY_PAGE_SIZE,
        take: LIBRARY_PAGE_SIZE,
      }),
    ]);
    return { items, total, page: query.page, pageSize: LIBRARY_PAGE_SIZE };
  }

  /**
   * The retired movements the library page lists below the search (DN-171),
   * so one can be brought back. The search hides them like every pool does;
   * this is the management screen asking on purpose, as `findAll`'s
   * `includeArchived` did (DN-28).
   */
  retired(userId: string) {
    return this.prisma.exercise.findMany({
      where: { ...libraryOwnedBy(userId), archivedAt: { not: null } },
      include: { fallbackExercise: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * One movement, for the library's detail view (DN-171). A retired one
   * still loads -- a link to it should say it is retired, not that it never
   * existed -- but another athlete's never does, and reads as a 404 rather
   * than a 403: unlike `loadWritable`, the caller has no other way to learn
   * the row exists.
   */
  async findOne(userId: string, id: string) {
    const exercise = await this.prisma.exercise.findFirst({
      where: { ...libraryOwnedBy(userId), id },
      include: { fallbackExercise: true },
    });
    if (!exercise) throw new NotFoundException('No such movement');
    return exercise;
  }

  async create(writer: LibraryWriter, body: CreateExercise) {
    await this.assertNameFree(writer, body.name);
    await this.assertCoherent(writer, body, null);

    return this.prisma.exercise.create({
      data: { ...body, ownerId: writer.ownerId },
    });
  }

  async update(writer: LibraryWriter, id: string, patch: UpdateExercise) {
    const existing = await this.loadWritable(writer, id);
    const next = merged(existing, patch);

    // Only when it actually moves: a PATCH that restates the current name is
    // not a collision with itself.
    if (next.name !== existing.name) {
      await this.assertNameFree(writer, next.name);
    }
    await this.assertCoherent(writer, next, existing.id);

    return this.prisma.exercise.update({ where: { id }, data: patch });
  }

  /**
   * Retires a movement without deleting it. See `Exercise.archivedAt` for why
   * it is a soft delete; here the question is only who may, and what breaks.
   */
  async archive(writer: LibraryWriter, id: string) {
    const existing = await this.loadWritable(writer, id);
    if (existing.archivedAt) return existing;

    await this.assertNothingFallsBackTo(writer, existing);

    return this.prisma.exercise.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  /**
   * Brings a retired movement back.
   *
   * Its own endpoint rather than a PATCH field, for the reason `archivedAt` is
   * not in `updateExerciseSchema` at all: retiring a movement and editing one
   * are different acts, and the edit form should not be able to do it by
   * echoing back a field it happened to read.
   *
   * The row's own coherence is re-checked on the way back in — what it falls
   * back to may itself have been archived while this one was away, and
   * un-archiving into a broken fallback is the gap this all exists to stop.
   */
  async unarchive(writer: LibraryWriter, id: string) {
    const existing = await this.loadWritable(writer, id);
    if (!existing.archivedAt) return existing;

    await this.assertCoherent(writer, existing, existing.id);

    return this.prisma.exercise.update({
      where: { id },
      data: { archivedAt: null },
    });
  }

  /**
   * The row this writer is allowed to change, or the reason they are not.
   *
   * Archived rows are loaded here on purpose — `libraryVisibleTo` is for
   * pools, and un-archiving something you cannot load is impossible.
   *
   * The 403 is deliberate and is not a leak: the caller can already read this
   * row through `GET /exercises`, so 404 would conceal nothing and would
   * instead tell an athlete their own exercise had vanished. It is also what
   * an admin gets for an athlete's own row — admin means "curates the shared
   * library", not "edits anyone's anything".
   */
  private async loadWritable(writer: LibraryWriter, id: string) {
    const row = await this.prisma.exercise.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Exercise not found');

    if (row.ownerId !== writer.ownerId) {
      throw new ForbiddenException(
        writer.ownerId === null
          ? 'That exercise belongs to an athlete, not to the shared library'
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
   * violation, since "there is a retired movement called that" and "there is
   * one in use called that" have completely different fixes.
   *
   * A personal name may still shadow a global one — the tiers are separate
   * namespaces (DN-93).
   */
  private async assertNameFree(writer: LibraryWriter, name: string) {
    const clash = await this.prisma.exercise.findFirst({
      where: { ownerId: writer.ownerId, name },
      select: { archivedAt: true },
    });
    if (!clash) return;

    throw new ConflictException(
      clash.archivedAt
        ? `A retired exercise is already called "${name}" — un-archive it instead of creating a second one`
        : `An exercise is already called "${name}"`,
    );
  }

  /**
   * Every rule about a row's own shape, applied to the row as it will be.
   *
   * Run on create, on update against the merged result, and again on
   * un-archive, because all three are moments where a row that does not hold
   * together can enter the pool.
   */
  private async assertCoherent(
    writer: LibraryWriter,
    row: {
      equipment: string[];
      unit: string;
      movementGroup: string | null;
      sortOrder: number | null;
      fallbackExerciseId: string | null;
    },
    selfId: string | null,
  ) {
    // Half an answer is no answer: a `sortOrder` with no group orders the row
    // against nothing, and a group member with no `sortOrder` sorts last in
    // every list the athlete picks from.
    if ((row.movementGroup === null) !== (row.sortOrder === null)) {
      throw new BadRequestException(
        'movementGroup and sortOrder go together — an exercise in a movement group needs its place in the list',
      );
    }

    const fallback = await this.loadAlternative(
      writer,
      row.fallbackExerciseId,
      selfId,
    );

    // DN-83, at the second place library rows can now be written. Every
    // runtime layer passes a gap through rather than throwing, by design —
    // the athlete is about to train — so nothing downstream will ever report
    // this. The seed catches it for seeded rows; this catches it for the rest.
    if (row.equipment.length > 0) {
      if (!fallback) {
        throw new BadRequestException(
          `An exercise needing ${row.equipment.join(', ')} must name an alternative, or an athlete without it gets a movement they cannot do`,
        );
      }
      if (fallback.equipment.length > 0) {
        throw new BadRequestException(
          `The alternative "${fallback.name}" itself needs ${fallback.equipment.join(', ')} — the equipment fallback is one step, so this is where it has to stop`,
        );
      }
    }

    // DN-113. `applyEquipmentAvailability` swaps the exercise and leaves the
    // prescribed count alone, so a forty-second carry falling back to a
    // reps movement arrives as forty of them.
    if (fallback && fallback.unit !== row.unit) {
      throw new BadRequestException(
        `This is counted in ${row.unit} and falls back to "${fallback.name}", counted in ${fallback.unit} — the prescribed count carries over unchanged, so it would arrive meaning something else`,
      );
    }
  }

  /** The alternative, if one is named, and only if this writer may point at it. */
  private async loadAlternative(
    writer: LibraryWriter,
    fallbackExerciseId: string | null,
    selfId: string | null,
  ) {
    if (fallbackExerciseId === null) return null;

    // Caught before the lookup, which would otherwise find it and say yes. A
    // self-referential fallback is a movement whose way out is itself.
    if (fallbackExerciseId === selfId) {
      throw new BadRequestException(
        'An exercise cannot be its own alternative',
      );
    }

    const fallback = await this.prisma.exercise.findFirst({
      where: { ...referenceableBy(writer), id: fallbackExerciseId },
      select: { id: true, name: true, unit: true, equipment: true },
    });
    if (!fallback) {
      // One message for four different misses — not in the library, archived,
      // another athlete's, or (for an admin) an athlete's own. Naming which
      // would tell a caller about rows they cannot otherwise see.
      throw new BadRequestException(
        'That alternative is not an exercise this write can point at',
      );
    }
    return fallback;
  }

  /**
   * Refuses to archive a movement that is still something's way out.
   *
   * The failure this prevents is silent: `applyEquipmentAvailability` would
   * stop finding the substitute and hand the athlete the movement they own no
   * equipment for, with nothing anywhere reporting it.
   *
   * Referrers an admin cannot see are counted rather than named. A global
   * movement may be the fallback for athletes' own rows, and their library is
   * not an admin's to read.
   */
  private async assertNothingFallsBackTo(
    writer: LibraryWriter,
    row: { id: string; name: string },
  ) {
    const referrers = await this.prisma.exercise.findMany({
      where: { fallbackExerciseId: row.id, archivedAt: null },
      select: { name: true, ownerId: true },
    });
    if (referrers.length === 0) return;

    const visible = referrers.filter(
      (r) => r.ownerId === writer.ownerId || r.ownerId === null,
    );
    const hidden = referrers.length - visible.length;

    const named = visible.map((r) => `"${r.name}"`).join(', ');
    const rest = hidden > 0 ? `${hidden} in athletes' own libraries` : '';
    const who = [named, rest].filter(Boolean).join(', and ');

    throw new ConflictException(
      `"${row.name}" is the equipment fallback for ${who} — point those elsewhere first, or archiving it leaves them with no way down`,
    );
  }
}
