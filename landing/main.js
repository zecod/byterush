const URLS = (() => {
  const GITHUB_URL = "https://github.com/zecod/byterush";
  return {
    GITHUB_URL,
    RELEASES_URL: GITHUB_URL + "/releases/latest",
    EXTENSION_URL: GITHUB_URL + "#browser-extension",
  };
})();

const linkTargets = {
  github: URLS.GITHUB_URL,
  releases: URLS.RELEASES_URL,
  extension: URLS.EXTENSION_URL,
};

document.querySelectorAll("[data-link]").forEach((link) => {
  link.href = linkTargets[link.dataset.link];
});

function detectOS() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  const agent = navigator.userAgent || "";
  const value = `${platform} ${agent}`.toLowerCase();

  if (/android|iphone|ipad|ipod/.test(value) || (/macintel/.test(value) && navigator.maxTouchPoints > 1)) return null;
  if (/windows|win32|win64/.test(value)) return "windows";
  if (/mac/.test(value)) return "macos";
  if (/linux|x11/.test(value)) return "linux";
  return null;
}

const osNames = { windows: "Windows", macos: "macOS", linux: "Linux" };
const detectedOS = detectOS();
if (detectedOS) {
  document.getElementById("primary-download").innerHTML = `Download for ${osNames[detectedOS]} <span aria-hidden="true">↗</span>`;
}

const tabs = [...document.querySelectorAll(".install-tabs [role='tab']")];
const installPanel = document.getElementById("panel-install");
const installHint = document.getElementById("install-hint");
const platformHints = {
  windows: "Choose the Windows build from the latest release.",
  macos: "Choose the Apple Silicon or Intel macOS build from the latest release.",
  linux: "Choose the Linux build from the latest release.",
};

function selectTab(tab, focus = false) {
  tabs.forEach((item) => {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
  });
  installPanel.setAttribute("aria-labelledby", tab.id);
  installHint.textContent = platformHints[tab.dataset.os];
  if (focus) tab.focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (event) => {
    let nextIndex;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectTab(tabs[nextIndex], true);
  });
});
if (detectedOS) selectTab(tabs.find((tab) => tab.dataset.os === detectedOS));

const releaseUrl = document.getElementById("release-url");
releaseUrl.textContent = URLS.RELEASES_URL.replace(/^https:\/\//, "");
const copyButton = document.querySelector(".copy-button");
let copyReset;
copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(URLS.RELEASES_URL);
    copyButton.querySelector(".copy-label").textContent = "copied";
    copyButton.setAttribute("aria-label", "Latest release URL copied");
    clearTimeout(copyReset);
    copyReset = setTimeout(() => {
      copyButton.querySelector(".copy-label").textContent = "copy";
      copyButton.setAttribute("aria-label", "Copy latest release URL");
    }, 2000);
  } catch {
    copyButton.querySelector(".copy-label").textContent = "select URL";
    copyButton.setAttribute("aria-label", "Select release URL to copy manually");
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(releaseUrl);
    selection.removeAllRanges();
    selection.addRange(range);
  }
});

const root = document.documentElement;
const themeButton = document.querySelector(".theme-toggle");
let storedTheme = null;
try {
  storedTheme = localStorage.getItem("byterush-theme");
} catch {}
if (storedTheme === "light" || storedTheme === "dark") root.dataset.theme = storedTheme;

function currentTheme() {
  return root.dataset.theme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
function updateThemeLabel() {
  themeButton.setAttribute("aria-label", `Switch to ${currentTheme() === "dark" ? "light" : "dark"} theme`);
}
updateThemeLabel();
themeButton.addEventListener("click", () => {
  root.dataset.theme = currentTheme() === "dark" ? "light" : "dark";
  try {
    localStorage.setItem("byterush-theme", root.dataset.theme);
  } catch {}
  updateThemeLabel();
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", updateThemeLabel);

document.querySelectorAll(".progressive-image").forEach((img) => {
  const frame = img.closest(".media-frame");
  const showImage = () => frame.classList.add("media-loaded");
  const showPlaceholder = () => frame.classList.remove("media-loaded");
  img.addEventListener("load", showImage);
  img.addEventListener("error", showPlaceholder);
  if (img.complete && img.naturalWidth > 0) showImage();
});
