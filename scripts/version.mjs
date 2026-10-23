#!/usr/bin/env node
// Sets or checks the version everywhere it is written down. No dependencies.
//
//   node scripts/version.mjs 0.3.0              set every file to 0.3.0
//   node scripts/version.mjs --check            fail unless every file has the same version
//   node scripts/version.mjs --check 0.3.0      ...and that version is 0.3.0 (used by the release workflow)
//
// Files: package.json, package-lock.json (root entries), src-tauri/Cargo.toml ([package]),
// src-tauri/Cargo.lock (the byterush entry), src-tauri/tauri.conf.json, extension/manifest.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// x.y.z only: Chrome rejects pre-release suffixes in manifest.json and Windows Installer (.msi)
// allows at most 255.255.65535.
function validate(version) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!m) return `"${version}" is not a plain x.y.z version (no "v" prefix, no pre-release suffix)`;
  const [major, minor, patch] = m.slice(1).map(Number);
  if (major > 255 || minor > 255 || patch > 65535) return `"${version}" is too large for an .msi (max 255.255.65535)`;
  return null;
}

const json = (file) => ({
  file,
  read(text) {
    return { data: JSON.parse(text), indent: /^[ \t]+(?=")/m.exec(text)?.[0] ?? "  ", eol: text.endsWith("\n") ? "\n" : "" };
  },
  write(text, mutate) {
    const { data, indent, eol } = this.read(text);
    mutate(data);
    return JSON.stringify(data, null, indent) + eol;
  },
});

// The `version` key of a TOML table: [package] in Cargo.toml, the byterush [[package]] in Cargo.lock.
function tomlTable(text, isTable) {
  const lines = text.split("\n");
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const header = /^\s*\[\[?([^\]]+)\]\]?\s*(#.*)?$/.exec(lines[i]);
    if (header) {
      inTable = isTable(header[1].trim(), lines, i);
      continue;
    }
    const kv = /^(\s*version\s*=\s*")([^"]*)(".*)$/.exec(lines[i]);
    if (inTable && kv) return { lines, index: i, before: kv[1], value: kv[2], after: kv[3] };
  }
  return null;
}

const cargoToml = {
  file: "src-tauri/Cargo.toml",
  find: (text) => tomlTable(text, (name) => name === "package"),
};
const cargoLock = {
  file: "src-tauri/Cargo.lock",
  find: (text) =>
    tomlTable(text, (name, lines, i) => {
      if (name !== "package") return false;
      for (let j = i + 1; j < lines.length && !/^\s*\[/.test(lines[j]); j++) {
        const n = /^\s*name\s*=\s*"([^"]*)"/.exec(lines[j]);
        if (n) return n[1] === "byterush";
      }
      return false;
    }),
};

const places = [
  { ...json("package.json"), label: "package.json", get: (d) => d.version, set: (d, v) => void (d.version = v) },
  { ...json("package-lock.json"), label: "package-lock.json", get: (d) => d.version, set: (d, v) => void (d.version = v) },
  {
    ...json("package-lock.json"),
    label: 'package-lock.json packages[""]',
    get: (d) => d.packages?.[""]?.version,
    set: (d, v) => void (d.packages[""].version = v),
  },
  { ...cargoToml, label: "src-tauri/Cargo.toml" },
  { ...cargoLock, label: "src-tauri/Cargo.lock (byterush)" },
  { ...json("src-tauri/tauri.conf.json"), label: "src-tauri/tauri.conf.json", get: (d) => d.version, set: (d, v) => void (d.version = v) },
  { ...json("extension/manifest.json"), label: "extension/manifest.json", get: (d) => d.version, set: (d, v) => void (d.version = v) },
];

const readText = (file) => fs.readFileSync(path.join(root, file), "utf8");

function current(place, text) {
  if (place.find) return place.find(text)?.value;
  return place.get(place.read(text).data);
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
  console.log("usage: node scripts/version.mjs <x.y.z>\n       node scripts/version.mjs --check [x.y.z]");
  process.exit(args.length === 0 ? 1 : 0);
}

if (args[0] === "--check") {
  const expected = args[1];
  if (expected !== undefined && validate(expected)) fail(validate(expected));
  const found = places.map((p) => ({ label: p.label, version: current(p, readText(p.file)) }));
  const want = expected ?? found[0].version;
  const width = Math.max(...found.map((f) => f.label.length));
  let ok = true;
  for (const f of found) {
    const good = f.version === want;
    ok &&= good;
    console.log(`${good ? "ok  " : "FAIL"} ${f.label.padEnd(width)}  ${f.version ?? "(not found)"}`);
  }
  if (!ok) fail(`versions differ, expected ${want} everywhere. Fix with: node scripts/version.mjs ${want}`);
  const problem = validate(want);
  if (problem) fail(problem);
  console.log(`all files at ${want}`);
  process.exit(0);
}

const version = args[0];
const problem = validate(version);
if (problem) fail(problem);

// Compute every change first and write only if all of them apply.
const updated = new Map();
for (const place of places) {
  const text = updated.get(place.file) ?? readText(place.file);
  let next;
  if (place.find) {
    const hit = place.find(text);
    if (!hit) fail(`no version found in ${place.label}`);
    hit.lines[hit.index] = hit.before + version + hit.after;
    next = hit.lines.join("\n");
  } else {
    next = place.write(text, (d) => place.set(d, version));
  }
  updated.set(place.file, next);
}
for (const [file, text] of updated) {
  if (readText(file) !== text) {
    fs.writeFileSync(path.join(root, file), text);
    console.log(`updated ${file}`);
  } else {
    console.log(`unchanged ${file}`);
  }
}
console.log(`\nversion ${version}. Next: describe it under "## [${version}] - YYYY-MM-DD" in CHANGELOG.md (see docs/RELEASING.md).`);
