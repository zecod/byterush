import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { AppWindow, history, liveRow, row, WINDOW } from "../components/AppWindow";
import { Backdrop } from "../components/Backdrop";
import { Words } from "../components/Words";
import { HANDOVER, RACE_FAST } from "../lib/data";
import { C, clamp } from "../lib/theme";

/** The real interface, tilting into view with live downloads in it. */
export const AppShowcase: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 22, stiffness: 70 } });
  const t = 3 + frame / fps;
  const rows = [
    liveRow(RACE_FAST, t, { id: "main", added: "21:40" }),
    liveRow(HANDOVER, t - 1.5, { id: "second", added: "21:41" }),
    row({ id: "a", file_name: "blender-4.5.2-linux-x64.tar.xz", url: "https://download.blender.org/release/", size: 360e6, added: "21:12" }),
    row({ id: "b", file_name: "annual-report-2025.pdf", url: "https://example.com/reports/", size: 4.2e6, added: "20:55" }),
    row({ id: "c", file_name: "node-v22.22.0-x64.msi", url: "https://nodejs.org/dist/", size: 31e6, added: "20:31" }),
  ];
  const zoom = interpolate(frame, [3.2 * fps, 5.6 * fps], [1, 1.55], { ...clamp });
  return (
    <Backdrop glow={0.6}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", perspective: 2200 }}>
        <div
          style={{
            scale: `${(0.78 + 0.32 * enter) * zoom}`,
            rotate: `${interpolate(enter, [0, 1], [24, 0])}deg`,
            translate: `0 ${interpolate(frame, [3.2 * fps, 5.6 * fps], [40, -300], clamp)}px`,
            transformOrigin: "50% 80%",
            transformStyle: "preserve-3d",
          }}
        >
          <div style={{ rotate: `x ${interpolate(enter, [0, 1], [32, 8])}deg` }}>
            <AppWindow rows={rows} selected="main" speedHistory={history([{ tel: RACE_FAST, offset: 0 }, { tel: HANDOVER, offset: 1.5 }], t)} />
          </div>
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 160, top: 80, opacity: interpolate(frame, [0, 10, 3 * fps, 3.4 * fps], [0, 1, 1, 0], clamp) }}>
        <Words text="Every range. Live." size={72} start={4} highlight={{ 2: C.lime }} />
      </div>
      <div style={{ position: "absolute", width: WINDOW.width }} />
    </Backdrop>
  );
};
