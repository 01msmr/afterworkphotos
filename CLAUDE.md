# CLAUDE.md — afterworkphotos

A static page, no build step, no framework. The overview is `README.md`; **how everything works is `docs/details.md` — read the relevant section before changing `res/main.js` or `res/main.css`, and update it after any change in behaviour.** The VR gallery (`gallery/`, `res/gallery.*`) has its spec in `docs/superpowers/specs/`.

## Rules

- **Bump `?v=` on the CSS and JS links in `index.html` with every change to them.** The server sends no cache headers; without the bump the installed app keeps the old code.
- **The gallery's modules carry that version in their import lines too** (`res/gallery.js` + `res/gallery/*.js`): a module is its URL, so bump them all in one go — `sed -i '' 's/?v=OLD/?v=NEW/g' gallery/index.html res/gallery.js res/gallery/*.js`.
- **Never measure the viewport height from JS at load.** `--app-height` is `100lvh` in the CSS. iOS launches the home screen app's view one status bar short and extends it only past a taller document; `100dvh` or `innerHeight` freeze the short view and leave a black band under the sheets. Details: `docs/details.md`, *iOS home screen app*.
- **Sheets stay `position: fixed` on the viewport** — never inside a transformed or clipping container (iOS sizes them wrong there).
- Layout by CSS, not by measuring: shared tokens (`--side`, `--title-band`, `--top-gap`, `--inset`, `--settle`, `--shade-in`), not `getBoundingClientRect` for alignment.
- YAGNI (global rules apply): one token, no options, no abstractions on stock.
- iOS findings that cost time go into `docs/details.md` under *iOS home screen app — what was learned the hard way*.

- **The photographs are one set: `img/<name>.jpg` at 1200 px**, shown by the site and hung on the gallery's walls, with `img/2000/` for a print a visitor stands at and `img/thumb/` for the tablet. There is no 1600 set any more — it and a short-lived `img/1200/` were removed from the working tree and from git history on 2026-09-13 (1.8 GB → 337 MB). Backups: `../awp-before-rewrite-*.bundle`, `../awp-img1600-*.tgz`.

## Checking a change

There is no unit test runner. The deck is checked in Chrome against the local server with synthetic touches:

```sh
python3 -m http.server 8765 --bind 0.0.0.0
```

- **`http://127.0.0.1:8765/tests/deck.html`** — the deck at 390×844: viewport, title stacking, swipe/flick/tap landings and their settle times, the shadow on entry, the tap divider, the scrubber label and gears. Every line ok before a deck change is pushed; **add a line when a deck behaviour changes.** The window must be on screen — an occluded Chrome tab paints no frames and the first check says so.
- Desktop: `index.html` in a wide window; the deck by hand: `?touch=1` (`?tablet=1` for the iPad layouts).
- On the device: from the HTTPS domain, installed to the home screen; the installed app is the product.

Commit on `vr-view` and cherry-pick to `main` (which deploys) unless told otherwise; the server pulls `main` within seconds.
