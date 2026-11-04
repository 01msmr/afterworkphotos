#!/usr/bin/env python3
"""Lay down the TRMNL pools: a directory of symlinks per day, days ahead.

Each day gets `img/trmnl/YYYY-MM-DD/`, holding links to the photos the display
may show that day. nginx rewrites one fixed address to today's directory and
serves a random file from it (random_index), so the plugin asks for the same URL
every refresh and gets a different picture. Nothing is rendered and nothing is
copied — the links point one level up, at the plain 1200 px files the site
already serves. `img/trmnl/` is gitignored, so the server's pull never sees it.

The pool is the last 30 days plus the same day in any year, give or take a day.
Where that leaves fewer than four, the window widens a day at a time until it
does not — the collection is thin in recent years and the plain rule runs empty
on 77 days of the year.

Run it monthly; it is cheap to run more often and rebuilding is idempotent.

    python3 scripts/trmnl.py --days 40
    python3 scripts/trmnl.py --days 7 --date 2026-07-01 --pool /tmp/try
    python3 scripts/trmnl.py --selftest
"""
import argparse
import json
import os
import pathlib
import shutil
import sys
from datetime import date, datetime, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
PHOTOS, IMG = ROOT / 'photos.json', ROOT / 'img'
POOL = IMG / 'trmnl'    # the day directories, beside the photos they link to

RECENT_DAYS = 30        # how far back "lately" reaches
WINDOW = 1              # the same day in any year, give or take this many
WANT = 4                # widen the window until at least this many qualify
WINDOW_MAX = 30         # and no further
DAYS = 40               # how far ahead to lay pools down
KEEP_BACK = 3           # and how many past days to leave standing


def load(path=PHOTOS):
    photos = json.loads(path.read_text())['photos']
    return [(datetime.fromisoformat(p['taken']).date(), p) for p in photos]


def pool(taken, day, window=WINDOW):
    """The photos in range on `day`, newest first."""
    picked = {}
    days = {day + timedelta(days=k) for k in range(-window, window + 1)}
    for d, p in taken:
        if 0 <= (day - d).days <= RECENT_DAYS:
            picked[p['n']] = p
        elif any((d.month, d.day) == (t.month, t.day) for t in days):
            picked[p['n']] = p
    return [picked[n] for n in sorted(picked, reverse=True)]


def widen(taken, day):
    """Grow the window until the pool holds WANT, or WINDOW_MAX gives up."""
    got, w = [], WINDOW
    for w in range(WINDOW, WINDOW_MAX + 1):
        got = pool(taken, day, w)
        if len(got) >= WANT:
            break
    return got, w


def links_only(dirpath):
    """Every entry a symlink — the guard before anything is removed."""
    for e in dirpath.iterdir():
        if not e.is_symlink():
            raise SystemExit(f'{e} is not a symlink — refusing to touch {dirpath}')


def relink(dirpath, photos, img=IMG):
    """Replace the day's links with one per photo."""
    dirpath.mkdir(parents=True, exist_ok=True)
    links_only(dirpath)
    for old in dirpath.iterdir():
        old.unlink()
    for p in photos:
        target = img / pathlib.Path(p['file']).name
        if not target.exists():
            print(f"  {dirpath.name}: skipped {p['n']}, {target.name} is missing", file=sys.stderr)
            continue
        (dirpath / target.name).symlink_to(os.path.relpath(target, dirpath))


def prune(root, before):
    """Drop the day directories now behind us."""
    gone = 0
    for d in root.iterdir():
        if not d.is_dir():
            continue
        try:
            when = date.fromisoformat(d.name)
        except ValueError:
            continue                      # not ours; leave it alone
        if when < before:
            links_only(d)
            shutil.rmtree(d)
            gone += 1
    return gone


def selftest(taken):
    """The rule's promises, over a year: never short, never empty, never stuck."""
    first = date(date.today().year, 1, 1)
    days = [first + timedelta(days=i) for i in range(365)]
    sizes, windows = [], []
    for d in days:
        got, w = widen(taken, d)
        assert len(got) >= WANT, f'{d}: only {len(got)} photos at window {w}'
        assert w <= WINDOW_MAX, f'{d}: window ran to {w}'
        assert len({p['n'] for p in got}) == len(got), f'{d}: a photo twice'
        sizes.append(len(got))
        windows.append(w)
    sizes.sort()
    print(f'365 days checked: pool {min(sizes)}-{max(sizes)}, median {sizes[182]}')
    print(f'window stayed at {WINDOW} on {windows.count(WINDOW)} days, worst {max(windows)}')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pool', type=pathlib.Path, default=POOL,
                    help=f'the root the day directories live in (default {POOL.relative_to(ROOT)})')
    ap.add_argument('--days', type=int, default=DAYS, help=f'days ahead to lay down (default {DAYS})')
    ap.add_argument('--date', help='the first day, YYYY-MM-DD, default today')
    ap.add_argument('--selftest', action='store_true')
    args = ap.parse_args()

    taken = load()
    if args.selftest:
        return selftest(taken)

    start = date.fromisoformat(args.date) if args.date else date.today()
    args.pool.mkdir(parents=True, exist_ok=True)
    total = 0
    for i in range(args.days):
        day = start + timedelta(days=i)
        photos, w = widen(taken, day)
        relink(args.pool / day.isoformat(), photos)
        total += len(photos)
        if i < 3:
            print(f"  {day}  ±{w}  {len(photos):2} photos  {', '.join(str(p['n']) for p in photos[:6])}")
    dropped = prune(args.pool, start - timedelta(days=KEEP_BACK))
    print(f'{args.pool}: {args.days} days laid down, {total} links, {dropped} old days dropped')
    return 0


if __name__ == '__main__':
    sys.exit(main())
