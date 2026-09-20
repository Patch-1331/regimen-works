# DN-130 — Does the code already treat a progression line as an equivalence group?

Research only. Nothing in this document was changed in the code; every claim cites a
file and a line at the commit this branch was cut from (`df13a00`).

There was no existing convention for research notes — `docs/` holds `adr/`, `agents/`,
`design/` and `plan.md`. This file starts `docs/research/`.

## Short answer

**The running code never reads `rung` as a difficulty.** Every executable read treats
it as one half of a composite key, `${line}:${rung}`, or as an equality test, or as a
sort key for a list the athlete picks from. There is no comparison anywhere that means
"harder" — no `>`/`<` on two rungs, no "next rung", no "highest rung trained", no
direction word rendered from a rung pair.

The difficulty reading survives in exactly three places, all of which are **prose or
defaults, not logic**: the ordering the seed chose within each line, `STARTING_RUNG = 0`
plus the `?? 0` that mirrors it, and a set of doc comments that reason in
harder/easier terms while the code beneath them does not.

So the re-framing is mostly renaming and documentation. There is one genuine behavioural
question (the rung-0 default) and one ordering that is load-bearing only for what the
athlete *sees*, not for what they are given.

---

## 1. Every call site that reads `rung`

Split by what the read actually needs. "Identity" means the read would work unchanged if
rungs were arbitrary distinct labels within a line.

### 1a. Composite-key lookups — identity only

These build or consume the key `${line}:${rung}`. The number is a name. Nothing compares
two of them.

| Site | What it does |
| --- | --- |
| `apps/api/src/scheduler/scheduler.logic.ts:215-227` (`applyRememberedChoice`) | `exerciseAtRung.get(\`${line}:${rung}\`)` — swap the movement for the one the athlete last picked on that line. Pure lookup; a miss passes the movement through (`:224-227`). |
| `apps/api/src/scheduler/movement-resolution.service.ts:109-112` | Builds both maps that feed the above. |
| `apps/api/src/scheduler/movement-resolution.service.ts:235-236` | Same two maps for the prescription path. |
| `apps/api/src/scheduler/scheduler.service.ts:781-784` | Same two maps again, for WOD candidate scoring. |
| `apps/api/src/plans/prescription.ts:57-64` (`attachPrescribedExercises`) | `exerciseAtRung.get(\`${line}:${chosenRung.get(line) ?? STARTING_RUNG}\`)`. Lookup plus the default discussed in §2. |
| `apps/api/src/enrollments/enrollment-summary.logic.ts:20-22, 68-69` (`rungKey`) | The same key, used to turn a rung back into a movement *name* for the completion card. |
| `apps/api/src/enrollments/enrollments.service.ts:212-218` | Builds the `rungKey → name` map. |

**Verdict: identity.** Every one of these needs only "which member of this group".

### 1b. Equality tests — identity only

| Site | What it does |
| --- | --- |
| `apps/api/src/substitutions/rung-changes.logic.ts:62` | `if (fromRung === t.rung) continue` — nothing to propose when the trained rung is already the stored one. |
| `apps/api/src/enrollments/enrollment-summary.logic.ts:66` | `if (fromRung === toRung) return []` — the line did not move. |
| `apps/web/src/lib/progressions.ts:105` | `isChosen: (e.rung ?? 0) === skill.rung` — which option carries the tick. |

**Verdict: identity.** Equality, never ordering.

### 1c. Storage and pass-through — identity only

`apps/api/src/enrollments/starting-rungs.ts:24-28` (snapshot), `.../skill-levels.service.ts:59-64`
(upsert) and `:68-80` (DTO), `apps/api/src/sessions/session.logic.ts:56-61` and `:174-179`
(rung copied into the session snapshot and never read back as a number),
`apps/api/src/exercises/exercises.service.ts:31` (PATCH merge),
`apps/web/src/lib/exerciseDraft.ts:60, 77` (form round-trip).

### 1d. Ordering — sort only

| Site | What it does |
| --- | --- |
| `apps/web/src/lib/swapOptions.ts:64-66` | `.sort((a, b) => (a.rung ?? 0) - (b.rung ?? 0))` — the swap panel's row order. |
| `apps/web/src/lib/progressions.ts:99` | The same sort for the Stats movement-choices panel. |
| `apps/api/src/test-support/seed-e2e-user.ts:152` | `orderBy: [{ line: 'asc' }, { rung: 'asc' }]`, test support only. |

Both production sorts feed a list the athlete reads top to bottom and taps. Neither
selects anything: the *set* of options is `e.line === line && e.rung !== null`
(`swapOptions.ts:65`), which the sort does not change. See §2.

### 1e. The one magnitude comparison in the codebase

`apps/api/src/skill-levels/skill-levels.service.ts:48-57`:

```ts
const maxRung = await this.prisma.exercise.aggregate({ where: {...}, _max: { rung: true } });
const ceiling = maxRung._max.rung ?? 0;
if (rung > ceiling) throw new BadRequestException(...)
```

This is the only `>` on a rung in the app. It is **not** a difficulty check — the doc
comment at `:32-33` says why it exists: "Bounded to a rung that actually has an exercise
seeded for this line, so the scheduler substitution never has to fall back on a missing
rung." It is a cheap existence check that happens to be written as a bound, and it is
*wrong in the same direction the equivalence framing predicts*: a rung between 0 and the
max with nothing seeded at it passes this check and then fails the lookup at
`scheduler.logic.ts:224`. The honest equivalence-group version is a membership test
(`exercise.findFirst({ where: { line, rung } })`), which is strictly more correct and
does not depend on rungs being dense or ordered.

### 1f. Rendering

`apps/web/src/pages/LibraryPage.tsx:29-30` prints `"Squat · Loaded · rung 2"` on a
library row. `apps/web/src/components/ExerciseForm.tsx:185-193` exposes a free numeric
`Rung` input to the library editor. These are the only two places the number itself
reaches a human.

Notably, `apps/web/src/lib/program-summary.ts:13-16` (`rungChangeText`) renders a rung
change as `"pull: Negative chin-up → Chin-up"` — **names and an arrow, no direction
word**. Compare `CompletionCard.tsx:45-47`, which *does* say "up from"/"down from" — but
about set totals, not rungs. The completion card deliberately does not grade a rung move.

---

## 2. Is any ordering load-bearing?

Taking "load-bearing" as the issue defines it: would changing it change what the athlete
is *given*, not just which row is picked.

**No ordering is load-bearing in that sense, with one caveat and one default.**

- **Re-ordering the rungs within a line changes nothing about resolution.** Resolution is
  `exerciseAtRung.get(\`${line}:${rung}\`)` (`scheduler.logic.ts:224`) — a permutation of
  rung numbers changes which *stored* rung points at which exercise, which is a data
  migration problem, not a semantic one. That is exactly the hazard the seed already
  names: "a stored `SkillLevel.rung` is an index into this list"
  (`apps/api/prisma/exercise-seed.ts:89-90`). The concern is *stability*, not *order*.
- **Swap legality ignores order entirely.** `substitutions.service.ts:203-233`
  (`assertLegalTarget`) builds the legal set as every exercise on the line plus each
  one's `altExerciseId`. Any member of the group can be swapped to any other, in either
  direction, at any distance. This is the purest equivalence-group statement in the
  codebase.
- **The display sorts (§1d) are load-bearing only for reading order.** Shuffling them
  changes the order of the buttons, not the set.

### The one thing that is load-bearing: rung 0 as the default

Two independent defaults treat the *lowest* rung as the answer when the athlete has said
nothing:

1. `apps/api/src/plans/prescription.ts:33` —
   `export const STARTING_RUNG = 0`, with `:27-31`: *"The bottom, deliberately. A program
   handing somebody a movement they cannot do yet is how an athlete decides the app is not
   for them, and the rung is the one thing the library can walk upwards on its own."*
   Used at `:60`. This **decides what an athlete with no `SkillLevel` row is prescribed**
   — the definition of load-bearing.
2. `apps/api/src/enrollments/enrollment-summary.logic.ts:35-37` (`rungOf`) —
   `rungs.get(line) ?? 0`, with `:25-33`: *"everyone starts at the bottom of every ladder
   and fixes it in one tap on their first workout."* This decides what the completion
   card claims moved.

Both of these are only defensible under the ladder reading. Under the equivalence
reading, rung 0 is not "the bottom" — it is just the first-listed member, and defaulting
to it is an arbitrary pick dressed up as a safe one. Note the tension already inside the
repo: `user-provisioning.service.ts:16-23` stopped provisioning rung 0 precisely because
*"provisioning a rung is the app forming an opinion about someone it has never seen
train"* — and then `prescription.ts` and `enrollment-summary.logic.ts` reintroduce the
same opinion as a read-time default. `applyRememberedChoice` does not: it passes the
movement through untouched when the line has no rung (`scheduler.logic.ts:221-222`).
**Three code paths, two answers, for the same question.**

---

## 3. What `alt` actually is

**`alt` is an equipment concept in the code, and a difficulty concept in some of the
prose.** The code is unambiguous.

Equipment-only, in the logic:

- `apps/api/src/scheduler/scheduler.logic.ts:244-249` (`isPerformable`) — the sole gate on
  reaching for an alt is `exercise.equipment.every(piece => owned.has(piece))`. No rung,
  no line, no difficulty.
- `applyEquipmentAvailability` (`:303-317`) falls to `altExerciseId` only when
  `isPerformable` is false. An athlete who owns everything never sees their alt.
- The seed guard's whole contract is equipment: `substitute-guard.ts:65-90` only inspects
  exercises with `equipment.length > 0`, and rejects an alt that itself needs equipment
  (`:82-87`). `exercises.service.ts:203-223` and `exerciseDraft.ts:150-159` enforce the
  same rule at write time: *"the fallback is one step, so the alternative has to need
  nothing."* That is an equipment invariant. There is no difficulty invariant on `alt`
  anywhere.
- `apps/web/src/lib/swapOptions.ts:17` states it outright: *"The alternative is offered
  for equipment, not difficulty — labelled, not ranked."* It is rendered with
  `rung: null` (`:83`) — deliberately off the ladder.

Where the prose says otherwise (see §4): `apps/api/prisma/schema.prisma:63` and
`apps/api/prisma/exercise-seed.ts:43-44` both call the alt *"the easier variant."*

**Are `alt` and "another member of the group" the same idea said twice?** Nearly, but not
yet — they differ in three concrete ways the code relies on:

1. **Cardinality.** A line has many members; `altExerciseId` is exactly one
   (`schema.prisma:79`). `offLadderOptions` (`swapOptions.ts:116-144`) exists solely
   because a lined movement has a group to fall back into and an unlined one has only its
   alt.
2. **Direction.** `alt` is many-to-one — `swapOptions.ts:109-111` says the reverse lookup
   is ambiguous *"an alternative is shared between movements (high knees stands in for
   several rope movements)"*. Group membership is symmetric; `alt` is not.
3. **Guarantee.** The alt carries a promise a group member does not: it needs no
   equipment (`substitute-guard.ts:82-87`). "Another member of the group" carries no such
   promise — `squat_loaded` is a line where *every* member needs equipment, which is why
   `exercise-seed.ts:228-230` gives every rung of it its own `alt`.

The nearest thing to a merge is already visible: `assertLegalTarget`
(`substitutions.service.ts:220-227`) treats line-members and their alts as **one flat
legal set**. From the swap panel's point of view they are already the same idea. The
distinction survives only in the resolver, where the alt is the automatic fallback and
the group is not.

---

## 4. Contradictions between stated reasoning and behaviour

This is the part worth carrying forward. In each case the comment argues in difficulty
terms about code that does not implement difficulty.

1. **`packages/shared/src/enums.ts:23-26` vs. the resolver.** The comment justifies
   `squat_loaded` as a separate line with *"a goblet squat is not harder than a pistol,
   and inserting one mid-ladder would renumber every rung above it."* Two arguments, and
   only the second one is real. Nothing in the code can tell whether A is harder than B —
   there is no comparison to be wrong. The renumbering hazard *is* real
   (`scheduler.logic.ts:224` resolves by stored number), and it is a **stability**
   argument that holds identically under the equivalence reading. The DN-84 reasoning is
   therefore correct with its first clause deleted.
2. **`apps/api/prisma/exercise-seed.ts:86-88` vs. `isPerformable`.** *"`push_horizontal`
   is a bodyweight ladder ordered by how much of your own weight you press… It is not
   harder than an archer push-up."* The ordering it describes is real in the data and
   read by nothing except two display sorts.
3. **`apps/api/prisma/schema.prisma:63` and `exercise-seed.ts:43-44` vs.
   `scheduler.logic.ts:244-249`.** Both call `altExerciseId` *"the easier variant"*. The
   code selects it on equipment ownership alone and never on difficulty, and
   `swapOptions.ts:17` says the opposite of the schema comment in the same repo. **These
   two comments are the clearest single thing to fix.**
4. **`apps/api/src/plans/prescription.ts:27-31` vs.
   `apps/api/src/auth/user-provisioning.service.ts:16-23`.** "The bottom, deliberately…
   the rung is the one thing the library can walk upwards on its own" is the calibration
   opinion DN-86 removed, reinstated as a read-time default. Also note "walk upwards on
   its own" describes a behaviour that **does not exist** — nothing in the app moves a
   rung without the athlete confirming it (`logs.service.ts:25-31`: *"Saving a result no
   longer moves any progression rung"*).
5. **`apps/api/src/enrollments/enrollment-summary.logic.ts:29-31` vs. the same.**
   *"everyone starts at the bottom of every ladder"* — the app stopped doing that at
   DN-86. The comment describes the app as it was two issues ago.
6. **`apps/api/src/plans/first-programs.ts:102-104`** — *"an athlete on a harder rung is
   doing harder work at the same 5 reps"*. Prose only; `WAVE` is authored, not computed
   from any rung.
7. **`apps/api/src/substitutions/substitutions.service.ts:231` user-facing copy** —
   *"That exercise is not on this movement's ladder"* — is the one ladder word an athlete
   can actually be shown.

Counter-evidence, i.e. places already written the equivalence way:
`scheduler.logic.ts:195-198`, `packages/shared/src/skill-level.ts:8-11`,
`packages/shared/src/history.ts:8-12`, `apps/web/src/lib/progressions.ts:70-74`
(*"`done` says you graduated past something, `locked` says you are not allowed it yet,
and neither is true of a preference"*), `rung-changes.logic.ts:34-42` (the "take the
higher rung" inference was **already deleted** under DN-88), and
`exercise-seed.ts:582-583` (*"The line is not a claim that everyone should work single →
double"*).

---

## 5. Verdict on scale

**Mostly renaming and documentation. One behavioural decision, and one correctness bug
that the re-framing makes obvious.**

- **Renaming / docs — the bulk.** Every ladder word in a comment, plus the two `alt`
  comments (§4.3), plus the stale DN-86 claims (§4.4, §4.5). The identifiers
  `progressionLine`, `rung`, `STARTING_RUNG`, `swapOptions.ladderOptions`,
  `SkillLevel` and the athlete-visible strings at `substitutions.service.ts:231` and
  `LibraryPage.tsx:30`. All mechanical; the persisted column names are the only place a
  rename costs a migration.
- **Resolution logic — no change required.** `applyRememberedChoice`,
  `attachPrescribedExercises`, `applyEquipmentAvailability`, `applySubstitutions`,
  `assertLegalTarget`, `proposeRungChanges` and `rungChangesOver` are all already written
  against identity-within-a-group. None of them would need a line changed.
- **One real decision to make: the rung-0 default.** `STARTING_RUNG = 0`
  (`prescription.ts:33`) and `rungOf`'s `?? 0`
  (`enrollment-summary.logic.ts:36`) are the only behaviour that requires rung 0 to mean
  "easiest". Under the equivalence framing they need a new justification or a new answer,
  and the app already contains a third answer to the same question
  (`scheduler.logic.ts:221-222` passes through). Worth its own issue.
- **One latent bug the framing surfaces:** `skill-levels.service.ts:53`'s `rung > ceiling`
  bound admits a gap rung that resolution will then fail to find
  (`scheduler.logic.ts:224`). Currently unreachable only because the seed happens to
  number every line densely from 0. A membership check would be both more correct and
  the natural equivalence-group spelling.
