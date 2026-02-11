import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import * as configStore from "../lib/config-store.js";

const OUTPUT_OPTIONS = [
  { label: "JSON", value: "json" },
  { label: "CSV", value: "csv" },
  { label: "Markdown", value: "markdown" },
  { label: "Text", value: "text" },
  { label: "HTML", value: "html" }
];

const EXTRACT_OPTIONS = [
  { label: "None", value: "none" },
  { label: "Auto-Parse (all)", value: "auto:all" },
  { label: "Auto-Parse (emails, phones, links)", value: "auto:emails,phones,links" },
  { label: "CSS Selectors (enter manually)", value: "css" }
];

const ADVANCED_OPTIONS = [
  { label: "Start Scrape", value: "go" },
  { label: "Enable JS Rendering", value: "jsRender" },
  { label: "Enable Stealth Mode", value: "stealth" },
  { label: "Back to Home", value: "back" }
];

export default function ScrapeConfigScreen({ navigate, setStatusMessage }) {
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState("");
  const [outputFormat, setOutputFormat] = useState("json");
  const [extractMode, setExtractMode] = useState("none");
  const [cssSchema, setCssSchema] = useState("");
  const [jsRender, setJsRender] = useState(false);
  const [stealth, setStealth] = useState(false);

  const defaults = configStore.load();

  // Step 0: URL input
  if (step === 0) {
    return React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1 },
      React.createElement(Text, { bold: true }, "Step 1: Enter URL(s)"),
      React.createElement(Text, { color: "gray" }, "Separate multiple URLs with commas"),
      React.createElement(Box, { marginTop: 1 },
        React.createElement(Text, { color: "cyan" }, "> "),
        React.createElement(TextInput, {
          value: url,
          onChange: setUrl,
          onSubmit: () => {
            if (url.trim()) setStep(1);
          }
        })
      )
    );
  }

  // Step 1: Extraction mode
  if (step === 1) {
    return React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1 },
      React.createElement(Text, { bold: true }, "Step 2: Extraction Mode"),
      React.createElement(Box, { marginTop: 1 },
        React.createElement(SelectInput, {
          items: EXTRACT_OPTIONS,
          onSelect: (item) => {
            setExtractMode(item.value);
            if (item.value === "css") {
              setStep(2);
            } else {
              setStep(3);
            }
          }
        })
      )
    );
  }

  // Step 2: CSS schema (only if css mode)
  if (step === 2) {
    return React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1 },
      React.createElement(Text, { bold: true }, "Enter CSS extraction schema (JSON):"),
      React.createElement(Text, { color: "gray" }, 'Example: {"title":"h1","price":".price"}'),
      React.createElement(Box, { marginTop: 1 },
        React.createElement(Text, { color: "cyan" }, "> "),
        React.createElement(TextInput, {
          value: cssSchema,
          onChange: setCssSchema,
          onSubmit: () => setStep(3)
        })
      )
    );
  }

  // Step 3: Output format
  if (step === 3) {
    return React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1 },
      React.createElement(Text, { bold: true }, "Step 3: Output Format"),
      React.createElement(Box, { marginTop: 1 },
        React.createElement(SelectInput, {
          items: OUTPUT_OPTIONS,
          onSelect: (item) => {
            setOutputFormat(item.value);
            setStep(4);
          }
        })
      )
    );
  }

  // Step 4: Advanced options + launch
  if (step === 4) {
    const items = ADVANCED_OPTIONS.map(opt => {
      if (opt.value === "jsRender") {
        return { ...opt, label: `${jsRender ? "[x]" : "[ ]"} JS Rendering` };
      }
      if (opt.value === "stealth") {
        return { ...opt, label: `${stealth ? "[x]" : "[ ]"} Stealth Mode` };
      }
      return opt;
    });

    return React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1 },
      React.createElement(Text, { bold: true }, "Step 4: Advanced Options"),
      React.createElement(Box, { marginTop: 1, flexDirection: "column" },
        React.createElement(Text, { color: "gray" }, `  URL: ${url}`),
        React.createElement(Text, { color: "gray" }, `  Extract: ${extractMode}`),
        React.createElement(Text, { color: "gray" }, `  Output: ${outputFormat}`)
      ),
      React.createElement(Box, { marginTop: 1 },
        React.createElement(SelectInput, {
          items,
          onSelect: (item) => {
            if (item.value === "back") {
              navigate("home");
              return;
            }
            if (item.value === "jsRender") {
              setJsRender(!jsRender);
              return;
            }
            if (item.value === "stealth") {
              setStealth(!stealth);
              return;
            }
            if (item.value === "go") {
              // Build config and start scrape
              const urls = url.split(",").map(u => u.trim()).filter(Boolean);
              const config = {
                urls,
                scraperOpts: {
                  timeout: defaults.timeout,
                  retry: defaults.retry,
                  concurrency: defaults.concurrency,
                  delay: defaults.delay,
                  verbose: true,
                  jsRender: jsRender || stealth,
                  stealth,
                  rotateUa: defaults.rotateUa || stealth,
                  outputBase: defaults.outputDir
                },
                scrapeOpts: {
                  output: outputFormat,
                  autoParse: extractMode.startsWith("auto:") ? extractMode.slice(5) : undefined,
                  extract: extractMode === "css" && cssSchema ? cssSchema : undefined
                }
              };
              setStatusMessage("Starting scrape...");
              navigate("scrape:run", config);
            }
          }
        })
      )
    );
  }

  return null;
}
