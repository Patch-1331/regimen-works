import { alsoTraining, resolveMakeup, type MakeupInputs } from './makeup';

const WEEKDAYS = [1, 2, 3, 4, 5];

function inputs(overrides: Partial<MakeupInputs> = {}): MakeupInputs {
  return {
    resting: true,
    scheduleFixed: false,
    trainingDays: WEEKDAYS,
    completedThisWeek: 0,
    ...overrides,
  };
}

describe('resolveMakeup', () => {
  it('offers the session on a rest day while the week is short', () => {
    expect(resolveMakeup(inputs({ completedThisWeek: 3 }))).toEqual({
      sessionsThisWeek: 5,
      completedThisWeek: 3,
    });
  });

  it('offers nothing on a training day, which has a session already', () => {
    expect(resolveMakeup(inputs({ resting: false }))).toBeNull();
  });

  it('offers nothing once the week is done', () => {
    expect(resolveMakeup(inputs({ completedThisWeek: 5 }))).toBeNull();
  });

  it('offers nothing to an athlete who trained more than the week asked', () => {
    // Reachable precisely because this feature exists: two makeups on a
    // five-day week puts them at six. "0 short" is not an offer, and a
    // negative one is an accusation.
    expect(resolveMakeup(inputs({ completedThisWeek: 7 }))).toBeNull();
  });

  it('opts a fixed program out entirely, however short the week', () => {
    // Pull-Up Builder is Mon/Tue/Thu/Fri because heavy pull days want 48
    // hours between them. Letting Thursday and Friday compact into the
    // weekend would defeat the reason the schedule was fixed.
    expect(
      resolveMakeup(inputs({ scheduleFixed: true, completedThisWeek: 0 })),
    ).toBeNull();
  });

  it('counts the week from the athlete’s own training days', () => {
    expect(resolveMakeup(inputs({ trainingDays: [1, 3, 5] }))).toMatchObject({
      sessionsThisWeek: 3,
    });
  });

  it('offers nothing to an athlete who trains every day', () => {
    // Not a special case in the code, and worth pinning anyway: there is no
    // rest day to make anything up on, so `resting` is the thing that is
    // false rather than the arithmetic.
    expect(
      resolveMakeup(
        inputs({ resting: false, trainingDays: [0, 1, 2, 3, 4, 5, 6] }),
      ),
    ).toBeNull();
  });

  it('offers on a rest day to an athlete who has trained nothing yet', () => {
    // The Monday-morning case. Nothing carried in from last week, so a fresh
    // week is short by all of it.
    expect(resolveMakeup(inputs())).toEqual({
      sessionsThisWeek: 5,
      completedThisWeek: 0,
    });
  });

  it('offers nothing when the athlete has no training days at all', () => {
    // An empty schedule expects nothing, so nothing can be short. Without the
    // comparison this would offer a makeup every single day.
    expect(resolveMakeup(inputs({ trainingDays: [] }))).toBeNull();
  });
});

describe('alsoTraining', () => {
  const THURSDAY = '2026-09-17';
  const WEDNESDAY = '2026-09-16';

  it('adds the makeup day to the athlete’s week', () => {
    // The point of DN-123: a Mon/Wed/Fri athlete taking Thursday has a
    // four-day week this once, and the program's sessions flow across it.
    expect(alsoTraining([1, 3, 5], THURSDAY)).toEqual([1, 3, 5, 4]);
  });

  it('leaves a day they already train alone', () => {
    // No makeup is offered on a training day, but the guard keeps the week
    // from counting the same day twice if one ever were.
    expect(alsoTraining([1, 3, 5], WEDNESDAY)).toEqual([1, 3, 5]);
  });

  it('does not widen the week beyond the day being made up', () => {
    // DN-17 passed all seven weekdays here. That resolved a seven-day
    // athlete's week, which since DN-128 hands out sessions the athlete's
    // own week deliberately drops.
    expect(alsoTraining([1, 3, 5], THURSDAY)).toHaveLength(4);
  });

  it('gives a day to an athlete with no training days at all', () => {
    expect(alsoTraining([], THURSDAY)).toEqual([4]);
  });
});
