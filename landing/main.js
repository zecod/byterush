const GITHUB = "https://github.com/zecod/byterush";
const LINKS = {
  github: GITHUB,
  releases: GITHUB + "/releases/latest",
  extension: GITHUB + "#browser-extension",
  issues: GITHUB + "/issues",
};
document.querySelectorAll("[data-link]").forEach((a) => {
  a.href = LINKS[a.dataset.link];
  a.target = "_blank";
  a.rel = "noopener noreferrer";
});

// mobile menu
const menu = document.querySelector(".menu");
const nav = document.getElementById("nav");
menu.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  menu.setAttribute("aria-expanded", String(open));
});
nav.addEventListener("click", (e) => {
  if (e.target.closest("a")) {
    nav.classList.remove("open");
    menu.setAttribute("aria-expanded", "false");
  }
});

// name the visitor's system on the download button
const ua = `${navigator.userAgentData?.platform || ""} ${navigator.platform || ""} ${navigator.userAgent}`.toLowerCase();
const os = /iphone|ipad|android/.test(ua) ? null : /mac/.test(ua) ? "macOS" : /linux|x11/.test(ua) ? "Linux" : /win/.test(ua) ? "Windows" : null;
const osLabel = document.querySelector("[data-os-label] span");
osLabel.textContent = os ? `Download for ${os}` : "Download";

// the app window is drawn at 952 px wide and scaled to fit
const stage = document.querySelector("[data-stage]");
const win = stage.querySelector(".win");
const fit = () => (win.style.transform = `scale(${stage.clientWidth / 952})`);
new ResizeObserver(fit).observe(stage);
fit();

// figure 1: 32 lines, one per connection
const lines = document.querySelector(".fig-lines");
for (let i = 0; i < 32; i++) {
  const x = 2 + i * 5;
  const top = 8 + ((i * 37) % 23) * 1.4;
  lines.insertAdjacentHTML("beforeend", `<line x1="${x}" y1="${top}" x2="${x}" y2="118"/>`);
}
// figure 3: a grid of dots
const dots = document.querySelector(".fig-dots");
for (let r = 0; r < 12; r++) {
  for (let c = 0; c < 16; c++) {
    const o = ((r * 7 + c * 13) % 10) / 10;
    dots.insertAdjacentHTML("beforeend", `<rect x="${c * 10 + 2}" y="${r * 10 + 2}" width="5" height="5" opacity="${(0.15 + o * 0.6).toFixed(2)}"/>`);
  }
}

// the download in the app window: eight ranges, each filling at its own pace
const SIZE_GB = 6.16;
const ranges = [...document.querySelectorAll("[data-ranges] i")];
document.querySelectorAll(".w-blocks").forEach((b) => {
  for (let i = 0; i < 24; i++) b.append(document.createElement("i"));
});
const blocks = document.querySelector("[data-row-blocks]");
const el = (sel) => document.querySelector(sel);
const out = {
  rowState: el("[data-row-state]"),
  rowPct: el("[data-row-pct]"),
  rowSpeed: el("[data-row-speed]"),
  speed: el("[data-d-speed]"),
  bytes: el("[data-d-bytes]"),
  eta: el("[data-d-eta]"),
};
let progress, rates, timer;

function start() {
  progress = ranges.map(() => 4 + Math.random() * 6);
  rates = ranges.map(() => 0.9 + Math.random() * 0.45);
  timer = setInterval(tick, 200);
}
function tick() {
  progress = progress.map((p, i) => Math.min(100, p + rates[i] * (0.7 + Math.random() * 0.6) * 0.55));
  render();
  if (progress.every((p) => p >= 100)) {
    clearInterval(timer);
    setTimeout(start, 3000);
  }
}
function render() {
  const pct = progress.reduce((a, b) => a + b, 0) / ranges.length;
  const working = progress.filter((p) => p < 100).length;
  ranges.forEach((r, i) => {
    r.style.setProperty("--p", `${progress[i]}%`);
    r.style.setProperty("--head", progress[i] < 100 ? 0.9 : 0);
    r.classList.toggle("done", progress[i] >= 100);
  });
  [...blocks.children].forEach((b, i) => b.classList.toggle("on", (i + 1) / 24 <= pct / 100 + 0.02));
  const done = pct >= 100;
  // speed as the app would show it: about 4.6 MB/s per busy connection, with some wobble
  const speed = done ? 0 : working * 4.6 * (0.9 + Math.random() * 0.2);
  const left = done ? 0 : ((100 - pct) / 100) * SIZE_GB * 1024 / Math.max(speed, 1);
  out.rowState.textContent = done ? "done" : "downloading";
  out.rowPct.textContent = done ? "" : `${pct.toFixed(1)}%`;
  out.rowSpeed.textContent = done ? "" : `${speed.toFixed(1)} MB/s`;
  out.speed.textContent = done ? "6.16 GB" : `${speed.toFixed(1)} MB/s`;
  out.bytes.textContent = `${((pct / 100) * SIZE_GB).toFixed(2)} GB / ${SIZE_GB} GB · ${pct.toFixed(1)}%`;
  out.eta.textContent = done ? "done" : `${Math.floor(left / 60)}m ${Math.round(left % 60)}s left`;
}

if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  progress = [38, 33, 41, 29, 36, 31, 40, 30];
  render();
} else {
  start();
}
