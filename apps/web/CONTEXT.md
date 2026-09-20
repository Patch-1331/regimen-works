# Context: Web

React + Vite + TypeScript, TanStack Query for server state, Tailwind for styling
(ADR-0001). The athlete-facing client.

Domain vocabulary is **not** defined here — it lives in
[`packages/shared/CONTEXT.md`](../../packages/shared/CONTEXT.md). DTOs are imported
from that package; do not restate a shape locally.

## What is true here specifically

**Display order is not domain order.** The shared package numbers weekdays
`0 = Sunday`. A Mon–Sun week strip converts at the point it renders and nowhere
else. Never introduce a second numbering.

**The API is the only source of decisions.** The client renders what the scheduler
decided and collects what the athlete chose. Logic that decides *what* an athlete
does belongs in the API or in `packages/shared`, not in a component.

**`ApiAuthBridge`** wires Clerk's React session into the API client, so requests
carry the athlete's identity. Sign-up is invite-only and configured in Clerk, not
in this code.

## Commands

| | |
| --- | --- |
| Dev server | `npm run dev:web` (from the repo root) |
| Typecheck | `npm run typecheck --workspace apps/web` (`tsc -b`) |
| Unit tests | `npm run test --workspace apps/web` (vitest) |
| E2E | `npm run test:e2e --workspace apps/web` (Playwright) |
| Lint | `npm run lint --workspace apps/web` (**oxlint**, not eslint) |

## Judge a build by its size

A missing `VITE_*` environment variable does not fail the build — it tree-shakes the
code that reads it, and the build succeeds smaller and broken. Known landmarks:

- **~548 kB** — complete.
- **~391 kB** — Clerk was dropped; auth is gone.
- **~275 kB** — the app itself is gone.

Check the bundle size before calling a web build good.
