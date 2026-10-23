import React from "react";
import { useCurrentFrame } from "remotion";
import type { Segment } from "../lib/telemetry";
import { C } from "../lib/theme";

/** The file as one bar: every segment where it sits in the file, filling from its start; segments
 * still downloading carry a glowing head and moving stripes (like the app's segment map). */
export const SegmentBar: React.FC<{
  segments: Segment[];
  size: number;
  width: number;
  height: number;
  running: boolean;
  fill?: string;
  doneFill?: string;
  gap?: number;
}> = ({ segments, size, width, height, running, fill = C.lime, doneFill, gap = 2 }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "relative", width, height, background: C.track, borderRadius: 4, overflow: "hidden" }}>
      {segments.map(([start, end, done], i) => {
        const len = end - start;
        const k = len > 0 ? Math.min(1, done / len) : 1;
        const busy = running && k < 1 && done > 0;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: (start / size) * width,
              width: Math.max(1, (len / size) * width - gap),
              overflow: "visible",
            }}
          >
            <div
              style={{
                position: "relative",
                height: "100%",
                width: `${k * 100}%`,
                background: k >= 1 ? doneFill ?? `${fill}cc` : `repeating-linear-gradient(-45deg, ${fill} 0 7px, ${fill}c4 7px 14px)`,
                backgroundPosition: `${frame * 1.2}px 0`,
                backgroundSize: "20px 20px",
              }}
            >
              {busy && (
                <div style={{ position: "absolute", right: -2, top: 0, bottom: 0, width: 3, background: "#fff", boxShadow: `0 0 14px 4px ${fill}` }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** One lane per connection, stacked: each fills as its range comes in. */
export const Lanes: React.FC<{ segments: Segment[]; width: number; lane: number; gapY: number; running: boolean; reveal?: number }> = ({
  segments,
  width,
  lane,
  gapY,
  running,
  reveal = 1,
}) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: gapY }}>
      {segments.map(([start, end, done], i) => {
        const len = end - start;
        const k = len > 0 ? Math.min(1, done / len) : 1;
        const show = Math.max(0, Math.min(1, reveal * segments.length - i));
        return (
          <div key={i} style={{ position: "relative", width, height: lane, background: C.track, borderRadius: 2, opacity: show, scale: `${0.6 + 0.4 * show} 1` }}>
            <div style={{ height: "100%", width: `${k * 100}%`, background: k >= 1 ? `${C.lime}99` : C.lime, borderRadius: 2, position: "relative" }}>
              {running && k < 1 && done > 0 && (
                <div style={{ position: "absolute", right: -1, top: -2, bottom: -2, width: 3, background: "#fff", boxShadow: `0 0 10px 3px ${C.lime}` }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
