# Regimen Works

A training app that decides what the athlete does each day. npm-workspaces
monorepo: `apps/api` (NestJS + Prisma + Postgres), `apps/web` (React + Vite),
`packages/shared` (Zod schemas — the domain's source of truth).

Formerly "wod-engine"; renamed 2026-09. "WOD" remains domain vocabulary and is not
a leftover.

## Agent skills

### Issue tracker

Linear, team **Dark Neon** (key `DN`), reached via the Linear MCP tools.
GitHub Issues are a stale, all-closed mirror — never read or write them.
See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Triage labels

The five canonical roles exist as Linear labels with identical names —
`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
They are a separate axis from the four work-type labels (`Feature`, `Bug`,
`Improvement`, `Chore`); every issue carries one of each, and you add or remove
them with `addLabels` / `removeLabels`, never `labels`.
See [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).

### Domain docs

Multi-context: [`CONTEXT-MAP.md`](CONTEXT-MAP.md) points at one `CONTEXT.md` per
workspace; system-wide ADRs in [`docs/adr/`](docs/adr/).
See [`docs/agents/domain.md`](docs/agents/domain.md).

## Commands

Run from the repo root. Everything is workspace-aware.

```
npm run typecheck     # all workspaces
npm run test          # all workspaces
npm run lint          # eslint in api, oxlint in web + shared
npm run build
npm run dev:api
npm run dev:web
```

Narrow to one workspace with `--workspace apps/api`. The API has three separate
jest configs — `test` (unit), `test:db` (Postgres-backed `*.db-spec.ts`),
`test:e2e`.

## Landmines

These cost hours if you don't know them. Each one fails in a way that points
somewhere other than the cause.

- **`prisma generate` is not in `postinstall`.** A stale client makes the API build
  fail with bogus `TS2353` errors naming fields that *do* exist, while `typecheck`
  still passes. After any schema change:
  `npm run prisma:generate --workspace apps/api`.
- **A missing `VITE_*` var doesn't fail the web build** — it tree-shakes the code
  that reads it and succeeds, smaller and broken. Judge by bundle size: ~548 kB is
  complete, ~391 kB means Clerk was dropped, ~275 kB means the app is gone.
- **Every query must be scoped by `userId`.** Auth is Clerk and the app is
  multi-tenant; an unscoped read compiles fine and returns other athletes' rows.
  `src/common/user-scoping.spec.ts` guards this — a failure there is a real finding.
- **Never `npm update`, and never regenerate the lockfile.** Both drop the Linux
  platform packages that Render's build needs (npm/cli#4828). Add a dependency with
  `npm install <pkg> --package-lock-only`, then `npm install`.
- **The database refuses external connections.** You cannot query production
  directly; go through the API, or add a CIDR allow-rule in `render.yaml`.
- **Production is the only deployed environment.** There is no staging; dev is
  local. Render preview environments need a paid plan the project does not have.

## Working agreements

- **Always branch.** Never commit to `main`.
- **One PR closes one issue.** A PR naming `DN-123` auto-closes it on merge, so
  never deliver half an issue — split the remainder into its own issue first.
- **Tests ship with the code.** No retrofit "add tests" issues; the test belongs to
  the issue that owns the code.
- **Document in the tool, not the transcript.** Plans go in the Linear issue, infra
  gotchas in `render.yaml`, decisions in an ADR.
- **When stacking a PR, check the base PR is still open.** GitHub only auto-retargets
  PRs that were open at merge time.
- **Commit `eslint --fix` output** rather than reverting unrelated fixes; put it in
  its own commit.
