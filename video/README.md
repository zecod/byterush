# Byterush demo videos

The races on the [website](https://zecod.github.io/byterush/#demo) and the GIFs in the main README: the same file clicked in Chrome alone, and in Chrome with Byterush (its New download window, then the download), side by side and timed from the click. They are edited with [Remotion](https://www.remotion.dev/) from **real screen recordings**; nothing in them is drawn or replayed.

| Composition | File | Chrome alone | Chrome + Byterush |
|---|---|---:|---:|
| `Demo` | 961 MB from archive.org | 13:02.1 | 0:17.2 (32 connections) |
| `Demo10GBHelsinki` | 10.7 GB from Hetzner Helsinki | 9:33.5 | 0:55.1 (16 connections) |
| `Demo10GBFalkenstein` | 10.7 GB from Hetzner Falkenstein | 5:36.9 | 0:50.1 (16 connections) |

`src/Demo.tsx` is the edit, the same for each race:

1. full screen, real time: the click in Chrome, Byterush's New download window, *start download*;
2. both recordings side by side from the same click, with clocks, until Byterush is done (real time, or both sped up the same, labelled: 2× for 10 GB); then Chrome's side runs faster (labelled) until Chrome is done;
3. the two times.

`src/lib/takes.ts` holds each race: its two recordings, the moments the recording script logged in each (the click, the window, *start download*, the file complete on disk) in seconds into the file, and the speed-ups. The clocks and the result come from them.

## Record the takes

The recordings go in `public/takes/` (not in git): `a.mp4` is Chrome alone, `b.mp4` Chrome with the Byterush extension and the app; `a10hel.mp4`/`b10hel.mp4` and `a10fsn.mp4`/`b10fsn.mp4` are the 10 GB races (`https://hel1-speed.hetzner.com/10GB.bin` and `https://fsn1-speed.hetzner.com/10GB.bin`, the app set to 16 connections; each file deleted after its take, as the disk held one at a time). They were made on a 1920×1080 virtual display (Xvfb, openbox) with the release build of the app and Chrome for Testing, the mouse driven by `xdotool` and the screen captured with `ffmpeg -f x11grab -draw_mouse 1`, one take right after the other on the same machine. In both, the browser window sits at x 440, y 40, 1040×1000; in take b, the app's window is behind it in the same spot and its settings say 32 connections. The script clicked the file on `https://archive.org/download/Sintel/`, logged the wallclock of each moment and read the first frame's wallclock from ffmpeg (`start:` in its log), which gives the offsets in `takes.ts`. New takes need new offsets there.

## Preview and publish

```sh
npm ci
npm run dev        # Remotion Studio
npm run publish    # renders all three: landing/assets/video/<name>.{mp4,webm,jpg}, docs/media/demo.gif and demo-10gb-helsinki.gif
npm run publish -- demo-10gb-helsinki    # just one: demo, demo-10gb-helsinki or demo-10gb-falkenstein
```

Publishing needs a system `ffmpeg` with libx264 and libvpx-vp9. `REMOTION_BROWSER` may point at a Chrome Headless Shell to render with.

## License

This folder is MIT licensed like the rest of Byterush. Remotion itself is not: it is free for individuals and companies of up to three people, larger companies need a [company license](https://www.remotion.dev/license) to render with it.
