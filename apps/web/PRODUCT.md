# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Minimal-equipment training generalists: people who want structured,
CrossFit-inspired training but work out with only bodyweight plus a
pull-up bar (no gym membership, no equipment stack). They're doing this
at home, on the road, or anywhere they don't have access to a gym, and
they want a session short enough (≤30 min) to fit a normal week. They
span a wide range of ability — someone who can't yet hang from a bar and
someone doing strict pull-ups are both in scope, and both should get
workouts that fit them on day one.

## Product Purpose

Regimen Works runs a training program. It decides what each day's session
is, runs a live tracker for it, logs what actually happened, and reflects
progress back over time. Success is a user who opens the app, gets a
session that fits where they are without planning it themselves,
completes it with the tracker, and watches their own progression build.

## Positioning

Two things separate this from a workout generator.

**It programs, rather than shuffling.** A program decides each day —
either a prescribed movement session (sets, reps, rest) or a WOD chosen
under real training rules: a cooldown before a dominant movement pattern
repeats, formats alternating between AMRAP/For Time/EMOM/Tabata, every
bar movement backed by a documented no-equipment substitute, everything
inside a time cap. The default program, "Just WODs", is exactly today's
behaviour — the engine picking a varied workout each day — so choosing no
program is itself a choice the app supports rather than a gap.

**The athlete owns their level, not the app.** Every movement sits on a
movement groups, and the athlete sets where they are on it by swapping a
movement before a workout — because they've gotten stronger, or because
their shoulder hurts, or because there's no bar in the hotel room. The
app suggests moving up when the numbers support it and never moves
anyone down. Progression is something the user does, not something the
app decides about them.

## Operating Context

First run: pick a program (or Just WODs) → set days per week, unless the
program fixes its own schedule → pick a start date → go.

Core loop: Today (the day's session, with any movement swappable before
starting) → Start (a live stopwatch + tap-to-log round tracker for
AMRAP/For Time, an auto-advancing interval timer for EMOM/Tabata, or a
set-by-set tracker with rest timers for a prescribed movement session —
all autosaved as they go, with sound and vibration cues) → Log Result
(pre-filled from the tracked session, editable) → History/Stats (past
sessions, PRs, progression). Finishing a session is celebrated every
time, not only when something advances.

Postgres-backed API behind Clerk auth, runnable on localhost and deployed
for real use. Architected so the same shared schema layer
(`packages/shared`) can support a future React Native mobile client
without a rewrite.

## Capabilities and Constraints

- Bodyweight + pull-up bar only; no weighted/equipment-heavy movements.
- Every WOD fits a 30-minute time cap. Prescribed movement sessions are
  untimed — worked at the athlete's own pace, with rest between sets.
- WOD formats: AMRAP, For Time, EMOM, Tabata. All four have a live
  tracker; EMOM/Tabata's auto-advancing interval timer has shipped.
- Accounts are Clerk-backed and sign-up is invite-only.
- Programs are seeded library content — there is no program-editor UI
  yet, so users pick from the list rather than authoring their own.
- The app never lowers an athlete's level. Advancement is offered as a
  suggestion; moving down is always the athlete's own choice.
- Terminology: "WOD" (workout of the day), "program", "AMRAP", "For
  Time", "EMOM", "Tabata", "straight sets", "dominant movement pattern",
  "movement groups", "rung", "time cap", "PR".

## Evidence on Hand

- `docs/design/programs.md` — the design for programs, athlete-owned
  progression, and prescribed movement sessions. The source of truth for
  everything above that isn't built yet.
- `docs/plan.md` — original v1 scope, domain model, and roadmap. Predates
  the program design; where the two disagree, the design doc wins.
- `apps/api/prisma/seed.ts` — the real content the app ships with: 51
  exercises (39 training movements across eight movement groups, plus
  12 tagged for warm-up/cool-down) and 11 WODs. Known gap: of the 8
  unnamed WODs, none are squat- or hinge-dominant, so the library can't
  yet fill a program day asking for those patterns.
- `apps/web/src/index.css` and `apps/web/DESIGN.md` — the design
  direction is committed and documented ("Nixie Laboratory Counter":
  near-black steel-and-glass chassis, one warm nixie-orange glow for
  every live value, engraved warm-gray for fixed labels, JetBrains Mono
  digit banks, Rajdhani display). Treat this as the established visual
  language, not a starting point.
- The brand assets are the name **Regimen Works**, which is the page
  title, and the favicon — a nixie tube seated on an engraved socket,
  drawn from the design system above. No other logo or marketing copy
  exists.

## Product Principles

1. The app decides what you do; you decide how hard it is. No daily
   planning burden, and no verdict about your capability handed down
   from behind your back.
2. Every scheduled session respects real training constraints (time cap,
   weekly frequency, movement-pattern cooldown, no-equipment
   substitutes) — programming integrity over novelty.
3. The live tracker is the moment of truth: fast, low-friction, and
   reliable (autosaved as you go) since it's used mid-workout, not at a
   desk. That holds for all three trackers.
4. Logging should never duplicate work already captured live — results
   are pre-filled from the tracked session, not re-entered from scratch.
5. Finishing the workout is the thing worth celebrating. Positive
   feedback fires on every completed session, not only on the rare one
   that crosses a threshold.
6. Never block a workout to ask a question. Prompts and choices sit on
   top of the day's session; ignoring them still gets you training.
