import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";

/** One release's notes: its CHANGELOG.md section, in Markdown. */
export interface ReleaseNotes {
  version: string;
  date: string | null;
  notes: string;
}

export interface UpdateInfo {
  version: string;
  current_version: string;
  date: string | null;
  /** Every release newer than the running one, newest first. */
  releases: ReleaseNotes[];
}

type Progress = { event: "downloading"; downloaded: number; total: number | null } | { event: "installing" };

export type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "current"; checkedAt: number }
  | { phase: "available"; info: UpdateInfo }
  | { phase: "downloading"; info: UpdateInfo; downloaded: number; total: number | null }
  /** The installer is running: the app closes and the new version starts. */
  | { phase: "installing"; info: UpdateInfo }
  /** `info` is kept when the install failed, so it can be tried again. */
  | { phase: "error"; message: string; info?: UpdateInfo };

export interface Updates {
  state: UpdateState;
  /** The update on offer, while there is one (also during and after a failed install). */
  info: UpdateInfo | null;
  check: () => void;
  install: () => void;
}

const FIRST_CHECK_MS = 8_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

const updateApi = {
  check: () => invoke<UpdateInfo | null>("check_update"),
  install: (onProgress: Channel<Progress>) => invoke<void>("install_update", { onProgress }),
};

/**
 * The update check and install, shared by the top bar and the settings. With `auto`, it checks a
 * few seconds after the start and every six hours; a check never interrupts an update on offer or
 * one being installed.
 */
export function useUpdates(auto: boolean): Updates {
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  const current = useRef(state);
  current.current = state;

  const check = useCallback(async () => {
    const p = current.current.phase;
    if (p === "checking" || p === "downloading" || p === "installing") return;
    setState({ phase: "checking" });
    try {
      const info = await updateApi.check();
      setState(info ? { phase: "available", info } : { phase: "current", checkedAt: Date.now() });
    } catch (e) {
      setState({ phase: "error", message: String(e) });
    }
  }, []);

  const install = useCallback(async () => {
    const s = current.current;
    const info = s.phase === "available" || s.phase === "error" ? s.info : undefined;
    if (!info) return;
    setState({ phase: "downloading", info, downloaded: 0, total: null });
    const channel = new Channel<Progress>();
    channel.onmessage = (m) =>
      setState(m.event === "installing" ? { phase: "installing", info } : { phase: "downloading", info, downloaded: m.downloaded, total: m.total });
    try {
      // returns only if it failed: on success the app restarts into the new version
      await updateApi.install(channel);
    } catch (e) {
      setState({ phase: "error", message: String(e), info });
    }
  }, []);

  useEffect(() => {
    if (!auto) return;
    // an automatic check leaves an update on offer (or a failed install) as it is
    const quiet = () => {
      const s = current.current;
      if (s.phase === "available" || (s.phase === "error" && s.info)) return;
      check();
    };
    const first = window.setTimeout(quiet, FIRST_CHECK_MS);
    const every = window.setInterval(quiet, EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [auto, check]);

  const info = "info" in state ? (state.info ?? null) : null;
  return { state, info, check, install };
}

const KINDS: Record<string, [string, string]> = {
  added: ["new", "new"],
  fixed: ["fix", "fixes"],
  changed: ["change", "changes"],
  security: ["security fix", "security fixes"],
  removed: ["removal", "removals"],
  deprecated: ["deprecation", "deprecations"],
};

/** "2 new · 3 fixes · 1 change", counted from the Keep a Changelog headings of the notes. */
export function summarize(releases: ReleaseNotes[]): string {
  const counts = new Map<string, number>();
  for (const r of releases) {
    let kind = "";
    for (const line of r.notes.split(/\r?\n/)) {
      const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
      if (heading) kind = heading[1].toLowerCase();
      else if (/^[-*]\s+\S/.test(line) && KINDS[kind]) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  return Object.keys(KINDS)
    .filter((k) => counts.get(k))
    .map((k) => {
      const n = counts.get(k)!;
      return `${n} ${KINDS[k][n === 1 ? 0 : 1]}`;
    })
    .join(" · ");
}

/** "5 Nov 2026" from the release's ISO date. */
export function releaseDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}
