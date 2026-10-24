// Measured with scripts in the repo; filled in from real runs. Do not edit by hand.
// One entry per test download; the page shows them as tabs, in this order, the first one selected.
//   id        short unique name, letters, digits and dashes
//   title     the tab's label, e.g. "archive.org" or "1 GB file"
//   file      name of the file that was downloaded
//   size_mb   its size in MB (all MB/s figures are size_mb / seconds)
//   server    where it came from, e.g. "ftp.riken.jp (Tokyo)"
//   date      when it was measured, e.g. "2026-10-23"
//   runs      one entry per setting: { connections, seconds, label? }; connections: 1 is the browser
//             baseline, and a missing label is written from the connection count
//   line      (optional) the connection it was measured on, e.g. "1 Gbit/s fibre, Paris"
//   note      (optional) one more sentence for the footnote
// Every speed claim on the page is computed from these objects; the hero chip and the FAQ use the
// first one. While an entry still says PLACEHOLDER anywhere, its numbers are marked as samples.
const BENCHES = [
  {
    id: "961mb",
    title: "961 MB · archive.org",
    file: "Sintel_Documentary_by_Ali_Boubred.avi",
    size_mb: 961.2,
    server: "archive.org",
    date: "2026-10-23",
    line: "a datacenter line that reaches ~70 MB/s on one connection to a nearby server",
    runs: [
      { connections: 1, seconds: 414.3 },
      { connections: 8, seconds: 28.4 },
      { connections: 16, seconds: 22.8 },
      { connections: 32, seconds: 13.5 },
    ],
    note:
      "The Internet Archive limits how fast each connection may go, like many mirrors and file hosts: one connection got a short fast start and then about 2 MB/s. " +
      "Average of two runs per setting with scripts/bench.sh; curl stands in for the browser, which also uses one connection per file.",
  },
  {
    id: "10gb-helsinki",
    title: "10.7 GB · Helsinki",
    file: "10GB.bin",
    size_mb: 10737.4,
    server: "Hetzner Helsinki",
    date: "2026-10-24",
    runs: [
      { label: "Chrome", connections: 1, seconds: 543.9 },
      { label: "Byterush app · 16 connections", connections: 16, seconds: 59.5 },
    ],
    note:
      "Chrome against the Byterush app, from the screen recordings in the demo video, both timed from the click; Byterush's time includes about 4 s in its New download window. " +
      "It downloaded at the recording machine's disk speed (about 190 MB/s), so a faster disk finishes sooner. One run each.",
  },
  {
    id: "10gb-falkenstein",
    title: "10.7 GB · Falkenstein",
    file: "10GB.bin",
    size_mb: 10737.4,
    server: "Hetzner Falkenstein",
    date: "2026-10-24",
    runs: [
      { label: "Chrome", connections: 1, seconds: 299.1 },
      { label: "Byterush app · 16 connections", connections: 16, seconds: 54.9 },
    ],
    note:
      "Chrome against the Byterush app, from the screen recordings in the demo video, both timed from the click; Byterush's time includes about 4 s in its New download window. " +
      "Closer than Helsinki, so one connection is faster; Byterush again downloaded at the recording machine's disk speed (about 210 MB/s). One run each.",
  },
  {
    id: "3-6gb",
    title: "3.6 GB · archive.org",
    file: "ED-360-png.tar",
    size_mb: 3569.9,
    server: "archive.org",
    date: "2026-10-23",
    runs: [
      { label: "One connection · reset at 97%", connections: 1, seconds: 1933 },
      { connections: 32, seconds: 32.7 },
    ],
    note:
      "The single connection never finished: after 32 min 13 s, with 3.46 of 3.57 GB (97%) received, the server reset it. " +
      "Its time is therefore a lower bound, and so is the speed-up. One run per setting.",
  },
  {
    id: "1gb",
    title: "1 GB · Hetzner",
    file: "1GB.bin",
    size_mb: 1073.7,
    server: "Hetzner Nuremberg",
    date: "2026-10-23",
    runs: [
      { connections: 1, seconds: 28.9 },
      { connections: 16, seconds: 6.0 },
      { connections: 32, seconds: 6.5 },
    ],
    note:
      "A server that doesn't limit connections still gains on a big file; one run per setting. " +
      "Small files gain less: 100 MB files from Hetzner took 1.4–1.5× less time, and from a server next door, where one connection already filled the line, it was no faster.",
  },
  {
    id: "62mb",
    title: "62 MB · archive.org",
    file: "big_buck_bunny_720p_surround.mp4",
    size_mb: 61.9,
    server: "archive.org",
    date: "2026-10-23",
    runs: [
      { connections: 1, seconds: 48.9 },
      { connections: 8, seconds: 10.6 },
      { connections: 16, seconds: 8.6 },
      { connections: 32, seconds: 6.0 },
    ],
    note: "Average of two runs per setting with scripts/bench.sh.",
  },
];

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
const fmtSpeed = (mbps) => `${fixed(mbps, mbps >= 100 ? 0 : 1)}\u00a0MB/s`;
// size_mb is in decimal megabytes, like the titles ("10.7 GB"): 1 GB = 1000 MB here
const fmtSize = (mb) => (mb >= 1000 ? `${fixed(mb / 1000, 2)}\u00a0GB` : `${fixed(mb, mb < 10 ? 1 : 0)}\u00a0MB`);
const fmtBytes = (b) => (b >= 1073741824 ? `${fixed(b / 1073741824, 2)} GB` : `${fixed(b / 1048576, 1)} MB`);
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function fmtTime(sec) {
  if (sec < 59.95) return `${Number.isInteger(sec) ? sec : fixed(sec, 1)}\u00a0s`;
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}\u00a0min ${s % 60}\u00a0s` : `${m}\u00a0min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/* ---------- speed: everything below comes from BENCHES ---------- */

function benchStats(b) {
  if (!b || typeof b !== "object") return null;
  const size = Number(b.size_mb);
  const runs = (Array.isArray(b.runs) ? b.runs : [])
    .filter((r) => r && Number(r.seconds) > 0)
    .map((r) => {
      const connections = Math.max(1, Math.round(Number(r.connections) || 1));
      const label = r.label || (connections === 1 ? "Browser / single connection" : `Byterush · ${connections} connections`);
      return { ...r, label, connections, seconds: Number(r.seconds), mbps: size / Number(r.seconds) };
    });
  if (!(size > 0) || runs.length < 2) return null;
  const base = runs.find((r) => r.connections === 1) || runs.reduce((a, r) => (r.seconds > a.seconds ? r : a));
  runs.forEach((r) => (r.factor = base.seconds / r.seconds));
  const best = runs.reduce((a, r) => (r.seconds < a.seconds ? r : a));
  return { b, runs, base, best, size, placeholder: /placeholder/i.test(JSON.stringify(b)) };
}

const scenarios = (Array.isArray(BENCHES) ? BENCHES : []).map(benchStats).filter(Boolean);
const firstBench = benchStats(Array.isArray(BENCHES) ? BENCHES[0] : null);
const race = createRace();

// the hero chip and the FAQ quote the first test
if (firstBench) {
  const { best, base, size, placeholder, b } = firstBench;
  if (best.factor > 1.05) {
    $("[data-bench-chip-factor]").textContent = fmtFactor(best.factor);
    $("[data-bench-chip-text]").textContent = `faster than a browser download in our test${placeholder ? " (sample numbers)" : ""}`;
    $("[data-bench-chip]").hidden = false;
  }
  $("[data-bench-faq]").textContent =
    `In our test, a ${fmtSize(size)} file from ${b.server} took ${fmtTime(best.seconds)} with ${best.connections} connections ` +
    `instead of ${fmtTime(base.seconds)} over the single connection a browser uses: ${fmtFactor(best.factor)} faster` +
    `${placeholder ? " (sample numbers for now)" : ""}. ` +
    "The gain is largest when a server limits each connection or is far away, and small when one connection already fills your line.";
}

if (scenarios.length) {
  buildTabs();
  showScenario(0);
} else {
  $$("[data-race], [data-bench-table]").forEach((n) => (n.closest(".table-wrap") || n).setAttribute("hidden", ""));
}

function buildTabs() {
  const host = $("[data-bench-tabs]");
  const panel = $("[data-bench-panel]");
  if (scenarios.length < 2) {
    host.hidden = true;
    panel.removeAttribute("role");
    return;
  }
  const tabs = scenarios.map((st, i) => {
    const tab = el("button", "tab");
    tab.type = "button";
    tab.id = `bench-tab-${String(st.b.id || i).replace(/[^a-z0-9-]/gi, "")}-${i}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", "bench-panel");
    tab.append(
      el("span", "tab-t", st.b.title || st.b.file || `Test ${i + 1}`),
      el("span", "tab-s", st.placeholder ? "sample numbers" : `up to ${fmtFactor(st.best.factor)} faster`)
    );
    tab.addEventListener("click", () => select(i));
    host.append(tab);
    return tab;
  });
  function select(i, focus) {
    tabs.forEach((t, k) => {
      t.setAttribute("aria-selected", String(k === i));
      t.tabIndex = k === i ? 0 : -1;
    });
    panel.setAttribute("aria-labelledby", tabs[i].id);
    if (focus) tabs[i].focus();
    showScenario(i);
  }
  host.addEventListener("keydown", (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const keys = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    select((keys[e.key] + tabs.length) % tabs.length, true);
  });
  panel.tabIndex = 0;
  tabs.forEach((t, k) => {
    t.setAttribute("aria-selected", String(k === 0));
    t.tabIndex = k === 0 ? 0 : -1;
  });
  panel.setAttribute("aria-labelledby", tabs[0].id);
}

function showScenario(i) {
  const st = scenarios[i];
  const { b, runs, base, best, size, placeholder } = st;
  const sizeText = fmtSize(size);
  const faster = runs.filter((r) => r !== base).sort((x, y) => x.connections - y.connections);
  const pctAtBest = Math.round((best.seconds / base.seconds) * 100);
  const words = ["", "one", "two", "three", "four", "five", "six"];

  $("[data-bench-sample]").hidden = !placeholder;
  $("[data-race-title]").textContent = `Fig 2. the same file, downloaded ${words[runs.length] || runs.length} ways`;

  const list = faster.map((r) => `${fmtTime(r.seconds)} with ${r.connections} connections`);
  const joined = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0];
  $("[data-bench-lead]").textContent =
    `We downloaded ${b.file} (${sizeText}) from ${b.server}. ` +
    `Over a single connection, the way a browser does it, it took ${fmtTime(base.seconds)}. ` +
    `Byterush took ${joined}.`;

  const box = $("[data-bench-stats]");
  box.replaceChildren();
  const tiles = [
    [`<mark>${fmtFactor(best.factor)}</mark>`, `faster than one connection, using ${best.connections} connections`],
    [`${fixed(best.mbps, best.mbps >= 100 ? 0 : 1)}<small>MB/s</small>`, `average with ${best.connections} connections, against ${fmtSpeed(base.mbps)} over one`],
    [fmtTime(base.seconds - best.seconds), `less waiting for one ${sizeText} file`],
  ];
  for (const [value, label] of tiles) {
    const tile = el("div", "stat");
    const v = el("span", "stat-v");
    v.innerHTML = value; // built from numbers only
    tile.append(v, el("span", "stat-l", label));
    box.append(tile);
  }

  const foot = $("[data-bench-method]");
  foot.replaceChildren(
    el("strong", "", "Method. "),
    `${b.file}, ${sizeText}${size >= 1024 ? ` (${fixed(size, 0)} MB)` : ""}, downloaded from ${b.server}, measured ${b.date}` +
      (b.line ? ` on ${b.line}` : "") +
      `. Average speed is file size ÷ time. When “${best.label}” finished, the single connection had ${pctAtBest}% of the file. ` +
      (b.note ? `${b.note} ` : "") +
      "Your numbers depend on the server, how far away it is and your own line."
  );

  const maxSpeed = Math.max(...runs.map((r) => r.mbps));
  const tbody = $("[data-bench-table] tbody");
  tbody.replaceChildren();
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

  race.load(st);
}

function createRace() {
  const host = $("[data-race-lanes]");
  const clock = $("[data-race-clock]");
  const replay = $("[data-race-replay]");
  const PLAY = 6.5; // seconds on screen for the slowest run
  let st = null;
  let lanes = [];
  let longest = 1;
  let speedup = 1;
  let t = 0;
  let running = false;
  let started = false;
  let last = 0;
  const stamp = (s) => (longest < 60 ? `${fixed(s, 1)} s` : fmtClock(s));

  // every range of a run fills together: re-splitting keeps the connections level to the end
  function draw(time) {
    for (const L of lanes) {
      const p = Math.min(1, time / L.r.seconds);
      L.track.style.setProperty("--p", `${(p * 100).toFixed(2)}%`);
      const done = p >= 1;
      const text = done ? `${fmtTime(L.r.seconds)} · ${fmtSpeed(L.r.mbps)}` : `${stamp(time)} · ${Math.floor(p * 100)}%`;
      if (text !== L.last) {
        L.last = text;
        L.lane.classList.toggle("done", done);
        L.stat.textContent = text;
        if (done) L.stat.append(el("span", "lane-x", L.r === st.base ? "1×" : fmtFactor(L.r.factor)));
      }
    }
  }
  function frame(now) {
    if (!running) return;
    t = Math.min(longest, t + ((now - last) / 1000) * speedup);
    last = now;
    draw(t);
    clock.textContent = `${stamp(t)} elapsed · ${Math.round(speedup)}× playback`;
    if (t >= longest) {
      running = false;
      replay.hidden = false;
      return;
    }
    requestAnimationFrame(frame);
  }
  function play() {
    t = 0;
    started = true;
    replay.hidden = true;
    last = performance.now();
    if (!running) {
      running = true;
      requestAnimationFrame(frame);
    }
  }
  function load(next) {
    st = next;
    longest = Math.max(...st.runs.map((r) => r.seconds));
    speedup = longest / PLAY;
    host.replaceChildren();
    lanes = st.runs.map((r) => {
      const n = Math.min(32, r.connections);
      const lane = el("div", `lane${r === st.base ? " base" : ""}${r === st.best ? " best" : ""}`);
      const top = el("div", "lane-top");
      const stat = el("span", "lane-stat");
      top.append(el("span", "lane-name", r.label), stat);
      const track = el("div", "lane-track");
      track.style.setProperty("--n", n);
      for (let k = 0; k < n; k++) track.append(el("i"));
      lane.append(top, track);
      host.append(lane);
      return { r, lane, stat, track, last: "" };
    });
    if (reducedMotion) {
      draw(st.best.seconds);
      clock.textContent = `frozen at ${stamp(st.best.seconds)}, when the fastest run finished`;
      return;
    }
    if (started) play();
    else {
      draw(0);
      clock.textContent = `${stamp(0)} · ${Math.round(speedup)}× playback`;
    }
  }
  if (!reducedMotion) {
    replay.addEventListener("click", play);
    onVisible($("[data-race]"), (visible) => visible && !started && st && play(), 0.45);
  }
  return { load };
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
  "linux-appimage-arm": { os: "linux", kind: "appimage", arch: "arm64", name: ".AppImage" },
  "linux-deb-arm": { os: "linux", kind: "deb", arch: "arm64", name: ".deb" },
  "linux-rpm-arm": { os: "linux", kind: "rpm", arch: "arm64", name: ".rpm" },
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

// tauri-action names: Byterush_0.2.0_x64-setup.exe, Byterush_0.2.0_aarch64.dmg, Byterush_0.2.0_arm64.deb,
// Byterush-0.2.0-1.x86_64.rpm, Byterush-0.2.0-1.aarch64.rpm …
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
  const files = json.assets
    .map((a) => ({ name: String(a?.name || ""), url: String(a?.browser_download_url || ""), size: Number(a?.size) || 0 }))
    .filter((a) => a.url.startsWith("https://"));
  const assets = files.map((a) => ({ ...a, ...classify(a.name) })).filter((a) => a.kind);
  const url = String(json.html_url || "");
  return {
    tag: String(json.tag_name || ""),
    url: url.startsWith("https://") ? url : LINKS.releases,
    published: json.published_at || null,
    assets,
    checksums: files.find((a) => /^sha256sums(\.txt)?$/i.test(a.name)) || null,
    extension: files.find((a) => /^byterush-extension-.*\.zip$/i.test(a.name)) || null,
  };
}

async function latestRelease() {
  const KEY = "byterush.release.v2";
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
    return d.arch === "arm64" ? order.map((id) => `${id}-arm`) : order;
  }
  return null;
}

// the asset for a build: Linux and macOS builds name their arch; on Windows on ARM an arm64 file wins
// when a release has one, otherwise the x64 build runs through emulation
function assetFor(id, release, d) {
  const b = BUILDS[id];
  if (d && d.os === "windows" && b.os === "windows" && d.arch === "arm64") {
    const arm = findAsset(release, b.kind, "arm64");
    if (arm) return { asset: arm, arch: "arm64" };
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
    a.title = asset ? `${asset.name} · ${fmtBytes(asset.size)}` : "Open the latest release on GitHub";
    const size = $("[data-size]", a);
    if (size) size.textContent = asset ? fmtBytes(asset.size) : "";
    a.classList.toggle("is-pick", !!order && order[0] === id);
  });
  $("[data-mobile-note]").hidden = !d.mobile;
  $$("[data-checksums]").forEach((a) => (a.href = release?.checksums?.url || fallback));
  $$("[data-ext-zip]").forEach((a) => {
    a.href = release?.extension?.url || fallback;
    const size = $("[data-size]", a);
    if (size) size.textContent = release?.extension ? fmtBytes(release.extension.size) : "";
  });
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
  else archTag.textContent = `${b.arch === "arm64" ? "ARM64" : "x64"} · ${b.name}`;

  // a release published before the arm64 Linux builds existed has none: say so instead of guessing
  const noArm = d.os === "linux" && b.arch === "arm64" && release && !pick.asset;
  hero.href = pick.asset ? pick.asset.url : fallback;
  hero.title = pick.asset ? pick.asset.name : "";
  const bits = [release ? release.tag : "Free and open source"];
  if (pick.asset) bits.push(fmtBytes(pick.asset.size));
  bits.push(REQUIRES[d.os]);
  meta.textContent = bits.join(" · ");

  const parts = [];
  if (noArm) {
    parts.push(`Release ${release.tag} has no ARM build for Linux. Newer releases do; see `, link("all releases", LINKS.allReleases), ".");
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

/* ---------- screenshots: light and dark ---------- */

{
  const buttons = $$("[data-shot]");
  const images = $$("[data-shot-img]");
  const show = (mode) => {
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.shot === mode)));
    images.forEach((img) => (img.hidden = img.dataset.shotImg !== mode));
  };
  buttons.forEach((b) => b.addEventListener("click", () => show(b.dataset.shot)));
  $("[data-shot-seg]").hidden = false;
  show(window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
}

// illustrations only move while they are on screen
$$(".tile, .hero").forEach((node) => onVisible(node, (visible) => node.classList.toggle("off", !visible), 0));

/* ---------- video: nothing is downloaded until someone presses play ---------- */

{
  const video = $("[data-player-video]");
  const play = $("[data-player-play]");
  const msg = $("[data-player-msg]");
  const fail = () => (msg.hidden = false);
  video.addEventListener("error", fail);
  video.querySelectorAll("source").forEach((s) => s.addEventListener("error", fail));
  play.hidden = false;
  video.controls = false;
  play.addEventListener("click", () => {
    play.hidden = true;
    video.controls = true;
    video.play().catch(() => {});
    video.focus();
  });
  video.addEventListener("play", () => {
    play.hidden = true;
    video.controls = true;
  });

  // the races: assets/video/<name>.{mp4,webm,jpg}
  const DEMOS = {
    demo: "Chrome alone against Chrome with Byterush, downloading the same 961 MB file",
    "demo-10gb-helsinki": "Chrome alone against Chrome with Byterush, downloading the same 10.7 GB file from Helsinki",
    "demo-10gb-falkenstein": "Chrome alone against Chrome with Byterush, downloading the same 10.7 GB file from Falkenstein",
  };
  const picks = $$("[data-demo]");
  const choose = (name) => {
    picks.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.demo === name)));
    if (video.dataset.demo === name) return;
    video.dataset.demo = name;
    video.pause();
    video.poster = `assets/video/${name}.jpg`;
    video.setAttribute("aria-label", DEMOS[name]);
    const [mp4, webm] = video.querySelectorAll("source");
    mp4.src = `assets/video/${name}.mp4`;
    webm.src = `assets/video/${name}.webm`;
    msg.hidden = true;
    video.controls = false;
    play.hidden = false;
    video.load(); // preload="none": nothing is fetched until play
  };
  picks.forEach((b) => b.addEventListener("click", () => choose(b.dataset.demo)));
  video.dataset.demo = "demo";
  $("[data-demo-seg]").hidden = false;
}
