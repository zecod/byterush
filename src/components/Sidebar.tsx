import type { Category, Download } from "../api";
import { formatSpeed, isActive, isWorking } from "../api";
import { categoryLabel } from "./icons";

export type Filter = "all" | "active" | "unfinished" | "completed" | `cat:${Category}`;

export function matches(d: Download, f: Filter): boolean {
  switch (f) {
    case "all":
      return true;
    case "active":
      return isWorking(d.status) || d.status === "queued";
    case "unfinished":
      return d.status !== "completed";
    case "completed":
      return d.status === "completed";
    default:
      return d.category === f.slice(4);
  }
}

const views: { id: Filter; label: string }[] = [
  { id: "all", label: "all" },
  { id: "active", label: "active" },
  { id: "unfinished", label: "unfinished" },
  { id: "completed", label: "completed" },
];

const categories: Category[] = ["video", "music", "documents", "compressed", "programs", "general"];

/** Total throughput over the last ~30 s. */
function Sparkline({ samples }: { samples: number[] }) {
  const w = 180;
  const h = 34;
  const peak = Math.max(...samples);
  const max = Math.max(1, peak);
  const step = w / Math.max(1, samples.length - 1);
  const points = samples.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`);
  const line = points.join(" ");
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      {peak <= 0 ? (
        <line x1={0} x2={w} y1={h - 2} y2={h - 2} className="spark-idle" />
      ) : (
        <>
          <polygon points={`0,${h} ${line} ${w},${h}`} className="spark-area" />
          <polyline points={line} className="spark-line" />
        </>
      )}
    </svg>
  );
}

interface Props {
  downloads: Download[];
  filter: Filter;
  onFilter: (f: Filter) => void;
  speedHistory: number[];
  speedLimitKbps: number;
}

export function Sidebar({ downloads, filter, onFilter, speedHistory, speedLimitKbps }: Props) {
  const counts = new Map<Filter, number>();
  for (const d of downloads) {
    counts.set("all", (counts.get("all") ?? 0) + 1);
    if (isWorking(d.status) || d.status === "queued") counts.set("active", (counts.get("active") ?? 0) + 1);
    if (d.status === "completed") counts.set("completed", (counts.get("completed") ?? 0) + 1);
    else counts.set("unfinished", (counts.get("unfinished") ?? 0) + 1);
    const c: Filter = `cat:${d.category}`;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const totalSpeed = speedHistory[speedHistory.length - 1] ?? 0;
  const running = downloads.filter((d) => isActive(d.status)).length;

  const item = (id: Filter, label: string) => (
    <button key={id} className={`nav-item ${filter === id ? "selected" : ""}`} onClick={() => onFilter(id)}>
      <span className="nav-marker">{filter === id ? "[*]" : "[ ]"}</span>
      <span className="nav-label">{label}</span>
      <span className="nav-count">{counts.get(id) ?? 0}</span>
    </button>
  );

  return (
    <aside className="sidebar">
      <nav>
        <div className="nav-heading">views</div>
        {views.map((v) => item(v.id, v.label))}
        <div className="nav-heading">categories</div>
        {categories.map((c) => item(`cat:${c}`, categoryLabel[c]))}
      </nav>
      <div className="sidebar-footer">
        <div className="fig-label">Fig 1. throughput</div>
        <Sparkline samples={speedHistory} />
        <div className="speed-value">{formatSpeed(totalSpeed) || "0 B/s"}</div>
        <div className="speed-sub">
          {running} running{speedLimitKbps > 0 && ` · cap ${speedLimitKbps} KB/s`}
        </div>
      </div>
    </aside>
  );
}
