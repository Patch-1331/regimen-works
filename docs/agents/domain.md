# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

This repo is **multi-context**: it is an npm-workspaces monorepo whose three
workspaces hold genuinely different vocabulary.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root. It points at one `CONTEXT.md` per
  workspace. Read each one relevant to the topic — and read more than one when the
  change crosses a workspace, which here it usually does.
- **`docs/adr/`**: system-wide decisions. Read the ADRs that touch the area you are
  about to work in.
- **`<workspace>/docs/adr/`**: workspace-scoped decisions, where they exist.

If a file does not exist, **proceed silently**. Don't flag its absence; don't
suggest creating it upfront. `/domain-modeling` creates them lazily, when a term or
a decision actually crystallises.

## File structure

```
/
├── CONTEXT-MAP.md
├── docs/adr/                       ← system-wide decisions
│   ├── 0001-tech-stack.md
│   ├── 0002-crossfit-naming.md
│   └── 0003-production-observability.md
├── packages/shared/
│   └── CONTEXT.md                  ← the domain's own vocabulary
├── apps/api/
│   └── CONTEXT.md
└── apps/web/
    └── CONTEXT.md
```

## `packages/shared` is the source of truth for domain terms

The Zod schemas in `packages/shared/src` are the one definition of every DTO, and
its `CONTEXT.md` is the canonical glossary. Where `apps/api` and `apps/web` name the
same concept, `packages/shared` wins. A term that means one thing in the API and
another in the web client is a modelling bug, not a dialect.

Note that much of the reasoning is already written down **in the source**, as long
doc comments on the schemas (see `enums.ts`, `skill-level.ts`, `schedule.ts`). These
comments cite the issue that forced the decision (`DN-88`, `DN-12`). Treat them as
primary sources and follow the citation before contradicting one.

## Use the glossary's vocabulary

When your output names a domain concept — an issue title, a refactor proposal, a
hypothesis, a test name — use the term as defined in the relevant `CONTEXT.md`.
Don't drift to synonyms the glossary explicitly avoids. This repo has at least one
such avoidance with teeth: see ADR-0002 on CrossFit naming, and the standing rule
that the app performs **no ability assessment** (`SkillLevel` is a standing choice,
never a score).

If the concept you need isn't in a glossary yet, that's a signal: either you're
inventing language the project doesn't use (reconsider), or there's a real gap
(note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0001 (TypeScript everywhere), but worth reopening because…_
