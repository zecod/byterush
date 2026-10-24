# Contributing to Byterush

Thanks for helping. Bug reports, fixes, features and documentation are all welcome. For anything
bigger than a small fix, open an issue first so we can agree on the approach before you spend
time on it. Security problems go through [private reporting](SECURITY.md), not public issues.

By contributing you agree that your work is released under the [MIT license](LICENSE), and to
follow the [code of conduct](CODE_OF_CONDUCT.md).

## How it fits together

```
 browser ── extension/ ──HTTP 127.0.0.1:51723──> bridge.rs ─┐
                                                            ├──> engine/ ──> servers, disk
 src/ (React UI) <──Tauri commands + events──> lib.rs ──────┘
```

- **Engine** – `src-tauri/src/engine/`, plain Rust with no Tauri dependency, so it is tested on
  its own. `Manager` (`mod.rs`) owns the queue, persistence (`state.json`, checkpointed only after
  the part file is synced) and speed metering; `download.rs` does the probe, the part file and the
  per-connection workers; `segments.rs` splits ranges and lets a finished connection take over half
  of the largest remaining one; `limiter.rs` is the global speed cap; `naming.rs` picks file names.
- **App shell** – `src-tauri/src/lib.rs` exposes the engine to the UI as Tauri commands, pushes
  changed rows to the UI as events, watches the clipboard and keeps the app single-instance.
- **Bridge** – `src-tauri/src/bridge.rs` is a small HTTP server on `127.0.0.1:51723` that accepts
  hand-overs from the extension only (see [SECURITY.md](SECURITY.md)).
- **Extension** – `extension/` (Chrome/Edge, Manifest V3). It decides while Chrome is choosing the
  file name: it sends the URL and the exact request headers Chrome used to the bridge, the app opens
  its first connection, and Chrome's copy is cancelled only if the app got the same file. Otherwise
  Chrome carries on as if the extension weren't there.
- **UI** – `src/`, React + Vite with a virtualized download list.
- **Landing page** – `landing/`, static, deployed to GitHub Pages by `.github/workflows/pages.yml`.

## Setting up

You need [Rust](https://rustup.rs) (stable), [Node.js](https://nodejs.org) 22 or newer, and the
system libraries Tauri needs:

- **Windows 10/11**: the Rust MSVC toolchain and the
  [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  ("Desktop development with C++"). WebView2 ships with Windows.
- **macOS 11+**: Xcode Command Line Tools: `xcode-select --install`.
- **Debian / Ubuntu**:
  ```bash
  sudo apt install build-essential libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libxdo-dev
  ```
- **Fedora**:
  ```bash
  sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel libxdo-devel
  sudo dnf group install c-development
  ```
- Other distributions: see [Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/).

Then:

```bash
git clone https://github.com/zecod/byterush.git
cd byterush
npm install
npm run tauri dev
```

## Checks

CI (`.github/workflows/ci.yml`) runs all of these on every push and pull request; run the ones your
change touches before you push.

```bash
# engine and app (from src-tauri/)
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test

# UI
npx tsc --noEmit
npx vite build

# extension and landing page
for f in extension/*.js landing/*.js; do node --check "$f"; done

# videos (from video/, after npm ci)
npm run lint

# versions agree across package.json, Cargo.toml, tauri.conf.json, manifest.json and the lockfiles
npm run version:check
```

The Rust tests start local HTTP servers and exercise real downloads: pause and resume, crashes,
servers that change the file, hotlink protection, connection caps, the browser bridge.

### Extension end-to-end test

`scripts/extension-e2e.mjs` loads the unpacked extension in a real Chromium, clicks download links
on a local site and checks that the real bridge and engine take them over (and that Chrome keeps
the download when the app is closed). It needs a Chromium that still accepts `--load-extension`:
Chromium or Chrome for Testing, not regular Chrome.

```bash
npx @puppeteer/browsers install chrome@stable    # prints the path of a Chrome for Testing binary
CHROME=/path/to/chrome node scripts/extension-e2e.mjs
```

It uses ports 51723 (bridge), 47811 (test site) and 9333 (DevTools), so close a running Byterush
first.

### Benchmark

`scripts/bench.sh <url> [runs]` downloads a file with curl (one connection, like a browser) and
with Byterush using 1, 8 and 16 connections, and prints the times. `cargo run --release --example
bench_many -- 500 3` measures many small files against a local server.

`scripts/bench-local.sh [out_dir] [size_mb] [connections…]` takes the network out: it serves a
random file from tmpfs with the `serve` example (range requests, streamed) and compares the engine
with curl fetching the same number of ranges in parallel, printing wall time and CPU time. Pass a
tmpfs path such as `/dev/shm` as `out_dir` to take the disk out too; then what is left is the
engine itself.

## Code style

- **Rust**: run `cargo fmt` (the project's `rustfmt.toml` keeps lines up to 140 columns) and keep
  `cargo clippy --all-targets -- -D warnings` passing; CI checks both. The engine stays free of
  Tauri types.
- **TypeScript / JavaScript**: `tsc` in strict mode must pass. The extension is plain JavaScript
  modules with no build step and no dependencies; keep it that way.
- **Comments** say why, not what. Name the server behavior or browser quirk a workaround exists for.
- **Tests**: a bug fix comes with a test that fails without it when that's practical. Engine tests
  live in `src-tauri/tests/` and use local servers, never the internet.
- **Commits**: a short summary line in the imperative ("Resume from the first missing range"),
  then a body that explains why.

## Pull requests

Before you open one, check that:

- [ ] `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` pass
- [ ] `npx tsc --noEmit` passes, if you touched `src/`
- [ ] the extension end-to-end test passes, if you touched `extension/` or `bridge.rs`
- [ ] user-visible changes are described under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md)
- [ ] the version is unchanged (it's bumped when releasing, see [docs/RELEASING.md](docs/RELEASING.md))
- [ ] UI changes come with a screenshot or a short recording
