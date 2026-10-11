# ADR 0008: Warm-up and cool-down lists point at exercises; an exercise has no phase

**Status:** Accepted

## Context

The warm-up and cool-down checklists (Feature #63) were built from a column on the
exercise: `Exercise.phase`, one of `warmup`, `cooldown` or null. `getChecklists`
read every row with a phase and picked the ones whose `pattern` matched the day's
WOD, then topped up with null-pattern filler.

One value per row means a movement is checklist content *or* a workout movement,
never both. The library showed the cost as soon as the import (ADR-0007) started
matching our rows to the dataset: "Air squat" (the squat group's default) and
"Bodyweight squats" (the squat warm-up) are the same movement, the dataset has it
once, and only one of our two rows could take its key. The pair was not a one-off.
Many movements belong in both places — an inchworm, a glute bridge, a band
pull-apart — and a column would make each one a second row.

`phase` also did two jobs. It said which list a row was on, and, together with
`pattern`, which day it was chosen for. The second is a fact about the movement's
place on a list, not about the movement: inchworms are a core exercise and warm up
a pull day just as well.

## Decision

1. **A checklist is a list of entries, and an entry points at an exercise.**
   `ChecklistEntry` holds `exerciseId`, `kind` (`warmup` | `cooldown`), the
   `pattern` it is chosen for (null for filler any day can use), optional
   `instructions` of its own, and `ownerId` for the library's two tiers.
2. **`Exercise.phase` is dropped.** Nothing about an exercise says it is a warm-up.
3. **The entry's copy wins when it has some.** The warm-up squat is not the
   working-set squat: same movement, asked for differently. An entry with no copy
   shows the exercise's own steps, which is almost always right.
4. **The checklist response does not change.** Each item is still
   `{ id, name, instructions }`, and `id` is the exercise's, not the entry's, so the
   screens and anything that links from them are untouched.
5. **A movement is on each list at most once per tier.** A compound unique for the
   athlete tier and a partial unique index for the global one, because Postgres
   treats the null `ownerId` as distinct.
6. **The read is scoped twice.** The entry by its own tier, and the exercise it
   names by `libraryVisibleTo` — so another athlete's list never shows, and a
   retired exercise drops off every list without the list being edited.
7. **The migration moves production as it is.** Every `phase` becomes an entry in
   its row's tier with its row's pattern. "Bodyweight squats" folds into "Air
   squat": its entry moves across carrying its warm-up copy, anything that names
   the row is repointed, and the row is deleted. Skipped unless both global rows
   exist.

## Reasoning

### Why a separate list rather than a many-valued column

A `phases[]` column would let a row be on both lists, but the pattern a movement is
chosen for and the copy it is shown with would still be one per row. Both differ
between a movement's uses — Air squat's working-set instructions are wrong for a
warm-up — so they belong on the thing that differs, which is the entry.

### Why the entry carries its own pattern

The checklist picks by the WOD's dominant pattern, and what a movement prepares is
not always what it loads. Keeping the pattern on the entry lets the library
describe the exercise honestly and the list choose it for the day it suits.

### Why the response keeps the exercise's id

Nothing downstream knows about entries and nothing needs to. An entry id in the
response would be a new identifier for the screens to carry around with nothing to
do with it.

## Consequences

- The checklists read the same before and after on production's data, except that
  the squat warm-up is now Air squat with the warm-up copy. A db-spec checks this
  for every pattern.
- The import (DN-167) has one squat row to key, not two.
- **Athletes cannot yet add, remove or reorder entries.** The library editor lost
  its "Warm-up / cool-down" select, and nothing replaces it yet. The tier and the
  scoping are in place for when something does. Until then the global lists are
  edited in `checklist-seed.ts`, and an athlete's own movement can no longer be
  put on a checklist by them. Any athlete-owned tagged rows that existed were
  migrated to athlete-tier entries and still show.

## What this does not decide

- **An editor for the lists.** Who may edit them, and whether an athlete's own
  entries add to the global list or replace it.
- **Which dataset exercises join the lists.** The import may suggest stretches as
  cool-down entries; adding them is a content decision, not this one.
