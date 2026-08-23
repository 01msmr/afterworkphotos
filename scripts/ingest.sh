#!/usr/bin/env bash
# Ingest photos from inbox/ into the site, and keep the derived data current.
#
# 1. For every image in inbox/, oldest first by date taken (EXIF
#    DateTimeOriginal; a file without one sorts by its name, which the
#    Shortcut makes a date stamp): number it PHOTO_COUNT + 1, write the
#    1000px square derivative to img/N.jpg, move the incoming file to
#    "img originals/N_original.<ext>" and bump PHOTO_COUNT in res/main.js.
#    Square is a centre crop. The original is kept at full size but gets the
#    same square crop (quality 95, metadata kept); one that already is
#    square is moved untouched. The derivative is stripped of metadata, so
#    no GPS reaches the public image.
#    New arrivals are staged so the next step can move them.
# 2. Renumber ALL photos so that number order is time order: sorted by the
#    original's EXIF date taken (photos without one keep their relative
#    order at the end), files renamed with git mv in two phases so history
#    follows and nothing collides. A photo older than existing ones slots
#    in where it belongs and everything after it shifts by one.
# 3. For every photo 1..N make sure the 200px thumbnail img/thumb/N.jpg
#    exists — made from the derivative, so it is the same crop.
# 4. Rewrite photos.json from scratch: count, and per photo its number,
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

    git add "img/$n.jpg"
    if (( w == h )); then
      git mv "$f" "img originals/${n}_original.${ext}"
    else
      convert "$f" -auto-orient -gravity center -crop "${s}x${s}+0+0" +repage \
        -quality 95 "img originals/${n}_original.jpg"
      git rm -q "$f"
      git add "img originals/${n}_original.jpg"
    fi
    sed -i.bak -E "s/const PHOTO_COUNT = [0-9]+/const PHOTO_COUNT = $n/" res/main.js
    rm -f res/main.js.bak

    echo "inbox: $f -> img/$n.jpg (${w}x${h} -> ${s}x${s} -> 1000x1000)"
    count=$n
  done
fi

# ── 2. renumber, so that number order is time order ──────────────────────
original_of() {   # path of photo $1's original, empty if none
  for o in "img originals/${1}_original".*; do printf '%s' "$o"; return; done
}

# sort key per photo: date taken, else "after everything" keeping the
# current order; secondary key is the current number (stable)
order=()
while IFS= read -r line; do order+=( "${line#*$'	'}" ); done < <(
  for (( n = 1; n <= count; n++ )); do
    o=$(original_of "$n"); d=""
    [[ -n "$o" ]] && d=$(exif_taken "$o")
    (( ${#d} >= 14 )) || d="99999999999999"
    printf '%s	%s
' "$d" "$n"
  done | sort -s -t $'	' -k1,1 -k2,2n
)
# order[m-1] = old number that becomes m

declare -a newnum
moved=0
for (( m = 1; m <= count; m++ )); do
  n=${order[m-1]}
  newnum[n]=$m
  (( n != m )) && moved=$(( moved + 1 ))
done

if (( moved > 0 )); then
  # phase 1: park everything that moves under a name nothing else can take
  for (( n = 1; n <= count; n++ )); do
    m=${newnum[n]}; (( n == m )) && continue
    git mv "img/$n.jpg" "img/renum_$n.jpg"
    o=$(original_of "$n"); [[ -n "$o" ]] && git mv "$o" "img originals/renum_${n}.${o##*.}"
    [[ -f "img/thumb/$n.jpg" ]] && git mv "img/thumb/$n.jpg" "img/thumb/renum_$n.jpg"
  done
  # phase 2: give them their new numbers
  for (( n = 1; n <= count; n++ )); do
    m=${newnum[n]}; (( n == m )) && continue
    git mv "img/renum_$n.jpg" "img/$m.jpg"
    for o in "img originals/renum_${n}".*; do git mv "$o" "img originals/${m}_original.${o##*.}"; done
    [[ -f "img/thumb/renum_$n.jpg" ]] && git mv "img/thumb/renum_$n.jpg" "img/thumb/$m.jpg"
    echo "renumber: $n -> $m"
  done
fi

# the commit message names the new arrivals by their final numbers
final=()
for (( n = first; n <= count; n++ )); do final+=( "${newnum[n]}" ); done
IFS=$'
' final=( $(printf '%s
' "${final[@]}" | sort -n) ); unset IFS

# ── 3. thumbnails ─────────────────────────────────────────────────────────
mkdir -p img/thumb
for (( n = 1; n <= count; n++ )); do
  if [[ ! -f "img/thumb/$n.jpg" ]]; then
    convert "img/$n.jpg" -resize 200x200 -quality 80 -strip "img/thumb/$n.jpg"
    echo "thumb: img/thumb/$n.jpg"
  fi
done

# ── 4. photos.json ────────────────────────────────────────────────────────
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
if (( ${#final[@]} == 0 )); then
  if (( moved > 0 )); then echo "photos renumbered by date taken"; else echo "photos.json + thumbnails"; fi
elif (( ${#final[@]} == 1 )); then
  echo "photo ${final[0]}"
else
  echo "photos $(IFS=,; echo "${final[*]}")"
fi
