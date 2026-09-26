# ADR 0005: A prescription records what a source said, and the athlete sets the pace

**Status:** Accepted

## Context

`PlanSlotMovement` was built for one authoring act. Every `Plan` in the app is
seeded — written in TypeScript, by the app's own author, with a compiler checking
it — and the column shapes assume that author: `reps` is a single non-null `Int`,
and `restSeconds` is non-nullable and undefaulted on purpose, because "rest is part
of the prescription rather than a detail an author forgot, and 0 says 'straight
through' out loud."

DN-131 measured the model against a routine nobody in this project wrote: five
training days, 25 movements, transcribed from outside. The result is the evidence
base for this ADR, and it does not describe a vocabulary problem so much as an
authoring one.

- **12 of the 25 prescriptions are rep ranges** — 8–10, 12–15, 5–8, 15–20. The
  largest single shape in the routine, and unwritable in a column that holds one
  integer. 11 are fixed, 6 of those the same `5 × 5`.
- **The source states rest 0 times out of 25.** Transcribing it into the current
  model means inventing 25 numbers nobody wrote down.
- **1 prescription is "until failure"**, which has no count at all.
- **0 prescriptions state a load.** The routine names "Barbell Squat (5 sets, 5
  reps)" and no weight, anywhere, for any movement.

Two of the five gaps DN-136 opened with turned out not to be gaps, and are recorded
in **Already solved** below so that a later reader does not rediscover them.

The question underneath all of it is which authoring act the editor serves. The
answer is **both**: an athlete designing a routine from the app's own movements, and
an athlete handing the app a routine from elsewhere. Neither is primary. That is
what makes the tension real rather than a matter of taste — the two acts have
opposite tolerances for an unstated field.

## Decision

**1. Strictness lives in the editor, not in the column.**

One table. The columns loosen to what an honest ingest can produce; the design
editor refuses an incomplete row as a UI rule.

The constraint this replaces was defending authorial *intent*, and intent is an
editor-layer concept. A `NOT NULL` column cannot tell a considered `0` from a
forgotten one either — it only refuses to store the absence. Making the column
nullable does not discard the rule; it adds one state the model could not express
and that the evidence says is the common case: **the source did not say.**

**2. The rep count holds three shapes, held apart by a CHECK.**

```
reps       Int?      -- the count, or the bottom of a range
repsMax    Int?      -- the top of a range
toFailure  Boolean   -- no prescribed count at all
```

Exactly three rows are legal, and the migration's CHECK says so:

| shape | `reps` | `repsMax` | `toFailure` |
| --- | --- | --- | --- |
| fixed | set | null | false |
| range | set | set, `> reps` | false |
| failure | null | null | true |

This is the construction the row already uses for `movementGroup` xor `exerciseId`,
whose Zod mirror reads "a prescribed movement names a movementGroup or an exercise
— one of them, not both and not neither."

**Not `repScheme`.** `WodMovement.repScheme` is a *ladder* — 21-15-9, one descending
sequence performed in order, with a CHECK holding `reps = sum(repScheme)`. A range
is not a sequence. `[8, 10]` in that column would mean "do 8, then do 10," which is
a different workout in the same array.

**3. `restSeconds` becomes nullable, and null is not zero.**

`0` keeps meaning "straight through", which is a prescription. `null` means the
source was silent, which is not one. Nothing may quietly convert between them.

**4. The rest an athlete actually trains at belongs to the run, not the routine.**

`PlanEnrollment.defaultRestSeconds`, nullable, set at the single moment the athlete
commits to a routine — authoring it, importing it, or selecting a built-in one —
and editable while it runs.

Resolution is two lines, and belongs in one resolver rather than in the view:

- `enrollment.defaultRestSeconds` if set. It governs the whole run, overriding every
  per-movement value.
- otherwise `movement.restSeconds`, which may itself be null, in which case no clock
  runs.

The enrollment screen may leave the field blank **only** when every movement in the
routine already states a rest. A routine with holes in it makes the field required
— the one question the athlete answers once, rather than 25 answered before they
can train.

**5. A prescription does not carry load.**

DN-85 stands. An imported "Barbell Squat 5×5 @ 225" keeps the movement and drops the
weight, and the editor says that it dropped it.

## Reasoning

### Why the override is total, and why that is not the app overruling an author

A built-in routine specifies rest on every movement, sometimes deliberately — three
minutes after a heavy set is a real instruction. When the athlete sets a flat value
at enrollment, all of it is replaced for that run.

The principle is already written into this schema, on `PlanSlotMovement.substitutedIn`:
"A prescribed movement is swappable for the same reason a WOD's is: **the app decides
what you do, you decide how hard it is.**" Rest is not what you do. Rest is exactly
how hard it is — the same category as a swap, and a smaller decision than one the
athlete is already trusted with. Refusing the override while permitting the
substitution would be the inconsistent position.

The override is silent — the resolved shape does not carry what it replaced. This is
a deliberate departure from the honesty pattern that `prescribedName` / `prescribedId`
follow ("an app that quietly hands somebody a different movement should at least say
so"). The distinction: those record something *the app* did to the athlete's
prescription. This records something the athlete did themselves, moments earlier, on
purpose. An app that reports your own decision back to you is not being honest, it
is being noisy.

### Why the rest value sits on the enrollment rather than the plan or the user

**Not the plan.** A rest period the athlete chose is not part of what the routine's
author wrote. Keeping it off the plan means a built-in or shared routine never
carries one athlete's pace, and the plan row goes on saying `null` — *the source was
silent* — permanently, to every later reader. DN-133 has not yet settled who can
author a routine or what tier it lands in; putting the value on the plan would quietly
decide part of that.

**Not the user.** One number for every routine is wrong on its face: a 5×5 squat day
wants three minutes and a 15–20 rep accessory day wants forty-five seconds.

**The enrollment**, because it is the one place the three authoring paths converge.
Authoring, importing and selecting are three different acts that share a single
moment — the moment the athlete commits — and that moment is an enrollment in all
three cases. The shape follows `PlanEnrollment.startingMovements`, which is the
existing precedent for a per-run value written once and read whole.

### Why null means "use the routine's own" rather than always carrying a number

A nullable enrollment value is what lets both halves of this decision stand. If the
field were always populated, `PlanSlotMovement.restSeconds` would become a column
nothing ever reads — every deliberate rest interval in every seeded routine kept
only to be ignored — and the honest move would then be to delete it.

Null also produces the better behaviour at the two ends. Selecting a built-in routine
asks the athlete nothing at all, because the routine already knows. Importing one
asks exactly once, because that is where the holes are.

### Why load stays out, on evidence rather than on principle

Every other decision here was driven by fidelity to a source. Load is the one gap
where **there is no fidelity to lose**: across 25 movements the routine states zero
loads. A load field would be built to hold something the only routine ever measured
against this model never says.

Free text is the tempting middle and has the worse failure mode. A weight rendered
next to the reps is a number an athlete reasonably expects to be tracked and charted,
and under DN-85 the answer to "where is my progress on this" is *nowhere*. A field
that invites a question the app has decided not to answer is worse than no field.

A real routine carrying real loads would be grounds to reopen DN-85 — with evidence,
which is how DN-84 came to be reopened by DN-140.

## Already solved

Two of DN-136's five gaps were closed before it was written. They are recorded here
because the ticket asserted otherwise and a later reader will otherwise re-derive
them.

**Time, not reps.** `exerciseUnit` is `z.enum(["reps", "seconds"])`, and
`prescribedMovementSchema` says so: "Count in whatever unit the exercise uses — see
`exercise.unit`, which makes a hold's 'reps' seconds." "Plank, 3 sets, 60 seconds" is
`sets: 3, reps: 60` on an exercise whose unit is seconds, and DN-131 marks Plank as
the one movement in the routine that is **fully covered**.

**Two set schemes for one movement in one day.** The only constraint on the table is
`CREATE UNIQUE INDEX "PlanSlotMovement_planSlotId_order_key" ON ("planSlotId", "order")`
— uniqueness on *position*, not on exercise — and no dedupe exists in the read path
(`sessions.service.ts`, `session.mapper.ts`). "Neutral Grip Pull Up (1 set, 10 reps) &
(2 sets, until failure)" is two ordinary rows at consecutive orders.

## Consequences

- `WorkoutSetLog.prescribedReps` must become nullable. A set prescribed to failure has
  no prescribed count, and the log is one table downstream of the change.
- `StraightSetsWorkout.tsx` reads `movement?.restSeconds ?? 0` and then tests
  `restSeconds === 0` to decide whether to run a clock. Left alone, that converts "the
  source was silent" into "straight through" in the view layer — the exact silent
  invention the nullable column exists to prevent. It is replaced by the resolver in
  decision 4, tested across all four cases, not by a `??` chain.
- The three-shape rep CHECK is expressible only in migration SQL, like DN-140's partial
  unique index. Prisma's schema cannot state it, so the schema comment must point at the
  migration that does.
- Two fields on a prescription may now be absent — a rep count and a rest interval. Every
  surface that renders a prescription has to say something honest for each, and "invent a
  number" is not available to any of them.
- The design editor carries rules the schema no longer enforces. Where the schema once
  refused an incomplete row, the editor now does, and a regression there fails silently
  as a half-written routine rather than loudly as a constraint violation. Those rules
  need tests of their own.

## What this does not decide

**What "provide the app with a routine from elsewhere" means mechanically** — pasted
text, a link, a photograph of a page, and whether the app parses it or the athlete
fills a form. That is the editor's shape, and it belongs to DN-137.
