#!/usr/bin/env python3
"""Bake the gallery's text into one signed-distance atlas.

    python3 scripts/make-sdf-font.py

Every label card was a canvas of its own — 1024 x 363, 1.4 MB, one per
photograph, 105 MB in a large room, and it went soft as soon as a card was
doubled. A distance field is a picture of *how far every pixel is from the
edge of a letter*, so one small atlas draws any letter at any size with a
clean edge: the whole gallery's text, cards and lift buttons alike, out of
about a megabyte that never grows with the number of photographs.

Three faces, matching what the canvases asked for: the card's first line
(600) takes Bold, its other lines (500) Medium, a lift button (300) Light.

Writes res/sdf-font.png (grey, one channel's worth) and res/sdf-font.json
(per glyph: advance, bearing, size, and its place in the atlas).
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
TTC = '/System/Library/Fonts/HelveticaNeue.ttc'
FACES = {'bold': 1, 'medium': 10, 'light': 7}     # weight 600 / 500 / 300
EM = 96                  # the size each glyph is drawn at before the field is measured
CELL = 64                # the size of its cell in the atlas
GUTTER = 8               # **empty field around each glyph inside its cell.** Without it the
                         # cells touch, and a mipmap of the atlas — which is what a label
                         # across the room is read from — averages a letter together with
                         # its neighbours in the sheet. Text at distance turned to mush
                         # (Uli, 2026-09-13). The glyph is drawn at CELL - 2*GUTTER and the
                         # UVs point at that inner square.
SPREAD = 12.0            # how far from an edge the field still says something, in EM pixels
COLS = 20
CHARS = ''.join(chr(c) for c in range(32, 127)) + 'ÄÖÜäöüßÀÁÂÈÉÊÍÎÑÓÔÚàáâçèéêíîñóôöúû–—·’‘“”…'


def edt1d(f):
    """Felzenszwalb's exact 1-D squared distance transform, along the last axis."""
    n = f.shape[-1]
    d = np.empty_like(f)
    v = np.zeros(f.shape[:-1] + (n,), dtype=np.intp)
    z = np.empty(f.shape[:-1] + (n + 1,), dtype=np.float64)
    for idx in np.ndindex(f.shape[:-1]):
        fi = f[idx]
        k = 0
        v[idx][0] = 0
        z[idx][0], z[idx][1] = -np.inf, np.inf
        for q in range(1, n):
            while True:
                p = v[idx][k]
                s = ((fi[q] + q * q) - (fi[p] + p * p)) / (2 * q - 2 * p)
                if s <= z[idx][k] and k > 0:
                    k -= 1
                else:
                    break
            k += 1
            v[idx][k] = q
            z[idx][k] = s
            z[idx][k + 1] = np.inf
        k = 0
        for q in range(n):
            while z[idx][k + 1] < q:
                k += 1
            p = v[idx][k]
            d[idx][q] = (q - p) ** 2 + fi[p]
    return d


def edt(mask):
    """Euclidean distance, in pixels, from every False cell to the nearest True one."""
    big = 1e12
    f = np.where(mask, 0.0, big)
    return np.sqrt(edt1d(edt1d(f).T).T)


def field(mask):
    """The signed field: positive inside the letter, in EM pixels."""
    inside = edt(~mask)          # distance from inside cells out to the background
    outside = edt(mask)          # distance from outside cells in to the letter
    return np.where(mask, inside, -outside)


def main():
    fonts = {}
    for name, i in FACES.items():
        try:
            fonts[name] = ImageFont.truetype(TTC, EM, index=i)
        except Exception as e:
            print(f'cannot open face {name} ({i}): {e}')
            return 1

    glyphs, cells, faces = {}, [], {}
    for face, font in fonts.items():
        asc, desc = font.getmetrics()
        # the two the layout needs: where the baseline sits under the top of
        # the line, and how deep the line goes — both in em, so a size in
        # metres or in pixels lays out the same way
        faces[face] = {'asc': asc / EM, 'desc': desc / EM}
        for ch in CHARS:
            if ch == ' ':
                glyphs[f'{face}|{ch}'] = {'adv': font.getlength(ch) / EM, 'w': 0, 'h': 0, 'bx': 0, 'by': 0, 'cell': -1}
                continue
            box = font.getbbox(ch)
            if box is None or box[2] <= box[0] or box[3] <= box[1]:
                glyphs[f'{face}|{ch}'] = {'adv': font.getlength(ch) / EM, 'w': 0, 'h': 0, 'bx': 0, 'by': 0, 'cell': -1}
                continue
            pad = int(SPREAD) + 2
            w, h = box[2] - box[0] + 2 * pad, box[3] - box[1] + 2 * pad
            im = Image.new('L', (w, h), 0)
            ImageDraw.Draw(im).text((pad - box[0], pad - box[1]), ch, font=font, fill=255)
            mask = np.array(im) > 127
            if not mask.any():
                glyphs[f'{face}|{ch}'] = {'adv': font.getlength(ch) / EM, 'w': 0, 'h': 0, 'bx': 0, 'by': 0, 'cell': -1}
                continue
            sdf = np.clip(field(mask) / SPREAD, -1, 1) * 0.5 + 0.5      # 0..1, the edge at 0.5
            inner = CELL - 2 * GUTTER
            small = Image.fromarray((sdf * 255).astype(np.uint8)).resize((inner, inner), Image.BILINEAR)
            cell = Image.new('L', (CELL, CELL), 0)      # 0 = far outside any letter
            cell.paste(small, (GUTTER, GUTTER))
            glyphs[f'{face}|{ch}'] = {
                'adv': font.getlength(ch) / EM,
                'w': w / EM, 'h': h / EM,                       # the quad, in em
                'bx': (box[0] - pad) / EM,                      # its corner from the pen, in em
                'by': (asc - box[1] + pad) / EM,                # up from the baseline
                'cell': len(cells),
            }
            cells.append(cell)
        print(f'{face}: {len([k for k in glyphs if k.startswith(face + "|")])} glyphs')

    rows = (len(cells) + COLS - 1) // COLS
    atlas = Image.new('L', (COLS * CELL, rows * CELL), 0)
    for i, cell in enumerate(cells):
        atlas.paste(cell, ((i % COLS) * CELL, (i // COLS) * CELL))
    out_png, out_json = ROOT / 'res' / 'sdf-font.png', ROOT / 'res' / 'sdf-font.json'
    atlas.save(out_png, optimize=True)
    json.dump({'cell': CELL, 'gutter': GUTTER, 'cols': COLS, 'rows': rows, 'spread': SPREAD / EM,
               'em': EM, 'faces': faces, 'glyphs': glyphs}, open(out_json, 'w'), separators=(',', ':'))
    print(f'\n{len(cells)} cells, atlas {atlas.width}x{atlas.height} -> {out_png.name} '
          f'({out_png.stat().st_size // 1024} KB on disk, {atlas.width * atlas.height / 1048576:.2f} MB as one channel in memory)')
    print(f'{out_json.name} {out_json.stat().st_size // 1024} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
