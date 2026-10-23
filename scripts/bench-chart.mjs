// Draws docs/benchmarks.json as horizontal bar charts for the README, one SVG per GitHub theme.
// usage: node scripts/bench-chart.mjs   (writes docs/media/benchmark-light.svg and -dark.svg)
//
// Colors were validated with the dataviz palette checks (lightness band, chroma, colorblind
// separation, contrast) on white and on GitHub's dark surface.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "docs/benchmarks.json"), "utf8"));

const THEMES = {
  light: { surface: "#ffffff", text: "#1f2328", muted: "#59636e", grid: "#d1d9e0", browser: "#3d7cc9", byterush: "#7d8710" },
  dark: { surface: "#0d1117", text: "#f0f6fc", muted: "#9198a1", grid: "#3d444d", browser: "#4f8fdc", byterush: "#949d18" },
};

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const time = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s` : `${s.toFixed(1)} s`);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const cutNote = (runs) => {
  const cut = runs.find((r) => r.connections === 1)?.incomplete;
  return cut ? ` · one connection was reset by the server at ${Math.round(cut * 100)}%, so its time is a lower bound` : "";
};

function chart(theme) {
  const t = THEMES[theme];
  const W = 900;
  const pad = 16;
  const left = 246;
  const right = 226;
  const barH = 20;
  const rowH = 34;
  const panelGap = 34;
  const font = `font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"`;
  let y = 72;
  const parts = [];
  // legend (two series: always present, and every bar is labelled too)
  parts.push(
    `<rect x="${left}" y="22" width="14" height="14" rx="3" fill="${t.browser}"/>`,
    `<text x="${left + 22}" y="34" ${font} font-size="13" fill="${t.text}">one connection (how browsers download)</text>`,
    `<rect x="${left + 360}" y="22" width="14" height="14" rx="3" fill="${t.byterush}"/>`,
    `<text x="${left + 382}" y="34" ${font} font-size="13" fill="${t.text}">Byterush</text>`,
  );
  for (const f of data.files) {
    const runs = f.runs.map((r) => ({ ...r, s: avg(r.seconds) }));
    const base = runs.find((r) => r.connections === 1).s;
    const max = Math.max(...runs.map((r) => r.s));
    const scale = (W - left - right) / max;
    parts.push(
      `<text x="${pad}" y="${y + 4}" ${font} font-size="15" font-weight="700" fill="${t.text}">${esc(f.title)} · ${esc(f.server)}</text>`,
      `<text x="${pad}" y="${y + 24}" ${font} font-size="12" fill="${t.muted}">${esc(f.file)}${cutNote(runs)}</text>`,
    );
    const top = y + 40;
    // recessive grid: the baseline only
    parts.push(`<line x1="${left}" y1="${top - 6}" x2="${left}" y2="${top + runs.length * rowH - 8}" stroke="${t.grid}" stroke-width="1"/>`);
    runs.forEach((r, i) => {
      const by = top + i * rowH;
      const w = Math.max(3, r.s * scale);
      const color = r.connections === 1 ? t.browser : t.byterush;
      const label = r.connections === 1 ? "1 connection" : `Byterush · ${r.connections}`;
      // a baseline that never finished (the server reset it) only gives a lower bound
      const cut = runs.find((x) => x.connections === 1).incomplete;
      const speedup = r.connections === 1 ? (cut ? "" : "baseline") : `${cut ? "≥ " : ""}${(base / r.s).toFixed(1)}× faster`;
      // 4px rounded data end, square at the baseline
      parts.push(
        `<text x="${left - 12}" y="${by + 15}" text-anchor="end" ${font} font-size="13" fill="${t.text}">${label}</text>`,
        `<path d="M${left} ${by} h${w - 4} a4 4 0 0 1 4 4 v${barH - 8} a4 4 0 0 1 -4 4 h${-(w - 4)} z" fill="${color}"><title>${label}: ${time(r.s)} (${(f.bytes / 1e6 / r.s).toFixed(1)} MB/s)</title></path>`,
        `<text x="${left + w + 10}" y="${by + 15}" ${font} font-size="13" fill="${t.text}">${r.incomplete ? "> " : ""}${time(r.s)}</text>`,
        `<text x="${W - pad}" y="${by + 15}" text-anchor="end" ${font} font-size="13" font-weight="${r.connections === 1 ? 400 : 700}" fill="${r.connections === 1 ? t.muted : t.text}">${speedup}</text>`,
      );
    });
    y = top + runs.length * rowH + panelGap;
  }
  parts.push(`<text x="${pad}" y="${y}" ${font} font-size="11" fill="${t.muted}">Shorter is faster. Two runs per setting unless noted, ${esc(data.measured)}. Data: docs/benchmarks.json</text>`);
  const H = y + 12;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Download time, one connection against Byterush">
<rect width="${W}" height="${H}" fill="${t.surface}"/>
${parts.join("\n")}
</svg>
`;
}

for (const theme of Object.keys(THEMES)) {
  const out = path.join(root, `docs/media/benchmark-${theme}.svg`);
  fs.writeFileSync(out, chart(theme));
  console.log("wrote", path.relative(root, out));
}
