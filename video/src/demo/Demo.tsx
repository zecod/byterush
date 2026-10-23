import React from "react";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { AppWindow, history, liveRow, row, WINDOW } from "../components/AppWindow";
import type { Row, Toast } from "../components/AppWindow";
import { Backdrop } from "../components/Backdrop";
import { LogoMark } from "../components/LogoMark";
import { Words } from "../components/Words";
import { Outro } from "../intro/Outro";
import { DEMO, HANDOVER, MEASURED } from "../lib/data";
import { timeOf } from "../lib/telemetry";
import { C, clamp, font } from "../lib/theme";
import { AddDialogView, BrowserMock, Caption, Cursor, pointer, SPOT } from "./parts";

const FPS = 30;
const host = (url: string) => new URL(url).host;

/** Frame marks of the session (frames from its start), derived from the recordings' real lengths. */
export function demoPlan() {
  const start = 180; // the main download starts when "download now" is clicked
  const pauses = DEMO.frames.filter((f, i) => i > 0 && f.status !== DEMO.frames[i - 1].status);
  const pausedAt = pauses.find((f) => f.status === "paused")?.t;
  const resumedAt = pausedAt === undefined ? undefined : pauses.find((f) => f.t > pausedAt && f.status !== "paused")?.t;
  const mainDone = start + Math.round(timeOf(DEMO, "completed") * FPS);
  const browser = mainDone + 30; // the browser hand-over
  const handStart = browser + 100;
  const killT = Math.min(timeOf(HANDOVER, "completed") * 0.8, 9.5);
  const kill = handStart + Math.round(killT * FPS);
  // the engine syncs a checkpoint every 4 s from the moment data flows; a restart resumes there
  const flowing = timeOf(HANDOVER, "downloading");
  const checkpointT = killT - flowing >= 4 ? flowing + 4 * Math.floor((killT - flowing) / 4) : 0;
  const back = kill + 75;
  const handDone = back + Math.round((timeOf(HANDOVER, "completed") - checkpointT) * FPS);
  const end = handDone + 110;
  return { start, pausedAt, resumedAt, mainDone, browser, handStart, killT, kill, checkpointT, back, handDone, end };
}

const DemoTitle: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Backdrop glow={0.7}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 34 }}>
        <LogoMark size={150} p={interpolate(frame, [0, 26], [0, 1], clamp)} />
        <Words text="Byterush in one minute" size={96} start={8} highlight={{ 3: C.lime }} />
        <div style={{ ...font(34, 500), color: C.dim, opacity: interpolate(frame, [24, 36], [0, 1], clamp) }}>
          the real app · real downloads · {MEASURED}
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

const OLD: Row[] = [
  row({ id: "a", file_name: "blender-4.5.2-linux-x64.tar.xz", url: "https://download.blender.org/release/", size: 360e6, added: "21:12" }),
  row({ id: "b", file_name: "annual-report-2025.pdf", url: "https://example.com/reports/", size: 4.2e6, added: "20:55" }),
  row({ id: "c", file_name: "node-v22.22.0-x64.msi", url: "https://nodejs.org/dist/", size: 31e6, added: "20:31" }),
];

/** One continuous session in the app. */
const Session: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const P = demoPlan();
  const s = frame;

  // --- main download (added through the dialog) ---
  const mainT = (s - P.start) / fps;
  const main = s >= P.start - 6 ? liveRow(DEMO, mainT, { id: "main", added: "21:40", connections: DEMO.connections }) : null;

  // --- the download handed over by the browser, killed and restarted on the way ---
  // its recording's clock at frame f: killed at P.kill, it restarts at P.back from its last checkpoint
  const handClock = (f: number) => (f < P.kill ? (f - P.handStart) / fps : f < P.back ? null : P.checkpointT + (f - P.back) / fps);
  const handT = handClock(s) ?? P.killT;
  const killed = s >= P.kill && s < P.back;
  const hand = s >= P.handStart ? liveRow(HANDOVER, handT, { id: "hand", added: "21:41", connections: HANDOVER.connections }) : null;
  if (hand && killed) Object.assign(hand, { status: "paused", speed: 0, eta: null, active_connections: 0 });

  const rows = [hand, main, ...OLD].filter((r): r is Row => r !== null);
  const selected = s >= P.handStart + 40 ? "hand" : main ? "main" : undefined;

  // --- the dialog ---
  const open = s < 176 ? interpolate(s, [34, 44], [0, 1], clamp) : interpolate(s, [176, 184], [1, 0], clamp);
  const typedChars = Math.round(interpolate(s, [62, 100], [0, DEMO.url.length], clamp));
  const connections = s >= 146 ? DEMO.connections : 8;

  // --- pointer (window coordinates) ---
  const pausedF = P.pausedAt === undefined ? undefined : P.start + Math.round(P.pausedAt * fps);
  const resumedF = P.resumedAt === undefined ? undefined : P.start + Math.round(P.resumedAt * fps);
  const keys: [number, number, number][] = [
    [0, 760, 460],
    [30, SPOT.addUrl[0], SPOT.addUrl[1]],
    [56, SPOT.dialogAddress[0], SPOT.dialogAddress[1]],
    [124, SPOT.dialogAddress[0], SPOT.dialogAddress[1]],
    [140, SPOT.dialogConnections[0], SPOT.dialogConnections[1]],
    [156, SPOT.dialogConnections[0], SPOT.dialogConnections[1]],
    [172, SPOT.dialogDownload[0], SPOT.dialogDownload[1]],
    [200, 900, 330],
  ];
  if (pausedF !== undefined && resumedF !== undefined) {
    keys.push([pausedF - 24, 900, 330], [pausedF - 2, SPOT.pause[0], SPOT.pause[1]], [resumedF - 22, SPOT.pause[0] + 8, SPOT.pause[1] + 10], [resumedF - 2, SPOT.play[0], SPOT.play[1]], [resumedF + 30, 860, 360]);
  }
  const ptr = pointer(s, keys);
  const clicks = [32, 58, 142, 174, ...(pausedF !== undefined && resumedF !== undefined ? [pausedF, resumedF] : [])];
  const showPointer = s < P.browser + 10 || s > P.handDone + 10;

  // --- camera: a slow push towards the split while the main download runs ---
  const zoomIn = interpolate(s, [P.start + 40, P.start + 80], [0, 1], { ...clamp, easing: Easing.bezier(0.4, 0, 0.2, 1) });
  const zoomOut = pausedF !== undefined ? interpolate(s, [pausedF - 40, pausedF - 20], [0, 1], clamp) : 0;
  const zoomBack = resumedF !== undefined ? interpolate(s, [resumedF + 20, resumedF + 50], [0, 1], clamp) : 0;
  const zoomEnd = interpolate(s, [P.mainDone - 20, P.mainDone + 10], [0, 1], clamp);
  const z = Math.max(0, zoomIn - zoomOut + zoomBack - zoomEnd);
  const scale = 1.18 + z * 0.62;
  const fx = 620 + z * (733 - 620);
  const fy = 390 + z * (590 - 390);

  // --- browser hand-over (screen coordinates) ---
  const bIn = spring({ frame: s - P.browser, fps, config: { damping: 20 } });
  const bOut = interpolate(s, [P.handStart + 10, P.handStart + 30], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const bx = -1000 + bIn * 1240 - bOut * 1300;
  const linkIdx = 1;
  const bPtr = pointer(s, [
    [P.browser + 10, 1400, 820],
    [P.browser + 50, 420, 330],
  ]);
  const clickF = P.browser + 54;
  const badge = interpolate(s, [clickF + 10, clickF + 16], [0, 1], clamp);

  // --- kill and restart ---
  const kOut = interpolate(s, [P.kill, P.kill + 12], [0, 1], clamp);
  const kIn = spring({ frame: s - P.back, fps, config: { damping: 18 } });
  const windowOpacity = s < P.kill ? 1 : s < P.back ? 1 - kOut : kIn;

  // --- toasts ---
  const toasts: Toast[] = [];
  const toastP = (from: number, to: number) => Math.min(interpolate(s, [from, from + 8], [0, 1], clamp), interpolate(s, [to - 8, to], [1, 0], clamp));
  if (s >= P.handStart + 30 && s < P.handStart + 150) toasts.push({ kind: "info", text: `from browser · ${HANDOVER.file_name}`, p: toastP(P.handStart + 30, P.handStart + 150) });
  if (s >= P.mainDone && s < P.mainDone + 120) toasts.push({ kind: "success", text: `done · ${DEMO.file_name}`, actions: ["open", "folder"], p: toastP(P.mainDone, P.mainDone + 120) });
  if (s >= P.handDone) toasts.push({ kind: "success", text: `done · ${HANDOVER.file_name}`, actions: ["open", "folder"], p: interpolate(s, [P.handDone, P.handDone + 8], [0, 1], clamp) });

  const speedHistory = history(
    [
      { tel: DEMO, offset: P.start / fps },
      { tel: HANDOVER, local: (at) => handClock(at * fps) },
    ],
    s / fps,
  );

  // --- captions ---
  const caption = (from: number, to: number) => Math.min(interpolate(s, [from, from + 12], [0, 1], clamp), interpolate(s, [to - 10, to], [1, 0], clamp));
  const percentAtKill = Math.floor((liveRow(HANDOVER, P.killT, { id: "x" }).downloaded / HANDOVER.size) * 100);
  const percentBack = Math.floor((liveRow(HANDOVER, P.checkpointT, { id: "x" }).downloaded / HANDOVER.size) * 100);

  return (
    <Backdrop>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transform: `translate(960px, 500px) scale(${scale}) translate(${-fx}px, ${-fy}px)`,
          transformOrigin: "0 0",
          opacity: windowOpacity,
          filter: killed ? "grayscale(1)" : undefined,
        }}
      >
        <AppWindow
          rows={rows}
          selected={selected}
          speedHistory={speedHistory}
          toasts={toasts}
          modal={
            <AddDialogView
              open={open}
              typed={DEMO.url.slice(0, typedChars)}
              checking={s >= 100 && s < 118}
              ready={s >= 118}
              fileName={DEMO.file_name}
              size={DEMO.size}
              contentType="video/x-msvideo"
              connections={connections}
            />
          }
          overlay={showPointer ? <Cursor x={ptr.x} y={ptr.y} clicks={clicks} /> : null}
        />
      </div>
      {s >= P.browser && s < P.handStart + 40 && (
        <div style={{ position: "absolute", left: bx, top: 150 }}>
          <div style={{ position: "relative" }}>
            <BrowserMock
              host={host(HANDOVER.url)}
              links={["100MB.bin", HANDOVER.file_name, "10GB.bin"]}
              hover={s > clickF - 10 ? linkIdx : undefined}
              badge={badge}
              shelf={s > clickF + 8 ? `${HANDOVER.file_name} — taken over by Byterush` : undefined}
            />
            <Cursor x={bPtr.x - bx + 0} y={bPtr.y - 150} clicks={[clickF]} />
          </div>
        </div>
      )}
      {s >= P.kill && s < P.back + 8 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: Math.min(kOut, 1 - kIn) }}>
          <div style={{ ...font(84, 700), color: C.red, textShadow: `0 0 40px ${C.red}66` }}>✕ app killed</div>
          <div style={{ ...font(36, 500), color: C.dim, marginTop: 20 }}>
            {HANDOVER.file_name} was at {percentAtKill}%
          </div>
          <div style={{ ...font(36, 600), color: C.lime, marginTop: 40, opacity: interpolate(s, [P.kill + 40, P.kill + 52], [0, 1], clamp) }}>
            ↻ starting Byterush again…
          </div>
        </AbsoluteFill>
      )}
      <Caption step="1" text="Paste a link. Byterush checks it first." p={caption(10, P.start + 10)} />
      <Caption step="2" text={`${DEMO.connections} connections at once. Pause and resume any time.`} p={caption(P.start + 16, P.mainDone + 4)} />
      <Caption step="3" text="Start a download in Chrome or Edge: it lands here." p={caption(P.browser + 8, P.kill - 4)} />
      <Caption step="4" text={`Killed at ${percentAtKill}%? It continues from ${percentBack}%.`} p={caption(P.kill + 4, P.handDone - 10)} />
      <Caption step="5" text="Done. Sorted into its folder." p={caption(P.handDone - 6, P.end)} />
      <div style={{ position: "absolute", right: 250, top: 8, padding: "4px 12px", borderRadius: 6, background: "rgba(16,13,13,0.82)", ...font(18, 500), color: C.dim }}>
        recorded with the real engine · {[...new Set([host(DEMO.url), host(HANDOVER.url)])].join(" · ")}
      </div>
    </Backdrop>
  );
};

export const DEMO_TITLE = 3;
export const DEMO_OUTRO = 4.4;

export const Demo: React.FC = () => {
  const P = demoPlan();
  const t = linearTiming({ durationInFrames: 12 });
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="Title" durationInFrames={DEMO_TITLE * FPS}>
        <DemoTitle />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={t} />
      <TransitionSeries.Sequence name="Session" durationInFrames={P.end}>
        <Session />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={t} />
      <TransitionSeries.Sequence name="Outro" durationInFrames={DEMO_OUTRO * FPS}>
        <Outro />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};

export const demoFrames = () => DEMO_TITLE * FPS + demoPlan().end + DEMO_OUTRO * FPS - 24;
export { WINDOW };
