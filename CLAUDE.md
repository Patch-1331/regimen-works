# Regimen Works

A training app that decides what the athlete does each day. npm-workspaces
monorepo: `apps/api` (NestJS + Prisma + Postgres), `apps/web` (React + Vite),
`packages/shared` (Zod schemas — the domain's source of truth).

Formerly "wod-engine"; renamed 2026-09. "WOD" remains domain vocabulary and is not
a leftover.

## Agent skills

### Issue tracker

Linear, team **Dark Neon** (key `DN`), reached via the Linear MCP tools.
GitHub Issues is switched off; [`docs/github-issues.md`](docs/github-issues.md)
maps the old `#N` numbers.
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
npm run dev:web:mock  # the web app on :5174 with no API, database or Clerk
```

Narrow to one workspace with `--workspace apps/api`. The API has three separate
jest configs — `test` (unit), `test:db` (Postgres-backed `*.db-spec.ts`),
`test:e2e`.

### Checking the web app in a browser

Use **mock mode** to look at UI: `preview_start web-mock`. It needs no `.env`,
API or database, so it works in any worktree or cloud session. Clerk is replaced
by a signed-in stand-in, and msw answers `/api` from the same handlers and
fixtures the vitest suite uses (`src/test/handlers.ts`, plus extras in
`src/mock/browser.ts`). It is stateless: a write answers, then the next read is
unchanged. If a screen has nothing to show, add a handler to `src/mock/browser.ts`.

Use **real mode** (`api` + `web`) only when the change needs the API itself.
`.worktreeinclude` copies both `.env` files into new worktrees. Clerk's sign-in
is on Clerk's own domain, so the athlete signs in by hand in the browser pane.

## Landmines

These cost hours if you don't know them. Each one fails in a way that points
somewhere other than the cause.

- **`prisma generate` is not in `postinstall`.** A stale client makes the API build
  fail with bogus `TS2353` errors naming fields that *do* exist, while `typecheck`
  still passes. After any schema change:
  `npm run prisma:generate --workspace apps/api`.
- **A missing `VITE_*` var doesn't fail the web build** — it tree-shakes the code
  that reads it and succeeds, smaller and broken. Judge by bundle size against
  `main` built the same way (~705 kB complete on 2026-10-16); ~405 kB means `VITE_CLERK_PUBLISHABLE_KEY` was missing — `main.tsx`
  throws on load, the app is tree-shaken out, and the deploy serves a blank page.
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
