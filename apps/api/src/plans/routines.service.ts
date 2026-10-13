import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_PLAN_ID,
  createRoutineSchema,
  defaultRoutineSummary,
  type CreateRoutine,
  type EditableRoutine,
  type RoutineArchiveResult,
  type RoutineDay,
  type RoutineSaveResult,
  type RoutineSummary,
} from '@regimen-works/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validateBody } from '../common/validate';
import { referenceableBy, type LibraryWriter } from '../library/visible-to';

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
} satisfies Prisma.PlanDefaultArgs;

type RoutineRow = Prisma.PlanGetPayload<typeof ROUTINE_ROW>;

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
} satisfies Prisma.PlanDefaultArgs;

type RoutineContent = Prisma.PlanGetPayload<typeof ROUTINE_CONTENT>;

/** The client a write runs on: the service's own, or a transaction's. */
type Db = Pick<PrismaService, 'plan' | 'exercise'>;

/**
 * Writing routines (ADR 0006). The first write path `Plan` has had: until
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
   * Just WODs is global and never reaches here from the owner's route.
   */
  async getForEditing(
    writer: LibraryWriter,
    id: string,
  ): Promise<EditableRoutine> {
    const plan = await this.findOwned(writer, id);
    const routine = toCreateRoutine(plan);
    return {
      id: plan.id,
      routine,
      hasRuns: await this.hasRuns(this.prisma, plan.id),
      archived: plan.archivedAt !== null,
    };
  }

  /**
   * Saves an edit (ADR 0006, decision 6). The one edit path: the owner's
   * route calls it today, and the admin route for global routines will call
   * it with a global writer.
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
    const plan = await this.findOwned(writer, id);
    if (plan.archivedAt !== null) {
      // Editing a retired version would fork it into a second live copy of a
      // routine that already has one. Bringing it back first is DN-147's.
      throw new ConflictException(
        'This routine is archived. Restore it before editing it.',
      );
    }

    const structural = !sameStructure(toCreateRoutine(plan), routine);

    return this.prisma.$transaction(async (tx) => {
      // Asked inside the transaction, so it is the same answer the write
      // acts on rather than one taken a request earlier.
      if (structural && (await this.hasRuns(tx, plan.id))) {
        await tx.plan.update({
          where: { id: plan.id },
          data: { archivedAt: new Date() },
        });
        const forked = await this.insert(tx, writer, routine);
        return { routine: forked, forked: true };
      }

      await this.assertNameFree(tx, writer, routine.name, plan.id);
      if (structural) {
        await this.assertExercisesReferenceable(tx, writer, routine);
        // Nobody has run it, so no assignment points at these slots and the
        // week can simply be written again.
        await tx.planWeek.deleteMany({ where: { planId: plan.id } });
      }
      const fields = planFields(routine);
      const row = await this.withNameGuard(routine.name, () =>
        tx.plan.update({
          where: { id: plan.id },
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
   * can say that run carries on; nothing about the run changes.
   */
  async archive(
    writer: LibraryWriter,
    id: string,
  ): Promise<RoutineArchiveResult> {
    if (id === DEFAULT_PLAN_ID) {
      throw new ForbiddenException(
        'Just WODs is built in. It cannot be removed.',
      );
    }
    const plan = await this.findOwnedRow(writer, id);
    const row =
      plan.archivedAt !== null
        ? plan
        : await this.prisma.plan.update({
            where: { id: plan.id },
            data: { archivedAt: new Date() },
            ...ROUTINE_ROW,
          });
    const running =
      writer.ownerId !== null &&
      (await this.prisma.planEnrollment.count({
        where: { userId: writer.ownerId, planId: plan.id, status: 'active' },
      })) > 0;
    return { routine: toSummary(row), running };
  }

  /**
   * Puts an archived routine back. Archiving let its name go, so another
   * live routine may hold it by now; that is the editor's "name taken", and
   * the athlete renames one of them first. Idempotent.
   */
  async restore(writer: LibraryWriter, id: string): Promise<RoutineSummary> {
    const plan = await this.findOwnedRow(writer, id);
    if (plan.archivedAt === null) return toSummary(plan);

    await this.assertNameFree(this.prisma, writer, plan.name, plan.id);
    const row = await this.withNameGuard(plan.name, () =>
      this.prisma.plan.update({
        where: { id: plan.id },
        data: { archivedAt: null },
        ...ROUTINE_ROW,
      }),
    );
    return toSummary(row);
  }

  /** The create both `create` and a fork go through, on whichever client. */
  private async insert(
    db: Db,
    writer: LibraryWriter,
    routine: CreateRoutine,
  ): Promise<RoutineSummary> {
    await this.assertNameFree(db, writer, routine.name);
    await this.assertExercisesReferenceable(db, writer, routine);
    const row = await this.withNameGuard(routine.name, () =>
      db.plan.create({ data: planData(writer, routine), ...ROUTINE_ROW }),
    );
    return toSummary(row);
  }

  /**
   * The name checks are one statement and the write another; the live-name
   * partial index is what actually holds, and P2002 is it saying so.
   */
  private async withNameGuard<T>(name: string, write: () => Promise<T>) {
    try {
      return await write();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw nameTaken(name);
      }
      throw error;
    }
  }

  private async findOwned(
    writer: LibraryWriter,
    id: string,
  ): Promise<RoutineContent> {
    const plan = await this.prisma.plan.findFirst({
      where: { id, ownerId: writer.ownerId },
      ...ROUTINE_CONTENT,
    });
    if (!plan || plan.id === DEFAULT_PLAN_ID) {
      throw new NotFoundException('No such routine.');
    }
    return plan;
  }

  /** `findOwned` without the week, for acts that only touch the row. */
  private async findOwnedRow(
    writer: LibraryWriter,
    id: string,
  ): Promise<RoutineRow> {
    const plan = await this.prisma.plan.findFirst({
      where: { id, ownerId: writer.ownerId },
      ...ROUTINE_ROW,
    });
    if (!plan || plan.id === DEFAULT_PLAN_ID) {
      throw new NotFoundException('No such routine.');
    }
    return plan;
  }

  /** Anyone, ever, finished runs included (ADR 0006, decision 6). */
  private async hasRuns(
    db: Pick<PrismaService, 'planEnrollment'>,
    planId: string,
  ): Promise<boolean> {
    return (await db.planEnrollment.count({ where: { planId } })) > 0;
  }

  /**
   * The caller's own routines, live and archived -- the "My routines" list.
   * Global programs are not here: this is what you wrote, not what you can
   * run, and the setup picker is the list of the second.
   */
  async listOwn(userId: string): Promise<RoutineSummary[]> {
    const rows = await this.prisma.plan.findMany({
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
    const clash = await db.plan.findFirst({
      where: {
        ownerId: writer.ownerId,
        name,
        archivedAt: null,
        ...(except ? { id: { not: except } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw nameTaken(name);
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
 * `expandPlanWeeks` repeats it for however long the athlete chose, and one
 * `movements` slot per day trained.
 *
 * A flexible routine is "any N days a week" with N exactly the days written
 * (DN-145): both bounds are N, so every session is kept and `priority` never
 * has to choose -- every slot is 0. Its written weekdays become the picker's
 * starting days.
 */
function planData(
  writer: LibraryWriter,
  routine: CreateRoutine,
): Prisma.PlanCreateInput {
  return {
    ...planFields(routine),
    owner: writer.ownerId ? { connect: { id: writer.ownerId } } : undefined,
    weeks: weeksData(routine),
  };
}

/** The plan's own columns: what the routine says, minus its week. */
function planFields(routine: CreateRoutine) {
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
  } satisfies Prisma.PlanUpdateInput;
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
  } satisfies Prisma.PlanWeekCreateNestedManyWithoutPlanInput;
}

/**
 * The stored routine as the body that would write it again -- the inverse of
 * `planData`, for the editor to load and for telling a structural edit from
 * a wording one.
 */
function toCreateRoutine(plan: RoutineContent): CreateRoutine {
  const scheduleMode = plan.scheduleMode as CreateRoutine['scheduleMode'];
  const days: RoutineDay[] = plan.weeks
    .flatMap((w) => w.slots)
    .map((slot) => ({
      dayOfWeek: slot.dayOfWeek,
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
    name: plan.name,
    summary: plan.summary === written ? null : plan.summary,
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

function nameTaken(name: string) {
  return new ConflictException(`You already have a routine called "${name}"`);
}
