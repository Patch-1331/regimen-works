# Regimen Works

A program-based training app. Set up your own plan, pick one from the
library, or just take the day's WOD — the app decides what each session is,
runs a live tracker through it, logs what actually happened, and reflects
progress back over time.

"Just WODs" — a generated bodyweight workout, ≤30 minutes, ≤5 days a week —
is the default program rather than the whole product. The app decides what
you do; you decide how hard it is.

See [`docs/plan.md`](docs/plan.md) for the full plan and
[`docs/adr/`](docs/adr) for the reasoning behind the bigger calls.

## Where the work is tracked

Planning lives in **[Linear](https://linear.app/regimen-works)** — the backlog,
what's in progress, and everything not yet built.

GitHub Issues is the **archive of shipped work**, kept readable because the
code cites it: comments like `Feature #63 opt-in` in `schema.prisma` point at
the issue that explains why a field exists. Those issues are all closed, and
the empty backlog there means the work moved, not that the project is done.

A bare `#N` in a doc, comment or commit message is a GitHub issue. Linear
issues are always written in full (`DN-5`) — the two numbering schemes
overlap and mean different things, so the prefix is what tells them apart.

## Stack

TypeScript monorepo (npm workspaces): NestJS + Prisma + Postgres API,
React + Vite + Tailwind web client, Zod-schema types shared between them
in `packages/shared`.

## Getting started

```bash
npm install   # also builds packages/shared (postinstall) — apps/api needs its compiled dist

docker compose up -d   # local Postgres; the API's Prisma datasource needs it

# API: generate the Prisma client, run the migration, seed the WOD library
npm run prisma:generate --workspace apps/api
npm run prisma:migrate --workspace apps/api
npm run prisma:seed --workspace apps/api

# run both apps (separate terminals)
npm run dev:api   # http://localhost:3001
npm run dev:web   # http://localhost:5173
```

Copy `apps/api/.env.example` to `apps/api/.env` first if it isn't there
already.

### If you had a local database before the rename

The compose database, user and volume were renamed from `wod_engine` to
`regimen_works`. `POSTGRES_USER` and `POSTGRES_DB` only take effect when a
data directory is first initialised, so they rename nothing inside a volume
that already exists — an old database keeps the old names and the new
`DATABASE_URL` just fails to connect.

The volume name changed too, so recreating does **not** require deleting
anything:

```bash
docker compose down     # note: no -v
docker compose up -d    # creates the new volume, initialised under the new names
npm run prisma:migrate --workspace apps/api
npm run prisma:seed --workspace apps/api
```

That leaves the old volume on disk, holding whatever local data you had.
Nothing reads it any more. Remove it once you're satisfied the new stack
works:

```bash
docker volume ls | grep pgdata        # find it — see the note below
docker volume rm <old-volume-name>
```

Compose prefixes volume names with the **project name, which defaults to the
directory name**. From a clone in `wod-engine/` the old volume is
`wod-engine_wod-engine-pgdata`, but from a git worktree it is prefixed with
that worktree's directory instead — which also means a worktree gets its own
containers and volumes, and `docker compose down` there does not touch the
stack your main checkout is running.

Update `apps/api/.env` to the new `DATABASE_URL` as well — `.env.example`
has it, but your own `.env` is not tracked and will still point at the old
database.

If you edit `packages/shared`, rebuild it before the API dev server will
see the change — `npm run build --workspace packages/shared`, or run
`npm run dev --workspace packages/shared` in a separate terminal to
rebuild on save.

## Scripts (root)

- `npm run dev:api` / `npm run dev:web` — run one app
- `npm run build` — build all workspaces
- `npm run lint` / `npm run typecheck` / `npm run test` — across all workspaces

`apps/web`'s Vitest suite runs in jsdom, so components can be mounted and
asserted on with Testing Library — see
`src/components/MovementChoicesPanel.spec.tsx` for the shape: mock
`src/lib/api`, wrap in a `QueryClientProvider`, and query through the
accessibility tree (`getByRole`) rather than by class or test id.

## Database-backed tests

`npm run test` covers every workspace and needs no database — it is the fast
suite, and CI runs it first.

The API's DB-backed suites are separate. They are named `*.db-spec.ts`, live
next to the code they test, and run against a real throwaway Postgres:

```bash
docker compose up -d                     # if it isn't already running
npm run test:db --workspace apps/api
```

The run drops and recreates a `regimen_works_test` database on that same
server, applies the migrations, and empties every table between tests. Your
development database is never touched, and a stale schema left by another
branch cannot survive into a run.

A real database rather than a mocked Prisma client, deliberately: a mocked
client mostly proves a mock was called with certain arguments, and keeps
passing while the query is subtly wrong — bad `where`, missing `include`,
wrong ordering — which is the class of bug these tests exist to catch.

Set `TEST_DATABASE_URL` if your Postgres does not match `docker-compose.yml`
(an instance created before the rename above, for instance, still has the
`wod_engine` user). It defaults to the compose credentials with the
`regimen_works_test` database name.

Fixtures and the reset live in `apps/api/src/test-support/`;
`database.db-spec.ts` there shows the shape.

The API's e2e suite sits on the same database and runs separately, so a
failure says whether the request path or the query broke:

```bash
npm run test:e2e --workspace apps/api
```

It drives the real app through HTTP — `src/app.e2e-spec.ts` — with Clerk's JWT
verification stubbed and the guard itself left alone, so auth is exercised
rather than routed around. `createE2eApp` mirrors `main.ts`'s global wiring;
anything added to `bootstrap()` belongs there too, or the suite quietly tests a
different application than the one that ships.

## Coverage, and the ratchet

```bash
npm run test:cov
```

Reports coverage for all three workspaces and fails if any has dropped below
its floor. CI runs it on every pull request. It needs Postgres for the same
reason `test:db` does — the API's number comes from running both its suites
together, because a service covered only by its `*.db-spec.ts` would otherwise
report as untested.

Where the floors live: `apps/api/jest-cov.json`, `apps/web/vite.config.ts`,
`packages/shared/vitest.config.ts`.

**Ratchet, never target.** The floors sit just under the coverage measured when
they were set. They exist so coverage cannot silently regress — they are not a
goal, and there is deliberately no target number anywhere in this repo. A
percentage is a poor measure of whether the thing that matters is tested: the
scheduler fully exercised at 40% overall beats a padded 80%.

So:

* When a PR raises coverage, **raise its floor in the same PR**. A ratchet
  nobody tightens is just a number that used to be true.
* Lowering a floor is a decision to **state in the PR description**, never a
  quiet edit to make CI pass. Deleting tests and dropping the floor to match
  should be as visible as deleting the tests.

The floors set on 2026-09-14, against the coverage on that day:

| Workspace | Statements | Branches | Functions | Lines |
| -- | -- | -- | -- | -- |
| `apps/api` | 84 (85.4) | 74 (75.5) | 70 (71.1) | 82 (83.5) |
| `apps/web` | 60 (61.9) | 49 (50.3) | 51 (52.6) | 62 (63.1) |
| `packages/shared` | 97 (98.7) | 99 (100) | 99 (100) | 97 (98.6) |

The API's weakest column is functions, and it is concentrated in the
controllers — nothing drives them over HTTP yet. That is what DN-53's e2e suite
is for, and it should move that column sharply.

## Browser end-to-end testing

A real Chromium driving the real web client against the real API, signed in
through Clerk (DN-72).

```bash
npm run test:e2e --workspace apps/web
```

Playwright starts both dev servers itself, on ports of their own (5273 and
3101) so your dev stack can stay up while it runs, and resets its own database
first. Four specs: sign in and land on Today, the core loop from Today through
a workout to History, a deep link cold-loaded while signed in, and the
signed-out gate.

### What it needs

| Variable | Why |
| -- | -- |
| `CLERK_SECRET_KEY` | The API verifies every request against it, and `@clerk/testing` mints the sign-in ticket with it |
| `VITE_CLERK_PUBLISHABLE_KEY` | Without it the web app throws at startup rather than rendering a sign-in form |
| `E2E_USER_EMAIL` | The Clerk test user to sign in as |
| `E2E_DATABASE_URL` | Optional; defaults to `regimen_works_e2e` on the compose Postgres |

### The test user

A user in Clerk whose email uses the `+clerk_test` pattern, which Clerk
recognises as a test address: no mail is sent, and `424242` is the verification
code that works for it. `@clerk/testing` also supplies the Testing Token that
stops an automated sign-in tripping Clerk's bot detection with "Bot traffic
detected".

There is no auth bypass, deliberately. The alternative was a dev-only switch
that skipped the guard, which would put bypass code next to production auth
forever to save a key in CI. The cost of not doing that is real and worth
stating plainly: **anything that signs in needs Clerk keys present.**

The API's own e2e suite needs none of this — it stubs Clerk's JWT verification
and leaves the guard running (`apps/api/src/app.e2e-spec.ts`).

### Its own database, and local only

The suite gets `regimen_works_e2e`, dropped and recreated from migrations on
every run. Never your development database: the core loop starts a workout,
finishes it and logs a result, so pointing it at the database you work against
would leave fabricated history in it.

**Local only, deliberately.** Production is the only deployed environment, so
"against the deployed app" would mean writing that same fabricated history into
live data — and a failure could not be diagnosed without deploying a fix first.
A read-only smoke test against production is a different and much narrower
thing, worth its own issue if it is wanted.

### Seeding history

The suite above creates what it needs. For anything that wants an athlete with
a past — Stats, the streak, the progressions panel — there is a separate seed:

```bash
E2E_USER_ID="user_2ab..." npm run seed:e2e --workspace apps/api
```

Seven completed days over two weeks, with sessions and results in both shapes.
It leaves **today** empty on purpose, so starting a workout is still testable.
Idempotent, so it can run in front of a suite repeatedly without a reset.

### CI

Not wired in yet, and it needs a decision first: there are no Clerk secrets in
this repo's GitHub Actions secrets. `CLERK_SECRET_KEY` and
`VITE_CLERK_PUBLISHABLE_KEY` both have to be added before this suite can run
there.
