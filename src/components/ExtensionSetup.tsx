import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight01Icon, CheckmarkCircle02Icon, Copy01Icon, FolderOpenIcon, PuzzleIcon } from "@hugeicons/core-free-icons";
import type { Browser, BridgeStatus, Settings } from "../api";
import { api, formatDate, isMac, STORE_URL } from "../api";
import { Icon } from "./icons";
import { Modal } from "./Modal";

/** "12 s ago", "4 min ago", "on 24 Oct". */
function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return formatDate(ms);
}

/** The browsers found on this computer, for the setup suggestion: "Google Chrome and Microsoft Edge". */
export function browserList(browsers: Browser[]) {
  const names = browsers.map((b) => b.name);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Loading the extension from the folder that ships with the app: the way before the store
 * listing, and still the way on a browser that can't reach the store.
 */
function FolderSteps({ browsers, folder, onError }: { browsers: Browser[] | null; folder: string | null; onError: (e: unknown) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!folder) return;
    await navigator.clipboard.writeText(folder).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const open = (b: Browser) => api.openExtensionsPage(b.id).catch(onError);
  return (
    <>
      <li>
        <div className="step-title">open your browser's extensions page</div>
        {browsers === null ? null : browsers.length ? (
          <div className="setup-browsers">
            {browsers.map((b) => (
              <button key={b.id} className="btn" onClick={() => open(b)}>
                {b.name} <Icon icon={ArrowUpRight01Icon} size={13} />
              </button>
            ))}
          </div>
        ) : (
          <p className="hint">
            no Chrome, Edge, Brave, Vivaldi or Opera found here: type <code>chrome://extensions</code> (or <code>edge://extensions</code>…) in
            the address bar
          </p>
        )}
      </li>
      <li>
        <div className="step-title">
          turn on <b>developer mode</b>
        </div>
        <p className="hint">the switch at the top right of that page (in Edge: on the left)</p>
      </li>
      <li>
        <div className="step-title">
          click <b>load unpacked</b> and choose this folder
        </div>
        <div className="setup-folder">
          <code className="selectable" title={folder ?? ""}>
            {folder ?? "extension folder not found"}
          </code>
          <button className="btn" onClick={copy} disabled={!folder} title="copy the path">
            <Icon icon={copied ? CheckmarkCircle02Icon : Copy01Icon} size={14} /> {copied ? "copied" : "copy"}
          </button>
          <button className="btn" onClick={() => api.openExtensionFolder().catch(onError)} title="open the folder">
            <Icon icon={FolderOpenIcon} size={14} />
          </button>
        </div>
        <p className="hint">paste the path into the folder dialog's address bar{isMac ? " (⌘⇧G opens it)" : ""}, or open the folder and pick it</p>
      </li>
    </>
  );
}

/**
 * Setting up the browser extension, step by step: add it from the Chrome Web Store (or, without
 * the store, load the extension's folder from the browser's extensions page), pin it, and watch
 * it connect. The status at the top follows the extension's check-ins with the app.
 */
export function ExtensionSetup({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const [browsers, setBrowsers] = useState<Browser[] | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.installedBrowsers().then(setBrowsers).catch(() => setBrowsers([]));
    api.extensionFolder().then(setFolder).catch(() => setFolder(null));
    const poll = () => api.bridgeStatus().then(setBridge).catch(() => {});
    poll();
    const timer = setInterval(poll, 1500);
    return () => clearInterval(timer);
  }, []);

  const seenNow = bridge?.extension_seen_ms ?? null;
  const seenEver = seenNow ?? (settings.extension_seen_ms || null);
  const browserName = bridge?.extension_browser || settings.extension_browser;
  const connected = seenNow != null && Date.now() - seenNow < 6 * 60 * 1000;
  const fail = (e: unknown) => setError(String(e));
  const folderSteps = <FolderSteps browsers={browsers} folder={folder} onError={fail} />;

  return (
    <Modal title="browser extension" onClose={onClose} width={620}>
      <div className="setup">
        <div className={`setup-status ${connected ? "ok" : ""}`}>
          <Icon icon={connected ? CheckmarkCircle02Icon : PuzzleIcon} size={18} />
          <div>
            {connected ? (
              <>
                <b>connected</b> · {browserName || "browser"}
                {bridge?.extension_version ? ` · extension ${bridge.extension_version}` : ""} · checked in {ago(seenNow ?? 0)}
              </>
            ) : seenEver ? (
              <>
                <b>installed</b> · last checked in from {browserName || "a browser"} {ago(seenEver)}; it checks in again within 5 minutes
                of the browser running
              </>
            ) : (
              <>
                <b>not set up yet</b> · follow the steps; this turns green as soon as the extension reaches byterush
              </>
            )}
          </div>
        </div>

        <ol className="setup-steps">
          {STORE_URL ? (
            <li>
              <div className="step-title">add it from the Chrome Web Store</div>
              <div className="setup-browsers">
                <button className="btn primary" onClick={() => openUrl(STORE_URL).catch(fail)}>
                  open the Chrome Web Store <Icon icon={ArrowUpRight01Icon} size={13} />
                </button>
              </div>
              <p className="hint">
                Chrome, Brave and Vivaldi: click <b>add to Chrome</b>. Edge: first <b>allow extensions from other stores</b> in the bar at the top of
                the store page, then <b>get</b>. Opera: needs its "Install Chrome extensions" add-on first.
              </p>
            </li>
          ) : (
            folderSteps
          )}
          <li>
            <div className="step-title">pin byterush to the toolbar</div>
            <p className="hint">
              the puzzle icon → the pin next to byterush. Its popup shows each hand-over, and why a download stayed in the browser. To
              catch private windows too: <b>details → allow in incognito</b>.
            </p>
          </li>
          <li>
            <div className="step-title">start any download in the browser</div>
            <p className="hint">
              it lands here, with the browser's cookies, so sites that need a login still work.
              {settings.ask_before_download ? " the new download window asks where to save it first." : ""}
            </p>
          </li>
        </ol>
        {STORE_URL && (
          <details className="setup-manual">
            <summary>no access to the store (a managed browser, or offline)? load it from a folder</summary>
            <ol className="setup-steps">{folderSteps}</ol>
          </details>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
      <div className="modal-actions">
        <div className="spacer" />
        <button className="btn primary" onClick={onClose}>
          {connected ? "done" : "close"}
        </button>
      </div>
    </Modal>
  );
}
