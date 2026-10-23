import { useState } from "react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import type { Download } from "../api";
import { api, formatBytes } from "../api";
import { Icon } from "./icons";
import { Modal } from "./Modal";

interface Props {
  download: Download;
  onClose: () => void;
  onDone: () => void;
}

/** Give a download whose link expired a fresh one; it continues from where it stopped. */
export function RefreshDialog({ download, onClose, onDone }: Props) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pct = download.size ? ((download.downloaded / download.size) * 100).toFixed(1) : "0";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    api
      .refresh(download.id, url.trim())
      .then(() => {
        onDone();
        onClose();
      })
      .catch((err) => {
        setError(String(err));
        setBusy(false);
      });
  };

  return (
    <Modal title="update link" onClose={onClose} width={520}>
      <form onSubmit={submit}>
        <p className="hint">
          Paste a fresh link to <b>{download.file_name}</b>. Byterush checks it is the same file ({formatBytes(download.size)}) and
          continues from {pct}%. Starting the download again in the browser does the same on its own.
        </p>
        <label className="field">
          <span>new address</span>
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" spellCheck={false} />
        </label>
        {error && <p className="error-text">[!] {error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            cancel
          </button>
          <div className="spacer" />
          <button type="submit" className="btn primary" disabled={!url.trim() || busy}>
            {busy && <Icon icon={Loading03Icon} size={14} className="spin" />}
            update & resume
          </button>
        </div>
      </form>
    </Modal>
  );
}
