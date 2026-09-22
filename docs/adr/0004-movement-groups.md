# ADR 0004: A progression line is an equivalence group, not a ladder

**Status:** Accepted

## Context

`Exercise.line` and `SkillLevel.rung` were built as a ladder (Feature #2): a
movement's rung was its position in a chain ordered by difficulty, and an athlete's
rung was how far up that chain they had climbed.

The app no longer works that way, and mostly never did. DN-86 stopped provisioning
athletes onto a rung, because "provisioning a rung is the app forming an opinion
about someone it has never seen train". DN-88 deleted the inference that took the
higher of two rungs. `logs.service.ts` stopped moving rungs when a result is saved.
The glossary already defines **rung** as "a sort order and a grouping, not a score"
and **SkillLevel** as the athlete's "standing choice … the last thing they picked".

DN-130 then audited every read of `rung` in the codebase and found that the running
code never reads it as a difficulty. Every executable read is a composite-key
lookup (`` `${line}:${rung}` ``), an equality test, or a display sort. There is no
comparison anywhere that means "harder" — no next-rung, no highest-rung-trained, no
direction word rendered from a pair of rungs. The one `>` in the app
(`skill-levels.service.ts`) is a seeded-existence bound, not a difficulty check.

So the ladder survived in three places, all of them prose or defaults: the order the
seed happened to choose, `STARTING_RUNG = 0` and the `?? 0` mirroring it, and a set
of doc comments reasoning in harder/easier terms about code that does not implement
difficulty.

This matters beyond tidiness. **No ability assessment** is load-bearing in this
codebase — the app holds no view of what an athlete can do. A line that is a
difficulty ladder is in permanent tension with that, because the ordering is an
opinion about hardness even when nothing reads it as a score. Naming the thing an
equivalence group removes the tension instead of managing it.

## Decision

**A movement group is a set of movements that accomplish the same thing in a
program, freely interchangeable. Membership is a statement about role, not about
difficulty. An athlete's stored choice is a movement, not a position.**

Concretely:

1. **`progressionLine` becomes `movementGroup`.** Rejected: `equivalenceGroup`
   (accurate but alien to a codebase whose other names are athlete words — the
   ADR-0002 precedent), `swapGroup` (factually wrong at the edges: the legal swap
   set is group members *plus* their fallbacks, so it would make the real swap group
   unnameable), `variantGroup` (collides with the `alt` prose this ADR deletes).

2. **`SkillLevel.rung` becomes `SkillLevel.exerciseId`, a real foreign key.** The
   athlete's standing choice *is* a movement; storing an index into a list says it
   indirectly and costs a permanent fragility.

3. **Stored rung values are resolved once, at migration time**, through the
   `(line, rung)` pair that the seed numbers densely today. Nothing is renumbered,
   because after this there are no numbers left to renumber.

4. **`altExerciseId` becomes `fallbackExerciseId`**, and keeps its own existence.
   It is not the same idea as group membership said twice.

5. **The group enum values are unchanged.** `push_horizontal` names a direction of
   pressing and `squat_loaded` names whether there is external load; neither word
   implies an ordering. The ladder lives in `progressionLine`, `rung`,
   `STARTING_RUNG`, `ladderOptions` and the athlete-visible "not on this movement's
   ladder" — those go. The *membership* of the equipment-split groups does change;
   see §9.

6. **`Exercise.rung` survives as `sortOrder`**: nullable, read only by the two
   display sorts, carrying no claim about difficulty. It stops being printed to
   athletes.

7. **An absent or unusable choice resolves to the group's declared default member.**
   One rule replaces three. The default is an explicit flag in the seed, not the
   first-listed member and not index zero.

8. **The default is a prescription-time answer, never a stored one.** No
   `SkillLevel` row is created, nothing is written, and the athlete overrides it in
   one tap. DN-86's principle is about stored opinions, and it is preserved.

9. **The equipment-split groups merge.** `squat_loaded` and `squat_box` fold into
   `squat`, `hinge_loaded` into `hinge` — minus the members that do not actually
   accomplish the same thing (see Consequences).

## Reasoning

**Why a foreign key rather than a renamed integer.** The cheap option was to rename
`SkillLevel.rung` and keep it. That preserves the hazard the seed itself warns
about — "a stored `SkillLevel.rung` is an index into this list" — which means the
seed can never be reordered or have a member inserted mid-list without silently
repointing every athlete's choice at a different movement. Note that this is a
*stability* argument, not an ordering one: it survives the re-framing completely
intact, which is exactly why renaming alone would have left the real problem in
place under a better word. A foreign key does not merely describe the athlete's
choice more honestly, it deletes the fragility. It also fixes a latent bug by
construction: `skill-levels.service.ts`'s `rung > ceiling` bound admits a gap rung
that resolution then fails to find, unreachable today only because the seed happens
to number densely.

**Why the enum values stay but the groups merge.** DN-84 justified `squat_loaded` as
a separate line on two grounds: "a goblet squat is not harder than a pistol", and
inserting one mid-ladder would renumber the rungs above it. The first was already
void — nothing in the code can tell whether A is harder than B, so there is no
comparison to be wrong. The second is void as of this ADR, because there are no
stored numbers left to renumber.

DN-115 then split `squat_box` and `cardio_rope` out for a different and better
reason: an athlete *off* a group is offered only the bodyweight fallback, so someone
who owned a rope but could not yet do double-unders was handed high knees — the app
taking away gear they actually have. That is a real problem, but the split is a
workaround for it, not a fix. One group holding air squat *and* goblet squat *and*
box step-up serves DN-115's goal better than the split does: the swap panel offers
everything the athlete's equipment supports, which is what it wanted in the first
place.

So the reason the groups were split turns out to be a reason to merge them, and the
merge is nearly free precisely because of decision 2 — changing a movement's group
no longer disturbs a single stored choice.

**Why `alt` survives.** If a group already holds every interchangeable movement, a
per-movement fallback looks redundant. It is not, on three counts. A group has many
members and membership is symmetric; `altExerciseId` is exactly one and is
many-to-one (one alternative stands in for several movements). An alt carries a
guarantee a member does not — it needs no equipment, enforced at write time in three
places. And decisively: every member of `squat_loaded` needs equipment, so the
fallback must point *outside* the group. A rule that says "pick any performable
member" has no answer when the whole group is unperformable at once, which is the
case the field was built for.

The two concepts are joined at exactly one place — `assertLegalTarget` flattens
members and their fallbacks into a single legal swap set — and that flattening is
about what the athlete may *choose*, not about what the resolver falls back to.

**Why a declared default rather than no default.** A program row names only a group
(`{ line: 'pull', sets: 5, reps: 3 }`); it never names a movement. So the
prescription path has nothing to pass through, and something must pick a member or
the row is dropped. The purest reading of "no ability assessment" would be to make
the athlete choose before anything is prescribed, but that blocks a first workout
behind a form and still needs something to fill the row meanwhile. A declared
default is the opinion the code already had — it was just spelled `0` and therefore
unreviewable. Writing it down makes it arguable.

**Why this is worth an ADR.** It is hard to reverse (a schema migration and a
vocabulary the whole codebase borrows), surprising without context (the next reader
of `enums.ts` will find DN-84's justification deleted and wonder whether the split
should go with it), and the result of a genuine trade-off. All three tests point the
same way.

## Consequences

- **`squat_loaded`, `squat_box` and `hinge_loaded` disappear as groups.** Their
  members join `squat` and `hinge`. Two members do not come with them, because the
  merge forces the membership question to be answered honestly rather than hidden
  behind an equipment label: the **dumbbell thruster** is a squat *and* an overhead
  press, so prescribing it into a squat slot silently doubles an athlete's pressing
  volume on a day that already has a push slot; and the **box jump** is plyometric,
  so "3×8 squat" performed as box jumps is a different session. Both leave the squat
  group rather than being smuggled into it.
- **The resolver does not change.** `applyRememberedChoice`,
  `attachPrescribedExercises`, `applyEquipmentAvailability`, `applySubstitutions`,
  `assertLegalTarget`, `proposeRungChanges` and `rungChangesOver` are already
  written against identity-within-a-group. They change shape (a key becomes an id),
  not behaviour.
- **Three code paths stop disagreeing.** `prescription.ts` defaulted to zero,
  `enrollment-summary.logic.ts` defaulted to zero, and `applyRememberedChoice`
  passed the authored movement through — three answers to one question. All three
  now resolve through the group's default, except the completion card, where an
  absent choice means *the group did not move* rather than *moved from the default*;
  the old `?? 0` invented a change that never happened.
- **A stale choice is no longer silently destructive.** Today an archived movement
  makes the prescription path **drop the row**, so a program day quietly loses a
  movement. It now resolves to the default, and the stored row is left alone so an
  unarchive restores the athlete's preference for free.
- **The number stops reaching athletes.** The library row printed "Squat · Loaded ·
  rung 2"; a display index is not information an athlete needs, and printing it is
  what made it look like a grade.
- **Delivered in three issues, split at whether a change can alter what an athlete
  is given.** DN-134 is this ADR, the glossary, and the renames that are already
  true; a second issue replaces `SkillLevel.rung` and lands the default member and
  the stale-choice rule; a third does the merge, and depends on the second because
  the merge is only free once stored choices point at movements.
- **`SkillLevel.rung` is deliberately left untouched by the first of those**, rather
  than renamed and then replaced, which would be two migrations on one column for
  nothing. Between the two the codebase says `movementGroup` while `SkillLevel`
  still stores a bare integer. That intermediate state is honest, and this ADR is
  what makes it legible to anyone who reads the code in between.
- **The migration cost is nominal**: the app has one athlete today. The argument for
  the foreign key is a design argument, not a data-safety one, and it should be read
  that way if it is ever revisited.
