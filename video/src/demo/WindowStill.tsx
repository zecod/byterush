import React from "react";
import { AbsoluteFill } from "remotion";
import { AppWindow, history, liveRow, row } from "../components/AppWindow";
import { DEMO } from "../lib/data";

/** The app window at its real size (for checking layout and positions). */
export const WindowStill: React.FC = () => {
  const rows = [
    liveRow(DEMO, 1.5, { id: "main", added: "21:40" }),
    row({ id: "a", file_name: "blender-4.5.2-linux-x64.tar.xz", url: "https://download.blender.org/release/", size: 360e6, added: "21:12" }),
  ];
  return (
    <AbsoluteFill style={{ background: "#333" }}>
      <AppWindow rows={rows} selected="main" speedHistory={history([{ tel: DEMO, offset: 0 }], 1.5)} />
    </AbsoluteFill>
  );
};
