# Issue tracker: Linear

Issues and specs for this repo live in **Linear**, team **Dark Neon** (key `DN`).
A bare `DN-123` or `#123` in conversation means the Linear issue `DN-123`.

**GitHub Issues on `Patch-1331/regimen-works` are a stale mirror.** They are all
closed and are not maintained. Never read them for context, never open one, and
never treat their absence of an issue as evidence. Pull requests on GitHub are
still real and still the delivery mechanism — it is only the *issue* tracker that
moved.

## How to reach it

Linear is reached through its **MCP tools**, not a CLI. There is no `linear` binary;
do not shell out. The tools are prefixed with the Linear MCP server's id, which
differs per session (`mcp__<server-id>__<tool>`), so match on the tool name:

| Operation | Tool |
| --- | --- |
| Create an issue | `save_issue` with `team: "Dark Neon"` and no `id` |
| Update an issue | `save_issue` with `id: "DN-123"` |
| Read an issue | `get_issue` |
| List / search issues | `list_issues` (filter by `team`, `state`, `label`, `project`, `parentId`, `query`) |
| Read discussion | `list_comments` |
| Comment | `save_comment` |
| Labels available | `list_issue_labels` |
| States available | `list_issue_statuses` |
| Projects | `list_projects`, `get_project`, `save_project` |

Prefer `addLabels` / `removeLabels` over `labels` when editing an existing issue:
`labels` replaces the whole set and will silently drop labels you did not name.

## Conventions

**There are two label axes, and they must not be mixed.**

**Work type — exactly four**: `Feature`, `Bug`, `Improvement`, `Chore`. Every issue
carries one.

- `Feature` covers backend and schema slices too, not just user-visible UI. A
  migration that no screen reads yet is still a `Feature`.
- `Bug` is for defects in shipped behaviour. File bugs here, in Linear — never as
  a background task chip and never as a GitHub issue.
- `Chore` is maintenance that no user would notice.

**Triage role — the five canonical roles**, as labels whose names are identical to
the role names: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
`wontfix`. At most one at a time. See `triage-labels.md`.

**States carry progress**, not triage: `Backlog`, `Todo`, `In Progress`,
`In Review`, `Done`, `Canceled`, `Duplicate`.

**Project state drives issue state.** A project that is In Progress has every open
issue on `Todo` (or further along). Issues sit on `Backlog` only while their project
is not yet started. Do not leave a started project's issues on `Backlog`.

**Finish a project before starting another.** Two projects In Progress at once is
only correct when they are genuinely parallel, and that is the user's call to make,
not an agent's.

**One PR closes one issue.** A PR whose body names `DN-123` flips that issue to
`Done` automatically on merge. Two consequences the skills must respect:

- **Never deliver half an issue.** If scope has to shrink, carve the remainder into
  its own new issue *before* opening the PR, so the auto-close tells the truth.
- If a partial delivery does land, set the issue's state back by hand; the
  automation will not know it was partial.

**Tests ship with the code.** Do not create "add tests for X" issues. The test
belongs to the issue that owns the code.

## When a skill says "publish to the issue tracker"

Create a Linear issue with `save_issue`, `team: "Dark Neon"`, exactly one type label,
and a `state` chosen per the project rule above.

## When a skill says "fetch the relevant ticket"

`get_issue` for the body, then `list_comments` for the discussion. Both — the
decisive constraint is as often in a comment as in the description.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(This is a solo project with no external
contributors. `/triage` reads this flag; flip it to `yes` if that changes.)_

## Wayfinding operations

Used by `/wayfinder`. Linear models the map natively, so nothing here needs a
text-in-the-body fallback.

- **Map**: a Linear **project** (`save_project`) holding the destination in its
  description, with its decision tickets as the project's issues. Where a
  lighter-weight map is wanted, a single issue with sub-issues works too — prefer
  the project when the effort is big enough to need `/wayfinder` at all.
- **Child ticket**: an issue with `project` set to the map (or `parentId` set to the
  map issue). Put the wayfinder ticket type — research / prototype / grilling / task
  — in the title prefix, since both label axes above are spoken for and neither may
  be diluted with a third meaning.
- **Blocking**: Linear's **native issue relations**. `save_issue` with
  `blockedBy: ["DN-120"]` or `blocks: [...]`; both are append-only, and
  `removeBlockedBy` / `removeBlocks` undo them. A ticket is unblocked when every
  blocker has reached a completed or canceled state.
- **Frontier query**: `list_issues` scoped to the map's `project` (or `parentId`)
  with `state` filtered to the open ones, then drop any with an unfinished blocker
  or an assignee. First in map order wins.
- **Claim**: `save_issue` with `assignee: "me"` and `state: "In Progress"` — the
  session's first write.
- **Resolve**: `save_comment` with the answer, then `save_issue` with
  `state: "Done"`, then append a context pointer to the map's description.
