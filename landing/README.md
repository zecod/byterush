# Byterush landing page

A plain static site: no build step. Open `index.html` directly, or through any static server such as `npx serve landing` from the repository root.

Pushing to `main` publishes it to GitHub Pages through `.github/workflows/pages.yml`.

- Layout follows opencode.ai's: one bordered 1080 px column, IBM Plex Mono, black and white with the brand's pale lime for a few highlights, light and dark from the system setting.
- IBM Plex Mono is served from `assets/fonts/`. The only request to another site is the GitHub API call for the latest release; there are no analytics or CDNs.
- Sections: hero, the app window (Fig 1), speed comparison (Fig 2), features, how the split works (Fig 3), browser extension (Fig 4), comparison with a browser download, downloads per platform, FAQ.

## Speed numbers

`BENCH` at the top of `main.js` holds the measurement: `file`, `size_mb`, `server`, `date` and `runs` (`label`, `connections`, `seconds`; the run with `connections: 1` is the browser baseline), plus optional `line` and `note`. Every speed claim on the page (the "N× faster" chip, the stat tiles, the race, the results table, the methodology footnote and the FAQ answer) is computed from it. While any value contains `PLACEHOLDER`, the page labels the figures as sample numbers.

## Download buttons

`main.js` guesses the visitor's system from `navigator.userAgentData` (with client hints for the architecture in Chromium browsers) or the user agent, then reads `https://api.github.com/repos/zecod/byterush/releases/latest` and points the hero button and the platform cards straight at the matching installer (`_x64-setup.exe`, `_x64_en-US.msi`, `_aarch64.dmg`, `_x64.dmg`, `_amd64.AppImage`, `_amd64.deb`, `.x86_64.rpm`). Updater files (`.sig`, `.tar.gz`, `.zip`) are skipped. The answer is cached in `sessionStorage`.

Without JavaScript, with no published release, or when the API is unreachable or rate-limited, every download link opens the latest release page on GitHub. Phones and tablets get a plain "Download" button that scrolls to the platform list. Other links are set in `LINKS` at the top of `main.js`.
