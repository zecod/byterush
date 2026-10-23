# Changelog

All notable changes to Byterush are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The app, the engine and the browser
extension share one version number.

The release workflow publishes the section of a version as its GitHub release notes, so write
entries for people who use Byterush, not for people who read the diff.

## [Unreleased]

## [0.3.0] - unreleased

### Added

- Downloads that were running continue on the next start, after a restart or a crash (a setting,
  on by default).
- Expired links can be continued: start the same download again in the browser, or right-click →
  *update link…* in the app, and the paused or failed download picks up where it stopped after
  checking that it is the same file.
- Single instance: launching Byterush again brings the open window forward instead of starting a
  second copy that would overwrite the first one's state.

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

### Fixed

- Fewer 403 errors: hotlink protection gets the site's own Referer, and on servers that cap
  connections per client the refused extra connections step aside instead of retrying.
- A file link that answers with a web page (a login, a captcha, "your download will start") is
  reported instead of being saved under the file's name.
- Extension: the first download right after the app starts is caught. A stale "app not running"
  result is no longer remembered.
- Extension: compressed (gzip) transfers are taken over.
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

[Unreleased]: https://github.com/zecod/byterush/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/zecod/byterush/compare/159ef6f311413b1bcee12d23a895d803621515f4...v0.3.0
[0.2.0]: https://github.com/zecod/byterush/tree/159ef6f311413b1bcee12d23a895d803621515f4
