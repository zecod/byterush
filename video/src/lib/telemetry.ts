/** A real download recorded by src-tauri/examples/record.rs: ten snapshots a second. */
export type Segment = [start: number, end: number, downloaded: number];
export type Frame = {
  t: number;
  status: string;
  downloaded: number;
  speed: number;
  active: number;
  segments: Segment[];
};
export type Telemetry = {
  url: string;
  file_name: string;
  size: number;
  connections: number;
  seconds: number;
  frames: Frame[];
};

/** The download as it was `t` seconds after it started, interpolated between snapshots. */
export function sample(tel: Telemetry, t: number): Frame {
  const f = tel.frames;
  if (t <= f[0].t) return f[0];
  const last = f[f.length - 1];
  if (t >= last.t) return last;
  let lo = 0;
  let hi = f.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (f[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = f[lo];
  const b = f[hi];
  const k = (t - a.t) / (b.t - a.t || 1);
  const base = k < 0.5 ? a : b;
  const segments = base.segments.map(([start, end], i): Segment => {
    const from = a.segments[i];
    const to = b.segments[i];
    const done = from && to && from[0] === start && to[0] === start ? from[2] + (to[2] - from[2]) * k : base.segments[i][2];
    return [start, end, Math.min(end - start, done)];
  });
  return {
    t,
    status: base.status,
    downloaded: a.downloaded + (b.downloaded - a.downloaded) * k,
    speed: a.speed + (b.speed - a.speed) * k,
    active: base.active,
    segments,
  };
}

/** First moment the download reached `status` (e.g. "completed"). */
export const timeOf = (tel: Telemetry, status: string) => tel.frames.find((f) => f.status === status)?.t ?? tel.seconds;

export const mb = (bytes: number) => bytes / 1e6;

/** "0:17.1", "7:02" */
export function clock(seconds: number, tenths = true) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  const ss = tenths ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0");
  return `${m}:${ss}`;
}

/** Bytes per second over the last `window` seconds (steadier than the engine's instant meter). */
export function rate(tel: Telemetry, t: number, window = 1) {
  const from = Math.max(0, t - window);
  if (t - from < 0.05) return 0;
  return Math.max(0, (sample(tel, t).downloaded - sample(tel, from).downloaded) / (t - from));
}

/** Average speed over the whole download. */
export const average = (tel: Telemetry) => tel.size / Math.max(0.001, timeOf(tel, "completed") - (tel.frames.find((f) => f.status === "downloading")?.t ?? 0));
