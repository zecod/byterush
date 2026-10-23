import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop, Streaks } from "../components/Backdrop";
import { LogoMark } from "../components/LogoMark";
import { C, clamp, font } from "../lib/theme";
import { Wordmark } from "./LogoReveal";

/** Call to action: name, promise, where to get it. */
export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame, fps, config: { damping: 18 } });
  const b = spring({ frame: frame - 12, fps, config: { damping: 18 } });
  const c = spring({ frame: frame - 24, fps, config: { damping: 18 } });
  return (
    <Backdrop glow={1}>
      <Streaks speed={0.8} opacity={0.35} seed="out" />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 36, opacity: a, scale: `${0.9 + 0.1 * a}` }}>
          <LogoMark size={170} />
          <Wordmark size={150} />
        </div>
        <div style={{ ...font(50, 600), color: C.text, marginTop: 56, opacity: b, translate: `0 ${(1 - b) * 30}px` }}>
          Free and open source · Windows · macOS · Linux
        </div>
        <div
          style={{
            marginTop: 50,
            padding: "18px 36px",
            background: C.lime,
            color: C.bg,
            borderRadius: 8,
            ...font(48, 700),
            opacity: c,
            scale: `${0.85 + 0.15 * c}`,
            boxShadow: `0 0 ${60 * c}px ${C.lime}55`,
          }}
        >
          zecod.github.io/byterush
        </div>
        <div style={{ ...font(32, 500), color: C.dim, marginTop: 30, opacity: interpolate(frame, [36, 50], [0, 1], clamp) }}>
          github.com/zecod/byterush
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
