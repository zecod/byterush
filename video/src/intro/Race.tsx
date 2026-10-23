import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop, Flash } from "../components/Backdrop";
import { SegmentBar } from "../components/SegmentBar";
import { Words } from "../components/Words";
import { MEASURED, RACE_FAST, RACE_SLOW } from "../lib/data";
import { average, clock, rate, sample, timeOf } from "../lib/telemetry";
import { C, clamp, font } from "../lib/theme";

const host = (url: string) => new URL(url).host;

/** Video frames → real seconds: Byterush's run plays at a modest speed-up, then the single
 * connection is fast-forwarded to its end. The playback rate is always on screen. */
export function raceClock(frame: number, fps: number) {
  const fast = timeOf(RACE_FAST, "completed");
  const slow = timeOf(RACE_SLOW, "completed");
  const [p1, p2] = [7 * fps, 12 * fps];
  const mid = fast + 0.6;
  if (frame <= p1) return { t: (frame / p1) * mid, rate: mid / (p1 / fps) };
  const k = Math.min(1, (frame - p1) / (p2 - p1));
  return { t: mid + k * (slow - mid), rate: (slow - mid) / ((p2 - p1) / fps), done: k >= 1 };
}

const Lane: React.FC<{ label: string; accent: string; tel: typeof RACE_FAST; t: number; top: number }> = ({ label, accent, tel, t, top }) => {
  const s = sample(tel, t);
  const end = timeOf(tel, "completed");
  const done = t >= end;
  return (
    <div style={{ position: "absolute", top, left: 160, width: 1600 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18 }}>
        <div style={{ ...font(40, 600), color: accent }}>{label}</div>
        <div style={{ ...font(40, 600), color: done ? accent : C.text }}>
          {done ? `✓ ${clock(end)}` : `${(rate(tel, t, 1) / 1e6).toFixed(1)} MB/s · ${Math.floor((s.downloaded / tel.size) * 100)}%`}
        </div>
      </div>
      <SegmentBar segments={s.segments} size={tel.size} width={1600} height={74} running={!done} fill={accent} />
    </div>
  );
};

export const Race: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { t, rate } = raceClock(frame, fps);
  const fast = timeOf(RACE_FAST, "completed");
  const slow = timeOf(RACE_SLOW, "completed");
  const factor = slow / fast;
  const verdict = spring({ frame: frame - 12.4 * fps, fps, config: { damping: 14, stiffness: 110 } });
  const sizeMB = Math.round(RACE_FAST.size / 1e6);
  return (
    <Backdrop>
      <AbsoluteFill>
        <div style={{ position: "absolute", top: 96, left: 160 }}>
          <Words text="Same file. Same machine. Same evening." size={64} />
          <div style={{ ...font(34, 500), color: C.dim, marginTop: 16, opacity: interpolate(frame, [12, 24], [0, 1], clamp) }}>
            {sizeMB} MB from {host(RACE_FAST.url)}
          </div>
        </div>
        <div style={{ position: "absolute", top: 104, right: 160, textAlign: "right" }}>
          <div style={{ ...font(64, 700), color: C.text, fontVariantNumeric: "tabular-nums" }}>{clock(t)}</div>
          <div style={{ display: "inline-block", marginTop: 10, padding: "6px 14px", border: `1px solid ${C.line}`, borderRadius: 6, ...font(28, 600), color: C.dim }}>
            {rate < 1.5 ? "▶ real time" : rate < 15 ? `▶ ${rate.toFixed(0)}× speed` : `▶▶ ${rate.toFixed(0)}× speed`}
          </div>
        </div>
        <div style={{ opacity: interpolate(frame, [12.2 * fps, 12.7 * fps], [1, 0], clamp), translate: `0 ${interpolate(frame, [12.2 * fps, 12.7 * fps], [0, -60], clamp)}px` }}>
          <Lane label={`browser · 1 connection`} accent={C.text} tel={RACE_SLOW} t={t} top={360} />
          <Lane label={`byterush · ${RACE_FAST.connections} connections`} accent={C.lime} tel={RACE_FAST} t={t} top={590} />
        </div>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: verdict, scale: `${0.8 + 0.2 * verdict}` }}>
          <div style={{ ...font(250, 700), color: C.lime, letterSpacing: "-0.05em", textShadow: `0 0 80px ${C.lime}55` }}>
            {factor.toFixed(1)}× faster
          </div>
          <div style={{ ...font(44, 500), color: C.text, marginTop: 10 }}>
            {clock(slow, false)} on one connection · {clock(fast)} with Byterush
          </div>
          <div style={{ ...font(28, 500), color: C.dim, marginTop: 26 }}>
            {sizeMB} MB · {host(RACE_FAST.url)} · averages {(average(RACE_SLOW) / 1e6).toFixed(1)} vs {(average(RACE_FAST) / 1e6).toFixed(0)} MB/s · {MEASURED}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
      <Flash at={12.4 * fps} />
    </Backdrop>
  );
};
