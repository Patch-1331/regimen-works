import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_PROGRAM_ID,
  PROGRAM_EXPORT_FORMAT,
  PROGRAM_EXPORT_VERSION,
  createProgramSchema,
  defaultProgramSummary,
  exportProgramsSchema,
  programExportEnvelopeSchema,
  type CreateProgram,
  type EditableProgram,
  type GlobalProgramSummary,
  type ProgramArchiveResult,
  type ProgramDay,
  type ProgramExport,
  type ProgramSaveResult,
  type ProgramSummary,
} from '@regimen-works/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validateBody } from '../common/validate';
import { SLOT_MOVEMENTS } from './prescribed-slot';
import {
  GLOBAL_LIBRARY,
  referenceableBy,
  type LibraryWriter,
} from '../library/visible-to';

/**
 * How long an authored program may run (DN-145). Its length is the athlete's
 * choice at enrolment, not the author's, so every program carries the same
 * wide bounds and setup asks for a number within them. Offering "no end" as
 * well is DN-154.
 */
export const PROGRAM_WEEKS = { min: 1, max: 52, default: 8 } as const;

const PROGRAM_ROW = {
  select: {
    id: true,
    name: true,
    summary: true,
    scheduleMode: true,
    archivedAt: true,
    weeks: { select: { slots: { select: { dayOfWeek: true } } } },
  },
} satisfies Prisma.ProgramDefaultArgs;

type ProgramRow = Prisma.ProgramGetPayload<typeof PROGRAM_ROW>;

/** Everything the editor wrote, as stored: the one week, its days, their lines. */
const PROGRAM_CONTENT = {
  include: {
    weeks: {
      orderBy: { order: 'asc' },
      include: {
        slots: {
          orderBy: { dayOfWeek: 'asc' },
          include: { movements: SLOT_MOVEMENTS },
        },
      },
    },
  },
} satisfies Prisma.ProgramDefaultArgs;

type ProgramContent = Prisma.ProgramGetPayload<typeof PROGRAM_CONTENT>;

/** What "copy to your programs" offers: the live global library, Just WODs aside. */
const COPYABLE = {
  ...GLOBAL_LIBRARY,
  archivedAt: null,
  id: { not: DEFAULT_PROGRAM_ID },
} satisfies Prisma.ProgramWhereInput;

/** The client a write runs on: the service's own, or a transaction's. */
type Db = Pick<PrismaService, 'program' | 'exercise'>;

/**
 * Writing programs (ADR 0006). The first write path `Program` has had: until
 * now every program was seeded.
 */
@Injectable()
export class ProgramsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The one way a program is created. The editor calls it today; admin
   * create, copy and the import command will call it too (ADR 0006), which is
   * why it takes the body unparsed and holds it to the editor's rules itself
   * -- ADR 0005 moved that strictness out of the columns, so a caller that
   * skipped the schema would store a half-written program and nothing
   * downstream would notice.
   *
   * The tier is `writer`, which comes from the route and never the body.
   */
  async create(writer: LibraryWriter, body: unknown): Promise<ProgramSummary> {
    const program = validateProgram(body);
    return this.insert(this.prisma, writer, program);
  }

  /**
   * The program as the editor loads it to change it (DN-146). Only the
   * writer's own tier: another athlete's program is a 404 rather than a 403,
   * as in setup, because whether it exists is none of the caller's business.
   * Just WODs is a 404 from either route: it is not an authored program.
   */
  async getForEditing(
    writer: LibraryWriter,
    id: string,
  ): Promise<EditableProgram> {
    const stored = await this.findOwned(writer, id);
    const program = toCreateProgram(stored);
    return {
      id: stored.id,
      program,
      hasRuns: await this.hasRuns(this.prisma, stored.id),
      archived: stored.archivedAt !== null,
    };
  }

  /**
   * Saves an edit (ADR 0006, decision 6). The one edit path: the owner's
   * route calls it, and the admin route calls it with a global writer.
   *
   * - **Wording** (name, summary) changes in place, always.
   * - **Structure** (schedule mode, days, lines) changes in place until anyone
   *   has ever started the program. After that a structural save **forks**:
   *   the edit becomes a new program, made the way `create` makes one, and
   *   the old one is archived so runs on it finish the week they started.
   *
   * A save changing both is one fork carrying both, never an in-place
   * rename followed by a fork.
   */
  async update(
    writer: LibraryWriter,
    id: string,
    body: unknown,
  ): Promise<ProgramSaveResult> {
    if (id === DEFAULT_PROGRAM_ID) {
      throw new ForbiddenException(
        'Just WODs is built in. It cannot be edited.',
      );
    }
    const program = validateProgram(body);
    const stored = await this.findOwned(writer, id);
    if (stored.archivedAt !== null) {
      // Editing a retired version would fork it into a second live copy of a
      // program that already has one. Bringing it back first is DN-147's.
      throw new ConflictException(
        'This program is archived. Restore it before editing it.',
      );
    }

    const structural = !sameStructure(toCreateProgram(stored), program);

    return this.prisma.$transaction(async (tx) => {
      // Asked inside the transaction, so it is the same answer the write
      // acts on rather than one taken a request earlier.
      if (structural && (await this.hasRuns(tx, stored.id))) {
        await tx.program.update({
          where: { id: stored.id },
          data: { archivedAt: new Date() },
        });
        const forked = await this.insert(tx, writer, program);
        return { program: forked, forked: true };
      }

      await this.assertNameFree(tx, writer, program.name, stored.id);
      if (structural) {
        await this.assertExercisesReferenceable(tx, writer, program);
        // Nobody has run it, so no assignment points at these slots and the
        // week can simply be written again.
        await tx.programWeek.deleteMany({ where: { programId: stored.id } });
      }
      const fields = programFields(program);
      if (!structural) {
        // The week stands, so its days keep their rows -- and the rows a
        // run's assignments point at. A day's name is wording (DN-155), so
        // it is written onto the slot where it is.
        for (const day of program.days) {
          await tx.programSlot.updateMany({
            where: {
              programWeek: { programId: stored.id },
              dayOfWeek: day.dayOfWeek,
            },
            data: { label: day.label ?? null },
          });
        }
      }
      const row = await this.withNameGuard(writer, program.name, () =>
        tx.program.update({
          where: { id: stored.id },
          data: structural
            ? { ...fields, weeks: weeksData(program) }
            : { name: fields.name, summary: fields.summary },
          ...PROGRAM_ROW,
        }),
      );
      return { program: toSummary(row), forked: false };
    });
  }

  /**
   * Takes a program off the shelf (ADR 0006, decision 5): out of the setup
   * picker and the editor, kept for every run on it. There is no hard delete,
   * even for a program nobody ran -- archiving is the only way out, and
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
  ): Promise<ProgramArchiveResult> {
    if (id === DEFAULT_PROGRAM_ID) {
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
            ...PROGRAM_ROW,
          });
    const running =
      runnerId !== null &&
      (await this.prisma.programEnrollment.count({
        where: { userId: runnerId, programId: program.id, status: 'active' },
      })) > 0;
    return { program: toSummary(row), running };
  }

  /**
   * Puts an archived program back. Archiving let its name go, so another
   * live program may hold it by now; that is the editor's "name taken", and
   * the athlete renames one of them first. Idempotent.
   */
  async restore(writer: LibraryWriter, id: string): Promise<ProgramSummary> {
    const program = await this.findOwnedRow(writer, id);
    if (program.archivedAt === null) return toSummary(program);

    await this.assertNameFree(this.prisma, writer, program.name, program.id);
    const row = await this.withNameGuard(writer, program.name, () =>
      this.prisma.program.update({
        where: { id: program.id },
        data: { archivedAt: null },
        ...PROGRAM_ROW,
      }),
    );
    return toSummary(row);
  }

  /**
   * Publishes an admin's own program to everyone (ADR 0006, decision 4): the
   * same row, its owner cleared. Every enrollment on it -- the admin's own
   * run included -- names the program, not the owner, so all of them carry on.
   *
   * One-way. There is no demote: once other athletes have started it, taking
   * it back would pull a program out from under their runs.
   *
   * Refused while archived (restore it first), when a live global program has
   * the name, and when it names a movement from the admin's own library -- a
   * global row pointing at a personal one is the reference the library never
   * allows (DN-93), since one athlete's archive would break everyone's run.
   */
  async promote(adminId: string, id: string): Promise<ProgramSummary> {
    const program = await this.findOwned({ ownerId: adminId }, id);
    if (program.archivedAt !== null) {
      throw new ConflictException(
        'This program is archived. Restore it before publishing it.',
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
        ...PROGRAM_ROW,
      }),
    );
    return toSummary(row);
  }

  /**
   * The global programs an athlete may copy (DN-149, ADR 0006 decision 7):
   * live ones only, and not Just WODs, which has no week to copy.
   */
  async listCopyable(): Promise<ProgramSummary[]> {
    const rows = await this.prisma.program.findMany({
      where: COPYABLE,
      orderBy: { name: 'asc' },
      ...PROGRAM_ROW,
    });
    return rows.map(toSummary);
  }

  /**
   * A global program as the body that would create it, for the editor to
   * prefill a copy from. The copy is saved through `create` like any other
   * program, so it is the caller's, and nothing ties it back to this one.
   *
   * Global rows only: an athlete's own program -- anyone's -- is a 404 here,
   * so this cannot be used to read another athlete's work.
   */
  async getForCopy(id: string): Promise<CreateProgram> {
    const program = await this.prisma.program.findFirst({
      where: { AND: [COPYABLE, { id }] },
      ...PROGRAM_CONTENT,
    });
    if (!program) throw new NotFoundException('No such program.');
    return toCreateProgram(program);
  }

  /**
   * The ticked global programs as one file (DN-150, ADR 0006 decision 8),
   * each entry the body that would create it. Live or archived; never Just
   * WODs, which has no week to write down, and never a personal program --
   * this is the only export there is, and it reads the global tier alone.
   *
   * Every id must be one of those, or nothing is exported: a file quietly
   * missing a program is worse than no file.
   */
  async exportGlobal(body: unknown): Promise<ProgramExport> {
    const { ids } = validateBody(exportProgramsSchema, body);
    const wanted = [...new Set(ids)];
    const programs = await this.prisma.program.findMany({
      where: {
        AND: [
          GLOBAL_LIBRARY,
          { id: { in: wanted } },
          { id: { not: DEFAULT_PROGRAM_ID } },
        ],
      },
      orderBy: { name: 'asc' },
      ...PROGRAM_CONTENT,
    });
    if (programs.length !== wanted.length) {
      throw new NotFoundException(
        'Only global programs can be exported, and not Just WODs.',
      );
    }
    return {
      format: PROGRAM_EXPORT_FORMAT,
      version: PROGRAM_EXPORT_VERSION,
      programs: programs.map(toCreateProgram),
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
  async importGlobal(file: unknown): Promise<ProgramSummary[]> {
    const { programs: entries } = validateBody(
      programExportEnvelopeSchema,
      file,
    );
    const programs: CreateProgram[] = [];
    for (const [index, entry] of entries.entries()) {
      programs.push(await inEntry(index, entry, () => validateProgram(entry)));
    }
    return this.prisma.$transaction(
      async (tx) => {
        const created: ProgramSummary[] = [];
        for (const [index, program] of programs.entries()) {
          created.push(
            await inEntry(index, program, () =>
              this.insert(tx, GLOBAL_LIBRARY, program),
            ),
          );
        }
        return created;
      },
      // A library's worth of programs, each a handful of statements; the
      // default five seconds is sized for one request's work.
      { timeout: 60_000 },
    );
  }

  /**
   * The global library as an admin manages it, live and archived, Just WODs
   * first and marked built in so the screen offers it no actions.
   */
  async listGlobal(): Promise<GlobalProgramSummary[]> {
    const rows = await this.prisma.program.findMany({
      where: GLOBAL_LIBRARY,
      orderBy: [
        { archivedAt: { sort: 'asc', nulls: 'first' } },
        { name: 'asc' },
      ],
      ...PROGRAM_ROW,
    });
    const summaries = rows.map((row) => ({
      ...toSummary(row),
      builtIn: row.id === DEFAULT_PROGRAM_ID,
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
    program: CreateProgram,
  ): Promise<ProgramSummary> {
    await this.assertNameFree(db, writer, program.name);
    await this.assertExercisesReferenceable(db, writer, program);
    const row = await this.withNameGuard(writer, program.name, () =>
      db.program.create({ data: programData(writer, program), ...PROGRAM_ROW }),
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
  ): Promise<ProgramContent> {
    const program = await this.prisma.program.findFirst({
      where: { id, ownerId: writer.ownerId },
      ...PROGRAM_CONTENT,
    });
    if (!program || program.id === DEFAULT_PROGRAM_ID) {
      throw new NotFoundException('No such program.');
    }
    return program;
  }

  /** `findOwned` without the week, for acts that only touch the row. */
  private async findOwnedRow(
    writer: LibraryWriter,
    id: string,
  ): Promise<ProgramRow> {
    const program = await this.prisma.program.findFirst({
      where: { id, ownerId: writer.ownerId },
      ...PROGRAM_ROW,
    });
    if (!program || program.id === DEFAULT_PROGRAM_ID) {
      throw new NotFoundException('No such program.');
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
   * The caller's own programs, live and archived -- the "Your programs" list.
   * Global programs are not here: this is what you wrote, not what you can
   * run, and the setup picker is the list of the second.
   */
  async listOwn(userId: string): Promise<ProgramSummary[]> {
    const rows = await this.prisma.program.findMany({
      where: { ownerId: userId },
      orderBy: [
        { archivedAt: { sort: 'asc', nulls: 'first' } },
        { name: 'asc' },
      ],
      ...PROGRAM_ROW,
    });
    return rows.map(toSummary);
  }

  /**
   * Only a live program holds its name; an archived one has let it go. A
   * program being edited does not clash with itself.
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
    program: CreateProgram,
  ) {
    const ids = [
      ...new Set(
        program.days.flatMap((d) =>
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
 * A flexible program is "any N days a week" with N exactly the days written
 * (DN-145): both bounds are N, so every session is kept and `priority` never
 * has to choose -- every slot is 0. Its written weekdays become the picker's
 * starting days.
 */
function programData(
  writer: LibraryWriter,
  program: CreateProgram,
): Prisma.ProgramCreateInput {
  return {
    ...programFields(program),
    owner: writer.ownerId ? { connect: { id: writer.ownerId } } : undefined,
    weeks: weeksData(program),
  };
}

/** The program's own columns: what the program says, minus its week. */
function programFields(program: CreateProgram) {
  const weekdays = program.days.map((d) => d.dayOfWeek);
  const flexible = program.scheduleMode === 'flexible';
  return {
    name: program.name,
    summary:
      program.summary ?? defaultProgramSummary(program.scheduleMode, weekdays),
    scheduleMode: program.scheduleMode,
    minDaysPerWeek: flexible ? weekdays.length : null,
    maxDaysPerWeek: flexible ? weekdays.length : null,
    defaultDays: flexible ? [...weekdays].sort((a, b) => a - b) : [],
    minWeeks: PROGRAM_WEEKS.min,
    maxWeeks: PROGRAM_WEEKS.max,
    defaultWeeks: PROGRAM_WEEKS.default,
    // One repeating week has nothing to finish, so "no end" is a length too
    // (DN-154). Here rather than on create alone, so a copy and an import --
    // both saved through `create` -- carry it the same way.
    allowsNoEnd: true,
  } satisfies Prisma.ProgramUpdateInput;
}

/** The one repeating week, its days and their lines, ready to create. */
function weeksData(program: CreateProgram) {
  return {
    create: [
      {
        order: 0,
        phase: 'core',
        slots: {
          create: program.days.map((day) => ({
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
                sets: {
                  create: line.sets.map((set, order) => ({ order, ...set })),
                },
              })),
            },
          })),
        },
      },
    ],
  } satisfies Prisma.ProgramWeekCreateNestedManyWithoutProgramInput;
}

/**
 * The stored program as the body that would write it again -- the inverse of
 * `programData`, for the editor to load and for telling a structural edit from
 * a wording one.
 */
function toCreateProgram(program: ProgramContent): CreateProgram {
  const scheduleMode = program.scheduleMode as CreateProgram['scheduleMode'];
  const days: ProgramDay[] = program.weeks
    .flatMap((w) => w.slots)
    .map((slot) => ({
      dayOfWeek: slot.dayOfWeek,
      // Only where the day has a name, so an unnamed program reads back --
      // and exports -- exactly as it did before days could be named.
      ...(slot.label ? { label: slot.label } : {}),
      lines: slot.movements.map((m) => ({
        movementGroup:
          m.movementGroup as ProgramDay['lines'][number]['movementGroup'],
        exerciseId: m.exerciseId,
        sets: m.sets.map((s) => ({
          reps: s.reps,
          repsMax: s.repsMax,
          toFailure: s.toFailure,
          restSeconds: s.restSeconds,
          loadStepPercent: s.loadStepPercent,
        })),
      })),
    }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  const written = defaultProgramSummary(
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

/**
 * The body as a program, on every write path. A line's sets may differ from
 * one another (ADR 0011): each is stored as written, load step and all.
 */
function validateProgram(body: unknown): CreateProgram {
  return validateBody(createProgramSchema, body);
}

/** Whether two bodies describe the same week, whatever they are called. */
function sameStructure(a: CreateProgram, b: CreateProgram): boolean {
  const shape = (r: CreateProgram) =>
    JSON.stringify({
      scheduleMode: r.scheduleMode,
      days: [...r.days]
        .sort((x, y) => x.dayOfWeek - y.dayOfWeek)
        .map((d) => ({
          dayOfWeek: d.dayOfWeek,
          lines: d.lines.map((l) => [
            l.movementGroup,
            l.exerciseId,
            l.sets.map((s) => [
              s.reps,
              s.repsMax,
              s.toFailure,
              s.restSeconds,
              s.loadStepPercent,
            ]),
          ]),
        })),
    });
  return shape(a) === shape(b);
}

function toSummary(row: ProgramRow): ProgramSummary {
  const days = row.weeks
    .flatMap((w) => w.slots.map((s) => s.dayOfWeek))
    .filter((d, i, all) => all.indexOf(d) === i)
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    scheduleMode: row.scheduleMode as ProgramSummary['scheduleMode'],
    days,
    archived: row.archivedAt !== null,
  };
}

/**
 * Runs one entry of an import, prefixing whatever it refuses with which
 * entry that was -- "Program 2 (Push days): ..." -- and keeping the status.
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
    const label = `Program ${index + 1}${name}`;
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
      ? `There is already a global program called "${name}"`
      : `You already have a program called "${name}"`,
  );
}
