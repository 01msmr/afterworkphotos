# afterworkphotos

[afterworkphoto.com](https://afterworkphoto.com) — one square photo a day, taken after work. A single page, no build step, no framework.

## Files

| file | what it is |
|---|---|
| `index.html` | the page: title, empty `.main`, loads `res/main.css` + `res/main.js` |
| `res/main.js` | builds the photo sections; desktop scroll/keyboard UI and the mobile sheet deck |
| `res/main.css` | desktop layout at the top, the whole mobile deck inside `@media (max-width: 600px)` |
| `manifest.json` | web app manifest — required, see *iOS home screen app* |
| `img/1.jpg … N.jpg` | the photos, square, ~1000 px; numbered in order of adding |
| `img originals/` | the untouched originals |
| `inbox/` | where new photos land (the Shortcut puts them there); emptied by the ingest workflow |
| `scripts/ingest.sh` | numbers an inbox photo, makes the 1000 px square, moves the original, bumps `PHOTO_COUNT` |
| `.github/workflows/ingest.yml` | runs the script on every push to `inbox/` and commits the result |
| `upload.php`, `secret.php`, `.user.ini` | the old server-side upload endpoint — superseded by the inbox, to be removed |
| `apple-touch-icon.png`, `favicon.ico` | icons |
| `card-stack.html`, `res/onepage.*`, `res/noRubberband.js`, `favicon_.ico` | legacy / prototypes, not referenced by the page |

`PHOTO_COUNT` at the top of `res/main.js` is the single source of truth for how many photos exist.

## How the page works

### Desktop (wider than 600 px)

Two photos per full-height section, vertical scroll-snap. Photos are dimmed to 12 % and light up on hover. Keyboard: `Enter`/`Tab` enter keyboard mode, arrows move, `Escape` leaves. The mouse cursor is replaced by a small white dot.

### Mobile — the sheet deck

Photos run 1 → N and lie on each other like a stack of prints, photo 1 on top. Swiping up lifts the top sheet off and uncovers the next number; swiping down pulls the previous sheet back on. Tapping does the same: the upper part of the screen goes forward, the lower part back — the boundary is the thin dotted line printed on every sheet (`--divider-y`, set from the photo's position). The last sheet wraps to the first; it is the same move as any other, there are no clones.

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

1. numbers it `PHOTO_COUNT + 1` (several at once go in name order, so name them by date taken);
2. writes the 1000 px square derivative to `img/N.jpg` — auto-oriented, centre-cropped (a no-op for a square), JPEG q85, metadata stripped so no GPS reaches the public image;
3. moves the incoming file to `img originals/N_original.<ext>`, metadata intact;
4. bumps `PHOTO_COUNT` in `res/main.js`, commits `photo N`, pushes. The server pulls; live within seconds.

Runs are serialised, so two uploads can never both become photo N. A commit made by the workflow does not trigger it again.

The phone does this with a Shortcut that PUTs favourited photos into `inbox/` through the GitHub contents API (`PUT /repos/01msmr/afterworkphotos/contents/inbox/<yyyyMMdd-HHmmss>.jpg`, body `{"message":"inbox","content":"<base64>"}`, a fine-grained token with *Contents: read/write* on this repo only). It remembers what it has sent in a text file in iCloud Drive, so re-favouriting an old photo still works and un-favouriting never deletes anything.

By hand: `git add inbox/whatever.jpg && git commit && git push` does the same. To try the script locally: `scripts/ingest.sh` (needs ImageMagick), then look at what it staged.

`upload.php` is the old way — it edited `res/main.js` on the server, which the next pull undid — and is to be removed.

## Deployment

Push to `main`; the server (nginx) pulls automatically within seconds. Four files matter: `index.html`, `manifest.json`, `res/main.css`, `res/main.js`. The host serves `manifest.json` as `application/json` — keep the `.json` name, a `.webmanifest` may come back as `octet-stream` and iOS then ignores it.

Check a deploy from anywhere:

```sh
curl -s "https://afterworkphoto.com/res/main.js?cb=$RANDOM" | grep -c SCREEN_RADII   # 2 = new deck is live
```

## Local development

```sh
python3 -m http.server 8765 --bind 0.0.0.0     # then open http://<your LAN IP>:8765 on the phone
```

Send `Cache-Control: no-store` if you iterate on the phone — iOS caches hard. Mind that another project's server on `127.0.0.1:8765` wins over `0.0.0.0:8765` for localhost requests.

Mobile breakpoint is `PER_SECTION = innerWidth < 600 ? 1 : 2`, so a desktop window narrower than 600 px shows the deck.

## iOS home screen app — what was learned the hard way

- **The manifest is required.** With only the legacy `apple-mobile-web-app-*` metas, iOS 26/27 launches the icon as a browser window (bottom bar, `display-mode: browser`) on every start after the first. `display: standalone` in `manifest.json` fixes it. Reinstall the icon after changing the manifest; it is read at install.
- **Plain HTTP on a LAN IP never holds standalone mode**; test installs from the real HTTPS domain.
- **Never put the sheets inside a transformed/clipping container.** Inside one, iOS resolves `bottom: 0` a status bar short and gets `100lvh` wrong too — the card ends above the glass. Sheets `position: fixed` on the viewport with `top: env(safe-area-inset-top) + …` and `bottom: …` are sized correctly. The top is handled by painting a backdrop over them instead.
- **The status bar cannot be hidden or recoloured from a web page.** iOS picks black or white text from what it renders underneath; `theme-color`, `color-scheme` and a light hairline at the top edge all changed nothing. The blur along the top of the content under the status bar is iOS too; `--top-gap` keeps it on the backdrop instead of the paper.
- `safe-area-inset-bottom` is 34 px on Face ID phones and the best available hint for the corner radius when the model is not in `SCREEN_RADII` (×1.62 ≈ 55 px).

## Security note

`secret.php` must not be in the repository. It was, because the `.gitignore` line had a typo (`sth secret.php`); the line is fixed now, but the file is still tracked and the token is in the history — rotate `UPLOAD_SECRET` and `git rm --cached secret.php`.
