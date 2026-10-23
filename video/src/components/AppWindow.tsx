import React from "react";
import { useCurrentFrame } from "remotion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Alert02Icon,
  Cancel01Icon,
  DashboardSpeed01Icon,
  Delete02Icon,
  PauseCircleIcon,
  PauseIcon,
  PlayCircleIcon,
  PlayIcon,
  Search01Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
// the app's own code: styles, components and formatting
import "../../../src/App.css";
import "./app-video.css";
import type { Category, Download, Status } from "../../../src/api";
import { finishingLabel, formatBytes, formatEta, formatPercent, formatSpeed, progress, statusLabel } from "../../../src/api";
import { ProgressBar } from "../../../src/components/DownloadTable";
import { CategoryBadge, Icon } from "../../../src/components/icons";
import { Logo } from "../../../src/components/Logo";
import { Sidebar } from "../../../src/components/Sidebar";
import type { Telemetry } from "../lib/telemetry";
import { sample } from "../lib/telemetry";

export const WINDOW = { width: 1240, height: 780 };

export type Row = Download & { added: string; segSpeeds?: number[] };

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const CATEGORY: Record<string, Category> = { avi: "video", mp4: "video", mkv: "video", iso: "compressed", zip: "compressed", bin: "general", dat: "general", pdf: "documents", mp3: "music", exe: "programs", msi: "programs", deb: "programs", xz: "compressed", "7z": "compressed" };

/** A list row as the app keeps it. */
export function row(p: Partial<Row> & { id: string; file_name: string; url: string }): Row {
  const ext = p.file_name.split(".").pop()?.toLowerCase() ?? "";
  return {
    dir: "/home/me/Downloads",
    category: CATEGORY[ext] ?? "general",
    size: null,
    resumable: true,
    connections: 32,
    segments: [],
    status: "completed",
    error: null,
    added_at: 0,
    completed_at: null,
    part_path: null,
    segment_count: 0,
    layout: "single",
    finishing: null,
    downloaded: p.size ?? 0,
    speed: 0,
    eta: null,
    active_connections: 0,
    added: "09:12",
    ...p,
  };
}

/** The row of a recorded download, `t` seconds in. */
export function liveRow(tel: Telemetry, t: number, base: Partial<Row> & { id: string }): Row {
  const s = sample(tel, Math.max(0, t));
  const before = sample(tel, Math.max(0, t - 0.5));
  // each range's own speed over the last half second, like the details panel measures it
  const segSpeeds = s.segments.map(([start, , done]) => {
    const prev = before.segments.find(([b]) => b === start);
    return prev ? Math.max(0, (done - prev[2]) / 0.5) : 0;
  });
  const status = (t < 0 ? "queued" : s.status) as Status;
  return row({
    url: tel.url,
    file_name: tel.file_name,
    ...base,
    size: tel.size,
    connections: tel.connections,
    status,
    downloaded: t < 0 ? 0 : s.downloaded,
    speed: status === "downloading" ? s.speed : 0,
    eta: status === "downloading" && s.speed > 1 ? (tel.size - s.downloaded) / s.speed : null,
    active_connections: status === "downloading" ? s.active : 0,
    segment_count: s.segments.length,
    segments: t < 0 ? [] : s.segments.map(([start, end, downloaded]) => ({ start, end, downloaded })),
    segSpeeds,
  });
}

/** Total speed over the last minute, one sample a second (for the sidebar's sparkline). */
/**
 * The sidebar's throughput graph at time t: one sample a second for the last minute. A recording
 * starts at `offset`, or `local` maps time to the recording's own clock (null while it isn't running).
 */
export function history(tels: { tel: Telemetry; offset?: number; local?: (at: number) => number | null }[], t: number) {
  return Array.from({ length: 60 }, (_, i) => {
    const at = t - (59 - i);
    return tels.reduce((sum, { tel, offset = 0, local: clock }) => {
      const local = clock ? clock(at) : at - offset;
      if (local === null || local < 0 || local > tel.seconds) return sum;
      const s = sample(tel, local);
      return sum + (s.status === "downloading" ? s.speed : 0);
    }, 0);
  });
}

const Row_: React.FC<{ d: Row; selected: boolean }> = ({ d, selected }) => {
  const p = progress(d);
  return (
    <div className={`row ${selected ? "selected" : ""}`}>
      <div className="cell name-cell">
        <CategoryBadge category={d.category} />
        <div className="name-text">
          <div className="file-name">{d.file_name}</div>
          <div className="file-sub">
            {d.status === "error" ? (
              <span className="error-text">
                <Icon icon={Alert02Icon} size={12} /> {d.error}
              </span>
            ) : (
              host(d.url)
            )}
          </div>
        </div>
      </div>
      <div className="cell num">{formatBytes(d.size)}</div>
      <div className="cell progress-cell">
        <ProgressBar d={d} />
        <div className="progress-meta">
          <span className={`status-text status-${d.status}`}>{finishingLabel(d) ?? statusLabel[d.status]}</span>
          <span>{p != null && d.status !== "completed" ? formatPercent(p * 100, 1) : ""}</span>
        </div>
      </div>
      <div className="cell num strong">{formatSpeed(d.speed)}</div>
      <div className="cell num">{formatEta(d.eta)}</div>
      <div className="cell num weak">{d.added}</div>
    </div>
  );
};

/** The details panel's split: every range where it sits in the file. */
const SegmentMap: React.FC<{ d: Row }> = ({ d }) => {
  const frame = useCurrentFrame();
  const total = d.size ?? 0;
  if (!total || d.segments.length === 0) {
    return <div className="segment-map empty-map">{d.status === "completed" ? "complete" : "the split appears as soon as the size is known"}</div>;
  }
  const running = d.status === "downloading";
  return (
    <div className="segment-map">
      {d.segments.map((s, i) => {
        const len = s.end - s.start;
        const filled = len > 0 ? Math.min(100, (s.downloaded / len) * 100) : 100;
        const busy = running && s.downloaded < len;
        return (
          <div key={i} className="segment" style={{ left: `${(s.start / total) * 100}%`, width: `${(len / total) * 100}%` }}>
            <div
              className={`segment-fill ${busy ? "busy" : ""} ${s.downloaded >= len ? "done" : ""}`}
              style={{ width: `${filled}%`, backgroundPosition: `${frame * 1.1}px 0` }}
            />
          </div>
        );
      })}
    </div>
  );
};

const Details: React.FC<{ d: Row }> = ({ d }) => {
  const frame = useCurrentFrame();
  const pct = d.size ? (d.downloaded / d.size) * 100 : 0;
  const live = d.status === "downloading";
  const order = d.segments.map((s, i) => ({ s, i })).sort((a, b) => a.s.start - b.s.start);
  return (
    <section className="details">
      {live && <div className="video-scan" style={{ backgroundPosition: `${((frame * 3) % 160) - 40}% 0` }} />}
      <header className="details-head">
        <div className="details-title-wrap">
          <div className="details-title">{d.file_name}</div>
          <div className="details-sub">
            <span className={`status-text status-${d.status}`}>{statusLabel[d.status]}</span>
            {live && <span className="live-speed">{formatSpeed(d.speed) || "0 B/s"}</span>}
            <span>
              {formatBytes(d.downloaded)} / {formatBytes(d.size)} · {pct.toFixed(1)}%
            </span>
            {d.eta != null && live && <span>{formatEta(d.eta)} left</span>}
            {d.active_connections > 0 && <span>{d.active_connections} connections</span>}
          </div>
        </div>
        <button className="icon-btn">
          <Icon icon={Cancel01Icon} size={15} />
        </button>
      </header>
      <div className="fig-label">
        Fig 2. split — {d.segment_count} ranges over {d.connections} connections
      </div>
      <SegmentMap d={d} />
      <div className="details-body">
        <div className="segment-list">
          <div className="segment-list-head">
            <span>#</span>
            <span>range</span>
            <span>progress</span>
            <span>speed</span>
          </div>
          <div className="segment-list-rows">
            {order.slice(0, 6).map(({ s, i }, n) => {
              const len = s.end - s.start;
              const p = len > 0 ? Math.min(100, (s.downloaded / len) * 100) : 100;
              const active = live && p < 100;
              return (
                <div key={i} className={`segment-row ${active ? "active" : ""} ${p >= 100 ? "done" : ""}`}>
                  <span>{String(n + 1).padStart(2, "0")}</span>
                  <span>
                    {formatBytes(s.start)} – {formatBytes(s.end)}
                  </span>
                  <span>
                    <span className="mini-bar">
                      <span style={{ width: `${p}%` }} />
                    </span>
                    {formatPercent(p)}
                  </span>
                  <span className="seg-speed">{active ? formatSpeed(d.segSpeeds?.[i] ?? 0) || "—" : p >= 100 ? "done" : "—"}</span>
                </div>
              );
            })}
          </div>
        </div>
        <dl className="info-grid">
          <dt>url</dt>
          <dd>{d.url}</dd>
          <dt>save to</dt>
          <dd>{d.dir}</dd>
          <dt>storage</dt>
          <dd>single file · written in place</dd>
          <dt>resume</dt>
          <dd>supported · parallel ranges · crash-safe</dd>
        </dl>
      </div>
    </section>
  );
};

export type Toast = { kind: "info" | "success" | "error"; text: string; actions?: string[]; p?: number };

export type AppWindowProps = {
  rows: Row[];
  selected?: string;
  speedHistory: number[];
  toasts?: Toast[];
  modal?: React.ReactNode;
  theme?: "dark" | "light";
  /** drawn on top, in window coordinates (cursor, highlights) */
  overlay?: React.ReactNode;
  style?: React.CSSProperties;
};

/** Byterush's main window, drawn with the app's own CSS and components. */
export const AppWindow: React.FC<AppWindowProps> = ({ rows, selected, speedHistory, toasts = [], modal, theme = "dark", overlay, style }) => {
  const single = rows.find((r) => r.id === selected);
  const active = rows.filter((r) => r.status === "downloading" || r.status === "connecting" || r.status === "finishing").length;
  return (
    <div className={`video-window video-${theme}`} style={{ width: WINDOW.width, height: WINDOW.height, ...style }}>
      <div className="app">
        <header className="topbar mac">
          <div className="traffic">
            <i />
            <i />
            <i />
          </div>
          <div className="brand">
            <Logo />
            byterush
            <span className="brand-version">v0.3</span>
          </div>
          <div className="search">
            <Icon icon={Search01Icon} size={15} />
            <input value="" placeholder="search downloads" readOnly />
            <kbd>⌘F</kbd>
          </div>
          <div className="topbar-right">
            <button className="chip">
              <Icon icon={DashboardSpeed01Icon} size={14} /> no cap
            </button>
            <button className="icon-btn">
              <Icon icon={Settings02Icon} size={17} />
            </button>
          </div>
        </header>
        <div className="body">
          <Sidebar downloads={rows} filter="all" onFilter={() => {}} speedHistory={speedHistory} speedLimitKbps={0} />
          <main className="main">
            <div className="toolbar">
              <button className="btn primary">
                <HugeiconsIcon icon={Add01Icon} size={15} strokeWidth={2} /> add url
              </button>
              <div className="tool-group">
                <button className="icon-btn" disabled={!single || single.status !== "paused"}>
                  <Icon icon={PlayIcon} />
                </button>
                <button className="icon-btn" disabled={!single || single.status !== "downloading"}>
                  <Icon icon={PauseIcon} />
                </button>
                <button className="icon-btn" disabled={!single}>
                  <Icon icon={Delete02Icon} />
                </button>
              </div>
              <div className="tool-group">
                <button className="icon-btn">
                  <Icon icon={PlayCircleIcon} />
                </button>
                <button className="icon-btn">
                  <Icon icon={PauseCircleIcon} />
                </button>
              </div>
              <div className="spacer" />
              <div className="toolbar-stats">
                {rows.length} items{active > 0 && <> · <span className="accent-text">{active} active</span></>}
              </div>
            </div>
            <div className="table">
              <div className="row head">
                <div className="cell">name</div>
                <div className="cell num">size</div>
                <div className="cell">progress</div>
                <div className="cell num">speed</div>
                <div className="cell num">eta</div>
                <div className="cell num">added</div>
              </div>
              <div className="table-scroll">
                {rows.map((d) => (
                  <div key={d.id} className="video-row-slot">
                    <Row_ d={d} selected={d.id === selected} />
                  </div>
                ))}
              </div>
            </div>
            {single && <Details d={single} />}
          </main>
        </div>
      </div>
      {modal}
      <div className="toasts">
        {toasts.map((t, i) => (
          <div key={i} className={`toast ${t.kind}`} style={{ opacity: t.p ?? 1, translate: `0 ${(1 - (t.p ?? 1)) * 20}px` }}>
            <span className="toast-mark">{t.kind === "error" ? "[!]" : t.kind === "success" ? "[✓]" : "[*]"}</span>
            <span className="toast-text">{t.text}</span>
            {t.actions?.map((a) => (
              <button key={a}>{a}</button>
            ))}
            <button className="toast-close">×</button>
          </div>
        ))}
      </div>
      {overlay}
    </div>
  );
};
