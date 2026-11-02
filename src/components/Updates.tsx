import { Alert02Icon, ArrowUp02Icon, CheckmarkCircle02Icon, Refresh01Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { formatBytes, formatDate, formatPercent } from "../api";
import type { UpdateInfo, Updates, UpdateState } from "../updates";
import { releaseDate, summarize } from "../updates";
import { Icon } from "./icons";
import { Modal } from "./Modal";
import { Notes } from "./Notes";

function percent(s: Extract<UpdateState, { phase: "downloading" }>): number | null {
  return s.total ? Math.min(100, (s.downloaded / s.total) * 100) : null;
}

function Bar({ state }: { state: UpdateState }) {
  const pct = state.phase === "downloading" ? percent(state) : null;
  return (
    <div className="progress update-progress status-downloading">
      {pct == null ? <div className="progress-fill indeterminate" /> : <div className="progress-fill" style={{ width: `${pct}%` }} />}
    </div>
  );
}

/** "downloading 12.4 MB of 40 MB · 31%" */
function progressText(state: UpdateState): string {
  if (state.phase === "installing") return "installing · byterush restarts by itself";
  if (state.phase !== "downloading") return "";
  const pct = percent(state);
  return state.total
    ? `downloading ${formatBytes(state.downloaded)} of ${formatBytes(state.total)} · ${formatPercent(pct ?? 0)}`
    : `downloading ${formatBytes(state.downloaded)}`;
}

/** In the top bar, next to the settings, while there is an update: opens "what's new". */
export function UpdateChip({ updates, onOpen }: { updates: Updates; onOpen: () => void }) {
  const { state, info } = updates;
  if (!info) return null;
  const label =
    state.phase === "downloading"
      ? `updating ${state.total ? formatPercent(percent(state) ?? 0) : "…"}`
      : state.phase === "installing"
        ? "restarting…"
        : state.phase === "error"
          ? "update failed"
          : `v${info.version} available`;
  return (
    <button className={`chip update-chip ${state.phase === "error" ? "failed" : ""}`} onClick={onOpen} title={`What's new in byterush ${info.version}`}>
      <Icon icon={state.phase === "error" ? Alert02Icon : ArrowUp02Icon} size={14} /> {label}
    </button>
  );
}

interface CardProps {
  updates: Updates;
  version: string;
  onOpen: () => void;
}

/** At the top of the settings: the version, whether a newer one is out, and the update button. */
export function UpdateCard({ updates, version, onOpen }: CardProps) {
  const { state, info, check, install } = updates;
  const busy = state.phase === "downloading" || state.phase === "installing";

  if (info) {
    const summary = summarize(info.releases);
    const date = releaseDate(info.date);
    const failed = state.phase === "error" ? state.message : "";
    return (
      <div
        className={`update-card available ${failed ? "failed" : ""}`}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), onOpen())}
        title="see what's new"
      >
        <div className="update-card-line">
          <span className="update-card-icon">
            <Icon icon={SparklesIcon} size={16} />
          </span>
          <div className="update-card-text">
            <b>byterush {info.version} is out</b>
            <span className="muted">
              you have {info.current_version}
              {date && ` · released ${date}`}
              {summary && ` · ${summary}`}
            </span>
          </div>
          <div className="spacer" />
          <button className="btn ghost" onClick={(e) => (e.stopPropagation(), onOpen())}>
            what's new
          </button>
          <button className="btn primary" disabled={busy} onClick={(e) => (e.stopPropagation(), install())}>
            <Icon icon={ArrowUp02Icon} size={14} /> {failed ? "try again" : "update"}
          </button>
        </div>
        {busy && (
          <div className="update-card-progress">
            <Bar state={state} />
            <span className="muted">{progressText(state)}</span>
          </div>
        )}
        {failed && <p className="error-text">{failed}</p>}
      </div>
    );
  }

  const line =
    state.phase === "checking"
      ? "checking for a new version…"
      : state.phase === "current"
        ? `up to date · checked ${formatDate(state.checkedAt)}`
        : state.phase === "error"
          ? ""
          : "not checked yet";
  return (
    <div className="update-card">
      <div className="update-card-line">
        <span className={`update-card-icon ${state.phase === "current" ? "ok" : ""}`}>
          <Icon icon={state.phase === "error" ? Alert02Icon : CheckmarkCircle02Icon} size={16} />
        </span>
        <div className="update-card-text">
          <b>byterush {version}</b>
          {state.phase === "error" ? <span className="error-text">couldn't check for updates: {state.message}</span> : <span className="muted">{line}</span>}
        </div>
        <div className="spacer" />
        <button className="btn" disabled={state.phase === "checking"} onClick={check}>
          <Icon icon={Refresh01Icon} size={14} className={state.phase === "checking" ? "spinning" : undefined} /> {state.phase === "error" ? "try again" : "check now"}
        </button>
      </div>
    </div>
  );
}

interface WhatsNewProps {
  updates: Updates;
  info: UpdateInfo;
  /** Downloads that are running now: they pause for the restart. */
  activeCount: number;
  resumeOnStartup: boolean;
  onClose: () => void;
}

/** Everything that changed since the running version, and the button that installs it. */
export function WhatsNew({ updates, info, activeCount, resumeOnStartup, onClose }: WhatsNewProps) {
  const { state, install } = updates;
  const busy = state.phase === "downloading" || state.phase === "installing";
  const failed = state.phase === "error" ? state.message : "";
  const skipped = info.releases.length > 1 ? `${info.releases.length} releases since ${info.current_version}` : `you have ${info.current_version}`;
  return (
    <Modal title={`what's new in ${info.version}`} onClose={onClose} width={580}>
      <div className="whats-new-head">
        <b>byterush {info.version}</b>
        <span className="muted">
          {releaseDate(info.date) && `released ${releaseDate(info.date)} · `}
          {skipped}
        </span>
      </div>
      <div className="whats-new">
        {info.releases.map((r) => (
          <section key={r.version} className="whats-new-release">
            {info.releases.length > 1 && (
              <h3>
                {r.version}
                {releaseDate(r.date) && <span className="muted"> · {releaseDate(r.date)}</span>}
              </h3>
            )}
            <Notes markdown={r.notes} />
          </section>
        ))}
      </div>
      {busy && (
        <div className="update-card-progress">
          <Bar state={state} />
          <span className="muted">{progressText(state)}</span>
        </div>
      )}
      {failed && <p className="error-text">{failed}</p>}
      <div className="modal-actions">
        <span className="hint">
          {activeCount > 0
            ? `${activeCount === 1 ? "1 download pauses" : `${activeCount} downloads pause`} for the restart${resumeOnStartup ? " and continue after it" : "; resume them after it"}.`
            : "byterush closes, updates and opens again by itself."}
        </span>
        <div className="spacer" />
        <button className="btn ghost" onClick={onClose}>
          {busy ? "close" : "later"}
        </button>
        <button className="btn primary" disabled={busy} onClick={install}>
          <Icon icon={ArrowUp02Icon} size={14} /> {busy ? "updating…" : failed ? "try again" : "update now"}
        </button>
      </div>
    </Modal>
  );
}
