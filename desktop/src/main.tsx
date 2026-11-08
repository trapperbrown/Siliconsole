import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { Overlay } from "./Overlay";
import { config } from "./lib/config";
import { dashboards } from "./lib/dashboards";
import { settings } from "./lib/settings";
import { telemetry } from "./lib/telemetry";
import { initThemes } from "./lib/theme";
import "./index.css";

const isOverlay = new URLSearchParams(location.search).get("view") === "overlay";

async function boot() {
  document.title = isOverlay ? `${config.appName} Overlay` : config.appName;
  if (isOverlay) document.body.classList.add("overlay");
  await settings.init();
  await initThemes();
  await telemetry.init();
  await dashboards.init(isOverlay);
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<React.StrictMode>{isOverlay ? <Overlay /> : <App />}</React.StrictMode>);
}

boot();
