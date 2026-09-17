import { hideOverriddenPrescriptions } from './movement-resolution.service';

/**
 * The plate's silence about what a swap overrode (DN-116).
 *
 * It used to happen inside the resolver, which meant the fact was never
 * computed rather than merely not shown — and the session snapshot, reading
 * the same output, inherited a silence written for a screen. Here it is a
 * rendering step over the resolved list, so one resolution can serve both
 * audiences.
 */

function movement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: 'wm-1',
    isSwapped: false,
    prescribedName: 'Pull-up',
    prescribedId: 'pull-up',
    prescribedReason: 'equipment',
    ...overrides,
  };
}

type Movement = {
  id: string;
  isSwapped: boolean;
  prescribedName: string | null;
  prescribedId: string | null;
  prescribedReason: 'equipment' | 'remembered_choice' | null;
};

describe('hideOverriddenPrescriptions', () => {
  it('says nothing about what a swap overrode', () => {
    const [shown] = hideOverriddenPrescriptions([
      movement({ isSwapped: true }),
    ]);

    expect(shown).toMatchObject({
      isSwapped: true,
      prescribedName: null,
      prescribedId: null,
      prescribedReason: null,
    });
  });

  it('keeps the prescription on a row the athlete did not swap', () => {
    // The case the field was added for: a movement dropped for want of a bar,
    // which the athlete never asked for and was never told about (DN-79).
    const [shown] = hideOverriddenPrescriptions([movement()]);

    expect(shown).toMatchObject({
      prescribedName: 'Pull-up',
      prescribedReason: 'equipment',
    });
  });

  it('leaves the input alone, so the recorded list keeps the fact', () => {
    // The snapshot reads the resolver's own output. If this mutated it, the
    // history would lose exactly what this change exists to keep.
    const resolved = [movement({ isSwapped: true })];
    hideOverriddenPrescriptions(resolved);

    expect(resolved[0].prescribedName).toBe('Pull-up');
  });

  it('hides only the swapped rows of a mixed list', () => {
    const shown = hideOverriddenPrescriptions([
      movement({ id: 'wm-1', isSwapped: true }),
      movement({ id: 'wm-2' }),
    ]);

    expect(shown.map((m) => m.prescribedName)).toEqual([null, 'Pull-up']);
  });

  it('passes through a row nothing replaced', () => {
    const [shown] = hideOverriddenPrescriptions([
      movement({
        prescribedName: null,
        prescribedId: null,
        prescribedReason: null,
      }),
    ]);

    expect(shown).toMatchObject({ prescribedName: null, isSwapped: false });
  });
});
