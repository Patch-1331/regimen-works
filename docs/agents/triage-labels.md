# Triage Labels

The skills speak in terms of five canonical triage roles. In this tracker the label
strings are **identical to the role names** — there is no mapping to remember and
nothing to translate.

| Role in mattpocock/skills | Label in our tracker | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate this issue |
| `needs-info` | `needs-info` | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an AFK agent |
| `ready-for-human` | `ready-for-human` | Requires human implementation |
| `wontfix` | `wontfix` | Will not be actioned |

All five exist on team **Dark Neon** in Linear. When a skill names a role, pass that
exact string to `addLabels` / `removeLabels`.

## Rules

Linear keeps two independent label axes, and they must not be mixed:

- **Triage role** — the five labels above. At most one at a time.
- **Work type** — `Feature`, `Bug`, `Improvement`, `Chore`. Exactly one, always.

Everything else follows from that:

- **Never use the `labels` field** on `save_issue`. It replaces the whole set, so
  setting a triage role that way silently strips the issue's `Feature` or `Bug`.
  Use `addLabels` and `removeLabels`, which are incremental.
- **Changing role means removing the old label as well as adding the new one.**
  Linear does not enforce exclusivity across these five — an issue carrying both
  `ready-for-agent` and `ready-for-human` is a bug in the triage run, not a state.
- **Labels carry the triage verdict; states carry progress.** They are independent,
  but two pairings are contradictions worth surfacing rather than silently fixing:
  a `ready-for-*` label on an issue still in `Backlog`, or a `needs-triage` label on
  an issue in a started project (which the project rule in `issue-tracker.md` says
  belongs on `Todo`).
- **`wontfix` is a label, not a closure.** Apply it *and* move the issue to
  `Canceled`, so the tracker's own reporting agrees with the triage run.
- **Prefer `Duplicate` over `wontfix`** when that is what actually happened: it is a
  real state on this team, and `save_issue` takes `duplicateOf` to record which one.
