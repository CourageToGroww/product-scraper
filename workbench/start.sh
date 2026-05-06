#!/usr/bin/env bash
set -euo pipefail

# ScrapeKit single-command launcher.
#
# Brings up:
#   - Docker network: scrapekit-net (created if missing)
#   - Main Postgres container: scrapekit-main-db (via root docker-compose.yml)
#   - Drizzle migrations applied to the main DB
#   - Workbench server (Hono, port 3000) and client (Vite, port 5173)
#   - Drizzle Studio (port 4983)
#
# Override defaults via env vars:
#   PG_HOST, PG_PORT, PG_USER, PG_DB, DATABASE_URL
#
# NOTE: The developer's main Postgres container (scrapekit-main-db) is exposed
# on host port 5434 (not 5432) because port 5432 is taken by an unrelated
# Postgres on that machine. For fresh checkouts the default remains 5432.
# Override with: PG_PORT=5434 npm run up
# or: DATABASE_URL=postgres://scrapekit:scrapekit@localhost:5434/scrapekit npm run up
#
# This script is invoked by `npm run up` from the workbench/ directory.

NETWORK="scrapekit-net"
MAIN_DB_CONTAINER="scrapekit-main-db"
PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-scrapekit}"
PG_DB="${PG_DB:-scrapekit}"
DATABASE_URL="${DATABASE_URL:-postgres://scrapekit:scrapekit@${PG_HOST}:${PG_PORT}/${PG_DB}}"
export DATABASE_URL

# Threaded into root docker-compose.yml so its postgres service binds the same
# host port as PG_PORT (avoids 5432 conflicts when an unrelated Postgres is
# already on the host).
export MAIN_DB_HOST_PORT="$PG_PORT"

# 1. Sanity check Docker
if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker daemon is not running. Start Docker and retry." >&2
  exit 1
fi

# 2. Ensure scrapekit-net network exists
if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "Creating Docker network: $NETWORK"
  docker network create --driver bridge \
    --label "com.scrapekit.managed=true" \
    "$NETWORK" >/dev/null
else
  echo "Network $NETWORK already exists."
fi

# 3. Bring up main Postgres (only that service from root compose).
# If a container named scrapekit-main-db already exists (running or stopped),
# reuse it instead of letting compose conflict on the name. This handles the
# common case where the container was created out-of-band (e.g. a prior
# session, a manually-started dev DB) and the host port differs from compose.
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXISTING_ID="$(docker ps -aq -f name="^${MAIN_DB_CONTAINER}$")"
if [ -n "$EXISTING_ID" ]; then
  EXISTING_STATE="$(docker inspect -f '{{.State.Status}}' "$EXISTING_ID" 2>/dev/null || echo "unknown")"
  echo "Found existing $MAIN_DB_CONTAINER (state: $EXISTING_STATE); reusing it."
  if [ "$EXISTING_STATE" != "running" ]; then
    echo "Starting existing $MAIN_DB_CONTAINER..."
    docker start "$MAIN_DB_CONTAINER" >/dev/null
  fi
  # Ensure it's attached to scrapekit-net (idempotent, will warn if already on it).
  docker network connect "$NETWORK" "$MAIN_DB_CONTAINER" 2>/dev/null || true
else
  echo "Starting main Postgres ($MAIN_DB_CONTAINER) via compose..."
  ( cd "$ROOT_DIR" && docker compose up -d postgres )
fi

# 4. Wait for Postgres to be healthy
echo "Waiting for main Postgres to be ready..."
for i in $(seq 1 60); do
  if docker exec "$MAIN_DB_CONTAINER" pg_isready -U "$PG_USER" >/dev/null 2>&1; then
    echo "Main Postgres ready."
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "Error: main Postgres did not become ready within 60s." >&2
    exit 1
  fi
  sleep 1
done

# 5. Apply migrations to main DB
WORKBENCH_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "Pushing schema to main DB..."
( cd "$WORKBENCH_DIR" && npx drizzle-kit push --force )

# 6. Start dev server (Hono+Vite) and Drizzle Studio in parallel
echo "Starting workbench dev server + Drizzle Studio..."
cd "$WORKBENCH_DIR"

# concurrently runs all three, prefixes output, kills siblings on exit
exec npx concurrently \
  --names "server,client,studio" \
  --prefix-colors "cyan,green,magenta" \
  --kill-others-on-fail \
  "npm run dev" \
  "npm run dev:client" \
  "npx drizzle-kit studio --port 4983"
