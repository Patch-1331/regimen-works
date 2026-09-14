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
