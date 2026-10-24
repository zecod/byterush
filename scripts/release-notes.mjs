#!/usr/bin/env node
// Prints the CHANGELOG.md section of one version, without its heading: the body of
// "## [x.y.z] - date" up to the next "## " heading or the link definitions at the bottom.
// Exits 1 if the section is missing or empty. The release workflow uses it for the release notes.
//
// usage: node scripts/release-notes.mjs <x.y.z> [CHANGELOG.md]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [version, file = path.join(root, "CHANGELOG.md")] = process.argv.slice(2);
if (!version) {
  console.error("usage: node scripts/release-notes.mjs <x.y.z> [CHANGELOG.md]");
  process.exit(1);
}

const lines = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n");
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const heading = new RegExp(`^## \\[${escaped}\\](\\s|$)`);
const start = lines.findIndex((l) => heading.test(l));
if (start < 0) {
  console.error(`error: no "## [${version}]" section in ${path.relative(process.cwd(), file)}`);
  process.exit(1);
}
let end = start + 1;
while (end < lines.length && !/^## /.test(lines[end]) && !/^\[[^\]]+\]:\s*\S/.test(lines[end])) end++;
const body = lines.slice(start + 1, end).join("\n").trim();
if (!body) {
  console.error(`error: the "## [${version}]" section of the changelog is empty`);
  process.exit(1);
}
if (/unreleased/i.test(lines[start])) {
  const msg = `the changelog heading still says "${lines[start].slice(3)}": put the release date there`;
  console.error(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `warning: ${msg}`);
}
process.stdout.write(body + "\n");
