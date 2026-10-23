import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { SegmentBar } from "../components/SegmentBar";
import { Words } from "../components/Words";
import { RACE_SLOW } from "../lib/data";
import { average, sample } from "../lib/telemetry";
import { C, clamp, font } from "../lib/theme";

/** One thin lane crawling: how a browser downloads (real single-connection data, real time). */
export const OneLane: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = sample(RACE_SLOW, frame / fps + 1.4);
  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: "0 160px" }}>
        <div style={{ position: "absolute", top: 330, left: 160, ...font(30, 500), color: C.dim, opacity: interpolate(frame, [0, 12], [0, 1], clamp) }}>
          [*] your browser
        </div>
        <div style={{ position: "absolute", top: 322, right: 160, ...font(40, 600), color: C.text, opacity: interpolate(frame, [10, 22], [0, 1], clamp) }}>
          {(average(RACE_SLOW) / 1e6).toFixed(1)} MB/s average
        </div>
        <div style={{ position: "absolute", top: 400, left: 160, scale: `${interpolate(frame, [0, 18], [0.2, 1], clamp)} 1`, transformOrigin: "left" }}>
          <SegmentBar segments={s.segments} size={RACE_SLOW.size} width={1600} height={26} running fill={C.text} />
        </div>
        <div style={{ position: "absolute", top: 520, left: 160 }}>
          <Words text="One connection." start={18} size={120} />
          <Words text="That's how every browser downloads a file." start={40} size={46} weight={500} color={C.dim} style={{ marginTop: 28 }} />
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
