# Byterush

A fast segmented download manager for Windows, macOS and Linux, built with Rust (Tauri 2) and React.

## Features

- **Parallel connections** – files are split into ranges (HTTP `Range`) downloaded over separate
  TCP connections and written straight into a preallocated file.
- **Dynamic segmentation** – when a connection finishes, it takes over half of the largest range
  still in progress, so all connections stay busy until the end.
- **Pause / resume that survives crashes** – every few seconds the partial file is synced to disk and
  only then is its progress recorded in `state.json`, so a crash or power cut costs at most a few
  seconds and never leaves the state claiming bytes the disk doesn't have. Downloads that were running
  continue on the next start, and quitting flushes everything first. A resume goes straight to the
  first missing range (no extra request); if the file changed on the server meanwhile (size, ETag or
  Last-Modified), the download starts over instead of mixing two versions. Servers without range
  support fall back to a single connection.
- **Expired links** – start the download again in the browser (or right-click → *update link…*) and
  the paused or failed download continues from where it stopped, after checking it's the same file.
- **Fewer 403s** – a 403 from hotlink protection is retried with the site's own Referer; servers that
  cap connections per client get fewer connections instead of retry storms; the Windows/macOS system
  proxy is used like the browser does. A link that answers with a web page (login, captcha, "your
  download will start") is reported instead of saved under the file's name.
- **Queue** – limit on simultaneous downloads; "Download later" parks items until resumed.
- **Speed limiter** – global token bucket, toggled from the toolbar.
- **Categories** – files are sorted into Video / Music / Documents / Compressed / Programs folders.
- **Batch download** – `https://site/img*.jpg` with a numeric range and zero padding.
- **Clipboard monitor** – copying a link to a downloadable file offers to download it.
- **Temporary folder** – partial files can live on another drive (e.g. a fast SSD); finished files
  are moved, with a copy fallback across drives.
- **Built for many files** – the first request doubles as the probe (no extra round trip), batches
  are queued in one call, the UI receives only changed rows and renders a virtualized list.
  `cargo run --release --example bench_many -- 500 3` downloads 500 files in ~2 s locally.
- Retries with backoff, duplicate-name handling, light/dark theme, segment map per download.
- One instance at a time: launching it again brings the open window forward (two copies would
  overwrite each other's state).

## Browser extension

`extension/` is a Chrome/Edge (Manifest V3) extension that hands browser downloads to the app.

- **Catches everything**: it listens to `chrome.downloads`, so link clicks, scripts, redirects and
  `Content-Disposition` downloads are all seen.
- **Protected sites**: it records the exact request headers Chrome sent (cookies such as
  `cf_clearance`, user-agent, referer) and the app replays them, so sites behind Cloudflare-style
  checks see the same verified session.
- **Never loses a download**: Chrome's copy is held while the app opens its first connection.
  Only if the server returns the same file (not a challenge page, not a different size) is Chrome's
  copy cancelled; otherwise Chrome continues as if nothing happened (one-time links, form posts,
  bot checks the app can't pass).
- Right-click → *Download with Byterush* on links and media; per-site on/off and recent hand-overs in
  the popup.

Install (development): open `chrome://extensions`, enable developer mode, *Load unpacked* →
`extension/`. The app listens on `127.0.0.1:51723` and only accepts calls carrying the extension's
id (`x-byterush-ext` header; a page can't add it without a CORS preflight, which is refused).

## Design

The interface follows the [opencode.ai](https://opencode.ai) aesthetic: IBM Plex Mono throughout,
warm neutral palette with a pale lime highlight, hairline borders, `[*]` markers and "Fig." labels.
Icons come from [Hugeicons](https://hugeicons.com) (free set).

## Development

```bash
npm install
npm run tauri dev        # run the app
cd src-tauri && cargo test   # engine tests (local HTTP server, pause/resume, crash, integrity)
npm run tauri build      # installer in src-tauri/target/release/bundle
```

- `scripts/bench.sh <url> [runs]` – one connection (curl, like a browser) against Byterush with 1, 8
  and 16 connections; the landing page's numbers come from it.
- `CHROME=/path/to/chromium node scripts/extension-e2e.mjs` – the extension in a real Chromium against
  the real bridge and engine: hand-over, Chrome's copy dropped, compressed transfers, app closed, and
  the first download right after the app starts.

### Platforms

Byterush builds for Windows, macOS (Apple Silicon and Intel) and Linux. The GitHub Actions workflow
in `.github/workflows/build.yml` runs the engine tests and produces installers on all three; pushing
a `v*` tag drafts a release with them.

Local prerequisites:

- **Windows**: Rust (MSVC toolchain) and Visual Studio C++ Build Tools.
- **macOS**: Rust and Xcode Command Line Tools (`xcode-select --install`).
- **Linux** (Debian/Ubuntu):
  `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libxdo-dev build-essential`

Data lives in the platform's app-data folder (`%APPDATA%\com.byterush.app`,
`~/Library/Application Support/com.byterush.app`, `~/.local/share/com.byterush.app`). Data from the
app's previous name (Fetchr, `com.fetchr.app`) is copied over on first launch.

## Layout

- `src-tauri/src/engine/` – download engine (no Tauri dependency)
  - `segments.rs` – range splitting and work stealing
  - `download.rs` – probe, part file, per-connection workers
  - `mod.rs` – queue, persistence, speed metering
- `src-tauri/src/lib.rs` – Tauri commands, progress events, clipboard watcher
- `src-tauri/src/bridge.rs` – local HTTP bridge for the browser extension
- `extension/` – Chrome/Edge extension
- `branding/` – logo (SVG sources) and naming notes
- `src/` – React UI
