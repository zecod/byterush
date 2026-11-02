# Changelog

All notable changes to Byterush are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The app, the engine and the browser
extension share one version number.

The release workflow publishes the section of a version as its GitHub release notes, so write
entries for people who use Byterush, not for people who read the diff.

## [Unreleased]

### Added

- Byterush tells you when a new version is out and installs it in one click. A button in the
  top bar and a card at the top of the settings show the new version; "what's new" lists what
  changed in every release since yours. "Update" downloads it, checks that it is signed by
  Byterush, installs it and opens the new version. Downloads that were running pause for the
  restart and continue after it. Byterush looks a few seconds after it starts and every six
  hours, sending byterush.xyz only its version and the kind of system and install; turn that off
  under settings → behaviour. Coming from 0.3.2 or older, install this version once by hand.

## [0.3.2] - 2026-11-01

### Fixed

- The app accepts the extension installed from the Chrome Web Store. Version 0.3.1 only knew the
  copy loaded from the folder, so the store extension could not reach it.

### Changed

- The extension is called "Byterush: Download Up to 30× Faster".

## [0.3.1] - 2026-11-01

### Added

- The extension is on the Chrome Web Store. The app's setup guide, the website and the README
  send you there first; loading it from the folder stays as the way without the store.
  `node scripts/extension-store.mjs` makes the package to upload, and
  `docs/CHROME_WEB_STORE.md` holds the listing.
- A privacy page on the website, linked from the store listing: nothing leaves your computer.
- The details panel says how many connections the server is refusing ("· 2 refused by the
  server") when a server allows fewer connections than asked for.
- The setup guide finds the system's default browser and lists it first (macOS, Windows, Linux),
  and opens the extensions page or the store in the browser already running, in its last-used
  profile, in a new window.
- Settings shows where partial files are kept and how much room they take, and can delete
  leftovers.

### Changed

- macOS builds are for Apple Silicon only; Intel Macs can build from source.
- A new interface font: the app and the extension popup use Geist instead of IBM Plex Mono.
  Numbers keep a fixed width, so speeds and progress do not jitter as they change.
- Servers that cap connections per address (Hetzner's speed test, many file hosts): instead of
  hammering them with every connection at once, the refused connections take turns, one scout
  at a time with a growing pause, and the file is not split further while any of them waits.
  A 1 GB file from a server that allows two connections went from 117 s to 68 s.
- Smaller app: only the Latin files of the IBM Plex Mono font are bundled, and the download list
  only re-renders the rows that changed.
- macOS: the traffic lights sit centred in the top bar, never crowding the name on a narrow
  window, and take no room in full screen.

### Fixed

- The website moved to https://byterush.xyz. The popup's "setup guide" link opens it, and its
  setup page can check that the extension is installed; both pointed at the old address, which is
  no longer online.
- The hidden "New download" window kept asking the engine about its download every second, for
  as long as the app ran, after the download had been answered.
- On a FAT or exFAT drive, a download over a single connection first wrote the whole file as
  zeros before the first byte arrived. The file now just grows there; NTFS is unchanged.
- An absurd number typed into the speed limit no longer overflows into "no limit" (or a crash).
- The clipboard watcher reads the clipboard only when its contents changed and the setting is on,
  and the progress loop sleeps while nothing is downloading.
- Removing an unfinished download always deletes its partial data; it was left on disk unless
  *delete files* was ticked.

## [0.3.0] - 2026-10-25

### Added

- A "New download" window for downloads the browser hands over, like IDM's: the file's name and
  size, the folder it goes to (with a folder picker), the room left on that drive and the number
  of connections, then *start download*, *later* or *cancel*. The download waits with its first
  connection open, so links that work only once still work. Closing the window keeps the download
  paused for later. It can be turned off in the settings or from the window itself.
- Downloads that were running continue on the next start, after a restart or a crash (a setting,
  on by default).
- Expired links can be continued: start the same download again in the browser, or right-click →
  *update link…* in the app, and the paused or failed download picks up where it stopped after
  checking that it is the same file.
- Single instance: launching Byterush again brings the open window forward instead of starting a
  second copy that would overwrite the first one's state.
- Extension setup guide in the app (*Settings → browser → set up the extension…*): it finds the
  Chromium browsers installed (Chrome, Edge, Brave, Vivaldi, Opera, Chromium) and opens their
  extensions page, shows the extension's folder with a copy button, and turns green once the
  extension checks in. Until it does, the main window suggests setting it up.
- A setup page on the website that checks live whether the extension is loaded and reaches the
  app, with the steps for each browser and the reasons a download can stay in the browser.
- *Leave downloads smaller than … to the browser* (off by default, 1 GB when turned on, any size
  in MB or GB). Links picked with *Download with Byterush* are always taken.
- The app tells you when a browser download stayed in the browser and why (the server refused it,
  a different file came back).

### Changed

- Crash-safe progress: every 4 seconds the partial file is synced to disk and only then is its
  progress recorded, so a crash or power cut costs at most a few seconds and the saved state never
  claims bytes the disk doesn't have.
- Quitting flushes every running download to disk first.
- Resuming goes straight to the first missing range, with no extra request. If the file changed
  on the server in the meantime (size, ETag or Last-Modified), the download starts over cleanly
  instead of mixing two versions.
- Crash-safe finishing: completed files are written under a temporary name and renamed into place,
  so a crash never leaves half a file under the real name.
- The interface updates instantly, and refreshing costs time in proportion to the running
  downloads rather than to every download in the list.
- A batch of links is added in one pass.
- The window appears with its content drawn, without a blank flash at startup.
- Byterush identifies itself with its own user-agent again. Posing as a browser got interstitial
  pages from SourceForge and VideoLAN and dropped connections from Hetzner.
- The system proxy settings and the operating system's root certificates are used, like the
  browser does (company proxies, private certificate authorities).
- New landing page.
- Faster on fast lines, lighter everywhere: each download has one disk writer, which the
  connections hand full buffers to and read on (before, every connection wrote for itself and
  sixteen of them queued on the file's lock), and the buffers are reused instead of allocated
  fresh for every write. Against a local server, the same 2 GB download got 34% faster and used
  45% less CPU, with a quarter of the context switches.
- The part file is reserved in full before the download starts (Linux and macOS), so the file
  system doesn't hunt for blocks at sixteen places at once (writes into the cache measured 3–9×
  faster), the finished file is far less fragmented, and a full disk fails right away instead of
  halfway through. Windows keeps a sparse file, which avoids NTFS zero-filling.
- 16 connections per download by default (was 8): every benchmark gained from 8 to 16, and
  servers that cap connections are handled already.

### Fixed

- Fewer 403 errors: hotlink protection gets the site's own Referer, and on servers that cap
  connections per client the refused extra connections step aside instead of retrying.
- A file link that answers with a web page (a login, a captcha, "your download will start") is
  reported instead of being saved under the file's name.
- Extension: the first download right after the app starts is caught. A stale "app not running"
  result is no longer remembered.
- Extension: compressed (gzip) transfers are taken over.
- Fewer downloads left to the browser: a busy server (429, 502, 503, 504) or a dropped first
  connection is asked again twice before the browser keeps the download, and the extension asks a
  slow-to-answer app twice.
- AppImage: the extension is loaded from the app's data folder, which stays put, instead of the
  AppImage's mount, which moves on every start.
- Extension: downloads whose name Chrome settled without asking extensions (another extension or a
  policy picked it) are named from the server's `Content-Disposition`, instead of the app probing
  the link again, which could use up a one-time link.
- Percentages round down, so a download or a segment never reads 100% before it is complete.

## [0.2.0] - 2026-10-23

### Added

- Initial release.
- Segmented downloads over parallel connections, with work stealing so every connection stays
  busy until the end.
- Pause and resume, a download queue with a limit on simultaneous downloads, and a global speed
  cap.
- Categories that sort finished files into folders.
- Batch downloads from numbered URL patterns.
- Clipboard monitor that offers to download copied links.
- Temporary folder for partial files, which can be on another drive.
- Browser extension for Chrome and Edge that hands downloads over to the app together with the
  browser session (cookies, user-agent, referer).

[Unreleased]: https://github.com/zecod/byterush/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/zecod/byterush/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/zecod/byterush/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/zecod/byterush/compare/159ef6f311413b1bcee12d23a895d803621515f4...v0.3.0
[0.2.0]: https://github.com/zecod/byterush/tree/159ef6f311413b1bcee12d23a895d803621515f4
