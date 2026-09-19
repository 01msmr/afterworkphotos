#!/bin/sh
# The guard's lines, mono 24 kHz 48 kbps:
#   scripts/guard-voice.sh de          all German lines from res/sound/guard/de/lines.json — Microsoft's neural "Conrad" through edge-tts
#   scripts/guard-voice.sh en KIND...  English lines of the kinds given from guard.js — macOS `say -v Alex -r 150`
# edge-tts: `python3 -m venv ~/.venvs/tts && ~/.venvs/tts/bin/pip install edge-tts`, or set EDGE_TTS to its path.
set -e
cd "$(dirname "$0")/.."
LANG_=$1; shift
EDGE_TTS=${EDGE_TTS:-$(command -v edge-tts || echo "$HOME/.venvs/tts/bin/edge-tts")}
python3 - "$LANG_" "$EDGE_TTS" "$@" <<'PY'
import json, re, subprocess, os, sys
lang, edge, kinds = sys.argv[1], sys.argv[2], sys.argv[3:]
if lang == 'de':
    lines = json.load(open('res/sound/guard/de/lines.json')); out = 'res/sound/guard/de'
else:
    src = open('res/gallery/guard.js').read()
    body = src[src.index('const LINES = {'):src.index('\n};', src.index('const LINES = {'))]
    lines = {}
    for m in re.finditer(r"\n\t(\w+): \[\n(.*?)\n\t\]", body, re.S):
        lines[m.group(1)] = [re.sub(r"\\u2019", "’", t).replace("\\'", "'") for t in re.findall(r"^\t\t'(.*)',$", m.group(2), re.M)]
    out = 'res/sound/guard'
for kind, arr in lines.items():
    if kinds and kind not in kinds: continue
    for i, text in enumerate(arr):
        key = f'{kind}-{i}'; raw = f'{out}/{key}.raw.' + ('mp3' if lang == 'de' else 'aiff')
        if lang == 'de': subprocess.run([edge, '-v', 'de-DE-ConradNeural', '--rate=-8%', '-t', text, '--write-media', raw], check=True)
        else: subprocess.run(['say', '-v', 'Alex', '-r', '150', '-o', raw, text], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-ac', '1', '-ar', '24000', '-b:a', '48k', f'{out}/{key}.mp3'], check=True)
        os.remove(raw); print(key)
PY
