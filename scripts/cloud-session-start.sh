#!/bin/bash
# SessionStart hook for Claude Code cloud sessions (DN-182), registered in
# .claude/settings.json. A cloud VM is Ubuntu 24.04 with Node 22 and Postgres 16
# installed but not running, and no node_modules. The API needs Node >= 24.9
# (DN-156), so this fetches Node 24 itself (DN-188), then gets the VM to where
# `npm run test:db` passes without anyone setting it up by hand.
#
# Everything it prints on stdout lands in the session's context, so the noisy
# parts go to a log and stdout gets one line.

if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 1
log=/tmp/cloud-session-start.log

# Node. apps/api's engines.node is >= 24.9; CI uses `node-version: 24`, so this
# takes the latest v24.x from nodejs.org, checks it against SHASUMS256.txt, and
# unpacks it under .cache/ in the project, which the environment cache keeps.
# The bin dir goes on PATH here for npm ci, and in $CLAUDE_ENV_FILE for the
# rest of the session.
node_ok() {
  node -e 'const [a, b] = process.versions.node.split(".").map(Number);
    process.exit(a > 24 || (a === 24 && b >= 9) ? 0 : 1)' 2>/dev/null
}
use_node_dir() {
  export PATH="$1/bin:$PATH"
  if [ -n "$CLAUDE_ENV_FILE" ]; then
    echo "export PATH=\"$1/bin:\$PATH\"" >>"$CLAUDE_ENV_FILE"
  fi
}
install_node() {
  local version tarball tmp dir
  version=$(curl -fsSL https://nodejs.org/dist/index.json |
    node -e 'let s = ""; process.stdin.on("data", d => (s += d)).on("end", () =>
      console.log(JSON.parse(s).find(r => r.version.startsWith("v24.")).version))') ||
    return 1
  dir="$PWD/.cache/node-$version-linux-x64"
  if [ ! -x "$dir/bin/node" ]; then
    tarball="node-$version-linux-x64.tar.gz"
    tmp=$(mktemp -d) || return 1
    (cd "$tmp" &&
      curl -fsSLO "https://nodejs.org/dist/$version/$tarball" &&
      curl -fsSL "https://nodejs.org/dist/$version/SHASUMS256.txt" |
      grep " $tarball\$" | sha256sum --check --status) || { rm -rf "$tmp"; return 1; }
    mkdir -p .cache && tar -xzf "$tmp/$tarball" -C .cache || { rm -rf "$tmp"; return 1; }
    rm -rf "$tmp"
  fi
  use_node_dir "$dir"
}
if node_ok; then
  :
else
  # Reuse a cached copy if the download fails; nodejs.org may be unreachable.
  cached=$(ls -d .cache/node-v24.*-linux-x64 2>/dev/null | sort -V | tail -1)
  if ! install_node >>"$log" 2>&1 && [ -n "$cached" ]; then
    use_node_dir "$PWD/$cached"
  fi
fi
if node_ok; then
  nodeinfo="Node $(node --version)"
else
  nodeinfo="Node 24 download FAILED, still on $(node --version), see $log; API tests need >= 24.9"
fi

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
# has changed since the last success, including the Node version it ran under.
hashes=node_modules/.cloud-session-start.sha256
inputs=(scripts/cloud-session-start.sh package.json package-lock.json
  apps/*/package.json packages/*/package.json apps/api/prisma/schema.prisma)
nodever=node_modules/.cloud-session-start.node
if sha256sum --check --status "$hashes" 2>/dev/null &&
  [ "$(cat "$nodever" 2>/dev/null)" = "$(node --version)" ]; then
  deps="dependencies unchanged"
elif npm ci >>"$log" 2>&1; then
  { sha256sum "${inputs[@]}" >"$hashes" && node --version >"$nodever"; } || rm -f "$hashes"
  deps="npm ci done"
else
  deps="npm ci FAILED, see $log"
fi

echo "Cloud setup: $nodeinfo; Postgres on localhost:5432 (regimen_works/regimen_works); $deps."
exit 0
