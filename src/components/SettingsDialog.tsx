import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpenIcon, PuzzleIcon } from "@hugeicons/core-free-icons";
import type { BridgeStatus, Settings, TempFiles } from "../api";
import { api, formatBytes, formatDate } from "../api";
import { ExtensionSetup } from "./ExtensionSetup";
import { Icon } from "./icons";
import { Modal } from "./Modal";

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

function FolderField({ label, value, placeholder, onChange, hint }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void; hint?: string }) {
  const browse = async () => {
    const dir = await open({ directory: true, defaultPath: value || undefined });
    if (typeof dir === "string") onChange(dir);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-with-button">
        <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
        {value && placeholder && (
          <button className="btn" onClick={() => onChange("")} title="Use the default">
            reset
          </button>
        )}
        <button className="btn" onClick={browse} title="Choose folder">
          <Icon icon={FolderOpenIcon} size={15} />
        </button>
      </div>
      {hint && <small>{hint}</small>}
    </label>
  );
}

function BrowserSection({ s, set }: { s: Settings; set: <K extends keyof Settings>(key: K, value: Settings[K]) => void }) {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    api.bridgeStatus().then(setStatus).catch(() => setStatus(null));
  }, [setup]);
  const seen = status?.extension_seen_ms ?? (s.extension_seen_ms || null);
  const from = status?.extension_browser || s.extension_browser;
  // the size limit in the unit it reads best in; the number stays when the unit changes
  const [unit, setUnit] = useState<"MB" | "GB">(s.small_file_limit_mb >= 1024 && s.small_file_limit_mb % 1024 === 0 ? "GB" : "MB");
  const factor = unit === "GB" ? 1024 : 1;
  const amount = Math.max(1, Math.round(s.small_file_limit_mb / factor));
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={s.browser_integration} onChange={(e) => set("browser_integration", e.target.checked)} />
        <span>catch downloads from the browser extension</span>
      </label>
      <div className="bridge-status">
        <span className={`status-text ${status?.listening ? "status-completed" : "status-error"}`}>
          {status?.listening ? `listening on 127.0.0.1:${status.port}` : (status?.error ?? "not listening")}
        </span>
        <span className="muted">
          {" · "}
          {seen ? `extension last checked in ${from ? `from ${from} ` : ""}${formatDate(seen)}` : "extension not set up yet"}
        </span>
      </div>
      <div>
        <button className="btn" onClick={() => setSetup(true)}>
          <Icon icon={PuzzleIcon} size={14} /> set up the extension…
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={s.ask_before_download} onChange={(e) => set("ask_before_download", e.target.checked)} />
        <span>ask where to save each browser download (a "new download" window, like IDM's)</span>
      </label>
      <div className="check-line">
        <label className="check">
          <input type="checkbox" checked={s.leave_small_to_browser} onChange={(e) => set("leave_small_to_browser", e.target.checked)} />
          <span>leave downloads smaller than</span>
        </label>
        <input
          className="small-number"
          type="number"
          min={1}
          value={amount}
          disabled={!s.leave_small_to_browser}
          onChange={(e) => set("small_file_limit_mb", Math.max(1, Math.round(+e.target.value || 1)) * factor)}
          aria-label="size"
        />
        <select
          value={unit}
          disabled={!s.leave_small_to_browser}
          onChange={(e) => {
            const next = e.target.value as "MB" | "GB";
            setUnit(next);
            set("small_file_limit_mb", amount * (next === "GB" ? 1024 : 1));
          }}
          aria-label="unit"
        >
          <option>MB</option>
          <option>GB</option>
        </select>
        <span className={s.leave_small_to_browser ? "" : "muted"}>to the browser</span>
      </div>
      {setup && <ExtensionSetup settings={s} onClose={() => setSetup(false)} />}
    </>
  );
}

/**
 * Where the partial files are, how much room they take, and the leftovers no download owns any
 * more (a crash, or an older version that kept them when a download was removed).
 */
function TempFilesInfo() {
  const [temp, setTemp] = useState<TempFiles | null>(null);
  const [error, setError] = useState("");
  const load = () => api.tempFiles().then(setTemp).catch((e) => setError(String(e)));
  useEffect(() => {
    load();
  }, []);
  if (!temp) return error ? <p className="error-text">{error}</p> : null;
  const sum = (fs: TempFiles["files"]) => fs.reduce((n, f) => n + f.size, 0);
  const inUse = temp.files.filter((f) => !f.leftover);
  const leftover = temp.files.filter((f) => f.leftover);
  const clean = () =>
    api
      .cleanTempFiles()
      .then(load)
      .catch((e) => setError(String(e)));
  return (
    <div className="temp-files">
      <div className="temp-files-line">
        <span className="muted">
          partial files now in <code className="selectable">{temp.dir}</code>
          {" · "}
          {inUse.length ? `${inUse.length} in use, ${formatBytes(sum(inUse))}` : "none in use"}
        </span>
        <button className="btn" onClick={() => api.openTempFolder().catch((e) => setError(String(e)))} title="open the folder">
          <Icon icon={FolderOpenIcon} size={14} />
        </button>
      </div>
      {leftover.length > 0 && (
        <div className="temp-files-line">
          <span>
            <b>{leftover.length} left over</b> from removed or crashed downloads · {formatBytes(sum(leftover))}
          </span>
          <button className="btn danger" onClick={clean} title={leftover.map((f) => f.path).join("\n")}>
            delete
          </button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

export function SettingsDialog({ settings, onSave, onClose }: Props) {
  const [s, setS] = useState<Settings>(settings);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS((prev) => ({ ...prev, [key]: value }));

  return (
    <Modal title="settings" onClose={onClose} width={600}>
      <div className="settings">
        <h3>01 · storage</h3>
        <FolderField label="download folder" value={s.download_dir} onChange={(v) => set("download_dir", v)} />
        <FolderField
          label="temporary folder"
          value={s.temp_dir}
          placeholder="next to the final file"
          onChange={(v) => set("temp_dir", v)}
          hint="partial files live here while downloading, then move to the download folder. a fast SSD helps."
        />
        <TempFilesInfo />
        <label className="check">
          <input type="checkbox" checked={s.category_subfolders} onChange={(e) => set("category_subfolders", e.target.checked)} />
          <span>sort files into category folders (video, music, documents…)</span>
        </label>

        <h3>02 · connections</h3>
        <label className="field">
          <span>
            connections per download <b>{s.connections}</b>
          </span>
          <input type="range" min={1} max={32} value={s.connections} onChange={(e) => set("connections", +e.target.value)} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>simultaneous downloads</span>
            <input type="number" min={1} max={20} value={s.max_active} onChange={(e) => set("max_active", +e.target.value)} />
          </label>
          <label className="field">
            <span>retries</span>
            <input type="number" min={0} max={50} value={s.retries} onChange={(e) => set("retries", +e.target.value)} />
          </label>
          <label className="field">
            <span>speed cap · KB/s</span>
            <input type="number" min={0} value={s.speed_limit_kbps} onChange={(e) => set("speed_limit_kbps", Math.max(0, +e.target.value))} />
          </label>
        </div>
        <label className="field">
          <span>user-agent</span>
          <input
            value={s.user_agent}
            placeholder="automatic · byterush's own"
            onChange={(e) => set("user_agent", e.target.value)}
            spellCheck={false}
          />
          <small>leave empty unless a site needs a specific one: posing as a browser makes some sites send a web page instead of the file. downloads from the extension use the browser's own.</small>
        </label>

        <h3>03 · browser</h3>
        <BrowserSection s={s} set={set} />

        <h3>04 · behaviour</h3>
        <label className="check">
          <input type="checkbox" checked={s.resume_on_startup} onChange={(e) => set("resume_on_startup", e.target.checked)} />
          <span>continue unfinished downloads when byterush starts (after a restart or a crash)</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.monitor_clipboard} onChange={(e) => set("monitor_clipboard", e.target.checked)} />
          <span>offer to download links copied to the clipboard</span>
        </label>
        <div className="field">
          <span>theme</span>
          <div className="segmented">
            {(["system", "dark", "light"] as const).map((t) => (
              <button key={t} className={s.theme === t ? "active" : ""} onClick={() => set("theme", t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="modal-actions">
        <div className="spacer" />
        <button className="btn ghost" onClick={onClose}>
          cancel
        </button>
        <button
          className="btn primary"
          onClick={() => {
            onSave(s);
            onClose();
          }}
        >
          save
        </button>
      </div>
    </Modal>
  );
}
