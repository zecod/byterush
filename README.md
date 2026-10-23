# Byterush

A fast segmented download manager for Windows, macOS and Linux, built with Rust (Tauri 2) and React.

## Features

- **Parallel connections** – files are split into ranges (HTTP `Range`) downloaded over separate
  TCP connections and written straight into a preallocated file.
- **Dynamic segmentation** – when a connection finishes, it takes over half of the largest range
  still in progress, so all connections stay busy until the end.
- **Pause / resume** – progress per range is persisted to `state.json`; resuming continues where
  each range stopped. Servers without range support fall back to a single connection.
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

## Browser extension

`extension/` is a Chrome/Edge (Manifest V3) extension that hands browser downloads to the app.

- **Catches everything**: it listens to `chrome.downloads`, so link clicks, scripts, redirects and
  `Content-Disposition` downloads are all seen.
- **Protected sites**: it records the exact request headers Chrome sent (cookies such as
  `cf_clearance`, user-agent, referer) and the app replays them, so sites behind Cloudflare-style
  checks see the same verified session.
- **Never loses a download**: Chrome's copy is paused while the app opens its first connection.
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
cd src-tauri && cargo test   # engine tests (local HTTP server, pause/resume, integrity)
npm run tauri build      # installer in src-tauri/target/release/bundle
```

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
