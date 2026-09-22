# Programs — design

The app becomes program-based. A **program** decides what each training day
is; the athlete picks one at signup and can change it later. "Just WODs" —
how the app works today — is itself a program, not the absence of one.

Alongside that, one principle changes how progression works:

> **The app decides what you do. You decide how hard it is.**

The scheduler still removes the daily planning burden. What it stops doing
is forming an opinion about the athlete's capability from behind their back.

## Where this leaves the current product doc

`apps/web/PRODUCT.md` principle 1 reads "The app decides so the user doesn't
have to — no daily workout-planning burden." That stays true of
*programming* and stops being true of *level*, so it needs amending rather
than deleting, with the principle above added beside it.

## 1. Program as the unit

### Just WODs is a program

The load-bearing decision. Seed the default WOD behaviour as a `Plan` row and
give every user a `PlanEnrollment` at provisioning, so `getToday` keeps one
path instead of growing an `if (enrolled) … else …` that would spread into
the scheduler, the today response, History and Stats.

### Model

| Entity | Key fields | Purpose |
|---|---|---|
| `Plan` | name, summary, goal, scheduleMode, min/maxDaysPerWeek, defaultDays, minWeeks, maxWeeks, defaultWeeks | The program definition. Shared library content, like `Wod`. |
| `PlanWeek` | planId, order, phase, label | One authored week. `phase` is `intro \| core \| peak`; core weeks are the block that repeats. |
| `PlanSlot` | planWeekId, dayOfWeek, kind, priority, wodId?, prescription fields | One day. `kind` is `rest \| wod_pinned \| wod_generated \| movements`. |
| `PlanEnrollment` | userId, planId, startDate, weeks, status, completedAt, startingRungs, summary | The athlete's run at a program. At most one `active` per user. `startingRungs` and `summary` are snapshots — see [Starting and finishing a program](#starting-and-finishing-a-program). |

`DailyAssignment` gains `enrollmentId`, `planSlotId` and `planDayIndex`, all
nullable, using the same composite `(id, userId)` foreign key the repo
already uses on `WorkoutSession`/`WorkoutLog` so an assignment can't claim an
enrollment belonging to another user.

Prisma can't express a partial unique index, so one active enrollment per
user needs raw SQL in the migration:

```sql
CREATE UNIQUE INDEX plan_enrollment_one_active_per_user
  ON "PlanEnrollment" ("userId") WHERE status = 'active';
```

Without it, two tabs racing on "Start program" both succeed.

### A day is not always a WOD

`PlanSlot.kind` is the fork:

- `rest` — the program's own rest day.
- `wod_pinned` — a specific WOD, for benchmark re-tests.
- `wod_generated` — constraints (`pattern`, `wodType`, `allowNamed`,
  `maxTimeCapMinutes`) that the existing `pickWod` resolves against the
  library. `allowNamed` defaults **false**: programs mostly program movement,
  not benchmarks.
- `movements` — prescribed movements with sets, reps and rest. **This is the
  shape that doesn't exist today** and it's most of the build (see §3).

Constraint fields are explicit nullable columns rather than jsonb — there are
few, they get filtered on, and the schema reserves jsonb for genuinely open
shapes (`roundSplits`). A CHECK constraint should hold `kind = 'wod_pinned'`
⇒ `wodId` non-null, and null otherwise.

### Filling a `wod_generated` slot

`pickWodForSlot` wraps `pickWod` rather than replacing it: hard-filter the
candidates by the slot's constraints, then let the existing cooldown and
format-alternation preferences work inside whatever survives.

When the filter empties the pool, **never throw** — a program day must always
produce a workout. Relax in this order, re-filtering each time:

`wodType` → `maxTimeCapMinutes` → `allowNamed` → `pattern`

Pattern goes last because the emphasis *is* the program's intent. Return
which constraints were relaxed so it's observable — that signal is how a
library hole gets noticed.

### Fixed vs. flexible schedules

`Plan.scheduleMode` decides whether the cadence screen is an input or a
readout.

- **`flexible`** carries `minDaysPerWeek`/`maxDaysPerWeek` and a default set
  of days. The athlete taps which weekdays they train, and the count is
  derived from that rather than entered separately — see
  [Training days are a calendar](#training-days-are-a-calendar).
- **`fixed`** carries none of them. The slot layout *is* the schedule, so
  days-per-week is just a count of its non-rest slots. This lets a program
  insist on *spacing*, not merely frequency — heavy pull days wanting 48
  hours between them is Mon/Tue/Thu/Fri, which "4 days a week" can't express.

A CHECK constraint should keep the modes from blurring: `fixed` ⇒ min/max
null; `flexible` ⇒ both non-null.

`PlanSlot.priority` decides which days survive when a flexible program runs
at fewer days than it was authored for — without it, dropping from 5 days to
3 removes whichever days happen to fall last in the week, which could delete
the program's main session.

### Training days are a calendar

The athlete picks *which* weekdays they train; "days per week" is the count
of what they picked, never an input of its own. Showing both a count and a
week strip would be two controls for one fact, with only one of them real.

This is a change in kind. `ScheduleRule.maxDaysPerWeek` is a pure quota today
and `isRestDay` only asks whether the week's allowance is spent — the app has
no notion of *which* days at all. Add `ScheduleRule.trainingDays` and that
check becomes a weekday lookup.

It also removes an inconsistency rather than adding one: fixed programs
already declare specific weekdays, so having flexible programs think in
counts left the two halves of the model speaking different languages.

Two consequences:

- **`PlanSlot.dayOfWeek` is a calendar weekday**, not an offset from the
  enrollment start. The two can't coexist — a Mon/Tue/Thu/Fri program is
  meaningless if week 1 begins on a Wednesday. Program weeks therefore align
  to calendar weeks, matching `getWeekRange`'s existing Mon–Sun.
- **`resolveSlotForDate` gets simpler**: full weeks elapsed since the start
  date's week, then a weekday lookup. No modulo arithmetic. Starting
  mid-week gives a short first week, whose earlier days fall back to Just
  WODs like any other pre-start day — which is why the date picker marks
  Mondays.

`PlanSlot.priority` now does real work here: a flexible program authored for
5 days and run at 3 assigns its highest-priority slots to the days the
athlete picked, in week order.

### Training days are a plan, not a lock

A calendar on its own would lose what the quota was good at — miss Wednesday
and Wednesday is simply gone. The makeup rule keeps the predictability and
gives the forgiveness back: **the week stays the unit of completion.**
Training days say when the app expects you; they don't say when you're
allowed.

- Miss Wednesday, and Thursday — a rest day — offers *"Train anyway, you're
  1 short this week."* Doing it counts toward the week.
- Know Friday won't happen, and Thursday offers to pick up Friday's session
  early. Same mechanism, opposite direction.
- End the week still short and **nothing rolls over.** The week resets clean.

The no-rollover rule is deliberate. Carrying missed sessions forward
compounds debt and turns the app into something the athlete is behind on,
which is the opposite of celebrating every completed session.

Mechanically this is small: `isRestDay` still answers "is today a scheduled
training day?", and the rest-day screen gains one affordance, enabled while
the week's completed count is below the week's session count. The quota
returns as the *measure*; the calendar is the *expectation*.

For Just WODs there is nothing to sequence — any day can be a WOD day. For a
program it reframes the week slightly: a program week is a **set of sessions
to finish this week**, expected on particular days. Miss Wednesday's session,
do it Thursday, and Thursday's own session shifts to Friday within that week.

### Fixed schedules opt out

Makeup applies to Just WODs and flexible programs only. A fixed program's
days *are* the program — Pull-Up Builder is Mon/Tue/Thu/Fri because heavy
pull days want 48 hours between them, and allowing Thursday and Friday to
compact into Saturday and Sunday would defeat the reason the schedule was
fixed at all.

So on a fixed program a missed day is missed, and the program screen says so
plainly when the athlete enrolls rather than at the moment it bites:

```
FLEXIBLE / JUST WODS
  missed Wed → "Train anyway, 1 short this week"

PULL-UP BUILDER (fixed)
  missed Thu → "Thursday's session is missed.
                Next up: Friday, Pull Strength."
```

### Length scales by repeating the core block

`expandPlanWeeks(weeks, chosenWeeks)` returns exactly `chosenWeeks` entries:
intro weeks in order, core weeks cycled to fill, then peak weeks. When
`chosenWeeks` can't hold intro + peak, drop intro first (a beginner ramp is
more skippable than a peak), then peak. It must not throw.

### Overload comes from the block, not from a multiplier

A repeating core block and "the program gets harder" are in tension: weeks
that repeat verbatim escalate nothing. The resolution needs no schema —
**an author who wants escalation writes a core block that already waves**, and
it then repeats as a wave rather than a flat line:

```
core wk A → chin-up 3x5
core wk B → chin-up 4x5
core wk C → chin-up 5x5
   repeats → A B C A B C …
```

No progression rule, no volume multiplier stacking on top of rung
substitution. Sets and reps stay authored per slot, where they can be read
directly.

Two constraints follow. `expandPlanWeeks` must cycle core weeks **in order**,
never shuffled, or the wave is destroyed. And `minWeeks` must be at least
intro + one full core block + peak, so a program can't truncate mid-wave and
end on a light week.

### Date → slot

Keep **lazy** materialization: enrolling writes no assignments, and
`getToday` still creates one row on demand.

```
weekIndex = full weeks elapsed since the start date's week
dayOfWeek = the date's calendar weekday
slot      = expandedWeeks[weekIndex].slots[dayOfWeek]
```

Program weeks align to calendar weeks (`getWeekRange`'s existing Mon–Sun),
because both fixed programs and athlete-chosen training days are expressed in
calendar weekdays. A mid-week start gives a short first week; the days before
it fall back to Just WODs like any other pre-start day.

Both functions are pure (repo style: `apps/api/src/plans/*.logic.ts` with
specs alongside, mirroring `scheduler.logic.ts`), so the same code powers a
preview endpoint that renders a program's whole calendar before enrolling,
with no writes.

## Starting and finishing a program

### The athlete picks the start date

Enrollment asks when the program should begin rather than assuming today —
most training apps don't offer this, and it costs nothing here because
`startDate` already anchors `resolveSlotForDate`.

Bounds do the work a separate "does the new program claim today?" rule would
otherwise have to:

- **Minimum** is today when today's assignment is untouched (`scheduled`),
  and tomorrow once a session is in progress or the day is logged. A start
  date therefore can't destroy work, and today's untouched assignment is
  simply replaced.
- **Maximum** a few weeks out. Default the selection to today, and mark the
  next Monday — programs tend to feel like they start on a Monday.
- Past dates are refused. Retrofitting a program over days already trained
  has no sensible answer.

**The gap before the start date fills itself.** Enroll on Thursday to start
Monday and Thursday–Sunday still need a workout: `getToday` falls back to
default WOD generation whenever `date < enrollment.startDate`. One active
enrollment, a future start date, one rule — no second enrollment, no
status-flipping job, and the partial unique index above still holds.

### Snapshot the rungs at the start

`PlanEnrollment.startingRungs` records every group's rung on the start date.
`SkillLevel` only keeps the current value, so without this snapshot a
finished program can count sessions but can't say what changed — which is
the interesting half.

### Finishing falls back to Just WODs

On the day after the last one, the enrollment completes and Just WODs
resumes, so Today always has a workout. A completion card sits above it:

```
── PULL-UP BUILDER COMPLETE ──
6 weeks · 24 sessions · pull: negative → chin-up

   [ Run it again ]  [ See what's next ]
```

Ignoring the prompt still gets the athlete training — the app never blocks a
workout to ask a question. The rung line comes from diffing current
`SkillLevel` against `startingRungs`.

### Completed programs persist

The card's figures are snapshotted onto `PlanEnrollment.summary` at
completion rather than recomputed, so the record is stable and cheap to read.
A short "Completed" list — program, length, sessions, dates, what moved —
gives the athlete a record of programs finished, each re-runnable:

```
COMPLETED
──────────────────────────────────────────
Pull-Up Builder    6 wk · 24 sessions
Aug 4 – Sep 15     pull: negative → chin-up

Foundations        8 wk · 24 sessions
Jun 2 – Jul 28     squat: air → reverse lunge
```

Scoping every Stats chart to a program stays out of scope. `enrollmentId` on
`DailyAssignment` makes those queries easy whenever it's wanted.

### Settings while a program is active

| Setting | Behaviour |
|---|---|
| `trainingDays` | Written by a flexible program's cadence step. **Overridden** by a fixed program — Settings should show it paused, with the reason, rather than accepting days that silently do nothing. Replaces `maxDaysPerWeek` as what the scheduler reads. |
| `patternCooldownDays` | **Soft only** — a preference inside a slot's filtered pool, so a "pull 3x/week" program doesn't starve itself. |
| `warmupCooldownEnabled` | Unchanged. |
| `autoStopAtCapEnabled` | Unchanged, still snapshotted onto the session. |

`isRestDay(assignedDaysThisWeek, maxDaysPerWeek)` goes away in its current
form: on a program day the slot's `kind === 'rest'` answers it, and on a
Just WODs day it's a `trainingDays` lookup.

## 2. Athlete-owned progression

`SkillLevel` stays. What changes is **who writes it**.

Today `computeRungChanges` infers capability from rounds completed in a
metcon and silently advances or drops a group. The inference is noisy, and the
drop path means a bad Tuesday quietly makes tomorrow easier without asking.

### Substitution is the write path

Tap a movement on the Today plate before starting → see that group's other
members, plus the movement's `fallbackExerciseId` (the no-equipment stand-in,
which exists in the schema today and is currently read only by
`GET /exercises`). Pick one. It applies to **today**, one tap, no modal — the
athlete is about to train, not configure.

### The permanent change is confirmed from something real

If the session was trained at a rung other than the one on record, the
completion screen offers it: *"You did chin-ups today. Make that your pull
movement?"* One tap, dismissible. The rung moves because of what the athlete
actually did — a far better signal than metcon-round inference, and it is
what makes the progression feel like theirs.

### Advancement is demoted, not deleted

`computeRungChanges` stops writing rungs and starts proposing them — "you've
hit 3x8 here three sessions running, ready to try pull-ups?" — offered before
a workout and accepted by swapping. The encouragement survives; the authority
doesn't.

**The drop rule doesn't survive at all.** The app never demotes an athlete;
struggling is answered by swapping down. `HOLD_FLOOR`/`HOLD_FLOOR_SECONDS`
and their branch come out.

`SkillLevel.lastChange` came out of the schema entirely (DN-97). Its writer
went with automatic advancement in DN-7 and the rule that fed it was deleted
in DN-87; its one consumer, the Stats "level up" banner, went with the ladder
in DN-91. Under the reframing it is not merely unused — a preference cannot be
an achievement or a demotion, so no value it could hold would mean anything.

### Completion is what gets celebrated

The positive-feedback moment moves off the rung and onto the session: you
finished the workout. That is the feedback the app owes an athlete, and it
fires every time rather than on the rare session that happens to cross a
threshold.

It also reads better under athlete ownership. A banner announcing that the
app has promoted you is a verdict; a banner marking what you just completed
is a record. And with per-set logging (below) the celebration can say
something specific and true — *"8, 8, 8 — up from 8, 8, 6 last week"* —
instead of a generic "done".

### Consequences elsewhere

- **No onboarding calibration.** Everyone starts with no rung at all and
  sets one in a tap on day one against a real workout — less setup friction
  than asking someone to self-assess in the abstract, and a more honest
  answer. This is also what fixed the rung-0 provisioning problem (see
  below).
- **The resolver is untouched** (`resolveWodForToday`, renamed from
  `scaleWodToCurrentRung` in DN-88). It reads athlete-authored choices instead
  of algorithm-authored ones.
- **Programs need this either way.** A `movements` slot saying "5x3 pull" has
  to resolve to a movement, which requires persisted per-line state whatever
  design wins.

### The provisioning problem this replaced

`user-provisioning.service.ts` used to create every user at rung 0 on all
eight lines — knee push-ups, supermans, air squats, knee planks. Someone who
could already do ten pull-ups got weeks of wrong workouts and had to grind up
through the 3x8 rule to escape. Cheap substitution solves this without a
wizard: the first workout is one tap from correct.

Fixed in DN-86 by deleting the provisioning writes. A new athlete now has no
`SkillLevel` rows, `applyCurrentRung` passes every movement through unchanged,
and the first row is written when they accept the completion screen's offer to
keep what they just trained.

## 3. The `movements` day — where the work is

Prescribed movements with sets and reps. This is the part with no existing
machinery:

- **A third runner.** `WorkoutSession` is clock-shaped (`capSeconds`,
  `roundSplits`, `intervalIndex`). A straight-sets session's state is
  "movement 2, set 3 of 5, resting 90s" — neither `RoundTapWorkout` nor
  `IntervalWorkout` fits, and the session model needs non-clock fields.
- **A new log shape — `WorkoutSetLog`, per set, in its own table.**
  `WorkoutLog.resultType` is `time_seconds | rounds_reps | total_reps`, all
  metcon scores; a sets/reps session has no single scalar result. Store one
  row per set: movement, set index, prescribed count, actual count. See
  below for why per-set rather than a per-movement total.
- **History and Stats.** `workoutLogListItemSchema` requires
  `wodName`/`wodType`/`dominantPattern`, so a non-WOD row needs its own
  shape.

### Why per set, and why a table

A per-movement total (`chin-up: 13`) or a completion flag (`chin-up: done`)
would both be cheaper. Per-set wins because it is the only record that can
show an athlete their own progression, which is the point of the feature:
`3, 3, 3, 2, 2` this week against `3, 3, 2, 2, 1` last week is visible
improvement that a total of 13 vs. 11 blurs and a flag erases. `5, 5, 3` and
`4, 4, 4` are different sessions with the same total — one a strong start
with fatigue, the other even pacing.

It was also going to be what the demoted advancement nudge needed: "three
sessions of clean 3x8, ready for the next rung?" depends on the sets having
been clean, which a total can reach by accident. DN-87 deleted the nudge
instead of building that evidence — the swap panel already shows the next
movement in order, so the athlete can see it without the app ranking them —
and per-set logging stands on the first reason alone, which was always the
stronger one.

The mid-workout machinery already exists in the right shape —
`WorkoutSession.roundSplits` is autosaved on every round tap so a locked
phone never loses progress. Per-set logging is that same discipline applied
to a different session type: an upsert per set tap.

A table rather than jsonb on the session, though. `roundSplits` gets away
with jsonb because a metcon's score collapses to one scalar and nothing
queries across sessions. Per-set data exists precisely to be queried across
sessions — "my chin-up volume over eight weeks" is the payoff — and that is
awkward against jsonb.

### Prescribing by line, not by exercise

A `movements` slot should name the **movement groups** ("pull, 5x3"), not a
specific exercise, so one program fits every athlete and resolves through the
rung the athlete owns. Pinning an exercise stays possible for cases where the
specific variation is the point — a nullable `exerciseId` and a nullable
`line` with a CHECK that exactly one is set.

## 4. Content gap

The WOD library is **11 rows: 3 named, 8 unnamed**, covering only pull (3),
push (2), core (1) and cardio (2) among the unnamed ones — **zero squat, zero
hinge**. A `wod_generated` slot asking for squat emphasis has nothing to pick
today, and a 6-week/5-day program drawn from 8 WODs repeats everything ~4x.

This matters much less than it would have under a WOD-only design, because
`movements` days now carry most program content. But it still gates any
program that mixes in conditioning days. Seed ~20 more unnamed WODs covering
squat and hinge across all four formats.

`docs/plan.md` describes "a template generator that assembles WODs from the
exercise pool" — never built; `generateWodForDate` only reads existing rows.
It stays deferred, and has its own blocker: `Wod.name` is `@unique`, so
generated rows need disambiguated names.

Tracked as GitHub #141, and in Linear as the [Programs and athlete-owned
progression](https://linear.app/regimen-works/project/programs-and-athlete-owned-progression-07bad6d2d79f)
project, with a story per item below.

## Build order

- **Phase 1 — athlete-owned progression.** Substitution UI on Today, the
  post-session confirm, demote `computeRungChanges`, delete the drop rule,
  drop `lastChange` and retarget the Stats banner at workout completion. All
  shipped bar the celebration itself, which is DN-8.
  Ships standalone value, no new models, and settles the principle before
  programs are built on it.
- **Phase 2 — program foundation.** Prisma models + migration (partial unique
  index, the two CHECKs), shared Zod schemas, `expandPlanWeeks` and
  `resolveSlotForDate` with specs. Nothing user-visible.
- **Phase 3 — programs over WOD days only.** Seed Just WODs as a real `Plan`,
  enroll every user, onboarding (program → days → start date → go),
  `pickWodForSlot`, the start-date gap fallback, and the completion card.
  Exercises all the plumbing without needing the new runner.
- **Phase 4 — the `movements` day.** Third runner, `WorkoutSetLog`, History
  and Stats shapes.
- **Phase 5 — content.** Library expansion, then 2–3 real programs.
- **Later** — program editor (GitHub #17), in-program intensity
  progression, the template generator.

## Open questions

Everything that shaped the model is settled. What's left is scoped work,
deliberately deferred:

1. **Program editor** — authoring your own weeks. The same unbuilt work
   already tracked as GitHub #17 and the Linear [Program-Editor
   UI](https://linear.app/regimen-works/project/program-editor-ui-6c6cd0130d56)
   project, and the reason `Plan` is seeded library content for now.
2. **Template generator** — `docs/plan.md` describes one; it was never built,
   and `Wod.name` being `@unique` blocks generated rows until that changes.
3. **Stats scoped to a program** — `enrollmentId` on `DailyAssignment` makes
   it a straightforward query whenever the Stats page is worth revisiting.
