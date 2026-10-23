// Measured with scripts in the repo; filled in from a real run. Do not edit by hand.
//   file      name of the file that was downloaded
//   size_mb   its size in MB (all MB/s figures are size_mb / seconds)
//   server    where it came from, e.g. "ftp.riken.jp (Tokyo)"
//   date      when it was measured, e.g. "2026-10-23"
//   runs      one entry per setting; the run with connections: 1 is the browser baseline
//   line      (optional) the connection it was measured on, e.g. "1 Gbit/s fibre, Paris"
//   note      (optional) one more sentence for the footnote
// Every speed claim on the page is computed from this object. While any value still says
// PLACEHOLDER, the page marks the figures as sample numbers.
const BENCH = {
  file: "big_buck_bunny_720p_surround.mp4",
  size_mb: 61.9,
  server: "archive.org",
  date: "2026-10-23",
  line: "a datacenter line that reaches ~70 MB/s on one connection to a nearby server",
  runs: [
    { label: "Browser / single connection", connections: 1, seconds: 48.9 },
    { label: "Byterush · 8 connections", connections: 8, seconds: 10.6 },
    { label: "Byterush · 16 connections", connections: 16, seconds: 8.6 },
  ],
  note:
    "The Internet Archive limits how fast each connection may go, like many mirrors and file hosts. " +
    "Average of two runs per setting with scripts/bench.sh; curl stands in for the browser, which also uses one connection per file. " +
    "Servers that don't limit connections gain less: a 100 MB file from Hetzner Singapore took 7.7 s on one connection and 5.1 s on 16 (1.5×), " +
    "from Nuremberg 3.7 s and 2.7 s (1.4×), and from Ashburn, where one connection already filled the line, it was no faster.",
};

const GITHUB = "https://github.com/zecod/byterush";
const LINKS = {
  github: GITHUB,
  releases: GITHUB + "/releases/latest",
  allReleases: GITHUB + "/releases",
  extension: GITHUB + "#browser-extension",
  issues: GITHUB + "/issues",
  source: GITHUB + "#development",
};
const RELEASE_API = "https://api.github.com/repos/zecod/byterush/releases/latest";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

$$("[data-link]").forEach((a) => {
  if (LINKS[a.dataset.link]) a.href = LINKS[a.dataset.link];
  a.target = "_blank";
  a.rel = "noopener noreferrer";
});

/* ---------- mobile menu ---------- */

const menu = $(".menu");
const nav = $("#nav");
const closeMenu = () => {
  nav.classList.remove("open");
  menu.setAttribute("aria-expanded", "false");
};
menu.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  menu.setAttribute("aria-expanded", String(open));
});
nav.addEventListener("click", (e) => {
  if (e.target.closest("a")) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && nav.classList.contains("open")) {
    closeMenu();
    menu.focus();
  }
});

/* ---------- formatting ---------- */

const fixed = (n, d) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtFactor = (x) => `${x >= 10 ? Math.round(x) : fixed(x, 1).replace(/\.0$/, "")}×`;
const fmtSpeed = (mbps) => `${fixed(mbps, mbps >= 100 ? 0 : 1)} MB/s`;
const fmtSize = (mb) => (mb >= 1024 ? `${fixed(mb / 1024, 2)} GB` : `${fixed(mb, mb < 10 ? 1 : 0)} MB`);
const fmtBytes = (b) => (b >= 1073741824 ? `${fixed(b / 1073741824, 2)} GB` : `${fixed(b / 1048576, 1)} MB`);
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function fmtTime(sec) {
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/* ---------- speed: everything below comes from BENCH ---------- */

function benchStats(b) {
  const size = Number(b.size_mb);
  const runs = (b.runs || [])
    .filter((r) => r && Number(r.seconds) > 0)
    .map((r) => ({ ...r, seconds: Number(r.seconds), connections: Math.max(1, Number(r.connections) || 1), mbps: size / Number(r.seconds) }));
  if (!(size > 0) || runs.length < 2) return null;
  const base = runs.find((r) => r.connections === 1) || runs.reduce((a, r) => (r.seconds > a.seconds ? r : a));
  runs.forEach((r) => (r.factor = base.seconds / r.seconds));
  const best = runs.reduce((a, r) => (r.seconds < a.seconds ? r : a));
  return { runs, base, best, size, placeholder: /placeholder/i.test(JSON.stringify(b)) };
}

const stats = benchStats(BENCH);
if (stats) renderBench(stats);
else $$("[data-race], [data-bench-table]").forEach((n) => (n.closest(".table-wrap") || n).setAttribute("hidden", ""));

function renderBench({ runs, base, best, size, placeholder }) {
  const sizeText = fmtSize(size);
  const faster = runs.filter((r) => r !== base).sort((a, b) => a.connections - b.connections);
  const pctAtBest = Math.round((best.seconds / base.seconds) * 100);

  // hero chip
  if (best.factor > 1.05) {
    $("[data-bench-chip-factor]").textContent = fmtFactor(best.factor);
    $("[data-bench-chip-text]").textContent = `faster than a browser download in our test${placeholder ? " (sample numbers)" : ""}`;
    $("[data-bench-chip]").hidden = false;
  }

  $("[data-bench-sample]").hidden = !placeholder;
  $("[data-race-title]").textContent = `Fig 2. the same file, downloaded ${["", "one", "two", "three", "four", "five", "six"][runs.length] || runs.length} ways`;

  // lead
  const list = faster.map((r) => `${fmtTime(r.seconds)} with ${r.connections} connections`);
  const joined = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0];
  $("[data-bench-lead]").textContent =
    `We downloaded the same ${sizeText} file from ${BENCH.server} with each setting. ` +
    `Over a single connection, the way a browser does it, it took ${fmtTime(base.seconds)}. ` +
    `Byterush took ${joined}.`;

  // stat tiles
  const tiles = [
    [`<mark>${fmtFactor(best.factor)}</mark>`, `faster than one connection, using ${best.connections} connections`],
    [`${fixed(best.mbps, best.mbps >= 100 ? 0 : 1)}<small>MB/s</small>`, `average with ${best.connections} connections, against ${fmtSpeed(base.mbps)} over one`],
    [fmtTime(base.seconds - best.seconds), `less waiting for one ${sizeText} file`],
  ];
  const box = $("[data-bench-stats]");
  for (const [value, label] of tiles) {
    const tile = el("div", "stat");
    const v = el("span", "stat-v");
    v.innerHTML = value; // built from numbers only
    tile.append(v, el("span", "stat-l", label));
    box.append(tile);
  }

  // methodology, generated from BENCH
  const foot = $("[data-bench-method]");
  const strong = el("strong", "", "Method. ");
  foot.append(
    strong,
    `${BENCH.file}, ${sizeText}${size >= 1024 ? ` (${fixed(size, 0)} MB)` : ""}, downloaded from ${BENCH.server}, measured ${BENCH.date}` +
      (BENCH.line ? ` on ${BENCH.line}` : "") +
      `. Average speed is file size ÷ time. When “${best.label}” finished, the single connection had ${pctAtBest}% of the file. ` +
      (BENCH.note ? `${BENCH.note} ` : "") +
      "Your numbers depend on the server, how far away it is and your own line."
  );

  // results table
  const maxSpeed = Math.max(...runs.map((r) => r.mbps));
  const tbody = $("[data-bench-table] tbody");
  for (const r of runs) {
    const tr = el("tr", r === base ? "base" : "");
    const th = el("th", "", r.label);
    th.scope = "row";
    th.append(el("small", "", `${r.connections} connection${r.connections > 1 ? "s" : ""}`));
    const speed = el("td");
    const bar = el("span", "bar");
    const fill = el("i");
    fill.style.width = `${(r.mbps / maxSpeed) * 100}%`;
    bar.append(fill);
    bar.setAttribute("aria-hidden", "true");
    speed.append(bar, fmtSpeed(r.mbps));
    tr.append(th, el("td", "", fmtTime(r.seconds)), speed, el("td", "", r === base ? "baseline" : `${fmtFactor(r.factor)} faster`));
    tbody.append(tr);
  }

  // FAQ answer
  $("[data-bench-faq]").textContent =
    `In our test, a ${sizeText} file from ${BENCH.server} took ${fmtTime(best.seconds)} with ${best.connections} connections ` +
    `instead of ${fmtTime(base.seconds)} over the single connection a browser uses: ${fmtFactor(best.factor)} faster` +
    `${placeholder ? " (sample numbers for now)" : ""}. ` +
    "The gain is largest when a server limits each connection or is far away, and small when one connection already fills your line.";

  setupRace(runs, base, best);
}

function setupRace(runs, base, best) {
  const host = $("[data-race-lanes]");
  const clock = $("[data-race-clock]");
  const replay = $("[data-race-replay]");
  const longest = Math.max(...runs.map((r) => r.seconds));
  const PLAY = 6.5; // seconds on screen for the slowest run
  const speedup = longest / PLAY;

  const lanes = runs.map((r) => {
    const n = Math.min(32, r.connections);
    const lane = el("div", `lane${r === base ? " base" : ""}${r === best ? " best" : ""}`);
    const top = el("div", "lane-top");
    const stat = el("span", "lane-stat");
    top.append(el("span", "lane-name", r.label), stat);
    const track = el("div", "lane-track");
    track.style.setProperty("--n", n);
    for (let i = 0; i < n; i++) track.append(el("i"));
    lane.append(top, track);
    host.append(lane);
    return { r, lane, stat, track, last: "" };
  });

  // every range of a run fills together: re-splitting keeps the connections level to the end
  function draw(t) {
    for (const L of lanes) {
      const p = Math.min(1, t / L.r.seconds);
      L.track.style.setProperty("--p", `${(p * 100).toFixed(2)}%`);
      const done = p >= 1;
      const text = done ? `${fmtClock(L.r.seconds)} · ${fmtSpeed(L.r.mbps)}` : `${fmtClock(t)} · ${Math.floor(p * 100)}%`;
      if (text !== L.last) {
        L.last = text;
        L.lane.classList.toggle("done", done);
        L.stat.textContent = text;
        if (done) L.stat.append(el("span", "lane-x", L.r === base ? "1×" : fmtFactor(L.r.factor)));
      }
    }
  }

  if (reducedMotion) {
    draw(best.seconds);
    clock.textContent = `frozen at ${fmtClock(best.seconds)}, when the fastest run finished`;
    return;
  }

  let t = 0;
  let running = false;
  let started = false;
  let last = 0;
  function frame(now) {
    if (!running) return;
    t = Math.min(longest, t + ((now - last) / 1000) * speedup);
    last = now;
    draw(t);
    clock.textContent = `${fmtClock(t)} elapsed · ${Math.round(speedup)}× playback`;
    if (t >= longest) {
      running = false;
      replay.hidden = false;
      return;
    }
    requestAnimationFrame(frame);
  }
  function play() {
    t = 0;
    running = true;
    started = true;
    replay.hidden = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }
  draw(0);
  clock.textContent = `0:00 · ${Math.round(speedup)}× playback`;
  replay.addEventListener("click", play);
  onVisible($("[data-race]"), (visible) => {
    if (visible && !started) play();
  }, 0.45);
}

function onVisible(node, cb, threshold = 0.1) {
  if (!("IntersectionObserver" in window)) return cb(true);
  new IntersectionObserver((entries) => entries.forEach((e) => cb(e.isIntersecting)), { threshold }).observe(node);
}

/* ---------- the split: ranges, and a finished connection taking half of the largest range left ---------- */

class Splitter {
  constructor(speeds, minLeft = 0.012) {
    this.speeds = speeds; // fraction of the file per second, per connection
    this.minLeft = minLeft; // smaller ranges are not split again
    this.reset();
  }
  reset() {
    const n = this.speeds.length;
    this.t = 0;
    this.events = [];
    this.ranges = Array.from({ length: n }, (_, i) => ({ start: i / n, end: (i + 1) / n, pos: i / n, conn: i, born: -9 }));
  }
  rate(conn) {
    return this.speeds[conn] * (1 + 0.15 * Math.sin(this.t * 1.3 + conn * 2.1));
  }
  step(dt) {
    this.t += dt;
    for (const r of this.ranges.slice()) {
      if (r.pos >= r.end) continue;
      r.pos = Math.min(r.end, r.pos + this.rate(r.conn) * dt);
      if (r.pos >= r.end) this.steal(r.conn);
    }
  }
  steal(conn) {
    let big = null;
    for (const r of this.ranges) if (r.pos < r.end && (!big || r.end - r.pos > big.end - big.pos)) big = r;
    if (!big || big.end - big.pos < this.minLeft) return; // nothing worth splitting: this connection is done
    const mid = big.pos + (big.end - big.pos) / 2;
    this.ranges.push({ start: mid, end: big.end, pos: mid, conn, born: this.t });
    this.events.push({ t: this.t, conn, from: big.conn, start: mid, end: big.end });
    big.end = mid;
  }
  get done() {
    return this.ranges.every((r) => r.pos >= r.end);
  }
  get progress() {
    return this.ranges.reduce((s, r) => s + (r.pos - r.start), 0);
  }
  get busy() {
    return this.ranges.filter((r) => r.pos < r.end);
  }
}

function drawMap(sim, host, labels) {
  const width = host.clientWidth || 1;
  for (const r of sim.ranges) {
    if (!r.node) {
      r.node = el("div", "seg");
      r.fill = el("div", "seg-fill");
      r.node.append(r.fill);
      if (labels) r.node.append((r.label = el("span", "seg-label", `c${r.conn + 1}`)));
      host.append(r.node);
    }
    const w = r.end - r.start;
    r.node.style.left = `${r.start * 100}%`;
    r.node.style.width = `${w * 100}%`;
    r.fill.style.width = `${w > 0 ? ((r.pos - r.start) / w) * 100 : 100}%`;
    r.node.classList.toggle("busy", r.pos < r.end);
    r.node.classList.toggle("fresh", sim.t - r.born < 1.1);
    if (r.label) r.label.hidden = w * width < 34;
  }
}

function animate(frame) {
  let raf = 0;
  let last = 0;
  let on = false;
  const tick = (now) => {
    if (!on) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frame(dt);
    raf = requestAnimationFrame(tick);
  };
  return {
    start() {
      if (on) return;
      on = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    },
    stop() {
      on = false;
      cancelAnimationFrame(raf);
    },
  };
}

/* ---------- Fig 1: the app window in the band ---------- */

{
  const stage = $("[data-stage]");
  const win = $(".win", stage);
  const fit = () => (win.style.transform = `scale(${stage.clientWidth / 952})`);
  new ResizeObserver(fit).observe(stage);
  fit();

  $$(".w-blocks").forEach((b) => {
    const on = Number(b.dataset.fixed || 0);
    for (let i = 0; i < 24; i++) b.append(el("i", i < on ? "half" : ""));
  });

  const SIZE_GB = 6.16;
  const PER_CONN = 4.6; // MB/s a connection shows at speed 1
  const UNIT = 0.016;
  const weights = [1.0, 0.8, 1.1, 0.65, 0.95, 0.75, 1.05, 0.55];
  const sim = new Splitter(weights.map((w) => w * UNIT));
  const map = $("[data-band-map]");
  const blocks = $("[data-row-blocks]");
  const out = {
    count: $(".w-count b"),
    rowState: $("[data-row-state]"),
    rowPct: $("[data-row-pct]"),
    rowSpeed: $("[data-row-speed]"),
    state: $("[data-d-state]"),
    speed: $("[data-d-speed]"),
    bytes: $("[data-d-bytes]"),
    eta: $("[data-d-eta]"),
    conns: $("[data-d-conns]"),
    fig: $("[data-d-fig]"),
  };
  let hold = 0;
  let textAge = 1;

  const begin = (head) => {
    map.replaceChildren();
    sim.reset();
    while (sim.progress < head) sim.step(0.05);
  };
  const render = (force) => {
    drawMap(sim, map, false);
    const pct = sim.progress * 100;
    [...blocks.children].forEach((b, i) => b.classList.toggle("on", (i + 1) / 24 <= pct / 100 + 0.02));
    if (!force && textAge < 0.25) return;
    textAge = 0;
    const busy = sim.busy;
    const done = busy.length === 0;
    const speed = busy.reduce((s, r) => s + (sim.rate(r.conn) / UNIT) * PER_CONN, 0);
    const left = ((100 - pct) / 100) * SIZE_GB * 1024;
    const eta = left / Math.max(speed, 1);
    out.count.textContent = done ? "0 active" : "1 active";
    out.rowState.textContent = done ? "done" : "downloading";
    out.rowPct.textContent = done ? "" : `${pct.toFixed(1)}%`;
    out.rowSpeed.textContent = done ? "" : `${speed.toFixed(1)} MB/s`;
    out.state.textContent = done ? "● completed" : "● downloading";
    out.speed.textContent = done ? `${SIZE_GB} GB` : `${speed.toFixed(1)} MB/s`;
    out.bytes.textContent = `${((pct / 100) * SIZE_GB).toFixed(2)} GB / ${SIZE_GB} GB · ${pct.toFixed(1)}%`;
    out.eta.textContent = done ? "moved to ~/Downloads/Programs" : `${Math.floor(eta / 60)}m ${String(Math.round(eta % 60)).padStart(2, "0")}s left`;
    out.conns.textContent = done ? "" : `${busy.length} connections`;
    out.fig.textContent = `Fig 2. split — ${sim.ranges.length} ranges over ${weights.length} connections`;
  };

  if (reducedMotion) {
    begin(0.42);
    render(true);
  } else {
    begin(0.3);
    render(true);
    const loop = animate((dt) => {
      textAge += dt;
      if (sim.done) {
        hold += dt;
        if (hold > 2.6) {
          hold = 0;
          begin(0.04);
          render(true);
        }
        return;
      }
      sim.step(dt);
      render(sim.done);
    });
    onVisible(stage, (v) => (v ? loop.start() : loop.stop()), 0.05);
  }
}

/* ---------- Fig 3: how it works ---------- */

{
  const FILE_GB = 4;
  const weights = [1.0, 0.75, 1.4, 0.6, 1.25, 0.4, 1.1, 0.7];
  const sim = new Splitter(weights.map((w) => w * 0.024), 0.012);
  const bar = $("[data-split-bar]");
  const log = $("[data-split-log]");
  const status = $("[data-split-status]");
  const figLabel = $("[data-split-fig]");
  const steps = Object.fromEntries($$("[data-split-steps] li").map((li) => [li.dataset.step, li]));
  const gb = (f) => (f * FILE_GB).toFixed(2);
  let phase = "probe";
  let phaseT = 0;
  let seen = 0;

  const say = (html) => {
    const li = el("li");
    li.innerHTML = html; // only built from numbers below
    log.append(li);
    while (log.children.length > 4) log.firstElementChild.remove();
  };
  const setStep = (name) => Object.entries(steps).forEach(([k, li]) => li.classList.toggle("on", k === name));
  const label = () => (figLabel.textContent = `Fig 3. split — ${sim.ranges.length} ranges over ${weights.length} connections`);
  const logSteals = () => {
    for (; seen < sim.events.length; seen++) {
      const e = sim.events[seen];
      say(`<b>c${e.conn + 1}</b> finished → takes ${gb(e.start)}–${gb(e.end)} GB from <b>c${e.from + 1}</b>`);
    }
  };
  const showStatus = () => {
    const busy = sim.busy.length;
    status.textContent = sim.done ? "complete" : `${Math.floor(sim.progress * 100)}% · ${busy} connection${busy === 1 ? "" : "s"} busy`;
  };

  function enter(next) {
    phase = next;
    phaseT = 0;
    if (next === "probe") {
      sim.reset();
      seen = 0;
      bar.replaceChildren(el("span", "fb-probe", `GET file.iso → 206 · ${FILE_GB}.00 GB · accepts ranges`));
      log.replaceChildren();
      say(`<b>probe</b> first request: ${FILE_GB}.00 GB, ranges supported`);
      status.textContent = "probing…";
      label();
    } else if (next === "split") {
      bar.replaceChildren();
      drawMap(sim, bar, true);
      say(`<b>split</b> ${weights.length} ranges of ${(FILE_GB * 1024) / weights.length} MB, one per connection`);
      status.textContent = "splitting…";
    } else if (next === "done") {
      say(`<b>done</b> ${FILE_GB}.00 GB in ${sim.ranges.length} ranges, written in place`);
      showStatus();
    }
    setStep(next === "download" ? "download" : next);
  }

  if (reducedMotion) {
    bar.replaceChildren();
    say(`<b>split</b> ${weights.length} ranges of ${(FILE_GB * 1024) / weights.length} MB, one per connection`);
    while (sim.events.length < 3 && !sim.done) sim.step(0.05);
    drawMap(sim, bar, true);
    logSteals();
    label();
    showStatus();
  } else {
    enter("probe");
    const loop = animate((dt) => {
      phaseT += dt;
      if (phase === "probe" && phaseT > 1.3) enter("split");
      else if (phase === "split" && phaseT > 1.1) enter("download");
      else if (phase === "download") {
        sim.step(dt);
        drawMap(sim, bar, true);
        logSteals();
        label();
        showStatus();
        const lastSteal = sim.events.at(-1);
        setStep(lastSteal && sim.t - lastSteal.t < 1.4 ? "steal" : "download");
        if (sim.done) enter("done");
      } else if (phase === "done" && phaseT > 3.4) enter("probe");
    });
    onVisible($("[data-split]"), (v) => (v ? loop.start() : loop.stop()), 0.2);
    new ResizeObserver(() => phase !== "probe" && drawMap(sim, bar, true)).observe(bar);
  }
}

/* ---------- downloads: detect the visitor's system, link straight to the right file ---------- */

const OS_NAME = { windows: "Windows", macos: "macOS", linux: "Linux" };
const BUILDS = {
  "win-exe": { os: "windows", kind: "exe", arch: "x64", name: ".exe installer" },
  "win-msi": { os: "windows", kind: "msi", arch: "x64", name: ".msi package" },
  "mac-arm": { os: "macos", kind: "dmg", arch: "arm64", name: "Apple Silicon build" },
  "mac-x64": { os: "macos", kind: "dmg", arch: "x64", name: "Intel build" },
  "linux-appimage": { os: "linux", kind: "appimage", arch: "x64", name: ".AppImage" },
  "linux-deb": { os: "linux", kind: "deb", arch: "x64", name: ".deb" },
  "linux-rpm": { os: "linux", kind: "rpm", arch: "x64", name: ".rpm" },
};
const REQUIRES = { windows: "Windows 10 and 11", macos: "macOS 11 or later", linux: "64-bit Linux" };

function osFrom(s) {
  s = String(s || "").toLowerCase();
  if (/cros|chrome ?os/.test(s)) return "other";
  if (/mac|darwin/.test(s)) return "macos";
  if (/win/.test(s)) return "windows";
  if (/linux|x11|bsd/.test(s)) return "linux";
  return null;
}

// what the browser tells us right away
function detect() {
  const ua = navigator.userAgent || "";
  const uad = navigator.userAgentData;
  const d = { os: null, mobile: false, arch: null, archSure: false, distro: null, version: null };
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (uad?.mobile || iPadOS || /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua)) {
    d.mobile = true;
    return d;
  }
  d.os = osFrom(uad?.platform) || osFrom(`${navigator.platform || ""} ${ua}`);
  if (d.os === "windows") {
    d.arch = /arm64|aarch64/i.test(ua) ? "arm64" : "x64";
    d.archSure = d.arch === "arm64";
  } else if (d.os === "linux") {
    const hay = `${navigator.platform || ""} ${ua}`;
    d.arch = /aarch64|arm64|armv\d/i.test(hay) ? "arm64" : "x64";
    d.archSure = /aarch64|arm64|armv\d|x86_64|amd64/i.test(hay);
    if (/ubuntu|debian|mint|pop!?_os|elementary|zorin|kali|raspbian/i.test(ua)) d.distro = "deb";
    else if (/fedora|red hat|rhel|centos|opensuse|suse|rocky|alma|mageia/i.test(ua)) d.distro = "rpm";
  } else if (d.os === "macos") {
    // Safari and Firefox say "Intel" on every Mac, so without client hints assume Apple Silicon
    d.arch = "arm64";
  }
  return d;
}

// Chromium browsers can tell the architecture through client hints
async function refine(d) {
  const uad = navigator.userAgentData;
  if (d.mobile || !uad || typeof uad.getHighEntropyValues !== "function") return d;
  try {
    const hi = await uad.getHighEntropyValues(["architecture", "bitness", "platform", "platformVersion"]);
    const os = osFrom(hi.platform);
    if (os) d.os = os;
    if (hi.architecture === "arm") Object.assign(d, { arch: "arm64", archSure: true });
    else if (hi.architecture === "x86") Object.assign(d, { arch: hi.bitness === "32" ? "x86" : "x64", archSure: true });
    if (hi.platformVersion) d.version = parseInt(hi.platformVersion, 10);
  } catch {
    // no hints: keep the first guess
  }
  return d;
}

// tauri-action names: Byterush_0.2.0_x64-setup.exe, Byterush_0.2.0_aarch64.dmg, Byterush-0.2.0-1.x86_64.rpm …
function classify(name) {
  const n = name.toLowerCase();
  if (/\.(sig|asc|sha256|sha512|blockmap|json|txt|zip|gz|xz|tar)$/.test(n)) return null; // updater bundles and signatures
  const kind = n.endsWith(".exe") ? "exe" : n.endsWith(".msi") ? "msi" : n.endsWith(".dmg") ? "dmg" : n.endsWith(".appimage") ? "appimage" : n.endsWith(".deb") ? "deb" : n.endsWith(".rpm") ? "rpm" : null;
  if (!kind) return null;
  const arch = /(^|[^a-z0-9])(aarch64|arm64)([^a-z0-9]|$)/.test(n)
    ? "arm64"
    : /x86_64|x86-64|amd64|x64/.test(n)
      ? "x64"
      : /universal/.test(n)
        ? "universal"
        : /(^|[^a-z0-9])(i686|i386|x86)([^a-z0-9]|$)/.test(n)
          ? "x86"
          : null;
  return { kind, arch };
}

function findAsset(release, kind, arch) {
  if (!release) return null;
  const list = release.assets.filter((a) => a.kind === kind);
  return list.find((a) => a.arch === arch) || list.find((a) => a.arch === "universal") || (arch === "x64" ? list.find((a) => a.arch === null) : null) || null;
}

const store = {
  get(key) {
    try {
      return JSON.parse(sessionStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage blocked: just fetch again next time
    }
  },
};

function parseRelease(json) {
  if (!json || !Array.isArray(json.assets)) return null;
  const assets = json.assets
    .map((a) => ({ name: String(a?.name || ""), url: String(a?.browser_download_url || ""), size: Number(a?.size) || 0 }))
    .filter((a) => a.url.startsWith("https://"))
    .map((a) => ({ ...a, ...classify(a.name) }))
    .filter((a) => a.kind);
  const url = String(json.html_url || "");
  return { tag: String(json.tag_name || ""), url: url.startsWith("https://") ? url : LINKS.releases, published: json.published_at || null, assets };
}

async function latestRelease() {
  const KEY = "byterush.release.v1";
  const hit = store.get(KEY);
  if (hit && typeof hit.at === "number" && Date.now() - hit.at < (hit.release ? 3600e3 : 600e3)) return hit.release;
  let release = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(RELEASE_API, { signal: ctl.signal });
    clearTimeout(timer);
    if (res.ok) release = parseRelease(await res.json());
  } catch {
    // offline, blocked or rate-limited: the links keep pointing at the releases page
  }
  store.set(KEY, { at: Date.now(), release });
  return release;
}

function primaryFor(d) {
  if (d.os === "windows") return ["win-exe", "win-msi"];
  if (d.os === "macos") return d.arch === "x64" ? ["mac-x64", "mac-arm"] : ["mac-arm", "mac-x64"];
  if (d.os === "linux") {
    const order = d.distro === "rpm" ? ["linux-rpm", "linux-appimage", "linux-deb"] : d.distro === "deb" ? ["linux-deb", "linux-appimage", "linux-rpm"] : ["linux-appimage", "linux-deb", "linux-rpm"];
    return order;
  }
  return null;
}

// the asset for a build on this machine: an arm64 file when there is one, else the build's own arch
function assetFor(id, release, d) {
  const b = BUILDS[id];
  if (d && d.os === b.os && d.arch === "arm64" && b.os !== "macos") {
    const arm = findAsset(release, b.kind, "arm64");
    if (arm) return { asset: arm, arch: "arm64" };
    if (b.os === "linux") return { asset: null, arch: "arm64" }; // no x64 fallback on ARM Linux
  }
  return { asset: findAsset(release, b.kind, b.arch), arch: b.arch };
}

function link(text, href) {
  const a = el("a", "underline", text);
  a.href = href;
  return a;
}

function applyDownloads(d, release) {
  const fallback = release?.url || LINKS.releases;
  const hero = $("[data-dl-primary]");
  const label = $("[data-dl-label]");
  const archTag = $("[data-dl-arch]");
  const meta = $("[data-dl-meta]");
  const alt = $("[data-dl-alt]");
  const order = d.mobile ? null : primaryFor(d);
  alt.replaceChildren();
  alt.hidden = true;

  // platform cards
  $$(".platform").forEach((card) => {
    const mine = !!order && card.dataset.os === d.os;
    card.classList.toggle("is-detected", mine);
    $(".detected", card).hidden = !mine;
  });
  $$("[data-build]").forEach((a) => {
    const id = a.dataset.build;
    const { asset } = assetFor(id, release, null);
    a.href = asset ? asset.url : fallback;
    a.title = asset ? asset.name : "Open the latest release on GitHub";
    $("[data-size]", a).textContent = asset ? fmtBytes(asset.size) : "";
    a.classList.toggle("is-pick", !!order && order[0] === id);
  });
  $("[data-mobile-note]").hidden = !d.mobile;
  if (release) {
    const line = $("[data-release-line]");
    const when = release.published ? new Date(release.published) : null;
    const date = when && !isNaN(when) ? when.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
    line.replaceChildren(`Free for Windows, macOS and Linux. Version ${release.tag}${date ? `, released ${date}` : ""}. `, link("Release notes", release.url), ".");
  }

  // hero button
  if (!order) {
    label.textContent = "Download";
    archTag.textContent = "";
    hero.href = "#download";
    meta.textContent = release ? `${release.tag} · Windows, macOS and Linux` : "Free and open source · Windows, macOS and Linux";
    alt.textContent = d.mobile
      ? "Byterush is a desktop app for Windows, macOS and Linux. Open this page on your computer to install it."
      : "Pick the build for your system below.";
    alt.hidden = false;
    return;
  }

  const [main, ...others] = order;
  const pick = assetFor(main, release, d);
  const b = BUILDS[main];
  label.textContent = `Download for ${OS_NAME[d.os]}`;
  if (d.os === "macos") archTag.textContent = b.arch === "arm64" ? "Apple Silicon" : "Intel";
  else if (d.os === "windows") archTag.textContent = pick.arch === "arm64" ? "ARM64" : "x64";
  else archTag.textContent = `${pick.arch === "arm64" ? "ARM64" : "x64"} · ${b.name}`;

  const armLinux = d.os === "linux" && pick.arch === "arm64" && !pick.asset;
  hero.href = armLinux ? "#download" : pick.asset ? pick.asset.url : fallback;
  hero.title = pick.asset ? pick.asset.name : "";
  const bits = [release ? release.tag : "Free and open source"];
  if (pick.asset) bits.push(fmtBytes(pick.asset.size));
  bits.push(REQUIRES[d.os]);
  meta.textContent = bits.join(" · ");

  const parts = [];
  if (armLinux) {
    parts.push("There is no ARM build for Linux yet. You can ", link("build it from source", LINKS.source), ".");
  } else if (d.os === "windows" && d.version === 0) {
    parts.push("Byterush needs Windows 10 or 11.");
  } else if (d.os === "macos" && d.version && d.version < 11) {
    parts.push("Byterush needs macOS 11 or later.");
  } else if (d.os === "macos") {
    if (!d.archSure || d.arch === "x64") {
      const other = others[0];
      parts.push(other === "mac-x64" ? "Intel Mac? " : "Mac with an M chip? ", link(`Download the ${BUILDS[other].name}`, assetFor(other, release, null).asset?.url || fallback));
    }
  } else if (d.os === "windows") {
    if (d.arch === "arm64" && pick.arch === "x64") parts.push("This x64 build runs on Windows 11 on ARM through emulation. ");
    parts.push("Also as an ", link(BUILDS["win-msi"].name, assetFor("win-msi", release, null).asset?.url || fallback), ".");
  } else if (d.os === "linux") {
    parts.push("Also as ");
    others.forEach((id, i) => {
      if (i) parts.push(" or ");
      parts.push(link(BUILDS[id].name, assetFor(id, release, null).asset?.url || fallback));
    });
    parts.push(".");
  }
  if (parts.length) {
    alt.append(...parts);
    alt.hidden = false;
  }
}

{
  const d = detect();
  applyDownloads(d, null);
  Promise.all([refine(d), latestRelease()]).then(([dd, release]) => applyDownloads(dd, release));
}
