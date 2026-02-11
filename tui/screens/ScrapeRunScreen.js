import React, { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import SelectInput from "ink-select-input";
import ScraperBridge from "../lib/scraper-bridge.js";

export default function ScrapeRunScreen({ config, navigate, setStatusMessage }) {
  const [logs, setLogs] = useState([]);
  const [phase, setPhase] = useState("starting");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const bridgeRef = useRef(null);

  useEffect(() => {
    if (!config || bridgeRef.current) return;

    const bridge = new ScraperBridge(config.scraperOpts);
    bridgeRef.current = bridge;

    bridge.on("log", (msg) => {
      setLogs(prev => [...prev.slice(-30), msg]);
    });

    bridge.on("progress", (event) => {
      setPhase(event.phase);
      if (event.totalUrls) {
        setProgress({ current: (event.urlIndex || 0) + 1, total: event.totalUrls });
      }
    });

    bridge.on("done", (r) => {
      setResult(r);
      setDone(true);
      setStatusMessage("Scrape complete!");
    });

    bridge.on("error", (err) => {
      setError(err.message);
      setDone(true);
      setStatusMessage("Scrape failed");
    });

    const urls = config.urls.length === 1 ? config.urls[0] : config.urls;
    bridge.run(urls, config.scrapeOpts).catch(() => {});
  }, [config]);

  if (done) {
    const doneItems = [
      { label: "View Results", value: "results" },
      { label: "New Scrape", value: "scrape:config" },
      { label: "Home", value: "home" }
    ];

    return React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1 },
      error
        ? React.createElement(Text, { color: "red", bold: true }, `Scrape failed: ${error}`)
        : React.createElement(
            Box,
            { flexDirection: "column" },
            React.createElement(Text, { color: "green", bold: true }, "Scrape Complete!"),
            result && React.createElement(Text, { color: "gray" },
              `  ${result.results.results_count} result(s), ${result.results.errors_count} error(s)`
            ),
            result && React.createElement(Text, { color: "gray" },
              `  Output: ${result.outputDir}`
            )
          ),
      React.createElement(Box, { marginTop: 1 },
        React.createElement(SelectInput, {
          items: doneItems,
          onSelect: (item) => navigate(item.value)
        })
      )
    );
  }

  const visibleLogs = logs.slice(-15);

  return React.createElement(
    Box,
    { flexDirection: "column", marginTop: 1 },
    React.createElement(
      Box,
      { gap: 1 },
      React.createElement(Spinner, { type: "dots" }),
      React.createElement(Text, { bold: true },
        progress.total > 0
          ? `Scraping [${progress.current}/${progress.total}]`
          : "Initializing..."
      ),
      React.createElement(Text, { color: "gray" }, ` (${phase})`)
    ),
    React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1, borderStyle: "single", borderColor: "gray", paddingX: 1, height: 17 },
      ...visibleLogs.map((line, i) =>
        React.createElement(Text, { key: i, color: "gray", wrap: "truncate" }, line)
      )
    )
  );
}
