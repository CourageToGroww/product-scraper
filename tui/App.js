import React, { useState } from "react";
import { Box, Text } from "ink";
import Header from "./components/Header.js";
import StatusBar from "./components/StatusBar.js";
import HomeScreen from "./screens/HomeScreen.js";
import ScrapeConfigScreen from "./screens/ScrapeConfigScreen.js";
import ScrapeRunScreen from "./screens/ScrapeRunScreen.js";
import ResultsScreen from "./screens/ResultsScreen.js";
import SessionScreen from "./screens/SessionScreen.js";
import SettingsScreen from "./screens/SettingsScreen.js";

export default function App() {
  const [screen, setScreen] = useState("home");
  const [scrapeConfig, setScrapeConfig] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");

  const navigate = (target, data) => {
    if (target === "scrape:run" && data) {
      setScrapeConfig(data);
    }
    if (target === "scrape:done" && data) {
      setLastResult(data);
    }
    setScreen(target);
  };

  let content;
  switch (screen) {
    case "home":
      content = React.createElement(HomeScreen, { navigate });
      break;
    case "scrape:config":
      content = React.createElement(ScrapeConfigScreen, { navigate, setStatusMessage });
      break;
    case "scrape:run":
      content = React.createElement(ScrapeRunScreen, { config: scrapeConfig, navigate, setStatusMessage });
      break;
    case "scrape:done":
      content = React.createElement(ScrapeRunScreen, { config: scrapeConfig, navigate, setStatusMessage, done: true, result: lastResult });
      break;
    case "results":
      content = React.createElement(ResultsScreen, { navigate });
      break;
    case "sessions":
      content = React.createElement(SessionScreen, { navigate });
      break;
    case "settings":
      content = React.createElement(SettingsScreen, { navigate, setStatusMessage });
      break;
    default:
      content = React.createElement(HomeScreen, { navigate });
  }

  return React.createElement(
    Box,
    { flexDirection: "column", width: "100%" },
    React.createElement(Header, null),
    React.createElement(Box, { flexDirection: "column", paddingX: 1, flexGrow: 1 }, content),
    React.createElement(StatusBar, { message: statusMessage })
  );
}
