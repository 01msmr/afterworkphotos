#!/usr/bin/env bash
# Ingest photos from inbox/ into the site, and keep the derived data current.
#
# 1. For every image in inbox/, oldest first by date taken (EXIF
#    DateTimeOriginal; a file without one sorts by its name, which the
#    Shortcut makes a date stamp): number it PHOTO_COUNT + 1, write the
#    1000px square derivative to img/N.jpg, move the incoming file to
#    "img originals/N_original.<ext>" and bump PHOTO_COUNT in res/main.js.
#    Square is a centre crop, a no-op for a photo that already is one. The
#    derivative is stripped of metadata (no GPS on the public image); the
#    original keeps its metadata, as the existing originals do.
# 2. For every photo 1..N make sure the 200px thumbnail img/thumb/N.jpg
#    exists — made from the derivative, so it is the same crop.
# 3. Rewrite photos.json from scratch: count, and per photo its number,
#    date taken (from the original's EXIF, null if there is none), file and
#    thumbnail. Always regenerated, never appended, so it cannot drift.
#
# Moves are staged (git mv); nothing is committed here — the workflow does
# that. The last line printed is the commit message.
#
# Runs on the GitHub runner (ImageMagick 6, `convert`) and on a Mac with
# Homebrew ImageMagick 7, which still provides `convert`.
set -euo pipefail
cd "$(dirname "$0")/.."

count=$(grep -oE 'const PHOTO_COUNT = [0-9]+' res/main.js | grep -oE '[0-9]+$')
first=$(( count + 1 ))
tmp=$(mktemp "${TMPDIR:-/tmp}/ingest.XXXXXX")
trap 'rm -f "$tmp"' EXIT

# EXIF date taken as digits only (20260823190000), empty if there is none
exif_taken() {
  identify -quiet -format '%[EXIF:DateTimeOriginal]' "$1" 2>/dev/null | tr -cd '0-9'
}

# ── 1. inbox ──────────────────────────────────────────────────────────────
shopt -s nullglob nocaseglob
files=( inbox/*.jpg inbox/*.jpeg inbox/*.png inbox/*.heic )
shopt -u nocaseglob

if (( ${#files[@]} > 0 )); then
  # Date taken first; the name stands in where there is none. Both keys are
  # digits only, so the two kinds sort together sensibly.
  taken() {
    local d
    d=$(exif_taken "$1")
    if [[ -n "$d" ]]; then printf '%s' "$d"; else basename "$1" | tr -cd '0-9'; fi
  }
  ordered=()
  while IFS= read -r line; do ordered+=( "${line#*$'\t'}" ); done < <(
    for f in "${files[@]}"; do printf '%s\t%s\n' "$(taken "$f")" "$f"; done | sort -s -t $'\t' -k1,1
  )

  for f in "${ordered[@]}"; do
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
fi

# ── 2. thumbnails ─────────────────────────────────────────────────────────
mkdir -p img/thumb
for (( n = 1; n <= count; n++ )); do
  if [[ ! -f "img/thumb/$n.jpg" ]]; then
    convert "img/$n.jpg" -resize 200x200 -quality 80 -strip "img/thumb/$n.jpg"
    echo "thumb: img/thumb/$n.jpg"
  fi
done

# ── 3. photos.json ────────────────────────────────────────────────────────
{
  echo '{'
  echo "  \"count\": $count,"
  echo '  "photos": ['
  for (( n = 1; n <= count; n++ )); do
    taken_json=null
    for o in "img originals/${n}_original".*; do
      d=$(exif_taken "$o")
      if (( ${#d} >= 14 )); then
        taken_json="\"${d:0:4}-${d:4:2}-${d:6:2}T${d:8:2}:${d:10:2}:${d:12:2}\""
      fi
      break
    done
    sep=','; (( n == count )) && sep=''
    printf '    {"n": %d, "taken": %s, "file": "img/%d.jpg", "thumb": "img/thumb/%d.jpg"}%s\n' \
      "$n" "$taken_json" "$n" "$n" "$sep"
  done
  echo '  ]'
  echo '}'
} > photos.json
shopt -u nullglob

# last line is the commit message
if (( first > count )); then
  echo "photos.json + thumbnails"
elif (( first == count )); then
  echo "photo $count"
else
  echo "photos $first-$count"
fi
