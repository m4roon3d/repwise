#!/usr/bin/env bash
# Regenerates the PNG icons from public/icon.svg (needs rsvg-convert).
# "any" icons keep the rounded tile; maskable / apple icons are full-bleed with the glyph inside the safe zone.
set -euo pipefail
cd "$(dirname "$0")/.."
SVG=public/icon.svg
FULL=$(mktemp --suffix=.svg)
python3 - "$SVG" "$FULL" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
s = s.replace(' rx="112"', '')                                   # full-bleed background
s = s.replace('<g id="mark">', '<g id="mark" transform="translate(256 256) scale(0.8) translate(-256 -256)">')
open(sys.argv[2], 'w').write(s)
PY
rsvg-convert -w 192 -h 192 "$SVG" -o public/icon-192.png
rsvg-convert -w 512 -h 512 "$SVG" -o public/icon-512.png
rsvg-convert -w 512 -h 512 "$FULL" -o public/icon-maskable-512.png
rsvg-convert -w 180 -h 180 "$FULL" -o public/apple-touch-icon.png
rm -f "$FULL"
