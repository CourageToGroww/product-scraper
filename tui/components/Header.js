import React from "react";
import { Box, Text } from "ink";

export default function Header() {
  return React.createElement(
    Box,
    { borderStyle: "single", borderColor: "cyan", paddingX: 1 },
    React.createElement(Text, { bold: true, color: "cyan" }, "ScrapeKit"),
    React.createElement(Text, { color: "gray" }, " v1.0.0"),
    React.createElement(Text, { color: "gray" }, "  |  Interactive Mode")
  );
}
