import { createRequire } from "node:module";
import path from "node:path";
import { EventEmitter } from "node:events";
import { db } from "./db.js";
import { scrapeJobs, scrapeResults, datasets, datasetRows } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { runExtraction } from "../routes/extract.js";
import { spawnDatasetDatabase } from "./docker-manager.js";
import { aiParseJobResults, getAiSettings } from "./ai-parser.js";

const require = createRequire(import.meta.url);
// Resolve scrapekit lib relative to the workbench directory (one level up)
const SCRAPEKIT_ROOT = path.resolve(import.meta.dirname, "../../../../");

export interface ScrapeJobConfig {
  urls: string[];
  options: Record<string, unknown>;
  scrapeOpts: Record<string, unknown>;
  extractionConfig?: {
    mode: string;
    config: Record<string, unknown>;
    datasetName?: string;
  };
}

export class ScrapekitAdapter extends EventEmitter {
  async runJob(jobId: number, config: ScrapeJobConfig): Promise<void> {
    const GenericScraper = require(path.join(SCRAPEKIT_ROOT, "lib/scrapers/generic-scraper"));

    const totalUrls = config.urls.length;

    // Mark job as running
    await db.update(scrapeJobs)
      .set({
        status: "running",
        startedAt: new Date(),
        progress: { completed: 0, total: totalUrls }
      })
      .where(eq(scrapeJobs.id, jobId));

    const logs: string[] = [];
    const logger = {
      log: (...args: unknown[]) => {
        const msg = args.map(String).join(" ");
        logs.push(msg);
        this.emit("log", { jobId, message: msg });
      },
      error: (...args: unknown[]) => {
        const msg = args.map(String).join(" ");
        logs.push(`[ERROR] ${msg}`);
        this.emit("log", { jobId, message: `[ERROR] ${msg}` });
      }
    };

    const onProgress = (event: Record<string, unknown>) => {
      this.emit("progress", { jobId, ...event });

      // Persist progress to DB on url:done and error events
      const phase = event.phase as string;
      if (phase === "url:done" || phase === "error") {
        const urlIndex = (event.urlIndex as number) + 1;
        const currentUrl = event.url as string | undefined;
        db.update(scrapeJobs)
          .set({ progress: { completed: urlIndex, total: totalUrls, currentUrl } })
          .where(eq(scrapeJobs.id, jobId))
          .then(() => {})
          .catch(() => {});
      }
    };

    try {
      const scraper = new GenericScraper({
        ...config.options,
        logger,
        onProgress
      });

      const urls = config.urls.length === 1 ? config.urls[0] : config.urls;
      const result = await scraper.scrape(urls, config.scrapeOpts);

      // Store individual results in main DB
      if (result.results?.results) {
        for (const r of result.results.results) {
          if (!r) continue;
          await db.insert(scrapeResults).values({
            jobId,
            url: r.url || "",
            status: r.status || 0,
            originalStatus: r.originalStatus || r.status || 0,
            timing: r.timing || 0,
            responseType: r.responseType || "html",
            extractedData: r.extracted || null,
            autoparseData: r.autoparse || null,
            networkRequests: r.networkRequests || null,
            convertedContent: r.convertedContent || null,
            rawHtml: r.html || null,
            screenshotBase64: r.screenshotBase64 || null,
            error: r.error || null
          });
        }
      }

      // Auto-extract if extraction config was provided
      if (config.extractionConfig) {
        try {
          const { mode, config: extConfig, datasetName } = config.extractionConfig;
          const allResults = await db.select().from(scrapeResults).where(eq(scrapeResults.jobId, jobId));
          const withHtml = allResults.filter(r => r.rawHtml);

          if (withHtml.length > 0 && datasetName) {
            const rows: Record<string, unknown>[] = [];
            for (const r of withHtml) {
              try {
                const data = runExtraction(r.rawHtml!, mode, extConfig);
                if (Array.isArray(data)) {
                  for (const item of data) rows.push({ url: r.url, ...item });
                } else {
                  rows.push({ url: r.url, ...data });
                }
              } catch { /* skip failed extractions */ }
            }

            if (rows.length > 0) {
              const schema = Object.fromEntries(
                Object.entries(rows[0]).map(([k, v]) => [k, typeof v])
              );

              const [dataset] = await db.insert(datasets).values({
                name: datasetName,
                sourceJobId: jobId,
                schema,
                rowCount: rows.length,
                extractionConfig: { mode, config: extConfig }
              }).returning();

              const rowValues = rows.map((data, i) => ({
                datasetId: dataset.id,
                data,
                rowIndex: i
              }));
              for (let i = 0; i < rowValues.length; i += 500) {
                await db.insert(datasetRows).values(rowValues.slice(i, i + 500));
              }

              // Spawn Docker DB async (fire-and-forget)
              spawnDatasetDatabase(dataset.id, datasetName, Object.keys(schema), rows)
                .then((spawn) => {
                  db.update(datasets)
                    .set({ databasePort: spawn.port, databaseContainerId: spawn.containerId, databaseStatus: "running" })
                    .where(eq(datasets.id, dataset.id))
                    .catch(() => {});
                })
                .catch(() => {
                  db.update(datasets)
                    .set({ databaseStatus: "none" })
                    .where(eq(datasets.id, dataset.id))
                    .catch(() => {});
                });
            }
          }
        } catch (extractErr) {
          // Extraction failure should not fail the scrape job
          console.error(`[scrape:${jobId}] Auto-extraction failed:`, extractErr);
        }
      }

      // AI auto-parse if enabled in settings
      try {
        const aiSettings = await getAiSettings();
        if (aiSettings?.autoparse) {
          console.log(`[scrape:${jobId}] AI auto-parse starting (${aiSettings.provider}, mode: ${aiSettings.mode})`);
          await aiParseJobResults(jobId, aiSettings.provider, aiSettings.apiKey, aiSettings.mode);
          console.log(`[scrape:${jobId}] AI auto-parse completed`);
        }
      } catch (aiErr) {
        console.error(`[scrape:${jobId}] AI auto-parse failed:`, aiErr);
      }

      // Mark job complete
      await db.update(scrapeJobs)
        .set({
          status: "completed",
          completedAt: new Date(),
          progress: { completed: totalUrls, total: totalUrls },
          resultSummary: {
            resultsCount: result.results?.results_count || 0,
            errorsCount: result.results?.errors_count || 0,
            outputDir: result.outputDir
          }
        })
        .where(eq(scrapeJobs.id, jobId));

      this.emit("done", { jobId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.update(scrapeJobs)
        .set({
          status: "failed",
          completedAt: new Date(),
          errorMessage: message
        })
        .where(eq(scrapeJobs.id, jobId));

      this.emit("error", { jobId, error: message });
    }
  }
}

export const adapter = new ScrapekitAdapter();
