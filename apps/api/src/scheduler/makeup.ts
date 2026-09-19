import type { MakeupOffer } from '@regimen-works/shared';

/**
 * Whether to offer a makeup session today, and on what numbers (DN-17) --
 * pure, like the rest of `*.logic.ts`. No DB, no clock.
 *
 * The rule the whole feature rests on: **the week is the unit of completion.**
 * Training days say when the app expects the athlete, not when they are
 * allowed to train. Missing Wednesday should not mean Wednesday is gone, so a
 * rest day in a week that is still short offers to take the session anyway.
 *
 * Deliberately not a quota. DN-12 replaced "how many days a week" with "which
 * days", and this does not bring the quota back: the count here decides
 * whether to *offer* a day the athlete already has, never whether to refuse
 * one. Nothing here can turn a training day into a rest day.
 */
export type MakeupInputs = {
  /** Whether today is already a rest day. There is nothing to make up on a training day. */
  resting: boolean;
  /**
   * True while a fixed program is running (DN-118's schedule lock).
   *
   * Fixed programs opt out entirely. Pull-Up Builder is Mon/Tue/Thu/Fri
   * because heavy pull days want 48 hours between them, and letting Thursday
   * and Friday compact into the weekend would defeat the reason the schedule
   * was fixed in the first place.
   */
  scheduleFixed: boolean;
  /** The athlete's training days, whose length is what the week expects. */
  trainingDays: number[];
  /** Sessions finished since Monday. Scoped to this week by the caller's query. */
  completedThisWeek: number;
};

export function resolveMakeup({
  resting,
  scheduleFixed,
  trainingDays,
  completedThisWeek,
}: MakeupInputs): MakeupOffer | null {
  if (!resting || scheduleFixed) return null;

  const sessionsThisWeek = trainingDays.length;
  // `>=` rather than `===`: an athlete who trained on two rest days has done
  // more than the week asked for, and "0 short" is not an offer worth making.
  // It is reachable precisely *because* this feature exists.
  if (completedThisWeek >= sessionsThisWeek) return null;

  return { sessionsThisWeek, completedThisWeek };
}

/**
 * Every weekday, for resolving what the program would have made of today if
 * the athlete trained on it.
 *
 * A flexible program rests only because `resolveProgramDay` finds today
 * outside the athlete's training days; handing it a full week makes it resolve
 * the authored slot instead, which is exactly the session a makeup should
 * deliver. A fixed program never reaches here -- it opts out above -- so this
 * cannot override a schedule that meant what it said.
 */
export const EVERY_WEEKDAY = [0, 1, 2, 3, 4, 5, 6];
