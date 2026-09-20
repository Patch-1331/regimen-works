# Context: API

NestJS on Node, Prisma over Postgres. Modules and DI exist to keep the generator and
scheduler logic testable as it grows (ADR-0001).

Domain vocabulary is **not** defined here — it lives in
[`packages/shared/CONTEXT.md`](../../packages/shared/CONTEXT.md). This file covers
only what is true of the API specifically.

## Vocabulary local to the API

**DailyAssignment** — the join between an athlete and a date: what they are meant to
do that day, and its `status` (`scheduled` / `in_progress` / `completed` /
`skipped`). One per user per day. A rest day is an assignment with a null `wodId`,
not a missing row.

**WorkoutSession** — a single attempt at an assignment: the live, in-progress state
(round splits, interval index, rest timers, cap behaviour). Distinct from
**WorkoutLog**, which is the recorded result. A session is what the athlete is doing
now; a log is what they did.

**Scheduler** — the module that decides which WOD an assignment gets, honouring
pattern cooldowns, training days, equipment, and the athlete's program slots.

**Provisioning** — first-contact creation of a user's rows from their Clerk
identity. Note that nobody is provisioned onto a `SkillLevel`.

## Multi-tenancy: every query is scoped by `userId`

Auth is **Clerk** (`@clerk/backend`), and every row that belongs to an athlete
carries a `userId`. **An unscoped read still compiles and still returns other
athletes' data** — the type system will not catch it, so this is a review-time
obligation on every query you write or touch.

`src/common/user-scoping.spec.ts` is an architectural test that enforces this;
`guard-wiring.spec.ts` and `admin-guard-wiring.spec.ts` do the same for route
guards. If you add a module or a route, expect these to be the tests that fail
first, and treat a failure as a real finding rather than a fixture to update.

Sign-up is **invite-only**, configured in the Clerk dashboard. It is invisible in
the repo, so do not read the absence of a check here as open registration.

## Commands

| | |
| --- | --- |
| Typecheck | `npm run typecheck --workspace apps/api` |
| Unit tests | `npm run test --workspace apps/api` |
| DB-backed tests | `npm run test:db --workspace apps/api` |
| E2E | `npm run test:e2e --workspace apps/api` |
| Lint | `npm run lint --workspace apps/api` (eslint) |

Three jest configs, deliberately separate: plain `jest` for unit, `jest-db.json` for
tests that touch Postgres (`*.db-spec.ts`), `jest-e2e.json` for end-to-end.

**`prisma generate` is not in this workspace's `postinstall`.** A stale client makes
the API build fail with bogus `TS2353` errors that name fields which do exist, and
`typecheck` still passes — so the error misdirects. Run
`npm run prisma:generate --workspace apps/api` after any schema change, and suspect
a stale client before you suspect the code.
