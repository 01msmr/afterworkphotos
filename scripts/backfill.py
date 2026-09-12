#!/usr/bin/env python3
"""Fill a photograph's files from a folder of original photographs.

    python3 scripts/backfill.py ~/Pictures/whatever [--write]

Two files are made for each photograph the folder holds: img/2000/<id>.jpg,
the one a print swaps to when a visitor comes close, and img/<id>.jpg, the
1200 px square the site shows and the gallery hangs — the latter only where
the original has more to give than the file already there (a photograph
imported when 1000 px was the size). Neither is ever enlarged.

The folder may hold anything: the gallery's photographs, other people's,
duplicates, screenshots, videos, a whole camera roll. **Names do not
matter** — the gallery's files are called awp-2009-06-12-01.jpg and an
original is called IMG_4312.HEIC, and neither tells you anything. Each
candidate is matched to a photograph by what it looks like:

  * every gallery photograph already has a square in img/, made from the
    original by a centre crop and a resize;
  * so each candidate is centre-cropped, resized to 32x32, turned grey
    and normalised, and compared with the same of every gallery photo;
  * the best match counts only when it is **clearly** the best — under
    the distance a resize and a re-encode can explain, and well ahead of
    the runner-up. Anything closer than that is left alone and reported,
    never guessed.
  * where a candidate carries an EXIF capture time and a photograph's
    `taken` matches it to the second, that settles it on its own.

Nothing is written without --write, and nothing already good enough is
touched unless --force is given. Every photograph still without a 2000 px
file is listed at the end, so it is plain what is left.
"""
import json, sys
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
BIG = 2000                       # img/2000/<id>.jpg — the print up close
SITE = 1200                      # img/<id>.jpg — the site, and the wall
FP = 32                          # the fingerprint's side
NEAR = 9.0                       # mean grey difference a resize can explain (0-255)
CLEAR = 1.6                      # and how much better the best must be than the next
KINDS = {'.jpg', '.jpeg', '.png', '.heic', '.heif', '.tif', '.tiff', '.webp'}


def square(im):
    """The centre square, as the gallery's own derivatives are cut."""
    w, h = im.size
    s = min(w, h)
    return im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))


def fingerprint(path):
    try:
        im = Image.open(path)
        im = ImageOps.exif_transpose(im)
        im = square(im).convert('L').resize((FP, FP), Image.BILINEAR)
    except Exception:
        return None, None
    px = list(im.tobytes())          # the grey bytes, one per pixel
    lo, hi = min(px), max(px)
    span = max(1, hi - lo)
    flat = [(v - lo) * 255 // span for v in px]       # normalised: exposure and re-encoding drift
    taken = None
    try:
        ex = Image.open(path).getexif()
        taken = ex.get(36867) or ex.get(306)           # DateTimeOriginal, else DateTime
    except Exception:
        pass
    return flat, taken


def distance(a, b):
    return sum(abs(x - y) for x, y in zip(a, b)) / len(a)


def width_of(path):
    """The width of a file that may not be there, 0 when it is not."""
    try:
        with Image.open(path) as im:
            return im.size[0]
    except Exception:
        return 0


def save(sq, dst, side, quality):
    """The square, shrunk to `side` if it is larger, written as a JPEG.

    No metadata is carried over — the public files keep none of the GPS
    the originals hold.
    """
    im = sq.resize((side, side), Image.LANCZOS) if min(sq.size) > side else sq
    im.convert('RGB').save(dst, 'JPEG', quality=quality, optimize=True)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = {a for a in sys.argv[1:] if a.startswith('--')}
    if not args:
        print(__doc__)
        return 1
    src = Path(args[0]).expanduser()
    write, force = '--write' in flags, '--force' in flags

    photos = json.load(open(ROOT / 'photos.json'))['photos']
    print(f'{len(photos)} photographs in the gallery; reading their squares…')
    known = []
    for p in photos:
        f = ROOT / p['file']
        if not f.exists():
            continue
        fp, _ = fingerprint(f)
        if fp:
            known.append((p, fp, (p['taken'] or '').replace('-', ':').replace('T', ' ')))

    cands = [f for f in src.rglob('*') if f.suffix.lower() in KINDS and f.is_file()]
    print(f'{len(cands)} images in {src}')

    out = ROOT / 'img' / '2000'
    out.mkdir(parents=True, exist_ok=True)
    taken_by, ambiguous, ignored = {}, [], 0

    for c in cands:
        fp, when = fingerprint(c)
        if not fp:
            ignored += 1
            continue
        scored = sorted(((distance(fp, k[1]), k[0]) for k in known), key=lambda t: t[0])
        best, second = scored[0], (scored[1] if len(scored) > 1 else (999, None))
        byTime = [k[0] for k in known if when and k[2] and when.startswith(k[2][:19])]
        if byTime and best[0] < NEAR * 2:
            p = byTime[0]
        elif best[0] < NEAR and best[0] * CLEAR < second[0]:
            p = best[1]
        elif best[0] < NEAR:
            ambiguous.append((c.name, best[1]['id'], round(best[0], 1), second[1]['id'], round(second[0], 1)))
            continue
        else:
            ignored += 1
            continue
        # the largest candidate wins, where a photograph appears twice
        have = taken_by.get(p['id'])
        if have is None or c.stat().st_size > have[0].stat().st_size:
            taken_by[p['id']] = (c, round(best[0], 1))

    print(f'\nmatched {len(taken_by)}, ambiguous {len(ambiguous)}, ignored {ignored}')
    for row in ambiguous[:20]:
        print('  ambiguous:', row)

    big = site = skipped = small = 0
    for pid, (c, d) in sorted(taken_by.items()):
        dst_big, dst_site = out / f'{pid}.jpg', ROOT / 'img' / f'{pid}.jpg'
        with Image.open(c) as im:
            native = min(im.size)
        if native < BIG:
            small += 1
        want_big = force or not dst_big.exists()
        # the site's file is rewritten only where the original has more to
        # give than what hangs there now — the 1200s already made stay put
        want_site = force or min(native, SITE) > width_of(dst_site)
        if not (want_big or want_site):
            skipped += 1
            continue
        big += want_big
        site += want_site
        if not write:
            continue
        with Image.open(c) as im:
            sq = square(ImageOps.exif_transpose(im))
            if want_big:
                save(sq, dst_big, BIG, 85)
            if want_site:
                save(sq, dst_site, SITE, 86)

    verb = 'wrote' if write else 'would write'
    print(f'{verb} {big} at {BIG}px and {site} at {SITE}px, '
          f'nothing to do for {skipped}, originals smaller than {BIG}px {small}')
    missing = [p['id'] for p in photos if not (out / f"{p['id']}.jpg").exists()]
    print(f'still without a {BIG}px file: {len(missing)}')
    for m in missing[:15]:
        print('  ', m)
    if len(missing) > 15:
        print(f'   … and {len(missing) - 15} more')
    if not write:
        print('\nnothing was written — add --write when the numbers look right')
    return 0


if __name__ == '__main__':
    sys.exit(main())
