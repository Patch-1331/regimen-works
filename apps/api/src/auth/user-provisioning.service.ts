import { Injectable, Optional } from '@nestjs/common';
import { todayIsoDate } from '../common/today';
import {
  JUST_WODS_PLAN,
  JUST_WODS_PLAN_ID,
  JUST_WODS_SLOTS,
  JUST_WODS_WEEK,
} from '../plans/just-wods';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Creates the rows a signed-in user needs before anything else can reference
 * them: their User row (which every per-user foreign key points at), a
 * ScheduleRule, and an enrollment in Just WODs (DN-13).
 *
 * Deliberately **not** a SkillLevel per progression line (DN-86). Provisioning
 * a rung is the app forming an opinion about someone it has never seen train:
 * it used to start everyone at rung 0, so an athlete who can do ten pull-ups
 * was handed negative pull-ups and knee push-ups on day one. `applyCurrentRung`
 * passes a movement through unchanged when its line has no rung on record, so
 * creating nothing means the first workout is the library's own prescription —
 * and the app personalises only once the athlete has chosen something in the
 * swap panel.
 *
 * Clerk owns identity, so there is no sign-up hook here; a user simply exists
 * the first time they present a valid token.
 */
@Injectable()
export class UserProvisioningService {
  /**
   * Users provisioned during this process's lifetime. Purely to keep the
   * common case off the database — a cold cache costs one extra round trip,
   * never a wrong result.
   *
   * It is not what makes concurrent calls safe: on a user's very first load
   * the web app fires several requests at once, so the cache is cold for all
   * of them and they all reach the database together. That safety comes from
   * the writes below.
   */
  private readonly known = new Set<string>();

  /**
   * `today` is a parameter so a test can pin it, matching how the scheduler
   * takes the date rather than reading a clock. There is no provider token
   * here the way there is for randomness (DN-119): the only caller that
   * overrides it constructs this service by hand anyway, and the date is
   * plainly observable on the row afterwards, where the pick the rng feeds
   * was not.
   *
   * `@Optional()` is load-bearing and not decoration. Nest reads the emitted
   * parameter type and tries to resolve `Function` as a provider; the default
   * value is a TypeScript fact it never sees, so without this the whole
   * AppModule fails to compile with "can't resolve dependencies ... at index
   * [1]". Optional makes Nest pass undefined, which is exactly what makes the
   * default apply.
   */
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly today: () => string = todayIsoDate,
  ) {}

  async ensure(userId: string): Promise<void> {
    if (this.known.has(userId)) return;

    // `createMany({ skipDuplicates: true })` rather than `upsert`, which is
    // not safe against a concurrent insert of the same key: Postgres raises a
    // unique violation rather than quietly turning the losing insert into an
    // update, so parallel first requests used to 500 on `User_pkey`. This
    // compiles to INSERT ... ON CONFLICT DO NOTHING, where the loser is a
    // no-op instead of an error.
    //
    // It also says what is actually meant. Every `update: {}` here was a
    // no-op, so none of these writes was ever an update — they are all
    // "create if missing".
    //
    // Order matters inside the transaction, which is why this is a list and
    // not a set: every row here carries a foreign key to one above it.
    // ScheduleRule and the enrollment point at User, the enrollment also
    // points at Plan, the week at the plan and the slots at the week.
    //
    // The Just WODs rows are created here rather than left to the deploy
    // seed, because provisioning cannot assume the seed has run: the db and
    // e2e suites truncate every table between tests, so a service that
    // required a seeded plan would fail on a foreign key in every one of
    // them -- and would do the same in any environment where the two got out
    // of order. Every id is written down (see `just-wods.ts`), so each of
    // these is the same no-op second insert the User row is.
    await this.prisma.$transaction([
      this.prisma.user.createMany({
        data: [{ id: userId }],
        skipDuplicates: true,
      }),
      this.prisma.scheduleRule.createMany({
        data: [{ userId }],
        skipDuplicates: true,
      }),
      this.prisma.plan.createMany({
        data: [JUST_WODS_PLAN],
        skipDuplicates: true,
      }),
      this.prisma.planWeek.createMany({
        data: [JUST_WODS_WEEK],
        skipDuplicates: true,
      }),
      this.prisma.planSlot.createMany({
        data: JUST_WODS_SLOTS,
        skipDuplicates: true,
      }),
      // `weeks: null` because Just WODs is open-ended, which is what stops
      // `resolveSlotForDate` ever reporting past-end for it.
      //
      // The duplicate this skips is not a primary key: `id` defaults to a
      // fresh cuid on every call, so two concurrent requests generate two
      // different ones. What refuses the second row is the partial unique
      // index holding one *active* enrollment per athlete, and a bare
      // ON CONFLICT DO NOTHING -- which is what skipDuplicates compiles to --
      // catches a violation of any unique index, partial ones included.
      this.prisma.planEnrollment.createMany({
        data: [
          {
            userId,
            planId: JUST_WODS_PLAN_ID,
            startDate: this.today(),
            weeks: null,
          },
        ],
        skipDuplicates: true,
      }),
    ]);

    this.known.add(userId);
  }
}
