# Context: Shared domain

`packages/shared` is the **source of truth for the domain**. Its Zod schemas are the
one definition of every DTO, imported by the API and by every client. Where the API
and the web client name the same concept differently, this package wins.

Much of the reasoning is already written as long doc comments on the schemas, each
citing the issue that forced it (`DN-88`, `DN-12`, `DN-84`, `DN-115`). Those comments
are primary sources — follow the citation before contradicting one.

## Glossary

Use these terms exactly.

**WOD** — a single workout. Typed `amrap`, `for_time`, `emom`, or `tabata`, with a
time cap and a `dominantPattern`. Benchmark WODs may carry their community names
("Cindy", "Angie"); the word *CrossFit* itself is never used (ADR-0002).

**Program** — the domain word for what the athlete is following: it decides what
each training day is. The athlete picks one at signup and can change it later.
*"Just WODs" is itself a program, not the absence of one* — it is seeded as a real
row so there is one code path, not an `if (enrolled)` branch.

> **Program vs `Plan`.** The persisted model is called `Plan` (with `PlanWeek`,
> `PlanSlot`, `PlanEnrollment`). **Program** is the domain and user-facing term.
> Prefer *program* in prose, issue titles, and test names; use `Plan` only when
> naming the actual model or table. Do not "fix" one into the other.

**Movement pattern** — the coarse axis a WOD loads: `push`, `pull`, `squat`,
`hinge`, `core`, `cardio`. Drives cooldown scheduling.

**Progression line** — finer-grained than a pattern, because one pattern contains
several independent ladders (`push_horizontal` and `push_vertical` are separate
lines). Loaded and equipment-bound ladders are their own lines rather than rungs
appended to a bodyweight one, so that inserting a movement never renumbers the rungs
above it and silently changes what a stored `rung` refers to.

**Rung** — a movement's position within its progression line. **A sort order and a
grouping, not a score.**

**SkillLevel** — despite the name, the athlete's *standing choice* of movement per
progression line: the last thing they picked, remembered so they need not re-pick it
every session. A row exists only once the athlete has chosen something; nobody is
provisioned onto one.

**No ability assessment** — a load-bearing constraint, not a preference. The app
holds no view about what anyone can do and never scores, grades, ranks, or infers an
athlete's capability. If a design implies otherwise, it is wrong.

**Equipment** — what a movement needs beyond the athlete's own body, and what the
athlete says they own. One vocabulary for both sides. `bodyweight` is deliberately
*not* a member: the baseline is the absence of a tag.

**Training days** — the weekdays an athlete trains on. At least one, always;
duplicates are refused rather than quietly collapsed.

**Weekday numbering** — `0 = Sunday … 6 = Saturday`, matching `getUTCDay()`, stated
once for the whole app. Monday-first is a *display* order, converted at the point of
render and nowhere else — never a second numbering.

## Shape

Pure logic only: no Prisma, no Nest, no React. A module here is importable from the
API, the web client, and a future React Native app without dragging a runtime along.
That portability is the reason the package exists (ADR-0001) — adding a
platform-specific dependency here is a breach, not a shortcut.

Tests are `vitest`, colocated as `*.spec.ts` beside the module they cover.
