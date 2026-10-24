import { APP_NAME, SETUP_URL, getRecent, getSettings, hostOf, isExcluded, saveSettings } from "./shared.js";

const $ = (id) => document.getElementById(id);

async function render() {
  $("app-name").textContent = APP_NAME.toLowerCase();
  $("footer-note").textContent = `tip: right-click a link → download with ${APP_NAME.toLowerCase()}`;
  $("setup-link").onclick = (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: SETUP_URL });
  };

  const settings = await getSettings();
  $("enabled").checked = settings.enabled;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = hostOf(tab?.url ?? "");
  if (host && /^https?:/.test(tab.url)) {
    $("site").textContent = host;
    $("site-enabled").checked = !isExcluded(settings, host);
    $("site-enabled").disabled = !settings.enabled;
    $("site-enabled").onchange = async (e) => {
      const s = await getSettings();
      const excluded = e.target.checked ? s.excluded.filter((d) => d !== host && !host.endsWith(`.${d}`)) : [...new Set([...s.excluded, host])];
      await saveSettings({ excluded });
    };
  } else {
    $("site-row").style.display = "none";
  }

  $("enabled").onchange = async (e) => {
    await saveSettings({ enabled: e.target.checked });
    $("site-enabled").disabled = !e.target.checked;
  };

  const health = await chrome.runtime.sendMessage({ type: "health" }).catch(() => null);
  const status = $("status");
  if (health?.ok && health.capture) {
    status.className = "status ok";
    $("status-text").textContent = `connected · v${health.version}`;
  } else if (health?.ok) {
    status.className = "status off";
    $("status-text").textContent = "capture off in the app";
  } else {
    status.className = "status off";
    $("status-text").textContent = `${APP_NAME.toLowerCase()} not running`;
  }

  const recent = await getRecent();
  const list = $("recent");
  list.replaceChildren();
  if (!recent.length) {
    const li = document.createElement("div");
    li.className = "empty";
    li.textContent = "nothing yet — start a download in this browser";
    list.append(li);
  }
  for (const r of recent.slice(0, 12)) {
    const li = document.createElement("li");
    const tag = document.createElement("span");
    tag.className = `tag ${r.status}`;
    tag.textContent = r.status === "taken" ? "[taken]" : r.status === "failed" ? "[failed]" : "[browser]";
    const entry = document.createElement("div");
    entry.className = "entry";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = r.name;
    name.title = r.name;
    const why = document.createElement("div");
    why.className = "why";
    why.textContent = r.reason ? r.reason : r.host;
    entry.append(name, why);
    li.append(tag, entry);
    list.append(li);
  }
}

render();
