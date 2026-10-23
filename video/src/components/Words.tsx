import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { font } from "../lib/theme";

type Props = {
  text: string;
  /** frame (in the current sequence) the first word starts */
  start?: number;
  size: number;
  weight?: number;
  color?: string;
  /** frames between words */
  stagger?: number;
  /** words (by index) drawn in this color */
  highlight?: Record<number, string>;
  style?: React.CSSProperties;
};

/** Words rising into place one after another. */
export const Words: React.FC<Props> = ({ text, start = 0, size, weight = 700, color = "#f1ecec", stagger = 3, highlight = {}, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ ...font(size, weight), color, lineHeight: 1.08, letterSpacing: "-0.02em", ...style }}>
      {text.split(" ").map((word, i) => {
        const p = spring({ frame: frame - start - i * stagger, fps, config: { damping: 18, stiffness: 140, mass: 0.7 } });
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              marginRight: "0.32em",
              opacity: Math.min(1, p * 1.4),
              translate: `0 ${(1 - p) * size * 0.55}px`,
              filter: `blur(${(1 - Math.min(1, p)) * 8}px)`,
              color: highlight[i] ?? color,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};
