# Byterush landing page

A plain static site: no build step. Open `index.html` directly, or through any static server such as `npx serve landing` from the repository root.

Pushing to `main` publishes it to GitHub Pages through `.github/workflows/pages.yml`.

- Layout follows opencode.ai's: one bordered 1080 px column, IBM Plex Mono, warm neutrals, light and dark from the system setting. The dark band animates a download's eight ranges in `main.js`.
- IBM Plex Mono is served from `assets/fonts/`, so the page makes no external requests.
- External links are set in `LINKS` at the top of `main.js`. The download buttons open the latest GitHub release, where visitors choose the build for their platform.
