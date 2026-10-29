# Publishing the extension on the Chrome Web Store

The extension ships in three ways: inside the app (loaded unpacked from the folder the setup guide
shows), as `byterush-extension-X.Y.Z.zip` on every GitHub release (the same folder), and on the
Chrome Web Store. The store is the way for everyone who isn't a developer: no developer mode, and
updates arrive by themselves.

## Two ids

The folder's `manifest.json` pins a `key`, which gives an unpacked copy the id
`alolkmfdhaifcmiheblachogjjenfdbk`. The store refuses a manifest with a `key` and signs the package
with its own key, so the store build has a different id, assigned at the first upload and shown
as *Item ID* in the dashboard. The app's bridge accepts both (`EXTENSION_IDS` in
[`src-tauri/src/bridge.rs`](../src-tauri/src/bridge.rs)), the website's setup page asks both
(`EXTENSION_IDS` in `lib/site.ts` of byterush-frontend), and the store id is what the app
and the site link to (`STORE_ID` in [`src/api.ts`](../src/api.ts) and in `lib/site.ts` of
byterush-frontend). The listing's address is `https://chromewebstore.google.com/detail/<Item ID>`.

## The package

```bash
node scripts/extension-store.mjs
```

writes `dist-extension/byterush-extension-store-X.Y.Z.zip`: the `extension/` folder with the
`key` line removed, nothing else changed. Upload that file, never the release zip (the store would
reject its `key`). Every release that changes something under `extension/` needs a new upload
with the new version: the store accepts a version only once, and it must be higher than the
published one.

## The listing

Everything below is what the dashboard asks for. Keep it in step with the README and the
website's privacy page when the extension changes.

**Store listing → Description**

```
Byterush hands the downloads your browser starts to the Byterush app on your computer, which
downloads them over up to 32 connections instead of the browser's one: up to 30× faster on
servers that limit each connection, resumable after a crash or an expired link, and with a
"New download" window to pick the folder first.

What the extension does
• Catches every download: link clicks, scripts, redirects and files the server names itself.
• Keeps your login: the app gets the same cookies, user agent and referer the browser used, so
  sign-ins and "verify you're human" checks still pass.
• Never loses a file: Byterush takes over only when it gets the exact same file. One-time links,
  form posts and challenge pages stay in the browser, and the popup tells you why.
• Right-click → "Download with Byterush" on any link, video, audio or image.
• A switch per site, for sites that need the browser.

It needs the free, open-source Byterush app (Windows, macOS, Linux):
https://zecod.github.io/byterush-frontend/

Privacy: the extension talks only to the app on your own computer (127.0.0.1). It reads the
request headers of the download it hands over and nothing else. No account, no analytics,
nothing sent anywhere. Source code: https://github.com/zecod/byterush
```

**Store listing → Category**: Productivity → Tools. **Language**: English.

**Store listing → Graphic assets**: `extension/icons/128.png` as the store icon; the
screenshots (1280×800) and the small promo tile (440×280) made from the landing page, see
below; no marquee tile.

**Store listing → Additional fields**: homepage `https://zecod.github.io/byterush-frontend/`,
support `https://github.com/zecod/byterush/issues`.

**Privacy → Single purpose**

```
Hand downloads started in the browser to the Byterush download manager running on the same
computer, so that they download over several connections and can be resumed.
```

**Privacy → Permission justifications**

| Permission | Justification |
| --- | --- |
| `downloads` | To notice a download the browser starts, pause it while the app checks that it gets the same file, then cancel the browser's copy (if the app took it) or resume it (if not). |
| `webRequest` | To read the request headers the browser sent for that download (user agent, referer, authorization), so that the app can repeat the same request. Only the download's own request is read; nothing is modified or blocked. |
| `cookies` | To read the cookies sent with that download's request, so that a file behind a sign-in still downloads in the app. Only the cookies for that download's URL are read. |
| `contextMenus` | The "Download with Byterush" entry on links, videos, audio and images. |
| `storage` | The extension's settings (catching on or off, per site) and the names of the last hand-overs shown in its popup. |
| `alarms` | A check-in with the app on the same computer every five minutes, so that the app's setup guide can show that the extension is installed. |
| Host permission `<all_urls>` | Downloads can start from any site, and the headers and cookies of that site's download request must be readable; nothing else about the page is read. |

**Privacy → Remote code**: No, I am not using remote code.

**Privacy → Data usage**: tick *Authentication information* (cookies of the download's
request) and *Website content* (the download's URL and headers); everything else unticked.
Certifications: all three ticked (not sold, not used for unrelated purposes, not used for
creditworthiness). The data is handed to a program on the user's own computer and never to a
server.

**Privacy → Privacy policy**: `https://zecod.github.io/byterush-frontend/privacy.html`

**Distribution**: public, all regions, free.

## The images

The screenshots and the tile are the landing page's own markup rendered by headless Chrome at
the store's sizes, so they match the site. The first screenshot is `docs/media/app-dark.webp`
scaled to 1280×800. They are not kept in the repository; remake them when the look changes.

## After the first upload

1. Copy the *Item ID* from the dashboard.
2. Add it to `EXTENSION_IDS` in `src-tauri/src/bridge.rs` and to `STORE_ID` in `src/api.ts`.
3. In byterush-frontend, set `STORE_ID` in `lib/site.ts` (the setup page's check and every
   store link follow from it).
4. Put the listing's address in the README's *Browser extension* section.
5. Release the app: an older app refuses calls from the store build, since it doesn't know its id.
