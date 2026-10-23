// End-to-end test of the browser extension: a real Chromium with the unpacked extension, the real
// bridge and engine, and a local site. Chromium is driven over plain CDP so nothing interferes with
// its downloads: they take the same path as in everyday use.
//
// usage: CHROME=/path/to/chrome node scripts/extension-e2e.mjs [extension_dir]
// Needs Node 22+ and a Chromium-based browser that still loads unpacked extensions from the
// command line (Chromium, Chrome for Testing).
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const extDir = path.resolve(process.argv[2] ?? path.join(root, "extension"));
const chrome = process.env.CHROME;
if (!chrome) throw new Error("set CHROME to a Chromium binary");
const SITE_PORT = 47811;
const CDP_PORT = 9333;

execFileSync("cargo", ["build", "--quiet", "--example", "bridge_harness", "--manifest-path", path.join(root, "src-tauri/Cargo.toml")], { stdio: "inherit" });
const harnessBin = path.join(root, "src-tauri/target/debug/examples/bridge_harness");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "byterush-e2e-"));
const site = path.join(work, "site");
const out = path.join(work, "app");
const chromeDir = path.join(work, "chrome-downloads");
fs.mkdirSync(site, { recursive: true });
const files = {
  "plain.bin": crypto.randomBytes(3 * 1024 * 1024),
  "notes.txt": Buffer.from("byterush end-to-end test line, compressible text\n".repeat(45000)),
  "late.bin": crypto.randomBytes(1024 * 1024),
  "late2.bin": crypto.randomBytes(1024 * 1024),
};
for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(site, name), bytes);
fs.writeFileSync(path.join(site, "notes.txt.gz"), zlib.gzipSync(files["notes.txt"]));
fs.writeFileSync(
  path.join(site, "page.html"),
  Object.keys(files)
    .map((n) => `<a id="${n.split(".")[0]}" href="/${n.endsWith(".txt") ? "gz" : "f"}/${n}" download>${n}</a>`)
    .join("\n"),
);

const children = [];
process.on("exit", () => children.forEach((c) => c.kill("SIGKILL")));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (args, ready) =>
  new Promise((resolve) => {
    const child = spawn(harnessBin, args, { stdio: ["ignore", "pipe", "inherit"] });
    children.push(child);
    child.stdout.on("data", (d) => {
      for (const line of d.toString().split("\n")) {
        if (line.startsWith("READY")) resolve(child);
        if (line.startsWith("CAPTURED")) ready?.(line);
      }
    });
  });

let handOvers = 0;
await run(["site", site, String(SITE_PORT)]);
let app = await run(["app", out], () => handOvers++);

fs.mkdirSync(path.join(work, "profile", "Default"), { recursive: true });
fs.writeFileSync(
  path.join(work, "profile", "Default", "Preferences"),
  JSON.stringify({ download: { default_directory: chromeDir, prompt_for_download: false } }),
);
children.push(
  spawn(chrome, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${path.join(work, "profile")}`,
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    "--no-first-run",
    "--no-sandbox",
    "about:blank",
  ], { stdio: "ignore" }),
);
let version = null;
for (let i = 0; i < 100 && !version; i++) {
  await sleep(100);
  version = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.json()).catch(() => null);
}
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  pending.get(msg.id)?.(msg.result);
  pending.delete(msg.id);
});
const cdp = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    pending.set(++seq, resolve);
    ws.send(JSON.stringify({ id: seq, method, params, sessionId }));
  });
await sleep(1500); // the extension's service worker starts
const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });

const click = async (id) => {
  await cdp("Page.navigate", { url: `http://127.0.0.1:${SITE_PORT}/page.html` }, sessionId);
  await sleep(400);
  await cdp("Runtime.evaluate", { expression: `document.getElementById(${JSON.stringify(id)}).click()` }, sessionId);
};
const inApp = async (name, ms = 10000) => {
  for (let t = 0; t < ms; t += 100) {
    const p = path.join(out, name);
    if (fs.existsSync(p) && fs.readFileSync(p).equals(files[name])) return true;
    await sleep(100);
  }
  return false;
};
const inChrome = (name) => fs.existsSync(path.join(chromeDir, name));

const checks = [];
const check = (what, ok) => {
  checks.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};

await click("plain");
check("a download is taken over", await inApp("plain.bin"));
await sleep(500);
check("…and Chrome's copy is dropped", !inChrome("plain.bin"));

await click("notes");
check("a gzip-compressed transfer is taken over", await inApp("notes.txt"));

// the app goes away: Chrome keeps the download. Wait out the extension's memory of the app being up
app.kill("SIGKILL");
await sleep(10500);
await click("late");
await sleep(2500);
check("with the app closed Chrome keeps the download", inChrome("late.bin"));

// the app starts again: the very next download is caught
app = await run(["app", out], () => handOvers++);
await click("late2");
check("the first download after the app starts is taken over", await inApp("late2.bin"));

const passed = checks.every(Boolean);
console.log(`${handOvers} hand-overs${passed ? "" : `, files kept in ${work}`}`);
for (const c of children) c.kill("SIGKILL");
if (passed) fs.rmSync(work, { recursive: true, force: true });
process.exit(passed ? 0 : 1);
