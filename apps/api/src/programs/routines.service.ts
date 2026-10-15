import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_PLAN_ID,
  ROUTINE_EXPORT_FORMAT,
  ROUTINE_EXPORT_VERSION,
  createRoutineSchema,
  defaultRoutineSummary,
  exportRoutinesSchema,
  routineExportEnvelopeSchema,
  type CreateRoutine,
  type EditableRoutine,
  type GlobalRoutineSummary,
  type RoutineArchiveResult,
  type RoutineDay,
  type RoutineExport,
  type RoutineSaveResult,
  type RoutineSummary,
} from '@regimen-works/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validateBody } from '../common/validate';
import {
  GLOBAL_LIBRARY,
  referenceableBy,
  type LibraryWriter,
} from '../library/visible-to';

/**
 * How long an authored routine may run (DN-145). Its length is the athlete's
 * choice at enrolment, not the author's, so every routine carries the same
 * wide bounds and setup asks for a number within them. Offering "no end" as
 * well is DN-154.
 */
export const ROUTINE_WEEKS = { min: 1, max: 52, default: 8 } as const;

const ROUTINE_ROW = {
  select: {
    id: true,
    name: true,
    summary: true,
    scheduleMode: true,
    archivedAt: true,
    weeks: { select: { slots: { select: { dayOfWeek: true } } } },
  },
} satisfies Prisma.ProgramDefaultArgs;

type RoutineRow = Prisma.ProgramGetPayload<typeof ROUTINE_ROW>;

/** Everything the editor wrote, as stored: the one week, its days, their lines. */
const ROUTINE_CONTENT = {
  include: {
    weeks: {
      orderBy: { order: 'asc' },
      include: {
        slots: {
          orderBy: { dayOfWeek: 'asc' },
          include: { movements: { orderBy: { order: 'asc' } } },
        },
      },
    },
  },
} satisfies Prisma.ProgramDefaultArgs;

type RoutineContent = Prisma.ProgramGetPayload<typeof ROUTINE_CONTENT>;

/** What "copy to my routines" offers: the live global library, Just WODs aside. */
const COPYABLE = {
  ...GLOBAL_LIBRARY,
  archivedAt: null,
  id: { not: DEFAULT_PLAN_ID },
} satisfies Prisma.ProgramWhereInput;

/** The client a write runs on: the service's own, or a transaction's. */
type Db = Pick<PrismaService, 'program' | 'exercise'>;

/**
 * Writing routines (ADR 0006). The first write path `Program` has had: until
 * now every program was seeded.
 */
@Injectable()
export class RoutinesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The one way a routine is created. The editor calls it today; admin
   * create, copy and the import command will call it too (ADR 0006), which is
   * why it takes the body unparsed and holds it to the editor's rules itself
   * -- ADR 0005 moved that strictness out of the columns, so a caller that
   * skipped the schema would store a half-written routine and nothing
   * downstream would notice.
   *
   * The tier is `writer`, which comes from the route and never the body.
   */
  async create(writer: LibraryWriter, body: unknown): Promise<RoutineSummary> {
    const routine = validateBody(createRoutineSchema, body);
    return this.insert(this.prisma, writer, routine);
  }

  /**
   * The routine as the editor loads it to change it (DN-146). Only the
   * writer's own tier: another athlete's routine is a 404 rather than a 403,
   * as in setup, because whether it exists is none of the caller's business.
   * Just WODs is a 404 from either route: it is not an authored routine.
   */
  async getForEditing(
    writer: LibraryWriter,
    id: string,
  ): Promise<EditableRoutine> {
    const program = await this.findOwned(writer, id);
    const routine = toCreateRoutine(program);
    return {
      id: program.id,
      routine,
      hasRuns: await this.hasRuns(this.prisma, program.id),
      archived: program.archivedAt !== null,
    };
  }

  /**
   * Saves an edit (ADR 0006, decision 6). The one edit path: the owner's
   * route calls it, and the admin route calls it with a global writer.
   *
   * - **Wording** (name, summary) changes in place, always.
   * - **Structure** (schedule mode, days, lines) changes in place until anyone
   *   has ever started the routine. After that a structural save **forks**:
   *   the edit becomes a new routine, made the way `create` makes one, and
   *   the old one is archived so runs on it finish the week they started.
   *
   * A save changing both is one fork carrying both, never an in-place
   * rename followed by a fork.
   */
  async update(
    writer: LibraryWriter,
    id: string,
    body: unknown,
  ): Promise<RoutineSaveResult> {
    if (id === DEFAULT_PLAN_ID) {
      throw new ForbiddenException(
        'Just WODs is built in. It cannot be edited.',
      );
    }
    const routine = validateBody(createRoutineSchema, body);
    const program = await this.findOwned(writer, id);
    if (program.archivedAt !== null) {
      // Editing a retired version would fork it into a second live copy of a
      // routine that already has one. Bringing it back first is DN-147's.
      throw new ConflictException(
        'This routine is archived. Restore it before editing it.',
      );
    }

    const structural = !sameStructure(toCreateRoutine(program), routine);

    return this.prisma.$transaction(async (tx) => {
      // Asked inside the transaction, so it is the same answer the write
      // acts on rather than one taken a request earlier.
      if (structural && (await this.hasRuns(tx, program.id))) {
        await tx.program.update({
          where: { id: program.id },
          data: { archivedAt: new Date() },
        });
        const forked = await this.insert(tx, writer, routine);
        return { routine: forked, forked: true };
      }

      await this.assertNameFree(tx, writer, routine.name, program.id);
      if (structural) {
        await this.assertExercisesReferenceable(tx, writer, routine);
        // Nobody has run it, so no assignment points at these slots and the
        // week can simply be written again.
        await tx.programWeek.deleteMany({ where: { programId: program.id } });
      }
      const fields = programFields(routine);
      if (!structural) {
        // The week stands, so its days keep their rows -- and the rows a
        // run's assignments point at. A day's name is wording (DN-155), so
        // it is written onto the slot where it is.
        for (const day of routine.days) {
          await tx.programSlot.updateMany({
            where: {
              programWeek: { programId: program.id },
              dayOfWeek: day.dayOfWeek,
            },
            data: { label: day.label ?? null },
          });
        }
      }
      const row = await this.withNameGuard(writer, routine.name, () =>
        tx.program.update({
          where: { id: program.id },
          data: structural
            ? { ...fields, weeks: weeksData(routine) }
            : { name: fields.name, summary: fields.summary },
          ...ROUTINE_ROW,
        }),
      );
      return { routine: toSummary(row), forked: false };
    });
  }

  /**
   * Takes a routine off the shelf (ADR 0006, decision 5): out of the setup
   * picker and the editor, kept for every run on it. There is no hard delete,
   * even for a routine nobody ran -- archiving is the only way out, and
   * `restore` the way back. Idempotent.
   *
   * `running` is whether the caller's own active run is on it, so the screen
   * can say that run carries on; nothing about the run changes. `runnerId`
   * is that caller: the owner on their own route, the admin on the global
   * one, where the writer has no user id of its own.
   */
  async archive(
    writer: LibraryWriter,
    id: string,
    runnerId: string | null = writer.ownerId,
  ): Promise<RoutineArchiveResult> {
    if (id === DEFAULT_PLAN_ID) {
      throw new ForbiddenException(
        'Just WODs is built in. It cannot be removed.',
      );
    }
    const program = await this.findOwnedRow(writer, id);
    const row =
      program.archivedAt !== null
        ? program
        : await this.prisma.program.update({
            where: { id: program.id },
            data: { archivedAt: new Date() },
            ...ROUTINE_ROW,
          });
    const running =
      runnerId !== null &&
      (await this.prisma.programEnrollment.count({
        where: { userId: runnerId, programId: program.id, status: 'active' },
      })) > 0;
    return { routine: toSummary(row), running };
  }

  /**
   * Puts an archived routine back. Archiving let its name go, so another
   * live routine may hold it by now; that is the editor's "name taken", and
   * the athlete renames one of them first. Idempotent.
   */
  async restore(writer: LibraryWriter, id: string): Promise<RoutineSummary> {
    const program = await this.findOwnedRow(writer, id);
    if (program.archivedAt === null) return toSummary(program);

    await this.assertNameFree(this.prisma, writer, program.name, program.id);
    const row = await this.withNameGuard(writer, program.name, () =>
      this.prisma.program.update({
        where: { id: program.id },
        data: { archivedAt: null },
        ...ROUTINE_ROW,
      }),
    );
    return toSummary(row);
  }

  /**
   * Publishes an admin's own routine to everyone (ADR 0006, decision 4): the
   * same row, its owner cleared. Every enrollment on it -- the admin's own
   * run included -- names the program, not the owner, so all of them carry on.
   *
   * One-way. There is no demote: once other athletes have started it, taking
   * it back would pull a routine out from under their runs.
   *
   * Refused while archived (restore it first), when a live global routine has
   * the name, and when it names a movement from the admin's own library -- a
   * global row pointing at a personal one is the reference the library never
   * allows (DN-93), since one athlete's archive would break everyone's run.
   */
  async promote(adminId: string, id: string): Promise<RoutineSummary> {
    const program = await this.findOwned({ ownerId: adminId }, id);
    if (program.archivedAt !== null) {
      throw new ConflictException(
        'This routine is archived. Restore it before publishing it.',
      );
    }
    const personal = await this.prisma.exercise.findMany({
      where: {
        id: {
          in: program.weeks.flatMap((w) =>
            w.slots.flatMap((s) =>
              s.movements.flatMap((m) => (m.exerciseId ? [m.exerciseId] : [])),
            ),
          ),
        },
        ownerId: { not: null },
      },
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    if (personal.length > 0) {
      throw new BadRequestException(
        `It names movements only you have: ${personal
          .map((e) => e.name)
          .join(', ')}. Swap them for library ones before publishing it.`,
      );
    }

    await this.assertNameFree(this.prisma, GLOBAL_LIBRARY, program.name);
    const row = await this.withNameGuard(GLOBAL_LIBRARY, program.name, () =>
      this.prisma.program.update({
        where: { id: program.id },
        data: { ownerId: null },
        ...ROUTINE_ROW,
      }),
    );
    return toSummary(row);
  }

  /**
   * The global routines an athlete may copy (DN-149, ADR 0006 decision 7):
   * live ones only, and not Just WODs, which has no week to copy.
   */
  async listCopyable(): Promise<RoutineSummary[]> {
    const rows = await this.prisma.program.findMany({
      where: COPYABLE,
      orderBy: { name: 'asc' },
      ...ROUTINE_ROW,
    });
    return rows.map(toSummary);
  }

  /**
   * A global routine as the body that would create it, for the editor to
   * prefill a copy from. The copy is saved through `create` like any other
   * routine, so it is the caller's, and nothing ties it back to this one.
   *
   * Global rows only: an athlete's own routine -- anyone's -- is a 404 here,
   * so this cannot be used to read another athlete's work.
   */
  async getForCopy(id: string): Promise<CreateRoutine> {
    const program = await this.prisma.program.findFirst({
      where: { AND: [COPYABLE, { id }] },
      ...ROUTINE_CONTENT,
    });
    if (!program) throw new NotFoundException('No such routine.');
    return toCreateRoutine(program);
  }

  /**
   * The ticked global routines as one file (DN-150, ADR 0006 decision 8),
   * each entry the body that would create it. Live or archived; never Just
   * WODs, which has no week to write down, and never a personal routine --
   * this is the only export there is, and it reads the global tier alone.
   *
   * Every id must be one of those, or nothing is exported: a file quietly
   * missing a routine is worse than no file.
   */
  async exportGlobal(body: unknown): Promise<RoutineExport> {
    const { ids } = validateBody(exportRoutinesSchema, body);
    const wanted = [...new Set(ids)];
    const programs = await this.prisma.program.findMany({
      where: {
        AND: [
          GLOBAL_LIBRARY,
          { id: { in: wanted } },
          { id: { not: DEFAULT_PLAN_ID } },
        ],
      },
      orderBy: { name: 'asc' },
      ...ROUTINE_CONTENT,
    });
    if (programs.length !== wanted.length) {
      throw new NotFoundException(
        'Only global routines can be exported, and not Just WODs.',
      );
    }
    return {
      format: ROUTINE_EXPORT_FORMAT,
      version: ROUTINE_EXPORT_VERSION,
      routines: programs.map(toCreateRoutine),
    };
  }

  /**
   * Loads an export into the global library, live (DN-150). Each entry goes
   * through what `create` does -- the editor's schema, then `insert` as a
   * global writer -- so a file can hold nothing the editor would refuse, and
   * a name already live in the library is a clash, never an overwrite.
   *
   * All or nothing: one transaction, so a failure leaves the library as it
   * was. Every message names the entry it is about.
   */
  async importGlobal(file: unknown): Promise<RoutineSummary[]> {
    const { routines: entries } = validateBody(
      routineExportEnvelopeSchema,
      file,
    );
    const routines: CreateRoutine[] = [];
    for (const [index, entry] of entries.entries()) {
      routines.push(
        await inEntry(index, entry, () =>
          validateBody(createRoutineSchema, entry),
        ),
      );
    }
    return this.prisma.$transaction(
      async (tx) => {
        const created: RoutineSummary[] = [];
        for (const [index, routine] of routines.entries()) {
          created.push(
            await inEntry(index, routine, () =>
              this.insert(tx, GLOBAL_LIBRARY, routine),
            ),
          );
        }
        return created;
      },
      // A library's worth of routines, each a handful of statements; the
      // default five seconds is sized for one request's work.
      { timeout: 60_000 },
    );
  }

  /**
   * The global library as an admin manages it, live and archived, Just WODs
   * first and marked built in so the screen offers it no actions.
   */
  async listGlobal(): Promise<GlobalRoutineSummary[]> {
    const rows = await this.prisma.program.findMany({
      where: GLOBAL_LIBRARY,
      orderBy: [
        { archivedAt: { sort: 'asc', nulls: 'first' } },
        { name: 'asc' },
      ],
      ...ROUTINE_ROW,
    });
    const summaries = rows.map((row) => ({
      ...toSummary(row),
      builtIn: row.id === DEFAULT_PLAN_ID,
    }));
    return [
      ...summaries.filter((r) => r.builtIn),
      ...summaries.filter((r) => !r.builtIn),
    ];
  }

  /** The create both `create` and a fork go through, on whichever client. */
  private async insert(
    db: Db,
    writer: LibraryWriter,
    routine: CreateRoutine,
  ): Promise<RoutineSummary> {
    await this.assertNameFree(db, writer, routine.name);
    await this.assertExercisesReferenceable(db, writer, routine);
    const row = await this.withNameGuard(writer, routine.name, () =>
      db.program.create({ data: programData(writer, routine), ...ROUTINE_ROW }),
    );
    return toSummary(row);
  }

  /**
   * The name checks are one statement and the write another; the live-name
   * partial index is what actually holds, and P2002 is it saying so.
   */
  private async withNameGuard<T>(
    writer: LibraryWriter,
    name: string,
    write: () => Promise<T>,
  ) {
    try {
      return await write();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw nameTaken(writer, name);
      }
      throw error;
    }
  }

  private async findOwned(
    writer: LibraryWriter,
    id: string,
  ): Promise<RoutineContent> {
    const program = await this.prisma.program.findFirst({
      where: { id, ownerId: writer.ownerId },
      ...ROUTINE_CONTENT,
    });
    if (!program || program.id === DEFAULT_PLAN_ID) {
      throw new NotFoundException('No such routine.');
    }
    return program;
  }

  /** `findOwned` without the week, for acts that only touch the row. */
  private async findOwnedRow(
    writer: LibraryWriter,
    id: string,
  ): Promise<RoutineRow> {
    const program = await this.prisma.program.findFirst({
      where: { id, ownerId: writer.ownerId },
      ...ROUTINE_ROW,
    });
    if (!program || program.id === DEFAULT_PLAN_ID) {
      throw new NotFoundException('No such routine.');
    }
    return program;
  }

  /** Anyone, ever, finished runs included (ADR 0006, decision 6). */
  private async hasRuns(
    db: Pick<PrismaService, 'programEnrollment'>,
    programId: string,
  ): Promise<boolean> {
    return (await db.programEnrollment.count({ where: { programId } })) > 0;
  }

  /**
   * The caller's own routines, live and archived -- the "My routines" list.
   * Global programs are not here: this is what you wrote, not what you can
   * run, and the setup picker is the list of the second.
   */
  async listOwn(userId: string): Promise<RoutineSummary[]> {
    const rows = await this.prisma.program.findMany({
      where: { ownerId: userId },
      orderBy: [
        { archivedAt: { sort: 'asc', nulls: 'first' } },
        { name: 'asc' },
      ],
      ...ROUTINE_ROW,
    });
    return rows.map(toSummary);
  }

  /**
   * Only a live routine holds its name; an archived one has let it go. A
   * routine being edited does not clash with itself.
   */
  private async assertNameFree(
    db: Db,
    writer: LibraryWriter,
    name: string,
    except?: string,
  ) {
    const clash = await db.program.findFirst({
      where: {
        ownerId: writer.ownerId,
        name,
        archivedAt: null,
        ...(except ? { id: { not: except } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw nameTaken(writer, name);
  }

  /**
   * Every named exercise must be one this writer could pick: their own or
   * global, and not archived. An id lifted from another athlete's library is
   * simply not found, the same as on a WOD.
   */
  private async assertExercisesReferenceable(
    db: Db,
    writer: LibraryWriter,
    routine: CreateRoutine,
  ) {
    const ids = [
      ...new Set(
        routine.days.flatMap((d) =>
          d.lines.flatMap((l) => (l.exerciseId ? [l.exerciseId] : [])),
        ),
      ),
    ];
    if (ids.length === 0) return;

    const found = await db.exercise.findMany({
      where: { ...referenceableBy(writer), id: { in: ids } },
      select: { id: true },
    });
    const known = new Set(found.map((e) => e.id));
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Not an exercise you can use: ${missing.join(', ')}`,
      );
    }
  }
}

/**
 * The authored shape onto the stored one: one `core` week, so
 * `expandProgramWeeks` repeats it for however long the athlete chose, and one
 * `movements` slot per day trained.
 *
 * A flexible routine is "any N days a week" with N exactly the days written
 * (DN-145): both bounds are N, so every session is kept and `priority` never
 * has to choose -- every slot is 0. Its written weekdays become the picker's
 * starting days.
 */
function programData(
  writer: LibraryWriter,
  routine: CreateRoutine,
): Prisma.ProgramCreateInput {
  return {
    ...programFields(routine),
    owner: writer.ownerId ? { connect: { id: writer.ownerId } } : undefined,
    weeks: weeksData(routine),
  };
}

/** The program's own columns: what the routine says, minus its week. */
function programFields(routine: CreateRoutine) {
  const weekdays = routine.days.map((d) => d.dayOfWeek);
  const flexible = routine.scheduleMode === 'flexible';
  return {
    name: routine.name,
    summary:
      routine.summary ?? defaultRoutineSummary(routine.scheduleMode, weekdays),
    scheduleMode: routine.scheduleMode,
    minDaysPerWeek: flexible ? weekdays.length : null,
    maxDaysPerWeek: flexible ? weekdays.length : null,
    defaultDays: flexible ? [...weekdays].sort((a, b) => a - b) : [],
    minWeeks: ROUTINE_WEEKS.min,
    maxWeeks: ROUTINE_WEEKS.max,
    defaultWeeks: ROUTINE_WEEKS.default,
  } satisfies Prisma.ProgramUpdateInput;
}

/** The one repeating week, its days and their lines, ready to create. */
function weeksData(routine: CreateRoutine) {
  return {
    create: [
      {
        order: 0,
        phase: 'core',
        slots: {
          create: routine.days.map((day) => ({
            dayOfWeek: day.dayOfWeek,
            label: day.label ?? null,
            kind: 'movements',
            priority: 0,
            movements: {
              create: day.lines.map((line, order) => ({
                order,
                movementGroup: line.movementGroup,
                exercise: line.exerciseId
                  ? { connect: { id: line.exerciseId } }
                  : undefined,
                sets: line.sets,
                reps: line.reps,
                repsMax: line.repsMax,
                toFailure: line.toFailure,
                restSeconds: line.restSeconds,
              })),
            },
          })),
        },
      },
    ],
  } satisfies Prisma.ProgramWeekCreateNestedManyWithoutProgramInput;
}

/**
 * The stored routine as the body that would write it again -- the inverse of
 * `programData`, for the editor to load and for telling a structural edit from
 * a wording one.
 */
function toCreateRoutine(program: RoutineContent): CreateRoutine {
  const scheduleMode = program.scheduleMode as CreateRoutine['scheduleMode'];
  const days: RoutineDay[] = program.weeks
    .flatMap((w) => w.slots)
    .map((slot) => ({
      dayOfWeek: slot.dayOfWeek,
      // Only where the day has a name, so an unnamed routine reads back --
      // and exports -- exactly as it did before days could be named.
      ...(slot.label ? { label: slot.label } : {}),
      lines: slot.movements.map((m) => ({
        movementGroup:
          m.movementGroup as RoutineDay['lines'][number]['movementGroup'],
        exerciseId: m.exerciseId,
        sets: m.sets,
        reps: m.reps,
        repsMax: m.repsMax,
        toFailure: m.toFailure,
        restSeconds: m.restSeconds,
      })),
    }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  const written = defaultRoutineSummary(
    scheduleMode,
    days.map((d) => d.dayOfWeek),
  );
  return {
    name: program.name,
    summary: program.summary === written ? null : program.summary,
    scheduleMode,
    days,
  };
}

/** Whether two bodies describe the same week, whatever they are called. */
function sameStructure(a: CreateRoutine, b: CreateRoutine): boolean {
  const shape = (r: CreateRoutine) =>
    JSON.stringify({
      scheduleMode: r.scheduleMode,
      days: [...r.days]
        .sort((x, y) => x.dayOfWeek - y.dayOfWeek)
        .map((d) => ({
          dayOfWeek: d.dayOfWeek,
          lines: d.lines.map((l) => [
            l.movementGroup,
            l.exerciseId,
            l.sets,
            l.reps,
            l.repsMax,
            l.toFailure,
            l.restSeconds,
          ]),
        })),
    });
  return shape(a) === shape(b);
}

function toSummary(row: RoutineRow): RoutineSummary {
  const days = row.weeks
    .flatMap((w) => w.slots.map((s) => s.dayOfWeek))
    .filter((d, i, all) => all.indexOf(d) === i)
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    scheduleMode: row.scheduleMode as RoutineSummary['scheduleMode'],
    days,
    archived: row.archivedAt !== null,
  };
}

/**
 * Runs one entry of an import, prefixing whatever it refuses with which
 * entry that was -- "Routine 2 (Push days): ..." -- and keeping the status.
 */
async function inEntry<T>(
  index: number,
  entry: unknown,
  run: () => T | Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    const name =
      typeof entry === 'object' &&
      entry !== null &&
      'name' in entry &&
      typeof entry.name === 'string'
        ? ` (${entry.name})`
        : '';
    const label = `Routine ${index + 1}${name}`;
    const response = error.getResponse();
    const message =
      typeof response === 'string'
        ? response
        : (response as { message?: string | string[] }).message;
    const status = error.getStatus();
    throw new HttpException(
      {
        statusCode: status,
        message: Array.isArray(message)
          ? message.map((m) => `${label}: ${m}`)
          : `${label}: ${message ?? error.message}`,
      },
      status,
    );
  }
}

function nameTaken(writer: LibraryWriter, name: string) {
  return new ConflictException(
    writer.ownerId === null
      ? `There is already a global routine called "${name}"`
      : `You already have a routine called "${name}"`,
  );
}
