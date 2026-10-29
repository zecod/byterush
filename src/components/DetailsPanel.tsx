import { useEffect, useRef, useState } from "react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import type { Download, Segment } from "../api";
import { api, formatBytes, formatDate, formatEta, formatPercent, formatSpeed, isWorking, statusLabel } from "../api";
import { Icon } from "./icons";

const POLL_MS = 300;

/** Per-connection speed from successive snapshots of the segments. */
function useSegmentSpeeds(segments: Segment[]) {
  const prev = useRef<{ at: number; done: number[] }>({ at: 0, done: [] });
  const speeds = useRef<number[]>([]);
  const now = performance.now();
  const dt = (now - prev.current.at) / 1000;
  if (dt > 0.15) {
    speeds.current = segments.map((s, i) => {
      const before = prev.current.done[i];
      const inst = before == null || dt > 5 ? 0 : Math.max(0, (s.downloaded - before) / dt);
      const old = speeds.current[i] ?? inst;
      return old * 0.5 + inst * 0.5;
    });
    prev.current = { at: now, done: segments.map((s) => s.downloaded) };
  }
  return speeds.current;
}

/** The file as a strip: one block per segment filling up, active connections glowing at their head. */
function SegmentMap({ d, speeds }: { d: Download; speeds: number[] }) {
  const total = d.size ?? 0;
  if (!total || d.segments.length === 0) {
    return <div className="segment-map empty-map">{d.status === "completed" ? "complete" : "the split appears as soon as the size is known"}</div>;
  }
  const running = d.status === "downloading";
  return (
    <div className="segment-map">
      {d.segments.map((s, i) => {
        const len = s.end - s.start;
        const filled = len > 0 ? (s.downloaded / len) * 100 : 100;
        const busy = running && s.downloaded < len && (speeds[i] ?? 0) > 0;
        return (
          <div key={i} className="segment" style={{ left: `${(s.start / total) * 100}%`, width: `${(len / total) * 100}%` }}>
            <div className={`segment-fill ${busy ? "busy" : ""} ${s.downloaded >= len ? "done" : ""}`} style={{ width: `${filled}%` }} />
          </div>
        );
      })}
    </div>
  );
}

function FinishingBar({ d }: { d: Download }) {
  const f = d.finishing;
  const pct = f && f.total ? (f.done / f.total) * 100 : 0;
  const what = f?.stage === "rebuilding" ? "rebuilding file from its parts" : f?.stage === "moving" ? `moving to ${d.dir}` : "writing to disk";
  // the disk is busy elsewhere or not answering: say so instead of sitting silently at the same %
  const lastChange = useRef({ done: -1, at: Date.now() });
  if (f && f.done !== lastChange.current.done) lastChange.current = { done: f.done, at: Date.now() };
  const stalledFor = Math.floor((Date.now() - lastChange.current.at) / 1000);
  return (
    <div className="finishing">
      <div className="finishing-head">
        <span>{what}</span>
        <span>{f && f.total ? `${formatBytes(f.done)} / ${formatBytes(f.total)} · ${formatPercent(pct)}` : ""}</span>
      </div>
      <div className={`finishing-bar ${stalledFor >= 10 ? "stalled" : ""}`}>
        <div style={{ width: `${pct}%` }} />
      </div>
      {stalledFor >= 10 && (
        <span className="error-text">[!] the disk hasn't accepted data for {stalledFor}s — if it's an external drive, check its cable and connection</span>
      )}
    </div>
  );
}

/** Live view of one download; segments are fetched on demand to keep list events small. */
export function DetailsPanel({ row, onClose }: { row: Download; onClose: () => void }) {
  const [full, setFull] = useState<Download | null>(null);

  useEffect(() => {
    setFull(null);
  }, [row.id]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.get(row.id).then((d) => {
        if (alive && d) setFull(d);
      });
    load();
    const timer = isWorking(row.status) ? setInterval(load, POLL_MS) : undefined;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [row.id, row.status]);

  const d: Download = full && full.id === row.id ? { ...row, ...full } : { ...row, segments: [] };
  const segments = d.segments;
  const speeds = useSegmentSpeeds(segments);
  const pct = d.size ? (d.downloaded / d.size) * 100 : d.status === "completed" ? 100 : 0;
  const order = segments.map((s, i) => ({ s, i })).sort((a, b) => a.s.start - b.s.start);
  const live = d.status === "downloading";

  return (
    <section className={`details ${live ? "live" : ""}`}>
      <header className="details-head">
        <div className="details-title-wrap">
          <div className="details-title" title={d.file_name}>
            {d.file_name}
          </div>
          <div className="details-sub">
            <span className={`status-text status-${d.status}`}>{statusLabel[d.status]}</span>
            {live && <span className="live-speed">{formatSpeed(d.speed) || "0 B/s"}</span>}
            <span>
              {formatBytes(d.downloaded)} / {formatBytes(d.size)} · {formatPercent(pct, 1)}
            </span>
            {d.eta != null && live && <span>{formatEta(d.eta)} left</span>}
            {d.active_connections > 0 && (
              <span>
                {d.active_connections} connections
                {d.refused_connections > 0 && <span title="This server allows only so many connections at once; the others wait for a turn and try again."> · {d.refused_connections} refused by the server</span>}
              </span>
            )}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close details">
          <Icon icon={Cancel01Icon} size={15} />
        </button>
      </header>


      {d.status === "finishing" ? (
        <FinishingBar d={d} />
      ) : (
        <>
          <div className="fig-label">
            Fig 2. split — {d.segment_count} ranges over {d.connections} connections
          </div>
          <SegmentMap d={d} speeds={speeds} />
        </>
      )}

      <div className="details-body">
        <div className="segment-list">
          <div className="segment-list-head">
            <span>#</span>
            <span>range</span>
            <span>progress</span>
            <span>speed</span>
          </div>
          <div className="segment-list-rows">
            {order.map(({ s, i }, n) => {
              const len = s.end - s.start;
              const p = len > 0 ? (s.downloaded / len) * 100 : 100;
              const sp = speeds[i] ?? 0;
              const active = live && p < 100 && sp > 0;
              return (
                <div key={i} className={`segment-row ${active ? "active" : ""} ${p >= 100 ? "done" : ""}`}>
                  <span>{String(n + 1).padStart(2, "0")}</span>
                  <span>
                    {formatBytes(s.start)} – {s.end >= Number.MAX_SAFE_INTEGER ? "end" : formatBytes(s.end)}
                  </span>
                  <span>
                    <span className="mini-bar">
                      <span style={{ width: `${p}%` }} />
                    </span>
                    {formatPercent(p)}
                  </span>
                  <span className="seg-speed">{active ? formatSpeed(sp) : p >= 100 ? "done" : "—"}</span>
                </div>
              );
            })}
          </div>
        </div>
        <dl className="info-grid">
          <dt>url</dt>
          <dd className="selectable" title={d.url}>
            {d.url}
          </dd>
          <dt>save to</dt>
          <dd className="selectable" title={d.dir}>
            {d.dir}
          </dd>
          <dt>storage</dt>
          <dd>{d.layout === "parts" ? "one part per connection · rebuilt at the end" : "single file · written in place"}</dd>
          <dt>resume</dt>
          <dd>{d.resumable ? "supported · parallel ranges" : d.size == null && d.status !== "completed" ? "not checked yet" : "not supported"}</dd>
          <dt>added</dt>
          <dd>
            {formatDate(d.added_at)}
            {d.completed_at && ` · done ${formatDate(d.completed_at)}`}
          </dd>
          {d.error && (
            <>
              <dt>error</dt>
              <dd className="error-text">{d.error}</dd>
            </>
          )}
        </dl>
      </div>
    </section>
  );
}
