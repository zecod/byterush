import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { Alert02Icon, CheckmarkCircle02Icon, FolderOpenIcon, Loading03Icon } from "@hugeicons/core-free-icons";
import type { DiskSpace, Download, Settings } from "../api";
import { api, formatBytes } from "../api";
import { CategoryBadge, Icon } from "./icons";
import { Logo } from "./Logo";

const CONNECTION_CHOICES = [1, 2, 4, 6, 8, 12, 16, 24, 32];

function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The "New download" window for downloads the browser hands over, like IDM's: what the file is,
 * where it goes and whether that drive has room, then start, keep for later or cancel. Each
 * download waits, its first response open, until answered. The app keeps this window loaded but
 * hidden and sends it the download to ask about ("ask"), one at a time; after an answer it hides
 * it or sends the next. Closing it keeps the download paused for later.
 */
export function ConfirmWindow() {
  const win = getCurrentWindow();
  /** The download to ask about, and which request this is (the same one can be asked about again). */
  const [asked, setAsked] = useState<{ id: string; n: number } | null>(null);
  const id = asked?.id ?? null;
  const [download, setDownload] = useState<Download | null>(null);
  /** The request this window was last shown for. */
  const [shownFor, setShownFor] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [fileName, setFileName] = useState("");
  const [dir, setDir] = useState("");
  const [connections, setConnections] = useState(8);
  const [space, setSpace] = useState<DiskSpace | null>(null);
  const [ask, setAsk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // which download to ask about: the current one when this window loads, then each one the app sends
  useEffect(() => {
    const askAbout = (id: string) => setAsked((a) => ({ id, n: (a?.n ?? 0) + 1 }));
    const un = listen<string>("ask", (e) => askAbout(e.payload));
    api.askingNow().then((now) => now && askAbout(now));
    return () => {
      un.then((f) => f());
    };
  }, []);

  // the download as the engine has it, shown once loaded; kept fresh while asked about
  useEffect(() => {
    if (!asked) return;
    const { id } = asked;
    let first = true;
    setDownload(null);
    setBusy(false);
    setError("");
    const load = async () => {
      const d = await api.get(id).catch(() => null);
      if (!d) return;
      setDownload(d);
      if (first) {
        first = false;
        setFileName(d.file_name);
        setDir(d.dir);
        setConnections(d.connections);
      }
    };
    load();
    const timer = setInterval(load, 1000);
    return () => clearInterval(timer);
  }, [asked]);

  // show the window once the download is drawn in it. Not on an animation frame: a hidden web view
  // gets none.
  useLayoutEffect(() => {
    if (!asked || download?.id !== asked.id || shownFor === asked.n) return;
    setShownFor(asked.n);
    // centred each time: window managers place a reused window where they like
    win
      .center()
      .catch(() => {})
      .then(() => win.show())
      .then(() => win.setFocus());
  }, [asked, download, shownFor, win]);

  // read again for every download: this window lives as long as the app
  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setAsk(s.ask_before_download);
      const root = document.documentElement;
      if (s.theme === "system") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", s.theme);
    });
  }, [asked]);

  useEffect(() => {
    if (!dir) return;
    let live = true;
    api.diskSpace(dir).then((s) => live && setSpace(s)).catch(() => live && setSpace(null));
    return () => {
      live = false;
    };
  }, [dir]);

  // the app hides this window or moves on to the next download once answered
  const answer = useCallback(
    async (start: boolean) => {
      if (!id) return;
      setBusy(true);
      setError("");
      try {
        await api.confirm(id, { file_name: fileName.trim() || undefined, dir, connections, start });
        if (settings && !ask) await api.saveSettings({ ...settings, ask_before_download: false });
      } catch (e) {
        setError(String(e));
        setBusy(false);
      }
    },
    [id, fileName, dir, connections, ask, settings],
  );

  const cancel = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    await api.cancelAsked(id).catch((e) => {
      setError(String(e));
      setBusy(false);
    });
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key === "Enter" && !(e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        answer(true);
      } else if (e.key === "Escape") {
        // like closing the window: kept for later
        answer(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, busy]);

  const browse = async () => {
    // the folder picker must not open underneath this always-on-top window
    await win.setAlwaysOnTop(false).catch(() => {});
    const picked = await open({ directory: true, defaultPath: dir || undefined }).catch(() => null);
    await win.setAlwaysOnTop(true).catch(() => {});
    if (typeof picked === "string") setDir(picked);
  };

  if (!download) {
    return (
      <div className="confirm-window loading">
        <Icon icon={Loading03Icon} size={18} className="spin" />
      </div>
    );
  }

  const size = download.size;
  const resumable = download.resumable;
  const tooBig = size != null && space != null && size > space.free;
  const used = space && space.total > 0 ? 1 - space.free / space.total : 0;
  const share = space && space.total > 0 && size != null ? Math.min(size / space.total, 1 - used) : 0;

  return (
    <div className="confirm-window">
      <header className="confirm-head">
        <Logo size={18} />
        <span>new download</span>
        <span className="confirm-from" title={download.url}>
          from {host(download.url)}
        </span>
      </header>

      <section className="confirm-file">
        <CategoryBadge category={download.category} />
        <div className="confirm-file-text">
          <input
            className="name-input"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            spellCheck={false}
            aria-label="file name"
            autoFocus
          />
          <div className="probe-meta">
            <strong className="confirm-size">{size != null ? formatBytes(size) : "size unknown"}</strong>
            <span className={resumable ? "ok" : "warn"}>
              <Icon icon={resumable ? CheckmarkCircle02Icon : Alert02Icon} size={13} />
              {resumable ? `resumable · up to ${connections} connections` : "no resume · 1 connection"}
            </span>
          </div>
        </div>
      </section>

      <div className="field-row">
        <label className="field grow">
          <span>save to</span>
          <div className="input-with-button">
            <input value={dir} title={dir} readOnly onClick={browse} spellCheck={false} />
            <button className="btn" onClick={browse} title="choose a folder">
              <Icon icon={FolderOpenIcon} size={15} />
            </button>
          </div>
        </label>
        <label className="field">
          <span>connections</span>
          <select value={connections} onChange={(e) => setConnections(+e.target.value)} disabled={!resumable}>
            {CONNECTION_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={`disk ${tooBig ? "full" : ""}`}>
        <div className="disk-bar" aria-hidden="true">
          <span className="disk-used" style={{ width: `${used * 100}%` }} />
          <span className="disk-file" style={{ width: `${share * 100}%` }} />
        </div>
        <div className="disk-text">
          {space ? (
            tooBig ? (
              <span className="error-text">
                <Icon icon={Alert02Icon} size={13} /> not enough room: {formatBytes(size)} needed, {formatBytes(space.free)} free
              </span>
            ) : (
              <>
                <span>
                  <i className="key-file" /> this file {size != null ? formatBytes(size) : "?"}
                </span>
                <span>
                  {formatBytes(space.free)} free of {formatBytes(space.total)}
                </span>
              </>
            )
          ) : (
            <span>free space unknown</span>
          )}
        </div>
      </div>

      <div className="split-preview">
        <div className="split-bars" aria-hidden="true">
          {Array.from({ length: resumable ? connections : 1 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
        <span>
          {resumable
            ? `${connections} ranges downloaded side by side, one per connection; a connection that finishes early takes over half of the biggest range left`
            : "one range over one connection: this server can't send parts of the file"}
        </span>
      </div>

      {error && (
        <p className="error-text confirm-error">
          <Icon icon={Alert02Icon} size={13} /> {error}
        </p>
      )}

      <footer className="confirm-actions">
        <label className="check">
          <input type="checkbox" checked={ask} onChange={(e) => setAsk(e.target.checked)} />
          <span>ask for every browser download</span>
        </label>
        <div className="spacer" />
        <button className="btn ghost" onClick={cancel} disabled={busy}>
          cancel
        </button>
        <button className="btn" onClick={() => answer(false)} disabled={busy}>
          later
        </button>
        <button className="btn primary" onClick={() => answer(true)} disabled={busy}>
          {busy ? <Icon icon={Loading03Icon} size={14} className="spin" /> : null}
          start download <kbd>↵</kbd>
        </button>
      </footer>
    </div>
  );
}
