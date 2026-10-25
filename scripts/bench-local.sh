#!/usr/bin/env bash
# The engine against a local server, so no network is in the way: how fast can it move bytes from
# sockets to disk? curl with the same number of parallel ranges is the ceiling.
# usage: scripts/bench-local.sh [out_dir] [size_mb] [connections...]
#   out_dir      where the downloads go (default: a temp dir; use a tmpfs path such as /dev/shm to
#                take the disk out too)
#   size_mb      the test file's size (default 2048); it is created once in /dev/shm or $TMPDIR
#   connections  the engine's connection counts to try (default: 8 16 32)
# Prints wall time, MB/s and the process's user and system CPU time for each run.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
out=${1:-$(mktemp -d)}
size_mb=${2:-2048}
shift $(( $# > 2 ? 2 : $# ))
if [ $# -gt 0 ]; then conns=("$@"); else conns=(8 16 32); fi
port=48080

cargo build --quiet --release --example get --example serve --manifest-path "$root/src-tauri/Cargo.toml"
get="$root/src-tauri/target/release/examples/get"
serve="$root/src-tauri/target/release/examples/serve"

site=$([ -d /dev/shm ] && echo /dev/shm/byterush-bench || echo "${TMPDIR:-/tmp}/byterush-bench")
mkdir -p "$site" "$out"
if [ ! -f "$site/big.bin" ] || [ "$(stat -c %s "$site/big.bin")" != "$((size_mb * 1048576))" ]; then
  head -c "$((size_mb * 1048576))" /dev/urandom > "$site/big.bin"
fi
if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
  echo "port $port is taken (a previous run's server?)" >&2
  exit 1
fi
log=$(mktemp)
"$serve" "$site" "$port" > "$log" &
server=$!
trap 'kill $server 2>/dev/null; rm -f "$log" "${out:?}"/big.bin "${out:?}"/part.* "${out:?}"/byterush-state.json' EXIT
for _ in $(seq 50); do grep -q READY "$log" && break; sleep 0.1; done
grep -q READY "$log" || { echo "the server did not start" >&2; exit 1; }
url="http://127.0.0.1:$port/big.bin"
size=$((size_mb * 1048576))

# `times` after the run: the second line is the children's user and system time
run() { # label, command...
  local label=$1; shift
  find "$out" -mindepth 1 \( -name 'big.bin*' -o -name 'part.*' \) -delete
  local t0 t1 cpu
  t0=$(date +%s.%N)
  cpu=$(bash -c '"$@" >/dev/null 2>&1; times' _ "$@" | tail -1 | tr -d 'ms' | awk '{printf "user %5.2f sys %5.2f", $1, $2}')
  t1=$(date +%s.%N)
  awk -v l="$label" -v s="$t0" -v e="$t1" -v b="$size" -v c="$cpu" 'BEGIN { t = e - s; printf "%-22s %6.2f s %7.0f MB/s   %s\n", l, t, b / t / 1048576, c }'
}
# n parallel ranges into n files: what the connections could do with nothing else in the way
curl_n='n=$1; size=$2; out=$3; url=$4; part=$((size / n))
  for i in $(seq 0 $((n - 1))); do
    e=$(( i == n - 1 ? size - 1 : (i + 1) * part - 1 ))
    curl -sS -r $((i * part))-$e -o "$out/part.$i" "$url" &
  done
  wait'

echo "$size_mb MB from 127.0.0.1 into $out"
run "curl x1" curl -sS -o "$out/big.bin" "$url"
for n in "${conns[@]}"; do
  run "curl x$n (ceiling)" bash -c "$curl_n" _ "$n" "$size" "$out" "$url"
  run "byterush x$n" "$get" "$url" "$out" "$n"
done
