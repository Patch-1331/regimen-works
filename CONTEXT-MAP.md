# Context Map

Regimen Works is an npm-workspaces monorepo with three contexts. Read the one you
are working in; read `packages/shared` as well whenever a domain term is involved,
because it owns the vocabulary the other two borrow.

| Context | Path | What it holds |
| --- | --- | --- |
| **Shared domain** | [`packages/shared/CONTEXT.md`](packages/shared/CONTEXT.md) | Zod schemas, the canonical glossary, pure scheduling and scoring logic |
| **API** | [`apps/api/CONTEXT.md`](apps/api/CONTEXT.md) | NestJS modules, Prisma persistence, auth, the scheduler |
| **Web** | [`apps/web/CONTEXT.md`](apps/web/CONTEXT.md) | React + Vite client, TanStack Query, the athlete-facing screens |

System-wide decisions live in [`docs/adr/`](docs/adr/). Consumer rules for these
documents live in [`docs/agents/domain.md`](docs/agents/domain.md).

## The one rule that spans all three

**The app decides what you do. You decide how hard it is.**

The scheduler removes the daily planning burden. It forms no opinion about the
athlete's capability. Anything that reads like scoring, grading, or assessing an
athlete contradicts this — see `no ability assessment` in the shared glossary.
