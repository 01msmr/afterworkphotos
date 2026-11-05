# The TRMNL X screen

A 10.3" e-paper panel, 1872×1404, 16 greys, in a light grey frame. It shows one
photograph: the 1200 px file the site already serves, at native size, centred on
a surround of grey 153 — the frame's own colour, so the screen edge disappears
into it. Around the photograph, following its 24 px corner, a **3 px outline**.

**It is laid out as a sheet of the card deck** (2026-11-05): the print's name —
`afterworkphoto 217` — in the band above the photograph, its right edge on the
photograph's, and under it one line with the description at the left end and the
place and date taken, quiet and lowercase, at the right. Each band is 102 px tall
— `(1404 − 1200) / 2` — the name's line 46 and the quiet one 37, so each stands
in the middle of its band and the photograph keeps the middle of the screen.
Nothing is measured: both bands are `(100% − print) / 2`, the formula meaning
the surround beside the print sideways and the band under it downwards.

**The surround stays 153 in both modes; the outline and the lettering invert.**
Light: white outline, black lettering, 4.7∶1 against the surround. Dark
(`.screen--dark-mode`): black outline, white lettering, 2.3∶1 — the weaker pair,
and the price of the surround keeping the frame's own grey. 153, 0 and 255 are
exact steps of the 16, so neither the surround nor the line ever dithers; the
quiet type, 55 % of the ink, lands on 69 light and 209 dark, a few points off a
step.

No images are generated for the device: the outline and the lettering are CSS in
the plugin's markup, which TRMNL renders, and the photograph is the file the site
already serves.

### Why 3 px

**At 227 PPI the width is not a matter of taste.** One arcminute of acuity is
about 0.29 mm at a metre, so

| | physical | at 1 m |
|---|---|---|
| 1 px | 0.11 mm | under the eye's resolution — a dirty edge, not a line |
| 2 px | 0.22 mm | on the threshold: reads in some light, not in others |
| 3 px | 0.33 mm | just resolvable, reads as deliberate |
| 4 px | 0.45 mm | clearly a frame |

So 1 px is out and 2 px is the worst of the four, being exactly at the limit.
**3 px** is the thinnest that holds; 4 px if it should read as a frame rather
than a hairline. Screen instinct is a poor guide here — on a phone 1 px is a
good hairline, and this panel wants roughly three times that.

Both 255 and 0 sit exactly on the 16 grey ramp, so the line never dithers;
only the rounded corners soften, and the surround stays flat 153 out to the
screen edge.

The ring is drawn with a `box-shadow` spread, not `outline`: spread has
followed `border-radius` in every browser for a decade, `outline` only since
Chrome 94, and the renderer's version is not ours to choose.

**What came before.** Until 2026-11-05 the photograph was embossed into the
sheet instead — a 12 px shoulder outside and an 8 px fillet inside, one band of
shading peaking at the border, matching the card deck on iOS (`.awphoto` in
`res/main.css`). It worked on the panel; the outline replaced it as a plainer
statement, a framed print on a mat rather than a card pressed into paper. The
geometry is in the history if it is ever wanted back
(`git log -- docs/trmnl-plugin.html`).

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
photograph's bytes. It has three modes, so the rule which picture is current
lives in one place:

| | |
|---|---|
| `photo.php` | draws one out of today's pool and writes it out |
| `photo.php?pick=1` | draws one and answers in JSON: the name, and the caption the panel prints around it, out of `photos.json` |
| `photo.php?name=X` | writes X out, drawing nothing |

**The caption forced the split.** The plugin now polls `?pick=1` and points its
`<img>` at `?name=` that name, so the words and the picture are the same
photograph; drawing in both places would caption one and show another. A name is
taken as a bare file name of ours and nothing else — `basename`, then a match
against `awp-….jpg`, then `is_file` — and every photograph is public anyway, so
the only question was the path. An unknown name leaves the caption empty rather
than failing: the photograph still reaches the panel, it simply says nothing
about itself.

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

A private plugin, **strategy Polling**, the URL being

    https://afterworkphotos.com/trmnl/photo.php?pick=1

whose JSON TRMNL merges into the markup: `{{ photo.name }}` into the `<img>`'s
address, `{{ photo.caption }}` above the print and `{{ photo.desc }}` and
`{{ photo.meta }}` below it. The markup is `docs/trmnl-plugin.html`: one
`view view--full`, the surround, the outline, the two bands of type.

It was strategy **None** until the caption arrived on 2026-11-05 — the markup
was self-contained and the `<img>` drew the picture itself. Changing the markup
alone is not enough: the plugin's strategy and its polling URL are set in the
TRMNL interface, and until they are, the Liquid stays empty and the `<img>`
asks for `?name=` with nothing after it — which still serves a photograph,
drawn as before, but an uncaptioned one.

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
