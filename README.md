# afterworkphotos

[afterworkphoto.com](https://afterworkphoto.com) — one square photo a day, taken after work. A single static page, no build step, no framework. Photos arrive through `inbox/` and a GitHub workflow does the rest. The details are in [docs/details.md](docs/details.md).

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
| `upload.php`, `secret.php`, `.user.ini`, `card-stack.html`, `res/onepage.*`, `res/noRubberband.js` | legacy, to be removed |

The site never shows file names; it numbers photos 1…N in date order.

## The page

**Desktop** — one, two or three photos per screen depending on the window's shape, newest first, scroll-snap; dimmed, lit on hover; keyboard navigation.

**Phone and iPad** — the photos are a pile of paper sheets, newest on top (held sideways, two per sheet). Swipe up to lift the top sheet off and see the one before it, swipe down to put it back; tapping the upper/lower half does the same. The right edge of the screen is the pile seen edge-on: touch it and drag to run through the years, slide the finger in from the edge for finer control, let go and the pile cuts to that sheet. Only seven sheets exist in the DOM at a time, so the size of the pile doesn't matter. Dark mode follows the system. Videos play only while on screen.

## Adding photos

Put an image (or a video up to 30 s) into `inbox/` on `main` — the workflow names it by date taken, makes the square derivative, the thumbnail and the full-size square original, rewrites `photos.json`, commits and pushes; the server pulls and it's live. Several at once are fine; one that is already there (same date to the second) is recognised and not duplicated.

From the phone this is a Shortcut that PUTs favourited photos into `inbox/` through the GitHub contents API with a fine-grained token (contents: read/write, this repo only). From the Mac, drop the files in and run `scripts/ingest.sh` (needs ImageMagick; videos need ffmpeg, otherwise they're left for the workflow).

## Deployment

Push to `main`; the server pulls within seconds. The server sends no cache headers, so **bump the `?v=` on the CSS/JS links in `index.html` with every change to them**, or the installed app keeps the old code.

Local: `python3 -m http.server 8765 --bind 0.0.0.0` and open the LAN address on the phone. The page needs to be served (it fetches `photos.json`).

## iOS, learned the hard way

- The manifest with `display: standalone` is what makes the home screen icon launch as an app; test installs from the real HTTPS domain.
- Keep the sheets `position: fixed` on the viewport; inside a transformed container iOS gets their height wrong.
- The status bar (its text colour, the blur under it) cannot be controlled from a web page.

## Open

- `secret.php` is tracked and its token is in the history: rotate it, remove the legacy PHP files.
- Next: the contact sheet (pinch to spread the pile into a grid).
