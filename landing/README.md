# Byterush landing page

A plain static site: no build step. Open `index.html` through any static server, for example `npx serve landing` from the repository root (opened straight from disk, browsers block the CSS-masked footer icon).

Pushing to `main` publishes it to GitHub Pages through `.github/workflows/pages.yml`.

- `assets/app.png` is the hero screenshot; `assets/extension-popup.png` the extension figure. The page shows placeholders if either is missing.
- IBM Plex Mono is served from `assets/fonts/`, so the page makes no external requests.
- External links are set in the `URLS` object at the top of `main.js`. The download buttons open the latest GitHub release, where visitors choose the build for their platform.
