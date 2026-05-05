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
