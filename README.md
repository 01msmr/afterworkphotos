# afterworkphotos

[afterworkphotos.com](https://afterworkphotos.com) — one square photo a day, taken after work. A single static page: no build step, no framework. Photos arrive through `inbox/`; a GitHub workflow does the rest. How everything works, in depth: [docs/details.md](docs/details.md).

## Files

| | |
|---|---|
| `index.html`, `res/main.css`, `res/main.js` | the page |
| `photos.json` | generated index of all photos in date order — the page is built from it |
| `img/` | **1200 px** squares, `awp-YYYY-MM-DD-NN` — the one set the site and the gallery's walls share; `img/2000/` the larger file a print swaps to close up, `img/thumb/` 200 px for the tablet; a video is an `.mp4` of the same name |
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

## How large a picture is loaded

One set of photographs, at **1200 px** (`img/`), shown by the site and hung on the gallery's walls. That is already
finer than a Quest's panel can resolve at any distance a visitor stands: a 90 cm print's 1200 is 1.4× what the screen
shows at 1.3 m, and only falls under it inside 0.9 m — where the gallery's guard has begun objecting anyway (0.55 m).

So the **2000 px file** (`img/2000/`) is not a second set to load, but a sheet laid over the first for the short while
it earns its keep. It is **fetched inside 1.6 m, shown inside 1.2 m, given back past 3.2 m**, and every one of them is
handed back at once the moment the lift's doors shut on a ride — before the next floor's are read, so two floors never
hold their big files at the same time. The picture underneath never changes, so nothing flickers when the sheet comes
and goes.

The worst room in the gallery holds about **290 MB** of 1200s (mipmaps counted), some 60 MB of sheets at peak, and its label cards — 1280 px canvases, 3.1 MB each, one per photograph, 229 MB in the 74-frame room — near **580 MB** altogether. Years
split into parts when they will not fit a floor, so a room cannot grow without bound and neither can that figure.

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

## How the gallery hangs a room

One floor per year, newest at the top of the lift's console; thin years (five pieces or fewer) share a floor with their neighbours, and a year that does not fit one room is split into `2018.1`, `2018.2` — as few parts as fit.

1. **Pieces.** Each photo is judged `single` or `group` (`photos.json`, `hang`). Singles hang alone at 90 cm. Group photos are pooled by date (a gap of six weeks or more starts a new pool) and each pool is cut, in date order, into grids of 6 and 4, a row of 3 or a pair — a mix, most photos covered, fewest grids; a grid of 9 only where it saves a floor. A grid takes its place in the sequence at its first photo's date; a lone group photo left over hangs single at 60 cm. In a roomy year every fifth group photo hangs loose as a 60 instead.
2. **Walls first.** The room's walls are walked clockwise from the lift — the cabin's plastered face, then east, south, west, north. Grids go up first, then singles, each in date order (newest from the lift), at 1.2 m spacing that tightens to 0.6 m before the middle is used; corners and the lift's exit stay empty (0.6 m margins, 0.25 m on a short wall). A grid of four or more keeps 40 cm of bare wall beside it; a pair too wide for its stretch turns upright.
3. **The middle.** What the walls cannot take hangs back to back on slabs in rows across the room, rows and walkways sharing the depth evenly, every walkway at least 1.2 m; nothing in the two rectangles where one steps out of the lift.
4. **Height.** A piece's centre hangs on the 1.5 m line, or just high enough to clear the room's dado, never above 1.65 m; a dado that would push it higher is lowered instead.
5. **Labels.** A single's card hangs under its frame at the right; a grid's cards stand beside it in the grid's own pattern, in one column where the pattern does not fit, and under it where the wall has no room.

The layout is planned from the pieces' sizes alone (`hang.js`: `rooms()`, `layout()`), so every floor is known before a single frame exists; `?top=1` on the bench draws the plan.

## Open

- `secret.php` is tracked and its token is in the history: rotate it, remove the legacy PHP files.
- iPad on the device: rotation with a move in flight, the corner-radius fallback, trackpad Safari counting as touch.
- Next: the contact sheet (pinch to spread the pile into a grid).
