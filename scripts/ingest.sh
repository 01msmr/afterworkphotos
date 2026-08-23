#!/usr/bin/env bash
# Ingest photos from inbox/ into the site.
#
# For every image in inbox/, in name order (the Shortcut names them by date
# taken): number it PHOTO_COUNT + 1, write the 1000px square derivative to
# img/N.jpg, move the incoming file to "img originals/N_original.<ext>" and
# bump PHOTO_COUNT in res/main.js. Moves are staged (git mv); nothing is
# committed here — the workflow does that.
#
# Square is a centre crop, which is a no-op for a photo that already is one.
# The derivative is stripped of metadata (no GPS on the public image); the
# original keeps its metadata, as the existing originals do.
#
# Runs on the GitHub runner (ImageMagick 6, `convert`) and on a Mac with
# Homebrew ImageMagick 7, which still provides `convert`.
set -euo pipefail
cd "$(dirname "$0")/.."

shopt -s nullglob nocaseglob
files=( inbox/*.jpg inbox/*.jpeg inbox/*.png inbox/*.heic )
shopt -u nocaseglob nullglob

if (( ${#files[@]} == 0 )); then
  echo "inbox empty"
  exit 0
fi

# name order = date order
IFS=$'\n' files=( $(printf '%s\n' "${files[@]}" | sort) ); unset IFS

count=$(grep -oE 'const PHOTO_COUNT = [0-9]+' res/main.js | grep -oE '[0-9]+$')
first=$(( count + 1 ))
tmp=$(mktemp "${TMPDIR:-/tmp}/ingest.XXXXXX")
trap 'rm -f "$tmp"' EXIT

for f in "${files[@]}"; do
  n=$(( count + 1 ))
  ext=$(printf '%s' "${f##*.}" | tr '[:upper:]' '[:lower:]')

  # orient first, so the size we measure is the one you see
  convert "$f" -auto-orient "jpg:$tmp"
  read -r w h < <(identify -format '%w %h\n' "$tmp")
  s=$(( w < h ? w : h ))

  convert "$tmp" -gravity center -crop "${s}x${s}+0+0" +repage \
    -resize 1000x1000 -quality 85 -strip "img/$n.jpg"

  git mv "$f" "img originals/${n}_original.${ext}"
  sed -i.bak -E "s/const PHOTO_COUNT = [0-9]+/const PHOTO_COUNT = $n/" res/main.js
  rm -f res/main.js.bak

  echo "inbox: $f -> img/$n.jpg (${w}x${h} -> ${s}x${s} -> 1000x1000)"
  count=$n
done

# last line is the commit message
if (( first == count )); then
  echo "photo $count"
else
  echo "photos $first-$count"
fi
