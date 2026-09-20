# What the worked example routine needs that the movement vocabulary lacks

Research for **DN-131**, on the "Routine authoring" map. Findings only — nothing
here changes an enum, a seed row, or any production code. The decisions belong to
later tickets.

There was no `docs/research/` directory before this file; `docs/design/` holds
shaped designs and `docs/adr/` holds decisions, and this is neither yet. If the map
would rather these lived in `docs/design/`, moving it costs nothing.

## Sources

- The routine: <https://jackedgorilla.com/tom-hardy-workout-routine/>, fetched
  2026-09-20. Five fixed training days Mon–Fri, Sat/Sun rest, 25 movements.
- The vocabulary: `packages/shared/src/enums.ts` (`movementPattern`,
  `progressionLine`, `equipment`), `packages/shared/src/equipment.ts`
  (`EQUIPMENT_CATALOG`, the athlete-facing descriptions), `packages/shared/CONTEXT.md`.
- The library: `apps/api/prisma/exercise-seed.ts` — 64 seeded exercises, checked
  name by name rather than assumed.

One fact from the source that reframes half of this document: **`bar` is not a
barbell.** `EQUIPMENT_CATALOG` labels it "Pull-up bar" and describes it as
"anything you can hang from with straight arms and feet clear of the floor."
The app has no word for a loadable barbell at all.

A second: **the app does not model load.** `squat_loaded`'s seed comment states it
outright — "a 20 lb goblet squat and a 40 lb one are the same exercise at the same
rung, and nothing in the schema can tell them apart (DN-85)." Every "how heavy"
question this routine asks is out of scope by an existing decision, not a gap.

---

## 1. The 25 movements

"Seeded?" is checked against `exercise-seed.ts`. **Yes** = the movement itself is in
the library. **Near** = a seeded exercise is the same movement at a different load or
implement, so the library can express the *slot* but not the prescription. **No** =
nothing in the library is this movement.

### Monday — Chest and Triceps

| # | Movement | Sets × reps | Seeded? | Nearest seeded / what is missing |
|---|---|---|---|---|
| 1 | Incline Dumbbell Chest Press | 3 × 8 | No | `Dumbbell floor press` is the loaded horizontal press; the incline angle needs a bench |
| 2 | Barbell Bench Press | 3 × 8 | No | `Dumbbell floor press` again; needs barbell + bench |
| 3 | Low Cable Fly | 4 × 8–10 | No | Nothing. No fly, no adduction movement, no cable |
| 4 | Decline Skull Crusher | 4 × 8–10 | No | Nothing. No triceps isolation of any kind |
| 5 | Dips | 4 × 8–10 | **No** | Checked: the library has no "Dips". `Diamond push-up` is the closest push |

### Tuesday — Lower Body

| # | Movement | Sets × reps | Seeded? | Nearest seeded / what is missing |
|---|---|---|---|---|
| 6 | Barbell Squat | 5 × 5 | Near | `Goblet squat` / `Dumbbell front squat` (`squat_loaded`) — same movement, no barbell |
| 7 | Barbell Deadlift | 5 × 5 | Near | `Romanian deadlift` (`hinge_loaded`, dumbbell). A conventional pull from the floor is a distinct movement, not just a load |
| 8 | Dumbbell Step Ups | 3 × 8–12 | Near | `Box step-up` (`squat_box`, rung 0) — bodyweight only; "holding dumbbells" is unsayable |
| 9 | Dumbbell Lunge | 3 × 8–12 | Near | `Reverse lunge` / `Walking lunge` — bodyweight only, same gap as #8 |
| 10 | Leg Press | 3 × 15–20 | No | Nothing, and nothing can be. See §5 |

### Wednesday — Traps and Shoulders

| # | Movement | Sets × reps | Seeded? | Nearest seeded / what is missing |
|---|---|---|---|---|
| 11 | Barbell Row | 5 × 5 | Near | `Dumbbell row` — the library's one horizontal pull, deliberately off any line |
| 12 | Barbell Shrug | 5 × 5 | No | Nothing. No scapular-elevation movement exists |
| 13 | Dumbbell Shoulder Press | 5 × 5 | No | `push_vertical` is bodyweight end to end (pike → handstand); no loaded overhead press |
| 14 | Seated Dumbbell Shrug | 4 × 12 | No | Same gap as #12; the "seated" also implies a bench |
| 15 | Dumbbell Lateral Raise | 4 × 12 | No | Nothing. No shoulder-abduction / raise movement |

### Thursday — Back and Biceps

| # | Movement | Sets × reps | Seeded? | Nearest seeded / what is missing |
|---|---|---|---|---|
| 16 | Weighted Pull Ups | 5 × 5 | Yes* | `Pull-up` (`pull`, rung 3, `bar`). *The weight is unexpressible by design (DN-85) |
| 17 | Underhand Grip Lat Pulldown | 3 × 12–15 | Near | `Chin-up` is the same movement unassisted. The machine's whole point — loading *below* bodyweight — has no expression |
| 18 | Barbell Curl | 3 × 12–15 | No | Nothing. No elbow-flexion movement |
| 19 | Dumbbell Palms-Up Curl | 3 × 12–15 | No | Same as #18; these two are variants of one thing |

### Friday — Upper Focused

| # | Movement | Sets × reps | Seeded? | Nearest seeded / what is missing |
|---|---|---|---|---|
| 20 | Bent Over Barbell Row | 2 × 10–15 & 2 × 5–8 | Near | `Dumbbell row`, as #11. Note the two-prescription shape ("&") is itself unauthorable |
| 21 | Floor Press | 2 × 10–15 & 2 × 5–8 | **Yes** | `Dumbbell floor press`, exactly |
| 22 | Neutral Grip Pull Up | 1 × 10 & 2 × failure | Near | `Pull-up` / `Chin-up`. Grip is a third variant the line has no rung for; "until failure" is also unsayable |
| 23 | Push Press | 1 × 10 & 2 × 5–8 | No | `Dumbbell thruster` (`squat_loaded`, rung 2) is a different movement — a full squat, not a dip-drive |
| 24 | Inverted Row | 3 × 10 | No | Nothing. The `pull` line is vertical end to end; there is no bodyweight horizontal pull |
| 25 | Plank | 3 × 60 s | **Yes** | `Plank hold` (`core_hold`, rung 2, `unit: seconds`). Fully covered |

**Tally.** 2 of 25 are covered outright (#21, #25). 2 more are covered if you accept
that the load qualifier is out of scope (#16, #22). 8 are "near" — the library has the
movement pattern but not at that load or implement. **13 have nothing at all.**

Two things the routine asks for that are not vocabulary gaps but *authoring* gaps,
recorded here so a later ticket does not rediscover them: the Friday "&" shape (two
different set/rep prescriptions for one movement in one session), and "until failure"
as a rep count. Both belong to the `movements` slot kind in `docs/design/programs.md`,
not to this table.

---

## 2. Missing equipment values

The catalog is `bar`, `jump_rope`, `box`, `dumbbell`, `kettlebell`. What this routine
implies, with the movements that force each one:

| Proposed value | Forced by | Note |
|---|---|---|
| `barbell` | #2, #6, #7, #11, #12, #18, #20 | **Distinct from `bar`.** `bar` is described as a hang bar; these seven need a loadable bar. Naming the new one `barbell` next to an existing `bar` is a readability hazard worth a rename discussion — `bar` → `pullup_bar` reads better, but it is written into every seeded pull row and into `DEFAULT_EQUIPMENT` |
| `bench` | #1, #2, #4, #14 | Flat/incline/decline. Collides conceptually with `box`, whose description already offers "a bench" as a step surface. Same object, two jobs: stand on it vs. lie on it. The catalog's generous-description style can hold both, but the overlap should be deliberate |
| `cable` | #3, #17 | A cable stack or pulley. Two movements, and see §5 — a resistance band substitutes for one of them and not the other |
| `leg_press` (or a broader `machine`) | #10 | One movement. Adding a catalog row for a single machine most athletes do not own is the decision §5 is really about |
| `dip_bars` | #5 | Parallel bars, a dip station, or — generously, in the style of the existing descriptions — two sturdy chairs or the corner of a kitchen counter |
| `band` | *not in the routine* | Proposed anyway, because it is the piece that turns two of the three equipment-floor movements into achievable ones. See §5 |

Deliberately **not** proposed:

- **A squat rack.** Implied by #6 but not a separate ownership question in practice;
  fold it into the `barbell` description the way `box` folds in a staircase.
- **A dip belt / weight vest.** #16 wants load on a pull-up, but load is not modelled
  (DN-85). An equipment value for it would be the first piece of gear that changes no
  movement — exactly the kind of member the enum doc says to keep out.

---

## 3. Missing lines, as equivalence groups

Per the map's framing: **a line is a group of interchangeable variants, not a
difficulty ladder.** Each group below is "movements that accomplish the same thing,
any of which can stand in for any other."

| Proposed line | Members (seeded members in **bold**) | Why it is one group |
|---|---|---|
| `push_horizontal_loaded` | barbell bench press, incline dumbbell press, dumbbell bench press, **Dumbbell floor press** | Loaded horizontal press. The floor press is already in the library *deliberately off any line* (DN-113) because it had no peers; this routine gives it three. First case where an existing singleton becomes a group |
| `push_vertical_loaded` | dumbbell shoulder press, push press, barbell overhead press, seated dumbbell press | Loaded overhead press. Kept separate from bodyweight `push_vertical` for the same reason `squat_loaded` is separate from `squat` — a pike push-up and a dumbbell press are not the same question |
| `pull_horizontal` | inverted row, barbell bent-over row, **Dumbbell row**, ring/TRX row | Pull toward the torso. The existing `pull` line is vertical end to end, and `Dumbbell row` sits off-line for the singleton reason again. **This group makes the existing `pull` line's name a misnomer** — it is `pull_vertical`. Renaming it touches stored `SkillLevel.line` strings, so it is a migration question for a later ticket, not a free rename |
| `elbow_flexion` | barbell curl, dumbbell palms-up curl, hammer curl, band curl, backpack/jug curl | Every curl variant in the routine is the same movement with a different grip or implement — the clearest equivalence group here, and the reason the map's framing is right |
| `elbow_extension` | skull crusher (decline, flat, floor), overhead dumbbell extension, bench dip, dips, **Diamond push-up** | Triceps. **Flags a real modelling question:** `Diamond push-up` already sits on `push_horizontal` at rung 2. If a line is an equivalence group rather than a ladder, can a movement belong to two? A diamond push-up genuinely substitutes in both groups. The answer decides whether `line` stays a single scalar column |
| `shoulder_raise` | dumbbell lateral raise, front raise, band lateral raise, plate/jug raise | Loaded shoulder abduction. Nothing in the library is remotely this |
| `shrug` | barbell shrug, seated dumbbell shrug, standing dumbbell shrug, backpack shrug | Scapular elevation. Two of the routine's 25 movements, and they are each other's substitute exactly |

**Two movements that do *not* need a new line**, because the equivalence-group framing
absorbs them:

- **Lat pulldown (#17)** is a member of the existing `pull` group. It is a chin-up with
  the load adjustable, and under "interchangeable variants" that is what group
  membership means. It only looks like a new line under a difficulty-ladder reading.
- **Leg press (#10)** is a member of `squat_loaded` — a loaded knee-dominant press.
  Giving it its own line would say it is a different *kind* of movement, which it is
  not; what is different is the equipment, which the equipment tag already carries.

---

## 4. Missing patterns

The six are `push`, `pull`, `squat`, `hinge`, `core`, `cardio`. Seven of this routine's
movements are isolation work — curls, lateral raises, shrugs, skull crushers — and none
of the six is a natural home for them.

**Recommendation: do not grow the pattern axis. Carry these loosely.**

The reason is in the glossary: pattern is "the coarse axis a WOD loads: `push`, `pull`,
`squat`, `hinge`, `core`, `cardio`. **Drives cooldown scheduling.**" Pattern is not a
taxonomy the app displays or reasons about generally — it is the input that picks a
cooldown. Under that job the assignments are obvious and honest:

| Movement | Pattern | Because the cooldown it wants is |
|---|---|---|
| barbell / dumbbell curl | `pull` | an upper-body pulling cooldown |
| lat pulldown, shrug | `pull` | the same |
| skull crusher, dips, lateral raise | `push` | an upper-body pushing cooldown |
| leg press | `squat` | a lower-body cooldown |

Adding an `isolation` member would be the first pattern that answers no cooldown
question, and `exercise-seed.ts` already has precedent for a loose fit: `Farmer carry`
and `Suitcase carry` are tagged `core` even though a carry is a whole-body movement,
because the pattern is doing a scheduling job, not a classification one.

**The open question this leaves.** If a later ticket wants pattern to also balance
volume across a split — "Wednesday is a pull day, so count the shrugs" — then tagging
lateral raises as `push` will read as a lie and the axis will need to grow. That is a
decision about what pattern is *for*, and it should be made explicitly rather than
arrived at by adding a member. Worth its own ticket if the map wants split-level
balancing.

---

## 5. The equipment floor

The project owner's wish is that a movement be doable regardless of what the athlete
owns. Here is where this routine meets its limit.

### Hard floor — one movement

**#10 Leg Press.** There is no achievable variant. The point of a leg press is a loaded
knee-dominant press with the spine supported and the load off the torso; every
home substitute (goblet squat, front squat, split squat, single-leg squat) reintroduces
exactly the trunk loading the machine removes. It is not "the same thing with less
weight" — it is a different movement. This is the one place in the routine where the
answer is genuinely "you cannot do this without the machine."

### Conditional floors — two movements, both fixable

**#3 Low Cable Fly.** Needs constant horizontal tension at a low angle. No dumbbell
variant reproduces it (a dumbbell fly loads the bottom, not the squeeze) and no
bodyweight variant exists. **But a resistance-band low fly is a true equivalent.** So
this is a floor only as long as `band` is absent from the catalog — adding that one
value removes this movement from the list. That is the cheapest equipment decision on
this page.

**#17 Underhand Lat Pulldown.** Nominally covered by `Chin-up`, and for a strong
athlete it is. But the pulldown's purpose is loading *below* bodyweight, and the library's
only way down from a chin-up is `Negative pull-up` and then
`Supermans + reverse snow angels` — neither of which is a pulldown at 12–15 reps.
**For the athlete who cannot yet chin-up, this movement has no achievable variant**,
which makes it a floor for precisely the athletes the app most wants to serve. A band-
assisted pulldown or a band pull-down from an anchor fixes this too, so `band` covers
both conditional floors.

### Not floors, though they look like it

Recorded because the map should not over-count.

- **#2, #6, #7, #11, #12, #18, #20 (everything barbell).** A barbell is a load, not a
  mechanism. Each has a dumbbell, backpack, or bodyweight equivalent already seeded or
  easily seeded. The `barbell` value from §2 is about *naming the prescription*, not
  about whether the athlete can train.
- **#5 Dips.** Needs parallel bars, but a bench dip between two chairs is the same
  movement. Achievable in any kitchen.
- **#1, #4, #14 (bench angles).** An incline press falls to a floor press, a decline
  skull crusher to a floor skull crusher, a seated shrug to a standing one. The bench
  changes the emphasis, not the possibility.
- **#16 Weighted Pull Ups.** Not an equipment problem at all — the load is unmodelled
  by decision (DN-85). A `Pull-up` is what the app can say, and that is the movement.

### The count the map asked for

**One hard floor (leg press), two conditional (low cable fly, lat pulldown), both
removed by adding a single `band` equipment value.**

That is a better number than the routine's surface suggests, and it localises the
decision: everything except leg press can be made equipment-independent with one new
catalog member. Leg press is the single movement where the app has to choose between
dropping it, substituting something honestly different and saying so, or admitting a
machine-only row exists.
