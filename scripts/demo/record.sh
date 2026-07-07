#!/usr/bin/env bash
# Render the standalone SVG replay animation (scripts/demo/demo.html) into a
# looping GIF for the README. No app server needed — Chrome loads the file
# directly, seeking the SMIL clock to a deterministic time per frame.
#
# Requires: Google Chrome + ffmpeg (both already on this machine).
# Usage: bash scripts/demo/record.sh   ->   docs/demo.gif
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HTML="$HERE/demo.html"
FRAMES="$(mktemp -d)"
OUT="$ROOT/docs/demo.gif"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

DUR=6.5     # animation loop length (s) — must match demo.html
FPS=20      # gif frame rate
N=$(printf '%.0f' "$(echo "$DUR * $FPS" | bc -l)")

echo "Rendering $N frames @ ${FPS}fps ..."
for i in $(seq 0 $((N - 1))); do
  T=$(echo "scale=4; $i / $FPS" | bc -l)
  IDX=$(printf '%04d' "$i")
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=660,360 \
    --default-background-color=00000000 \
    --screenshot="$FRAMES/f_$IDX.png" \
    "file://$HTML?t=$T" >/dev/null 2>&1
done

echo "Assembling GIF -> $OUT"
mkdir -p "$ROOT/docs"
# Two-pass: build an optimized palette, then map frames to it. -loop 0 = forever.
ffmpeg -y -framerate $FPS -i "$FRAMES/f_%04d.png" \
  -vf "palettegen=stats_mode=full" "$FRAMES/palette.png" >/dev/null 2>&1
ffmpeg -y -framerate $FPS -i "$FRAMES/f_%04d.png" -i "$FRAMES/palette.png" \
  -lavfi "paletteuse=dither=bayer:bayer_scale=3" -loop 0 "$OUT" >/dev/null 2>&1

rm -rf "$FRAMES"
SIZE=$(du -h "$OUT" | cut -f1)
echo "Done: $OUT ($SIZE)"
