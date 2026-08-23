# VR gallery — design draft

Date: 2026-08-23. Status: **draft for Uli's review** — written while the iPad deck was being tested on devices, so the open questions at the end are not yet answered; everything marked *assumed* is a choice that can be flipped.

## The idea

A white-cube gallery you walk through: the afterworkphotos as big prints in wood frames with a white paper gap (mat) inside the frame, hanging from the ceiling on thin transparent lines, singly or in groups of two or three. A switchboard on the wall left of the entrance door sets light/dark mode, the frame colour and a few other things. Where the headset can see the real room, the gallery *is* that room — frames hang on its actual walls; elsewhere it is a synthetic room of a chosen size.

## What the web can and cannot do today (the constraints that shape the plan)

| device | immersive mode | room scanning |
|---|---|---|
| Meta Quest 3 / 3S / Pro (Browser) | WebXR `immersive-ar` and `immersive-vr` | yes: `plane-detection` (walls, floor, ceiling as planes) and `mesh-detection` from the headset's room setup |
| Apple Vision Pro (Safari, visionOS 2+) | WebXR `immersive-vr` with hand tracking | **no** room data to web pages; no `immersive-ar` |
| iPhone / iPad Safari | **no WebXR** at all | no (ARKit is not exposed to the web; only third-party shells like Variant Launch) |
| Android Chrome (ARCore phones) | `immersive-ar` | `plane-detection` (floor and walls, rougher) |
| desktop browsers | none — plain 3D view | no |

So "scan a small room" is only real on a Quest 3 (and roughly on an Android phone). On everything Apple the room is synthetic, and on the iPhone there is no immersion at all — it is a 3D view you look around in by dragging.

## Approach (assumed — see questions)

One new page, `gallery.html`, with its own `res/gallery.js` + `res/gallery.css`, built on **three.js** as a vendored ES module (`res/vendor/three.module.js`, ≈ 650 KB gzip ≈ 170 KB; no build step, no CDN — the site is self-hosted and cached hard). three.js has the WebXR session handling, plane/mesh detection helpers, shadow maps and controller/hand input built in; A-Frame would be quicker to scaffold but adds a component framework on top of the same three.js for a page that has five kinds of object.

Three tiers of the same page, by capability:

1. **3D view** (all devices, always available): the synthetic white cube, mouse-look + WASD on the desktop, drag-to-look + tap-to-walk on the phone. This is the base everyone gets and what the iPhone gets.
2. **VR** (Quest, Vision Pro): `immersive-vr`, the same synthetic room, teleport by controller/hand pinch, the switchboard as a real panel in the room.
3. **AR / real room** (Quest 3, Android): `immersive-ar` with `plane-detection`: the real walls are used as the walls, the real ceiling height as the ceiling; the frames hang on them; the wall colour of light/dark mode becomes a tint overlay since the real wall shows through (passthrough).

Tier 3 is the "scan": the headset's own room setup already knows the walls — the page does not scan, it *asks* for the planes and builds the room from them (`XRPlane` objects with polygon + orientation). That is the "relatively small, not too complex" room: convex-ish, walls as planes; a room the headset can't describe as planes falls back to tier 2.

## The room

Synthetic room: floor W × D, height H (assumed defaults 6 × 4 × 3 m, settable). Walls off-white (`#f2f1ee`) in light mode, dark grey (`#1b1b1b`) in dark mode; floor pale concrete; ceiling white with a track of spots. The **entrance door** is in the middle of one short wall — the viewer starts just inside it, facing the room. The **switchboard** is on the wall immediately left of the door at 1.3 m height.

Real room (tier 3): walls from planes, door = the wall segment nearest the viewer's start position (where the headset was when the session began) — assumed; a "this is the door" gesture can replace it.

## The frames

- **Print** 60 × 60 cm (assumed; 50 or 70 selectable), the 1000 px image as texture (1000 px on 60 cm = 1.7 px/mm, fine at gallery distance; a 2000 px derivative would be a later upgrade).
- **Mat** (white paper gap) 6 cm all round, paper white with a faint bevel at the window cut.
- **Frame** wood, 3 cm face × 4 cm deep, colours: natural oak, walnut, black, white (switchboard). Slight wood grain texture (procedural, 1 tileable image) so it doesn't read as plastic.
- **Glass** none (assumed — glass adds reflections that fight the photos).
- **Hanging**: two lines from the ceiling to the frame's top corners, 0.5 mm "nylon" — a thin, slightly transparent cylinder that catches a highlight; the frames hang plumb, **no sway** (motion for its own sake is noise in a gallery).
- **Groups**: singles, pairs and triples, laid out along the walls with gallery spacing (≈ 40 cm inside a group, ≈ 1.2 m between groups). The grouping rule (assumed): consecutive days form a group (a run of 2 or 3 daily photos hangs together; a lone day hangs alone); groups longer than 3 split into 3 + rest.
- **Order**: newest first from the door, clockwise — the same order as the site.
- **Labels**: a small card to the lower right of each group: `afterworkphoto 208 · Oct 2018` (switchable).

**How many hang at once.** A 6 × 4 m room has ≈ 18 m of hangable wall ≈ 16–20 prints. 208 (and growing) don't fit, so the gallery is a **sequence of rooms**: the far wall has a second door, and walking through it loads the next room with the next run of photos (rooms are generated on the fly from `photos.json`; the room behind is dropped). In the real room (AR) the same: walking "through" the far wall's door — a virtual door drawn on the real wall — swaps the hung prints for the next run, in place. *Assumed*: one room = one run of ~16–20 prints; a room per **year** is the natural alternative (the door label says the year) — see questions.

## Light and shadow

- Light mode: a bright ambient + a row of ceiling spots, one per group, angled at the frames; soft shadow maps so each frame throws its shadow on the wall (the frame's 4 cm depth and the hanging lines show there). Dark mode: ambient almost off, the spots alone — the white-cube-at-night look, prints glowing.
- The mat's bevel and the frame's inner edge get the same treatment as the phone's paper edges: a lit top-left, a dark thickness.
- Real room: lights are placed relative to the detected ceiling; no shadow on the passthrough walls (can't darken passthrough), but the frames shadow *each other* and the lines.

## The switchboard

A wall panel left of the door, ≈ 40 × 30 cm, physical-looking toggles and a few dials; in VR you point/pinch, in the 3D view it's also mirrored as a small DOM panel (keyboard/mouse). Settings, with the ones I'd include now and the rest as candidates:

| setting | values | in v1? |
|---|---|---|
| Light / dark | light cube / dark room with spots | yes |
| Frame colour | oak / walnut / black / white | yes |
| Mat | white / warm white / none (print to the frame edge) | yes |
| Print size | 50 / 60 / 70 cm | yes |
| Labels | on / off | yes |
| Grouping | by consecutive days / all singles / pairs / triples | later |
| Order | newest first / oldest first / a year | later |
| Room size (synthetic only) | W × D × H | yes (hidden in AR) |
| Spot warmth | 3000 K / 4000 K | later |
| Movement (3D/VR) | teleport / smooth | yes (VR) |
| Videos | play on approach / still frame | later |

Settings persist in `localStorage`; the URL carries them too (`gallery.html?frame=black&mode=dark`) so a look can be shared.

## Files and interfaces

- `gallery.html` — page shell, loads the module; a link from the main page (small "gallery" under the title, or a door icon).
- `res/gallery.js` — `Room` (synthetic or from planes), `Hang` (layout of groups along walls), `Frame` (mesh factory: print + mat + frame + lines), `Switchboard` (panel + DOM mirror + settings model), `Walk` (input per tier), `Session` (WebXR feature negotiation: tries `immersive-ar` + `plane-detection`, then `immersive-vr`, then plain 3D).
- `res/vendor/three.module.js` and the WebXR plane helpers — vendored, version pinned in a comment.
- `photos.json` as is — the gallery reads the same list.

## Phases (each usable on its own)

1. **3D white cube on desktop** — synthetic room, frames with mat and wood, spots and shadows, walk with mouse/keys, DOM switchboard. This is where the look gets decided.
2. **Phone 3D** — touch look/walk; same page.
3. **VR** — `immersive-vr` on Quest and Vision Pro; in-room switchboard; teleport; door-to-next-room.
4. **Real room** — `immersive-ar` + `plane-detection` on Quest 3; frames on real walls; virtual door on the far wall.
5. **Polish** — labels, videos on approach, wood/mat textures, 2000 px textures.

## Open questions (please answer before phase 1)

1. **Devices** — *answered*: a Quest 3S is available for testing, so all three tiers apply; the real-room tier is developed and tested on it. Apple devices get tier 1 (iPhone/iPad/Mac) — no Vision Pro.
2. **Dependency**: OK with a vendored three.js (~650 KB) on a site that is otherwise a few KB and framework-free? The alternative is hand-written WebGL, which I'd advise against.
3. **Rooms**: one run of ~18 prints per room, or one room per year (fewer, fuller or emptier rooms; a sign on each door)?
4. **Grouping**: consecutive-day runs hang together (my assumption), or groups by month, or purely visual (alternate 1/2/3)?
5. **Print size and mat**: 60 cm with a 6 cm mat — does that match how you'd actually print them?
6. **The door and the switchboard in the real room**: is "where you stood when you started" an acceptable door position, or should you tap the real door frame?
7. **Link from the main page**: visible ("gallery" under the title) or hidden (only via URL) at first?
