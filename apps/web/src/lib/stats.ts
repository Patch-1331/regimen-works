import type { MovementVolume, WorkoutLogListItem } from "@regimen-works/shared";

/**
 * A row the WOD-shaped charts can read.
 *
 * A prescribed day (DN-126) has no `wod`, and every function below that keys
 * on a type or a pattern needs one. Narrowed in one place rather than by a
 * `?.` at each use, so the rule is "these charts are about WODs" stated once
 * instead of a scattering of optional chains that each look like an oversight.
 */
type WodLog = WorkoutLogListItem & { wod: NonNullable<WorkoutLogListItem["wod"]> };

function wodLogs(logs: WorkoutLogListItem[]): WodLog[] {
  return logs.filter((log): log is WodLog => log.wod !== null);
}

export function formatResult(resultType: WorkoutLogListItem["resultType"], resultValue: string): string {
  if (resultType === "time_seconds") {
    const total = Number(resultValue) || 0;
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  // "6/8" already reads as itself, and the slash is what tells it apart from
  // a round count at a glance.
  if (resultType === "sets_completed") return resultValue;
  return resultValue.replace("+", " + ");
}

/** Higher is better for both result types, so results can be compared directly once reduced to a number. */
function resultScore(resultType: WorkoutLogListItem["resultType"], resultValue: string): number {
  if (resultType === "time_seconds") {
    // Lower time is better — invert so "higher score wins" holds for both types.
    return -(Number(resultValue) || 0);
  }
  const [rounds, reps] = resultValue.split("+").map((v) => Number(v) || 0);
  return rounds * 100000 + reps;
}

export type PersonalRecord = {
  wodName: string;
  resultType: WorkoutLogListItem["resultType"];
  resultValue: string;
  date: string;
};

/**
 * Best logged result per named WOD, keyed by wodName.
 *
 * WOD days only. A strength session has no score to be best at — every
 * finished one reads "5/5", so a table of them would be a list of ties
 * presented as records (DN-126).
 */
export function computePRs(logs: WorkoutLogListItem[]): PersonalRecord[] {
  const best = new Map<string, PersonalRecord>();
  for (const log of wodLogs(logs)) {
    const current = best.get(log.name);
    if (!current || resultScore(log.resultType, log.resultValue) > resultScore(current.resultType, current.resultValue)) {
      best.set(log.name, {
        wodName: log.name,
        resultType: log.resultType,
        resultValue: log.resultValue,
        date: log.date,
      });
    }
  }
  return Array.from(best.values()).sort((a, b) => a.wodName.localeCompare(b.wodName));
}

export type Streaks = { current: number; longest: number };

/**
 * Consecutive-calendar-day streaks over logged workout dates. Rest days aren't
 * logged, so a gap of more than one day breaks the streak by design — this
 * measures "days in a row you actually trained," not weekly-plan adherence.
 */
export function computeStreaks(dates: string[], today: string): Streaks {
  const uniqueSorted = Array.from(new Set(dates)).sort();
  if (uniqueSorted.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < uniqueSorted.length; i++) {
    run = daysBetween(uniqueSorted[i - 1], uniqueSorted[i]) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  let current = 0;
  const last = uniqueSorted[uniqueSorted.length - 1];
  const gapToToday = daysBetween(last, today);
  if (gapToToday <= 1) {
    current = 1;
    for (let i = uniqueSorted.length - 1; i > 0; i--) {
      if (daysBetween(uniqueSorted[i - 1], uniqueSorted[i]) === 1) current++;
      else break;
    }
  }

  return { current, longest };
}

function daysBetween(isoA: string, isoB: string): number {
  const a = new Date(`${isoA}T00:00:00Z`).getTime();
  const b = new Date(`${isoB}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function computePatternBalance(logs: WorkoutLogListItem[]): Array<{ pattern: string; count: number }> {
  const counts = new Map<string, number>();
  for (const log of wodLogs(logs)) {
    counts.set(log.wod.dominantPattern, (counts.get(log.wod.dominantPattern) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count);
}

export type WodTypeShare = {
  wodType: NonNullable<WorkoutLogListItem["wod"]>["type"];
  count: number;
  percent: number;
};

/** Share of logged workouts per WOD type (amrap/for_time/emom/tabata) — surfaces the scheduler's format-alternation rule as an outcome. */
export function computeWodTypeDistribution(logs: WorkoutLogListItem[]): WodTypeShare[] {
  const counted = wodLogs(logs);
  const counts = new Map<WodTypeShare["wodType"], number>();
  for (const log of counted) {
    counts.set(log.wod.type, (counts.get(log.wod.type) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    // Over the WODs counted, not over every log: a share of days that puts
    // strength sessions in the denominator and nowhere in the numerator adds
    // up to less than 100% and says the athlete trained less than they did.
    .map(([wodType, count]) => ({ wodType, count, percent: (count / counted.length) * 100 }))
    .sort((a, b) => b.count - a.count);
}

/** Monday of the ISO week containing the given date, as an ISO date string. */
export function isoWeekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + mondayOffset);
  return d.toISOString().slice(0, 10);
}

/**
 * Training days so far in the week `todayIso` falls in, counting today (DN-8).
 *
 * Today is counted whether or not it appears in `dates`, because the caller is
 * the completion screen: the session being celebrated has just happened and is
 * not saved yet. Distinct dates, so two workouts in a day are one day trained.
 *
 * A count, deliberately, and not a fraction of the schedule cap — "3 of your 5"
 * would turn a record of what happened into a score against a target.
 */
export function trainingDaysThisWeek(dates: string[], todayIso: string): number {
  const weekStart = isoWeekStart(todayIso);
  const inWeek = new Set([todayIso]);
  for (const date of dates) {
    if (isoWeekStart(date) === weekStart && date <= todayIso) inWeek.add(date);
  }
  return inWeek.size;
}

export type PatternWeekVolume = { weekStart: string; counts: Record<string, number> };

/**
 * Same per-pattern counting as computePatternBalance, but bucketed by ISO week
 * instead of collapsed into a lifetime total — surfaces whether pattern balance
 * holds up week to week rather than just in aggregate.
 */
export function computePatternVolumeTrend(logs: WorkoutLogListItem[]): PatternWeekVolume[] {
  const byWeek = new Map<string, Record<string, number>>();
  for (const log of wodLogs(logs)) {
    const weekStart = isoWeekStart(log.date);
    const counts = byWeek.get(weekStart) ?? {};
    counts[log.wod.dominantPattern] = (counts[log.wod.dominantPattern] ?? 0) + 1;
    byWeek.set(weekStart, counts);
  }
  return Array.from(byWeek.entries())
    .map(([weekStart, counts]) => ({ weekStart, counts }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export type ForTimeTrendPoint = { date: string; seconds: number };
export type ForTimeTrend = { wodName: string; points: ForTimeTrendPoint[] };

/**
 * Chronological time-per-attempt for each named For Time WOD that's been
 * repeated — the PRs tile only shows the single best result, this shows
 * whether it's still trending down or has plateaued. WODs logged only once
 * are excluded since there's no trend to show yet.
 */
export function computeForTimeTrends(logs: WorkoutLogListItem[]): ForTimeTrend[] {
  const byWod = new Map<string, ForTimeTrendPoint[]>();
  for (const log of logs) {
    if (log.resultType !== "time_seconds") continue;
    const points = byWod.get(log.name) ?? [];
    points.push({ date: log.date, seconds: Number(log.resultValue) || 0 });
    byWod.set(log.name, points);
  }
  return Array.from(byWod.entries())
    .map(([wodName, points]) => ({ wodName, points: points.sort((a, b) => a.date.localeCompare(b.date)) }))
    .filter((t) => t.points.length > 1)
    .sort((a, b) => a.wodName.localeCompare(b.wodName));
}

export type WeekTrainingDays = { weekStart: string; days: number };

/** Distinct training days per ISO week, so adherence to the scheduler's day cap is visible over time rather than just as a per-day rule. */
export function computeWeeklyTrainingDays(dates: string[]): WeekTrainingDays[] {
  const byWeek = new Map<string, Set<string>>();
  for (const date of dates) {
    const weekStart = isoWeekStart(date);
    const set = byWeek.get(weekStart) ?? new Set<string>();
    set.add(date);
    byWeek.set(weekStart, set);
  }
  return Array.from(byWeek.entries())
    .map(([weekStart, set]) => ({ weekStart, days: set.size }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export type MovementVolumePoint = { date: string; sets: number[]; total: number };
export type MovementVolumeTrend = {
  exerciseId: string;
  name: string;
  unit: MovementVolume["unit"];
  points: MovementVolumePoint[];
};

/** The reps of one session added up — the height of one bar. */
function volumeOf(sets: number[]): number {
  return sets.reduce((sum, reps) => sum + reps, 0);
}

/**
 * Per-movement volume, session by session in the order they happened (DN-22).
 *
 * The API answers newest-first because that is the order the athlete reads a
 * list in; a chart runs the other way, so this reverses it.
 *
 * Totals per movement and never across them: seconds of a hold and reps of a
 * pull-up are not the same quantity, which is why each movement gets its own
 * card rather than a share of one stacked bar. A movement trained once is left
 * out for the same reason `computeForTimeTrends` leaves out a WOD done once —
 * a single point is a number, not a trend, and it is already on the day's log.
 */
export function computeMovementVolumeTrends(volumes: MovementVolume[]): MovementVolumeTrend[] {
  return volumes
    .map((volume) => ({
      exerciseId: volume.exerciseId,
      name: volume.name,
      unit: volume.unit,
      points: volume.sessions
        .map((session) => ({ date: session.date, sets: session.sets, total: volumeOf(session.sets) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .filter((trend) => trend.points.length > 1)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type SessionComparison = {
  exerciseId: string;
  name: string;
  sets: number[];
  /** The same movement's session before this one, or null if this is the first. */
  previous: number[] | null;
  /** How the total moved. Null when there is nothing to move from. */
  direction: "up" | "down" | "same" | null;
};

/**
 * What the athlete just did, beside the last time they did it (DN-22).
 *
 * A record and not a score (DN-88): both sets of numbers happened, and
 * `direction` says which way the total moved. Nothing here judges the session
 * — "down" on a day that followed a hard one is information, not a mark.
 *
 * Matched by assignment rather than by date, because the session being
 * celebrated is the one the athlete is standing in, and a day can hold more
 * than one.
 */
export function compareToLastSession(
  volumes: MovementVolume[],
  assignmentId: string,
): SessionComparison[] {
  const comparisons: SessionComparison[] = [];
  for (const volume of volumes) {
    // Newest first, so the session before this one is the next in the list.
    const index = volume.sessions.findIndex((s) => s.assignmentId === assignmentId);
    if (index === -1) continue;
    const sets = volume.sessions[index].sets;
    const previous = volume.sessions[index + 1]?.sets ?? null;
    const direction =
      previous === null
        ? null
        : volumeOf(sets) > volumeOf(previous)
          ? "up"
          : volumeOf(sets) < volumeOf(previous)
            ? "down"
            : "same";
    comparisons.push({ exerciseId: volume.exerciseId, name: volume.name, sets, previous, direction });
  }
  return comparisons;
}
