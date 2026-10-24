# Byterush demo video

The 30-second demo on the [website](https://zecod.github.io/byterush/#demo), and the GIF at the top of the main README: the same 961 MB file from archive.org clicked in Chrome alone, and in Chrome with Byterush (its New download window, then the download), side by side and timed from the click. It is edited with [Remotion](https://www.remotion.dev/) from two **real screen recordings**; nothing in it is drawn or replayed.

`src/Demo.tsx` is the edit:

1. full screen, real time: the click in Chrome, Byterush's New download window, *start download*;
2. both recordings side by side from the same click, with clocks; once Byterush is done, Chrome's side runs 20× faster (labelled) until Chrome is done;
3. the two times.

`src/lib/takes.ts` holds the moments the recording script logged in each recording (the click, the window, *start download*, the file complete on disk), in seconds into the file. The clocks and the result come from them.

## Record the takes

The recordings go in `public/takes/` (not in git): `a.mp4` is Chrome alone, `b.mp4` Chrome with the Byterush extension and the app. They were made on a 1920×1080 virtual display (Xvfb, openbox) with the release build of the app and Chrome for Testing, the mouse driven by `xdotool` and the screen captured with `ffmpeg -f x11grab -draw_mouse 1`, one take right after the other on the same machine. In both, the browser window sits at x 440, y 40, 1040×1000; in take b, the app's window is behind it in the same spot and its settings say 32 connections. The script clicked the file on `https://archive.org/download/Sintel/`, logged the wallclock of each moment and read the first frame's wallclock from ffmpeg (`start:` in its log), which gives the offsets in `takes.ts`. New takes need new offsets there.

## Preview and publish

```sh
npm ci
npm run dev        # Remotion Studio
npm run publish    # renders it and writes landing/assets/video/demo.{mp4,webm,jpg} and docs/media/demo.gif
```

Publishing needs a system `ffmpeg` with libx264 and libvpx-vp9. `REMOTION_BROWSER` may point at a Chrome Headless Shell to render with.

## License

This folder is MIT licensed like the rest of Byterush. Remotion itself is not: it is free for individuals and companies of up to three people, larger companies need a [company license](https://www.remotion.dev/license) to render with it.
