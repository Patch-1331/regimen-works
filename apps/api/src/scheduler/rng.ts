import type { Provider } from '@nestjs/common';

/**
 * The randomness `pickWod` uses to choose between equally eligible WODs.
 *
 * `pickWod` has always taken `rng` as a parameter so a test can pin it; the
 * service handed it `Math.random` directly, which left the step between the
 * stored `patternCooldownDays` and the pick untestable — replacing the stored
 * value with a literal `0` passed all 304 db and 72 e2e tests (DN-119). The
 * rule's semantics were covered by `scheduler.logic.spec.ts`; the wiring from
 * the database to the rule was not.
 *
 * A token rather than a constructor default, because the default would be
 * invisible from the module and a test could only reach it by constructing
 * the service by hand. This way the app states its randomness in one place
 * and a test can override it the same way it overrides any other provider.
 */
export const RNG = Symbol('RNG');

/** `() => number` in [0, 1), the shape `Math.random` has. */
export type Rng = () => number;

export const rngProvider: Provider = { provide: RNG, useValue: Math.random };
