import { useCallback, useEffect, useState } from "react";
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
 * The "New download" window for a download the browser handed over, like IDM's: what the file is,
 * where it goes and whether that drive has room, then start, keep for later or cancel. The
 * download waits, its first response open, until this window answers; closing it keeps the
 * download paused for later (handled by the app).
 */
export function ConfirmWindow({ id }: { id: string }) {
  const win = getCurrentWindow();
  const [download, setDownload] = useState<Download | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [fileName, setFileName] = useState("");
  const [dir, setDir] = useState("");
  const [connections, setConnections] = useState(8);
  const [space, setSpace] = useState<DiskSpace | null>(null);
  const [ask, setAsk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // the download as the engine has it; gone (removed in the main window) closes this one
  useEffect(() => {
    let first = true;
    const load = async () => {
      const d = await api.get(id).catch(() => null);
      if (!d) {
        if (!first) win.close();
        return;
      }
      setDownload(d);
      if (first) {
        first = false;
        setFileName(d.file_name);
        setDir(d.dir);
        setConnections(d.connections);
        requestAnimationFrame(() => requestAnimationFrame(() => win.show().then(() => win.setFocus())));
      }
    };
    load();
    const timer = setInterval(load, 1000);
    return () => clearInterval(timer);
  }, [id, win]);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setAsk(s.ask_before_download);
      const root = document.documentElement;
      if (s.theme === "system") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", s.theme);
    });
  }, []);

  useEffect(() => {
    if (!dir) return;
    let live = true;
    api.diskSpace(dir).then((s) => live && setSpace(s)).catch(() => live && setSpace(null));
    return () => {
      live = false;
    };
  }, [dir]);

  const answer = useCallback(
    async (start: boolean) => {
      setBusy(true);
      setError("");
      try {
        await api.confirm(id, { file_name: fileName.trim() || undefined, dir, connections, start });
        if (settings && !ask) await api.saveSettings({ ...settings, ask_before_download: false });
        await win.close();
      } catch (e) {
        setError(String(e));
        setBusy(false);
      }
    },
    [id, fileName, dir, connections, ask, settings, win],
  );

  const cancel = useCallback(async () => {
    setBusy(true);
    await api.remove([id], true).catch(() => {});
    await win.close();
  }, [id, win]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key === "Enter" && !(e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        answer(true);
      } else if (e.key === "Escape") {
        // like closing the window: kept for later
        win.close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, busy, win]);

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
