# product-scraper

ScrapeKit — modular product scraping workbench with per-job isolated databases.

## Quick Start

Single command to launch the full ScrapeKit workbench:

```bash
cd workbench
npm install
npm run up
```

This will:

1. Create the `scrapekit-net` Docker network (if missing).
2. Start the main Postgres container (`scrapekit-main-db`) on port 5432.
3. Apply Drizzle schema migrations.
4. Start the workbench Hono server on `http://localhost:3000`.
5. Start the Vite dev client on `http://localhost:5173`.
6. Start Drizzle Studio on `http://localhost:4983` (or `https://local.drizzle.studio`).

Stop the stack with Ctrl-C — all three processes terminate together.

### Per-job and per-dataset databases

Each scrape job and each materialized dataset gets its own Postgres container, spawned on demand by the workbench API. These containers join `scrapekit-net` automatically and are reachable from other containers by their slug (for example, `scrapekit-db-job-3-foo`). The lifecycle of every container (creating, running, stopped, destroyed) is tracked in the `containers` table of the main DB.

### Overriding defaults

Override defaults via environment variables before running `npm run up`:

- `PG_HOST` (default `localhost`)
- `PG_PORT` (default `5432`)
- `PG_USER` (default `scrapekit`)
- `PG_DB` (default `scrapekit`)
- `DATABASE_URL` (built from the above by default; set explicitly to override entirely)

## Features

- **Single-command launch:** `npm run up` brings up Postgres, workbench Hono+Vite server, and Drizzle Studio.
- **AI pipeline:** scraped data is automatically transformed by an LLM into a typed Drizzle schema, populated into a per-job Postgres container, and served by an auto-generated Hono REST API.
- **AI editing:** chat with the LLM to refine the schema or add custom routes; click "Rebuild API service" to redeploy.
- **Per-job Drizzle Studio:** click "Open in Drizzle Studio" to launch a Studio instance pointed at the job's dataset DB.
- **Export bundles:** `Build export bundle` and `Download .tar.gz` produce a self-contained directory (compose + dump + Hono service source + README) that runs anywhere with Docker.
- **Multi-dataset merge:** the Merges page combines N existing dataset DBs into a new container via `postgres_fdw`.

## Configuration

Override defaults via environment variables before running `npm run up`:

| Var                                  | Default                                                          | Purpose |
|--------------------------------------|------------------------------------------------------------------|---------|
| `PG_HOST`                            | `localhost`                                                      | Main Postgres host |
| `PG_PORT`                            | `5432`                                                           | Main Postgres host port (override if 5432 is taken) |
| `PG_USER`                            | `scrapekit`                                                      | Main Postgres user |
| `PG_DB`                              | `scrapekit`                                                      | Main Postgres database |
| `DATABASE_URL`                       | composed from the above                                          | Set explicitly to override entirely |
| `SCRAPEKIT_KEY_ENCRYPTION_KEY`       | derived dev fallback (NOT for production)                        | base64-encoded 32-byte AES-256 key for `settings` table |

Generate a production encryption key:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Architecture

ScrapeKit runs everything as containers on a shared Docker bridge network `scrapekit-net`:

- `scrapekit-main-db` — workbench's own Postgres (jobs, datasets, pipeline runs, container registry)
- `scrapekit-db-<slug>` — per-job/dataset/standalone/merge-target Postgres containers (port pool 5500-5999 on host)
- `scrapekit-job-<jobId>-api-<port>` — AI-generated Hono service containers (port pool 6500-6999 on host)
- Per-job Drizzle Studio instances (port pool 7500-7999 on host)

Plans driving this architecture live under `docs/superpowers/plans/`.
