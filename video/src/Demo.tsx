import React from "react";
import { AbsoluteFill, Easing, Freeze, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { LogoMark } from "./components/LogoMark";
import { after, type Race } from "./lib/takes";
import { C, clamp, font } from "./lib/theme";

export const FPS = 30;
const f = (seconds: number) => Math.round(seconds * FPS);

/** The recordings' desktop colour, so the footage and the frame around it are one surface. */
const DESK = "#2d3038";
/** Where the browser window sits in both recordings (1920x1080). */
const WIN = { x: 440, y: 40, w: 1040, h: 1000 };
/** The race: each recording's browser window, side by side. */
const K = 0.88;
const GAP = 40;
const COL = { w: WIN.w * K, h: WIN.h * K, top: 132, left: (1920 - 2 * WIN.w * K - GAP) / 2, right: (1920 + GAP) / 2 };
const PRE = 1.4;
const MORPH = f(0.7);
const HOLD = f(1.2);
const CARD = f(4.4);

/** The cut of a race, in seconds after the click (E…) and in composition frames. */
function timeline(race: Race) {
  const AFTER = after(race);
  const E0 = AFTER.started + 0.45; // full screen until just after "start download"
  const E1 = AFTER.byterushDone + 1.6; // real time until Byterush has been done a moment
  const E2 = AFTER.chromeDone + 2.2; // Chrome's side fast until its bubble says done
  const S1 = f(E0 + PRE);
  const REAL = f((E1 - E0) / race.realRate);
  const FAST = f((E2 - E1) / race.rate);
  return { AFTER, E0, E1, E2, S1, REAL, FAST, frames: S1 + REAL + FAST + HOLD + CARD };
}

export const demoFrames = (race: Race) => timeline(race).frames;

const clock = (s: number) => {
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
};

/** A recording, placed so its pixel (0,0) lands at (x,y) at scale `s`, clipped to `clip`. */
const Footage: React.FC<{
  src: string;
  trim: number;
  rate?: number;
  x: number;
  y: number;
  s: number;
  clip: { x: number; y: number; w: number; h: number };
  radius?: number;
}> = ({ src, trim, rate = 1, x, y, s, clip, radius = 0 }) => (
  <div style={{ position: "absolute", left: clip.x, top: clip.y, width: clip.w, height: clip.h, overflow: "hidden", borderRadius: radius }}>
    <OffthreadVideo
      src={staticFile(src)}
      trimBefore={trim}
      playbackRate={rate}
      muted
      style={{ position: "absolute", left: x - clip.x, top: y - clip.y, width: 1920, height: 1080, transform: `scale(${s})`, transformOrigin: "0 0" }}
    />
  </div>
);

const Caption: React.FC<{ text: string; opacity: number }> = ({ text, opacity }) => (
  <div style={{ position: "absolute", left: 0, right: 0, bottom: 64, display: "flex", justifyContent: "center", opacity }}>
    <div style={{ ...font(40, 600), color: C.text, background: "rgba(16,13,13,0.9)", border: `1px solid ${C.line}`, borderRadius: 14, padding: "18px 34px" }}>
      {text}
    </div>
  </div>
);

const Header: React.FC<{ x: number; title: string; sub: string; time: string; done: boolean; accent: string; opacity: number }> = ({
  x,
  title,
  sub,
  time,
  done,
  accent,
  opacity,
}) => (
  <div
    style={{ position: "absolute", left: x, top: 22, width: COL.w, height: COL.top - 34, display: "flex", alignItems: "center", justifyContent: "space-between", opacity }}
  >
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ ...font(36, 700), color: C.text }}>{title}</div>
      <div style={{ ...font(22, 500), color: C.dim }}>{sub}</div>
    </div>
    <div style={{ ...font(56, 700), color: done ? accent : C.text, fontVariantNumeric: "tabular-nums", display: "flex", alignItems: "center", gap: 14 }}>
      {done ? <span style={{ ...font(40, 700) }}>✓</span> : null}
      {time}
    </div>
  </div>
);

/**
 * Chrome against Byterush on the same file, cut from two real screen recordings: the click in
 * Chrome and Byterush's "New download" window full screen, then both recordings side by side from
 * the same click, then the times.
 */
export const Demo: React.FC<{ race: Race }> = ({ race }) => {
  const frame = useCurrentFrame();
  const { AFTER, E0, E1, E2, S1, REAL, FAST } = timeline(race);
  const { chrome: CHROME, byterush: BYTERUSH, file: FILE, rate: RATE, realRate: REAL_RATE } = race;
  const inChrome = (s: number) => CHROME.click + s;
  const inByterush = (s: number) => BYTERUSH.click + s;
  /** Seconds after the click shown on the race's clocks at a composition frame. */
  const elapsed = (at: number) =>
    at < S1 + REAL ? E0 + ((at - S1) / FPS) * REAL_RATE : E1 + ((Math.min(at, S1 + REAL + FAST) - S1 - REAL) / FPS) * RATE;
  const e = frame / FPS - PRE; // seconds after the click, while full screen

  // full screen: a push in on the New download window while it asks
  const zoom =
    1 +
    0.36 *
      Math.min(
        interpolate(e, [AFTER.asked - 0.1, AFTER.asked + 0.6], [0, 1], { ...clamp, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
        interpolate(e, [AFTER.started - 0.15, E0 + 0.05], [1, 0], { ...clamp, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
      );
  const focus = { x: 946, y: 583 };
  // then into the right-hand column
  const p = interpolate(frame, [S1, S1 + MORPH], [0, 1], { ...clamp, easing: Easing.bezier(0.65, 0, 0.35, 1) });
  const full = { x: focus.x * (1 - zoom), y: focus.y * (1 - zoom), s: zoom };
  const col = { x: COL.right - WIN.x * K, y: COL.top - WIN.y * K, s: K };
  const mix = (a: number, b: number) => a + (b - a) * p;
  const b = { x: mix(full.x, col.x), y: mix(full.y, col.y), s: mix(full.s, col.s) };
  const clip = {
    x: mix(0, COL.right),
    y: mix(0, COL.top),
    w: mix(1920, COL.w),
    h: mix(1080, COL.h),
  };

  const t = elapsed(frame);
  const chromeDone = t >= AFTER.chromeDone;
  const byterushDone = t >= AFTER.byterushDone;
  const raceIn = interpolate(frame, [S1 + MORPH * 0.75, S1 + MORPH + 6], [0, 1], clamp);
  const fast = frame >= S1 + REAL && frame < S1 + REAL + FAST;
  const fastBadge = interpolate(frame, [S1 + REAL, S1 + REAL + 8, S1 + REAL + FAST - 8, S1 + REAL + FAST], [0, 1, 1, 0], clamp);
  const card = interpolate(frame, [S1 + REAL + FAST + HOLD, S1 + REAL + FAST + HOLD + f(0.5)], [0, 1], clamp);
  const caption = (from: number, to: number) => Math.min(interpolate(e, [from, from + 0.25], [0, 1], clamp), interpolate(e, [to - 0.25, to], [1, 0], clamp));
  const ratio = Math.floor((AFTER.chromeDone / AFTER.byterushDone) * 10) / 10;

  return (
    <AbsoluteFill style={{ background: DESK }}>
      {/* Byterush: one continuous recording, full screen and then the right-hand column */}
      <Sequence durationInFrames={S1}>
        <Footage src={BYTERUSH.src} trim={f(inByterush(-PRE))} x={b.x} y={b.y} s={b.s} clip={clip} radius={p * 10} />
      </Sequence>
      <Sequence from={S1} durationInFrames={REAL}>
        <Footage src={BYTERUSH.src} trim={f(inByterush(E0))} rate={REAL_RATE} x={b.x} y={b.y} s={b.s} clip={clip} radius={p * 10} />
      </Sequence>
      <Sequence from={S1 + REAL}>
        <Freeze frame={0}>
          <Footage src={BYTERUSH.src} trim={f(inByterush(E1))} x={col.x} y={col.y} s={K} clip={{ x: COL.right, y: COL.top, w: COL.w, h: COL.h }} radius={10} />
        </Freeze>
      </Sequence>

      {/* Chrome alone, from the same moment after its own click */}
      <Sequence from={S1} durationInFrames={REAL}>
        <div style={{ opacity: raceIn, transform: `translateX(${(1 - raceIn) * -60}px)` }}>
          <Footage
            src={CHROME.src}
            trim={f(inChrome(E0))}
            rate={REAL_RATE}
            x={COL.left - WIN.x * K}
            y={COL.top - WIN.y * K}
            s={K}
            clip={{ x: COL.left, y: COL.top, w: COL.w, h: COL.h }}
            radius={10}
          />
        </div>
      </Sequence>
      <Sequence from={S1 + REAL} durationInFrames={FAST}>
        <Footage
          src={CHROME.src}
          trim={f(inChrome(E1))}
          rate={RATE}
          x={COL.left - WIN.x * K}
          y={COL.top - WIN.y * K}
          s={K}
          clip={{ x: COL.left, y: COL.top, w: COL.w, h: COL.h }}
          radius={10}
        />
      </Sequence>
      <Sequence from={S1 + REAL + FAST}>
        <Freeze frame={0}>
          <Footage
            src={CHROME.src}
            trim={f(inChrome(E2))}
            x={COL.left - WIN.x * K}
            y={COL.top - WIN.y * K}
            s={K}
            clip={{ x: COL.left, y: COL.top, w: COL.w, h: COL.h }}
            radius={10}
          />
        </Freeze>
      </Sequence>

      {/* full screen: what happens */}
      {frame < S1 + MORPH && (
        <>
          <Caption text="Click a download in Chrome" opacity={caption(-PRE + 0.2, AFTER.asked - 0.2)} />
          <Caption text="Byterush asks where to save it, like IDM" opacity={caption(AFTER.asked + 0.1, AFTER.started - 0.1)} />
          <Caption text={`Start: ${race.connections} connections at once`} opacity={caption(AFTER.started, E0 + 0.6)} />
        </>
      )}

      {/* the race */}
      {frame >= S1 && (
        <>
          <Header
            x={COL.left}
            title="Chrome alone"
            sub="one connection, the way browsers download"
            time={clock(Math.min(t, AFTER.chromeDone))}
            done={chromeDone}
            accent={C.text}
            opacity={raceIn}
          />
          <Header
            x={COL.right}
            title="Chrome + Byterush"
            sub={`${race.connections} connections, after its New download window`}
            time={clock(Math.min(t, AFTER.byterushDone))}
            done={byterushDone}
            accent={C.lime}
            opacity={raceIn}
          />
          {REAL_RATE > 1 &&
            frame < S1 + REAL &&
            [COL.left, COL.right].map((x) => (
              <div
                key={x}
                style={{
                  position: "absolute",
                  left: x + 24,
                  top: COL.top + COL.h * 0.55,
                  ...font(28, 700),
                  color: "#0a0a0a",
                  background: C.lime,
                  borderRadius: 10,
                  padding: "10px 20px",
                  opacity: Math.min(raceIn, interpolate(frame, [S1 + REAL - 8, S1 + REAL], [1, 0], clamp)),
                }}
              >
                ▶▶ {REAL_RATE}× speed
              </div>
            ))}
          {fast && (
            <div
              style={{
                position: "absolute",
                left: COL.left + 24,
                top: COL.top + COL.h - 84,
                ...font(28, 700),
                color: "#0a0a0a",
                background: C.lime,
                borderRadius: 10,
                padding: "10px 20px",
                opacity: fastBadge,
              }}
            >
              ▶▶ {RATE}× speed
            </div>
          )}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 20, textAlign: "center", ...font(20, 500), color: C.dim, opacity: raceIn }}>
            {FILE.size} from {FILE.site} · two real recordings, one after the other, timed from the click
          </div>
        </>
      )}

      {/* the result */}
      {card > 0 && (
        <AbsoluteFill style={{ background: C.bg, opacity: card, alignItems: "center", justifyContent: "center", gap: 46 }}>
          <div style={{ ...font(150, 700), color: C.lime, letterSpacing: -4 }}>{ratio}× faster</div>
          <div style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 70, rowGap: 14, ...font(44, 600) }}>
            <span style={{ color: C.dim }}>Chrome alone</span>
            <span style={{ color: C.dim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{clock(AFTER.chromeDone)}</span>
            <span style={{ color: C.text }}>Chrome + Byterush</span>
            <span style={{ color: C.text, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{clock(AFTER.byterushDone)}</span>
          </div>
          <div style={{ ...font(23, 500), color: C.dim, textAlign: "center", lineHeight: 1.6, maxWidth: 1400 }}>
            The same {FILE.size} file from {FILE.site}, recorded one after the other on the same machine. Byterush's time includes the{" "}
            {Math.round(AFTER.started)} s from the click to "start download" in its window.{race.note ? ` ${race.note}` : ""}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 10 }}>
            <LogoMark size={64} />
            <span style={{ ...font(36, 700), color: C.text }}>byterush</span>
            <span style={{ ...font(26, 500), color: C.dim }}>free and open source · github.com/zecod/byterush</span>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
