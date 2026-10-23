import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop, Streaks } from "../components/Backdrop";
import { Lanes } from "../components/SegmentBar";
import { Words } from "../components/Words";
import { RACE_FAST } from "../lib/data";
import { rate, sample } from "../lib/telemetry";
import { C, clamp, font } from "../lib/theme";

/** The lane splits into one lane per connection and they all fill at once (real data, real time). */
export const Split: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = Math.max(0, frame / fps + 1.0);
  const s = sample(RACE_FAST, t);
  const shown = rate(RACE_FAST, t, 1);
  return (
    <Backdrop glow={interpolate(frame, [20, 60], [0, 1], clamp)}>
      <Streaks opacity={interpolate(frame, [30, 70], [0, 0.8], clamp)} speed={1.4} />
      <AbsoluteFill>
        <div style={{ position: "absolute", top: 110, left: 160 }}>
          <Words text={`Byterush opens ${RACE_FAST.connections}.`} size={120} start={2} highlight={{ 2: C.lime }} />
        </div>
        <div style={{ position: "absolute", top: 812, right: 160, textAlign: "right", opacity: interpolate(frame, [18, 30], [0, 1], clamp) }}>
          <div style={{ ...font(96, 700), color: C.lime, textShadow: `0 0 40px ${C.lime}66` }}>{(shown / 1e6).toFixed(0)} MB/s</div>
          <div style={{ ...font(30, 500), color: C.dim, marginTop: 8 }}>{s.active} connections</div>
        </div>
        <div style={{ position: "absolute", top: 300, left: 160 }}>
          <Lanes segments={s.segments.slice(0, 32)} width={1600} lane={10} gapY={5} running reveal={interpolate(frame, [4, 34], [0.02, 1], clamp)} />
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
