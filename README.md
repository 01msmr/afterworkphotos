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

## The gallery: how the rooms come to be

The VR gallery (`gallery/`, for a Meta Quest) is a house of floors joined by a lift, and every floor is a year of photographs.

- **A floor is a year.** The lift's console lists them newest at the top. A thin year (five pieces or fewer) shares a floor with its neighbours (`2009 · 2010 · 2012 · 2014`), and a year with more than one room's worth is split into `2018.1`, `2018.2`, as few parts as fit. One more floor, above the newest year, holds the visitor's favourites: the prints marked with a red dot.
- **A room's size and shape** start from the settings (6 × 4 × 3 m by default) and vary by floor: a hash of the floor's name picks one of a few proportions, wider or deeper, rounded to the half metre. On the bench the room grows in steps until the whole year hangs. In the headset, a scanned room is the room for every floor: an L, a U or a chamfered corner is hung along its real walls, and what does not fit is left out.
- **The floor is the year's.** Each year stands on its own material, so a year is remembered by what one walks on: grey lacquer, herringbone parquet, polished concrete, worn planks, terrazzo, checker plate, marble, shop tiles. The walls follow the floor: each floor has its paint and, under it, a dado, a skirting or wood panelling in a matching tone.
- **The lift** stands in the north-east corner of every room, doors to the west. Its console lays the years out like a calendar, ten across, the same year always in the same place; a press lights the year, closes the doors, and the shaft passes in the door seam while the next room is hung. A steel plate outside names the floor.
- **The guard** stands in a corner and speaks, in English or German, when one comes too close to a print, and small talk when nothing happens. A sheet of paper on the floor at the start, or on a wall on a press of B, carries the options.

## How the gallery hangs a room

Within a floor, the pieces are hung by these rules:

1. **Pieces.** Each photo is judged `single` or `group` (`photos.json`, `hang`). Singles hang alone at 90 cm. Group photos are pooled by date (a gap of six weeks or more starts a new pool) and each pool is cut, in date order, into grids of 6 and 4, a row of 3 or a pair — a mix, most photos covered, fewest grids; a grid of 9 only where it saves a floor. A grid takes its place in the sequence at its first photo's date; a lone group photo left over hangs single at 60 cm. In a roomy year every fifth group photo hangs loose as a 60 instead.
2. **Walls first.** The room's walls are walked clockwise from the lift — the cabin's plastered face, then east, south, west, north. Grids go up first, then singles, each in date order (newest from the lift), at 1.2 m spacing that tightens to 0.6 m before the middle is used; corners and the lift's exit stay empty (0.6 m margins, 0.25 m on a short wall). A grid of four or more keeps 40 cm of bare wall beside it; a pair too wide for its stretch turns upright.
3. **The middle.** What the walls cannot take hangs back to back on slabs in rows across the room, rows and walkways sharing the depth evenly, every walkway at least 1.2 m, and a row ends 1.2 m short of the wall so one gets round it; nothing in the two rectangles where one steps out of the lift.
4. **Every frame can be reached.** The floor is a 10 cm grid with the rows, the wall pieces and the cabin blocked round the body; a piece whose standing spot cannot be walked to from the lift's exit is not hung (on the bench the room grows until everything hangs; a real room leaves it out).
5. **Height.** A piece's centre hangs on the 1.5 m line, or just high enough to clear the room's dado, never above 1.65 m; a dado that would push it higher is lowered instead.
6. **Labels.** A single's card hangs under its frame at the right; a grid's cards stand beside it in the grid's own pattern (2 cm between columns, 3.5 cm between rows), in one column where the pattern does not fit, and under it where the wall has no room.

The layout is planned from the pieces' sizes alone (`hang.js`: `rooms()`, `layout()`, `layoutFor(key)`), so every floor is known before a single frame exists; `?top=1` on the bench draws the plan.

## The instant lift

A on the right controller pins a strip on the wall: the black strip scrubs the whole collection by the pointer's height with the trigger held, the grey one beside it scrubs one year over its length, and you may cross between them while scrubbing. The print shown, pressed, lays chalk on the floor to a circle where an 80 cm circle is free both on this floor and on the print's, and the guard says so. Standing in the circle the room goes dark round you (4 s), stays dark while the other floor is hung (2 s) and lights again over 4 s once the pictures in view are there; only the floor, at a fifth, and the chalk show meanwhile. You stay where you stood, and the chalk leads on to the print, round every row and frame, with an arrow at the end that stays half a minute after you arrive.

## Open

- `secret.php` is tracked and its token is in the history: rotate it, remove the legacy PHP files.
- iPad on the device: rotation with a move in flight, the corner-radius fallback, trackpad Safari counting as touch.
- Next: the contact sheet (pinch to spread the pile into a grid).
