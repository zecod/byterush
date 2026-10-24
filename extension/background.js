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

const WATCHED = { urls: ["<all_urls>"], types: ["main_frame", "sub_frame", "other"] };

chrome.webRequest.onSendHeaders.addListener(
  (d) => {
    seen.set(d.url, {
      method: d.method,
      headers: (d.requestHeaders ?? []).map((h) => [h.name, h.value ?? ""]),
      at: Date.now(),
    });
    if (seen.size > 600) prune();
  },
  WATCHED,
  ["requestHeaders", "extraHeaders"],
);

// What the server answered: a compressed response makes Chrome's byte count differ from the file's
// (the app always fetches it uncompressed), and Content-Disposition carries the real file name.
chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    const entry = seen.get(d.url);
    if (!entry) return;
    const header = (name) => d.responseHeaders?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
    const encoding = header("content-encoding").trim().toLowerCase();
    entry.encoded = encoding !== "" && encoding !== "identity";
    entry.disposition = header("content-disposition");
  },
  WATCHED,
  ["responseHeaders"],
);

function prune() {
  const cutoff = Date.now() - HEADER_TTL_MS;
  for (const [url, v] of seen) if (v.at < cutoff) seen.delete(url);
}

/** File name from a Content-Disposition header (`filename*=` preferred), or null. */
function nameFromDisposition(value) {
  if (!value) return null;
  const star = /filename\*\s*=\s*([^;]+)/i.exec(value);
  if (star) {
    const encoded = star[1].trim().replace(/^"|"$/g, "").replace(/^[^']*'[^']*'/, "");
    try {
      const name = decodeURIComponent(encoded);
      if (name) return name;
    } catch {
      /* malformed: try the plain form */
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(value);
  const name = (plain?.[2] ?? plain?.[1] ?? "").trim();
  return name || null;
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

/**
 * Is the app running with capture on? A running app is remembered for a few seconds so downloads
 * aren't delayed; "not running" is never remembered, so a download right after the app starts is
 * caught (asking a closed port fails within milliseconds).
 */
async function appReady(force = false) {
  if (!force && health.ok && Date.now() - health.at < 10_000) return health;
  try {
    // generous: an app that is busy starting up must not lose the download to a short timeout
    const p = await call("/ping", {}, 2000);
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

function markHandled(id) {
  handled.add(id);
  setTimeout(() => handled.delete(id), 60_000); // long after the fallback could look at it
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const url = item.finalUrl || item.url;
  markHandled(item.id);
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
  setTimeout(async () => {
    if (handled.has(item.id)) return;
    markHandled(item.id);
    // the user may have cancelled it meanwhile; a finished one is still worth taking over. The name
    // Chrome settled on may carry its own " (1)": the app names it from the server instead.
    const [current] = await chrome.downloads.search({ id: item.id }).catch(() => []);
    if (!current || current.state === "interrupted") return;
    capture(item).catch(() => {});
  }, 1500);
});

/** Returns true when the app took the download and Chrome's copy was cancelled. */
async function capture(item) {
  const url = item.finalUrl || item.url;
  const request = seen.get(url) ?? seen.get(item.url);
  // Chrome's suggestion while it picks the name; on the fallback path the server's own
  const name = (item.filename || "").split(/[\\/]/).pop() || nameFromDisposition(request?.disposition) || null;
  const keepInChrome = async (reason) => {
    if (reason) await addRecent({ name: name || fileFromUrl(url), host: hostOf(url), status: "browser", reason });
    return false;
  };

  const settings = await getSettings();
  if (!settings.enabled) return false;
  if (isExcluded(settings, hostOf(url)) || isExcluded(settings, hostOf(item.referrer))) return false;
  if (settings.minSizeKb > 0 && item.totalBytes > 0 && item.totalBytes < settings.minSizeKb * 1024) return false;

  if (request && request.method !== "GET") return keepInChrome("form submission — kept in the browser");

  const app = await appReady();
  if (!app.ok || !app.capture) return false;

  const headers = request?.headers ?? (await sessionHeaders(url, item.referrer));
  let verdict;
  try {
    verdict = await handOver(
      {
        url,
        file_name: name,
        mime: item.mime || null,
        // a compressed transfer's size is not the file's: let the app check the content type only
        size: item.totalBytes > 0 && !request?.encoded ? item.totalBytes : null,
        headers,
        source: "capture",
      },
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
