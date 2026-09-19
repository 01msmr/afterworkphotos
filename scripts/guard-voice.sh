#!/bin/sh
# The guard's lines recorded with macOS `say`, mono 24 kHz 48 kbps:
#   scripts/guard-voice.sh de          all German lines (Anna) from res/sound/guard/de/lines.json
#   scripts/guard-voice.sh en KIND...  English lines of the kinds given (Alex) from guard.js
# Alex and Anna at 150, plain — the same generation for both languages.
set -e
cd "$(dirname "$0")/.."
LANG_=$1; shift
python3 - "$LANG_" "$@" <<'PY'
import json, re, subprocess, os, sys
lang, kinds = sys.argv[1], sys.argv[2:]
if lang == 'de':
    lines = json.load(open('res/sound/guard/de/lines.json')); voice, out = 'Anna', 'res/sound/guard/de'
else:
    src = open('res/gallery/guard.js').read()
    body = src[src.index('const LINES = {'):src.index('\n};', src.index('const LINES = {'))]
    lines = {}
    for m in re.finditer(r"\n\t(\w+): \[\n(.*?)\n\t\]", body, re.S):
        lines[m.group(1)] = [re.sub(r"\\u2019", "’", t).replace("\\'", "'") for t in re.findall(r"^\t\t'(.*)',$", m.group(2), re.M)]
    voice, out = 'Alex', 'res/sound/guard'
for kind, arr in lines.items():
    if kinds and kind not in kinds: continue
    for i, text in enumerate(arr):
        key = f'{kind}-{i}'; aiff = f'{out}/{key}.aiff'
        subprocess.run(['say', '-v', voice, '-r', '150', '-o', aiff, text], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', aiff, '-ac', '1', '-ar', '24000', '-b:a', '48k', f'{out}/{key}.mp3'], check=True)
        os.remove(aiff); print(key)
PY
