import type { MovementHistory } from "@regimen-works/shared";

/**
 * The training behind a movement group, as a sentence rather than a score
 * (DN-96).
 *
 * > **Pull** — chin-ups for the last six weeks, negatives before that.
 *
 * The panel above it says what the athlete has *chosen*; this says what has
 * actually been happening. Neither is a verdict: there is no "enough", no
 * ranking, and nothing here says whether the athlete should move on. The
 * ladder this panel replaced made exactly those claims, which is why it went.
 */

/** A stretch of days on one line where the movement did not change. */
export type MovementRun = {
  exerciseId: string;
  /** The name the days themselves carried — a rename must not rewrite them. */
  name: string;
  sessions: number;
  /** Oldest and newest day in the run. Equal when it is a single session. */
  from: string;
  to: string;
};

/** One day, and which movement of this line was trained on it. */
type TrainedDay = { date: string; exerciseId: string; name: string };

/**
 * The line's history as runs, newest first: the movement being trained now,
 * then the one before it, and so on.
 *
 * Runs rather than a flat list because the question is when the movement
 * *changed* — twelve identical rows say less than "chin-ups since August".
 *
 * A day that trained two movements of the same line (a WOD naming two rungs)
 * ends a run and starts another, which is what actually happened; it is not
 * smoothed into one.
 */
export function buildLineRuns(
  history: MovementHistory[],
  line: string,
): MovementRun[] {
  const days: TrainedDay[] = history
    .filter((movement) => movement.line === line)
    .flatMap((movement) =>
      movement.days.map((day) => ({
        date: day.date,
        exerciseId: movement.exerciseId,
        name: movement.name,
      })),
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  const runs: MovementRun[] = [];
  for (const day of days) {
    const current = runs.at(-1);
    if (current && current.exerciseId === day.exerciseId) {
      current.sessions += 1;
      // Days arrive newest first, so each one extends the run backwards.
      current.from = day.date;
      continue;
    }
    runs.push({
      exerciseId: day.exerciseId,
      name: day.name,
      sessions: 1,
      from: day.date,
      to: day.date,
    });
  }
  return runs;
}

/** 5 Sep — the same short form the charts use, and in the athlete's own locale. */
export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * What the collapsed card says under the chosen movement.
 *
 * Null when the line has never been trained — the card then says nothing
 * rather than "0 sessions", which reads as a mark against the athlete for a
 * movement group they may simply not have met yet.
 */
export function describeLineHistory(runs: MovementRun[]): string | null {
  const [latest, previous] = runs;
  if (!latest) return null;

  const current =
    latest.sessions === 1
      ? `${latest.name} on ${shortDate(latest.to)}`
      : `${latest.name} ${latest.sessions}× since ${shortDate(latest.from)}`;

  return previous ? `${current} · ${previous.name} before that` : current;
}
