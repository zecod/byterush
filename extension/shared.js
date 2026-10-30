export const APP_NAME = "Byterush";
export const API = "http://127.0.0.1:51723/v1";
/** The setup guide on the website (also linked from the popup). */
export const SETUP_URL = "https://byterush.xyz/setup";

const DEFAULTS = { enabled: true, excluded: [] };

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULTS, ...settings };
}

export async function saveSettings(patch) {
  const settings = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings });
  return settings;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** "report.pdf" from "https://site/files/report.pdf?token=1". */
export function fileFromUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop()) || url;
  } catch {
    return url;
  }
}

/** "Microsoft Edge", "Brave", "Google Chrome"…: the browser this extension runs in. */
export function browserName() {
  const brands = navigator.userAgentData?.brands?.map((b) => b.brand) ?? [];
  const known = ["Microsoft Edge", "Brave", "Opera", "Vivaldi", "Google Chrome", "Chromium"];
  return known.find((k) => brands.includes(k)) ?? (/Edg\//.test(navigator.userAgent) ? "Microsoft Edge" : "Chrome");
}

/** A site is excluded when it or a parent domain is on the list. */
export function isExcluded(settings, host) {
  if (!host) return false;
  return settings.excluded.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Recent hand-overs for the popup (kept for the browser session only). */
export async function addRecent(entry) {
  const { recent = [] } = await chrome.storage.session.get("recent");
  recent.unshift({ ...entry, at: Date.now() });
  await chrome.storage.session.set({ recent: recent.slice(0, 20) });
}

export async function getRecent() {
  const { recent = [] } = await chrome.storage.session.get("recent");
  return recent;
}
