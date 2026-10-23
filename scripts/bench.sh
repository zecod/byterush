#!/usr/bin/env bash
# One connection (curl, the way a browser downloads) against Byterush with 1, 8 and 16 connections.
# usage: scripts/bench.sh <url> [runs]
# Builds the engine's headless `get` example, prints the wall-clock time of every download.
set -euo pipefail

url=${1:?usage: scripts/bench.sh <url> [runs]}
runs=${2:-2}
root=$(cd "$(dirname "$0")/.." && pwd)
cargo build --quiet --release --example get --manifest-path "$root/src-tauri/Cargo.toml"
get="$root/src-tauri/target/release/examples/get"
work=$(mktemp -d)
trap 'rm -rf "${work:?}"' EXIT

for run in $(seq 1 "$runs"); do
  for mode in curl 1 8 16; do
    rm -rf "${work:?}"/*
    start=$(date +%s.%N)
    if [ "$mode" = curl ]; then
      curl -sSL -o "$work/download" "$url"
    else
      "$get" "$url" "$work" "$mode" > /dev/null
    fi
    end=$(date +%s.%N)
    bytes=$(find "$work" -type f -printf '%s\n' | sort -n | tail -1)
    label=$([ "$mode" = curl ] && echo "1 connection (curl)" || echo "byterush x$mode")
    awk -v l="$label" -v r="$run" -v s="$start" -v e="$end" -v b="$bytes" \
      'BEGIN { t = e - s; printf "run %s  %-20s %7.2f s  %7.2f MB/s\n", r, l, t, b / t / 1e6 }'
  done
done
