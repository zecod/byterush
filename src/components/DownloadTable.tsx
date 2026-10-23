import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Alert02Icon, CloudDownloadIcon } from "@hugeicons/core-free-icons";
import type { Download } from "../api";
import { finishingLabel, formatBytes, formatDate, formatEta, formatSpeed, progress, shortcut, statusLabel } from "../api";
import { CategoryBadge, Icon } from "./icons";

interface Props {
  downloads: Download[];
  /** The first rows arrived; until then an empty list means "not loaded yet", not "no downloads". */
  loaded: boolean;
  selected: Set<string>;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onActivate: (d: Download) => void;
  onContextMenu: (d: Download, e: React.MouseEvent) => void;
  onAdd: () => void;
}

const ROW_HEIGHT = 50;

function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ProgressBar({ d }: { d: Download }) {
  const p = progress(d);
  return (
    <div className={`progress status-${d.status}`}>
      <div className={`progress-fill ${p == null ? "indeterminate" : ""}`} style={{ width: p == null ? undefined : `${p * 100}%` }} />
    </div>
  );
}

function Row({ d, selected, ...handlers }: { d: Download; selected: boolean } & Omit<Props, "downloads" | "selected" | "onAdd" | "loaded">) {
  const p = progress(d);
  return (
    <div
      className={`row ${selected ? "selected" : ""}`}
      onMouseDown={(e) => e.button === 0 && handlers.onSelect(d.id, e)}
      onDoubleClick={() => handlers.onActivate(d)}
      onContextMenu={(e) => handlers.onContextMenu(d, e)}
    >
      <div className="cell name-cell">
        <CategoryBadge category={d.category} />
        <div className="name-text">
          <div className="file-name" title={d.file_name}>
            {d.file_name}
          </div>
          <div className="file-sub">
            {d.status === "error" ? (
              <span className="error-text" title={d.error ?? ""}>
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
          <span>{p != null && d.status !== "completed" ? `${(p * 100).toFixed(1)}%` : ""}</span>
        </div>
      </div>
      <div className="cell num strong">{formatSpeed(d.speed)}</div>
      <div className="cell num">{formatEta(d.eta)}</div>
      <div className="cell num weak">{formatDate(d.added_at)}</div>
    </div>
  );
}

/** Virtualized list: only rows in view are rendered, so thousands of downloads stay smooth. */
export function DownloadTable({ downloads, selected, onAdd, loaded, ...handlers }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: downloads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (i) => downloads[i].id,
  });

  if (downloads.length === 0) {
    if (!loaded) return <div className="table" />;
    return (
      <div className="empty">
        <div className="empty-icon">
          <Icon icon={CloudDownloadIcon} size={30} />
        </div>
        <h2>nothing here yet</h2>
        <p>Paste a link, or copy one anywhere — byterush offers to grab it.</p>
        <button className="btn primary" onClick={onAdd}>
          add a download <kbd>{shortcut("n")}</kbd>
        </button>
      </div>
    );
  }

  return (
    <div className="table">
      <div className="row head">
        <div className="cell">name</div>
        <div className="cell num">size</div>
        <div className="cell">progress</div>
        <div className="cell num">speed</div>
        <div className="cell num">eta</div>
        <div className="cell num">added</div>
      </div>
      <div className="table-scroll" ref={scrollRef}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((v) => {
            const d = downloads[v.index];
            return (
              <div key={v.key} className="row-slot" style={{ transform: `translateY(${v.start}px)`, height: ROW_HEIGHT }}>
                <Row d={d} selected={selected.has(d.id)} {...handlers} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
