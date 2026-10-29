import React from "react";
import ReactDOM from "react-dom/client";
// Latin only: the full set shipped 30 font files (Cyrillic, Vietnamese…) that nothing in the
// interface uses; file names in other scripts fall back to the system's monospace font
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-ext-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-ext-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-ext-600.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { ConfirmWindow } from "./components/ConfirmWindow";
import { ErrorBoundary } from "./components/ErrorBoundary";

// the same page serves the main window and the "New download" window
const asking = getCurrentWindow().label === "confirm";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary area="app">{asking ? <ConfirmWindow /> : <App />}</ErrorBoundary>
  </React.StrictMode>,
);
