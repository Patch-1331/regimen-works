import {
  progressionLine,
  type EnrollmentSummary,
  type RungChange,
  type RungSnapshot,
} from '@regimen-works/shared';

/**
 * What a finished program has to show for itself (DN-18).
 *
 * Pure, because every input is a fact the caller has already fetched and the
 * interesting part is the arithmetic on them: which lines moved, in which
 * direction, and what the movement was called at each end.
 */

/** The exercise seeded at a rung on a line, or undefined where none is. */
export type RungNames = ReadonlyMap<string, string>;

/** The key both sides of the diff look a name up by. */
export function rungKey(line: string, rung: number): string {
  return `${line}:${rung}`;
}

/**
 * A line the athlete has never trained reads as rung 0, not as "no answer".
 *
 * `SkillLevel` has no row until something writes one (DN-86), so an athlete
 * on their first program has an empty snapshot and an empty set of current
 * rungs. Rung 0 is what the app itself means by that -- everyone starts at the
 * bottom of every ladder and fixes it in one tap on their first workout
 * (DN-15) -- so reading absence as 0 describes the athlete the card is for.
 * Reading it as unknown would make the first program, the one most worth
 * summarising, the one that reports nothing.
 */
function rungOf(rungs: ReadonlyMap<string, number>, line: string): number {
  return rungs.get(line) ?? 0;
}

/**
 * Which lines moved over the run, and what they moved between.
 *
 * Both directions are reported. A rung that went down is a real outcome of a
 * program -- an athlete who deloaded, or who corrected an over-ambitious first
 * guess -- and a card that showed only the rises would be flattering rather
 * than accurate.
 *
 * A line whose exercise cannot be named at either end is left out rather than
 * rendered with a gap in it. That happens when the library has no exercise
 * seeded at a rung the athlete somehow holds, which is a library hole and not
 * something the athlete should be shown a broken sentence about.
 */
export function rungChangesOver(
  startingRungs: RungSnapshot,
  currentRungs: ReadonlyMap<string, number>,
  names: RungNames,
): RungChange[] {
  const started = new Map(Object.entries(startingRungs));
  const lines = new Set([...started.keys(), ...currentRungs.keys()]);

  return [...lines]
    .filter((line) => progressionLine.safeParse(line).success)
    .sort()
    .flatMap((line) => {
      const fromRung = rungOf(started, line);
      const toRung = rungOf(currentRungs, line);
      if (fromRung === toRung) return [];

      const fromName = names.get(rungKey(line, fromRung));
      const toName = names.get(rungKey(line, toRung));
      if (fromName === undefined || toName === undefined) return [];

      return [
        {
          line: line as RungChange['line'],
          fromRung,
          toRung,
          fromName,
          toName,
        },
      ];
    });
}

/**
 * The figures snapshotted onto `PlanEnrollment.summary` at completion.
 *
 * Every field is allowed to be empty, and an empty one is a real answer: a
 * program run for its whole length with nothing logged reads "0 sessions",
 * not as a figure that failed to compute. That case is the one worth getting
 * right -- an athlete who enrolled, trained nothing and let the weeks run out
 * still finished the run, and a card that broke on them would break exactly
 * when it is least welcome.
 */
export function buildEnrollmentSummary(input: {
  weeks: number | null;
  sessions: number;
  startingRungs: RungSnapshot;
  currentRungs: ReadonlyMap<string, number>;
  names: RungNames;
}): EnrollmentSummary {
  return {
    weeks: input.weeks,
    sessions: input.sessions,
    rungChanges: rungChangesOver(
      input.startingRungs,
      input.currentRungs,
      input.names,
    ),
  };
}
