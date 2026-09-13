/**
 * What a finished session offers to make permanent (WOD-6).
 *
 * A swap applies to today only. If the athlete trained a line at a rung other
 * than the one on record, the completion screen offers to move it — "you did
 * chin-ups today, make that your pull movement?" The rung then moves because
 * of what they actually did, which is a far better signal than an inference
 * drawn from metcon rounds, and it is what makes the progression theirs.
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
 * movements, swapped differently — the **highest** wins. Someone who did both
 * chin-ups and negatives did chin-ups, and recording the easier of the two
 * would propose a demotion off the back of a session that demonstrated the
 * opposite.
 *
 * A proposal can still move a line *down*, and that is deliberate: the
 * athlete swapped down on purpose, and confirming it is their choice. What
 * the app never does is lower anyone on its own.
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
  const bestByLine = new Map<string, TrainedRung>();
  for (const t of trained) {
    const best = bestByLine.get(t.line);
    if (!best || t.rung > best.rung) bestByLine.set(t.line, t);
  }

  const proposals: ProposedRungChange[] = [];
  for (const [line, t] of bestByLine) {
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
