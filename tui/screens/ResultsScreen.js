import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import fs from "node:fs";
import path from "node:path";

const OUTPUT_DIR = path.resolve("./output");

function listOutputDirs() {
  try {
    if (!fs.existsSync(OUTPUT_DIR)) return [];
    return fs.readdirSync(OUTPUT_DIR)
      .filter(d => fs.statSync(path.join(OUTPUT_DIR, d)).isDirectory())
      .map(d => {
        const stat = fs.statSync(path.join(OUTPUT_DIR, d));
        const files = fs.readdirSync(path.join(OUTPUT_DIR, d));
        return { name: d, modified: stat.mtime, fileCount: files.length, files };
      })
      .sort((a, b) => b.modified - a.modified);
  } catch {
    return [];
  }
}

function previewFile(filepath, maxLines = 20) {
  try {
    const content = fs.readFileSync(filepath, "utf-8");
    const lines = content.split("\n").slice(0, maxLines);
    return lines.join("\n");
  } catch {
    return "(unable to read file)";
  }
}

export default function ResultsScreen({ navigate }) {
  const [dirs, setDirs] = useState([]);
  const [selectedDir, setSelectedDir] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState("");

  useEffect(() => {
    setDirs(listOutputDirs());
  }, []);

  // File preview mode
  if (selectedFile) {
    return React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1 },
      React.createElement(Text, { bold: true }, `Preview: ${path.basename(selectedFile)}`),
      React.createElement(
        Box,
        { marginTop: 1, borderStyle: "single", borderColor: "gray", paddingX: 1 },
        React.createElement(Text, { color: "gray", wrap: "truncate" }, preview)
      ),
      React.createElement(Box, { marginTop: 1 },
        React.createElement(SelectInput, {
          items: [
            { label: "Back to files", value: "back" },
            { label: "Back to directories", value: "dirs" },
            { label: "Home", value: "home" }
          ],
          onSelect: (item) => {
            if (item.value === "back") {
              setSelectedFile(null);
            } else if (item.value === "dirs") {
              setSelectedFile(null);
              setSelectedDir(null);
            } else {
              navigate("home");
            }
          }
        })
      )
    );
  }

  // File list mode
  if (selectedDir) {
    const dir = dirs.find(d => d.name === selectedDir);
    if (!dir) return null;

    const fileItems = dir.files.map(f => {
      const stat = fs.statSync(path.join(OUTPUT_DIR, dir.name, f));
      const size = stat.size < 1024 ? `${stat.size} B` :
        stat.size < 1048576 ? `${(stat.size / 1024).toFixed(1)} KB` :
          `${(stat.size / 1048576).toFixed(1)} MB`;
      return { label: `${f} (${size})`, value: f };
    });
    fileItems.push({ label: "< Back", value: "__back__" });

    return React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1 },
      React.createElement(Text, { bold: true }, `Files in ${dir.name}/`),
      React.createElement(Box, { marginTop: 1 },
        React.createElement(SelectInput, {
          items: fileItems,
          onSelect: (item) => {
            if (item.value === "__back__") {
              setSelectedDir(null);
              return;
            }
            const filepath = path.join(OUTPUT_DIR, dir.name, item.value);
            setPreview(previewFile(filepath));
            setSelectedFile(filepath);
          }
        })
      )
    );
  }

  // Directory list mode
  if (dirs.length === 0) {
    return React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1 },
      React.createElement(Text, { color: "yellow" }, "No output directories found."),
      React.createElement(Text, { color: "gray" }, `Looking in: ${OUTPUT_DIR}`),
      React.createElement(Box, { marginTop: 1 },
        React.createElement(SelectInput, {
          items: [
            { label: "New Scrape", value: "scrape:config" },
            { label: "Home", value: "home" }
          ],
          onSelect: (item) => navigate(item.value)
        })
      )
    );
  }

  const dirItems = dirs.map(d => ({
    label: `${d.name} (${d.fileCount} files, ${d.modified.toLocaleDateString()})`,
    value: d.name
  }));
  dirItems.push({ label: "< Back to Home", value: "__home__" });

  return React.createElement(
    Box,
    { flexDirection: "column", marginTop: 1 },
    React.createElement(Text, { bold: true }, "Scrape Results"),
    React.createElement(Box, { marginTop: 1 },
      React.createElement(SelectInput, {
        items: dirItems,
        onSelect: (item) => {
          if (item.value === "__home__") {
            navigate("home");
            return;
          }
          setSelectedDir(item.value);
        }
      })
    )
  );
}
