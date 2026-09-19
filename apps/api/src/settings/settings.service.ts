import { ConflictException, Injectable } from '@nestjs/common';
import {
  DEFAULT_EQUIPMENT,
  DEFAULT_PATTERN_COOLDOWN_DAYS,
  DEFAULT_TRAINING_DAYS,
  equipment as equipmentPiece,
} from '@regimen-works/shared';
import type {
  Equipment,
  ScheduleLock,
  Settings,
  UpdateSettings,
} from '@regimen-works/shared';
import type { ScheduleRule } from '@prisma/client';
import { loadActiveProgram } from '../plans/active-program';
import { resolveScheduleLock } from '../plans/schedule-lock';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The stored set, narrowed to pieces the catalog still has.
 *
 * The column is a bare String[] — Prisma will not check it — but the write
 * path already does, through `updateSettingsSchema` at the controller. So the
 * realistic way an unknown value reaches here is a piece leaving the catalog
 * after an athlete ticked it, and for that "you no longer own it" is a better
 * answer than a 500 on the settings screen. Dropped quietly on purpose, the
 * way every other layer in this project degrades.
 */
function ownedEquipment(stored: string[]): Equipment[] {
  return stored.filter(
    (piece): piece is Equipment => equipmentPiece.safeParse(piece).success,
  );
}

/**
 * Defaults for a user with no ScheduleRule row yet. They mirror the column
 * defaults in schema.prisma rather than restating a policy: warm-up/cool-down
 * is opt-in (#63), stopping at the time cap is how the timer runs unless the
 * athlete opts out, equipment starts at the baseline the app has always
 * assumed -- bodyweight, which is no tag at all, plus the bar (DN-81),
 * training days start at Mon-Fri, the spread the old five-day quota
 * backfilled to (DN-12), and the pattern cooldown starts at the window the
 * scheduler has always applied (DN-27).
 */
const DEFAULTS: Settings = {
  warmupCooldownEnabled: false,
  autoStopAtCapEnabled: true,
  equipment: [...DEFAULT_EQUIPMENT],
  trainingDays: [...DEFAULT_TRAINING_DAYS],
  patternCooldownDays: DEFAULT_PATTERN_COOLDOWN_DAYS,
  // Not a default so much as the shape's null: whether a program is driving
  // the week is never a property of the ScheduleRule row, so every caller
  // fills this in from the enrollment afterwards.
  scheduleLock: null,
};

function toSettings(
  rule: ScheduleRule | null,
  scheduleLock: ScheduleLock | null,
): Settings {
  if (!rule) return { ...DEFAULTS, scheduleLock };
  return {
    scheduleLock,
    warmupCooldownEnabled: rule.warmupCooldownEnabled,
    autoStopAtCapEnabled: rule.autoStopAtCapEnabled,
    equipment: ownedEquipment(rule.equipment),
    trainingDays: rule.trainingDays,
    patternCooldownDays: rule.patternCooldownDays,
  };
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `today` comes from the caller's clock rather than this service's, the way
   * `getToday` takes it: which week of a program the athlete is in decides
   * which days are locked, and a service that read the date itself could not
   * be tested on the week where the answer changes.
   */
  async get(userId: string, today: string): Promise<Settings> {
    const [rule, program] = await Promise.all([
      this.prisma.scheduleRule.findUnique({ where: { userId } }),
      loadActiveProgram(this.prisma, userId),
    ]);
    return toSettings(rule, resolveScheduleLock(program, today));
  }

  /**
   * Applies only the fields present in `patch`, so one switch never writes
   * another's value back. Provisioning creates a ScheduleRule on first
   * sign-in, but this still upserts so a toggle can't 404 on a user whose row
   * is somehow absent; the fields it omits land on their column defaults.
   *
   * `equipment`, where present, replaces the whole set — there is no add or
   * remove verb, so the athlete's screen sends what they own rather than what
   * changed. An explicit empty array is a real answer ("I own nothing") and
   * is stored as one, not read as an omission that falls back to the default.
   *
   * Returns the row as written rather than echoing the patch — with a partial
   * body that's the only answer that includes the fields left alone.
   */
  async update(
    userId: string,
    patch: UpdateSettings,
    today: string,
  ): Promise<Settings> {
    const lock = resolveScheduleLock(
      await loadActiveProgram(this.prisma, userId),
      today,
    );

    // Refused rather than stored-and-ignored. A write that returns 200 and
    // then has no effect on a single training day is the worst of the three
    // available answers: the athlete believes they have changed their week,
    // the database agrees with them, and the scheduler does not. Refusing
    // costs them one dialog and tells them the truth.
    //
    // `equipment` and the two toggles stay writable throughout, because a
    // fixed program has an opinion about *when* the athlete trains and none
    // at all about what they own or how their timer behaves.
    if (lock !== null && patch.trainingDays !== undefined) {
      throw new ConflictException(
        `${lock.planName} sets your training days while it is running. End the program to choose your own again.`,
      );
    }

    const rule = await this.prisma.scheduleRule.upsert({
      where: { userId },
      update: patch,
      create: { userId, ...patch },
    });

    return toSettings(rule, lock);
  }
}
