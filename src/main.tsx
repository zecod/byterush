import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
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
