import { restPaceRequired } from '@regimen-works/shared';
import type { RestPace } from '@regimen-works/shared';
import type { ActiveProgram } from './program-day';

/**
 * The rest pace of the program being run, as Settings shows it (ADR 0005).
 *
 * Null where there is nothing to pace: no active program, or one that
 * prescribes no straight sets anywhere -- Just WODs has no rest between sets,
 * and a field for one would be a setting that does nothing.
 *
 * `required` reads every authored week rather than the current one. A hole in
 * week six is still a clock the athlete will reach, and clearing the pace in
 * week one would hand them a day with no rest to run.
 */
export function restPaceOf(program: ActiveProgram | null): RestPace | null {
  if (!program) return null;
  const movements = program.authoredWeeks.flatMap((week) =>
    week.slots.flatMap((slot) => slot.movements),
  );
  if (movements.length === 0) return null;
  return {
    enrollmentId: program.enrollmentId,
    planName: program.planName,
    defaultRestSeconds: program.defaultRestSeconds,
    required: restPaceRequired(movements),
  };
}
