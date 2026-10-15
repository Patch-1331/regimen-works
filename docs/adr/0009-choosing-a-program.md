# ADR 0009: Programs get a tab of their own, switching ends the run, and the code says "program"

**Status:** Accepted

## Context

The glossary has always said the athlete picks a program at signup "and can change it
later". The second half has never been reachable. The only program picker is a step
of the first-run wizard (`SetupPage.tsx`). An onboarded athlete gets back to it only
through the completion card's "See what's next", or by typing `/setup` by hand.

Typing `/setup` exposes a real bug. Setup rewrites the athlete's active
`PlanEnrollment` **in place**, giving the same row a new `planId`, `startDate` and
`weeks`. Every `DailyAssignment` already trained points at that row, so the old
program's days are silently relabelled as the new one's. Nothing records that the old
run existed, or how far it got. A run's `status` is only `active` or `completed`.

Since ADR 0006 removed the seeded first programs, every program except Just WODs is
one written in the editor. The code calls those **routines** (`RoutinesService`,
`/api/routines`, `createRoutineSchema`), and the screens say "routine" too. The
glossary has no entry for the word. Underneath, the tables are `Plan*`, and the domain
logic between them says **program**. That is three words for one row.

DN-132 asked where choosing a program lives after the wizard, and what switching does.
It was settled by grilling on 2026-10-15.

## Decision

**1. Starting a program while a run is active ends that run.**

The old enrollment becomes `ended`, with `endedAt`, and the new program gets a new
enrollment. The days already trained stay attributed to the run they were trained on.
An ended run cannot be resumed. Starting the same program again begins a new run from
week one. A run with no assignments at all is the exception: it is replaced in place,
because there is nothing to relabel.

**2. Choosing and creating programs live in a Programs tab.**

The tab sits between Library and Settings. Top to bottom it holds:
- the current run
- Just WODs, pinned first as the "no program" choice
- the athlete's own programs
- the global library
- New and Paste
- past runs

Library goes back to reference material: Movements and Workouts. Settings gains no
program section.

**3. The screens say "program", never "routine".**

"+ New program", "Your programs", "Paste a program in", "Copy to your programs".

**4. So does the code, from the database to the screen.**

- `Plan`, `PlanWeek`, `PlanSlot`, `PlanSlotMovement` and `PlanEnrollment` become
  `Program*`, through a migration that renames rather than recreates.
- `routine` leaves the API, the routes, `packages/shared` and the web client.
- The export format becomes `"regimen-works/programs"`. The loader still accepts
  `"regimen-works/routines"`, so files already written keep loading.
- Stored row ids are data and keep their values. `DEFAULT_PLAN_ID` becomes
  `DEFAULT_PROGRAM_ID`, still `"plan_just_wods"`.

**5. An ended run leaves a record, not a card.**

The completion card (DN-18) stays a reward for finishing. A run the athlete ended has
no card. It is listed under past runs in Programs, *"Foundations — ended at week 2 of
6"*, next to finished runs. The week it reached is computed from its dates, not stored.

**6. Just WODs ends and starts like any other run, and is never listed.**

There is one rule for every switch, in both directions. Starting Just WODs asks only
for days. Past runs never show a Just WODs run, because the screens already treat it
as the absence of a program to name.

**7. Today follows the run it was trained on.**

If today is untouched (no session started, nothing logged), it is discarded and
belongs to the new run. If a session was started or anything was logged today, it
stays with the ended run, and the new run starts tomorrow at the earliest. The
start-date step offers "today" only when today is free, and the API refuses it
otherwise.

**8. Starting a program reuses the wizard.**

Start runs the wizard's own steps from the one after "program": days → length →
start date → rest pace → confirm. Welcome and equipment are skipped. It posts to the
same `POST /setup`. When a run is ending, the confirm step says so: *"This ends
Pull-Up Builder at week 2 of 6. What you've trained stays in your history."* The
first-run wizard itself is unchanged.

## Reasoning

### Why end rather than pause or overwrite

Overwriting is the bug. A pause would need rules the app has no other use for: how
long a pause lasts, and what resuming a fixed-weekday program after a month means. It
would also make the one-active-run index a lie about what the athlete is doing.
Ending reuses the shape that completing a run already has, a run with a last date,
and keeps history true. If anyone ever asks to resume, it can be added later on top
of `ended`.

### Why a tab rather than a section of Settings or Library

What you follow is the biggest decision in the app. It is a training decision, not
preferences and not reference material. The current run also wants to be visible
somewhere other than as a strip of capitals on Today. Library's existing Routines
section already held creation, so one tab gathers choosing and creating in one place
instead of splitting them between screens.

### Why one word, and all the way down

The difference between a program and a routine was only who wrote the row. Once the
tab is called Programs, a list inside it called "Your routines" asks the athlete to
learn a distinction the data does not have. The same holds for anyone reading the
code: `RoutinesService` writing a `Plan` that `resolveProgramDay` reads is three names
for one thing. This reverses the glossary's earlier *"Do not 'fix' one into the
other"* note about `Plan`. The cost is a table-renaming migration on the only
environment, which is why decision 4 requires renaming rather than recreating, and
why it ships first, before any behaviour changes.

### Why Just WODs gets no exception

The glossary seeds Just WODs as a real program precisely so there is one code path.
An exception for leaving it would relabel every pre-switch Just WODs day as the new
program, which is decision 1's bug, in the one place it would happen most often.

## Consequences

- Delivery is five issues, in order:
  - DN-176 renames the tables and the API's internals.
  - DN-177 renames the contract, `shared` and the web client, and updates the glossary.
  - DN-178 adds `ended`.
  - DN-179 adds the Programs tab.
  - DN-180 adds starting a program from it.
- DN-154 (running a program with no end) waits for DN-180. Before it, an open-ended
  run of a program would have no way out.
- Every query that asks whether a run happened counts `ended` as well as `completed`.
  This includes ADR 0006's "has anyone enrolled?" fork switch. Every query that drives
  a completion card asks for `completed` only.
- Until DN-176 and DN-177 land, the code still says `Plan` and `routine`. Treat those
  names as the old spelling of *program*, not as separate concepts.
- ADRs 0005 and 0006 are left as written. Read their "routine" as *program*.

## What this does not decide

- **Resuming an ended run** where it stopped.
- **Starting a program from anywhere else**, such as a link from Today's program strip
  or from the editor straight after saving. These are doors that can be added later
  without changing this decision.
