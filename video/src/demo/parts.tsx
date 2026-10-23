import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  FolderOpenIcon,
  Link01Icon,
  ListViewIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { formatBytes } from "../../../src/api";
import { CategoryBadge, Icon } from "../../../src/components/icons";
import { LogoMark } from "../components/LogoMark";
import { C, clamp, font } from "../lib/theme";

/** Positions of the window's controls (window coordinates, measured on a still). */
export const SPOT = {
  addUrl: [297, 79],
  pause: [424, 79],
  play: [390, 79],
  row1: [480, 165],
  segmentMap: [733, 592],
  dialogAddress: [600, 349],
  dialogConnections: [751, 497],
  dialogDownload: [818, 556],
} as const;

type Key = [frame: number, x: number, y: number];

/** Where the pointer is: eased moves between keyframes. */
export function pointer(frame: number, keys: Key[]) {
  if (frame <= keys[0][0]) return { x: keys[0][1], y: keys[0][2] };
  for (let i = 1; i < keys.length; i++) {
    const [f0, x0, y0] = keys[i - 1];
    const [f1, x1, y1] = keys[i];
    if (frame <= f1) {
      const k = interpolate(frame, [f0, f1], [0, 1], { ...clamp, easing: Easing.bezier(0.45, 0, 0.2, 1) });
      return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k };
    }
  }
  const last = keys[keys.length - 1];
  return { x: last[1], y: last[2] };
}

/** A macOS-style pointer; `clicks` are frames where it presses. */
export const Cursor: React.FC<{ x: number; y: number; clicks?: number[] }> = ({ x, y, clicks = [] }) => {
  const frame = useCurrentFrame();
  const press = clicks.find((c) => frame >= c && frame < c + 10);
  const k = press === undefined ? 0 : interpolate(frame, [press, press + 3, press + 10], [0, 1, 0], clamp);
  const ring = press === undefined ? 0 : interpolate(frame, [press, press + 10], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", left: x, top: y, pointerEvents: "none", zIndex: 50 }}>
      {press !== undefined && (
        <div
          style={{
            position: "absolute",
            left: -22,
            top: -22,
            width: 44,
            height: 44,
            borderRadius: 22,
            border: `2px solid ${C.lime}`,
            opacity: 1 - ring,
            scale: `${0.4 + ring}`,
          }}
        />
      )}
      <svg width="26" height="30" viewBox="0 0 26 30" style={{ scale: `${1 - 0.15 * k}`, transformOrigin: "0 0", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}>
        <path d="M2 2 L2 24 L8 18.5 L12.5 28 L16.5 26.2 L12.2 17 L20 17 Z" fill="#fff" stroke="#111" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

/** The "new download" dialog (src/components/AddDialog.tsx), at a given stage. */
export const AddDialogView: React.FC<{
  open: number;
  typed: string;
  checking: boolean;
  ready: boolean;
  fileName: string;
  size: number;
  contentType: string;
  connections: number;
}> = ({ open, typed, checking, ready, fileName, size, contentType, connections }) => {
  const frame = useCurrentFrame();
  if (open <= 0) return null;
  return (
    <div className="backdrop" style={{ opacity: open }}>
      <div className="modal" style={{ width: 560, scale: `${0.94 + 0.06 * open}` }}>
        <header className="modal-head">
          <h2>new download</h2>
          <button className="icon-btn">
            <Icon icon={Cancel01Icon} size={15} />
          </button>
        </header>
        <div className="modal-body">
          <div className="tabs">
            <button className="active">
              <Icon icon={Link01Icon} size={14} /> single link
            </button>
            <button>
              <Icon icon={ListViewIcon} size={14} /> batch
            </button>
          </div>
          <label className="field">
            <span>address</span>
            <input value={typed} placeholder="https://example.com/file.zip" readOnly />
          </label>
          <div className={`probe-card ${ready ? "ready" : ""}`}>
            {checking && (
              <div className="probe-state">
                <span style={{ display: "inline-flex", rotate: `${frame * 12}deg` }}>
                  <Icon icon={Loading03Icon} size={15} />
                </span>{" "}
                checking the link…
              </div>
            )}
            {!checking && !ready && <div className="probe-state muted">file details appear once the link is checked</div>}
            {ready && (
              <>
                <CategoryBadge category="video" />
                <div className="probe-info">
                  <input className="name-input" value={fileName} readOnly />
                  <div className="probe-meta">
                    <span>{formatBytes(size)}</span>
                    <span>{contentType}</span>
                    <span className="ok">
                      <Icon icon={CheckmarkCircle02Icon} size={13} />
                      resumable
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="field-row">
            <label className="field grow">
              <span>save to</span>
              <div className="input-with-button">
                <input value="…/Downloads/Video" readOnly />
                <button className="btn">
                  <Icon icon={FolderOpenIcon} size={15} />
                </button>
              </div>
            </label>
            <label className="field">
              <span>connections</span>
              <select value={String(connections)} onChange={() => {}}>
                <option>{connections}</option>
              </select>
            </label>
          </div>
          <div className="modal-actions">
            <button className="btn ghost">cancel</button>
            <div className="spacer" />
            <button className="btn" disabled={!ready}>
              later
            </button>
            <button className="btn primary" disabled={!ready}>
              download now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/** A neutral browser window with a page of download links and the extension in its toolbar. */
export const BrowserMock: React.FC<{ host: string; links: string[]; hover?: number; badge?: number; shelf?: string }> = ({ host, links, hover, badge = 0, shelf }) => (
  <div style={{ position: "relative", width: 900, height: 560, background: "#f7f6f6", borderRadius: 12, overflow: "hidden", boxShadow: "0 40px 120px rgba(0,0,0,0.6)", border: "1px solid #d4d0d0" }}>
    <div style={{ height: 44, background: "#e8e5e5", display: "flex", alignItems: "center", gap: 8, padding: "0 16px" }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, display: "inline-block" }} />
      ))}
      <div style={{ marginLeft: 18, flex: 1, height: 28, background: "#fff", borderRadius: 14, display: "flex", alignItems: "center", padding: "0 14px", ...font(15, 500), color: "#555" }}>
        {host}
      </div>
      <div style={{ position: "relative", width: 30, height: 30, borderRadius: 7, background: "#141111", display: "grid", placeItems: "center" }}>
        <LogoMark size={22} />
        {badge > 0 && (
          <span style={{ position: "absolute", right: -6, bottom: -6, padding: "1px 5px", background: C.lime, color: "#141010", borderRadius: 6, ...font(12, 700), scale: `${badge}` }}>✓</span>
        )}
      </div>
    </div>
    <div style={{ padding: "34px 40px", ...font(20, 500), color: "#333" }}>
      <div style={{ ...font(28, 700), color: "#111", marginBottom: 18 }}>Test files</div>
      {links.map((l, i) => (
        <div key={l} style={{ padding: "10px 0", color: "#1a5fd0", textDecoration: hover === i ? "underline" : "none", background: hover === i ? "#e9f0ff" : "transparent", borderRadius: 4 }}>
          ⬇ {l}
        </div>
      ))}
    </div>
    {shelf && (
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 56, background: "#ecebeb", borderTop: "1px solid #d4d0d0", display: "flex", alignItems: "center", padding: "0 18px", ...font(16, 500), color: "#666" }}>
        {shelf}
      </div>
    )}
  </div>
);

/** Bottom caption: step number and what is happening. */
export const Caption: React.FC<{ step: string; text: string; p: number }> = ({ step, text, p }) => (
  <div style={{ position: "absolute", left: 120, bottom: 44, display: "flex", alignItems: "center", gap: 22, opacity: p, translate: `0 ${(1 - p) * 20}px` }}>
    <span style={{ padding: "6px 14px", background: C.lime, color: C.bg, borderRadius: 6, ...font(30, 700) }}>{step}</span>
    <span style={{ ...font(38, 600), color: C.text }}>{text}</span>
  </div>
);
