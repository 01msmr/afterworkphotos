# afterworkphotos — details

How everything works, in detail. The overview is in the [README](../README.md).

## Files

| file | what it is |
|---|---|
| `index.html` | the page: title, empty `.main`, loads `res/main.css` + `res/main.js` |
| `res/main.js` | builds the photo sections; desktop scroll/keyboard UI and the touch-device sheet deck |
| `res/main.css` | desktop layout at the top, the whole deck nested inside `html.deck { … }` (native CSS nesting, Safari 17.2+) |
| `manifest.json` | web app manifest — required, see *iOS home screen app* |
| `img/awp-YYYY-MM-DD-NN.jpg` | the photos, square, 1000 px — named by date taken, NN counting that day's photos |
| `img/awp-….mp4` | a photo that is a video: 1000 px square H.264; the `.jpg` of the same name is its first frame |
| `img/thumb/awp-….jpg` | 200 px thumbnails, same crop — generated, for the overview UIs |
| `img originals/awp-….<ext>` | the originals at full size, cropped to the same square |
| `photos.json` | generated index the page is built from: count, and per photo `n` (1 = oldest), `id`, `taken`, `file`, `thumb`, `video` |
| `inbox/` | where new photos land (the Shortcut puts them there); emptied by the ingest workflow |
| `scripts/ingest.sh` | numbers an inbox photo, makes the 1000 px square, moves the original, bumps `PHOTO_COUNT` |
| `.github/workflows/ingest.yml` | runs the script on every push to `inbox/` and commits the result |
| `upload.php`, `secret.php`, `.user.ini` | the old server-side upload endpoint — superseded by the inbox, to be removed |
| `apple-touch-icon.png`, `favicon.ico` | icons |
| `card-stack.html`, `res/onepage.*`, `res/noRubberband.js`, `favicon_.ico` | legacy / prototypes, not referenced by the page |
| `docs/superpowers/specs/`, `docs/superpowers/plans/` | design specs and implementation plans of larger changes (the iPad deck / aspect layouts / precision scrubber of 2026-08-23 are there, with the browser checks each step was verified by) |

The file names are internal. The site shows photos as `afterworkphoto N` (a video as `afterworkvideo N`, same numbering), N being the position in date order from `photos.json` — which is the single source of truth for what exists; the page builds nothing until it has loaded it.

## How the page works

### Which layout

`main.js` decides at load: a touch device (`navigator.maxTouchPoints > 0` — iPhone, iPad, touch laptops) gets the **deck** and the class `deck` on `<html>`, which switches the deck CSS on; a mouse-only machine gets the **list**. `TABLET` (`min(screen.width, screen.height) >= 700`; the iPad mini is 744 logical px, the largest iPhone 440) adds the class `tablet`. For testing, `?touch=1|0` and `?tablet=1|0` override both.

The title is fitted to its box (`fitTitle()`). On a phone the box is the print's exact width (the sheet's 3 px inset plus the prints' `--side` margin, 4 %, on both sides), centred; on a tablet and on the desktop it is a small box (≤ 340 px) whose `right` is that same `--side` margin, so its right edge is the rightmost print's — by construction, nothing is measured.

### Desktop — the wall

A single screen, never free-scrolled: the wall shows one row of prints and is **switched** row by row — the same idea as the phone's deck. A wheel notch (or one trackpad gesture; its inertia tail is swallowed by a 350 ms lock, small deltas accumulate to 40 px) moves one row, `PageUp`/`PageDown`/`Space` too; the glide between rows is programmatic (`stepRow()`, `glideTo()`), so there is no scrollbar and no snap fighting momentum. A moment (600 ms) after the wall comes to rest, the row on screen lights up as if selected from the keyboard, with the print's own slow fade. A glide to a print chosen on the knobs ends on **arrival at its target**, not on a pause in the scroll events (a long smooth scroll starts slowly enough to pause them), and the knob windows hold still for the whole ride.

The wall itself is a material: **white plaster** (fine SVG-noise grain and soft trowel streaks) or **concrete** (cooler, cloudy, pores, a faint formwork line), both generated in CSS, fixed behind everything. **Clicking on empty wall switches the material**; the choice is kept in `localStorage` (`wall`). Photos per row follow the window's shape (`perRow()`): taller than wide 1, wider 2, wider than 2:1 3; the prints share the row between the `--side` margins (`flex: 1`, never taller than the window). On resize the existing boxes are regrouped into new rows (`regroup()` — no image reloads) and the row that was on screen stays on screen. Every image sits on an opaque sheet of 12.5 % gray, exactly its size, so the wall's texture never shows through: unlit, the image is at 4 % over the gray (captions 50 %) with only a faint close shadow — the full spot-shadow and the light belong to the print that is lit (hover, or the row at rest). While the wall is in motion, hover must not light passing prints under a resting cursor (`body.moving`); the **arriving** row is exempt — its light begins only once the wall has come to rest (`approachTop` marks every step's arrival; the rest-settle lights), with the print's own fade — undimming 0.8 s, dimming 0.4 s — shadow and image moving identically. Hover works again when the wall rests (a 300 ms silence timer is the fallback trigger). Captions are 1.65× under the big prints.

**Input — the last-used one wins.** A keypress takes over from the mouse (keyboard mode, hover yields); real mouse movement (not jitter, not over the knob unit) takes over from the keyboard — the selection light drops and hover rules again. Keyboard: `Enter` enters keyboard mode and steps the selection, arrows move (up/down by a row), digits + `Enter` go to a number, `Escape` leaves. **`Tab` circles three stations**: the wall's lit print → the year knob → the print knob → back (Shift+`Tab` backwards); a focused knob shows the unit with a ring, `ArrowUp`/`Down` (or left/right) turn it — down is older — and `Enter` commits the ride. While the keyboard is in use the knob unit hides. The mouse cursor is replaced by a small white dot.

**Go-to — two knobs under the wall.** A small machine fixed at the lower right, its right edge on the prints' `--side` line, shown at 1.8× (`.goto`, built in `main.js`; at rest it is only a 6 px dark line — the elements rise under the mouse; the line vanishes the instant they rise and returns only once they have fully dimmed): a **year knob** under a window of four rolling digit drums, a **print knob** under a window with the number and the full date, and beside them the print's **image** in a window (white paper until the first turn). Scrolling on a knob turns it, and so does dragging it vertically (14 px per step, pointer captured; a real drag never commits) — one mouse notch (or 24 px of trackpad) is one step: the year knob steps a year (landing on that year's newest print), the print knob a print, carrying into the next year at the ends. Nothing moves while the mouse is on the unit; **when it leaves**, the wall scrolls to the print and lights it (`goNow()` → `select()`, the keyboard path). Clicking the image goes at once. Typing digits puts a number into the date window, `Enter` goes. Scrolling the wall by hand rolls the windows to the row on screen. Like an unlit print the unit sits at 10 % until hovered. The knobs are CSS only (machined aluminium: brushed ring, turned centre, bevelled rim, engraved index; `--a` turns them). The VR gallery gets the same two knobs on its elevator panel.

### Touch devices — the sheet deck

The newest photo is on top, like a pile of daily prints. A sheet carries `K` photos — one upright, two side by side when the device is held sideways (`sheetsPer()`; 43 % prints, a gap of 1.5 side margins between them; on a phone the prints are bound by the height and centred, the title small and centred over them). Turning the device rebuilds the pile with the same photo on top (`rebuild()`, on `resize`; a move in flight is landed first). The deck works on sheet indices (`S = ceil(N / K)`, `photosOf(i)`), the scrubber on photo indices (`sheetOf()` maps between them). Swiping up lifts the top sheet off and uncovers the one before; swiping down pulls the newer sheet back on. Only seven sheets exist in the DOM at a time — the top one and three either side, built as they enter that window and dropped as they leave it, images loaded ahead — so a pile of hundreds costs what a pile of seven does (`WINDOW`, `sheet(i)`, `layout()` in `main.js`). Tapping does the same: the upper part of the screen goes forward, the lower part back — the boundary is the thin dotted line printed on every sheet (`--divider-y`, set from the photo's position). The last sheet wraps to the first; it is the same move as any other, there are no clones.

**A sheet pulled down enters paper first.** The lifted sheet's long shadow reaches ~200 px below it, so a sheet dragged down from above the screen would show its shadow sweeping in before any paper. Until its bottom edge is on screen the mover wears only the flat sheet edge (`.entering`, set for backward moves in `startMove()` and dropped in `updateReveal()` once `moverY()` clears the measured bottom); the long shadow then fades in over 0.2 s.

**Edge scrubber.** The right 28 px of the screen (below the status backdrop) is the pile seen edge-on. A touch there opens it: a strip of sheet edges with the years marked (marks that would land within 18 px of the previous one are left out), and beside the finger a paper card with the photo under it — number above month, then its print. Dragging runs through the photos (top = newest); letting go cuts the deck to the sheet holding that photo — the top sheet lifts off straight onto an older target, a newer target comes down straight onto the top sheet.

*Neighbours.* When the strip gives fewer pixels per photo than a finger resolves, the adjacent photos float free above (newer) and below (older) the card, smaller and dimmed: `neighbourCount(px)` — `≥ 6 px → 1 print, ≥ 2 → 3, else 5`, where `px = stripHeight / N / rate`. With 208 photos an iPhone (≈ 3.5 px) and an iPad (≈ 5.3 px portrait) show 3. The label's `right` is set from the widest year mark (`16 + widest + 8 px`), so a year is never covered; at the strip's ends the label is pushed inward to stay on screen.

*Precision gear.* Engaged only when the strip is too short for single-sheet hits (`pxPerPhoto < GEAR_NEEDED_PX = 6`): sliding the finger left off the strip and on scrubbing there slows the pile — 1× on the strip and up to 60 px in, ¼ from 60 px, 1/16 from 160 px (`gearRate()`; a `← finer` hint shows under the label while it would help). The touch-down sets the position from the strip; once a finer gear has been used the position follows the finger's travel (`scrubPos`), and the fan collapses to one print because `px` is divided by the rate. Capacity: single sheets are reachable while `16 · stripHeight / N ≥ 3 px` — comfortably to ≈ 1 900 photos on an iPhone, ≈ 2 900 on an iPad in portrait; a further gear (1/64) in `gearRate()` would multiply that by four. `startMove(dir, target)` is the same move as a swipe, just not to the neighbour; the sheet being uncovered (`.under`) sits above the resting pile (z 4) so the pile's own next sheets never show through during the cut.

Loading, so nothing looks empty: all thumbnails are fetched in the background once the page is up (batches of eight, `preloadThumbs`); every print has its thumbnail as a background, so a sheet still loading already shows its picture softly; the small print under the finger only ever shows a thumbnail that is already decoded (an `<img>` would otherwise keep showing its previous picture until the new one arrives) and stays blank paper until then; and when the finger rests on a sheet for 200 ms its full photo is fetched ahead (`warmUp`), so it is in the cache by the time the pile is cut to it.

**Videos** are captioned `afterworkvideo N` (`captionOf()`; the numbering is the photos'), and play only while on screen: in the deck while their sheet is the top one (paused in `layout()` otherwise), on the desktop while the mouse is over them. No autoplay.

What is on screen, always: the **top sheet**, 3 px in from the phone's edge with its paper edge showing, and the **two sheets beneath it**, full size and flat, so the top sheet's edge always shows paper around it. Stack positions are the classes `current`, `next`, `next2`, assigned by `layout()`.

A move, in `main.js` terms:

- `startMove(dir)` picks the `mover` (the top sheet to lift off, or the previous one to put back) and the `under` sheet it uncovers or covers. `travel` is measured from the mover's real position — the distance it needs to clear the screen, shadow included.
- While the mover is in the air it is always sheet-size (3 px inset, lifted shadow). The sheet beneath stays flat until the mover's bottom edge has cleared the lower 30 % of the screen (`revealAt`), then takes sheet size too — all four edges move in very slightly — and goes flat again on the way back. `updateReveal()` reads the mover's actual transform, so drags and the animated settle behave the same.
- `settle(commit)` animates the rest of the way; `finish()` re-assigns the stack. A 2.5 s watchdog covers a `transitionend` that never arrives (backgrounded tab).

The look is CSS only, all tokens on `html.deck` (`& { … }` at the top of the deck block):

- **Paper**: `#dedede` with a fractal-noise grain (inline SVG, ≤ 10 % alpha, seamless at 120 px). Dark mode via `prefers-color-scheme`: `#2b2927` paper, light ink, white title — same rendering, different tokens.
- **Paper edge** (`--sheet-edge`): 1 px lit bevel top/left, 1 px dark thickness line, 1–3 px contact shadow. Sized for a very small rounded object.
- **Letterpress print**: the photo sits in a recess — inset shadow on its top/left wall, a lit paper lip below. 6 px corners. No drop shadow.
- **Corners**: sheet corners are concentric with the phone's own; a sheet lying flat has square bottom corners (the glass rounds them). The phone's radius comes from `SCREEN_RADII` in `main.js` (per model, e.g. iPhone 16 → 55 px) with a CSS fallback derived from `safe-area-inset-bottom`.
- **Status bar backdrop** (`.main::before`): an opaque black strip the height of the status inset plus `--top-gap` (22 px), with two convex corner fills in the phone's radius. Sheets start below it and slide under it, corners and all. The desk (`html, body`) is black so the Dynamic Island disappears into it.

## Adding a photo

Put an image into `inbox/` on `main` — that is all. The ingest workflow (`.github/workflows/ingest.yml` → `scripts/ingest.sh`) takes it from there:

1. writes the 1000 px square derivative — auto-oriented, centre-cropped (a no-op for a square), JPEG q85, metadata stripped so no GPS reaches the public image;
2. keeps the original at full size in `img originals/` — cropped to the same square (quality 95, metadata intact); one that already is square is moved untouched;
3. **names every photo by its date taken**, `awp-YYYY-MM-DD-NN` (EXIF `DateTimeOriginal`, the QuickTime creation date for a video; undated ones become `awp-undated-NN` at the end). An arrival earlier in a day than existing ones renumbers that day — derivative, original, thumbnail and video are renamed with `git mv`, so history follows;
4. makes any missing 200 px thumbnail (from the derivative, so it is the same crop) and rewrites `photos.json` from scratch;
5. commits `photo awp-…`, pushes. The server pulls; live within seconds.

**Videos** (`.mov`, `.mp4`, `.m4v`) up to 30 s (`MAX_VIDEO_SECONDS`) go through the same steps with ffmpeg: a 1000 px square H.264 `img/N.mp4` with audio kept, its first frame as `img/N.jpg`, the full-size square original as `N_original.mp4`, date from the QuickTime creation date. Longer ones are moved to `inbox/too-long/`. A Mac without ffmpeg leaves videos in the inbox for the runner. The page plays them muted, looping, inline, swapped in once `photos.json` has arrived.

A photo's number on the site is its position in date order, so adding an old favourite shifts the numbers after it. The pile reads chronologically — newest on top, oldest at the bottom.

The workflow can also be run by hand (*Actions → ingest photos → Run workflow*) to regenerate thumbnails and `photos.json` with an empty inbox.

Runs are serialised, so two uploads can never both become the same name. A commit made by the workflow does not trigger it again.

The phone does this with a Shortcut that PUTs favourited photos into `inbox/` through the GitHub contents API (`PUT /repos/01msmr/afterworkphotos/contents/inbox/<yyyyMMdd-HHmmss>.jpg`, body `{"message":"inbox","content":"<base64>"}`, a fine-grained token with *Contents: read/write* on this repo only). It remembers what it has sent in a text file in iCloud Drive, so re-favouriting an old photo still works and un-favouriting never deletes anything.

By hand: `git add inbox/whatever.jpg && git commit && git push` does the same. To try the script locally: `scripts/ingest.sh` (needs ImageMagick), then look at what it staged.

`upload.php` is the old way — it edited `res/main.js` on the server, which the next pull undid — and is to be removed.

## Known issues / to check

- **Fixed: a wrong picture for a moment after a scrubber cut down the pile** (to an older, smaller number; cutting up was fine). The sheet being uncovered carried only `.under`, which never set `visibility` — so it stayed hidden like any resting sheet, and the pile's own next sheet showed through for the whole lift until the landing snapped it into place. Cuts of one or two sheets looked right only because the target happened to be `.next`/`.next2`. `section.under` is now `visibility: visible` (commit `eaef3ee`). Reproduced and verified on the desktop at phone width with synthetic touch events on the scrubber, sampling each sheet's computed visibility and z-index during the move.
- **iPad: check on the device** — rotation with a move in flight, the label near the strip's ends with 5 prints, the corner radius fallback (no iPad entry in `SCREEN_RADII`), and whether iPadOS Safari with a trackpad still reports touch points (it should; otherwise it gets the list).
- **Status bar text / blur** cannot be controlled from the page (see below).

## Deployment

Push to `main`; the server (nginx) pulls automatically within seconds. The page is `index.html`, `manifest.json`, `res/main.css`, `res/main.js`, `photos.json` and the images. The host serves `manifest.json` as `application/json` — keep the `.json` name, a `.webmanifest` may come back as `octet-stream` and iOS then ignores it.

**Caching.** The server sends no `Cache-Control`, so browsers — and the installed app most of all — keep old files on heuristics. `index.html` references `res/main.css?v=…` and `res/main.js?v=…`: **bump that version whenever CSS or JS change**, or the phone keeps the old code. `photos.json` is fetched with `cache: no-cache`, so it revalidates on every open. What the repo cannot fix is a stale `index.html` itself; the cure for that is one nginx line, `add_header Cache-Control "no-cache";` for `/index.html` (and `/`), after which a changed page arrives on the next launch and an unchanged one costs a 304.

Check a deploy from anywhere:

```sh
curl -s "https://afterworkphoto.com/photos.json?cb=$RANDOM" | python3 -c "import json,sys; print(json.load(sys.stdin)['count'])"
```

## Local development

```sh
python3 -m http.server 8765 --bind 0.0.0.0     # then open http://<your LAN IP>:8765 on the phone
```

Send `Cache-Control: no-store` if you iterate on the phone — iOS caches hard. Mind that another project's server on `127.0.0.1:8765` wins over `0.0.0.0:8765` for localhost requests.

The deck is chosen by touch support, not width — on a desktop browser use `?touch=1` (and `?tablet=1` for the iPad layouts) in a narrow or iPad-sized window, or an iframe of that size. The page needs `photos.json`, so it must be served, not opened as a file.

**Checking behaviour without a device.** There is no test suite; the page is checked in Chrome against the local server, inside an iframe of the wanted size (400×820 phone, 844×390 phone sideways, 820×1180 / 1180×820 iPad, desktop sizes) with synthetic `TouchEvent`s on the scrubber and the deck, sampling the DOM (classes, computed visibility, `data-n` of what is on top, the label's contents). The harness and the expected values per step are in `docs/superpowers/plans/2026-08-23-ipad-deck-and-scrubber.md`.

## iOS home screen app — what was learned the hard way

- **The manifest is required.** With only the legacy `apple-mobile-web-app-*` metas, iOS 26/27 launches the icon as a browser window (bottom bar, `display-mode: browser`) on every start after the first. `display: standalone` in `manifest.json` fixes it. Reinstall the icon after changing the manifest; it is read at install.
- **Plain HTTP on a LAN IP never holds standalone mode**; test installs from the real HTTPS domain.
- **Never put the sheets inside a transformed/clipping container.** Inside one, iOS resolves `bottom: 0` a status bar short and gets `100lvh` wrong too — the card ends above the glass. Sheets `position: fixed` on the viewport with `top: env(safe-area-inset-top) + …` and `bottom: …` are sized correctly. The top is handled by painting a backdrop over them instead.
- **The status bar cannot be hidden or recoloured from a web page.** iOS picks black or white text from what it renders underneath; `theme-color`, `color-scheme` and a light hairline at the top edge all changed nothing. The blur along the top of the content under the status bar is iOS too; `--top-gap` keeps it on the backdrop instead of the paper.
- `safe-area-inset-bottom` is 34 px on Face ID phones and the best available hint for the corner radius when the model is not in `SCREEN_RADII` (×1.62 ≈ 55 px).

## Security note

`secret.php` must not be in the repository. It was, because the `.gitignore` line had a typo (`sth secret.php`); the line is fixed now, but the file is still tracked and the token is in the history — rotate `UPLOAD_SECRET` and `git rm --cached secret.php`.
