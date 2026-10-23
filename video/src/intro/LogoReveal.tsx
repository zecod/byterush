import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop, Flash, Streaks } from "../components/Backdrop";
import { LogoMark } from "../components/LogoMark";
import { C, clamp, font } from "../lib/theme";

export const Wordmark: React.FC<{ size: number; sweep?: number }> = ({ size, sweep }) => (
  <div style={{ position: "relative", ...font(size, 700), letterSpacing: "-0.04em", lineHeight: 1 }}>
    <span style={{ color: C.dim }}>byte</span>
    <span style={{ color: C.text }}>rush</span>
    {sweep !== undefined && (
      <div
        style={{
          position: "absolute",
          inset: "-10% -5%",
          background: `linear-gradient(105deg, transparent ${sweep * 140 - 30}%, ${C.lime}aa ${sweep * 140 - 15}%, transparent ${sweep * 140}%)`,
          mixBlendMode: "overlay",
        }}
      />
    )}
  </div>
);

/** The mark builds itself, the name lands, a light sweep crosses it. */
export const LogoReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = interpolate(frame, [0, 34], [0, 1], { ...clamp, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
  const name = spring({ frame: frame - 22, fps, config: { damping: 16, stiffness: 120 } });
  return (
    <Backdrop glow={0.8}>
      <Streaks speed={2.2} opacity={interpolate(frame, [0, 30, 80], [0.9, 0.5, 0.25], clamp)} seed="logo" />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40 }}>
        <div style={{ filter: `drop-shadow(0 0 ${30 * p}px ${C.lime}55)`, scale: interpolate(frame, [0, 34], [0.7, 1], clamp) }}>
          <LogoMark size={250} p={p} />
        </div>
        <div style={{ opacity: name, translate: `0 ${(1 - name) * 40}px` }}>
          <Wordmark size={170} sweep={interpolate(frame, [40, 75], [0, 1], clamp)} />
        </div>
        <div style={{ ...font(46, 500), color: C.dim, opacity: interpolate(frame, [46, 62], [0, 1], clamp) }}>
          the free parallel download manager
        </div>
      </AbsoluteFill>
      <Flash at={30} length={18} />
    </Backdrop>
  );
};
