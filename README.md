# afterworkphotos

[afterworkphoto.com](https://afterworkphoto.com) — one square photo a day, taken after work. A single page, no build step, no framework.

## Files

| file | what it is |
|---|---|
| `index.html` | the page: title, empty `.main`, loads `res/main.css` + `res/main.js` |
| `res/main.js` | builds the photo sections; desktop scroll/keyboard UI and the mobile sheet deck |
| `res/main.css` | desktop layout at the top, the whole mobile deck inside `@media (max-width: 600px)` |
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

The file names are internal. The site shows photos as `afterworkphoto N`, N being the position in date order from `photos.json` — which is the single source of truth for what exists; the page builds nothing until it has loaded it.

## How the page works

### Desktop (wider than 600 px)

Two photos per full-height section, newest first, vertical scroll-snap. Photos are dimmed to 12 % and light up on hover. Keyboard: `Enter`/`Tab` enter keyboard mode, arrows move, `Escape` leaves. The mouse cursor is replaced by a small white dot.

### Mobile — the sheet deck

The newest photo is on top, like a pile of daily prints. Swiping up lifts it off and uncovers the one before; swiping down pulls the newer sheet back on. Only seven sheets exist in the DOM at a time — the top one and three either side, built as they enter that window and dropped as they leave it, images loaded ahead — so a pile of hundreds costs what a pile of seven does (`WINDOW`, `sheet(i)`, `layout()` in `main.js`). Tapping does the same: the upper part of the screen goes forward, the lower part back — the boundary is the thin dotted line printed on every sheet (`--divider-y`, set from the photo's position). The last sheet wraps to the first; it is the same move as any other, there are no clones.

**Edge scrubber.** The right 28 px of the screen (below the status backdrop) is the pile seen edge-on. A touch there opens it: a strip of sheet edges with the years marked (marks that would land within 18 px of the previous one are left out), and under the finger the sheet as a small print with its number and month. Dragging runs through the pile (top = newest); letting go cuts the deck to that sheet — the top sheet lifts off straight onto an older target, a newer target comes down straight onto the top sheet. `startMove(dir, target)` is the same move as a swipe, just not to the neighbour; the sheet being uncovered (`.under`) sits above the resting pile (z 4) so the pile's own next sheets never show through during the cut.

Loading, so nothing looks empty: all thumbnails are fetched in the background once the page is up (batches of eight, `preloadThumbs`); every print has its thumbnail as a background, so a sheet still loading already shows its picture softly; the small print under the finger only ever shows a thumbnail that is already decoded (an `<img>` would otherwise keep showing its previous picture until the new one arrives) and stays blank paper until then; and when the finger rests on a sheet for 200 ms its full photo is fetched ahead (`warmUp`), so it is in the cache by the time the pile is cut to it.

**Videos** play only while on screen: on the phone while their sheet is the top one (paused in `layout()` otherwise), on the desktop while the mouse is over them. No autoplay.

What is on screen, always: the **top sheet**, 3 px in from the phone's edge with its paper edge showing, and the **two sheets beneath it**, full size and flat, so the top sheet's edge always shows paper around it. Stack positions are the classes `current`, `next`, `next2`, assigned by `layout()`.

A move, in `main.js` terms:

- `startMove(dir)` picks the `mover` (the top sheet to lift off, or the previous one to put back) and the `under` sheet it uncovers or covers. `travel` is measured from the mover's real position — the distance it needs to clear the screen, shadow included.
- While the mover is in the air it is always sheet-size (3 px inset, lifted shadow). The sheet beneath stays flat until the mover's bottom edge has cleared the lower 30 % of the screen (`revealAt`), then takes sheet size too — all four edges move in very slightly — and goes flat again on the way back. `updateReveal()` reads the mover's actual transform, so drags and the animated settle behave the same.
- `settle(commit)` animates the rest of the way; `finish()` re-assigns the stack. A 2.5 s watchdog covers a `transitionend` that never arrives (backgrounded tab).

The look is CSS only, all tokens in `:root` inside the mobile block:

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

- **Phone: a wrong big picture for a moment after a scrubber cut** — reported on the device ("what was under my thumb just before?"), not reproduced on the desktop: there the landing sheet is in place from the first frame of the cut with the right, decoded image, and nothing else is ever under the centre of the screen (sampled at 0–1.8 s). Candidates to check on the device: iOS decode timing of a freshly inserted `<img>` after the rest-prefetch loaded a *different* sheet's photo; the `touchend` landing on a neighbour of the sheet the label showed. Start by logging `scrubIndex` at release against what the label showed, and the `complete` state of the landing sheet's image at the first frame.
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

Mobile breakpoint is `PER_SECTION = innerWidth < 600 ? 1 : 2`, so a desktop window narrower than 600 px shows the deck. The page needs `photos.json`, so it must be served, not opened as a file.

## iOS home screen app — what was learned the hard way

- **The manifest is required.** With only the legacy `apple-mobile-web-app-*` metas, iOS 26/27 launches the icon as a browser window (bottom bar, `display-mode: browser`) on every start after the first. `display: standalone` in `manifest.json` fixes it. Reinstall the icon after changing the manifest; it is read at install.
- **Plain HTTP on a LAN IP never holds standalone mode**; test installs from the real HTTPS domain.
- **Never put the sheets inside a transformed/clipping container.** Inside one, iOS resolves `bottom: 0` a status bar short and gets `100lvh` wrong too — the card ends above the glass. Sheets `position: fixed` on the viewport with `top: env(safe-area-inset-top) + …` and `bottom: …` are sized correctly. The top is handled by painting a backdrop over them instead.
- **The status bar cannot be hidden or recoloured from a web page.** iOS picks black or white text from what it renders underneath; `theme-color`, `color-scheme` and a light hairline at the top edge all changed nothing. The blur along the top of the content under the status bar is iOS too; `--top-gap` keeps it on the backdrop instead of the paper.
- `safe-area-inset-bottom` is 34 px on Face ID phones and the best available hint for the corner radius when the model is not in `SCREEN_RADII` (×1.62 ≈ 55 px).

## Security note

`secret.php` must not be in the repository. It was, because the `.gitignore` line had a typo (`sth secret.php`); the line is fixed now, but the file is still tracked and the token is in the history — rotate `UPLOAD_SECRET` and `git rm --cached secret.php`.
