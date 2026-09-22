# ADR 0003: Production observability

**Status:** Accepted

## Context

The API is deployed and reachable by someone other than localhost, and until
now it logged nothing but Nest's own startup lines. A 500 in production left
no trace anywhere anyone could read, and the only monitoring was Render's
`healthCheckPath` — a deploy gate rather than an alert — plus `notifyOnFail`,
which fires on a failed *deploy* and says nothing about a service that
deployed fine and is 500ing.

DN-41 asked for "enough to know if it's down or erroring", explicitly not a
full observability stack.

## Decision

**Structured request logging, on stdout, and nothing else in-process.**

`nestjs-pino` writes one JSON line per completed request. Render captures
stdout, so that is the entire mechanism: no agent, no sidecar, no second
service. The decisions the logger makes live in
`apps/api/src/logging/logging.config.ts` and are asserted in the two specs
beside it.

- **Redaction is non-negotiable.** `req.headers.authorization` and cookies in
  both directions. Every authenticated request to this API carries a Clerk
  session token, so an unredacted logger writes a live credential into
  Render's log store on every group — where it outlives the ~60s token and is
  readable by anyone with dashboard access.
- **Request id prefers `cf-request-id`,** then `x-request-id`, else generates
  one. Same trust reasoning as `ProxyAwareThrottlerGuard`: the Cloudflare
  header is edge-written and cannot be forged from outside, and it lets a group
  here be traced back to a Cloudflare event.
- **`userId` correlation** from where `ClerkAuthGuard` stashes it. The
  completion line is emitted at response time, long after the guard ran, so an
  authenticated request is attributed and an unauthenticated one simply has no
  `userId`.
- **`/health` is not logged.** Render probes it continuously; unignored it is
  most of the log volume and every real request is lost in it.
- **JSON in production, `pino-pretty` locally, silent under test.** JSON is
  what makes Render's log search worth using and is unreadable in a terminal;
  `pino-pretty` is a devDependency and is not installed in production. A test
  run that prints hundreds of requests buries the failure it exists to show.

## Rejected: third-party error reporting

Sentry's free tier was planned and then **declined on 2026-09-20**. It would
have meant an account to create, a DSN to keep, and this API's error payloads
leaving our infrastructure — for a service with one instance and one user.

The cost of declining is real and worth stating: an error is now only visible
by going and looking at Render's logs. Nothing pages anyone. DN-60 (first
sign-in 500s) was found by manual verification, and that class of bug would
still be found the same way.

If that cost ever bites, this is the decision to revisit first.

## Deferred: external uptime monitor

An out-of-repo monitor (UptimeRobot free tier or similar) polling
`https://api.regimenworks.com/health` and mailing after two consecutive
failures. Deliberately **outside Render**, so it still alerts when Render
itself is the problem.

Not done here because it is an account signup rather than a code change.
Tracked separately. Nothing in this repo would otherwise reveal whether such a
monitor exists, which is why it is written down here.

## Reasoning

The shape of this project is one instance, one user, and a deploy that is
rarely touched. That makes logs-you-can-search a much better first increment
than alerting-that-pages: it answers "what happened" for every incident, costs
nothing per month, and adds no third party. Alerting answers "something is
happening now", which matters more as soon as there is someone other than the
author to disappoint.
