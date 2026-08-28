# afterworkphotos

[afterworkphotos.com](https://afterworkphotos.com) — one square photo a day, taken after work. A single static page, no build step, no framework. Photos arrive through `inbox/` and a GitHub workflow does the rest. The details are in [docs/details.md](docs/details.md).

## What's in here

| | |
|---|---|
| `index.html`, `res/main.css`, `res/main.js` | the page |
| `photos.json` | generated index of all photos, in date order — the page is built from it |
| `img/` | 1000 px square photos, named `awp-YYYY-MM-DD-NN` by date taken; `img/thumb/` the 200 px thumbnails; a video is an `.mp4` of the same name |
| `img originals/` | full-size originals, cropped to the same square; `…--unc` the uncropped file where cropping changed something |
| `inbox/` | drop photos here; emptied by the ingest workflow |
| `scripts/ingest.sh`, `.github/workflows/ingest.yml` | the ingest |
| `manifest.json` | web app manifest (needed for the home screen app) |
| `docs/` | [details.md](docs/details.md); design specs and plans of larger changes under `docs/superpowers/` |
| `upload.php`, `secret.php`, `.user.ini`, `card-stack.html`, `res/onepage.*`, `res/noRubberband.js` | legacy, to be removed |

The site never shows file names; it numbers photos 1…N in date order.

## The page

**Desktop** — a wall (white plaster or concrete — click the wall to switch) showing one row of one to three prints by window shape, newest first; a wheel notch moves one row, nothing free-scrolls. Prints sit on light-gray sheets, dimmed until lit: by hover (only while the wall stands still) or by arrival — the incoming print starts to light once two thirds of it are on screen. Whatever you used last, mouse or keyboard, is in charge. Two knobs at the lower right (a thin line until the mouse finds them): turn or drag the year (a decade dial — one revolution, empty years included) and the print (100 per revolution), wrapping at the ends; let go and the wall goes there. `Tab` circles print → year knob → print knob → wall, the focused control inverted. `j` asks for a number: type the digits and `Enter` jumps to that print — or, standing at the favs, to the fav with that number (the oldest is 1). `?` shows the guide of keys at the foot of the wall.

**Phone and iPad** — the photos are a pile of paper sheets, newest on top (held sideways, two per sheet). Swipe up to lift the top sheet off and see the one before it, swipe down to put it back; tapping the upper/lower half does the same. The right edge of the screen is the pile seen edge-on: touch it and drag to run through the years, slide the finger in from the edge for finer control (the label shows the neighbouring prints while the strip is too short for single-sheet hits), let go and the pile cuts to that sheet. Only seven sheets exist in the DOM at a time, so the size of the pile doesn't matter. Dark mode follows the system. Videos play only while on screen.

**Deep links** — `afterworkphotos.com/#154` opens print 154, `#y2017` a year's newest; the address follows as you move.

## Adding photos

Put an image (or a video up to 30 s) into `inbox/` on `main` — the workflow names it by date taken, makes the square derivative, the thumbnail and the full-size square original, rewrites `photos.json`, commits and pushes; the server pulls and it's live. Several at once are fine; one that is already there (same date to the second) is recognised and not duplicated.

From the phone this is a Shortcut that PUTs favourited photos into `inbox/` through the GitHub contents API with a fine-grained token (contents: read/write, this repo only). From the Mac, drop the files in and run `scripts/ingest.sh` (needs ImageMagick; videos need ffmpeg, otherwise they're left for the workflow).

## Deployment

Push to `main`; the server pulls within seconds. The server sends no cache headers, so **bump the `?v=` on the CSS/JS links in `index.html` with every change to them**, or the installed app keeps the old code.

Local: `python3 -m http.server 8765 --bind 0.0.0.0` and open the LAN address on the phone; on a desktop browser `?touch=1` (and `?tablet=1`) force the deck. The page needs to be served (it fetches `photos.json`).

## iOS, learned the hard way

- The manifest with `display: standalone` is what makes the home screen icon launch as an app; test installs from the real HTTPS domain.
- Keep the sheets `position: fixed` on the viewport; inside a transformed container iOS gets their height wrong.
- The status bar (its text colour, the blur under it) cannot be controlled from a web page.
- The home screen app **launches its view one status bar short** (797 on a 390×844 phone) and iOS grows it to the glass only if the document is taller than that view — on a first launch always, on later ones only when there is no snapshot. So `--app-height` is `100lvh` (the large viewport, 844 from the start) — never `100dvh` and never a height read from JS at load: both size the page to the short view, iOS leaves it there, and a black band stays under the sheets (seen on the iPhone 17e, and on the 16's first launch). iOS's correction fires only `visualViewport` `resize`, not `window` `resize`. Found on 2026-08-28 with a series of bare test pages carrying a viewport readout, since removed (`git log -- test.html`).

## Open

- `secret.php` is tracked and its token is in the history: rotate it, remove the legacy PHP files.
- iPad on the device: rotation with a move in flight, the 5-print label near the strip's ends, the corner-radius fallback, trackpad Safari still counting as touch.
- Next: the contact sheet (pinch to spread the pile into a grid).
