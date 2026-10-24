/* Byterush · extension setup page. No build step, no dependencies.
 *
 * The status at the top asks the extension itself: its manifest lets this site send it a message
 * ("externally_connectable"), and it answers with its version and whether it reaches the app.
 * Chromium only exposes `chrome.runtime` to a page when an installed extension accepts messages
 * from it, so a missing `chrome.runtime` means the extension isn't loaded (or was loaded after this
 * page opened: a reload fixes that).
 */

const EXTENSION_ID = "alolkmfdhaifcmiheblachogjjenfdbk";
const GITHUB = "https://github.com/zecod/byterush";
const LINKS = {
  github: GITHUB,
  allReleases: GITHUB + "/releases",
  extension: GITHUB + "#browser-extension",
  issues: GITHUB + "/issues",
};
const RELEASE_API = "https://api.github.com/repos/zecod/byterush/releases/latest";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

$$("[data-link]").forEach((a) => {
  if (LINKS[a.dataset.link]) a.href = LINKS[a.dataset.link];
  a.target = "_blank";
  a.rel = "noopener noreferrer";
});

/* ---------- mobile menu ---------- */

{
  const menu = $(".menu");
  const nav = $("#nav");
  const close = () => {
    nav.classList.remove("open");
    menu.setAttribute("aria-expanded", "false");
  };
  menu.addEventListener("click", () => menu.setAttribute("aria-expanded", String(nav.classList.toggle("open"))));
  nav.addEventListener("click", (e) => e.target.closest("a") && close());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("open")) {
      close();
      menu.focus();
    }
  });
}

/* ---------- which browser ---------- */

const BROWSERS = {
  chrome: { name: "Chrome", page: "chrome://extensions", dev: "the switch at the top right of the page", pin: "The puzzle piece in the toolbar → the pin next to Byterush.", private: "Allow in Incognito" },
  edge: { name: "Edge", page: "edge://extensions", dev: "the switch in the left sidebar (open the menu at the top left if the window is narrow)", pin: "The puzzle piece in the toolbar → the eye next to Byterush.", private: "Allow in InPrivate" },
  brave: { name: "Brave", page: "brave://extensions", dev: "the switch at the top right of the page", pin: "The puzzle piece in the toolbar → the pin next to Byterush.", private: "Allow in Private" },
  opera: { name: "Opera", page: "opera://extensions", dev: "the switch at the top right of the page", pin: "The cube in the toolbar → the pin next to Byterush.", private: "Allow in Private mode" },
  vivaldi: { name: "Vivaldi", page: "vivaldi://extensions", dev: "the switch at the top right of the page", pin: "Byterush's button appears in the toolbar; right-click it to move or hide it.", private: "Allow in Incognito" },
};

/** "chrome", "edge"…, "other" for Firefox and Safari, null when it can't tell. */
function detectBrowser() {
  const ua = navigator.userAgent;
  const brands = (navigator.userAgentData?.brands || []).map((b) => b.brand);
  if (brands.includes("Microsoft Edge") || /Edg\//.test(ua)) return "edge";
  if (brands.includes("Opera") || /OPR\//.test(ua)) return "opera";
  if (navigator.brave || brands.includes("Brave")) return "brave";
  if (/Vivaldi/.test(ua)) return "vivaldi";
  if (brands.includes("Google Chrome") || brands.includes("Chromium") || /Chrome\//.test(ua)) return "chrome";
  if (/Firefox\/|Safari\//.test(ua)) return "other";
  return null;
}

const detected = detectBrowser();
const chromium = detected && detected !== "other";

function pick(id) {
  const b = BROWSERS[id];
  $$("[data-pick]").forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.pick === id)));
  $$("[data-browser-name]").forEach((n) => (n.textContent = b.name));
  $$("[data-ext-url]").forEach((n) => (n.textContent = b.page));
  $("[data-dev-where]").textContent = b.dev;
  $("[data-pin-how]").textContent = b.pin;
  $("[data-private-name]").textContent = b.private;
  copyButton.dataset.url = b.page;
}

const copyButton = $("[data-copy-url]");
copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(copyButton.dataset.url);
    copyButton.textContent = "copied";
  } catch {
    copyButton.textContent = "select it and copy";
  }
  setTimeout(() => (copyButton.textContent = "copy"), 1600);
});
$$("[data-pick]").forEach((btn) => btn.addEventListener("click", () => pick(btn.dataset.pick)));
pick(chromium ? detected : "chrome");

/* ---------- live status ---------- */

const statusBox = $(".su-status");
const title = $("[data-status-title]");
const text = $("[data-status-text]");

/** The extension's answer: { extension, browser, app, capture }, or null when it isn't there. */
function askExtension() {
  return new Promise((resolve) => {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) return resolve(null);
    // it asks the app first: a hung app takes it up to two attempts of two seconds
    const timer = setTimeout(() => resolve(null), 6000);
    try {
      runtime.sendMessage(EXTENSION_ID, { type: "status" }, (reply) => {
        clearTimeout(timer);
        // reading lastError keeps the console quiet when the extension isn't there
        resolve(runtime.lastError ? null : reply || null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

function show(state, heading, body, checks) {
  statusBox.dataset.state = state;
  title.textContent = heading;
  text.replaceChildren(...[].concat(body));
  for (const [name, ok] of Object.entries(checks)) {
    const li = $(`[data-check="${name}"]`);
    li.dataset.ok = ok === null ? "" : String(ok);
  }
}

function link(label, href) {
  const a = document.createElement("a");
  a.className = "underline";
  a.href = href;
  a.textContent = label;
  return a;
}

let checking = false;
async function check() {
  if (checking) return;
  checking = true;
  if (!chromium) {
    show(
      "off",
      detected === "other" ? "This browser can't run the extension" : "Is this a Chromium browser?",
      ["The extension works in Chrome, Edge, Brave, Opera and Vivaldi. Open this page there to set it up, or copy download links: Byterush watches the clipboard."],
      { browser: false, extension: null, app: null, capture: null },
    );
    checking = false;
    return;
  }
  const s = await askExtension();
  checking = false;
  const name = BROWSERS[detected]?.name || "this browser";
  if (!s) {
    show(
      "missing",
      `The extension isn't loaded in ${name}`,
      ["Follow the steps below, then reload this page. ", link("Show me", "#install")],
      { browser: true, extension: false, app: null, capture: null },
    );
  } else if (!s.app) {
    show("warn", "The extension is loaded, but Byterush isn't running", [`Extension ${s.extension}. Start the Byterush app: downloads stay in the browser until it runs.`], {
      browser: true,
      extension: true,
      app: false,
      capture: null,
    });
  } else if (!s.capture) {
    show("warn", "Connected, but catching downloads is off", [`Extension ${s.extension}, Byterush ${s.app}. Turn it on in the app's Settings → browser, or the switch in the extension's popup.`], {
      browser: true,
      extension: true,
      app: true,
      capture: false,
    });
  } else {
    show("ok", "All set: downloads in this browser go to Byterush", [`Extension ${s.extension} in ${s.browser || name}, Byterush ${s.app}. Start any download to try it.`], {
      browser: true,
      extension: true,
      app: true,
      capture: true,
    });
  }
}

$("[data-recheck]").addEventListener("click", () => {
  title.textContent = "Checking…";
  check();
});
check();
// coming back from the extensions page or after starting the app: look again, and keep looking
// while something is missing and the page is in front
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
setInterval(() => document.visibilityState === "visible" && statusBox.dataset.state !== "ok" && check(), 5000);

/* ---------- the extension .zip from the latest release ---------- */

(async () => {
  const KEY = "byterush.extzip.v1";
  let zip;
  try {
    const hit = JSON.parse(sessionStorage.getItem(KEY));
    if (hit && Date.now() - hit.at < 3600e3) zip = hit.zip;
  } catch {
    // storage blocked: fetch it
  }
  if (zip === undefined) {
    zip = null;
    try {
      const res = await fetch(RELEASE_API);
      if (res.ok) {
        const json = await res.json();
        const asset = (json.assets || []).find((a) => /^byterush-extension-.*\.zip$/i.test(a?.name || ""));
        if (asset && String(asset.browser_download_url).startsWith("https://")) zip = { url: asset.browser_download_url, size: Number(asset.size) || 0 };
      }
    } catch {
      // offline or rate-limited: the link keeps pointing at the latest release
    }
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), zip }));
    } catch {
      // storage blocked
    }
  }
  if (!zip) return;
  $$("[data-ext-zip]").forEach((a) => {
    a.href = zip.url;
    const size = $("[data-size]", a);
    if (size && zip.size) size.textContent = ` (${Math.max(1, Math.round(zip.size / 1024))} KB)`;
  });
})();
