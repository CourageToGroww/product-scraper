import React from "react";
import { Box, Text, useApp } from "ink";
import SelectInput from "ink-select-input";

const menuItems = [
  { label: "New Scrape", value: "scrape:config" },
  { label: "Browse Results", value: "results" },
  { label: "Sessions", value: "sessions" },
  { label: "Settings", value: "settings" },
  { label: "Quit", value: "quit" }
];

export default function HomeScreen({ navigate }) {
  const { exit } = useApp();

  const handleSelect = (item) => {
    if (item.value === "quit") {
      exit();
      return;
    }
    navigate(item.value);
  };

  return React.createElement(
    Box,
    { flexDirection: "column", marginTop: 1 },
    React.createElement(Text, { bold: true }, "What would you like to do?"),
    React.createElement(Box, { marginTop: 1 },
      React.createElement(SelectInput, { items: menuItems, onSelect: handleSelect })
    )
  );
}
