import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SESSIONS_DIR = path.join(os.homedir(), ".scrapekit", "sessions");

function listSessions() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return [];
    return fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), "utf-8"));
          return {
            file: f,
            id: data.sessionId ? data.sessionId.substring(0, 12) : f,
            requests: data.requestCount || 0,
            cookies: data.cookies ? Object.keys(data.cookies).length : 0,
            created: data.createdAt ? new Date(data.createdAt).toLocaleDateString() : "unknown"
          };
        } catch {
          return { file: f, id: f, requests: 0, cookies: 0, created: "unknown" };
        }
      });
  } catch {
    return [];
  }
}

export default function SessionScreen({ navigate }) {
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    setSessions(listSessions());
  }, []);

  if (sessions.length === 0) {
    return React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1 },
      React.createElement(Text, { bold: true }, "Sessions"),
      React.createElement(Text, { color: "yellow", marginTop: 1 }, "No sessions found."),
      React.createElement(Text, { color: "gray" }, `Looking in: ${SESSIONS_DIR}`),
      React.createElement(Text, { color: "gray" }, "Use --session or --stealth when scraping to create sessions."),
      React.createElement(Box, { marginTop: 1 },
        React.createElement(SelectInput, {
          items: [{ label: "< Back to Home", value: "home" }],
          onSelect: () => navigate("home")
        })
      )
    );
  }

  const items = sessions.map(s => ({
    label: `${s.id}  ${s.requests} req  ${s.cookies} cookies  ${s.created}`,
    value: s.file
  }));
  items.push({ label: "< Back to Home", value: "__home__" });

  return React.createElement(
    Box,
    { flexDirection: "column", marginTop: 1 },
    React.createElement(Text, { bold: true }, "Sessions"),
    React.createElement(Box, { marginTop: 1 },
      React.createElement(SelectInput, {
        items,
        onSelect: (item) => {
          if (item.value === "__home__") {
            navigate("home");
          }
        }
      })
    )
  );
}
