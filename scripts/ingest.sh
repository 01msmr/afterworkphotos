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
#    The originals are LOCAL ONLY — gitignored, never pushed: they carry
#    the GPS the public images are stripped of. A photo that arrives on the
#    runner therefore keeps no original beyond that run.
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
#    position in date order), id, taken, place, file, thumb, video. The
#    place is the city-level name for the original's GPS (the public
#    derivative is stripped of it), asked of Nominatim once per photo and
#    carried forward from the previous photos.json by date taken — only
#    the name is ever published, never the coordinates. The desc is a 1–3
#    word image description, asked of Claude (Haiku) once per photo when
#    ANTHROPIC_API_KEY is set (repo secret), cached the same way; a photo
#    without one is asked again on the next run. A top-level "places"
#    block maps each place name to the coordinates of the town's centre
#    (from the same Nominatim answer, two decimals) — public knowledge
#    about the town, nothing about a photo — for the wall map's layout.
#
# Nothing is committed here — the workflow does that. The last line printed
# is the commit message. Runs on the GitHub runner (ImageMagick 6, ffmpeg)
# and on a Mac with Homebrew ImageMagick 7, which still provides `convert`.
set -euo pipefail
cd "$(dirname "$0")/.."

MAX_VIDEO_SECONDS=30

# inbox files arrive tracked (pushed through the API) or untracked (dropped
# in locally), and "img originals" is gitignored — git mv / git add work on
# neither, so fall back to a plain move and record the departure by hand
move() {
  git mv "$1" "$2" 2>/dev/null && return 0
  mv "$1" "$2"
  git add "$2" 2>/dev/null || true                          # ignored target: nothing to stage
  git rm -q --cached --ignore-unmatch "$1" 2>/dev/null || true
}

# move a file git does not track (an original): git mv would refuse
movef() { git mv "$1" "$2" 2>/dev/null || mv "$1" "$2"; }
remove() { git rm -q "$1" 2>/dev/null || rm -f "$1"; }

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
is_video() { case "$(lower "${1##*.}")" in mov|mp4|m4v) return 0;; *) return 1;; esac; }

# date taken as digits only (20260823190000), empty if there is none
taken_of() {
  if is_video "$1"; then
    command -v ffprobe >/dev/null || return 0
    # the QuickTime date first (local time), else any creation_time, on the
    # container or a stream; first non-empty answer wins
    ffprobe -v error \
      -show_entries 'format_tags=com.apple.quicktime.creationdate,creation_time:stream_tags=creation_time' \
      -of default=nw=1:nk=1 "$1" 2>/dev/null | grep -m1 '[0-9]' | tr -cd '0-9' | cut -c1-14
  else
    identify -quiet -format '%[EXIF:DateTimeOriginal]' "$1" 2>/dev/null | tr -cd '0-9'
  fi
}

# the date a photo was taken. A photo the last photos.json already knows is
# not measured again — its date is settled, and its name encodes it; with
# hundreds of photos, reading every EXIF again would cost minutes of every
# run (to force a fresh read, drop the photo's line from photos.json). Only
# an arrival is read: from its untouched --unc file when there is one (the
# most faithful source), else from the original. When neither is readable
# on this machine (a video without ffprobe, an exotic format) the answer is
# empty and the photo becomes undated.
taken_of_photo() {
  local u d
  d=$(awk -F'\t' -v id="$1" '$2 == id {print $1; exit}' "$idx")
  [[ -n "$d" ]] && { printf '%s' "$d"; return 0; }
  for u in "img originals/$1--unc".*; do
    [[ -f "$u" ]] && { d=$(taken_of "$u"); break; }
  done
  if [[ -z "$d" ]]; then
    local o; o=$(original_of "$1")
    [[ -n "$o" ]] && d=$(taken_of "$o")
  fi
  printf '%s' "$d"
  return 0
}

# the original of photo id $1 (any extension, legacy "_original" too)
original_of() {
  local o
  for o in "img originals/$1".* "img originals/$1_original".*; do
    [[ -f "$o" ]] && { printf '%s' "$o"; return; }
  done
}

# the GPS of a photo, as decimal "lat lon" — from the untouched --unc file
# when there is one, else the original; empty when there is none (videos
# are not read: ffprobe has no portable GPS tags here)
gps_of_photo() {
  local src="" u
  for u in "img originals/$1--unc".*; do [[ -f "$u" ]] && { src="$u"; break; }; done
  [[ -n "$src" ]] || src=$(original_of "$1")
  [[ -n "$src" ]] || return 0
  is_video "$src" && return 0
  identify -quiet -format '%[EXIF:GPSLatitude]|%[EXIF:GPSLatitudeRef]|%[EXIF:GPSLongitude]|%[EXIF:GPSLongitudeRef]' "$src" 2>/dev/null \
    | awk -F'|' '
      function dec(s,   a, n, i, p, v, div) {
        n = split(s, a, ","); v = 0; div = 1
        for (i = 1; i <= n; i++) { split(a[i], p, "/"); v += (p[2] ? p[1] / p[2] : p[1] + 0) / div; div *= 60 }
        return v
      }
      $1 != "" && $3 != "" {
        lat = dec($1); if ($2 == "S") lat = -lat
        lon = dec($3); if ($4 == "W") lon = -lon
        printf "%.5f %.5f", lat, lon
      }'
  return 0
}

# a 1–3 word description of the photo (its thumbnail), asked of Claude —
# lowercase English, concrete nouns ("garage door", "snow on street").
# Needs ANTHROPIC_API_KEY and jq; empty without them or on any failure
describe() {
  [[ -n "${ANTHROPIC_API_KEY:-}" ]] || return 0
  command -v jq >/dev/null || return 0
  local b64; b64=$(base64 < "$1" | tr -d '\n')
  jq -n --arg img "$b64" '{
    model: "claude-haiku-4-5", max_tokens: 50,
    system: "You caption photos for an art archive. Reply with only a 1-3 word literal description of the main subject: lowercase English (capitals only for letters shown as shapes or stencils: L-shaped, a T, VA), concrete nouns, no article, no punctuation — like: snow on street, forest, clouds in sky, foot, garage door. Be precise about what the object actually is. Name its color only when the color is striking (bright orange, vivid green) — leave ordinary colors like gray or brown out. White may stay when it marks the object itself (white fruit) and the caption is two words, never as a third word. If the subject is geometric (grid, circle, spiral, zigzag, diamond), or the composition has stark geometric elements (a strong diagonal, repetition, symmetry), name that geometry even when it takes an extra word. Mind that snow under warm evening light can look like sand — check texture and season before calling it sandy.",
    messages: [{role: "user", content: [
      {type: "image", source: {type: "base64", media_type: "image/jpeg", data: $img}},
      {type: "text", text: "Caption this photo."}]}]}' \
  | curl -sS -m 30 https://api.anthropic.com/v1/messages \
      -H "Content-Type: application/json" -H "x-api-key: $ANTHROPIC_API_KEY" \
      -H "anthropic-version: 2023-06-01" -d @- 2>/dev/null \
  | jq -r '[.content[]? | select(.type == "text") | .text][0] // empty' \
  | head -1 | tr '[:upper:]' '[:lower:]' | tr -d '"' | cut -c1-40
  return 0
}

# the city-level name for decimal coordinates, from Nominatim (OSM) — the
# address field city, else town, village, municipality, in English — and
# the town centre's own coordinates: "name<TAB>lat<TAB>lon"; empty on any
# failure, so a missed one is simply asked again on the next run
geocode() {
  curl -sS -m 20 -A "afterworkphotos-ingest/1.0 (https://github.com/01msmr/afterworkphotos)" \
    "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=$1&lon=$2&zoom=10&accept-language=en" 2>/dev/null \
    | python3 -c '
import json, sys
try:
    r = json.load(sys.stdin); a = r.get("address", {})
except Exception:
    r, a = {}, {}
for k in ("city", "town", "village", "municipality"):
    if a.get(k):
        try:
            print("%s\t%.2f\t%.2f" % (a[k], float(r["lat"]), float(r["lon"])))
        except Exception:
            print(a[k])
        break
' 2>/dev/null
  return 0
}

tmp=$(mktemp "${TMPDIR:-/tmp}/ingest.XXXXXX")
map=$(mktemp "${TMPDIR:-/tmp}/ingest-map.XXXXXX")
idx=$(mktemp "${TMPDIR:-/tmp}/ingest-idx.XXXXXX")
pidx=$(mktemp "${TMPDIR:-/tmp}/ingest-pidx.XXXXXX")
didx=$(mktemp "${TMPDIR:-/tmp}/ingest-didx.XXXXXX")
cidx=$(mktemp "${TMPDIR:-/tmp}/ingest-cidx.XXXXXX")
used=$(mktemp "${TMPDIR:-/tmp}/ingest-used.XXXXXX")
trap 'rm -f "$tmp" "$map" "$idx" "$pidx" "$didx" "$cidx" "$used"' EXIT

# what exists, by date taken (digits) → id, from the last photos.json —
# and what already has a place, by date taken → place, so Nominatim is
# asked only about photos it has never seen
if [[ -f photos.json ]]; then
  sed -nE 's/.*"id": "([^"]+)", "taken": "([^"]+)".*/\2\t\1/p' photos.json \
    | awk -F'\t' '{gsub(/[^0-9]/, "", $1); print $1 "\t" $2}' > "$idx"
  sed -nE 's/.*"taken": "([^"]+)", "place": "([^"]+)".*/\1\t\2/p' photos.json \
    | awk -F'\t' '{gsub(/[^0-9]/, "", $1); print $1 "\t" $2}' > "$pidx"
  sed -nE 's/.*"taken": "([^"]+)", "place": [^,]*, "desc": "([^"]+)".*/\1\t\2/p' photos.json \
    | awk -F'\t' '{gsub(/[^0-9]/, "", $1); print $1 "\t" $2}' > "$didx"
  # the towns' centre coordinates, by place name
  sed -nE 's/^    "([^"]+)": \[(-?[0-9.]+), (-?[0-9.]+)\],?$/\1\t\2\t\3/p' photos.json > "$cidx"
fi
existing_with_taken() { [[ -n "$1" ]] && awk -F'\t' -v t="$1" '$1 == t {print $2; exit}' "$idx"; }
place_of() { [[ -n "$1" ]] && awk -F'\t' -v t="$1" '$1 == t {print $2; exit}' "$pidx"; return 0; }
desc_of() { [[ -n "$1" ]] && awk -F'\t' -v t="$1" '$1 == t {print $2; exit}' "$didx"; return 0; }
city_of() { [[ -n "$1" ]] && awk -F'\t' -v t="$1" '$1 == t {print $2 "\t" $3; exit}' "$cidx"; return 0; }

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
      -map_metadata 0 -movflags +faststart+use_metadata_tags \
      -c:v libx264 -crf 23 -preset medium -pix_fmt yuv420p -c:a aac -b:a 96k "img/$id.mp4"
    ffmpeg -v error -y -i "img/$id.mp4" -frames:v 1 -q:v 3 "img/$id.jpg"
    ffmpeg -v error -y -i "$f" -vf "crop='min(iw,ih)':'min(iw,ih)'" \
      -map_metadata 0 -movflags +use_metadata_tags \
      -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -c:a copy "img originals/$id.mp4"
    move "$f" "img originals/$id--unc.$ext"
    git add "img/$id.mp4" "img/$id.jpg"
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
    d=$(taken_of_photo "$id")
    (( ${#d} >= 8 )) || d="99999999"
    printf '%s\t%s\n' "$d" "$id"
  done | sort -s -t $'\t' -k1,1
)

: > "$map"     # lines: old id <TAB> new id
prev_day=""; nn=0
for id in "${ordered[@]}"; do
  d=$(taken_of_photo "$id")
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
  o=$(original_of "$old"); [[ -n "$o" ]] && movef "$o" "img originals/renum_$old.${o##*.}"
  for u in "img originals/$old--unc".*; do [[ -f "$u" ]] && movef "$u" "img originals/renum_$old--unc.${u##*.}"; done
done < "$map"
# phase 2: the new names
while IFS=$'\t' read -r old new; do
  [[ "$old" == "$new" ]] && continue
  git mv "img/renum_$old.jpg" "img/$new.jpg"
  [[ -f "img/renum_$old.mp4" ]] && git mv "img/renum_$old.mp4" "img/$new.mp4"
  [[ -f "img/thumb/renum_$old.jpg" ]] && git mv "img/thumb/renum_$old.jpg" "img/thumb/$new.jpg"
  for o in "img originals/renum_$old".*; do [[ -f "$o" ]] && movef "$o" "img originals/$new.${o##*.}"; done
  for u in "img originals/renum_$old--unc".*; do [[ -f "$u" ]] && movef "$u" "img originals/$new--unc.${u##*.}"; done
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
    d=$(taken_of_photo "$name")
    taken_json=null
    (( ${#d} >= 14 )) && taken_json="\"${d:0:4}-${d:4:2}-${d:6:2}T${d:8:2}:${d:10:2}:${d:12:2}\""
    place=$(place_of "$d" || true)
    coords=""; [[ -n "$place" ]] && coords=$(city_of "$place" || true)
    if [[ -z "$place" || -z "$coords" ]]; then
      gps=$(gps_of_photo "$name" || true)
      if [[ -n "$gps" ]]; then
        read -r glat glon <<< "$gps"
        IFS=$'\t' read -r gname gplat gplon <<< "$(geocode "$glat" "$glon" || true)"
        sleep 1     # Nominatim asks for at most one request per second
        if [[ -z "$place" && -n "${gname:-}" ]]; then place=$gname; echo "place for $name: $place" >&2; fi
        if [[ -n "$place" && -z "$coords" && -n "${gplat:-}" ]]; then
          coords="$gplat	$gplon"
          printf '%s\t%s\t%s\n' "$place" "$gplat" "$gplon" >> "$cidx"
          echo "centre of $place: $gplat $gplon" >&2
        fi
      fi
    fi
    [[ -n "$place" ]] && printf '%s\n' "$place" >> "$used"
    place_json=null
    [[ -n "$place" ]] && place_json="\"$(printf '%s' "$place" | sed 's/\\/\\\\/g; s/"/\\"/g')\""
    desc=$(desc_of "$d" || true)
    if [[ -z "$desc" && -f "img/thumb/$name.jpg" ]]; then
      desc=$(describe "img/thumb/$name.jpg" || true)
      [[ -n "$desc" ]] && echo "desc for $name: $desc" >&2
    fi
    desc_json=null
    [[ -n "$desc" ]] && desc_json="\"$(printf '%s' "$desc" | sed 's/\\/\\\\/g; s/"/\\"/g')\""
    video_json=null; [[ -f "img/$name.mp4" ]] && video_json="\"img/$name.mp4\""
    sep=','; (( n == ${#names[@]} )) && sep=''
    printf '    {"n": %d, "id": "%s", "taken": %s, "place": %s, "desc": %s, "file": "img/%s.jpg", "thumb": "img/thumb/%s.jpg", "video": %s}%s\n' \
      "$n" "$name" "$taken_json" "$place_json" "$desc_json" "$name" "$name" "$video_json" "$sep"
  done
  echo '  ],'
  echo '  "places": {'
  sort -u "$used" | while IFS= read -r c; do awk -F'\t' -v t="$c" '$1 == t {print; exit}' "$cidx"; done \
    | awk -F'\t' 'NF == 3 { l[++k] = "    \"" $1 "\": [" $2 ", " $3 "]" } END { for (i = 1; i <= k; i++) print l[i] (i < k ? "," : "") }'
  echo '  }'
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
