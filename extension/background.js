// Byterush browser bridge.
//
// Every download Chrome starts goes through chrome.downloads, so catching it there misses nothing
// (link clicks, scripts, redirects, Content-Disposition responses alike). For each one the request
// goes to the app together with the exact headers Chrome sent (cookies such as cf_clearance,
// user-agent, referer). The app opens its first connection and tells us whether it got the same
// file; only then is Chrome's copy cancelled. Anything the app can't reproduce (bot checks,
// one-time links, form posts) simply continues in Chrome.

import { APP_NAME, API, getSettings, hostOf, isExcluded, addRecent, fileFromUrl } from "./shared.js";

const HEADER_TTL_MS = 2 * 60 * 1000;
const VERDICT_TIMEOUT_MS = 25_000;

// ---------------------------------------------------------------------------------------------
// request headers Chrome sent, by URL, so protected downloads can be replayed with the session

const seen = new Map();

chrome.webRequest.onSendHeaders.addListener(
  (d) => {
    seen.set(d.url, {
      method: d.method,
      headers: (d.requestHeaders ?? []).map((h) => [h.name, h.value ?? ""]),
      at: Date.now(),
    });
    if (seen.size > 600) prune();
  },
  { urls: ["<all_urls>"], types: ["main_frame", "sub_frame", "other"] },
  ["requestHeaders", "extraHeaders"],
);

function prune() {
  const cutoff = Date.now() - HEADER_TTL_MS;
  for (const [url, v] of seen) if (v.at < cutoff) seen.delete(url);
}

/** Session headers for a URL Chrome didn't request itself (context menu). */
async function sessionHeaders(url, referrer) {
  const headers = [["User-Agent", navigator.userAgent]];
  if (referrer) headers.push(["Referer", referrer]);
  try {
    const cookies = await chrome.cookies.getAll({ url });
    if (cookies.length) headers.push(["Cookie", cookies.map((c) => `${c.name}=${c.value}`).join("; ")]);
  } catch {
    /* no cookie access for this URL */
  }
  return headers;
}

// ---------------------------------------------------------------------------------------------
// talking to the app

let health = { ok: false, capture: false, at: 0 };

async function call(path, init = {}, timeoutMs = 1500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { ...(init.headers ?? {}), "x-byterush-ext": chrome.runtime.id };
    const res = await fetch(`${API}${path}`, { ...init, headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`app answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Is the app running with capture on? Cached briefly so downloads aren't delayed. */
async function appReady(force = false) {
  if (!force && Date.now() - health.at < 10_000) return health;
  try {
    const p = await call("/ping", {}, 600);
    health = { ok: true, capture: !!p.capture, version: p.version, at: Date.now() };
  } catch {
    health = { ok: false, capture: false, at: Date.now() };
  }
  return health;
}

function handOver(body, timeoutMs) {
  return call("/download", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);
}

// ---------------------------------------------------------------------------------------------
// catching downloads
//
// The decision is made while Chrome is choosing the file name. Chrome waits for this listener
// before it shows its "Save as" dialog or finishes the file, so nothing can slip past and no dialog
// appears for downloads the app takes. Chrome's transfer is never paused (pausing at this stage
// makes Chrome 155 cancel the item); it keeps receiving into its temporary file meanwhile.
//   - the app gets the same file  -> Chrome's copy is cancelled before any dialog
//   - it can't (one-time link, bot check, form post, app closed) -> the name is released and Chrome
//     carries on exactly as without the extension

// downloads already being decided, so the fallback below doesn't handle one twice
const handled = new Set();

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const url = item.finalUrl || item.url;
  handled.add(item.id);
  if (!/^https?:/i.test(url)) {
    suggest(); // blob:, data: — only Chrome has those
    return;
  }
  capture(item).then(
    (taken) => taken || suggest(),
    () => suggest(),
  );
  return true; // answering asynchronously
});

// Fallback for setups where Chrome settles the name without asking extensions (another extension
// or a policy picks it, automation): decide from the start event instead. Chrome may finish first
// there, which `capture` handles by deleting its duplicate once the app has the file.
chrome.downloads.onCreated.addListener((item) => {
  const url = item.finalUrl || item.url;
  if (!/^https?:/i.test(url) || item.state !== "in_progress") return;
  setTimeout(() => {
    if (handled.has(item.id)) return;
    handled.add(item.id);
    capture(item).catch(() => {});
  }, 1500);
});

/** Returns true when the app took the download and Chrome's copy was cancelled. */
async function capture(item) {
  const url = item.finalUrl || item.url;
  const name = (item.filename || "").split(/[\\/]/).pop() || null;
  const keepInChrome = async (reason) => {
    if (reason) await addRecent({ name: name || fileFromUrl(url), host: hostOf(url), status: "browser", reason });
    return false;
  };

  const settings = await getSettings();
  if (!settings.enabled) return false;
  if (isExcluded(settings, hostOf(url)) || isExcluded(settings, hostOf(item.referrer))) return false;
  if (settings.minSizeKb > 0 && item.totalBytes > 0 && item.totalBytes < settings.minSizeKb * 1024) return false;

  const request = seen.get(url) ?? seen.get(item.url);
  if (request && request.method !== "GET") return keepInChrome("form submission — kept in the browser");

  const app = await appReady();
  if (!app.ok || !app.capture) return false;

  const headers = request?.headers ?? (await sessionHeaders(url, item.referrer));
  let verdict;
  try {
    verdict = await handOver(
      { url, file_name: name, mime: item.mime || null, size: item.totalBytes > 0 ? item.totalBytes : null, headers, source: "capture" },
      VERDICT_TIMEOUT_MS,
    );
  } catch {
    health.at = 0;
    return keepInChrome(`${APP_NAME} did not answer`);
  }
  if (!verdict.accepted) return keepInChrome(verdict.reason || "kept in the browser");

  // the app has the file: drop Chrome's copy before it is ever named or shown — or, where something
  // else already settled the name and Chrome finished meanwhile, delete its duplicate file
  const [current] = await chrome.downloads.search({ id: item.id });
  if (current?.state === "complete") await chrome.downloads.removeFile(item.id).catch(() => {});
  else await chrome.downloads.cancel(item.id).catch(() => {});
  await chrome.downloads.erase({ id: item.id }).catch(() => {});
  await addRecent({ name: verdict.file_name || name || fileFromUrl(url), host: hostOf(url), status: "taken" });
  flash("✓", "#d8f06b");
  return true;
}

// ---------------------------------------------------------------------------------------------
// context menu

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "link", title: `Download with ${APP_NAME}`, contexts: ["link"] });
    chrome.contextMenus.create({ id: "media", title: `Download media with ${APP_NAME}`, contexts: ["video", "audio", "image"] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.srcUrl;
  if (!url || !/^https?:/i.test(url)) {
    flash("!", "#f87171");
    return;
  }
  try {
    const headers = await sessionHeaders(url, info.pageUrl || tab?.url);
    const verdict = await handOver({ url, headers, source: "menu" }, 15_000);
    await addRecent({ name: verdict.file_name || fileFromUrl(url), host: hostOf(url), status: verdict.accepted ? "taken" : "failed", reason: verdict.reason });
    flash(verdict.accepted ? "✓" : "!", verdict.accepted ? "#d8f06b" : "#f87171");
  } catch {
    await addRecent({ name: fileFromUrl(url), host: hostOf(url), status: "failed", reason: `${APP_NAME} is not running` });
    flash("!", "#f87171");
  }
});

// ---------------------------------------------------------------------------------------------

function flash(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeTextColor?.({ color: "#141010" });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "health") {
    appReady(true).then(reply);
    return true;
  }
});
