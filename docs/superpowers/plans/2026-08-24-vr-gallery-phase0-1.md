# VR Gallery — Phase 0 (Curation) + Phase 1 (Desktop White Cube) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every photo carries a `hang` judgement (single or group), and `gallery.html` renders a walkable 3D white-cube year-room with framed prints, an elevator, and a settings panel — in a desktop browser as the development bench, no XR yet. The product is the Quest 3 / 3S (phases 2–3); nothing here targets a phone or tablet.

**Architecture:** A separate page (`gallery.html` + `res/gallery.js` + `res/gallery.css`) built on a vendored three.js ES module; the main page is untouched except nothing (the link stays hidden). The gallery reads the same `photos.json`. One room exists at a time (a year); the elevator rebuilds it. Modules inside `gallery.js`: `Room`, `Frame`, `Hang`, `Elevator`, `Switchboard`, `Walk` — plain objects/functions in one file, split only if it grows past ~1200 lines.

**Tech Stack:** three.js (pinned, vendored, ES module), vanilla JS, CSS; Python `http.server` + Chrome (claude-in-chrome tools) as the test runner, as in `docs/superpowers/plans/2026-08-23-ipad-deck-and-scrubber.md`.

**Spec:** `docs/superpowers/specs/2026-08-23-vr-gallery-design.md` (all decisions recorded there; phases 2–5 get their own plans after this one lands).

## Global Constraints

- No build step, no CDN at runtime: three.js is committed under `res/vendor/`, version pinned in a header comment.
- `hang` values: `"single"` | `"group"`; written into `photos.json` per photo; the main page ignores the field.
- Print sizes (spec): singles 90 cm (architectural) and 60 cm (simple, ungrouped); grids of 6 (3×2) or 9 (3×3) of 40 cm prints, 8 cm between frames, formed only from runs of ≥ 6 group-candidates in date order.
- Frame: 3 cm face, 4 cm deep; mat 6/4/3 cm (90/60/40); no glass. Room default 6 × 4 × 3 m. Eye height 1.6 m, frame centres at 1.5 m.
- Gallery page reachable by URL only; no visible link from the main page.
- Commit after every task; `?v=` versioning applies only to the main page — `gallery.html` references its assets with its own `?v=` from the start (`20260824a`).
- The Claude API key for classification comes from the environment (`ANTHROPIC_API_KEY`); it is never committed. The model is `claude-sonnet-5`.

## Test harness

As in the deck plan: `python3 -m http.server 8765` in the repo, a Chrome tab on `http://127.0.0.1:8765/gallery.html`, checks via `javascript_tool`. three.js scenes are asserted through the scene graph (`scene.getObjectByName`, counts, bounding boxes, camera pose) plus screenshots; WebGL renders fine in the MCP tab. Note the session's known pitfall: **background-tab throttling** pauses rAF — assert state, not animation timing, and take a screenshot first when timing matters.

---

### Task 0.1: The classification script

**Files:**
- Create: `scripts/classify.py`
- Modify: `photos.json` (adds `hang` per photo)
- Create: `docs/hang-reasons.txt`

**Interfaces:**
- Produces: `photos.json` entries gain `"hang": "single" | "group"`; `docs/hang-reasons.txt` lines of `n<TAB>hang<TAB>one-line reason` for review.

- [ ] **Step 1: Write the script**

```python
#!/usr/bin/env python3
"""Classify each photo: 'single' (architectural / big view -> hangs 90cm alone)
or 'group' (fun / simple / detail -> candidate for a 40cm grid).
Writes 'hang' into photos.json and reasons into docs/hang-reasons.txt.
Only photos without 'hang' are classified (safe to re-run)."""
import base64, json, os, sys, time, urllib.request

MODEL = "claude-sonnet-5"
PROMPT = (
    "This is one square photo from a daily photo series. Classify it for a gallery hanging:\n"
    "'single' if it is architectural, a big view, spatial, quiet or monumental - it earns a large print alone.\n"
    "'group' if it is a fun find, a simple object, a close detail, a joke - it works in a grid of small prints.\n"
    'Answer as JSON only: {"hang": "single"|"group", "reason": "<one short line>"}'
)

def classify(path, key):
    with open(path, "rb") as fh:
        b64 = base64.standard_b64encode(fh.read()).decode()
    body = json.dumps({
        "model": MODEL, "max_tokens": 100,
        "messages": [{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
            {"type": "text", "text": PROMPT}]}],
    }).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", body, {
        "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"})
    out = json.loads(urllib.request.urlopen(req, timeout=60).read())
    txt = out["content"][0]["text"]
    ans = json.loads(txt[txt.index("{"):txt.rindex("}") + 1])
    assert ans["hang"] in ("single", "group"), ans
    return ans

def main(limit=None):
    key = os.environ["ANTHROPIC_API_KEY"]
    data = json.load(open("photos.json"))
    todo = [p for p in data["photos"] if "hang" not in p][:limit]
    with open("docs/hang-reasons.txt", "a") as log:
        for i, p in enumerate(todo):
            ans = classify(p["thumb"], key)          # the 200px thumb is enough
            p["hang"] = ans["hang"]
            log.write(f"{p['n']}\t{ans['hang']}\t{ans['reason']}\n")
            print(f"{p['n']}: {ans['hang']} - {ans['reason']}")
            json.dump(data, open("photos.json", "w"), indent="\t", ensure_ascii=False)
            time.sleep(0.3)
    print(f"done: {len(todo)} classified")

if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else None)
```

- [ ] **Step 2: Dry-run on three photos**

Run: `ANTHROPIC_API_KEY=… python3 scripts/classify.py 3`
Expected: three lines printed, each `single` or `group` with a plausible reason; `photos.json` gains `hang` on exactly 3 photos. If the key is not configured, STOP and ask Uli for it.

- [ ] **Step 3: Full run and sanity counts**

Run: `python3 scripts/classify.py` then `python3 -c "import json;p=json.load(open('photos.json'))['photos'];print(sum(1 for q in p if q['hang']=='single'), sum(1 for q in p if q['hang']=='group'))"`
Expected: all 208+ classified; both classes non-empty (if one class is > 90 %, flag it to Uli before continuing — the prompt may need tuning).

- [ ] **Step 4: Hand the reasons file to Uli**

Report in chat: the counts and the path `docs/hang-reasons.txt`; Uli flips wrong ones by editing `hang` in `photos.json` (the reasons file is the guide). Do not wait — continue; corrections are one-field edits at any time.

- [ ] **Step 5: Commit**

```bash
git add scripts/classify.py photos.json docs/hang-reasons.txt && git commit -m "curation: hang judgement per photo (vision pass)"
```

---

### Task 0.2: Vendor three.js and the page shell

**Files:**
- Create: `res/vendor/three.module.js` **and** `res/vendor/three.core.js` (three@0.180.0, MIT — since r165 `three.module.js` is a shim importing `./three.core.js`, so both are needed; record the version in a comment at the top of `gallery.js`)
- Create: `gallery.html`, `res/gallery.js`, `res/gallery.css`

**Interfaces:**
- Produces: `gallery.html` loads `res/gallery.js` as `type="module"`, which imports `* as THREE` from `./vendor/three.module.js` and exposes `window.G = { scene, camera, renderer, state }` **for the test harness only** (documented as such).

- [ ] **Step 1: Download and pin three.js** (ask Uli before downloading: file `three.module.js`, source `https://unpkg.com/three@0.180.0/build/three.module.js`, ~1.3 MB)

```bash
curl -sL -o res/vendor/three.module.js "https://unpkg.com/three@0.180.0/build/three.module.js" && head -3 res/vendor/three.module.js && wc -c res/vendor/three.module.js
```

- [ ] **Step 2: The shell**

`gallery.html`: viewport meta, `<title>afterworkphotos — gallery</title>`, `<link rel="stylesheet" href="res/gallery.css?v=20260824a">`, an empty `<main id="stage">`, `<script type="module" src="res/gallery.js?v=20260824a"></script>`. `res/gallery.js` starts with:

```js
// three.js 0.180.0, vendored (MIT) — res/vendor/three.module.js
import * as THREE from './vendor/three.module.js';

const state = { year: null, settings: null, photos: [] };
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(66, 1, 0.05, 100);
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
fetch('photos.json', { cache: 'no-cache' }).then(r => r.json()).then(d => { state.photos = d.photos; init(); });
function init() { /* filled by the next tasks */ }
renderer.setAnimationLoop(() => renderer.render(scene, camera));
window.G = { scene, camera, renderer, state };   // test harness handle
```

`res/gallery.css`: `html,body{margin:0;height:100%;overflow:hidden;background:#111} #stage,canvas{width:100%;height:100%;display:block}`.

- [ ] **Step 3: Check it boots**

Browser: `http://127.0.0.1:8765/gallery.html` →
```js
({ three: !!window.G, rev: (await import('/res/vendor/three.module.js')).REVISION, photos: G.state.photos.length })
```
Expected: `rev: "180"`, `photos: 208+`.

- [ ] **Step 4: Commit** — `git add gallery.html res/gallery.js res/gallery.css res/vendor/three.module.js && git commit -m "gallery: page shell with vendored three.js"`

---

### Task 1.1: The room

**Files:** Modify `res/gallery.js`

**Interfaces:**
- Produces: `buildRoom(W, D, H)` → a `THREE.Group` named `"room"` (floor, 4 walls, ceiling, spot track), added to the scene by `init()`; `applyMode(dark)` switches wall/ambient values. Settings defaults: `{ W: 6, D: 4, H: 3, dark: false }`.

- [ ] **Step 1: Build it**

Materials: walls `MeshLambertMaterial` `#f2f1ee` (dark: `#1b1b1b`), floor `#c9c6c0` (pale concrete), ceiling white. Geometry: `PlaneGeometry` per surface, positioned/rotated to enclose `[-W/2..W/2] × [0..H] × [-D/2..D/2]`; `receiveShadow = true` on walls and floor. Lights: `AmbientLight(0xffffff, dark ? 0.08 : 0.55)` plus a `SpotLight` per hung piece later (Task 1.3 adds them); one warm `DirectionalLight(0xfff2e0, 0.25)` from above for the base wash. Name every mesh (`"wall-n"`, `"wall-s"`, `"wall-e"`, `"wall-w"`, `"floor"`, `"ceiling"`).

- [ ] **Step 2: Check**

```js
const room = G.scene.getObjectByName('room');
({ kids: room.children.length, wallN: !!room.getObjectByName('wall-n'), floorY: room.getObjectByName('floor').position.y })
```
Expected: 6+ children, `wallN: true`, `floorY: 0`. Screenshot: an empty room, camera at (0, 1.6, 1.5) looking at the north wall.

- [ ] **Step 3: Commit** — `"gallery: the synthetic white cube"`

---

### Task 1.2: The frame factory

**Files:** Modify `res/gallery.js`

**Interfaces:**
- Produces: `makePiece(spec)` → `THREE.Group` named `piece-<n>`; `spec` = `{ photos: [p], size: 0.9|0.6 }` for a single or `{ photos: [p…], size: 0.4, cols: 3, rows: 2|3 }` for a grid. Group carries `userData = { n: firstPhoto.n, w, h }` (overall metres incl. frame) used by `Hang`. Frame colours from `state.settings.frame` (`oak`, `walnut`, `black`, `white` → `#b08d57`-ish, `#5b4633`, `#171717`, `#f4f2ee`).

- [ ] **Step 1: Build one framed print**

Per print: mat board `BoxGeometry(size + 2*mat, size + 2*mat, 0.006)` white `#faf9f6`; the photo a `PlaneGeometry(size, size)` with `TextureLoader` on `p.file` (`SRGBColorSpace`), 2 mm in front of the mat; the frame four `BoxGeometry` bars (face 0.03, depth 0.04) mitred by overlap, wood via a `MeshStandardMaterial` with a small procedural roughness variation; two hanging lines: `CylinderGeometry(0.0006, 0.0006, dropLength)` `MeshPhysicalMaterial({ transmission: 0.6, roughness: 0.1 })` from the frame's top corners to the ceiling. `castShadow = true` on frame and mat. A grid packs its 6/9 framed 40s with 0.08 m gaps into one group.

- [ ] **Step 2: Check** — build `makePiece({photos: [state.photos.at(-1)], size: 0.9})` at (0, 1.5, −D/2+0.1): bounding box ≈ 1.08 × 1.08 m (0.9 + 2·0.06 mat + 2·0.03 frame); the texture loads (`material.map.image` truthy after a tick); screenshot shows the framed print with its lines.

- [ ] **Step 3: Commit** — `"gallery: framed prints with mat, wood and hanging lines"`

---

### Task 1.3: Hanging a year

**Files:** Modify `res/gallery.js`

**Interfaces:**
- Produces: `hangYear(year)` — clears `"pieces"` and `"spots"` groups, computes the pieces for that year from `state.photos` (`hang` field; grids from runs of ≥ 6 group-candidates, 9 then 6, remainder singles at 0.6), lays them along walls n→e→s→w at centre height 1.5 m with 1.2 m between pieces (skipping the elevator's corner, Task 1.4), then centre rows (two-sided) if the walls overflow; one `SpotLight` per piece from the ceiling track, `angle` ~0.5, warm, `castShadow = true`, targeted at the piece.

- [ ] **Step 1: Implement** — capacity walk: for each wall in order, place pieces while `cursor + piece.w ≤ wallLength − margin`; overflow goes to centre rows along the room's long axis at x = 0, pieces alternating faces. Every piece's `userData.n` retained.

- [ ] **Step 2: Check** — `hangYear('2017')`:
```js
const pieces = G.scene.getObjectByName('pieces').children;
({ count: pieces.length, spots: G.scene.getObjectByName('spots').children.length,
   overlaps: (() => { const boxes = pieces.map(p => new THREE.Box3().setFromObject(p)); let o = 0;
     for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxes[i].intersectsBox(boxes[j])) o++; return o; })() })
```
Expected: `count` ≥ 1 per piece of 2017 (31 photos → mix of 90s, 60s, grids), `spots === count`, `overlaps: 0`. Screenshot of the hung room.

- [ ] **Step 3: Commit** — `"gallery: a year hangs — walls first, centre rows when full"`

---

### Task 1.4: Walking

**Files:** Modify `res/gallery.js`

**Interfaces:**
- Produces: pointer-lock mouse look + WASD/arrows at 1.6 m eye height, clamped to the room minus 0.3 m; click enters pointer lock, `Esc` leaves (browser default). Exposed for tests: `G.walk = { pos, yaw, pitch }`.

- [ ] **Step 1: Implement** — standard first-person: `mousemove` (when locked) adjusts yaw/pitch (pitch clamped ±80°); per-frame velocity from held keys, `camera.position` clamp `|x| ≤ W/2−0.3`, `|z| ≤ D/2−0.3`.

- [ ] **Step 2: Check** — synthetic keydown `w` for 500 ms moves `G.camera.position.z` toward the north wall and never past `−D/2+0.3`; yaw changes with a synthetic mousemove while `document.pointerLockElement` is stubbed (set `G.walk.lockedForTest = true` escape hatch, harness-only).

- [ ] **Step 3: Commit** — `"gallery: walking"`

---

### Task 1.5: The elevator

**Files:** Modify `res/gallery.js`

**Interfaces:**
- Produces: a cabin group `"elevator"` in the (+x, −z) corner, 1.2 × 1.2 m, doors facing the room; inside panel = **real lift buttons**: one round pressable button per year (newest on top), the year printed on its face (`CanvasTexture`), nothing else — no thumbnail strips, no knobs (Uli, 2026-08-28); clicking a button (raycast from the camera on `click` when not pointer-locked, or the DOM overlay `Y`) plays the door close/open (two sliding boxes, 1 s total) around `hangYear(year)`. The DOM overlay (`Y` key) is a plain list of years for the bench.

- [ ] **Step 1: Implement** — cabin walls same material family as the room but brushed-metal front; buttons as short cylinders with `userData.year` and the year on a canvas texture; raycaster on click; the year rooms build via `hangYear`; the current year's button lit (emissive ring).

- [ ] **Step 2: Check** — `G.state.year` changes after a simulated button click (`G.elevator.go('2016')` exposed for the harness); pieces group repopulates (different `count`); door animation completes ≤ 1.2 s (assert final door positions, not timing).

- [ ] **Step 3: Commit** — `"gallery: the elevator switches year-rooms"`

---

### Task 1.6: The switchboard

**Files:** Modify `res/gallery.js`, `res/gallery.css`

**Interfaces:**
- Produces: settings `{ dark, frame, mat, scale, labels, W, D, H }` with defaults from the spec; a DOM panel (small, top-left, toggled with `S`) mirroring the future in-world board: light/dark, frame colour, mat (white/warm/none), print scale (100 %/80 %), labels on/off, room size fields; persisted to `localStorage('galleryS')`; also read from URL params (`gallery.html?frame=black&dark=1`). Changing a setting re-applies materials or re-hangs (room size, scale).

- [ ] **Step 1: Implement**; **Step 2: Check** — set `frame=black` via the panel: all frame materials' color changes (sample one mesh); reload: setting survives; `?dark=1` boots dark. **Step 3: Commit** — `"gallery: switchboard (DOM), settings persisted"`

---

### Task 1.7: Labels, ship gate

**Files:** Modify `res/gallery.js`; `docs/details.md`

- [ ] **Step 1:** Label cards (`CanvasTexture`: `afterworkphoto 154 · Aug 2017`, a grid's card lists its range) lower-right of each piece, toggled by the setting.
- [ ] **Step 2:** Full pass in the browser: boot → walk → elevator to two years → switchboard changes → labels; screenshots of light and dark mode; no console errors.
- [ ] **Step 3:** Document the gallery in `docs/details.md` (a section: what exists after phase 1, the harness handle `window.G`, the settings, the vendored three.js). Note in *Known issues*: phases 2–5 pending, their plans to be written on top of this code.
- [ ] **Step 4:** Commit; push **only on Uli's word** (the page is reachable by URL once pushed).

## Phases 2–4

Separate plan documents, written when Phase 1 stands: 2 — WebXR `immersive-vr` (Quest 3S), in-world switchboard + pressing the elevator buttons by hand/controller, teleport; 3 — `immersive-ar` + plane detection, real walls, elevator in the nearest real corner; 4 — polish (2000 px textures under `img/large/`, videos on approach, ingest-time classification).

Scope note (2026-08-28): the Quest 3 / 3S is the only device. The desktop walk built in Phase 1 is the development bench, not a product — no phone or tablet tier, no touch controls; the former "phone 3D" phase is dropped.
