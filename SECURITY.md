# Security policy

## Reporting a vulnerability

Please report security problems **privately**. Use GitHub's private vulnerability reporting:
[open a security advisory](https://github.com/zecod/byterush/security/advisories/new) (repository
*Security* tab, then *Report a vulnerability*). Don't open a public issue, pull request or
discussion for it.

Include what you can of:

- the affected version (app and, if relevant, the browser extension) and operating system,
- what an attacker can do and what they need (a web page you visit, a malicious server, another
  program or user account on the same machine, …),
- steps or a proof of concept to reproduce it.

We'll acknowledge the report as soon as we can, keep you posted while we work on a fix, and credit
you in the advisory and the release notes unless you'd rather stay anonymous. Please give us a
reasonable amount of time to release a fix before you disclose the problem publicly.

## Supported versions

Fixes go into the latest release. Older versions don't receive security updates, so update to the
newest release from [GitHub Releases](https://github.com/zecod/byterush/releases/latest).

## What's security-relevant in Byterush

These are the parts where a bug is most likely to be a security problem. Reports about anything
else are welcome too.

### The local bridge (127.0.0.1:51723)

While the app runs it listens on `127.0.0.1:51723` so the browser extension can hand downloads
over (`src-tauri/src/bridge.rs`). It binds to the loopback interface only and accepts a call only
when it carries the `x-byterush-ext` header with the extension's id; when an `Origin` is present it
must be the extension's. A web page can't add that header to a cross-origin request without a CORS
preflight, and preflights are answered only for the extension.

In scope, for example: a web page, a remote host or another user account on the same machine that
gets the app to start a download, write or overwrite a file, reveal anything about downloads or
settings, or crash the app through the bridge.

### The browser extension

The extension (`extension/`, Chrome and Edge, Manifest V3) asks for these permissions:

| Permission | Why |
| --- | --- |
| `downloads` | see each download the browser starts and cancel the browser's copy once the app has the file |
| `webRequest` + `<all_urls>` host access | read the request headers the browser sent for a download (cookies, user-agent, referer) and the response headers (file name, compression), so the app can make the same request |
| `cookies` | build the session headers for downloads started from the context menu, or when the browser's own request wasn't seen |
| `contextMenus` | *Download with Byterush* on links and media |
| `storage` | settings, per-site on/off and the list of recent hand-overs |

Request headers, including cookies, are sent only to the app on `127.0.0.1`, and only for the
download being handed over. In scope, for example: anything that sends them elsewhere or for other
requests, lets a web page influence what the extension does, or makes the browser lose a download.

### The download engine

The engine (`src-tauri/src/engine/`) talks to arbitrary servers and writes files to disk. In scope,
for example: file names or paths taken from URLs or `Content-Disposition` headers that escape the
chosen folder or overwrite an unrelated file, TLS certificate validation problems, browser cookies
replayed to a host other than the one the download belongs to, and a malicious server corrupting
the saved state or crashing the app.

## Verifying downloads

Every release has a `SHA256SUMS.txt` covering all of its files. Check a download with
`sha256sum -c SHA256SUMS.txt --ignore-missing` (Linux), `shasum -a 256 -c SHA256SUMS.txt
--ignore-missing` (macOS) or `Get-FileHash <file>` (Windows PowerShell).
