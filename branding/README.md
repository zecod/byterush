# Byterush branding

**Name:** Byterush — bytes + rush, i.e. download speed. Chosen after checking npm (free), GitHub
(no download-manager projects) and the web (no same-name software). See `names.md` for the first
shortlist Codex produced; "Velto" was dropped because an existing segmented download manager is
called *Velox*.

**Mark:** three parallel download lanes rising like a speed meter, merging into a download arrow.
The lime cap on the middle lane is the leading, active segment. Shapes are on a 64-unit grid with
no lane touching the arrowhead; `icon-16.svg` is a separately pixel-fitted version for 16–32 px.

## Files

- `icon.svg` — app icon, dark tile (source for all app/extension icons)
- `icon-light.svg` — light tile variant
- `icon-16.svg` — pixel-fitted small-size icon (16/32 px, tray, extension toolbar)
- `mark.svg` — glyph only, `currentColor` (accent via `--mark-accent`)
- `icon-1024.png` — rendered source for `npx tauri icon branding/icon-1024.png`
- `codex-original/` — Codex's first concept the mark was refined from

## Palette

| role | value |
| --- | --- |
| dark tile | `#141111` (hsl 0 9% 7%) |
| light glyph | `#f1ecec` (hsl 0 15% 94%) |
| lime accent | `#f6fa89` (hsl 62 92% 76%) |
| light tile | `#fcfbfb` |
| dark glyph | `#201d1d` |
| lime on light | `#c9d22e` |
