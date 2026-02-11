#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRAPEKIT_DIR="$HOME/.scrapekit"
COMPOSE_FILE="$SCRAPEKIT_DIR/docker-compose.yml"
PROJECT_NAME="scrapekit"
MAIN_CONTAINER="scrapekit-main-db"
DB_USER="scrapekit"
DB_PASS="scrapekit"
DB_NAME="scrapekit"

SERVER_PID=""
STUDIO_PID=""

cleanup() {
  echo -e "\n${YELLOW}Shutting down...${NC}"
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  [ -n "$STUDIO_PID" ] && kill "$STUDIO_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo -e "${GREEN}Done.${NC}"
}
trap cleanup EXIT INT TERM

# --- Port detection (fast — reads kernel socket table, no binding) ---

port_is_free() {
  if command -v ss &>/dev/null; then
    ! ss -tln 2>/dev/null | awk '{print $4}' | grep -q ":${1}$"
  elif command -v nc &>/dev/null; then
    ! nc -z localhost "$1" 2>/dev/null
  else
    return 0
  fi
}

find_available_port() {
  local port=$1
  local max=$((port + 100))
  while ! port_is_free "$port"; do
    port=$((port + 1))
    if [ "$port" -ge "$max" ]; then
      echo "$1"  # give up, return original
      return
    fi
  done
  echo "$port"
}

echo -e "${CYAN}${BOLD}
  ╔══════════════════════════════════╗
  ║     ScrapeKit Workbench          ║
  ╚══════════════════════════════════╝
${NC}"

# --- Step 1: Check Docker ---
if ! command -v docker &>/dev/null; then
  echo -e "${RED}Error: Docker is not installed.${NC}"
  echo "  Install Docker: https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  echo -e "${RED}Error: Docker daemon is not running.${NC}"
  echo "  Start Docker and try again."
  exit 1
fi

echo -e "  ${GREEN}[1/6]${NC} Docker is available"

# --- Step 2: Determine main DB port ---
MAIN_DB_PORT=""

if docker ps --filter "name=^${MAIN_CONTAINER}$" -q 2>/dev/null | grep -q .; then
  # Container is already running — detect its port
  MAIN_DB_PORT=$(docker port "$MAIN_CONTAINER" 5432/tcp 2>/dev/null | head -1 | rev | cut -d: -f1 | rev)
  echo -e "  ${GREEN}[2/6]${NC} Main database already running (port ${MAIN_DB_PORT})"
else
  # Remove stopped container if it exists (data is safe in named volume)
  docker rm -f "$MAIN_CONTAINER" &>/dev/null || true

  # Find an available port
  MAIN_DB_PORT=$(find_available_port 5432)
  echo -e "  ${GREEN}[2/6]${NC} Main database port: ${MAIN_DB_PORT}"
fi

DATABASE_URL="postgres://${DB_USER}:${DB_PASS}@localhost:${MAIN_DB_PORT}/${DB_NAME}"

# --- Step 3: Save config + regenerate compose file ---
echo -ne "  ${YELLOW}[3/6]${NC} Generating docker-compose.yml..."

mkdir -p "$SCRAPEKIT_DIR"
cat > "$SCRAPEKIT_DIR/config.json" <<JSON
{
  "mainDbPort": ${MAIN_DB_PORT}
}
JSON

# Regenerate the single compose file (includes main-db + all job databases)
npx tsx src/server/lib/regen-compose.ts 2>/dev/null

echo -e " ${GREEN}done${NC}"
echo -e "         ${CYAN}${COMPOSE_FILE}${NC}"

# --- Step 4: Start main database via compose ---
echo -ne "  ${YELLOW}[4/6]${NC} Starting main database..."
docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" up -d --quiet-pull main-db 2>/dev/null
echo -e " ${GREEN}done${NC}"

# Wait for Postgres to be ready
echo -ne "         Waiting for Postgres"
RETRIES=30
until docker exec "$MAIN_CONTAINER" pg_isready -U "$DB_USER" -q 2>/dev/null; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    echo -e "\n  ${RED}Error: Postgres did not become ready in time.${NC}"
    exit 1
  fi
  echo -n "."
  sleep 1
done
echo -e " ${GREEN}ready${NC}"

# --- Step 5: Push schema ---
echo -ne "  ${YELLOW}[5/6]${NC} Syncing database schema..."
DATABASE_URL="$DATABASE_URL" npx drizzle-kit push --force >/dev/null 2>&1
echo -e " ${GREEN}done${NC}"

# --- Step 6: Start services ---
echo -e "  ${YELLOW}[6/6]${NC} Starting services..."

# Auto-detect available ports for web services
SERVER_PORT=$(find_available_port "${PORT:-3000}")
STUDIO_PORT=$(find_available_port 4983)

# Start Hono server
DATABASE_URL="$DATABASE_URL" PORT="$SERVER_PORT" STUDIO_PORT="$STUDIO_PORT" npx tsx watch src/server/index.ts &
SERVER_PID=$!

# Start Drizzle Studio (optional)
if [ "${SKIP_STUDIO:-}" != "1" ]; then
  DATABASE_URL="$DATABASE_URL" npx drizzle-kit studio --port "$STUDIO_PORT" >/dev/null 2>&1 &
  STUDIO_PID=$!
fi

sleep 2

echo -e "
  ${GREEN}${BOLD}All services running:${NC}
    Workbench:      ${CYAN}http://localhost:${SERVER_PORT}${NC}
    Drizzle Studio: ${CYAN}$([ "${SKIP_STUDIO:-}" = "1" ] && echo "skipped" || echo "http://localhost:${STUDIO_PORT}")${NC}
    Main Database:  postgres://***:***@localhost:${MAIN_DB_PORT}/${DB_NAME}

  ${BOLD}Compose file:${NC} ${CYAN}${COMPOSE_FILE}${NC}
  All scrape databases are defined in this single file.
  Per-job databases auto-spawn when you create scrapes.

  Press ${YELLOW}Ctrl+C${NC} to stop all services.
"

# Wait for server process
wait $SERVER_PID 2>/dev/null || true
