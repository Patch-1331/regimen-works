# ADR 0007: The exercise library comes from free-exercise-db, and substitution matches by muscle

**Status:** Accepted

## Context

The library is 64 exercises written by hand in `exercise-seed.ts`. Each one carries
a name, a pattern, a movement group, its equipment and, where every member of its
group needs kit, a `fallbackExerciseId`. That is enough to prescribe a program day,
and it is not enough to do the thing the app exists for: decide what the athlete
does, with the equipment they actually own.

Two limits show up as soon as an athlete's kit and a prescription disagree.

- **The swap panel offers only a group's stored members.** ADR-0004 made a group
  the full list of interchangeable movements, so a group is only as good as the
  person who filled it in. An athlete with a bench and a barbell is offered nothing
  that needs a bench, because no group was ever written to hold one.
- **An unperformable movement has exactly one way out.** `applyEquipmentAvailability`
  falls back to `fallbackExerciseId` or leaves the movement in place. There is no
  third option, and nothing in the library knows that a dumbbell floor press and a
  push-up work the same muscles.

DN-157 tried to grow the library by importing
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense, over
800 exercises, each with primary and secondary muscles, force, mechanic, level,
category and equipment) and then sorting the imports into groups by hand, one group
per issue (DN-158 to DN-163). That makes every import wait on a person deciding
which group it belongs to, and for many the honest answer is "none of them" or "two
of them". The dataset already holds what the groups were being used to approximate — which muscles a
movement works.

The decisions below were made with the project owner on 2026-10-11 and are
recorded in the Linear project **Exercise library**.

## Decision

**free-exercise-db is the base of the exercise library. When an athlete cannot do a
prescribed movement, the scheduler finds a replacement by muscle, not by group.
Groups stay, but only as a slot's identity and the key for the athlete's remembered
choice.**

### Data

1. **The dataset is pinned and checksummed.** `dist/exercises.json` at commit
   `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5`, sha256
   `5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf`, committed to
   the repository as-is. The import refuses a file whose checksum differs, as
   DN-157's draft already does. Moving to a newer commit is a deliberate change with
   its own review, never a side effect of a build.

2. **Images are never imported.** The dataset ships a photograph per exercise, and
   their provenance is unstated, so their licence is unknown. The Unlicense covers
   the JSON. The import neither reads nor copies an image path.

3. **The library comes from three committed files, read by one import.**
   - **the dataset**, as above;
   - **the app's own exercises**: the 49 existing exercises with no dataset twin
     (double-unders, burpee, hollow hold, toes-to-bar…), written in the dataset's
     own format, so one reader handles both;
   - **a curation file keyed by exercise id**: corrected equipment, group membership
     and group defaults, hand-written fallbacks, and the left-out list.

   The import replaces the hand-written `exercise-seed.ts`. It keeps DN-157's
   checksum check, name matching (`nameKey`), bar detection (`HANGS`) and
   internal-terms check (`SCHEMA_WORDS`), and deletes the rest of the draft.

4. **Every exercise has a stable id, and the import matches on it.** The id is the
   dataset's own (`Butt_Lift_Bridge`), or one in the same form for the app's own
   exercises. The name becomes a label that can change; today's seed upserts by name,
   which is what makes a rename destructive.

5. **The 15 existing exercises with a dataset twin take the dataset's name
   (sentence-cased) and instructions, renamed in place.** Their rows keep their
   primary keys, so logged sets, remembered choices, WOD movements and program slots
   keep pointing at them. The pairing of each existing exercise with its twin is a
   reviewed list, not a fuzzy match at import time.

6. **Level — beginner, intermediate, expert — is a fact about an exercise, used for
   one rule only: an automatic swap is never harder.** See the Reasoning for how this
   stays inside ADR-0004's "no ability assessment".

### Equipment

7. **Nine items join the five in Settings:**

   | Item | Covers |
   | --- | --- |
   | Barbell | the EZ bar too; plates are assumed |
   | Bench | |
   | Dip bars | |
   | Resistance bands | |
   | Medicine ball | |
   | Stability ball | |
   | Foam roller | |
   | Gym machines | cable and machine, as one switch |
   | Suspension trainer | rings or TRX |

8. **Kit the dataset hides is tagged by rule and checked by hand.** The dataset names
   one piece of equipment per exercise, so a bench press is "barbell" and a dip is
   "body only". A rule adds the bench, the bar or the dip bars the movement plainly
   needs; the curation file corrects what the rule gets wrong.

9. **About 35 specialist exercises stay out for now**: strongman, sleds and the
   prowler, chains, heavy bag, sledgehammer, battle ropes, neck harness, trap bar,
   wrist roller, ab roller and balance board. The curation file lists them by name.
   Any of them can return later, together with the catalog item it needs: adding the
   item and deleting the names from the list is the whole change.

### Substitution

10. **When an athlete cannot do a prescribed movement, the scheduler tries, in
    order:**
    1. their remembered choice;
    2. a hand-written fallback;
    3. the best muscle match they can perform;
    4. if no candidate clears a minimum score, nothing — and it says there is no good
       substitute, rather than handing over something unrelated.

    The seam is `applyEquipmentAvailability` in `scheduler.logic.ts`, which today
    stops after step 2. A muscle-matched swap carries the existing `equipment`
    substitution reason: to the athlete it is the same event, the app standing down
    from a movement they have no gear for.

11. **A muscle match must pass three hard filters:**
    - the **same unit** — a timed hold never stands in for a rep count, or the
      prescription's number would change meaning;
    - the **same category class** — strength never becomes a stretch or a jump;
    - **never a harder level.**

12. **Candidates that pass are scored on:**
    - the same prime mover;
    - overlap in primary and secondary muscles;
    - the same force (push, pull, static);
    - the same mechanic (compound, isolation).

    Ties are broken deterministically, preferring hand-curated exercises — the app's
    own and those with a curation entry — so the same day always yields the same
    plate. The weights, the category classes and the minimum score are DN-169's to
    set, with tests that pin each one.

### The swap panel

13. **The panel's options are computed from the whole library**, not read from a
    group's stored members:
    - **the main list**: equivalent movements the athlete owns the kit for, at the
      same level or easier — hand-curated first, then by match score, capped at about
      eight;
    - **"Harder options"**: equivalent movements at a harder level, under their own
      heading;
    - **"Needs equipment you haven't listed"**: collapsed by default. Picking one
      counts for that day only; it is not remembered as the athlete's choice.

### What groups become

14. **A movement group is a slot's identity and the key for the athlete's remembered
    choice — no longer the list of choices.** A program row still names a group, the
    group's declared default (ADR-0004 decision 7) still fills it for an athlete who
    has not chosen, and `SkillLevel` still stores one movement per group. What a
    group stops being is the swap panel's source. This amends ADR-0004, whose
    decision 1 and §"Why `alt` survives" treat the group's members (plus their
    fallbacks) as the legal swap set.

## Reasoning

### Why level stays inside "no ability assessment"

ADR-0004 removed the ladder because an ordering is an opinion about hardness, and an
opinion about hardness tends to become an opinion about the athlete. Bringing in a
dataset field called *level* looks like walking that back. It does not, for three
reasons, and each is a rule the code must keep.

- **It describes an exercise, never a person.** No athlete has a level. Nothing
  stores one, infers one from a log, or compares an athlete to an exercise. "Expert"
  is a property of a muscle-up the way "needs a bar" is.
- **It is read in exactly one place: an automatic swap is never harder.** When the
  app replaces a movement on its own, without asking, it must not hand over one the
  source itself calls harder. That is the app declining to form an opinion — the
  conservative choice when it knows nothing about the athlete — not forming one.
- **The athlete can always go harder themselves.** "Harder options" sits one heading
  down in the swap panel. The heading names the exercises, and never the person: it
  is not "you're ready for" and it is not "level up". The app decides what you do;
  you decide how hard it is.

### Why match by muscle rather than by group

A group answers "which movements fill this slot" by enumeration, so it can only ever
offer what someone wrote into it. Muscle data answers the same question by
description, for every exercise at once, including ones nobody has looked at. The
hand-written fallback stays ahead of the matcher because a person who chose one knew
something the scoring does not; the matcher is what makes the long tail usable
without a person.

The minimum score, and saying "no good substitute" below it, is the honest end of
the order. A matcher that always returns something will eventually return a calf
raise for a pull-up, and the athlete would reasonably read that as the app's
recommendation.

### Why one switch for gym machines

The dataset splits "cable" from "machine", but athletes do not: someone training at
home has neither, someone at a gym has both. Two switches would be two questions in
Settings whose answers almost always agree, and a wrong answer to either would
quietly hide a large share of the library.

### Why the 15 take the dataset's name and instructions

Keeping the house names would mean a curation entry overriding the dataset on every
one of them forever, and two vocabularies for the same exercise in one library —
which is exactly the drift `nameKey` was written to catch. Renaming in place costs
nothing an athlete has: every reference is by primary key.

## Consequences

- **`exercise-seed.ts` is deleted** once the import lands (DN-167), and with it the
  upsert-by-name. The import upserts by stable id, so a rename no longer makes a new
  row.
  *Corrected 2026-10-17:* this once said the overwrite of an admin's edits went with
  it. It did not. The import still writes every field of a seeded row, and un-archives
  it, on every deploy. [ADR 0010](0010-files-own-seeded-content.md) settles it: the
  files own the seeded rows, and the admin routes refuse to change them.
- **`Exercise` gains muscles, force, mechanic, level, category and a stable key**
  (DN-165). Level must not be confused with `SkillLevel`, which despite its name is
  the athlete's standing choice; the glossary has to say so before the code does.
- **The equipment enum grows from five to fourteen** (DN-166). Every existing athlete
  owns none of the new items until they say otherwise, so the first scheduler run
  after the import treats every new bench, barbell or machine movement as
  unperformable for everyone.
  That is the correct default, and it is why the swap panel's collapsed heading
  exists.
- **The scheduler can now return "no good substitute"**, a result it had no way to
  express before. Every surface that renders a plate has to say something honest for
  it.
- **`assertLegalTarget` changes meaning.** Its legal set is group members plus their
  fallbacks today; it becomes whatever the panel would offer, including the collapsed
  heading.
- **`Exercise.sortOrder` loses its reader.** The panel orders by curation and score,
  not by the group's stored order. DN-183 then deleted the column, and the one list
  of a group's members left, on the Stats page, is by name.
- **Delivered in seven issues**, in order: this ADR (DN-164); schema (DN-165) and the
  equipment catalog (DN-166); the import of today's 64 (DN-167); the rest of the
  dataset (DN-168); muscle-match substitution (DN-169); the swap panel (DN-170); the
  library page (DN-171). DN-158 to DN-163, the per-group curation issues, were
  canceled.

## Rejected alternatives

- **The exerciseapi.dev API.** Its terms do not allow cached data to
  be re-served to other users, which is what a multi-tenant library does with every
  row. A pinned, public-domain file is something the app can own.
- **Sorting the imports into groups automatically.** A rule that maps muscles to a
  group is the matcher with its answer frozen into the schema, and it would still
  need a human to fix the cases where an exercise fits two groups or none. Matching
  at swap time keeps the data and the decision apart.
- **Groups curated by hand** (DN-158 to DN-163). A person reading hundreds of
  imports to place each one, repeated whenever the dataset moves. The work scales with the library; the matcher does not.
- **Keeping the house-style instructions on the 15.** See the Reasoning: it means a
  permanent override per exercise and two vocabularies in one library, to preserve
  prose nobody depends on.

## What this does not decide

- **The matcher's numbers** — weights, category classes, the minimum score. DN-169.
- **The exact pairing.** Whether any of the 49 does have a dataset twin after all,
  and whether near-duplicates (Air squat beside "Bodyweight Squats") merge. DN-167,
  with the project owner's review. (That pair has been settled: they merged, and
  the warm-up became an entry pointing at Air squat. ADR-0008, DN-172.)
- **Re-admitting the specialist kit.** Decision 9 makes it cheap; nothing here
  schedules it.
