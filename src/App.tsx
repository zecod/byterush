import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Copy01Icon,
  DashboardSpeed01Icon,
  Delete02Icon,
  FolderOpenIcon,
  Link01Icon,
  LinkSquare02Icon,
  PauseCircleIcon,
  PauseIcon,
  PlayCircleIcon,
  PlayIcon,
  Search01Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import type { Delta, Download, Settings } from "./api";
import { api, isActive, isMac, isPending, isWorking, shortcut } from "./api";
import { AddDialog } from "./components/AddDialog";
import { DetailsPanel } from "./components/DetailsPanel";
import { DownloadTable } from "./components/DownloadTable";
import { Icon } from "./components/icons";
import { Logo } from "./components/Logo";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ConfirmDelete } from "./components/Modal";
import { RefreshDialog } from "./components/RefreshDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { type Filter, matches, Sidebar } from "./components/Sidebar";
import "./App.css";

interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
  actions?: { label: string; run: () => void }[];
}

const LIMIT_KEY = "byterush.lastSpeedLimit";
const HISTORY = 60;

function lastLimit(): number {
  try {
    return Number(localStorage.getItem(LIMIT_KEY)) || 1024;
  } catch {
    return 1024;
  }
}

export default function App() {
  // rows live in a Map fed by delta events; `rev` triggers re-renders
  const store = useRef(new Map<string, Download>());
  const [rev, setRev] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(true);
  const [addUrl, setAddUrl] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [refreshFor, setRefreshFor] = useState<Download | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; d: Download } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [speedHistory, setSpeedHistory] = useState<number[]>(() => Array(HISTORY).fill(0));
  const searchRef = useRef<HTMLInputElement>(null);

  const toast = useCallback((t: Omit<Toast, "id">, ttl = 5000) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), ttl);
  }, []);
  const dismiss = (id: number) => setToasts((prev) => prev.filter((x) => x.id !== id));

  // a new download gets selected so its live view (speed, split, connections) opens right away
  const focusDownload = useCallback((id: string) => {
    setFilter("all");
    setQuery("");
    setSelected(new Set([id]));
    setAnchor(id);
    setShowDetails(true);
  }, []);
  const fail = useCallback((e: unknown) => toast({ kind: "error", text: String(e) }, 7000), [toast]);

  // the window starts hidden so it never flashes blank: show it once the first rows are drawn
  const shown = useRef(false);
  const reveal = useCallback(() => {
    if (shown.current) return;
    shown.current = true;
    getCurrentWindow()
      .show()
      .then(() => getCurrentWindow().setFocus())
      .catch(() => {});
  }, []);

  // live data
  useEffect(() => {
    // completions are grouped so a big batch shows one toast, not hundreds
    let finished: Download[] = [];
    let flushTimer: number | undefined;
    const flushFinished = () => {
      const list = finished;
      finished = [];
      const last = list[list.length - 1];
      if (!last) return;
      toast(
        {
          kind: "success",
          text: list.length === 1 ? `done · ${last.file_name}` : `${list.length} downloads finished`,
          actions: [
            ...(list.length === 1 ? [{ label: "open", run: () => api.open(last.id).catch(fail) }] : []),
            { label: "folder", run: () => api.reveal(last.id).catch(fail) },
          ],
        },
        8000,
      );
    };

    const apply = ({ full, upserts, removed }: Delta) => {
      const map = store.current;
      if (full) map.clear();
      for (const d of upserts) {
        const before = map.get(d.id);
        if (before && !full && before.status !== d.status) {
          if (d.status === "completed") {
            finished.push(d);
            clearTimeout(flushTimer);
            flushTimer = window.setTimeout(flushFinished, 800);
          }
          if (d.status === "error")
            toast(
              {
                kind: "error",
                text: `${d.file_name}: ${d.error}`,
                actions: d.resumable ? [{ label: "update link", run: () => setRefreshFor(d) }] : undefined,
              },
              10000,
            );
        }
        map.set(d.id, d);
      }
      for (const id of removed) map.delete(id);
      setRev((r) => r + 1);
      if (full) {
        setLoaded(true);
        requestAnimationFrame(() => requestAnimationFrame(reveal));
      }
    };
    const unDelta = listen<Delta>("downloads-delta", (e) => apply(e.payload));
    const unClipboard = listen<string>("clipboard-url", (e) =>
      toast({ kind: "info", text: `copied · ${e.payload}`, actions: [{ label: "download", run: () => setAddUrl(e.payload) }] }, 9000),
    );
    const unCaptured = listen<{ id: string; source: string; waiting: boolean }>("browser-captured", (e) => {
      // one waiting for an answer has its own "New download" window
      if (!e.payload.waiting) {
        const d = store.current.get(e.payload.id);
        toast({ kind: "info", text: `from browser · ${d?.file_name ?? "new download"}` }, 4000);
      }
      focusDownload(e.payload.id);
    });
    unDelta.then(() => api.sync()).catch(fail);
    api.getSettings().then(setSettings).catch(fail);
    const revealAnyway = window.setTimeout(reveal, 1000);
    return () => {
      clearTimeout(flushTimer);
      clearTimeout(revealAnyway);
      unDelta.then((f) => f());
      unClipboard.then((f) => f());
      unCaptured.then((f) => f());
    };
  }, [toast, fail, focusDownload, reveal]);

  const downloads = useMemo(() => [...store.current.values()], [rev]);

  // throughput history for the sparkline, sampled once a second
  const totalSpeed = useRef(0);
  totalSpeed.current = downloads.reduce((s, d) => s + d.speed, 0);
  useEffect(() => {
    const t = setInterval(() => setSpeedHistory((h) => [...h.slice(1), totalSpeed.current]), 1000);
    return () => clearInterval(t);
  }, []);

  // theme
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    if (settings.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", settings.theme);
  }, [settings?.theme]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return downloads
      .filter((d) => matches(d, filter))
      .filter((d) => !q || d.file_name.toLowerCase().includes(q) || d.url.toLowerCase().includes(q))
      .sort((a, b) => b.added_at - a.added_at);
  }, [downloads, filter, query]);

  const selectedDownloads = useMemo(() => [...selected].map((id) => store.current.get(id)).filter((d): d is Download => !!d), [selected, rev]);
  const ids = selectedDownloads.map((d) => d.id);
  const single = selectedDownloads.length === 1 ? selectedDownloads[0] : null;
  const canResume = selectedDownloads.some((d) => d.status === "paused" || d.status === "error");
  const canPause = selectedDownloads.some((d) => isActive(d.status) || isPending(d.status));
  const activeCount = downloads.filter((d) => isWorking(d.status)).length;

  const onSelect = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey && anchor) {
      const order = visible.map((d) => d.id);
      const [a, b] = [order.indexOf(anchor), order.indexOf(id)].sort((x, y) => x - y);
      if (a >= 0) {
        setSelected(new Set(order.slice(a, b + 1)));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
    } else {
      setSelected(new Set([id]));
    }
    setAnchor(id);
  };

  const activate = (d: Download) => {
    if (d.status === "completed") api.open(d.id).catch(fail);
    else if (d.status === "waiting") api.ask(d.id).catch(fail);
    else if (isActive(d.status) || isPending(d.status)) api.pause([d.id]);
    else api.resume([d.id]);
  };

  const saveSettings = (s: Settings) => {
    api.saveSettings(s).then(() => api.getSettings().then(setSettings)).catch(fail);
  };

  const toggleLimiter = () => {
    if (!settings) return;
    if (settings.speed_limit_kbps > 0) {
      try {
        localStorage.setItem(LIMIT_KEY, String(settings.speed_limit_kbps));
      } catch {
        /* storage unavailable */
      }
      saveSettings({ ...settings, speed_limit_kbps: 0 });
    } else {
      saveSettings({ ...settings, speed_limit_kbps: lastLimit() });
    }
  };

  // keyboard shortcuts (ctrl on Windows/Linux, ⌘ on macOS)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const typing = (e.target as HTMLElement).closest("input, textarea, select");
      if (addUrl !== null || showSettings || confirmIds || refreshFor) return;
      const key = e.key.toLowerCase();
      if (mod && key === "n") {
        e.preventDefault();
        setAddUrl("");
      } else if (mod && key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (mod && key === ",") {
        e.preventDefault();
        setShowSettings(true);
      } else if (typing) {
        return;
      } else if (mod && key === "a") {
        e.preventDefault();
        setSelected(new Set(visible.map((d) => d.id)));
      } else if ((e.key === "Delete" || (e.metaKey && e.key === "Backspace")) && selected.size) {
        setConfirmIds([...selected]);
      } else if (e.key === "Enter" && single) {
        activate(single);
      } else if (e.key === " " && selected.size) {
        e.preventDefault();
        if (canPause) api.pause(ids);
        else if (canResume) api.resume(ids);
      } else if (e.key === "Escape") {
        setSelected(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const allIds = downloads.map((d) => d.id);
  const limiterOn = (settings?.speed_limit_kbps ?? 0) > 0;

  return (
    <div className="app">
      <header className={`topbar ${isMac ? "mac" : ""}`} data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <Logo />
          byterush
          <span className="brand-version">v0.2</span>
        </div>
        <div className="search">
          <Icon icon={Search01Icon} size={15} />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="search downloads" />
          <kbd>{shortcut("f")}</kbd>
        </div>
        <div className="topbar-right">
          <button className={`chip ${limiterOn ? "on" : ""}`} onClick={toggleLimiter} title={limiterOn ? "Speed cap on — click to remove" : "Turn on the speed cap"}>
            <Icon icon={DashboardSpeed01Icon} size={14} /> {limiterOn ? `${settings?.speed_limit_kbps} KB/s` : "no cap"}
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)} title={`Settings (${shortcut(",")})`}>
            <Icon icon={Settings02Icon} size={17} />
          </button>
        </div>
      </header>

      <div className="body">
        <Sidebar downloads={downloads} filter={filter} onFilter={setFilter} speedHistory={speedHistory} speedLimitKbps={settings?.speed_limit_kbps ?? 0} />
        <main className="main">
          <div className="toolbar">
            <button className="btn primary" onClick={() => setAddUrl("")} title={`Add a download (${shortcut("n")})`}>
              <HugeiconsIcon icon={Add01Icon} size={15} strokeWidth={2} /> add url
            </button>
            <div className="tool-group">
              <button className="icon-btn" disabled={!canResume} onClick={() => api.resume(ids)} title="Resume (space)">
                <Icon icon={PlayIcon} />
              </button>
              <button className="icon-btn" disabled={!canPause} onClick={() => api.pause(ids)} title="Pause (space)">
                <Icon icon={PauseIcon} />
              </button>
              <button className="icon-btn" disabled={!selected.size} onClick={() => setConfirmIds(ids)} title="Remove (del)">
                <Icon icon={Delete02Icon} />
              </button>
            </div>
            <div className="tool-group">
              <button className="icon-btn" disabled={!downloads.length} onClick={() => api.resume(allIds)} title="Resume all">
                <Icon icon={PlayCircleIcon} />
              </button>
              <button className="icon-btn" disabled={!downloads.length} onClick={() => api.pause(allIds)} title="Pause all">
                <Icon icon={PauseCircleIcon} />
              </button>
            </div>
            <div className="spacer" />
            <div className="toolbar-stats">
              {visible.length} items{activeCount > 0 && <> · <span className="accent-text">{activeCount} active</span></>}
              {selected.size > 1 && ` · ${selected.size} selected`}
            </div>
          </div>

          <DownloadTable
            downloads={visible}
            loaded={loaded}
            selected={selected}
            onSelect={onSelect}
            onActivate={activate}
            onAdd={() => setAddUrl("")}
            onContextMenu={(d, e) => {
              e.preventDefault();
              if (!selected.has(d.id)) setSelected(new Set([d.id]));
              setMenu({ x: e.clientX, y: e.clientY, d });
            }}
          />

          {single && showDetails && (
            <ErrorBoundary area="details" key={single.id}>
              <DetailsPanel row={single} onClose={() => setShowDetails(false)} />
            </ErrorBoundary>
          )}
          {single && !showDetails && (
            <button className="details-toggle" onClick={() => setShowDetails(true)}>
              show details
            </button>
          )}
        </main>
      </div>

      {menu && (
        <div className="context-menu" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 220) }}>
          {menu.d.status === "completed" ? (
            <button onClick={() => api.open(menu.d.id).catch(fail)}>
              <Icon icon={LinkSquare02Icon} size={15} /> open
            </button>
          ) : isActive(menu.d.status) || isPending(menu.d.status) ? (
            <button onClick={() => api.pause(ids)}>
              <Icon icon={PauseIcon} size={15} /> pause
            </button>
          ) : (
            <button onClick={() => api.resume(ids)}>
              <Icon icon={PlayIcon} size={15} /> resume
            </button>
          )}
          <button onClick={() => api.reveal(menu.d.id).catch(fail)}>
            <Icon icon={FolderOpenIcon} size={15} /> show in folder
          </button>
          {menu.d.status !== "completed" && !isWorking(menu.d.status) && !isPending(menu.d.status) && (
            <button onClick={() => setRefreshFor(menu.d)}>
              <Icon icon={Link01Icon} size={15} /> update link…
            </button>
          )}
          <button
            onClick={() => {
              navigator.clipboard.writeText(menu.d.url);
              toast({ kind: "info", text: "link copied" }, 2000);
            }}
          >
            <Icon icon={Copy01Icon} size={15} /> copy link
          </button>
          <hr />
          <button className="danger" onClick={() => setConfirmIds(ids)}>
            <Icon icon={Delete02Icon} size={15} /> remove…
          </button>
        </div>
      )}

      {addUrl !== null && settings && (
        <AddDialog
          initialUrl={addUrl}
          settings={settings}
          onClose={() => setAddUrl(null)}
          onError={fail}
          onAdded={(ids) => ids[0] && focusDownload(ids[0])}
        />
      )}
      {showSettings && settings && <SettingsDialog settings={settings} onSave={saveSettings} onClose={() => setShowSettings(false)} />}
      {refreshFor && (
        <RefreshDialog
          download={refreshFor}
          onClose={() => setRefreshFor(null)}
          onDone={() => toast({ kind: "info", text: `link updated · ${refreshFor.file_name}` }, 3000)}
        />
      )}
      {confirmIds && (
        <ConfirmDelete
          count={confirmIds.length}
          onClose={() => setConfirmIds(null)}
          onConfirm={(deleteFiles) => {
            api.remove(confirmIds, deleteFiles).catch(fail);
            setSelected(new Set());
            setConfirmIds(null);
          }}
        />
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span className="toast-mark">{t.kind === "error" ? "[!]" : t.kind === "success" ? "[✓]" : "[*]"}</span>
            <span className="toast-text">{t.text}</span>
            {t.actions?.map((a) => (
              <button
                key={a.label}
                onClick={() => {
                  a.run();
                  dismiss(t.id);
                }}
              >
                {a.label}
              </button>
            ))}
            <button className="toast-close" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
