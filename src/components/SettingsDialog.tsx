import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpenIcon } from "@hugeicons/core-free-icons";
import type { BridgeStatus, Settings } from "../api";
import { api } from "../api";
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

function BrowserSection({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [folder, setFolder] = useState("");
  useEffect(() => {
    api.bridgeStatus().then(setStatus).catch(() => setStatus(null));
  }, []);
  const openFolder = () => api.openExtensionFolder().then(setFolder).catch((e) => setFolder(String(e)));
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={enabled} onChange={(e) => onChange(e.target.checked)} />
        <span>catch downloads from the browser extension</span>
      </label>
      <div className="bridge-status">
        <span className={`status-text ${status?.listening ? "status-completed" : "status-error"}`}>
          {status?.listening ? `listening on 127.0.0.1:${status.port}` : status?.error ?? "not listening"}
        </span>
      </div>
      <ol className="steps">
        <li>
          open <code>chrome://extensions</code> (or edge://extensions) and turn on developer mode
        </li>
        <li>
          click <b>load unpacked</b> and pick the extension folder{" "}
          <button className="btn inline" onClick={openFolder}>
            <Icon icon={FolderOpenIcon} size={13} /> open folder
          </button>
        </li>
        <li>downloads in that browser now land here, with its cookies — protected sites included</li>
      </ol>
      {folder && <small className="selectable">{folder}</small>}
    </>
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
        <BrowserSection enabled={s.browser_integration} onChange={(v) => set("browser_integration", v)} />
        <label className="check">
          <input type="checkbox" checked={s.ask_before_download} onChange={(e) => set("ask_before_download", e.target.checked)} />
          <span>ask where to save each browser download (a "new download" window, like IDM's)</span>
        </label>

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
