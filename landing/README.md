# Byterush landing page

A plain static site: no build step. Open `index.html` directly, or through any static server such as `npx serve landing` from the repository root.

Pushing to `main` publishes it to GitHub Pages through `.github/workflows/pages.yml`.

- Layout follows opencode.ai's: one bordered 1080 px column, IBM Plex Mono, black and white with the brand's pale lime for a few highlights, light and dark from the system setting.
- IBM Plex Mono is served from `assets/fonts/`. The only request to another site is the GitHub API call for the latest release; there are no analytics or CDNs.
- Sections: hero (with speed lanes and the intro video), the app window (Fig 1), see it in action (demo video and light/dark screenshots), speed tests (Fig 2), features as illustrated tiles, how the split works (Fig 3), browser extension (Fig 4), comparison with a browser download, downloads per platform, FAQ.
- The feature illustrations are inline SVG animated with CSS. They pause off screen and hold still under `prefers-reduced-motion`.

## Speed numbers

`BENCHES` at the top of `main.js` lists the test downloads, shown as tabs in that order. Each entry has `id`, `title`, `file`, `size_mb`, `server`, `date` and `runs` (`connections`, `seconds`, optional `label`; the run with `connections: 1` is the browser baseline), plus optional `line` and `note`. Every speed claim on the page is computed from it; the hero chip and the FAQ answer use the first entry. While an entry contains `PLACEHOLDER`, its figures are labelled as sample numbers.

## Media

These files are referenced by the page:

- `assets/video/intro.{mp4,webm}` and its poster `assets/video/intro.jpg`: the intro, opened from the hero in a modal player.
- `assets/video/demo.{mp4,webm}` and its poster `assets/video/demo.jpg`: the product demo, played inline.
- `assets/screens/app-dark.webp` and `assets/screens/app-light.webp`: the app window, 2480×1560.

The videos are made in [`../video`](../video/README.md); `npm run publish` there renders them and writes these files. They are 1920×1080 H.264 MP4, with VP9 WebM for browsers without H.264 (some open-source Chromium builds). No video bytes load until someone presses play; if a file is missing the player says so.

## Download buttons

`main.js` guesses the visitor's system from `navigator.userAgentData` (with client hints for the architecture in Chromium browsers) or the user agent, then reads `https://api.github.com/repos/zecod/byterush/releases/latest` and points the hero button and the platform cards straight at the matching file: `_x64-setup.exe`, `_x64_en-US.msi`, `_aarch64.dmg`, `_x64.dmg`, and for Linux `_amd64.AppImage`, `_amd64.deb`, `.x86_64.rpm` or, on ARM, `_aarch64.AppImage`, `_arm64.deb`, `.aarch64.rpm`. Windows on ARM gets the x64 build. Updater files (`.sig`, `.tar.gz`, `.zip`) are skipped; `SHA256SUMS.txt` and `byterush-extension-<version>.zip` are linked from the downloads and extension sections. The answer is cached in `sessionStorage`.

Without JavaScript, with no published release, or when the API is unreachable or rate-limited, every download link opens the latest release page on GitHub. Phones and tablets get a plain "Download" button that scrolls to the platform list. Other links are set in `LINKS` at the top of `main.js`.
