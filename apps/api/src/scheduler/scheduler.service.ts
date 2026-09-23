import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Exercise } from '@prisma/client';
import {
  DEFAULT_EQUIPMENT,
  DEFAULT_PATTERN_COOLDOWN_DAYS,
  DEFAULT_TRAINING_DAYS,
} from '@regimen-works/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RNG, type Rng } from './rng';
import { libraryVisibleTo } from '../library/visible-to';
import { toSessionDto } from '../sessions/session.mapper';
import { WodsService } from '../wods/wods.service';
import {
  hideOverriddenPrescriptions,
  MovementResolutionService,
  resolvableMovementInclude,
  type ResolvedMovement,
} from './movement-resolution.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { loadActiveProgram } from '../plans/active-program';
import { resolveScheduleLock } from '../plans/schedule-lock';
import { alsoTraining, resolveMakeup } from './makeup';
import {
  narrowToSlot,
  resolveProgramDay,
  type ActiveProgram,
  type ConstrainableWod,
  type ProgramDay,
} from '../plans/program-day';
import {
  applyEquipmentFloor,
  applyRememberedChoice,
  dominantMovement,
  getWeekRange,
  isRestDay,
  pickWod,
  RecentAssignment,
} from './scheduler.logic';

const wodInclude = resolvableMovementInclude;

/** A program day that has been acted on: a finished run is already retired. */
type SettledDay = Exclude<ProgramDay, { kind: 'completed' }>;

/** A day whose WOD the program constrained rather than pinned. */
type GeneratedDay = Extract<ProgramDay, { kind: 'generated' }>;

@Injectable()
export class SchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wodsService: WodsService,
    private readonly resolution: MovementResolutionService,
    // The completion card rides on today's response (DN-18), and retiring a
    // finished run is what puts it there.
    private readonly enrollments: EnrollmentsService,
    // Defaulted so the db specs that build this service by hand still get
    // production's randomness unless they deliberately pin it (DN-119).
    @Inject(RNG) private readonly rng: Rng = Math.random,
  ) {}

  private readonly logger = new Logger(SchedulerService.name);

  /**
   * Narrows to the slot, and says so out loud when the slot did not get what
   * it asked for (DN-14).
   *
   * The athlete is told nothing: they asked for today's workout and they have
   * one, and "this is not quite the session your program wanted" is an
   * apology for a decision they cannot act on. The person who *can* act on it
   * is whoever tends the library, and the only channel this app has to them
   * is the log -- Render captures stdout, so a warn here is greppable without
   * any further infrastructure.
   *
   * Warn rather than log: the relaxation ladder firing is not normal. It means the
   * library cannot satisfy a slot somebody authored, which is a content bug
   * with a fix (seed the missing WODs -- DN-23) rather than a fact of life.
   * The line names the plan, the week and the axes given up, because the
   * question it has to answer is "which slot, and what is missing".
   */
  private narrowed<C extends ConstrainableWod>(
    candidates: C[],
    slot: GeneratedDay,
  ): C[] {
    const { candidates: pool, relaxed } = narrowToSlot(
      candidates,
      slot.constraints,
    );
    if (relaxed.length > 0) {
      this.logger.warn(
        `Slot relaxed for "${slot.day.planName}" week ${slot.day.week} ` +
          `(plan ${slot.day.planId}): nothing in the library satisfies ` +
          `${relaxed.join(', ')}, so ${relaxed.length === 1 ? 'it was' : 'they were'} ` +
          `given up to find ${pool.length} candidate${pool.length === 1 ? '' : 's'}.`,
      );
    }
    return pool;
  }

  /**
   * Returns today's assignment, generating one if the day hasn't been decided
   * yet.
   *
   * Since DN-16 the day is resolved through the athlete's active enrollment
   * rather than going straight to `pickWod`. There is still **one** path:
   * every athlete has an enrollment (DN-13), and the cases where a program is
   * not deciding today -- none, not started, just finished -- collapse into
   * the same fallback the app had before programs existed, instead of an
   * `if (enrolled) ... else ...` spreading through the scheduler.
   */
  async getToday(userId: string, today: string) {
    const [rule, existing, program, completed] = await Promise.all([
      this.prisma.scheduleRule.findUnique({ where: { userId } }),
      this.prisma.dailyAssignment.findUnique({
        where: { userId_date: { userId, date: today } },
        include: { wod: { include: wodInclude }, session: true },
      }),
      loadActiveProgram(this.prisma, userId),
      this.completedWeekdays(userId, today),
    ]);

    const warmupCooldownEnabled = rule?.warmupCooldownEnabled ?? false;
    const trainingDays = rule?.trainingDays ?? [...DEFAULT_TRAINING_DAYS];
    const day = await this.settleProgramDay(
      resolveProgramDay(program, trainingDays, today, completed),
      userId,
    );
    const plan = planBlock(day);

    if (existing) {
      // A WOD-less row is either today's prescription (DN-19) or the older
      // case the column was nullable for: a rest day recorded before anything
      // was generated. The program day tells them apart, and it is asked
      // rather than the row, for the same reason `plan` is recomputed -- the
      // row records what happened, this answers what today is.
      const prescription = existing.wod
        ? null
        : await this.prescriptionFor(userId, existing.id, day);
      const assignment =
        existing.status === 'skipped' || (!existing.wod && !prescription)
          ? null
          : {
              id: existing.id,
              date: existing.date,
              status: existing.status,
              wod: existing.wod
                ? await this.resolveWodForToday(
                    userId,
                    existing.id,
                    existing.wod,
                  )
                : null,
              prescription,
              session: existing.session ? toSessionDto(existing.session) : null,
            };

      return {
        date: today,
        // Recomputed rather than read back off the row's plan columns. Those
        // record what produced the day and are history; this answers "where am
        // I today", which is a question about the enrollment as it stands now.
        plan,
        completedProgram: await this.enrollments.cardFor(userId),
        isRestDay: existing.status === 'skipped',
        assignment,
        // A day marked as rest can still be trained: the athlete changed
        // their mind, and the week is the unit of completion (DN-17).
        makeup: this.makeupFor(
          existing.status === 'skipped',
          program,
          today,
          trainingDays,
          completed,
        ),
        warmupCooldownEnabled,
        ...(await this.getChecklistsFor(
          userId,
          warmupCooldownEnabled,
          assignment?.wod?.dominantPattern,
        )),
      };
    }

    // The week-so-far count is back (DN-17), in `makeupFor` and with the
    // different meaning DN-16 predicted: the quota version decided whether
    // the athlete was *allowed* to train, this one only decides whether to
    // offer a day they already have.
    const cooldownDays =
      rule?.patternCooldownDays ?? DEFAULT_PATTERN_COOLDOWN_DAYS;

    // `isRestDay` is still the whole rule when no program is deciding, which
    // is what keeps an athlete who has never touched a program on exactly the
    // behaviour they had before. Under a program the calendar question has
    // already been asked -- a flexible plan defers to these same training
    // days, a fixed one overrides them on purpose.
    const resting =
      day.kind === 'fallback'
        ? isRestDay(today, trainingDays)
        : day.kind === 'rest';

    if (resting) {
      return {
        date: today,
        plan,
        completedProgram: await this.enrollments.cardFor(userId),
        isRestDay: true,
        assignment: null,
        makeup: this.makeupFor(true, program, today, trainingDays, completed),
        warmupCooldownEnabled,
        warmup: null,
        cooldown: null,
      };
    }

    // A prescribed day writes an assignment with no WOD on it -- the column
    // has been nullable since before programs existed, and this is the first
    // thing that means something by it. Resolved before the row is written
    // because an empty result is a day to generate a WOD for instead, and by
    // then the row would already say otherwise.
    // No assignment id to resolve swaps against, and none needed: the row does
    // not exist yet, so nobody has had a day to swap on.
    const prescription = await this.prescriptionFor(userId, null, day);
    if (prescription) {
      const created = await this.prisma.dailyAssignment.create({
        data: {
          userId,
          date: today,
          status: 'scheduled',
          enrollmentId: day.kind === 'fallback' ? null : day.day.enrollmentId,
          planSlotId: day.kind === 'fallback' ? null : day.day.planSlotId,
          planDayIndex: day.kind === 'fallback' ? null : day.day.planDayIndex,
        },
      });

      return {
        date: today,
        plan,
        completedProgram: await this.enrollments.cardFor(userId),
        isRestDay: false,
        makeup: null,
        assignment: {
          id: created.id,
          date: created.date,
          status: created.status,
          wod: null,
          prescription,
          session: null,
        },
        warmupCooldownEnabled,
        // The checklists are built from a WOD's dominant pattern, and straight
        // sets have none to read. Asked through the same helper anyway, so the
        // "no pattern, no lists" answer lives in one place.
        ...(await this.getChecklistsFor(
          userId,
          warmupCooldownEnabled,
          undefined,
        )),
      };
    }

    const wod = await this.wodForDay(
      userId,
      today,
      day,
      cooldownDays,
      rule?.equipment ?? [...DEFAULT_EQUIPMENT],
    );

    const created = await this.prisma.dailyAssignment.create({
      data: {
        userId,
        date: today,
        wodId: wod.id,
        status: 'scheduled',
        // All three null on a day no program produced, which is what the
        // columns mean -- see the schema. Written together because they are
        // one fact: this day came from that slot of that run.
        enrollmentId: day.kind === 'fallback' ? null : day.day.enrollmentId,
        planSlotId: day.kind === 'fallback' ? null : day.day.planSlotId,
        planDayIndex: day.kind === 'fallback' ? null : day.day.planDayIndex,
      },
      include: { wod: { include: wodInclude } },
    });

    const scaledWod = await this.resolveWodForToday(
      userId,
      created.id,
      created.wod!,
    );

    return {
      date: today,
      plan,
      completedProgram: await this.enrollments.cardFor(userId),
      isRestDay: false,
      // Nothing to make up on a day that already has a session.
      makeup: null,
      assignment: {
        id: created.id,
        date: created.date,
        status: created.status,
        // wodId was just set from a freshly-picked candidate, so the relation is present.
        wod: scaledWod,
        prescription: null,
        session: null,
      },
      warmupCooldownEnabled,
      ...(await this.getChecklistsFor(
        userId,
        warmupCooldownEnabled,
        scaledWod.dominantPattern,
      )),
    };
  }

  /**
   * Retires a run that has passed its last day, and hands back the fallback
   * so the rest of `getToday` has one less case to carry.
   *
   * Completing on read rather than on a schedule is what keeps the app free of
   * a nightly job: the day an athlete's program ends is a day they open Today,
   * and nobody needs the row flipped before then.
   *
   * The figures are computed and stored by `EnrollmentsService` in the same
   * breath (DN-18), because the moment a run is retired is the only moment
   * they are all still true -- the group grows, days get deleted with a user,
   * and a record of what somebody finished should not change afterwards
   * because the library did.
   */
  private async settleProgramDay(
    day: ProgramDay,
    userId: string,
    // Excluding `completed` from the return type is the point of this
    // function: past that line every caller is dealing with a day that has
    // already been dealt with, and the compiler says so.
  ): Promise<SettledDay> {
    if (day.kind !== 'completed') return day;
    await this.enrollments.completeRun(userId, day.enrollmentId);
    return { kind: 'fallback', reason: 'no-enrollment' };
  }

  /** The day's WOD: the one the program pinned, or one picked for its slot. */
  /**
   * The makeup offer for today, counting only this Monday-to-Sunday week.
   *
   * Scoping the count to `getWeekRange` is what makes "nothing rolls over"
   * true rather than merely intended: an unfinished week simply stops being
   * asked about on Monday. Carrying debt forward would turn the app into
   * something the athlete is behind on, which fights the decision that every
   * completed session is what gets celebrated.
   *
   * Only `completed` counts. A scheduled day is the app's expectation, not
   * the athlete's work, and counting it would quietly make every week look
   * finished before it was.
   */
  private makeupFor(
    resting: boolean,
    program: ActiveProgram | null,
    today: string,
    trainingDays: number[],
    completedWeekdays: number[],
  ) {
    return resolveMakeup({
      resting,
      scheduleFixed: resolveScheduleLock(program, today) !== null,
      trainingDays,
      // The same completions `resolveProgramDay` lays the week's sessions
      // onto (DN-123). One query, one definition: whether the week is short
      // and what the makeup then hands over cannot disagree.
      completedThisWeek: completedWeekdays.length,
    });
  }

  /**
   * Weekdays of this Monday-to-Sunday week the athlete has finished a session
   * on (DN-123).
   *
   * Scoping to `getWeekRange` is what makes "nothing rolls over" true rather
   * than merely intended: an unfinished week simply stops being asked about
   * on Monday. Carrying debt forward would turn the app into something the
   * athlete is behind on, which fights the decision that every completed
   * session is what gets celebrated.
   *
   * Only `completed` counts. A scheduled day is the app's expectation, not
   * the athlete's work, and counting it would quietly make every week look
   * finished before it was -- and, since DN-123, would hold a place in the
   * week for a session that was never done.
   */
  private async completedWeekdays(
    userId: string,
    today: string,
  ): Promise<number[]> {
    const week = getWeekRange(today);
    const days = await this.prisma.dailyAssignment.findMany({
      where: {
        userId,
        status: 'completed',
        date: { gte: week.start, lte: week.end },
      },
      select: { date: true },
    });
    return days.map(({ date }) => new Date(`${date}T00:00:00Z`).getUTCDay());
  }

  /**
   * What a prescribed day hands the athlete, or null when today is not one
   * (DN-19).
   *
   * Null also covers a `movements` day whose prescription resolved to nothing
   * -- every group missing from the library this athlete can see. The caller
   * then generates a WOD, which is the same refusal `resolveProgramDay` makes
   * for a slot with no rows at all: an authoring or library gap should cost
   * somebody the session it described, not the day.
   */
  private async prescriptionFor(
    userId: string,
    assignmentId: string | null,
    day: SettledDay,
  ) {
    if (day.kind !== 'prescribed') return null;
    const movements = await this.resolution.resolvePrescription(
      userId,
      assignmentId,
      day.movements,
    );
    // Same rendering rule as a WOD day (DN-116): the resolver records what an
    // automatic layer replaced even on a row the athlete swapped, and the
    // plate does not show it there.
    return movements.length > 0
      ? { movements: hideOverriddenPrescriptions(movements) }
      : null;
  }

  private async wodForDay(
    userId: string,
    today: string,
    day: SettledDay,
    cooldownDays: number,
    equipment: string[],
  ) {
    if (day.kind === 'pinned') {
      const pinned = await this.prisma.wod.findUnique({
        where: { id: day.wodId },
        select: { id: true, name: true, type: true, dominantPattern: true },
      });
      // A pinned WOD is chosen on purpose, so no cooldown or equipment rule
      // overrides it -- re-testing a benchmark is the point, and the movement
      // resolution below still fits it to the athlete. Archived is deliberate
      // too: the program was authored around this workout, and history is not
      // rewritten by a later edit (DN-25).
      if (pinned) return pinned;
    }

    return this.generateWodForDate(
      userId,
      today,
      cooldownDays,
      equipment,
      day.kind === 'generated' ? day : null,
    );
  }

  /** Null lists when the setting is off or there's no WOD to build a checklist for. */
  private async getChecklistsFor(
    userId: string,
    warmupCooldownEnabled: boolean,
    dominantPattern: string | undefined,
  ) {
    if (!warmupCooldownEnabled || !dominantPattern) {
      return { warmup: null, cooldown: null };
    }
    return this.wodsService.getChecklists(userId, dominantPattern);
  }

  /**
   * The WOD as this athlete trains it today -- their remembered choice per
   * line, then the day's swaps. See MovementResolutionService.
   * Resolved here at read time rather than stored on the assignment, because
   * `Wod` is shared library content; the session snapshot (DN-90) is where
   * the result is finally pinned down.
   */
  private async resolveWodForToday<
    W extends { movements: { id: string; exercise: Exercise }[] },
  >(
    userId: string,
    assignmentId: string,
    wod: W,
  ): Promise<
    Omit<W, 'movements'> & {
      movements: ResolvedMovement<W['movements'][number]>[];
    }
  > {
    return {
      ...wod,
      // The resolver records what an automatic layer replaced even on a row
      // the athlete swapped (DN-116); the plate does not show it there. This
      // is the only place the payload is built, so it is the only place that
      // has to say so.
      movements: hideOverriddenPrescriptions(
        await this.resolution.resolve(userId, assignmentId, wod.movements),
      ),
    };
  }

  /** The scheduler's day-per-week cap, for callers outside the scheduling flow (e.g. the Stats page). */
  async getScheduleCap(userId: string): Promise<{ maxDaysPerWeek: number }> {
    const rule = await this.prisma.scheduleRule.findUnique({
      where: { userId },
    });
    // Derived, not stored (DN-12). The athlete picks days; how many is the
    // count of what they picked, so there is no column here that could drift
    // out of step with the days themselves.
    return {
      maxDaysPerWeek: (rule?.trainingDays ?? DEFAULT_TRAINING_DAYS).length,
    };
  }

  /** Marks today as a rest day — upserts so this works whether or not a WOD was already generated. */
  /**
   * Takes the makeup offer: trains today although today is a rest day (DN-17).
   *
   * Refuses rather than quietly generating when there is no offer standing.
   * The screen only shows the control when `makeup` is non-null, so a request
   * that arrives without one is a stale screen or a direct caller, and
   * answering 200 would train an athlete on a day a fixed program deliberately
   * kept clear.
   *
   * The day is resolved against a full week rather than the athlete's
   * training days, so a flexible program hands over the session it authored
   * for this weekday instead of an unrelated WOD. That is the whole
   * distinction DN-16 kept between an authored rest and a day the athlete
   * chose off: only the second one has a session waiting behind it.
   */
  async trainMakeup(userId: string, today: string) {
    const [rule, existing, program, completed] = await Promise.all([
      this.prisma.scheduleRule.findUnique({ where: { userId } }),
      this.prisma.dailyAssignment.findUnique({
        where: { userId_date: { userId, date: today } },
      }),
      loadActiveProgram(this.prisma, userId),
      this.completedWeekdays(userId, today),
    ]);

    const trainingDays = rule?.trainingDays ?? [...DEFAULT_TRAINING_DAYS];
    const scheduled = existing !== null && existing.status !== 'skipped';
    const offer = this.makeupFor(
      !scheduled && this.restsToday(program, trainingDays, today, completed),
      program,
      today,
      trainingDays,
      completed,
    );
    if (!offer) {
      throw new ConflictException('There is no makeup session to take today.');
    }

    const day = await this.settleProgramDay(
      resolveProgramDay(
        program,
        alsoTraining(trainingDays, today),
        today,
        completed,
      ),
      userId,
    );
    // The makeup hands over whatever the program authored for this weekday,
    // and since DN-19 that can be straight sets rather than a WOD. Resolved
    // the same way `getToday` does, so a day taken late is the same day.
    // Resolved against the row that is already there, rather than against the
    // one the upsert below writes: a day the athlete swapped on and then
    // marked as rest comes back with their swaps still on it. Taking a day
    // late should not quietly undo the choices made on it.
    const prescription = await this.prescriptionFor(
      userId,
      existing?.id ?? null,
      day,
    );
    const wod = prescription
      ? null
      : await this.wodForDay(
          userId,
          today,
          day,
          rule?.patternCooldownDays ?? DEFAULT_PATTERN_COOLDOWN_DAYS,
          rule?.equipment ?? [...DEFAULT_EQUIPMENT],
        );

    // Upsert rather than create: a day the athlete marked as rest already has
    // a row, and the unique key on (userId, date) means there is exactly one
    // to turn back into a training day.
    const assignment = await this.prisma.dailyAssignment.upsert({
      where: { userId_date: { userId, date: today } },
      update: {
        status: 'scheduled',
        // Explicitly nulled on a prescribed day rather than left alone: the
        // row being updated is a rest day that may already carry a WOD, and a
        // day cannot be both.
        wodId: wod?.id ?? null,
        enrollmentId: day.kind === 'fallback' ? null : day.day.enrollmentId,
        planSlotId: day.kind === 'fallback' ? null : day.day.planSlotId,
        planDayIndex: day.kind === 'fallback' ? null : day.day.planDayIndex,
      },
      create: {
        userId,
        date: today,
        wodId: wod?.id ?? null,
        status: 'scheduled',
        enrollmentId: day.kind === 'fallback' ? null : day.day.enrollmentId,
        planSlotId: day.kind === 'fallback' ? null : day.day.planSlotId,
        planDayIndex: day.kind === 'fallback' ? null : day.day.planDayIndex,
      },
      include: { wod: { include: wodInclude } },
    });

    const warmupCooldownEnabled = rule?.warmupCooldownEnabled ?? false;
    return {
      date: today,
      plan: planBlock(day),
      completedProgram: await this.enrollments.cardFor(userId),
      isRestDay: false,
      // Taken, so there is nothing left to offer.
      makeup: null,
      assignment: {
        id: assignment.id,
        date: assignment.date,
        status: assignment.status,
        wod: assignment.wod
          ? await this.resolveWodForToday(userId, assignment.id, assignment.wod)
          : null,
        prescription,
        session: null,
      },
      warmupCooldownEnabled,
      ...(await this.getChecklistsFor(
        userId,
        warmupCooldownEnabled,
        assignment.wod?.dominantPattern,
      )),
    };
  }

  /** Today's rest-day answer, on the same fork `getToday` uses. */
  private restsToday(
    program: ActiveProgram | null,
    trainingDays: number[],
    today: string,
    completedWeekdays: number[],
  ): boolean {
    const day = resolveProgramDay(
      program,
      trainingDays,
      today,
      completedWeekdays,
    );
    return day.kind === 'fallback'
      ? isRestDay(today, trainingDays)
      : day.kind === 'rest';
  }

  async skipToday(userId: string, today: string) {
    await this.prisma.dailyAssignment.upsert({
      where: { userId_date: { userId, date: today } },
      update: { status: 'skipped' },
      create: { userId, date: today, status: 'skipped' },
    });
    const [rule, program, completed] = await Promise.all([
      this.prisma.scheduleRule.findUnique({ where: { userId } }),
      loadActiveProgram(this.prisma, userId),
      this.completedWeekdays(userId, today),
    ]);
    // Resolved rather than hardcoded null: skipping a day does not leave the
    // program, so the strip that says which week the athlete is in is still
    // true afterwards. Nothing is settled here -- an enrollment past its last
    // day completes on the next `getToday`, not on a skip.
    const plan = planBlock(
      resolveProgramDay(
        program,
        rule?.trainingDays ?? [...DEFAULT_TRAINING_DAYS],
        today,
        completed,
      ),
    );
    return {
      date: today,
      plan,
      completedProgram: await this.enrollments.cardFor(userId),
      isRestDay: true,
      assignment: null,
      // Marking the day as rest does not close it: the week is still the unit
      // of completion, so the offer to train anyway stands (DN-17).
      makeup: this.makeupFor(
        true,
        program,
        today,
        rule?.trainingDays ?? [...DEFAULT_TRAINING_DAYS],
        completed,
      ),
      warmupCooldownEnabled: rule?.warmupCooldownEnabled ?? false,
      warmup: null,
      cooldown: null,
    };
  }

  private async generateWodForDate(
    userId: string,
    today: string,
    cooldownDays: number,
    equipment: string[],
    slot: GeneratedDay | null,
  ) {
    const [wods, recentAssignments, skillLevels, linedExercises] =
      await Promise.all([
        this.prisma.wod.findMany({
          // The global library plus this athlete's own WODs (DN-93). Nobody
          // else's personal content can be picked for them.
          where: libraryVisibleTo(userId),
          // Ordered so the candidate pool is the same list every time. Without
          // it the pick depends on whatever order Postgres returns rows in,
          // which makes "the same athlete, the same day, the same library"
          // reproducible only by luck.
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            type: true,
            dominantPattern: true,
            // The two axes only a program constrains (DN-16). Selected
            // unconditionally rather than behind the constraints, because a
            // select that changes shape per call is a candidate list that
            // changes shape per call.
            isNamed: true,
            timeCapMinutes: true,
            // The movements come along so the equipment floor can find the one
            // the WOD is identified by (DN-82). Ordered, because "the first
            // movement in the dominant pattern" is only meaningful in the
            // order the athlete meets them.
            movements: {
              orderBy: { order: 'asc' },
              select: { exercise: true },
            },
          },
        }),
        this.prisma.dailyAssignment.findMany({
          where: {
            userId,
            date: { lt: today },
            status: { in: ['scheduled', 'in_progress', 'completed'] },
          },
          orderBy: { date: 'desc' },
          take: 30,
          select: {
            date: true,
            wod: {
              select: {
                id: true,
                name: true,
                type: true,
                dominantPattern: true,
              },
            },
          },
        }),
        // The remembered choice, because the floor has to judge what the
        // athlete will actually be given rather than what the library
        // prescribed: someone with no bar whose pull movement is already
        // Supermans is having nothing substituted for equipment.
        this.prisma.skillLevel.findMany({ where: { userId } }),
        this.prisma.exercise.findMany({
          where: { ...libraryVisibleTo(userId), movementGroup: { not: null } },
        }),
      ]);

    // status filter above guarantees wodId (and so `wod`) is set on every row here,
    // but wodId is nullable at the schema level (for skipped days), so narrow explicitly.
    const history: RecentAssignment[] = recentAssignments
      .filter(
        (a): a is typeof a & { wod: NonNullable<typeof a.wod> } =>
          a.wod !== null,
      )
      .map((a) => ({ date: a.date, wod: a.wod }));
    const chosen = new Map(
      skillLevels.map((l) => [l.movementGroup, l.exerciseId]),
    );
    const byId = new Map(linedExercises.map((e) => [e.id, e]));
    const owned = new Set(equipment);

    const candidates = wods.map((wod) => {
      const resolved = applyRememberedChoice(
        wod.movements,
        chosen,
        byId,
        owned,
      );
      const identifying = dominantMovement(resolved, wod.dominantPattern);
      return {
        id: wod.id,
        name: wod.name,
        type: wod.type,
        dominantPattern: wod.dominantPattern,
        isNamed: wod.isNamed,
        timeCapMinutes: wod.timeCapMinutes,
        // A WOD whose claimed pattern no movement carries has no identity to
        // judge, so it stays in the pool rather than being dropped on a data
        // gap — the discipline every resolution layer here keeps.
        dominantEquipment: identifying?.exercise.equipment ?? [],
      };
    });

    // Equipment first, then the slot. The floor is about what the athlete can
    // physically do and the slot is about what the program asked for, so
    // narrowing inside a pool already reduced to performable WODs is the only
    // order that cannot hand someone a workout they own no gear for. Both
    // relax rather than empty, so the pool handed to `pickWod` is never bare.
    const performable = applyEquipmentFloor(candidates, owned);
    const pool = slot === null ? performable : this.narrowed(performable, slot);

    return pickWod(pool, history, today, cooldownDays, this.rng);
  }
}

/**
 * The today response's program block, or null when no program is deciding
 * today.
 *
 * Null covers the athlete with no enrollment, the one whose program has not
 * started, and the one whose program just ended -- three situations, one
 * answer, because from the screen's point of view they are the same: there is
 * no program context to show above today's plate.
 */
function planBlock(day: ProgramDay) {
  // `completed` answers null alongside `fallback` because it is the same fact
  // for the screen: the run that just ended is no longer context for today.
  if (day.kind === 'fallback' || day.kind === 'completed') return null;
  return {
    enrollmentId: day.day.enrollmentId,
    planId: day.day.planId,
    name: day.day.planName,
    week: day.day.week,
    totalWeeks: day.day.totalWeeks,
    weekLabel: day.day.weekLabel,
    slotKind: day.day.slotKind,
  };
}
