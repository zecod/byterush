import { invoke } from "@tauri-apps/api/core";

export type Status = "queued" | "connecting" | "downloading" | "finishing" | "paused" | "completed" | "error";
export type Category = "general" | "compressed" | "documents" | "music" | "programs" | "video";

export interface Segment {
  start: number;
  end: number;
  downloaded: number;
}

export interface Download {
  id: string;
  url: string;
  file_name: string;
  dir: string;
  category: Category;
  size: number | null;
  resumable: boolean;
  connections: number;
  segments: Segment[];
  status: Status;
  error: string | null;
  added_at: number;
  completed_at: number | null;
  part_path: string | null;
  segment_count: number;
  layout: "single" | "parts";
  finishing: { stage: "rebuilding" | "moving"; done: number; total: number } | null;
  downloaded: number;
  speed: number;
  eta: number | null;
  active_connections: number;
}

export interface Settings {
  download_dir: string;
  temp_dir: string;
  category_subfolders: boolean;
  connections: number;
  max_active: number;
  speed_limit_kbps: number;
  monitor_clipboard: boolean;
  browser_integration: boolean;
  retries: number;
  theme: "system" | "dark" | "light";
  user_agent: string;
}

export interface ProbeInfo {
  url: string;
  final_url: string;
  file_name: string;
  size: number | null;
  resumable: boolean;
  content_type: string | null;
  category: Category;
  dir: string;
}

export interface AddRequest {
  url: string;
  file_name?: string;
  dir?: string;
  connections?: number;
  size?: number | null;
  start: boolean;
}

export interface BridgeStatus {
  listening: boolean;
  port: number;
  error: string | null;
  extension_ids: string[];
}

export interface Delta {
  full: boolean;
  upserts: Download[];
  removed: string[];
}

export const api = {
  probe: (url: string) => invoke<ProbeInfo>("probe_url", { url }),
  add: (request: AddRequest) => invoke<string>("add_download", { request }),
  addMany: (requests: AddRequest[]) => invoke<{ ids: string[]; errors: string[] }>("add_downloads", { requests }),
  sync: () => invoke<void>("sync_downloads"),
  get: (id: string) => invoke<Download | null>("get_download", { id }),
  pause: (ids: string[]) => invoke<void>("pause_downloads", { ids }),
  resume: (ids: string[]) => invoke<void>("resume_downloads", { ids }),
  remove: (ids: string[], deleteFiles: boolean) => invoke<void>("remove_downloads", { ids, deleteFiles }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  open: (id: string) => invoke<void>("open_download", { id }),
  reveal: (id: string) => invoke<void>("reveal_download", { id }),
  bridgeStatus: () => invoke<BridgeStatus>("bridge_status"),
  openExtensionFolder: () => invoke<string>("open_extension_folder"),
};

export const isActive = (s: Status) => s === "downloading" || s === "connecting";
/** Busy in any way, including the final rebuild/move (which can't be paused). */
export const isWorking = (s: Status) => isActive(s) || s === "finishing";

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "Unknown";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

export const formatSpeed = (bps: number) => (bps > 0 ? `${formatBytes(Math.round(bps))}/s` : "");

export function formatEta(seconds: number | null): string {
  if (seconds == null || !isFinite(seconds)) return "";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  return h >= 48 ? `${Math.floor(h / 24)}d` : `${h}h ${Math.floor((s % 3600) / 60)}m`;
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "2-digit", month: "short" });
}

export const statusLabel: Record<Status, string> = {
  queued: "queued",
  connecting: "connecting",
  downloading: "downloading",
  finishing: "finishing",
  paused: "paused",
  completed: "done",
  error: "error",
};

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Shortcut label in the platform's style: "⌘N" on macOS, "ctrl+n" elsewhere. */
export const shortcut = (key: string) => (isMac ? `⌘${key.toUpperCase()}` : `ctrl+${key.toLowerCase()}`);

/** "rebuilding 45%" / "moving 12%" while a finished download is written into place. */
export function finishingLabel(d: Download): string | null {
  const f = d.finishing;
  if (d.status !== "finishing") return null;
  if (!f || !f.total) return "finishing";
  return `${f.stage} ${Math.floor((f.done / f.total) * 100)}%`;
}

export function progress(d: Download): number | null {
  if (d.status === "completed" || d.status === "finishing") return 1;
  if (!d.size) return null;
  return Math.min(1, d.downloaded / d.size);
}

/** Expand `http://x/img*.jpg` into numbered URLs (IDM-style batch download). */
export function expandBatch(pattern: string, from: number, to: number, pad: number): string[] {
  if (!pattern.includes("*") || to < from) return [];
  const count = Math.min(to - from + 1, 10000);
  return Array.from({ length: count }, (_, i) => pattern.replace("*", String(from + i).padStart(pad, "0")));
}
