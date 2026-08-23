#!/usr/bin/env bash
# Ingest photos from inbox/ into the site, and keep names and derived data
# current.
#
# Every photo lives under a date name, awp-YYYY-MM-DD-NN (NN counts the
# photos of that day in time order): img/<name>.jpg is the 1000px square
# derivative, img/thumb/<name>.jpg the 200px thumbnail, "img originals/
# <name>.<ext>" the full-size original cropped to the same square, and for a
# video img/<name>.mp4 as well. The site never shows these names; it numbers
# the photos 1..N in date order through photos.json.
#
# 1. inbox/: each image is oriented, centre-cropped to a square (a no-op for
#    one that already is), written as the derivative (metadata stripped, so
#    no GPS reaches the public image) and as the full-size square original
#    (quality 95, metadata kept; an already-square one is moved untouched).
#    When the crop changed something, the uncropped file is kept too, as
#    "<name>--unc.<ext>" next to the original.
#    An arrival whose date taken matches an existing photo to the second is
#    the same photo: it is kept as that photo's --unc if it was cropped and
#    there is none yet, otherwise dropped. So dropping an export in twice
#    is harmless, and is the way to add the uncropped files afterwards.
#    Videos (mov/mp4/m4v) up to MAX_VIDEO_SECONDS are done with ffmpeg: a
#    1000px square H.264 derivative with audio, its first frame as the jpg,
#    the full-size square original; longer ones go to inbox/too-long/. A
#    Mac without ffmpeg leaves videos in the inbox for the GitHub runner.
# 2. Naming: every photo is (re)named by its date taken — EXIF
#    DateTimeOriginal, the QuickTime creation date for a video; undated ones
#    become awp-undated-NN at the end. A photo that arrives earlier in a day
#    than existing ones renumbers that day. Renames are git mv in two
#    phases, so history follows and nothing collides.
# 3. Thumbnails for any photo lacking one (from the derivative: same crop).
# 4. photos.json, rewritten from scratch: count, and per photo n (its
#    position in date order), id, taken, file, thumb, video.
#
# Nothing is committed here — the workflow does that. The last line printed
# is the commit message. Runs on the GitHub runner (ImageMagick 6, ffmpeg)
# and on a Mac with Homebrew ImageMagick 7, which still provides `convert`.
set -euo pipefail
cd "$(dirname "$0")/.."

MAX_VIDEO_SECONDS=30

# inbox files arrive tracked (pushed through the API) or untracked (dropped
# in locally); git mv / git rm only work on tracked ones, so fall back
move() { git mv "$1" "$2" 2>/dev/null || { mv "$1" "$2"; git add "$2"; }; }
remove() { git rm -q "$1" 2>/dev/null || rm -f "$1"; }

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
is_video() { case "$(lower "${1##*.}")" in mov|mp4|m4v) return 0;; *) return 1;; esac; }

# date taken as digits only (20260823190000), empty if there is none
taken_of() {
  if is_video "$1"; then
    command -v ffprobe >/dev/null || return 0
    ffprobe -v error -show_entries format_tags=com.apple.quicktime.creationdate,creation_time \
      -of default=nw=1:nk=1 "$1" 2>/dev/null | head -1 | tr -cd '0-9' | cut -c1-14
  else
    identify -quiet -format '%[EXIF:DateTimeOriginal]' "$1" 2>/dev/null | tr -cd '0-9'
  fi
}

# the original of photo id $1 (any extension, legacy "_original" too)
original_of() {
  local o
  for o in "img originals/$1".* "img originals/$1_original".*; do
    [[ -f "$o" ]] && { printf '%s' "$o"; return; }
  done
}

tmp=$(mktemp "${TMPDIR:-/tmp}/ingest.XXXXXX")
map=$(mktemp "${TMPDIR:-/tmp}/ingest-map.XXXXXX")
idx=$(mktemp "${TMPDIR:-/tmp}/ingest-idx.XXXXXX")
trap 'rm -f "$tmp" "$map" "$idx"' EXIT

# what exists, by date taken (digits) → id, from the last photos.json
if [[ -f photos.json ]]; then
  sed -nE 's/.*"id": "([^"]+)", "taken": "([^"]+)".*/\2\t\1/p' photos.json \
    | awk -F'\t' '{gsub(/[^0-9]/, "", $1); print $1 "\t" $2}' > "$idx"
fi
existing_with_taken() { [[ -n "$1" ]] && awk -F'\t' -v t="$1" '$1 == t {print $2; exit}' "$idx"; }

# ── 1. inbox ──────────────────────────────────────────────────────────────
shopt -s nullglob nocaseglob
files=( inbox/*.jpg inbox/*.jpeg inbox/*.png inbox/*.heic inbox/*.mov inbox/*.mp4 inbox/*.m4v )
shopt -u nocaseglob

arrived=()
seq=0
for f in ${files[@]+"${files[@]}"}; do
  seq=$(( seq + 1 ))
  id=$(printf 'new-%04d' "$seq")
  ext=$(lower "${f##*.}")

  # the same photo again? (to the second)
  dup=$(existing_with_taken "$(taken_of "$f")" || true)
  if [[ -n "$dup" ]]; then
    shopt -s nullglob; unc=( "img originals/$dup--unc".* ); shopt -u nullglob
    if is_video "$f"; then w=0; h=1; else
      convert "$f" -auto-orient "jpg:$tmp"; read -r w h < <(identify -format '%w %h\n' "$tmp")
    fi
    if (( w != h )) && (( ${#unc[@]} == 0 )); then
      move "$f" "img originals/$dup--unc.$ext"
      echo "uncropped for $dup: $f"
    else
      remove "$f"
      echo "duplicate of $dup, dropped: $f"
    fi
    continue
  fi

  if is_video "$f"; then
    if ! command -v ffmpeg >/dev/null; then
      echo "left for the runner (no ffmpeg here): $f"
      continue
    fi
    dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null); dur=${dur%.*}
    if (( ${dur:-0} > MAX_VIDEO_SECONDS )); then
      mkdir -p inbox/too-long
      move "$f" "inbox/too-long/$(basename "$f")"
      echo "too long (${dur}s > ${MAX_VIDEO_SECONDS}s): $f"
      continue
    fi
    ffmpeg -v error -y -i "$f" -vf "crop='min(iw,ih)':'min(iw,ih)',scale=1000:1000" \
      -c:v libx264 -crf 23 -preset medium -pix_fmt yuv420p -movflags +faststart \
      -c:a aac -b:a 96k "img/$id.mp4"
    ffmpeg -v error -y -i "img/$id.mp4" -frames:v 1 -q:v 3 "img/$id.jpg"
    ffmpeg -v error -y -i "$f" -vf "crop='min(iw,ih)':'min(iw,ih)'" \
      -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -c:a copy "img originals/$id.mp4"
    move "$f" "img originals/$id--unc.$ext"
    git add "img/$id.mp4" "img/$id.jpg" "img originals/$id.mp4"
    echo "inbox: $f -> video (${dur}s)"
  else
    # orient first, so the size we measure is the one you see
    convert "$f" -auto-orient "jpg:$tmp"
    read -r w h < <(identify -format '%w %h\n' "$tmp")
    s=$(( w < h ? w : h ))
    convert "$tmp" -gravity center -crop "${s}x${s}+0+0" +repage \
      -resize 1000x1000 -quality 85 -strip "img/$id.jpg"
    git add "img/$id.jpg"
    if (( w == h )); then
      move "$f" "img originals/$id.$ext"
    else
      convert "$f" -auto-orient -gravity center -crop "${s}x${s}+0+0" +repage \
        -quality 95 "img originals/$id.jpg"
      move "$f" "img originals/$id--unc.$ext"
      git add "img originals/$id.jpg"
    fi
    echo "inbox: $f -> photo (${w}x${h} -> ${s}x${s})"
  fi
  arrived+=( "$id" )
done

# ── 2. names by date taken ────────────────────────────────────────────────
# every photo is an img/<id>.jpg; sort by date taken (undated last, keeping
# their order), then hand out awp-YYYY-MM-DD-NN in that order
shopt -s nullglob
ids=()
for j in img/*.jpg; do j=${j##*/}; ids+=( "${j%.jpg}" ); done
shopt -u nullglob

ordered=()
while IFS= read -r line; do ordered+=( "${line#*$'\t'}" ); done < <(
  for id in "${ids[@]}"; do
    o=$(original_of "$id"); d=""
    [[ -n "$o" ]] && d=$(taken_of "$o")
    (( ${#d} >= 8 )) || d="99999999"
    printf '%s\t%s\n' "$d" "$id"
  done | sort -s -t $'\t' -k1,1
)

: > "$map"     # lines: old id <TAB> new id
prev_day=""; nn=0
for id in "${ordered[@]}"; do
  o=$(original_of "$id"); d=""
  [[ -n "$o" ]] && d=$(taken_of "$o")
  if (( ${#d} >= 8 )); then day="${d:0:4}-${d:4:2}-${d:6:2}"; else day="undated"; fi
  if [[ "$day" != "$prev_day" ]]; then nn=0; prev_day=$day; fi
  nn=$(( nn + 1 ))
  printf '%s\t%s\n' "$id" "$(printf 'awp-%s-%02d' "$day" "$nn")" >> "$map"
done

# phase 1: park everything that changes name under a name nothing can take
moved=0
while IFS=$'\t' read -r old new; do
  [[ "$old" == "$new" ]] && continue
  moved=$(( moved + 1 ))
  git mv "img/$old.jpg" "img/renum_$old.jpg"
  [[ -f "img/$old.mp4" ]] && git mv "img/$old.mp4" "img/renum_$old.mp4"
  [[ -f "img/thumb/$old.jpg" ]] && git mv "img/thumb/$old.jpg" "img/thumb/renum_$old.jpg"
  o=$(original_of "$old"); [[ -n "$o" ]] && git mv "$o" "img originals/renum_$old.${o##*.}"
  for u in "img originals/$old--unc".*; do [[ -f "$u" ]] && git mv "$u" "img originals/renum_$old--unc.${u##*.}"; done
done < "$map"
# phase 2: the new names
while IFS=$'\t' read -r old new; do
  [[ "$old" == "$new" ]] && continue
  git mv "img/renum_$old.jpg" "img/$new.jpg"
  [[ -f "img/renum_$old.mp4" ]] && git mv "img/renum_$old.mp4" "img/$new.mp4"
  [[ -f "img/thumb/renum_$old.jpg" ]] && git mv "img/thumb/renum_$old.jpg" "img/thumb/$new.jpg"
  for o in "img originals/renum_$old".*; do [[ -f "$o" ]] && git mv "$o" "img originals/$new.${o##*.}"; done
  for u in "img originals/renum_$old--unc".*; do [[ -f "$u" ]] && git mv "$u" "img originals/$new--unc.${u##*.}"; done
  echo "name: $old -> $new"
done < "$map"

# final names, in date order
names=()
while IFS=$'\t' read -r old new; do names+=( "$new" ); done < "$map"

# ── 3. thumbnails ─────────────────────────────────────────────────────────
mkdir -p img/thumb
for name in "${names[@]}"; do
  if [[ ! -f "img/thumb/$name.jpg" ]]; then
    convert "img/$name.jpg" -resize 200x200 -quality 80 -strip "img/thumb/$name.jpg"
    git add "img/thumb/$name.jpg"
  fi
done

# ── 4. photos.json ────────────────────────────────────────────────────────
{
  echo '{'
  echo "  \"count\": ${#names[@]},"
  echo '  "photos": ['
  n=0
  for name in "${names[@]}"; do
    n=$(( n + 1 ))
    o=$(original_of "$name"); d=""
    [[ -n "$o" ]] && d=$(taken_of "$o")
    taken_json=null
    (( ${#d} >= 14 )) && taken_json="\"${d:0:4}-${d:4:2}-${d:6:2}T${d:8:2}:${d:10:2}:${d:12:2}\""
    video_json=null; [[ -f "img/$name.mp4" ]] && video_json="\"img/$name.mp4\""
    sep=','; (( n == ${#names[@]} )) && sep=''
    printf '    {"n": %d, "id": "%s", "taken": %s, "file": "img/%s.jpg", "thumb": "img/thumb/%s.jpg", "video": %s}%s\n' \
      "$n" "$name" "$taken_json" "$name" "$name" "$video_json" "$sep"
  done
  echo '  ]'
  echo '}'
} > photos.json
git add photos.json

# ── commit message: the arrivals by their final names ─────────────────────
final=()
for id in ${arrived[@]+"${arrived[@]}"}; do
  while IFS=$'\t' read -r old new; do [[ "$old" == "$id" ]] && final+=( "$new" ); done < "$map"
done
if (( ${#final[@]} == 0 )); then
  if (( moved > 0 )); then echo "photos named by date taken"; else echo "photos.json + thumbnails"; fi
elif (( ${#final[@]} == 1 )); then
  echo "photo ${final[0]}"
else
  echo "photos ${final[0]} … ${final[${#final[@]}-1]} (${#final[@]})"
fi
