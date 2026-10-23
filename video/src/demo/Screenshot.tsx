import React from "react";
import { AbsoluteFill } from "remotion";
import { AppWindow, history, liveRow, row } from "../components/AppWindow";
import { HANDOVER } from "../lib/data";

/** The main window mid-download (a real recording), for the README and the website. */
export const Screenshot: React.FC<{ theme: "dark" | "light"; t: number }> = ({ theme, t }) => {
  const rows = [
    liveRow(HANDOVER, t, { id: "live", added: "21:41" }),
    row({ id: "a", file_name: "Sintel_Documentary_by_Ali_Boubred.avi", url: "https://archive.org/download/Sintel/", size: 961242162, added: "21:40" }),
    row({ id: "b", file_name: "blender-4.5.2-linux-x64.tar.xz", url: "https://download.blender.org/release/", size: 360e6, added: "21:12" }),
    row({ id: "c", file_name: "annual-report-2025.pdf", url: "https://example.com/reports/", size: 4.2e6, added: "20:55" }),
    row({ id: "d", file_name: "node-v22.22.0-x64.msi", url: "https://nodejs.org/dist/", size: 31e6, added: "20:31" }),
  ];
  return (
    <AbsoluteFill>
      <AppWindow theme={theme} rows={rows} selected="live" speedHistory={history([{ tel: HANDOVER, offset: 50 }], 50 + t)} style={{ borderRadius: 0, border: "none", boxShadow: "none" }} />
    </AbsoluteFill>
  );
};
