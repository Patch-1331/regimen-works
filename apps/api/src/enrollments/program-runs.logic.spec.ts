import { newestFirst, toProgramRun, type RunRow } from './program-runs.logic';

// A Wednesday. Its week runs Monday 2026-09-14 to Sunday 2026-09-20.
const TODAY = '2026-09-16';

function row(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: 'enrollment-1',
    programId: 'program-1',
    status: 'active',
    startDate: '2026-09-14',
    weeks: 6,
    completedAt: null,
    endedAt: null,
    program: { name: 'Foundations', summary: 'Six weeks of the basics.' },
    ...overrides,
  };
}

describe('toProgramRun', () => {
  it('reads the current run as the week today falls in', () => {
    expect(toProgramRun(row({ startDate: '2026-09-01' }), TODAY)).toEqual({
      enrollmentId: 'enrollment-1',
      programId: 'program-1',
      programName: 'Foundations',
      programSummary: 'Six weeks of the basics.',
      status: 'active',
      startDate: '2026-09-01',
      totalWeeks: 6,
      week: 3,
      finishedAt: null,
    });
  });

  it('counts by calendar week, so a mid-week start has a short week 1', () => {
    // Started on a Saturday: the Monday after is already week 2, as on Today.
    const run = row({ startDate: '2026-09-12' });

    expect(toProgramRun(run, '2026-09-13').week).toBe(1);
    expect(toProgramRun(run, '2026-09-14').week).toBe(2);
  });

  it('puts a run waiting for its start date in no week yet', () => {
    expect(
      toProgramRun(row({ startDate: '2026-09-21' }), TODAY).week,
    ).toBeNull();
  });

  it('counts an open-ended run without a ceiling', () => {
    const run = toProgramRun(
      row({ startDate: '2026-01-05', weeks: null }),
      TODAY,
    );

    expect(run).toMatchObject({ totalWeeks: null, week: 37 });
  });

  it('reads an ended run as the week it was ended in', () => {
    const endedAt = new Date('2026-09-23T18:00:00.000Z');
    const run = toProgramRun(
      row({ status: 'ended', startDate: '2026-09-14', endedAt }),
      TODAY,
    );

    expect(run).toMatchObject({
      status: 'ended',
      week: 2,
      finishedAt: '2026-09-23T18:00:00.000Z',
    });
  });

  it('holds an ended run to its length and to its first week', () => {
    const late = toProgramRun(
      row({
        status: 'ended',
        weeks: 2,
        endedAt: new Date('2026-10-30T09:00:00.000Z'),
      }),
      TODAY,
    );
    const early = toProgramRun(
      row({
        status: 'ended',
        startDate: '2026-09-21',
        endedAt: new Date('2026-09-16T09:00:00.000Z'),
      }),
      TODAY,
    );

    expect(late.week).toBe(2);
    expect(early.week).toBe(1);
  });

  it('reads a finished run as having reached its last week', () => {
    const completedAt = new Date('2026-10-26T07:00:00.000Z');
    const run = toProgramRun(row({ status: 'completed', completedAt }), TODAY);

    expect(run).toMatchObject({
      status: 'completed',
      week: 6,
      finishedAt: '2026-10-26T07:00:00.000Z',
    });
  });
});

describe('newestFirst', () => {
  it('orders finished and ended runs together, by when each stopped', () => {
    const finished = toProgramRun(
      row({
        id: 'finished',
        status: 'completed',
        completedAt: new Date('2026-08-01T09:00:00.000Z'),
      }),
      TODAY,
    );
    const ended = toProgramRun(
      row({
        id: 'ended',
        status: 'ended',
        endedAt: new Date('2026-09-01T09:00:00.000Z'),
      }),
      TODAY,
    );

    expect(newestFirst([finished, ended]).map((r) => r.enrollmentId)).toEqual([
      'ended',
      'finished',
    ]);
  });
});
