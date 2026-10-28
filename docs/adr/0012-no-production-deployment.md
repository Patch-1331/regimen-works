# ADR 0012: No production deployment

**Status:** Accepted

## Context

Production on Render cost about $17.50 a month: the API on `0.5c-512mb` ($7),
Postgres on `0.1c-256mb` ($6) and its 15 GB disk ($4.50, billed on allocation).
The static frontend was free. The app was not being used enough to justify a
standing monthly bill.

The cheaper half-measures were looked at and rejected. Suspending the API saves
its $7, but the database is the larger cost and is not obviously free while
suspended. Free plans are worse than nothing: a free web service sleeps when
idle, and a free database is deleted about 30 days after it is created, taking
the data with it.

Settled with the owner on 2026-10-28 (DN-207).

## Decision

**There is no deployed environment.** The Blueprint, the API, the web site and
the database were deleted on Render. Development is local, as it already was:
`npm run dev` against compose Postgres, or `npm run dev:web:mock` with no
backend at all.

The production database was exported before it was deleted and the export was
verified by restoring it into a throwaway Postgres 18. Where it is kept is
recorded on DN-207.

`render.yaml` stays in the repo, marked not live, as the recipe for bringing
production back. With the Blueprint deleted nothing reads it, so a push that
touches it deploys nothing.

## Consequences

- `main` is no longer what is running anywhere. A merge ships nothing.
- ADR 0003 (production observability) and the Render-specific parts of ADR 0010
  describe a deployment that does not exist. They stand as the design for when
  it does.
- Reviving production is a fresh Blueprint: re-enter every `sync: false` value,
  re-attach DNS, and restore the export, since the database comes back empty.
  The header of `render.yaml` lists the steps.
