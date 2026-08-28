# VR gallery — design draft

Date: 2026-08-23. Status: **questions answered, ready for review** — the decisions are recorded in the questions section at the end; everything still marked *assumed* is a default that can be flipped during review.

**Scope decision (2026-08-28):** the gallery targets **real VR only — Meta Quest 3 / 3S**. No phone, no tablet, no drag-to-look 3D view for Apple or Android devices; those tiers are dropped from this document. The desktop browser view survives solely as the **development bench**: the room is built and checked there because a headset on every iteration is impractical, but it is not a product and gets no polish of its own.

## The idea

A white-cube gallery you walk through: the afterworkphotos as big prints in wood frames with a white paper gap (mat) inside the frame, hanging from the ceiling on thin transparent lines, singly or in groups of two or three. **One room per year.** An **elevator** in a corner of the room takes you between the years: its panel lists the years as floors, each with an overview strip of that year's images. A switchboard beside the elevator sets light/dark mode, the frame colour and a few other things. Where the headset can see the real room, the gallery *is* that room — frames hang on its actual walls, the elevator stands in one of its real corners; elsewhere it is a synthetic room of a chosen size.

## What the web can and cannot do today (the constraints that shape the plan)

| device | immersive mode | room scanning |
|---|---|---|
| Meta Quest 3 / 3S / Pro (Browser) | WebXR `immersive-ar` and `immersive-vr` | yes: `plane-detection` (walls, floor, ceiling as planes) and `mesh-detection` from the headset's room setup |
| Apple Vision Pro (Safari, visionOS 2+) | WebXR `immersive-vr` with hand tracking | **no** room data to web pages; no `immersive-ar` |
| iPhone / iPad Safari | **no WebXR** at all | no (ARKit is not exposed to the web; only third-party shells like Variant Launch) |
| Android Chrome (ARCore phones) | `immersive-ar` | `plane-detection` (floor and walls, rougher) |
| desktop browsers | none — plain 3D view | no |

So "scan a small room" is only real on a Quest 3. That is the device this gallery is for; the rest of the table explains why nothing else is a target.

## Approach (assumed — see questions)

One new page, `gallery/index.html`, with its own `res/gallery.js` + `res/gallery.css`, built on **three.js** as a vendored ES module (`res/vendor/three.module.js` + `res/vendor/three.core.js`, ≈ 2 MB, gzip ≈ 500 KB; no build step, no CDN — the site is self-hosted and cached hard). three.js has the WebXR session handling, plane/mesh detection helpers, shadow maps and controller/hand input built in; A-Frame would be quicker to scaffold but adds a component framework on top of the same three.js for a page that has five kinds of object.

Two modes of the same page, both on the Quest 3 / 3S:

1. **VR** — `immersive-vr`, the synthetic white cube, teleport by controller/hand pinch, the switchboard as a real panel in the room.
2. **AR / real room** — `immersive-ar` with `plane-detection`: the real walls are used as the walls, the real ceiling height as the ceiling; the frames hang on them; the wall colour of light/dark mode becomes a tint overlay since the real wall shows through (passthrough).

Mode 2 is the "scan": the headset's own room setup already knows the walls — the page does not scan, it *asks* for the planes and builds the room from them (`XRPlane` objects with polygon + orientation). That is the "relatively small, not too complex" room: convex-ish, walls as planes; a room the headset can't describe as planes falls back to mode 1.

**The desktop view is the bench, not a mode.** Opened in a desktop browser, the page shows the synthetic room with mouse-look + WASD so the room, frames, light and hanging can be built and checked without a headset. It is the test harness for phase 1 and stays available afterwards for the same reason; it is not designed for, not linked, and gets no touch controls. A phone or tablet opening the page gets nothing intended.

## The room

Synthetic room: floor W × D, height H (assumed defaults 6 × 4 × 3 m, settable). Walls off-white (`#f2f1ee`) in light mode, dark grey (`#1b1b1b`) in dark mode; floor pale concrete; ceiling white with a track of spots. There is no entrance door: you arrive **by the elevator**, which stands in a corner (≈ 1.2 × 1.2 m, doors opening into the room); you step out of it facing the room. The **switchboard** is on the wall immediately beside the elevator at 1.3 m height.

Real room (mode 2): walls from planes; the elevator is placed in the real corner nearest the viewer's start position (where the headset was when the session began) — assumed; a "put it here" gesture can move it to another corner.

**The elevator.** Inside, a panel of **real floor buttons** — round, pressable, one per year, the year printed on each, newest at the top — the way a lift's panel is and nothing more. *(Decided 2026-08-28; the earlier idea of knobs with digit drums and a thumbnail strip beside each year is dropped — the button is the whole interface.)* Press a year and the elevator **switches rooms**: the doors close and open again on that year's room (a short dip and the floor indicator counting — one second, no more). The current year's button is lit. Going back is pressing another floor. On the bench the same list of years is reachable as a DOM overlay (press `Y`).

## The frames

- **Two kinds of print.** *Singles*: 90 × 90 cm, for the architectural and big-view photos. *Group prints*: 40 × 40 cm, hung in grids of 6 (3 × 2) or 9 (3 × 3) with 8 cm between frames, for the fun and simple ones — but not every simple one: a grid forms only where at least six group-candidates follow each other in date order; the rest of them hang single at 60 cm. So three sizes: 90 (single), 60 (single, simple), 40 (in a grid).
- **Which is which.** A per-photo field `hang: "single" | "group"` in `photos.json`, set once for the existing photos by a classification pass and for each new photo by the ingest workflow (see *Curation* below); hand-editable.
- **Texture**: the 1000 px image — on 90 cm that is 1.1 px/mm, soft up close; a 2000 px derivative (`img/large/`) is phase 5.
- **Mat** (white paper gap) 6 cm all round on a 90, 4 cm on a 60, 3 cm on a 40; paper white with a faint bevel at the window cut.
- **Frame** wood, 3 cm face × 4 cm deep, colours: natural oak, walnut, black, white (switchboard). Slight wood grain texture (procedural, 1 tileable image) so it doesn't read as plastic.
- **Glass** none (assumed — glass adds reflections that fight the photos).
- **Hanging**: two lines from the ceiling to the frame's top corners, 0.5 mm "nylon" — a thin, slightly transparent cylinder that catches a highlight; the frames hang plumb, **no sway** (motion for its own sake is noise in a gallery).
- **Along the wall**: singles and grids in date order with gallery spacing (≈ 1.2 m between pieces; a grid counts as one piece, ≈ 1.4 m wide for 3 × 3). A run of group-candidates longer than 9 splits into grids of 9 and 6 (e.g. 15 = 9 + 6; 7 = 6 + 1 single at 60).
- **Order**: newest first from the door, clockwise — the same order as the site.
- **Labels**: a small card to the lower right of each piece: `afterworkphoto 208 · Oct 2018` (a grid's card lists its numbers) (switchable).
- **Videos** (Uli, 2026-08-28): a photo that has a video hangs as a **square LED panel** in place of a print — a visible matrix of individual diodes, relatively large but not coarse enough to lose the picture (the look of an LED wall seen close, not a flat screen; no frame, no mat, no glass), the video playing on it. Sized like the print it replaces. Which phase: the panel's mesh with the still frame in phase 1 if cheap, the playing video in phase 4 with the other video work. **Built 2026-08-29**: the panel, the diode mask and the play-while-looked-at rule are in `res/gallery.js` (`makeVideoPanel()`, `stepVideos()`); see `docs/details.md`.

**How many hang at once — a full room.** A 6 × 4 m room has ≈ 18 m of hangable wall ≈ 16–20 prints at gallery spacing. The **corners stay empty**: 60 cm from every wall's end and from the elevator before the first frame (Uli, 2026-08-28). When a year has more, the room **fills up**: first the spacing tightens (down to ≈ 10 cm), then prints hang **free in the middle of the room** from the ceiling — rows of frames back to back down the room's long axis, double-sided (a print on each face), with 1.5 m walkways either side, like a hanging exhibition; a 4 m room takes one row, every further 1.5 m of depth another. A year that still does not fit **splits into two rooms by date** (Uli, 2026-08-28 — replaces the earlier "never a second room"): the first half of the year in one, the second in the next, each its own elevator floor (`2018-1`, `2018-2`), the later half above. Should half a year still not fit — with this collection 2016, 2018 and 2024 have 23–25 pieces a half — the room grows in 1.5 × 1 m steps until it does and says so in the console; with the 6 × 4 default those halves stand in 7.5 × 5. `Hang` plans from piece widths alone (no meshes) so the elevator's floors are known before any room is built; only the current room exists, the elevator swap builds the next. A thin year (a few photos) hangs sparse on one wall.

## Curation — deciding single or group

The rule wants a judgement per photo ("architectural / big view" → single, "fun / simple" → group-candidate). Options, my recommendation first:

1. **A one-off pass with a vision model** (Claude, `claude-sonnet-5`, one image per call, a fixed prompt returning `single` or `group` with a one-line reason), written into `photos.json` as `hang`, with the reasons kept in a side file for review. New photos get classified in the ingest workflow the same way (one API call per photo; the key as a repository secret). Cost: 208 thumbnails ≈ cents. Uli reviews the list once and flips what's wrong.
2. **Manual**: a `hang.txt` of numbers that are singles; everything else is a group-candidate. No dependency; 208 decisions by hand, and every new photo needs one.
3. **Image statistics** (edge density, entropy): free but wrong often enough to need the manual list anyway.

## Light and shadow

- Light mode: a bright ambient + a row of ceiling spots, one per piece (a single or a grid), angled at the frames; soft shadow maps so each frame throws its shadow on the wall (the frame's 4 cm depth and the hanging lines show there). Dark mode: ambient almost off, the spots alone — the white-cube-at-night look, prints glowing.
- The mat's bevel and the frame's inner edge get the same treatment as the phone's paper edges: a lit top-left, a dark thickness.
- Real room: lights are placed relative to the detected ceiling; no shadow on the passthrough walls (can't darken passthrough), but the frames shadow *each other* and the lines.

## The switchboard

A wall panel left of the door, ≈ 40 × 30 cm, physical-looking toggles and a few dials; in VR you point/pinch; on the bench it's mirrored as a small DOM panel (keyboard/mouse). Settings, with the ones I'd include now and the rest as candidates:

| setting | values | in v1? |
|---|---|---|
| Light / dark | light cube / dark room with spots | yes |
| Frame colour | oak / walnut / black / white | yes |
| Mat | white / warm white / none (print to the frame edge) | yes |
| Print scale | 100 % / 80 % (all sizes together, for a small real room) | yes |
| Labels | on / off | yes |
| Grids | on (6/9 grids for group-candidates) / off (everything single at 60) | later |
| Order | newest first / oldest first / a year | later |
| Room size (synthetic only) | W × D × H | yes (hidden in AR) |
| Spot warmth | 3000 K / 4000 K | later |
| Movement (VR) | teleport / smooth | yes |
| Videos | play on approach / still frame | later |

Settings persist in `localStorage`; the URL carries them too (`gallery/?frame=black&mode=dark`) so a look can be shared.

## Files and interfaces

- `gallery/index.html` — page shell, loads the module; reached by URL only for now.
- `res/gallery.js` — `Room` (synthetic or from planes), `Hang` (pieces along the walls, then centre rows; capacity from the perimeter), `Frame` (mesh factory: print + mat + frame + lines, three sizes), `Elevator` (corner cabin, year panel with overview strips, the room switch), `Switchboard` (panel + DOM mirror + settings model), `Walk` (headset input; mouse + keys on the bench), `Session` (WebXR feature negotiation: tries `immersive-ar` + `plane-detection`, then `immersive-vr`; without WebXR the page is the bench).
- `scripts/classify.py` (or a step in `ingest.sh`) — the vision-model pass writing `hang` into `photos.json`; `docs/hang-reasons.txt` with one line per photo for review.
- `res/vendor/three.module.js` and the WebXR plane helpers — vendored, version pinned in a comment.
- `photos.json` gains `hang` per photo; the main page ignores it.

## Phases (each usable on its own)

0. **Curation** — the classification pass; `hang` in `photos.json`; Uli reviews the reasons file. *Done 2026-08-28 (branch `vr-view`).*
1. **The white cube on the bench** — one year-room, singles and grids with mat and wood, spots and shadows, walk with mouse/keys, DOM switchboard, the elevator as a corner cabin whose panel switches the year. Built and checked in a desktop browser; this is where the look gets decided.
2. **VR** — `immersive-vr` on the Quest 3S; in-room switchboard and elevator panel; teleport.
3. **Real room** — `immersive-ar` + `plane-detection` on the Quest 3S; frames on real walls, centre rows down the real room; the elevator in the nearest real corner.
4. **Polish** — labels, videos on approach, wood/mat textures, 2000 px textures, the ingest-time classification.

*(A former phase 2, "Phone 3D" with touch controls, was dropped on 2026-08-28: the gallery is for the headset only.)*

## Open questions (please answer before phase 1)

1. **Devices** — *answered, then narrowed 2026-08-28*: the Quest 3 / 3S is the only device. Both headset modes (VR, real room) are developed and tested on it. No phone, no tablet, no Vision Pro; a desktop browser is the development bench only.
2. **Dependency** — *answered*: vendored three.js, pinned, loaded only by `gallery/index.html`.
3. **Rooms** — *answered*: one room per year; an elevator in a corner (not a door) switches years, with an overview strip per year on its panel; a full room hangs prints denser and then free in the middle of the room.
4. **Grouping**: consecutive-day runs hang together (my assumption), or groups by month, or purely visual (alternate 1/2/3)?
5. **Print size and grouping** — *answered*: 90 cm singles; smaller prints in grids of 6 or 9 for fun/simple photos, not always grouped. The single/group decision: **vision-model pass** (option 1 under *Curation*), for the existing photos once and for every new photo in the ingest workflow.
6. **The elevator in the real room** — *answered*: the corner nearest where you stood when the session started, placed automatically.
7. **Link** — *answered*: hidden, `gallery/index.html` by URL only until it is worth showing.
