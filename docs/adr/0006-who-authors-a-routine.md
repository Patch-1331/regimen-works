# ADR 0006: Everyone authors routines through one editor, and nothing is removed, only archived

**Status:** Accepted

## Context

`Plan.ownerId` has modelled two tiers since DN-15 — null is global, set is the
athlete's own — exactly as `Exercise` and `Wod` do (DN-93). But nothing writes a
`Plan` except the deploy seed. `apps/api/src/plans/` has no controller, and every
program in the app is one of two things:

- **Just WODs**, written by `upsertJustWods` under the fixed id `DEFAULT_PLAN_ID`.
  Provisioning enrols every new athlete in it, and the setup picker pins it first.
- **The first programs** — Pull-Up Builder, Foundations, Bar Muscle-Up — written by
  `upsertFirstPrograms`, which upserts them by id on every deploy
  (`render.yaml`, `npm run prisma:seed`).

DN-133 asked who may author a routine, which tier it lands in, and what happens to
the routines already running when one is edited or removed. Two facts in the schema
constrain every answer:

- `DailyAssignment.planSlot` is `onDelete: NoAction`. A training day an athlete was
  handed points at a slot of the routine, so deleting or restructuring a slot
  anyone was assigned either fails or rewrites a day they were already given.
- `PlanEnrollment.plan` has no `onDelete`, so it is Restrict: an enrollment cannot
  outlive the routine it points at.

The precedent for both is DN-25's soft delete on `Exercise` and `Wod`: editing
content people depend on archives, it does not delete.

## Decision

**1. Athletes and admins author through the same editor, under the same rules.**

There is one routine editor and one write path. Its validation — including every
editor-layer rule ADR 0005 moved out of the columns — applies to an admin exactly as
to an athlete. No global routine is ever added by changing data directly: not by
hand, not by seed.

**2. Everything anyone authors is personal. Only an admin can make it global.**

An admin authors their own routines exactly as an athlete does. The editor adds one
admin-only option: make this routine global. It is available when creating a routine
and, later, as a **one-way promotion in place** of an existing personal routine. The
admin's own enrollment and history stay attached to the promoted row.

Nothing is ever demoted. Withdrawing a global routine is decision 5, archiving.
Promotion into a name an existing live global routine holds is refused with the
editor's ordinary "name taken" message.

**3. The seeded first programs are removed, and the global library starts empty.**

`first-programs.ts`, `first-programs.spec.ts` and `first-programs.db-spec.ts` are
deleted, and the seed stops calling `upsertFirstPrograms`. The rows already in
production go by migration, in the same change that introduces archiving:

- a program **nobody ever enrolled in** is deleted outright, weeks and slots with it;
- a program **somebody enrolled in** is archived, so their run finishes and their
  history keeps its name.

On a fresh database the step finds nothing and does nothing. This is a one-off
exception to decision 5, for rows only the seed ever wrote.

**4. Just WODs stays seed-owned, and the editor cannot touch it.**

It is excluded from editing, archiving and export. The admin's list shows it, marked
built in. It is the only program a fresh database has.

**5. Removing an authored routine archives it — every tier, no hard delete.**

An archived routine leaves the picker, so nobody new can start it. A run already in
progress finishes on it unchanged. History and completion cards keep its name. Its
owner — or an admin, for a global routine — can restore it from an archived list.

**6. Wording edits apply in place. Structural edits fork once anyone has enrolled.**

- **Wording** — name, summary, goal, schedule note — is edited in place, always, for
  everyone.
- **Structure** — weeks, slots, movements, sets, reps, rest, schedule shape — is
  edited in place **until anyone has ever enrolled**. After that, saving a structural
  change creates a new routine and archives the old one (decision 5). Runs in
  progress finish the version they started; new starts get the new one.

**7. An athlete can copy a global routine into their own.**

"Copy to my routines" opens the editor prefilled from a global routine. Saving
creates an ordinary personal routine with no link back to its source. An admin's copy
is personal too, and promotable under decision 2.

**8. An admin can export global routines, and a command can load them back.**

- **Export**: an admin ticks global routines — live or archived, never Just WODs —
  and downloads one file. The file's format is the create-routine request body,
  defined by the shared Zod schema.
- **Import**: a command, `npm run routines:import <file>`, calls the same service
  method the admin route calls and creates each routine as global. The same
  validation runs; a malformed or out-of-date file is refused with the editor's
  messages.

## Reasoning

### Why one editor rather than an admin data path

The whole of ADR 0005 moved strictness out of the columns and into the editor. A
second way in — a seed file, a script, a raw insert — is a way around every one of
those rules, and the schema no longer catches what it skips. One write path is what
makes "the editor enforces it" true rather than aspirational.

That is also why the loader in decision 8 calls the service rather than inserting
rows. An export in the API's request shape either still validates after a migration
or fails with a message a person can act on. A snapshot of rows fails halfway through
an insert.

### Why promotion is one-way

Demotion would make a global routine private to one admin while other athletes are
mid-run on it — a routine they are following but can no longer see or restart, with
the admin now "owning" other people's history. Archiving already covers "stop
offering this" without either problem.

Promotion in place, rather than publishing a copy, fits how a routine actually gets
good: somebody builds it for themselves, trains it, and decides it is worth sharing.

### Why archive rather than delete

Because the schema already requires it. A slot somebody was assigned cannot be
deleted, and an enrollment cannot outlive its routine, so "delete" can only ever mean
"delete where nothing points at it" — a second behaviour behind the same button, for
the saving of one hidden row. Archiving is one behaviour, reversible, and never takes
a run away from somebody who is on it.

The first programs are the exception because they were never authored: nobody chose
them, the owner does not want them, and deleting the ones nobody ran leaves nothing
behind worth restoring.

### Why the fork, and why only for structure

A routine whose weeks change under a running enrollment hands the athlete a different
program mid-run, and the database refuses the part of that which removes an assigned
slot anyway. Forking reuses decision 5's archive rather than adding a versioning
system.

Wording carries none of that risk. A fixed typo in a summary is not a different
program, and forking on it would fill the archive with copies differing by a comma.
Before anyone enrols there is nobody to protect, so a routine still being drafted
edits in place on every save.

### Why Just WODs is locked

Provisioning enrols every new athlete in it by id. Archiving it would enrol every new
athlete in a routine the picker hides. And the editor has nothing to show: Just WODs'
days are whatever the WOD engine picks, not weeks of slots. Its behaviour belongs to
the engine.

### Why the export is global-only

The loader creates everything global, so exporting a personal routine would publish
it silently on import. An admin who wants their own routine in the file promotes it
first, which makes publishing a decision rather than a side effect. Exporting other
athletes' personal routines would cross the multi-tenant rule for no stated need.

## Consequences

- **Archiving does not free a name today.** On `Exercise` and `Wod`, the unique index
  over `(ownerId, name)` counts archived rows. Decision 6 forks a routine into a new
  row that keeps the old one's name while the old one is archived, so on `Plan` both
  the `(ownerId, name)` uniqueness and the partial index over global names must cover
  **live routines only** — the opposite of the `Exercise` behaviour, and a deliberate
  difference.
- Every read that lists selectable routines — `selectableBy` in `setup.service.ts`
  first — must exclude archived rows. Every read that follows an existing enrollment
  must not.
- "Has anyone ever enrolled" is the switch between editing in place and forking, so
  it is asked of `PlanEnrollment`, including completed runs.
- A fresh database has only Just WODs. Development and tests that want a program with
  straight sets build one through the service, or load an export.
- The deploy seed still upserts global `Exercise` and `Wod` rows by name and
  un-archives them, which overwrites an admin's edits to seeded rows. That exposure
  predates this ADR and is tracked separately; it does not apply to routines once
  `upsertFirstPrograms` is gone.

## What this does not decide

- **How a routine from outside the app gets in** — pasted text, a link, a form — and
  whether an import screen sits on top of decision 8's format. That is DN-137.
- **Sharing a personal routine between athletes** other than through an admin's
  promotion.
- **Choosing a program after the wizard**, and asking for the rest pace there —
  DN-132.
