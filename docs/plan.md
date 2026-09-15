# Regimen Works — plan

A program-based training app: set up a plan, pick one from the library, or
just take the day's WOD. Local-first web app for v1, architected to grow
into hosted web, iOS, and Android without a rewrite.

## Scope (v1)

**In:** curated + generated bodyweight WOD library; a 5-day/week,
30-minute-cap scheduler; an in-workout stopwatch + tap-to-log round
tracker (AMRAP/For Time) and an auto-advancing interval timer
(EMOM/Tabata), both with sound + vibration cues and both stopping
themselves at the WOD's time cap unless the athlete turns that off;
logging results pre-filled from the tracked session; history and PRs.
As originally scoped this ran entirely on localhost with SQLite; the
database is now Postgres (#39) and a hosted deploy exists.

**Out (for now):** accounts/auth, hosted deployment, weighted/equipment-
heavy movements, and iOS/Android apps. See the GitHub Project (linked
below) for what's since moved from "out" to active work, like the
program-editor UI.

## Program design

Two sources feed the scheduler: a curated library of benchmark WODs
adapted to stay bar-and-bodyweight-only, and a template generator that
assembles WODs from the exercise pool. Scheduling rules: max 5 days/week,
every WOD fits a 30-minute cap, the dominant movement pattern has a
5–7 day cooldown before repeating, formats (AMRAP/For Time/EMOM/Tabata)
roughly alternate, and every pull-up-bar movement has a documented
no-equipment substitute.

See [`apps/api/prisma/seed.ts`](../apps/api/prisma/seed.ts) for the full
seeded exercise pool (24 movements) and WOD library (11 WODs).

## Domain model

| Entity | Key fields | Purpose |
|---|---|---|
| `Exercise` | pattern, equipment, scalable, altExerciseId | The movement pool; `altExerciseId` is the no-equipment substitute. |
| `Wod` | type, timeCapMinutes, movements, isNamed, dominantPattern, work/rest seconds + intervalCount | A reusable workout definition; the interval fields drive the EMOM/Tabata timer. |
| `ScheduleRule` | maxDaysPerWeek, patternCooldownDays, warm-up/cool-down + auto-stop toggles | Config the scheduler reads, plus the preferences the Settings screen writes. |
| `DailyAssignment` | date, wodId, status | "Today's WOD" — scheduled → in_progress → completed. |
| `WorkoutSession` | startedAt, capSeconds, autoStopAtCap, movements, roundSplits, status, intervalIndex | The live timer's state, autosaved on every round tap and every interval rollover. The clock stops at `capSeconds` — reaching it finishes the session rather than counting on — unless `autoStopAtCap`, snapshotted from the athlete's setting at start, says otherwise. `movements` is the WOD as it resolved for that athlete that day (current rung, then swaps), snapshotted at start too, so history reads what was trained rather than what today's settings would prescribe. |
| `WorkoutLog` | resultType, resultValue, rpe, notes | What actually happened — pre-filled from the finished session. |
| `User` | id | v1 stub; unlocks multi-user/auth later without a migration. |

## Architecture

TypeScript everywhere, npm workspaces monorepo — see
[ADR 0001](adr/0001-tech-stack.md).

```
regimen-works/
  apps/
    api/          NestJS server, Prisma schema + seed, scheduler/generator logic
    web/          React + Vite + Tailwind client
  packages/
    shared/       Zod schemas — DTOs shared by web now, mobile later
  docs/           This plan, ADRs
```

## Roadmap

Tracked in [Linear](https://linear.app/regimen-works) — that workspace is the
source of truth for what's shipped, in progress, and planned. This doc stays
high-level (stack, domain model, architecture) and doesn't try to mirror it.

## Design references

Static mockups of the core loop (Today → Start Workout → Log Result →
History/Stats) were drafted before this scaffold — ask in the project
chat history for the current link, since design canvases live outside
this repo.
