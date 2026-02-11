import React from "react";
import { Box, Text } from "ink";

export default function StatusBar({ message = "" }) {
  return React.createElement(
    Box,
    { borderStyle: "single", borderColor: "gray", paddingX: 1, marginTop: 1 },
    React.createElement(Text, { color: "gray" }, message || "Press Ctrl+C to exit")
  );
}
