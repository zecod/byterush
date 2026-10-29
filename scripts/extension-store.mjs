// Packages the browser extension for the Chrome Web Store.
//
// usage: node scripts/extension-store.mjs [out.zip]
//
// The store refuses a manifest that carries a "key": it signs the package with its own key and
// the published extension gets the store's id. So this zip is the extension folder without the
// "key" line; everything else is byte for byte what ships inside the app. The id pinned by the
// key is still what an unpacked copy of the folder gets, which is why both ids are accepted by
// the app's bridge (`EXTENSION_IDS` in src-tauri/src/bridge.rs).
//
// Zip entries use "/" and are stored in a fixed order with a fixed date, so the same source gives
// the same bytes. Needs Node 22.2+ (zlib.crc32).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const src = path.join(root, "extension");
const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
const out = path.resolve(process.argv[2] ?? path.join(root, "dist-extension", `byterush-extension-store-${manifest.version}.zip`));

/** Every file under `dir`, as "a/b/c.ext" names, sorted; dotfiles left out. */
function walk(dir, prefix = "") {
  const names = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix + entry.name;
    if (entry.isDirectory()) names.push(...walk(path.join(dir, entry.name), rel + "/"));
    else names.push(rel);
  }
  return names;
}

const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01
const DOS_TIME = 0;

const entries = [];
let offset = 0;
const parts = [];
for (const name of walk(src)) {
  let data = fs.readFileSync(path.join(src, name));
  if (name === "manifest.json") {
    const { key: _key, ...rest } = manifest;
    data = Buffer.from(JSON.stringify(rest, null, 2) + "\n");
  }
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const stored = deflated.length < data.length;
  const body = stored ? deflated : data;
  const nameBuf = Buffer.from(name, "utf8");
  const crc = zlib.crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // utf-8 names
  local.writeUInt16LE(stored ? 8 : 0, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  parts.push(local, nameBuf, body);
  entries.push({ nameBuf, crc, size: data.length, packed: body.length, method: stored ? 8 : 0, offset });
  offset += local.length + nameBuf.length + body.length;
}

const central = [];
let centralSize = 0;
for (const e of entries) {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(20, 4); // made by
  h.writeUInt16LE(20, 6); // needed
  h.writeUInt16LE(0x0800, 8);
  h.writeUInt16LE(e.method, 10);
  h.writeUInt16LE(DOS_TIME, 12);
  h.writeUInt16LE(DOS_DATE, 14);
  h.writeUInt32LE(e.crc, 16);
  h.writeUInt32LE(e.packed, 20);
  h.writeUInt32LE(e.size, 24);
  h.writeUInt16LE(e.nameBuf.length, 28);
  h.writeUInt16LE(0, 30); // extra
  h.writeUInt16LE(0, 32); // comment
  h.writeUInt16LE(0, 34); // disk
  h.writeUInt16LE(0, 36); // internal attrs
  h.writeUInt32LE(0, 38); // external attrs
  h.writeUInt32LE(e.offset, 42);
  central.push(h, e.nameBuf);
  centralSize += h.length + e.nameBuf.length;
}
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([...parts, ...central, end]));
console.log(`${out}\n${entries.length} files, ${(fs.statSync(out).size / 1024).toFixed(0)} KB, version ${manifest.version}, no "key"`);
for (const e of entries) console.log(`  ${e.nameBuf.toString()}`);
