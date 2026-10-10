import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  createRoutineSchema,
  defaultRoutineSummary,
  type CreateRoutine,
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
    await this.assertNameFree(writer, routine.name);
    await this.assertExercisesReferenceable(writer, routine);

    try {
      const row = await this.prisma.plan.create({
        data: planData(writer, routine),
        ...ROUTINE_ROW,
      });
      return toSummary(row);
    } catch (error) {
      // The check above and the insert are two statements; the live-name
      // partial index is what actually holds, and this is it saying so.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw nameTaken(routine.name);
      }
      throw error;
    }
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

  /** Only a live routine holds its name; an archived one has let it go. */
  private async assertNameFree(writer: LibraryWriter, name: string) {
    const clash = await this.prisma.plan.findFirst({
      where: { ownerId: writer.ownerId, name, archivedAt: null },
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

    const found = await this.prisma.exercise.findMany({
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
    owner: writer.ownerId ? { connect: { id: writer.ownerId } } : undefined,
    weeks: {
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
    },
  };
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
