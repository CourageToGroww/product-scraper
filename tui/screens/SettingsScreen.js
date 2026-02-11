import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import * as configStore from "../lib/config-store.js";

const SETTING_KEYS = [
  { key: "outputDir", label: "Output Directory", type: "string" },
  { key: "concurrency", label: "Concurrency", type: "number" },
  { key: "delay", label: "Delay (ms)", type: "number" },
  { key: "timeout", label: "Timeout (ms)", type: "number" },
  { key: "retry", label: "Max Retries", type: "number" },
  { key: "defaultOutput", label: "Default Output Format", type: "string" },
  { key: "proxyFile", label: "Proxy File Path", type: "string" },
  { key: "captchaKey", label: "Captcha API Key", type: "string" }
];

export default function SettingsScreen({ navigate, setStatusMessage }) {
  const [config, setConfig] = useState(() => configStore.load());
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState("");

  if (editing) {
    const setting = SETTING_KEYS.find(s => s.key === editing);

    return React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1 },
      React.createElement(Text, { bold: true }, `Edit: ${setting.label}`),
      React.createElement(Text, { color: "gray" }, `Current: ${config[editing]}`),
      React.createElement(Box, { marginTop: 1 },
        React.createElement(Text, { color: "cyan" }, "> "),
        React.createElement(TextInput, {
          value: editValue,
          onChange: setEditValue,
          onSubmit: (val) => {
            const newVal = setting.type === "number" ? parseInt(val, 10) : val;
            if (setting.type === "number" && isNaN(newVal)) {
              setStatusMessage("Invalid number");
              return;
            }
            const newConfig = { ...config, [editing]: newVal };
            configStore.save(newConfig);
            setConfig(newConfig);
            setEditing(null);
            setEditValue("");
            setStatusMessage(`Saved: ${setting.label} = ${newVal}`);
          }
        })
      )
    );
  }

  const items = SETTING_KEYS.map(s => ({
    label: `${s.label}: ${s.key === "captchaKey" && config[s.key] ? "***" : (config[s.key] || "(not set)")}`,
    value: s.key
  }));
  items.push({ label: "< Back to Home", value: "__home__" });

  return React.createElement(
    Box,
    { flexDirection: "column", marginTop: 1 },
    React.createElement(Text, { bold: true }, "Settings"),
    React.createElement(Text, { color: "gray" }, `Config file: ~/.scrapekit/config.json`),
    React.createElement(Box, { marginTop: 1 },
      React.createElement(SelectInput, {
        items,
        onSelect: (item) => {
          if (item.value === "__home__") {
            navigate("home");
            return;
          }
          setEditing(item.value);
          setEditValue(String(config[item.value] || ""));
        }
      })
    )
  );
}
