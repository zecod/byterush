import React from "react";
import { AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { LogoMark } from "../components/LogoMark";
import { Words } from "../components/Words";
import { C, clamp, font } from "../lib/theme";

/** Left: the claim. Right: a small animated proof. */
const Vignette: React.FC<{ index: string; title: string; punch: string; note: string; children: React.ReactNode }> = ({ index, title, punch, note, children }) => {
  const frame = useCurrentFrame();
  return (
    <Backdrop>
      <AbsoluteFill>
        <div style={{ position: "absolute", left: 140, top: 290, width: 860 }}>
          <div style={{ ...font(28, 500), color: C.dim, marginBottom: 26, opacity: interpolate(frame, [0, 10], [0, 1], clamp) }}>[*] {index}</div>
          <Words text={title} size={72} start={2} />
          <Words text={punch} size={72} start={10} color={C.lime} style={{ marginTop: 6 }} />
          <div style={{ ...font(30, 500), color: C.dim, marginTop: 36, lineHeight: 1.45, whiteSpace: "pre-line", opacity: interpolate(frame, [22, 34], [0, 1], clamp) }}>{note}</div>
        </div>
        <div style={{ position: "absolute", left: 1040, top: 200, width: 760, height: 680 }}>{children}</div>
      </AbsoluteFill>
    </Backdrop>
  );
};

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ position: "absolute", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, boxShadow: "0 30px 80px rgba(0,0,0,0.5)", ...style }}>{children}</div>
);

const Bar: React.FC<{ value: number; color?: string; width?: number; ticks?: number[] }> = ({ value, color = C.lime, width = 640, ticks = [] }) => (
  <div style={{ position: "relative", width, height: 30, background: C.track, borderRadius: 5 }}>
    <div style={{ width: `${value * 100}%`, height: "100%", background: color, borderRadius: 5, position: "relative" }}>
      <div style={{ position: "absolute", right: -2, top: -3, bottom: -3, width: 4, background: "#fff", boxShadow: `0 0 14px 4px ${color}` }} />
    </div>
    {ticks.map((t) => (
      <div key={t} style={{ position: "absolute", left: `${t * 100}%`, top: -10, bottom: -10, width: 2, background: `${C.text}55` }} />
    ))}
  </div>
);

/** Killed mid-download, started again: it carries on from the last synced checkpoint. */
export const CrashProof: React.FC = () => {
  const frame = useCurrentFrame();
  const crash = 40;
  const back = 58;
  const before = interpolate(frame, [6, crash], [0.42, 0.63], clamp);
  const saved = 0.614;
  const after = interpolate(frame, [back, 100], [saved, 0.8], clamp);
  const value = frame < crash ? before : frame < back ? 0.63 : after;
  const dead = frame >= crash && frame < back;
  const shake = dead && frame < crash + 8 ? (random(`shake${frame}`) - 0.5) * 26 : 0;
  const ticks = [0.1, 0.2, 0.3, 0.4, 0.5, 0.614];
  return (
    <Vignette index="crash-proof resume" title="Crash. Power cut." punch="It just continues." note={"Progress is synced to disk every 4 s.\nNothing lost, nothing fetched twice."}>
      <Card style={{ left: 30, top: 150, width: 700, height: 330, padding: 30, translate: `${shake}px 0`, opacity: dead ? 0.35 : 1 }}>
        <div style={{ ...font(26, 600), color: C.text }}>ubuntu-26.04-desktop-amd64.iso</div>
        <div style={{ ...font(22, 500), color: C.dim, marginTop: 8, marginBottom: 42 }}>6.2 GB · 32 connections</div>
        <Bar value={value} ticks={ticks} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 26, ...font(24, 600) }}>
          <span style={{ color: frame >= back ? C.lime : C.text }}>{(value * 100).toFixed(1)}%</span>
          <span style={{ color: C.dim }}>│ = synced checkpoint</span>
        </div>
      </Card>
      {dead && (
        <div style={{ position: "absolute", left: 230, top: 260, ...font(52, 700), color: C.red, textShadow: `0 0 30px ${C.red}88`, rotate: "-4deg" }}>
          ✕ app killed
        </div>
      )}
      {frame >= back && (
        <div style={{ position: "absolute", left: 40, top: 530, whiteSpace: "nowrap", ...font(30, 600), color: C.lime, opacity: interpolate(frame, [back, back + 8], [0, 1], clamp) }}>
          ↻ started again · back at {(saved * 100).toFixed(1)}%, carrying on
        </div>
      )}
    </Vignette>
  );
};

/** The link expired: clicking it again in the browser re-attaches the same download. */
export const ExpiredLink: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const click = 46;
  const snap = spring({ frame: frame - click - 4, fps, config: { damping: 11, stiffness: 160 } });
  const gap = 120 * (1 - snap);
  const glow = frame > click + 4 ? interpolate(frame, [click + 4, click + 20], [1, 0], clamp) : 0;
  const cursorX = interpolate(frame, [20, click], [620, 330], { ...clamp, easing: Easing.bezier(0.3, 0, 0.2, 1) });
  const cursorY = interpolate(frame, [20, click], [560, 520], { ...clamp, easing: Easing.bezier(0.3, 0, 0.2, 1) });
  const link = (x: number) => (
    <div style={{ position: "absolute", top: 150, left: x, width: 230, height: 110, border: `14px solid ${snap > 0.98 ? C.lime : C.text}`, borderRadius: 60 }} />
  );
  return (
    <Vignette index="expired links" title="Link expired?" punch="Click it again." note={"Start it again in the browser.\nSame file? It continues from 58%."}>
      <div style={{ position: "absolute", left: 120, top: 0, width: 560, height: 420, filter: `drop-shadow(0 0 ${40 * glow}px ${C.lime})` }}>
        {link(80 - gap / 2)}
        {link(250 + gap / 2)}
      </div>
      {snap < 0.5 && (
        <div style={{ position: "absolute", left: 300, top: 120, padding: "8px 16px", background: C.red, color: C.bg, borderRadius: 6, ...font(30, 700), opacity: 1 - snap * 2 }}>
          403
        </div>
      )}
      <Card style={{ left: 140, top: 460, width: 520, height: 120, padding: "26px 30px" }}>
        <div style={{ ...font(22, 500), color: C.dim }}>mirror.example.org</div>
        <div style={{ ...font(30, 600), color: "#8ab4ff", textDecoration: "underline", marginTop: 10 }}>⬇ download the file again</div>
      </Card>
      <div style={{ position: "absolute", left: cursorX, top: cursorY, ...font(46, 700), color: "#fff", scale: frame > click && frame < click + 6 ? "0.85" : "1" }}>➚</div>
      {snap > 0.98 && <div style={{ position: "absolute", left: 140, top: 630, whiteSpace: "nowrap", ...font(32, 600), color: C.lime }}>✓ same file · continuing from 58%</div>}
    </Vignette>
  );
};

/** A download starts in the browser and flies into Byterush. */
export const Takeover: React.FC = () => {
  const frame = useCurrentFrame();
  const fly = interpolate(frame, [30, 62], [0, 1], { ...clamp, easing: Easing.bezier(0.5, 0, 0.3, 1) });
  const x = 120 + fly * 420;
  const y = 360 - Math.sin(fly * Math.PI) * 230 + fly * -60;
  const land = interpolate(frame, [60, 70, 80], [1, 1.25, 1], clamp);
  return (
    <Vignette index="browser takeover" title="Every browser download." punch="Caught." note={"Chrome and Edge hand it over with your\ncookies, so protected sites keep working."}>
      <Card style={{ left: 0, top: 160, width: 470, height: 360, overflow: "hidden" }}>
        <div style={{ height: 46, background: C.track, display: "flex", alignItems: "center", gap: 8, padding: "0 16px" }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 12, height: 12, borderRadius: 6, background: C.line, display: "inline-block" }} />
          ))}
          <span style={{ marginLeft: 12, ...font(18, 500), color: C.dim }}>downloads.example.org</span>
        </div>
        <div style={{ padding: 26, ...font(22, 500), color: C.dim, lineHeight: 1.7 }}>
          Release files
          <br />
          <span style={{ color: "#8ab4ff", textDecoration: "underline" }}>project-setup-x64.exe</span>
          <br />
          <span style={{ color: "#8ab4ff", textDecoration: "underline" }}>dataset-2026.zip</span>
        </div>
      </Card>
      <div style={{ position: "absolute", left: 560, top: 250, scale: `${land}`, filter: `drop-shadow(0 0 ${frame > 60 ? 40 : 0}px ${C.lime}aa)` }}>
        <div style={{ width: 170, height: 170, borderRadius: 38, background: "#141111", border: `1px solid ${C.line}`, display: "grid", placeItems: "center" }}>
          <LogoMark size={120} />
        </div>
      </div>
      {fly < 1 && (
        <div style={{ position: "absolute", left: x, top: y, padding: "10px 16px", background: C.text, color: C.bg, borderRadius: 8, ...font(22, 700), boxShadow: `0 0 30px ${C.lime}66` }}>
          dataset-2026.zip <span style={{ color: "#8a6d3b" }}>🍪</span>
        </div>
      )}
      {frame > 66 && (
        <div style={{ position: "absolute", left: 300, top: 560, whiteSpace: "nowrap", ...font(30, 600), color: C.lime, opacity: interpolate(frame, [66, 74], [0, 1], clamp) }}>
          [*] from browser · dataset-2026.zip
        </div>
      )}
    </Vignette>
  );
};

/** A batch of hundreds of files streaming through the list. */
export const Thousands: React.FC<{ files: number; seconds: number }> = ({ files, seconds }) => {
  const frame = useCurrentFrame();
  const done = Math.round(interpolate(frame, [8, 84], [0, files], clamp));
  const scroll = interpolate(frame, [8, 84], [0, Math.max(0, files - 9) * 48], clamp);
  return (
    <Vignette index="built for many files" title="Hundreds of files?" punch={`${files} in ${seconds.toFixed(1)} s.`} note={"Batch links like photo_*.jpg, one queue,\nsmooth with thousands of rows.\n(measured against a local server)"}>
      <Card style={{ left: 40, top: 110, width: 660, height: 520, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "20px 26px", borderBottom: `1px solid ${C.line}`, ...font(22, 600) }}>
          <span style={{ color: C.text }}>batch · photo_*.jpg</span>
          <span style={{ color: C.lime }}>
            {done} / {files}
          </span>
        </div>
        <div style={{ position: "relative", height: 440, overflow: "hidden" }}>
          <div style={{ translate: `0 ${-scroll}px` }}>
            {Array.from({ length: files }, (_, i) => i)
              .filter((i) => Math.abs(i * 48 - scroll) < 560)
              .map((i) => {
                const k = Math.max(0, Math.min(1, (done - i + 6) / 6));
                return (
                  <div key={i} style={{ position: "absolute", top: i * 48, left: 0, right: 0, height: 48, display: "flex", alignItems: "center", gap: 18, padding: "0 26px", borderBottom: `1px solid ${C.line}66` }}>
                    <span style={{ ...font(20, 500), color: C.text, width: 230 }}>photo_{String(i + 1).padStart(4, "0")}.jpg</span>
                    <span style={{ flex: 1, height: 8, background: C.track, borderRadius: 2 }}>
                      <span style={{ display: "block", height: "100%", width: `${k * 100}%`, background: k >= 1 ? `${C.lime}99` : C.lime, borderRadius: 2 }} />
                    </span>
                    <span style={{ ...font(18, 600), color: k >= 1 ? C.lime : C.dim, width: 60, textAlign: "right" }}>{k >= 1 ? "done" : `${Math.floor(k * 100)}%`}</span>
                  </div>
                );
              })}
          </div>
        </div>
      </Card>
    </Vignette>
  );
};
