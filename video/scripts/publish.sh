#!/usr/bin/env bash
# Renders the intro and the demo and writes everything the site and the README use:
#   landing/assets/video/{intro,demo}.{mp4,webm,jpg} and docs/media/demo.gif (cut from the intro)
# usage: video/scripts/publish.sh [intro] [demo]      (both when none is named)
# Needs a system ffmpeg with libx264 and libvpx-vp9. REMOTION_BROWSER may point at a Chrome
# Headless Shell to render with.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
site="$root/landing/assets/video"
out="$root/video/out"
mkdir -p "$out" "$site"
cd "$root/video"

poster_at() { case $1 in intro) echo 25.2 ;; demo) echo 16 ;; esac; }

names=("$@")
[ $# -eq 0 ] && names=(intro demo)
for name in "${names[@]}"; do
  case $name in intro | demo) ;; *) echo "unknown video: $name (intro or demo)" >&2; exit 2 ;; esac
  comp=$(echo "${name:0:1}" | tr a-z A-Z)${name:1}
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
  ffmpeg -y -v error -ss "$(poster_at "$name")" -i "$site/$name.mp4" -frames:v 1 -q:v 3 "$site/$name.jpg"

  if [ "$name" = intro ]; then
    # the README's GIF: the race from the intro, 14 s at 12 fps
    gif="scale=860:-1:flags=lanczos"
    ffmpeg -y -v error -ss 11.75 -t 14 -i "$site/intro.mp4" -r 12 -vf "$gif,palettegen=max_colors=128:stats_mode=diff" -update 1 "$out/palette.png"
    ffmpeg -y -v error -ss 11.75 -t 14 -i "$site/intro.mp4" -i "$out/palette.png" -r 12 \
      -lavfi "[0:v]$gif[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 "$root/docs/media/demo.gif"
  fi
done

ls -la "$site" "$root/docs/media/demo.gif"
