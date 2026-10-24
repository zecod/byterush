import React from "react";
import { C } from "../lib/theme";

/** The Byterush mark (branding/mark.svg): three lanes rising into a download arrow, lime cap on the
 * middle lane. `p` (0..1) builds it up: lanes rise one after another, then the arrow, then the cap. */
export const LogoMark: React.FC<{ size: number; p?: number; color?: string; accent?: string }> = ({ size, p = 1, color = C.text, accent = C.lime }) => {
  const part = (from: number, to: number) => Math.max(0, Math.min(1, (p - from) / (to - from)));
  const lane = (x: number, y: number, h: number, k: number) => (
    <rect x={x} y={y + h * (1 - k)} width={6} height={h * k} rx={1} />
  );
  const arrow = part(0.45, 0.8);
  const cap = part(0.75, 1);
  return (
    <svg width={size} height={size} viewBox="8 6 48 52">
      <g fill={color}>
        {lane(18, 21, 13, part(0, 0.4))}
        {lane(29, 17, 21, part(0.1, 0.5))}
        {lane(40, 13, 21, part(0.2, 0.6))}
        <path d="M14 37h8l10 10 10-10h8L32 55z" opacity={arrow} transform={`translate(0 ${(1 - arrow) * -6})`} />
      </g>
      <rect x={29} y={9} width={6} height={6} rx={1} fill={accent} transform={`translate(32 12) scale(${cap}) translate(-32 -12)`} />
    </svg>
  );
};
