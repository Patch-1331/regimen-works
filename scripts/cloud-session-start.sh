#!/bin/bash
# SessionStart hook for Claude Code cloud sessions (DN-182), registered in
# .claude/settings.json. A cloud VM is Ubuntu 24.04 with Node 22 and Postgres 16
# installed but not running, and no node_modules. This gets it to where
# `npm run test:db` passes without anyone setting it up by hand.
#
# Everything it prints on stdout lands in the session's context, so the noisy
# parts go to a log and stdout gets one line.

if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 1
log=/tmp/cloud-session-start.log

# Postgres. Credentials match docker-compose.yml, ci.yml, and the
# TEST_DATABASE_URL / E2E_DATABASE_URL defaults. Superuser because the DB
# suites drop and recreate their own databases. The environment cache keeps
# files, not processes, so the server has to be started every session.
service postgresql start >>"$log" 2>&1
psql_as_postgres() { runuser -u postgres -- psql -tAc "$1" 2>>"$log"; }
if [ "$(psql_as_postgres "SELECT 1 FROM pg_roles WHERE rolname = 'regimen_works'")" != "1" ]; then
  psql_as_postgres "CREATE ROLE regimen_works LOGIN SUPERUSER PASSWORD 'regimen_works'" >/dev/null
fi
if [ "$(psql_as_postgres "SELECT 1 FROM pg_database WHERE datname = 'regimen_works'")" != "1" ]; then
  psql_as_postgres "CREATE DATABASE regimen_works OWNER regimen_works" >/dev/null
fi

# Dependencies. `npm ci`, never `npm install`: the latter rewrites the lockfile
# and drops the Linux platform packages Render needs (npm/cli#4828). Skipped
# while nothing npm ci or its postinstall (shared build, prisma generate) reads
# has changed since the last success.
hashes=node_modules/.cloud-session-start.sha256
inputs=(scripts/cloud-session-start.sh package.json package-lock.json
  apps/*/package.json packages/*/package.json apps/api/prisma/schema.prisma)
if sha256sum --check --status "$hashes" 2>/dev/null; then
  deps="dependencies unchanged"
elif npm ci >>"$log" 2>&1; then
  sha256sum "${inputs[@]}" >"$hashes" || rm -f "$hashes"
  deps="npm ci done"
else
  deps="npm ci FAILED, see $log"
fi

echo "Cloud setup: Postgres on localhost:5432 (regimen_works/regimen_works); $deps."
exit 0
