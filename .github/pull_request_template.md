## What and why

<!-- What does this change, and why? Link the issue it addresses, e.g. "Fixes #123". -->

## How it was tested

<!-- Tests added or run, platforms and browsers tried, sites downloaded from. -->

## Checklist

- [ ] `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` pass (in `src-tauri/`)
- [ ] `npx tsc --noEmit` passes, if `src/` changed
- [ ] `node scripts/extension-e2e.mjs` passes, if `extension/` or `bridge.rs` changed
- [ ] User-visible changes are described under `## [Unreleased]` in `CHANGELOG.md`
- [ ] The version is unchanged (it's bumped at release time)
- [ ] Screenshots or a recording are attached for UI changes
