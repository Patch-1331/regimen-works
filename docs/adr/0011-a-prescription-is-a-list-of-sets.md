# ADR 0011: A prescription is a list of sets, each with its own count, load step and rest

**Status:** Accepted. Amends ADR 0005 decisions 2 and 4.

## Context

ADR 0005 gave a program line `sets` and **one** rep shape (fixed, range or failure),
and said "three shapes, and no fourth". Every set on a line got the same count.

The first program the owner wants to build has a movement in reverse pyramid training
(RPT): 6–8, then 8–10 at about 10% lighter, then 10–12 at another 10% lighter, done
that way every session. The line could not hold it. The workaround, three one-set
lines for one movement, keeps the counts but shows as three movements, needs three
swaps, and says nothing about the load.

RPT is not alone. Pyramids, a top set with back-offs, 5/3/1's "5, 5, 5+" and drop
sets all have a different count, load or rest on different sets of one movement.

Settled with the owner on 2026-10-22, in DN-186.

## Decision

**1. A program line is an ordered list of sets.** Each set has its own rep shape, load
step and rest. A uniform 3 × 8 is three identical sets, stored the same way as an RPT
line. There is no second format for "same for all sets": that is a convenience in the
editor, not a fact in the data.

**2. Three shapes, per set.** This amends ADR 0005 decision 2. A set's count is still
fixed, range or failure, held by the same CHECK, now on each set rather than on the
line. There is still no fourth shape: "5+" is a to-failure set, and RPT is three ranges.

**3. A set may state a load step, and never a load.** The step is a signed whole-number
percentage relative to the **previous** set: −10 is 10% lighter, +5 is heavier, 0 is
"same weight" said out loud. Null means the source was silent, and nothing converts it
to 0. The first set never has one. Back-offs are −15, 0, 0.

ADR 0005 decision 5 and DN-85 stand. A load step is an instruction about how to change
the bar, not a number the athlete has to track. Nothing stores a weight, nothing logs
one, and nothing charts one, so the app still owes nobody a progress chart. 5/3/1's
percentages of a training max need a stored reference weight, so they are out; a real
program that needs them would be grounds to reopen DN-85.

**4. An explicit 0 rest between two sets of one line survives the rest pace.** This
narrows ADR 0005 decision 4. The athlete's `defaultRestSeconds` still replaces every
rest above zero. It does not replace a 0, because no rest between drops is what makes
a drop set a drop set: that is *what you do*, which the app decides, rather than *how
hard it is*, which the athlete decides. A null rest still runs no clock. The rule
lives in `resolveRestSeconds` and nowhere else.

**5. The scheme's name is not stored.** The editor offers presets (RPT, pyramid, top
set + back-offs, drop set, 5/5/5+) that fill in the sets, which the author then edits.
After that the line is only its sets. A stored "RPT" label could say one thing while
the sets said another after an edit, and the sets already show what to do. Schemes
belong to the line, so one day can mix an RPT line, uniform lines and a drop set.

## Considered options

- **A second representation for varying lines only**, keeping `sets × shape` for the
  rest. Rejected: two ways to store one fact, which every reader must handle and which
  can disagree (`sets: 3` with five set rows). The schema already refused a multiplier
  for the same reason.
- **Parallel arrays on the line** (`reps[]`, `repsMax[]`, ...), in the style of
  `WodMovement.repScheme`. Rejected: the three-shape CHECK across four arrays is hard
  to read, and `rep-shape.ts` already argues against flattening a shape to store it.
- **Load steps relative to the first set.** Closer to how back-offs are written, further
  from how RPT and drop sets are, which are the common case.

## Not a ladder

A WOD's `repScheme` (21-15-9) is still a different thing: one movement's count per
**round** of a WOD, held to `reps = sum(repScheme)`. A line's sets are straight sets,
each done and rested. Neither replaces the other.

## Consequences

- The sets move to their own table (`ProgramSlotSet`), and a migration expands every
  existing line into identical sets. That ships first, on its own, with no change in
  behaviour (DN-190), because production is the only environment and the migration
  rewrites every program line there. DN-186 builds the feature on it.
- `WorkoutSetLog` copies its prescribed count from the matching set.
- Paste-import merges `&`-joined schemes on one pasted line into one line's sets.
  Recognizing per-set lists, "5+" and "-10%" is DN-189. Scheme names are never guessed,
  for the same reason the matcher never takes the nearest movement.
- Rest-pause and cluster sets would need a level inside a set. They wait for a real
  program that needs them.
