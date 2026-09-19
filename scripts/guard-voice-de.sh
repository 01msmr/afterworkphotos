#!/bin/sh
# The guard's German lines, recorded with macOS `say` (voice Reed, de_DE)
# from res/sound/guard/de/lines.json into res/sound/guard/de/<kind>-<i>.mp3,
# mono 24 kHz 48 kbps like the English ones. Sharper kinds a little
# quicker and higher, as the English were.
set -e
cd "$(dirname "$0")/../res/sound/guard/de"
python3 - <<'EOF'
import json, subprocess, os
lines = json.load(open('lines.json'))
sharp = {'warn': (165, 2), 'rush': (175, 3), 'call': (170, 4), 'harsh': (165, 3), 'stop': (185, 5), 'last': (160, 2), 'closed': (150, 0)}
for kind, arr in lines.items():
    rate, pitch = sharp.get(kind, (145, 0))
    for i, text in enumerate(arr):
        key = f'{kind}-{i}'
        aiff = f'{key}.aiff'
        spoken = (f'[[pbas +{pitch}]] ' if pitch else '') + text
        subprocess.run(['say', '-v', 'Reed', '-r', str(rate), '-o', aiff, spoken], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', aiff, '-ac', '1', '-ar', '24000', '-b:a', '48k', f'{key}.mp3'], check=True)
        os.remove(aiff)
        print(key)
EOF
