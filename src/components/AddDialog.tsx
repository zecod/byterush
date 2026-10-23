import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Alert02Icon, CheckmarkCircle02Icon, FolderOpenIcon, Link01Icon, ListViewIcon, Loading03Icon } from "@hugeicons/core-free-icons";
import type { ProbeInfo, Settings } from "../api";
import { api, expandBatch, formatBytes } from "../api";
import { CategoryBadge, Icon } from "./icons";
import { Modal } from "./Modal";

interface Props {
  initialUrl: string;
  settings: Settings;
  onClose: () => void;
  onError: (msg: string) => void;
  /** New downloads, so the app can select them and show their live view. */
  onAdded: (ids: string[]) => void;
}

const CONNECTION_CHOICES = [1, 2, 4, 6, 8, 12, 16, 24, 32];

/** Keep the meaningful end of a long path visible: "…\Downloads\Compressed". */
function shortPath(p: string, max = 34) {
  return p.length <= max ? p : `…${p.slice(p.length - max + 1)}`;
}

async function pickFolder(current: string) {
  const dir = await open({ directory: true, defaultPath: current || undefined });
  return typeof dir === "string" ? dir : null;
}

export function AddDialog({ initialUrl, settings, onClose, onError, onAdded }: Props) {
  const [tab, setTab] = useState<"single" | "batch">("single");
  const [url, setUrl] = useState(initialUrl);
  const [probe, setProbe] = useState<ProbeInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState("");
  const [fileName, setFileName] = useState("");
  const [dir, setDir] = useState("");
  const [dirTouched, setDirTouched] = useState(false);
  const [connections, setConnections] = useState(settings.connections);
  const [busy, setBusy] = useState(false);

  const [pattern, setPattern] = useState("");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(10);
  const [pad, setPad] = useState(1);
  const batch = expandBatch(pattern.trim(), from, to, pad);

  const probeSeq = useRef(0);
  useEffect(() => {
    if (tab !== "single") return;
    const trimmed = url.trim();
    let valid = false;
    try {
      valid = ["http:", "https:"].includes(new URL(trimmed).protocol);
    } catch {
      /* not a URL yet */
    }
    setProbe(null);
    setProbeError("");
    if (!valid) return;
    const seq = ++probeSeq.current;
    setProbing(true);
    const timer = setTimeout(async () => {
      try {
        const info = await api.probe(trimmed);
        if (seq !== probeSeq.current) return;
        setProbe(info);
        setFileName(info.file_name);
        if (!dirTouched) setDir(info.dir);
      } catch (e) {
        if (seq === probeSeq.current) setProbeError(String(e));
      } finally {
        if (seq === probeSeq.current) setProbing(false);
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tab]);

  async function submitSingle(start: boolean) {
    setBusy(true);
    try {
      const id = await api.add({
        url: url.trim(),
        file_name: fileName.trim() || undefined,
        dir: dirTouched ? dir : undefined,
        connections,
        size: probe?.size,
        start,
      });
      onAdded([id]);
      onClose();
    } catch (e) {
      onError(String(e));
      setBusy(false);
    }
  }

  async function submitBatch(start: boolean) {
    setBusy(true);
    try {
      const { ids, errors } = await api.addMany(batch.map((u) => ({ url: u, dir: dirTouched ? dir : undefined, connections, start })));
      if (errors.length) onError(`${errors.length} of ${batch.length} links could not be added`);
      onAdded(ids);
      onClose();
    } catch (e) {
      onError(String(e));
      setBusy(false);
    }
  }

  const browse = async () => {
    const picked = await pickFolder(dir || settings.download_dir);
    if (picked) {
      setDir(picked);
      setDirTouched(true);
    }
  };

  const canSubmit = tab === "single" ? !!probe && !busy : batch.length > 0 && !busy;

  return (
    <Modal title="new download" onClose={onClose} width={560}>
      <div className="tabs">
        <button className={tab === "single" ? "active" : ""} onClick={() => setTab("single")}>
          <Icon icon={Link01Icon} size={14} /> single link
        </button>
        <button className={tab === "batch" ? "active" : ""} onClick={() => setTab("batch")}>
          <Icon icon={ListViewIcon} size={14} /> batch
        </button>
      </div>

      {tab === "single" ? (
        <>
          <label className="field">
            <span>address</span>
            <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/file.zip" spellCheck={false} />
          </label>
          <div className={`probe-card ${probe ? "ready" : ""}`}>
            {probing && (
              <div className="probe-state">
                <Icon icon={Loading03Icon} size={15} className="spin" /> checking the link…
              </div>
            )}
            {!probing && probeError && (
              <div className="probe-state error-text">
                <Icon icon={Alert02Icon} size={15} /> {probeError}
              </div>
            )}
            {!probing && !probe && !probeError && <div className="probe-state muted">file details appear once the link is checked</div>}
            {probe && !probing && (
              <>
                <CategoryBadge category={probe.category} />
                <div className="probe-info">
                  <input className="name-input" value={fileName} onChange={(e) => setFileName(e.target.value)} spellCheck={false} />
                  <div className="probe-meta">
                    <span>{formatBytes(probe.size)}</span>
                    {probe.content_type && <span>{probe.content_type.split(";")[0]}</span>}
                    <span className={probe.resumable ? "ok" : "warn"}>
                      <Icon icon={probe.resumable ? CheckmarkCircle02Icon : Alert02Icon} size={13} />
                      {probe.resumable ? "resumable" : "no resume · 1 connection"}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="hint">
            Use <code>*</code> where the number goes, e.g. <code>https://site.com/photos/img*.jpg</code>
          </p>
          <label className="field">
            <span>address pattern</span>
            <input autoFocus value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="https://site.com/files/part*.zip" spellCheck={false} />
          </label>
          <div className="field-row">
            <label className="field">
              <span>from</span>
              <input type="number" min={0} value={from} onChange={(e) => setFrom(+e.target.value)} />
            </label>
            <label className="field">
              <span>to</span>
              <input type="number" min={0} value={to} onChange={(e) => setTo(+e.target.value)} />
            </label>
            <label className="field">
              <span>digits</span>
              <input type="number" min={1} max={8} value={pad} onChange={(e) => setPad(+e.target.value)} />
            </label>
          </div>
          <div className="batch-preview">
            {batch.length ? (
              <>
                {batch.slice(0, 3).map((u) => (
                  <div key={u} className="mono">
                    {u}
                  </div>
                ))}
                {batch.length > 3 && <div className="muted">… +{batch.length - 3} more</div>}
              </>
            ) : (
              <div className="muted">the pattern needs a * and a valid range</div>
            )}
          </div>
        </>
      )}

      <div className="field-row">
        <label className="field grow">
          <span>save to</span>
          <div className="input-with-button">
            <input
              value={dir ? shortPath(dir) : tab === "batch" ? "category folder (auto)" : ""}
              title={dir}
              readOnly
              placeholder="category folder (auto)"
              onClick={browse}
            />
            <button className="btn" onClick={browse}>
              <Icon icon={FolderOpenIcon} size={15} />
            </button>
          </div>
        </label>
        <label className="field">
          <span>connections</span>
          <select value={connections} onChange={(e) => setConnections(+e.target.value)}>
            {CONNECTION_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          cancel
        </button>
        <div className="spacer" />
        <button className="btn" disabled={!canSubmit} onClick={() => (tab === "single" ? submitSingle(false) : submitBatch(false))}>
          later
        </button>
        <button className="btn primary" disabled={!canSubmit} onClick={() => (tab === "single" ? submitSingle(true) : submitBatch(true))}>
          {busy ? <Icon icon={Loading03Icon} size={14} className="spin" /> : null}
          {tab === "batch" && batch.length ? `download ${batch.length} files` : "download now"}
        </button>
      </div>
    </Modal>
  );
}
