#!/bin/bash
# `npm run dev` (DN-204): the whole local stack from one command. Starts the
# compose Postgres, brings its schema and WOD library up to date, then runs the
# API and the web app side by side until Ctrl-C. Postgres keeps running after
# that; `docker compose stop` stops it.
#
# Kept to bash 3.2 (macOS's /bin/bash) and to tools already on the machine, so
# it adds nothing to the lockfile.

cd "$(dirname "$0")/.." || exit 1

for env in apps/api/.env apps/web/.env; do
  if [ ! -f "$env" ]; then
    echo "Missing $env. Copy $env.example to it and fill in the Clerk keys." >&2
    exit 1
  fi
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running. Start Docker Desktop and try again." >&2
  exit 1
fi

# --wait blocks on the compose healthcheck, so migrate never races Postgres.
docker compose up -d --wait postgres || exit 1

# postinstall builds packages/shared and generates the Prisma client, but a pull
# or branch switch leaves both stale, and then the seed and the API fail on
# exports and models that do exist. Both take seconds, so they run every time.
npm run build --workspace packages/shared || exit 1
npm run prisma:generate --workspace apps/api || exit 1

# `migrate deploy` rather than `migrate dev`: it applies what is committed and
# never prompts or writes a new migration. The seed is idempotent.
npm run prisma:migrate:deploy --workspace apps/api || exit 1
npm run prisma:seed --workspace apps/api || exit 1

# Piping through awk drops the TTY, which would otherwise turn colours off.
export FORCE_COLOR=1

prefix() {
  awk -v tag="$1" '{ print tag " " $0; fflush() }'
}

# One Ctrl-C stops both apps, nest's watcher and vite included: they all share
# this script's process group.
trap 'trap - INT TERM EXIT; kill 0' INT TERM EXIT

# The API doesn't read its .env itself (only prisma.config.ts does), so it is
# sourced here, as .claude/launch.json does.
(set -a; . apps/api/.env; set +a; exec npm run dev:api) 2>&1 | prefix "[api]" &
npm run dev:web 2>&1 | prefix "[web]" &

wait
