import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame } from "remotion";
import { C } from "../lib/theme";

/** Film grain: cheap fractal noise at quarter resolution, a new seed every other frame. */
const Grain: React.FC<{ opacity: number }> = ({ opacity }) => {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame / 2);
  return (
    <svg width="480" height="270" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity, mixBlendMode: "overlay" }}>
      <filter id={`grain-${seed}`}>
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={seed} stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="480" height="270" filter={`url(#grain-${seed})`} />
    </svg>
  );
};

/** Thin streaks flying left to right: the "rush". */
export const Streaks: React.FC<{ count?: number; speed?: number; opacity?: number; seed?: string }> = ({ count = 34, speed = 1, opacity = 1, seed = "s" }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity, overflow: "hidden" }}>
      {Array.from({ length: count }, (_, i) => {
        const y = random(`${seed}y${i}`) * 1080;
        const len = 120 + random(`${seed}l${i}`) * 520;
        const v = (14 + random(`${seed}v${i}`) * 46) * speed;
        const x = ((random(`${seed}x${i}`) * 2600 + frame * v) % 2600) - len - 200;
        const lime = random(`${seed}c${i}`) > 0.72;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: len,
              height: lime ? 2 : 1,
              background: `linear-gradient(90deg, transparent, ${lime ? C.lime : C.text})`,
              opacity: lime ? 0.55 : 0.18,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** Dark stage with hairline grid, vignette and grain. */
export const Backdrop: React.FC<{ grid?: boolean; children?: React.ReactNode; glow?: number }> = ({ grid = true, children, glow = 0 }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      {grid && (
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${C.line}55 1px, transparent 1px), linear-gradient(90deg, ${C.line}55 1px, transparent 1px)`,
            backgroundSize: "96px 96px",
            backgroundPosition: `${-frame * 0.4}px 0px`,
            maskImage: "radial-gradient(ellipse at 50% 45%, black 20%, transparent 75%)",
          }}
        />
      )}
      {glow > 0 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse 60% 45% at 50% 55%, ${C.lime}22, transparent 70%)`,
            opacity: glow * interpolate(Math.sin(frame / 18), [-1, 1], [0.75, 1]),
          }}
        />
      )}
      {children}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)", pointerEvents: "none" }} />
      <Grain opacity={0.09} />
    </AbsoluteFill>
  );
};

/** A short lime-white bloom at frame `at`, for the moments that should land. */
export const Flash: React.FC<{ at: number; length?: number }> = ({ at, length = 14 }) => {
  const frame = useCurrentFrame();
  const k = interpolate(frame, [at - 2, at, at + length], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (k <= 0) return null;
  return <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 50%, ${C.lime}${Math.round(k * 120).toString(16).padStart(2, "0")}, transparent 70%)`, mixBlendMode: "screen", pointerEvents: "none" }} />;
};
