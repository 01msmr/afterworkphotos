# The TRMNL X screen

A 10.3" e-paper panel, 1872×1404, 16 greys, in a light grey frame. It shows one
photograph: the 1200 px file the site already serves, at native size, centred on
a surround of grey 153 — the frame's own colour, so the screen edge disappears
into it. The print is embossed into that sheet, the same press as the card deck
on iOS (`.awphoto` in `res/main.css`): a 24 px corner, a 12 px shoulder of paper
rolled down outside the print, and an 8 px fillet inside where the sheet
flattens onto the floor of the recess.

The sheet descends without interruption from the surround to the floor, so the
normal tilts one way through both turns and the shading is **one** band peaking
at the border — not two of opposite sign. The floor fillet is therefore the
shoulder rotated 180° about x: the same colours, offsets negated, lengths 8/12.
Measured on a flat 153 print, the top edge runs 153 → 136 → 119 over 12 px
outside, 85 at the crest, then back to 153 over 8 px inside; the bottom runs
153 → 187 inside and out. The lit side is held at 0.44/0.25 so the highlight
tops out a ramp step below the shadow's depth, which otherwise reads as a glare.

No images are generated for the device: the emboss is CSS in the plugin's
markup, which TRMNL renders, and the photograph is the file the site already
serves. The plugin asks for one fixed address and gets a different picture back
each time.

## The pool

`trmnl/pool.php` lays down a directory of symlinks per day:

    img/trmnl/2026-11-05/awp-2018-11-04-01.jpg -> ../../awp-2018-11-04-01.jpg

A day's pool is the last 30 days plus the same day in any year, give or take a
day. Where that leaves fewer than four photographs the window widens a day at a
time until it does not — the collection thinned out in recent years and the plain
rule runs empty on 77 days of the year. Over a year the pools hold 4–20 pictures,
median 5, and the window stays at ±1 on 194 days (`--selftest`).

The script only ever makes and removes symlinks. It refuses to touch a day
directory holding anything else, and it drops the day directories now behind us,
keeping three.

The pool sits in `img/trmnl/`, beside the photographs it links to, so each link
is just two levels up. `img/trmnl/` is in `.gitignore`, so the Git deployment
never sees it.

    php trmnl/pool.php --days 40
    php trmnl/pool.php --selftest

Forty days ahead means a weekly run has five weeks of slack if one is missed. A
photograph added between runs does not reach the panel until the next one; that
is the price of the cadence, and `--days 7` daily removes it.

## The server

afterworkphotos runs on **netcup Webhosting with Plesk** — a shared plan. There
is no shell and no custom nginx configuration (the *Apache und nginx* page
offers only preset toggles), so nginx's `random_index`, which would have served
a random file straight out of a directory, is not available. `trmnl/photo.php`
does that job instead, in a dozen lines.

**Why PHP and not Python.** Scheduled tasks run in a chroot with
`PATH=/usr/bin:/bin` and no Python in it at all — `/bin` holds `php`, `ln`,
`git`, `curl` and little else. So the rule lives in PHP, once. A Python twin
would be a second copy of the same rule, drifting.

**Hosting und DNS → Geplante Aufgaben**, weekly, *Befehl ausführen*:

    php /afterworkphotos.com/httpdocs/trmnl/pool.php --days 40

The chroot's root is the subscription, one directory per domain, so the path is
`/afterworkphotos.com/httpdocs` — **not** the bare `/httpdocs`, which is the
primary domain's. No `cd` is needed; the script finds `photos.json` and `img/`
from its own location. Set *Benachrichtigen* to **Nur Fehler**: a silent failure here means
the panel quietly freezes on a stale pool weeks later. The task's timezone is
Europe/Berlin, the same clock `photo.php` reads, so the directory the task
writes and the one the picker looks for always agree.

**`trmnl/photo.php`** reads today's pool directory, picks a name, and sends the
photograph's bytes.

**It serves the file rather than redirecting to it**, which cost an afternoon to
learn. A 302 to `img/<name>.jpg` works perfectly in the markup editor, because
that preview is fetched by your own browser — but the device screen is rendered
on TRMNL's servers, and their image fetcher does not follow the redirect. The
panel showed a missing-image placeholder while the preview looked right. So PHP
reads the file and writes it out; ~600 kB once per refresh costs nothing.

**The pick is a shuffled bag, not a coin toss.** A pool holds four or five
pictures, so a fair random choice lands on the one already showing about a fifth
of the time — a dozen times a day at a quarter-hourly refresh — and a repeat on
e-paper reads as a failed refresh rather than as chance. Instead every picture is
shown once before any is shown again, in a fresh order each pass, and a new pass
never opens on the picture the previous one ended with. What is left of the
current pass lives in `img/trmnl/.bag.json`; a changed pool opens a new bag, and
if the file cannot be written the code falls back to a plain random pick.

Two more things worth knowing:

- The webserver never follows a symlink: PHP reads through the link itself and
  writes the bytes, so *Fähigkeit, symbolischen Verknüpfungen zu folgen,
  einschränken* being on does not affect this.
- The response carries `X-Awp-Photo`, so a `HEAD` says which photograph is
  current without pulling it:
  `curl -sI https://afterworkphotos.com/trmnl/photo.php | grep -i x-awp`

If no pool exists for today — the task lapsed, or the clock sits either side of
a day boundary — it falls back to the **nearest** day it can find, not the
newest. The newest would show December's photographs in November.

The Git deployment puts both files in place; nothing is installed by hand.

## The plugin

A private plugin, **strategy None** — the markup is self-contained, there is no
data for TRMNL to fetch or merge. The markup is `docs/trmnl-plugin.html`: one
`view view--full`, the surround, the fillets, and the `<img>` pointed at
`https://afterworkphotos.com/trmnl/photo.php`.

**The markup is in CSS pixels, not panel pixels.** TRMNL X is 1040×780 CSS px
at a device pixel ratio of 1.8, which is the 1872×1404 panel. So the markup
states every length in physical pixels and multiplies by `--css`: the 1200 px
photograph becomes 666.67 CSS px, lands on 1200.0 device px, and is still 1:1
with nothing resampled. Writing 1872×1404 straight into the markup overflows
the view by 1.8× and crops it to the top left.

Do not give the view a fixed size — `view--full` is already the screen. In the
plugin's settings, turn off the bleed margin, or the surround is inset and stops
meeting the frame. The `image-dither` class is TRMNL's own handling for a
photograph on a grey ramp.
