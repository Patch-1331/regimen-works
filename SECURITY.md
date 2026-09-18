# Security Policy

Regimen Works is a personal project with a live deployment: the API at
<https://api.regimenworks.com> and the web app at
<https://regimenworks.com>, both auto-deployed from `main`. There is
no released version line — `main` is what is running, so security fixes reach
production as soon as they merge.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private vulnerability reporting on this repository
(**Security** → **Report a vulnerability**), which opens a private advisory
visible only to the maintainer.

Expect an acknowledgement within a week. As a solo hobby project this comes
with no formal response-time or disclosure commitment.

## What we do

- **Dependabot alerts and security updates** are enabled; vulnerable
  dependencies open automated pull requests.
- **GitHub Actions** run with a read-only `GITHUB_TOKEN` and third-party
  actions are pinned to full commit SHAs.
- **Secrets** are never committed. `.env` files are gitignored;
  `apps/api/.env.example` documents the required variables with dummy values.
- **gitleaks** scans the full git history on every push and pull request, and
  runs as a pre-commit hook locally (`npm run hooks:install`).
- **CodeQL** static analysis and **dependency review** run on pull requests.
- **Every route requires a verified Clerk session token** — the guard is bound
  globally, so a new controller is authenticated by default rather than by
  remembering to add a decorator. The health check is the sole exception.
- **Every query is scoped to the requesting user**, and the database enforces
  it independently: sessions and logs carry a composite foreign key onto
  `(assignment id, user id)`, so a row whose owner disagrees with its
  assignment's cannot be stored at all.
- **Rate limiting** is applied per client IP across all routes.
- **Sign-up is invite-only.** The repository is public and the database is
  small; open registration would let any passer-by provision rows. This is a
  Clerk dashboard setting, so it leaves no trace in this repository — it is
  recorded here because nothing in the code will reveal it.
- **Admin is one Clerk flag, and it fails closed.** Routes marked
  `@AdminOnly()` are open only to a caller whose session token carries
  `isAdmin: true` — a custom claim the Clerk JWT template fills from
  `publicMetadata.isAdmin`. Two pieces of dashboard config, invisible here like
  the setting above: the claim must be in the template
  (`{"isAdmin": "{{user.public_metadata.isAdmin}}"}`), and the flag must be set
  on the account. If either is missing the claim is absent, which reads as *not*
  an admin — drift can lock an admin out of an admin route, it cannot let an
  athlete into one. Removing the flag takes effect at the caller's next token
  refresh (Clerk session tokens last about a minute) rather than instantly.

## Running the checks yourself

```sh
npm run hooks:install   # one time: enable the pre-commit secret scan
npm run security:scan   # gitleaks over the full history
npm run security:audit  # npm audit, production dependencies only
```

gitleaks is expected on `PATH` (`brew install gitleaks`). The pre-commit hook
skips with a warning if it is missing rather than failing the commit.
