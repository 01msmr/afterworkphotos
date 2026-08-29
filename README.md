# afterworkphotos

[afterworkphotos.com](https://afterworkphotos.com) — one square photo a day, taken after work. A single static page: no build step, no framework. Photos arrive through `inbox/`; a GitHub workflow does the rest. How everything works, in depth: [docs/details.md](docs/details.md).

## Files

| | |
|---|---|
| `index.html`, `res/main.css`, `res/main.js` | the page |
| `photos.json` | generated index of all photos in date order — the page is built from it |
| `img/` | 1000 px squares, `awp-YYYY-MM-DD-NN`; `img/thumb/` 200 px; a video is an `.mp4` of the same name |
| `inbox/` | drop photos here; the ingest workflow empties it |
| `scripts/ingest.sh`, `.github/workflows/ingest.yml` | the ingest |
| `manifest.json` | web app manifest — makes the home screen icon an app |
| `gallery/`, `res/gallery.*` | the VR gallery (Meta Quest), branch `vr-view` |
| `docs/` | details, design specs and plans |
| `tests/deck.html` | the deck's checks, in the browser |
| `CLAUDE.md` | rules for working on the code |

The site never shows file names: photos are numbered 1…N in date order.

## The page

**Desktop** — a wall of prints, newest first, switched screen by screen with the wheel; two knobs at the lower right turn the year and the print; `Tab` walks the stations, `?` shows the keys, `f` keeps a print, `j` jumps to a number, `m` opens the map of places.

**Phone and iPad** — a pile of paper sheets, newest on top. Swipe up to lift the top sheet off, down to put it back; a tap above or below the dotted line does the same. The right edge is the pile seen edge-on: touch it to run through the years, slide the finger in from the edge for the finer gears, let go and the pile cuts to that photo. Dark mode follows the system.

**Deep links** — `#154` opens print 154, `#y2017` a year's newest; the address follows as you move.

## Adding photos

Put an image (or a video up to 30 s) into `inbox/` on `main`. The workflow names it by date taken, makes the square, the thumbnail and the index, commits, and the server pulls. From the phone this is the afterworksnap app (repo `afterworkphotos-snap`) sending to `snap.afterworkphotos.com`, which writes to `inbox/` through the GitHub API; from the Mac, drop the files in and run `scripts/ingest.sh` (needs ImageMagick; videos need ffmpeg).

## Deployment

Push to `main`; the server pulls within seconds. The server sends no cache headers, so **bump the `?v=` on the CSS and JS links in `index.html` with every change to them**, or the installed app keeps the old code.

Local:

```sh
python3 -m http.server 8765 --bind 0.0.0.0     # open http://<LAN IP>:8765 on the phone
```

On a desktop browser `?touch=1` (and `?tablet=1`) force the deck. The page must be served — it fetches `photos.json`. **`tests/deck.html`** checks the deck at phone size with synthetic touches (open it from the server, window on screen); `CLAUDE.md` has the working rules.

## iOS, learned the hard way

- The manifest with `display: standalone` is what makes the icon an app; install from the real HTTPS domain.
- Keep the sheets `position: fixed` on the viewport; inside a transformed container iOS gets their height wrong.
- The app's view **launches one status bar short** and iOS extends it only past a taller document: the viewport height is `100lvh` in the CSS, never `100dvh` and never read from JS at load — otherwise a black band stays under the sheets (17e; the 16's first launch).
- The status bar's colour and blur cannot be controlled from a page; `--top-gap` keeps the blur off the paper.

## Open

- `secret.php` is tracked and its token is in the history: rotate it, remove the legacy PHP files.
- iPad on the device: rotation with a move in flight, the corner-radius fallback, trackpad Safari counting as touch.
- Next: the contact sheet (pinch to spread the pile into a grid).
