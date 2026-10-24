<p align="center">
  <img src="branding/icon.svg" width="96" height="96" alt="Byterush icon">
</p>

<h1 align="center">Byterush</h1>

<p align="center">
  <b>The free, open-source parallel download manager.</b><br>
  Up to 32 connections per file, downloads that survive crashes and expired links,<br>
  and it takes over the downloads your browser starts.
</p>

<p align="center">
  <a href="https://github.com/zecod/byterush/actions/workflows/ci.yml"><img src="https://github.com/zecod/byterush/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/zecod/byterush/releases/latest"><img src="https://img.shields.io/github/v/release/zecod/byterush?label=release&color=7d8710" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-3d7cc9" alt="Windows, macOS, Linux">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-59636e" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://zecod.github.io/byterush/"><b>Website</b></a> ·
  <a href="#download">Download</a> ·
  <a href="#benchmarks">Benchmarks</a> ·
  <a href="#browser-extension">Browser extension</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://zecod.github.io/byterush/#speed">
    <img src="docs/media/demo.gif" width="860" alt="A race replayed from a real recording: the same 961 MB file from archive.org over one connection, the way a browser downloads, and with Byterush over 32 connections. Byterush finishes in 14.2 seconds while one connection is at 16 percent; one connection takes 6 minutes 52 seconds, 29.1 times longer.">
  </a>
</p>

## Why Byterush

A browser downloads a file over **one** connection. Many servers, mirrors and CDNs cap how fast a single connection may go, and the further away a server is, the slower one TCP connection runs however fast your line is. Byterush asks for different byte ranges of the same file over many connections at once and writes each one straight into place, so together they use the bandwidth you pay for.

- **Much faster on real servers.** A 961 MB file from archive.org took **6 min 54 s** on one connection and **13.5 s** with Byterush: **30× faster**. A 3.6 GB file took **33 s**; one connection was still at 97% after 32 minutes when the server dropped it. [Benchmarks ↓](#benchmarks)
- **Nothing is lost.** Progress is synced to disk every few seconds; after a crash, a power cut or a reboot, downloads continue from where they were. An expired link? Start the download again in the browser and the same download carries on.
- **Your browser's downloads, caught.** The Chrome / Edge extension hands every download over with the browser's cookies, so sites that need a login or a bot check still work. If Byterush can't get the very same file, the browser simply keeps it.
- **Free and private.** MIT licensed, no account, no telemetry. The browser bridge only listens on `127.0.0.1`.

## Benchmarks

The same file, the same machine, the same evening: one connection (curl, which downloads the way a browser does) against Byterush with 8, 16 and 32 connections. Wall-clock time for the whole download, two runs per setting unless noted.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/benchmark-dark.svg">
  <img src="docs/media/benchmark-light.svg" width="860" alt="Bar chart of download times. 961 MB from archive.org: 6 min 54 s on one connection, 13.5 s with Byterush and 32 connections (30.7 times faster). 3.6 GB from archive.org: one connection reset by the server after 32 min 13 s at 97%, Byterush 32.7 s (at least 59 times faster). 62 MB from archive.org: 48.9 s against 6.0 s (8.2 times). 1 GB from Hetzner: 28.9 s against 6.0 s with 16 connections (4.8 times).">
</picture>

| File | Server | 1 connection | Byterush 8 | Byterush 16 | Byterush 32 | Best |
|---|---|---:|---:|---:|---:|---:|
| 961 MB video | archive.org | 6 min 54 s | 28.4 s | 22.8 s | **13.5 s** | **30.7×** |
| 3.6 GB archive¹ | archive.org | > 32 min 13 s | — | — | **32.7 s** | **≥ 59×** |
| 62 MB video | archive.org | 48.9 s | 10.6 s | 8.6 s | **6.0 s** | **8.2×** |
| 1 GB test file¹ | Hetzner Nuremberg | 28.9 s | — | **6.0 s** | 6.5 s | **4.8×** |

¹ One run per setting. The 3.6 GB file's single connection never finished: the server reset it after 32 min 13 s with 97% received, so that time and the speed-up are lower bounds.

**What to expect.** The gain is largest where a server limits each connection (archive.org, many mirrors and file hosts) or sits far away. A server that doesn't limit connections still gains on big files (4.8× above), while small files gain less because the per-request round trips weigh more: 100 MB files from Hetzner gained 1.4–1.5×. When one connection already fills your line (a fast CDN next door), nothing can beat your own bandwidth and times come out the same.

Raw numbers: [`docs/benchmarks.json`](docs/benchmarks.json). Reproduce: `scripts/bench.sh <url> [runs]`, then `node scripts/bench-chart.mjs` redraws the chart. Measured on a Linux VM in a datacenter on 23 Oct 2026; your numbers depend on the server, the distance and your line.

Many small files are fast too: 500 files of 48 KB finish in **0.36 s** with three downloads at a time (`examples/bench_many`, against a local server).

## Features

<table>
<tr><td width="50%" valign="top">

**Speed**
- Up to 32 connections per download (8 by default)
- Dynamic re-splitting: a connection that finishes takes over half of the largest range still in progress, so every connection stays busy until the last byte
- The first request doubles as the size check: no extra round trip per file
- Global speed cap, one click to toggle

**Never lose a download**
- Progress checkpoints: the partial file is synced before its progress is recorded
- Downloads that were running continue when the app starts again
- Resume verifies the file didn't change on the server (size, ETag, Last-Modified)
- Expired links continue from a fresh link; refused extra connections step aside

</td><td width="50%" valign="top">

**Browser takeover**
- Chrome and Edge (Manifest V3) extension catches every download
- Replays the browser's cookies, user-agent and referer
- Falls back to the browser when the app can't get the same file
- Right-click → *Download with Byterush*; per-site on/off

**Organized**
- Queue with a limit on simultaneous downloads, *download later*
- Sorted into Video / Music / Documents / Compressed / Programs
- Batch downloads (`https://site/img*.jpg` with a numeric range)
- Clipboard monitor, temporary folder on a fast drive, light & dark theme

</td></tr>
</table>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/app-dark.webp">
  <img src="docs/media/app-light.webp" width="860" alt="The Byterush window: the download list, a 1 GB file downloading at 105 MB/s over 16 connections, and its split into 16 ranges">
</picture>

## Download

Get the latest version from **[Releases](https://github.com/zecod/byterush/releases/latest)** or from the [website](https://zecod.github.io/byterush/#download), which picks the right file for your system.

| System | File |
|---|---|
| **Windows** 10 / 11 (x64) | `Byterush_<version>_x64-setup.exe` (installer) or `…_x64_en-US.msi` |
| **macOS** 11+ Apple Silicon | `Byterush_<version>_aarch64.dmg` |
| **macOS** 11+ Intel | `Byterush_<version>_x64.dmg` |
| **Linux** x64 and arm64 | `.AppImage` (any distribution), `.deb` (Debian, Ubuntu), `.rpm` (Fedora, openSUSE) |

Every release lists SHA-256 checksums in `SHA256SUMS.txt`. Until code signing is set up, macOS asks you to confirm the first launch (right-click the app → *Open*) and Windows SmartScreen shows *More info → Run anyway*.

## Browser extension

The extension in [`extension/`](extension) hands browser downloads to the app; it ships inside the app and as `byterush-extension-<version>.zip` on every release.

1. In Byterush, open **Settings → 03 · browser → open folder**.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and pick that folder.

How it decides: while Chrome is choosing the file name, the extension sends the download to the app together with the exact request headers Chrome used. The app opens its first connection and compares the answer with what the browser was getting (a web page instead of the file means a login or bot check; a different size means a different file). Only when it's the same file is Chrome's copy cancelled; otherwise Chrome carries on as if nothing happened. If you start a download again whose link had expired, the paused download in Byterush continues from the new link instead of starting over.

It needs these permissions: `downloads` (to see and hand over downloads), `webRequest` + `cookies` (to replay your session for the same URL), `contextMenus`, `storage`, and access to all sites (downloads can come from anywhere). It talks only to the app on `127.0.0.1:51723`, and the app accepts calls from this extension only.

## How it works

1. **One request to start.** The first request asks for the whole file as an open range. Its answer tells the size and whether ranges work, and it keeps streaming as the first segment.
2. **Split.** The file is divided across the connections and written into one preallocated (sparse) file. On exFAT/FAT32, which have no sparse files, each range gets its own part file, joined at the end.
3. **Re-split.** When a connection finishes, it takes over the second half of the largest range still in progress, if that saves more time than a new connection needs to get up to speed.
4. **Checkpoint.** Every 4 seconds the data is synced to disk, then that progress is recorded in `state.json` (written atomically, with a backup from the last good start).
5. **Finish.** The file is moved or rebuilt under a temporary name and renamed into place.

Resuming goes straight for the first missing range; if the server's answer shows a different file, the download starts over instead of mixing two versions.

```
src-tauri/src/engine/   download engine (no Tauri dependency, fully tested)
  segments.rs           splitting and re-splitting
  download.rs           first request, part files, connections, checkpoints, finishing
  mod.rs                queue, persistence, speed meter
src-tauri/src/lib.rs    Tauri commands, UI updates, clipboard watcher
src-tauri/src/bridge.rs local HTTP bridge for the extension (127.0.0.1:51723)
src/                    React interface
extension/              Chrome / Edge extension
landing/                website (GitHub Pages)
video/                  intro and demo videos (Remotion), driven by recorded downloads
scripts/                benchmark, chart, extension end-to-end test, release helpers
```

## FAQ

<details>
<summary><b>Why did a download stay in the browser?</b></summary>

The app couldn't get the same file the browser was getting: the site answered with a web page (a login or bot check), a different size, a form submission (POST), or the app wasn't running. The extension's popup lists recent hand-overs with the reason.
</details>

<details>
<summary><b>I get "403 Forbidden".</b></summary>

Usually the link expired or needs your browser's session. Start the download again in the browser: Byterush continues the same download from the fresh link. Byterush also retries hotlink-protected files with the site's own referer and lowers the connection count on servers that refuse extra connections.
</details>

<details>
<summary><b>Is it really faster for every download?</b></summary>

No: when one connection already fills your line, nothing is faster than your own bandwidth. The gain comes from servers that limit each connection and from distance; see [Benchmarks](#benchmarks).
</details>

<details>
<summary><b>Where are my settings and the download list?</b></summary>

`%APPDATA%\com.byterush.app` on Windows, `~/Library/Application Support/com.byterush.app` on macOS and `~/.local/share/com.byterush.app` on Linux.
</details>

<details>
<summary><b>Firefox?</b></summary>

Not yet: the extension is Chrome/Edge (Manifest V3). The app itself works with any browser through copy-paste or the clipboard monitor.
</details>

## Build from source

Prerequisites: [Rust](https://rustup.rs) (stable), Node.js 22, and per system:

- **Windows**: Visual Studio C++ Build Tools (MSVC)
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Linux** (Debian/Ubuntu): `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libxdo-dev build-essential`

```bash
npm install
npm run tauri dev                 # run the app
cd src-tauri && cargo test        # engine tests: crash and restart, file replaced on the server, connection caps, …
npm run tauri build               # installers in src-tauri/target/release/bundle
```

- `scripts/bench.sh <url> [runs]`: one connection against Byterush with 8, 16 and 32 connections.
- `CHROME=/path/to/chromium node scripts/extension-e2e.mjs`: the extension in a real Chromium against the real bridge and engine.
- `video/`: `npm ci && npm run dev` to edit the videos, `npm run publish` to render them for the site and this README. They replay downloads recorded with `cargo run --release --example record`; see [video/README.md](video/README.md).

Releases are built by GitHub Actions for every platform when a `v*` tag is pushed: see [`docs/RELEASING.md`](docs/RELEASING.md).

## Contributing

Bug reports, ideas and pull requests are welcome: start with [`CONTRIBUTING.md`](CONTRIBUTING.md). Security issues: please report them privately as described in [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE) © Alterbit and the Byterush contributors. Interface font: IBM Plex Mono (SIL Open Font License). Icons: [Hugeicons](https://hugeicons.com) free set. The videos in `video/` are made with [Remotion](https://www.remotion.dev), which has its own license for companies.
