# Byterush videos

The intro (49 s) and the one-minute demo on the [website](https://zecod.github.io/byterush/), and the GIF at the top of the main README. They are written in React with [Remotion](https://www.remotion.dev/).

Nothing in them is invented. Every progress bar, speed, connection and segment is replayed from a **recording of a real download** made with Byterush's own engine (`public/telemetry/*.json`), and the app window is drawn with the app's real components and stylesheet (`../src`), so the videos show what the app actually does.

| Recording | What it is |
|---|---|
| `race-slow.json` | 961 MB from archive.org over one connection, the way a browser downloads |
| `race-fast.json` | the same file with Byterush and 32 connections |
| `demo.json` | the same file again, paused at 6 s and resumed at 9 s |
| `handover.json` | 1 GB from Hetzner with 16 connections, the download "handed over by the browser" in the demo |

## Preview

```sh
npm ci
npm run dev        # Remotion Studio: Intro, Demo and the stills
```

## Record new downloads

From the repository root, ten samples a second of progress, speed and every segment:

```sh
cargo run --release --manifest-path src-tauri/Cargo.toml --example record -- \
  <url> <out_dir> <connections> video/public/telemetry/<name>.json [pause_s resume_s]
```

Then update `MEASURED` in `src/lib/data.ts`. Scene lengths follow the recordings, so the demo's duration adapts on its own.

## Publish

```sh
npm run publish            # both videos
npm run publish -- demo    # or only one: intro (which also makes the GIF) or demo
```

Renders the videos and writes the site's `landing/assets/video/{intro,demo}.{mp4,webm,jpg}` (H.264, plus VP9 for browsers without H.264) and `docs/media/demo.gif`. It needs a system `ffmpeg` with libx264 and libvpx-vp9. `REMOTION_BROWSER` may point at a Chrome Headless Shell to render with.

## License

This folder is MIT licensed like the rest of Byterush. Remotion itself is not: it is free for individuals and companies of up to three people, larger companies need a [company license](https://www.remotion.dev/license) to render with it.
