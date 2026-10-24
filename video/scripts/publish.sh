#!/usr/bin/env bash
# Renders the demos and writes what the site and the README use:
#   landing/assets/video/demo.{mp4,webm,jpg} and docs/media/demo.gif: 961 MB from archive.org
#   landing/assets/video/demo-10gb-helsinki.{mp4,webm,jpg} and docs/media/demo-10gb-helsinki.gif,
#   landing/assets/video/demo-10gb-falkenstein.{mp4,webm,jpg}: 10.7 GB from Hetzner
# usage: video/scripts/publish.sh [demo|demo-10gb-helsinki|demo-10gb-falkenstein]   (all by default)
# Needs the recordings in public/takes/ (README: "Record the takes") and a system ffmpeg with
# libx264 and libvpx-vp9. REMOTION_BROWSER may point at a Chrome Headless Shell to render with.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
site="$root/landing/assets/video"
out="$root/video/out"
mkdir -p "$out" "$site"
cd "$root/video"

# publish <composition> <name> <poster at s> [<gif from s> <gif length s>]
publish() {
  local comp=$1 name=$2 poster=$3 gif_from=${4:-} gif_len=${5:-}
  # a high-quality master; the published files are encoded from it once
  npx remotion render "$comp" "$out/$name-master.mp4" --codec=h264 --crf=14 --concurrency="${CONCURRENCY:-4}"
  # Remotion encodes JPEG frames as full-range yuvj420p; browsers expect limited-range yuv420p
  ffmpeg -y -v error -i "$out/$name-master.mp4" -an \
    -vf "scale=in_range=full:out_range=tv,format=yuv420p" -color_range tv \
    -c:v libx264 -crf 23 -preset slow -profile:v high -movflags +faststart "$site/$name.mp4"
  # VP9 for browsers without H.264 (some open-source Chromium builds)
  ffmpeg -y -v error -i "$out/$name-master.mp4" -an \
    -vf "scale=in_range=full:out_range=tv,format=yuv420p" -color_range tv \
    -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 "$site/$name.webm"
  # the poster: the race, Byterush nearly done while Chrome is far behind
  ffmpeg -y -v error -ss "$poster" -i "$site/$name.mp4" -frames:v 1 -q:v 3 "$site/$name.jpg"

  # the README's GIF: a stretch of the race
  [ -n "$gif_from" ] || return 0
  local gif="scale=960:-1:flags=lanczos"
  ffmpeg -y -v error -ss "$gif_from" -t "$gif_len" -i "$site/$name.mp4" -r 10 -vf "$gif,palettegen=max_colors=128:stats_mode=diff" -update 1 "$out/palette.png"
  ffmpeg -y -v error -ss "$gif_from" -t "$gif_len" -i "$site/$name.mp4" -i "$out/palette.png" -r 10 \
    -lavfi "[0:v]$gif[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 "$root/docs/media/$name.gif"
}

want=${1:-all}
[ "$want" = all ] || [ "$want" = demo ] && publish Demo demo 18.5 6.6 15
# 10 GB: the GIF runs from Byterush finishing, through Chrome fast-forwarding, to the result
[ "$want" = all ] || [ "$want" = demo-10gb-helsinki ] && publish Demo10GBHelsinki demo-10gb-helsinki 18.5 30 17.5
[ "$want" = all ] || [ "$want" = demo-10gb-falkenstein ] && publish Demo10GBFalkenstein demo-10gb-falkenstein 18.5

ls -la "$site" "$root"/docs/media/demo*.gif
