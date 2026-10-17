# ADR 0010: The committed files own seeded library content

**Status:** Accepted

## Context

The deploy runs the seed (`render.yaml`, `npm run prisma:seed`) on every deploy. It
writes every seeded exercise (`prisma/library/`, with `curation.ts`), every seeded WOD
(`wod-seed.ts`) and every warm-up and cool-down entry (`checklist-seed.ts`), and it sets
`archivedAt: null` on each.

The admin routes (`admin/exercises`, `admin/wods`) let an admin edit and archive those
same rows. So an admin's edit to a seeded row was overwritten on the next deploy, and
an archive was undone by it (DN-151). That was fine while the seed was the only author,
and it stopped being fine when the admin routes arrived. ADR 0007 said the overwrite
went away with `exercise-seed.ts`. It did not: the library import matches by key, but
it still writes every field.

Programs went the other way. ADR 0006 retired the seeded programs, and the global
program library is authored in the app. Something had to be decided for the rest.

Settled with the owner on 2026-10-17.

## Decision

**1. The committed files own the content they seed.** The deploy keeps writing it, as
it does now. The exercise library is a ~800-row dataset behind a reviewed curation
pipeline (ADR 0007), and a fix to it belongs in a PR, where it is reviewed and
versioned, rather than in a production edit that no one else can see.

**2. A seeded row is one with a `key`.** Exercises already had one (DN-165). `Wod` and
global `ChecklistEntry` rows get one too. The import sets it, and it is null on
anything an admin or athlete writes. Each is unique among global rows and never set on
an athlete's own, enforced by a partial unique index and a CHECK in the migration
(`20261017100000_seeded_keys`).

- A WOD's key is written in `wod-seed.ts`, so a WOD can be renamed in place, the way
  an exercise can.
- A checklist entry's key is derived as `<kind>/<exercise key>`. Both parts are
  stable already, and one movement is on each list at most once.
- Rows deployed before this get their key from the import's first run, which finds
  them by today's name. This is how DN-167 gave exercises their keys.

**3. The admin routes refuse to change a seeded row.** `PATCH`, `archive` and
`unarchive` answer 409 with a message naming the file to change (`seededRefusal` in
`packages/shared`). The library pages show those rows read-only to an admin, pointing
at the same file. Admins still author new global rows, with no key, and those stay
fully editable.

**4. A seeded row retires by leaving the files.** Removing a WOD from `wod-seed.ts`, or
removing or leaving out an exercise in the library files, makes the next deploy
archive it. Putting it back brings it back. A checklist entry that leaves
`checklist-seed.ts` is deleted rather than archived. An entry only points at a
movement, so it has no history of its own, and nothing refers to it.

**5. The deploy never archives or deletes a row it does not own.** A row with no key is
never touched.

## Consequences

- **The seed log says what retired.** It lists each exercise or WOD archived and each
  checklist entry removed, so a deletion from the files that wasn't meant shows up in
  the deploy log. A wrong deletion still archives on that deploy.
- **Fixing a seeded row means a PR, even a typo.** The 409 message says so, and names
  the file.
- **A key is never reused.** The archived row keeps holding it, and putting the key
  back un-archives that row instead of making a new one.
- **The keys live in partial indexes and CHECKs that Prisma cannot express.**
  `prisma migrate dev` will offer to drop them on the next model change. Keep them.
