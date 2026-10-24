import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { ConfirmWindow } from "./components/ConfirmWindow";
import { ErrorBoundary } from "./components/ErrorBoundary";

// a "New download" window is labelled after its download: "confirm-<id>"
const label = getCurrentWindow().label;
const confirmId = label.startsWith("confirm-") ? label.slice("confirm-".length) : null;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary area="app">{confirmId ? <ConfirmWindow id={confirmId} /> : <App />}</ErrorBoundary>
  </React.StrictMode>,
);
