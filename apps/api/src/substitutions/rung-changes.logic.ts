/**
 * What a finished session offers to keep as the athlete's default (WOD-6).
 *
 * A swap applies to today only. If the athlete trained a line at something
 * other than their standing choice, the completion screen offers to remember
 * it — "you did chin-ups today, make that your pull movement?" The stored
 * choice then moves because of what they actually picked, which is what makes
 * it theirs rather than the app's view of them.
 */

export type TrainedRung = {
  line: string;
  rung: number;
  exerciseId: string;
  exerciseName: string;
};

export type ProposedRungChange = {
  line: string;
  /** Null when the line has no rung on record — see `proposeRungChanges`. */
  fromRung: number | null;
  toRung: number;
  exerciseId: string;
  exerciseName: string;
};

/**
 * Proposals are per line, never per movement: one prompt for "pull", however
 * many pull movements the WOD happened to contain.
 *
 * Where a line was trained at two different rungs in one session — two pull
 * movements, swapped differently — the one chosen **most recently** wins, so
 * `trained` must arrive in the order the athlete picked them. This used to
 * take the higher rung, on the grounds that "someone who did both chin-ups and
 * negatives did chin-ups". That is an inference about ability, and under
 * DN-88 the app makes none: it has no way to know which of the two they meant
 * to keep, and the last thing they reached for is the closest it can honestly
 * get.
 *
 * A proposal can move a line in either direction, and that is deliberate: the
 * athlete picked an easier movement on purpose, and remembering it is not the
 * app demoting them. What the app never does is change the choice on its own.
 *
 * A line with no rung on record proposes too, with `fromRung: null` (DN-86).
 * Since provisioning stopped handing everyone rung 0, that is what a brand-new
 * athlete's every line looks like — and their first swap is precisely the
 * choice worth remembering, so skipping it would mean re-swapping the same
 * movement every session forever.
 */
export function proposeRungChanges(
  trained: TrainedRung[],
  currentRung: Map<string, number>,
): ProposedRungChange[] {
  // Last write wins: `trained` is in the order the athlete chose, so a later
  // entry simply replaces an earlier one on the same line.
  const latestByLine = new Map<string, TrainedRung>();
  for (const t of trained) latestByLine.set(t.line, t);

  const proposals: ProposedRungChange[] = [];
  for (const [line, t] of latestByLine) {
    const fromRung = currentRung.has(line) ? currentRung.get(line)! : null;
    if (fromRung === t.rung) continue; // already on record — nothing to ask

    proposals.push({
      line,
      fromRung,
      toRung: t.rung,
      exerciseId: t.exerciseId,
      exerciseName: t.exerciseName,
    });
  }

  // Stable order so the card doesn't reshuffle between reads.
  return proposals.sort((a, b) => a.line.localeCompare(b.line));
}
