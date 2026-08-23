# iPad Deck, Aspect-Driven Layouts, Precision Scrubber — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The paper deck runs on iPads (1 photo per sheet in portrait, 2 in landscape), the desktop list picks 1/2/3 photos per row by window aspect, the scrubber gains neighbour prints and a precision gear, and videos are captioned `afterworkvideo N`.

**Architecture:** One static page, `index.html` + `res/main.js` + `res/main.css`, no build step. The layout mode (deck vs. list) is decided by touch support in JS and switched in CSS by a class on `<html>`; the deck works on *sheet* indices holding `K` photos each, the scrubber on *photo* indices. Rotation and resize rebuild the few DOM nodes involved rather than re-style them.

**Tech Stack:** Vanilla JS (ES2020), CSS with native nesting (Safari 17.2+ / Chrome 120+), Python `http.server` for local serving, Chrome (via the claude-in-chrome tools) as the test runner.

**Spec:** `docs/superpowers/specs/2026-08-23-ipad-deck-and-scrubber-design.md`

## Global Constraints

- Mode: `DECK = navigator.maxTouchPoints > 0`, class `deck` on `document.documentElement`.
- Tablet: `TABLET = Math.min(screen.width, screen.height) >= 700`; `K = TABLET && innerWidth > innerHeight ? 2 : 1`.
- Desktop: `PER_ROW = aspect < 1 ? 1 : aspect < 2 ? 2 : 3` with `aspect = innerWidth / innerHeight`; `.awbox` widths 88% / 44% / 29%.
- Scrubber: `pxPerPhoto = stripHeight / N`; neighbours `effectivePx >= 6 → 1, >= 2 → 3, else 5`; gears only when `pxPerPhoto < 6`; gear by distance left of the touch zone: `< 60 → 1, < 160 → 0.25, else 1/16`.
- Year marks are never covered by the label: label `right = 16px + widest mark + 8px`.
- Caption: `afterwork${p.video ? 'video' : 'photo'} ${p.n}`; numbering shared.
- Every CSS/JS change ships with a bump of `?v=` in `index.html` (currently `20260823g`) — done once in the last task.
- Commit after every task; never commit `.DS_Store` or `.agents/`.

## Test harness

There is no test framework. Every task is verified in Chrome against a local server, with the page inside an iframe of the wanted size (the iframe is what makes `innerWidth`, `screen`-independent layout and synthetic touches reliable). Start the server once:

```bash
cd "/Users/uli/github projects/afterworkphotos" && (python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 &) ; sleep 1; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8765/photos.json   # expect 200
```

Open a Chrome tab on `http://127.0.0.1:8765/index.html` (tabs_context_mcp → navigate). Then the **HARNESS** block below is pasted at the top of every `javascript_tool` test; `W` and `H` set the frame size, `TOUCH` forces the mode regardless of the machine (the page reads `navigator.maxTouchPoints`, which the harness overrides inside the iframe before `main.js` runs).

```js
// HARNESS — paste verbatim, then set W, H, TOUCH
async function frame(W, H, TOUCH) {
  document.body.innerHTML = ''; document.body.style.margin = '0';
  const f = document.createElement('iframe');
  f.style.cssText = `width:${W}px;height:${H}px;border:2px solid red;display:block`;
  f.src = 'about:blank';
  document.body.appendChild(f);
  await new Promise(r => f.onload = r);
  Object.defineProperty(f.contentWindow.navigator, 'maxTouchPoints', { get: () => TOUCH ? 5 : 0 });
  Object.defineProperty(f.contentWindow, 'screen', { get: () => ({ width: W, height: H }) });
  f.contentWindow.location.href = 'http://127.0.0.1:8765/index.html?v=' + Math.random();
  await new Promise(r => f.onload = r);
  // the redefinitions are lost on navigation; re-apply before main.js runs via a fresh document: fall back to a query flag
  await new Promise(r => setTimeout(r, 2500));
  return f.contentWindow;
}
function touch(w, el, type, x, y) {
  const t = new w.Touch({ identifier: 1, target: el, clientX: x, clientY: y });
  el.dispatchEvent(new w.TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
```

Because property overrides do not survive the iframe's navigation, Task 1 adds two **query flags read by `main.js` only for testing**: `?touch=1|0` forces `DECK`, `?tablet=1|0` forces `TABLET`. The harness then navigates to `index.html?touch=…&tablet=…` (the `Object.defineProperty` lines above are a belt-and-braces no-op and may be dropped once the flags exist). Expected outputs in the tasks assume 208 photos (`photos.json` `count`), newest `n = 208`.

---

### Task 1: Mode switch — `html.deck` instead of the 600px media query

**Files:**
- Modify: `res/main.js:1` (`PER_SECTION`), `res/main.js:51` (`if (PER_SECTION === 1)`), `res/main.js:489-493,591-593` (desktop `PER_SECTION` uses)
- Modify: `res/main.css:120` (`@media (max-width: 600px) {`) through its closing brace at `res/main.css:532`

**Interfaces:**
- Produces: globals `DECK` (boolean), `TABLET` (boolean), `TEST` (URLSearchParams) in `main.js`; `html.deck` class; `PER_ROW` placeholder constant `2` (replaced in Task 4).

- [ ] **Step 1: Replace the breakpoint in `main.js`**

Replace line 1 `const PER_SECTION = window.innerWidth < 600 ? 1 : 2;` with:

```js
// Deck or list: a touch device gets the paper deck, a mouse-only machine the
// scroll list. ?touch=1|0 and ?tablet=1|0 override both, for testing only.
const TEST = new URLSearchParams(location.search);
const DECK = TEST.has('touch') ? TEST.get('touch') === '1' : navigator.maxTouchPoints > 0;
// iPad mini is 744 logical px on its short side, the largest iPhone 440
const TABLET = TEST.has('tablet') ? TEST.get('tablet') === '1'
  : Math.min(screen.width, screen.height) >= 700;
if (DECK) document.documentElement.classList.add('deck');
let PER_ROW = 2;   // desktop photos per row; Task 4 derives it from the window
```

Replace `if (PER_SECTION === 1) {` (line 51) with `if (DECK) {`. In the desktop branch replace every `PER_SECTION` with `PER_ROW` (lines 489, 491, 591, 593).

- [ ] **Step 2: Convert the CSS block to `html.deck` nesting**

In `res/main.css`, change line 120 `@media (max-width: 600px) {` to `html.deck {`. Inside that block (up to its closing `}` at line 532) make exactly these edits:
- `:root {` at line 124 → `& {`
- `:root {` inside `@supports` (line 164) → `& {`
- `:root {` inside `@media (prefers-color-scheme: dark)` (line 170) → `& {`
- `html,\n\tbody {` (lines 186-187) → `&,\n\tbody {`

Everything else (`section`, `.scrub`, `body.scrubbing …`, `h1.title`, `.main::before`, `@media (hover: none)`) stays as written — as nested rules they resolve to `html.deck section`, `html.deck body.scrubbing .scrub-strip`, etc. Update the comment above the block: `/* ── Deck: paper stack (html.deck, set by main.js on touch devices) ── */`.

- [ ] **Step 3: Check in the phone frame that nothing changed**

Paste HARNESS, then:

```js
const w = await frame(400, 820, true);   // and navigate with ?touch=1&tablet=0
const d = w.document;
({ deck: d.documentElement.classList.contains('deck'), scrub: !!d.querySelector('.scrub'),
   sections: d.querySelectorAll('section').length, top: d.querySelector('section.current .awbox').dataset.n,
   fixed: getComputedStyle(d.querySelector('section')).position });
```

Expected: `{ deck: true, scrub: true, sections: 7, top: "208", fixed: "fixed" }`.

- [ ] **Step 4: Check the list still loads with touch off**

```js
const w = await frame(1200, 800, false);  // ?touch=0&tablet=0
const d = w.document;
({ deck: d.documentElement.classList.contains('deck'), scrub: !!d.querySelector('.scrub'),
   sections: d.querySelectorAll('section').length, perSection: d.querySelector('section').children.length,
   fixed: getComputedStyle(d.querySelector('section')).position });
```

Expected: `{ deck: false, scrub: false, sections: 104, perSection: 2, fixed: "relative" }`.

- [ ] **Step 5: Commit**

```bash
git add res/main.js res/main.css && git commit -m "deck by touch, not by width: html.deck switches the paper-stack CSS"
```

---

### Task 2: Sheets with K photos

**Files:**
- Modify: `res/main.js` deck branch: the `N`/`wrap`/`photoAt` block (lines ~62-66), `buildSheet` (~73-86), `layout` (~136-152), the touch/tap code that calls `sheet(current).querySelector('img, video')` (~412-416)
- Modify: `res/main.css` inside `html.deck`: after `div.awbox { width: 92% … }` (~line 407)

**Interfaces:**
- Consumes: `DECK`, `TABLET` from Task 1.
- Produces: `K` (let, photos per sheet), `S` (let, sheet count), `photosOf(i) → Photo[]` (newest first), `captionOf(p)` (Task 5 replaces its body — define it here returning `afterworkphoto ${p.n}`), `rebuild()` (Task 3 fills it; define here as a no-op placeholder only if Task 3 is not done in the same sitting — otherwise skip). `N` stays the photo count; every former use of `N` as the *sheet* count becomes `S`.

- [ ] **Step 1: Derive K and S, keep `N` for photos**

Replace

```js
  const N = PHOTOS.length;
  const wrap = (i) => ((i % N) + N) % N;
  const photoAt = (i) => PHOTOS[N - 1 - i];
```

with

```js
  const N = PHOTOS.length;                      // photos
  const photoAt = (i) => PHOTOS[N - 1 - i];     // photo index: 0 = newest
  // A sheet carries K photos: one on a phone, two on a tablet held sideways
  function sheetsPer() { return TABLET && window.innerWidth > window.innerHeight ? 2 : 1; }
  let K = sheetsPer();
  let S = Math.ceil(N / K);                     // sheets
  const wrap = (i) => ((i % S) + S) % S;
  // sheet i's photos, newest first; the oldest sheet may be short
  function photosOf(i) {
    const out = [];
    for (let j = 0; j < K; j++) { const p = PHOTOS[N - 1 - K * i - j]; if (p) out.push(p); }
    return out;
  }
  const sheetOf = (photoIndex) => Math.floor(photoIndex / K);
  const captionOf = (p) => `afterworkphoto ${p.n}`;
```

- [ ] **Step 2: Build a sheet from its photos**

Replace `buildSheet`:

```js
  function buildSheet(i) {
    const section = document.createElement('section');
    section.classList.add(`k${K}`);
    section.innerHTML = photosOf(i).map(p => `
      <div class="awbox" data-n="${p.n}">
        <div class="awphoto" style="background-image: url('${p.thumb}')">${mediaHTML(p)}</div>
        <p class="subtitle">${captionOf(p)}</p>
      </div>`).join('');
    track.appendChild(section);
    sheets.set(i, section);
    return section;
  }
```

In `mediaHTML` change the `alt` to use the caption: `alt="${captionOf(p)}"` is not available there (it is defined inside `init`); instead pass it: change the signature to `function mediaHTML(p, caption = 'afterworkphoto ' + p.n)` and use `alt="${caption}"`; call it as `mediaHTML(p, captionOf(p))` in `buildSheet`.

- [ ] **Step 3: Sheet count in `layout` and the video rule**

In `layout()` replace `N > 1 && i === wrap(current + 1)` with `S > 1 && …` and `N > 2 && …` with `S > 2 && …`. Replace the single-video play/pause with all media of the sheet:

```js
      el.querySelectorAll('video').forEach(v => { if (i === current) v.play().catch(() => {}); else v.pause(); });
```

Where the divider code does `const topMedia = sheet(current).querySelector('img, video');` keep it — the first print is enough for the load event.

- [ ] **Step 4: CSS for two prints on a sheet**

After `div.awbox { width: 92%; … }` inside `html.deck` add:

```css
	/* two prints side by side on a tablet held sideways */
	section.k2 {
		gap: 3%;
	}

	section.k2 div.awbox {
		width: 44%;
	}
```

- [ ] **Step 5: Check phone (K=1) and iPad landscape (K=2)**

Paste HARNESS. Phone, `?touch=1&tablet=0`, frame 400×820:

```js
const d = w.document;
[...d.querySelectorAll('section')].map(s => [s.className, [...s.querySelectorAll('.awbox')].map(b => b.dataset.n).join('+')]);
```

Expected: 7 entries, each `k1` with one number; the `current` one `208`, `next` `207`, `next2` `206`.

iPad landscape, `?touch=1&tablet=1`, frame 1180×820:

```js
const d = w.document;
({ k2: d.querySelectorAll('section.k2').length, top: [...d.querySelector('section.current').querySelectorAll('.awbox')].map(b => b.dataset.n),
   next: [...d.querySelector('section.next').querySelectorAll('.awbox')].map(b => b.dataset.n),
   width: getComputedStyle(d.querySelector('section.current .awbox')).width });
```

Expected: `k2: 7`, `top: ["208","207"]`, `next: ["206","205"]`, `width` ≈ 44% of the sheet (≈ 515px).

iPad portrait, `?touch=1&tablet=1`, frame 820×1180: `section.k1` count 7, top `["208"]`.

- [ ] **Step 6: Tap still moves by one sheet on 2-up**

iPad landscape frame, after the check above:

```js
const d = w.document, main = d.querySelector('.main');
touch(w, main, 'touchstart', 500, 300); await sleep(30); touch(w, main, 'touchend', 500, 300);
await sleep(1600);
[...d.querySelector('section.current').querySelectorAll('.awbox')].map(b => b.dataset.n);
```

Expected: `["206","205"]` (the tap above the divider lifts the top sheet off).

- [ ] **Step 7: Commit**

```bash
git add res/main.js res/main.css && git commit -m "deck: a sheet carries K photos — two on a tablet held sideways"
```

---

### Task 3: Rotation rebuilds the deck

**Files:**
- Modify: `res/main.js` deck branch, after `layout();` is first called and after `finish()` is defined (the resize handler must see both)

**Interfaces:**
- Consumes: `K`, `S`, `sheetsPer()`, `photosOf`, `sheetOf`, `sheets`, `layout`, `finish`, `mover`, `committed`, `current` from Task 2 / existing code.
- Produces: `rebuild()`; `window` `resize` listener.

- [ ] **Step 1: Add `rebuild` and the resize hook**

Directly after the `goForward`/`goBackward` definitions add:

```js
  // Turning the iPad changes K: the deck is rebuilt with the same photo on
  // top. Only a handful of sheets exist, so this is cheap.
  function rebuild() {
    const k = sheetsPer();
    if (k === K) return;
    if (mover) { committed = true; finish(); }   // land the move that is in flight first
    const topN = photosOf(current)[0].n;
    for (const el of sheets.values()) el.remove();
    sheets.clear();
    K = k;
    S = Math.ceil(N / K);
    current = sheetOf(N - topN);                 // photo index of n is N - n
    layout();
  }
  window.addEventListener('resize', rebuild);
```

`finish()` reads `committed`; setting it first makes the interrupted move land where it was going rather than snap back.

- [ ] **Step 2: Check the rotation in the browser**

Paste HARNESS; iPad, `?touch=1&tablet=1`, frame 820×1180 (portrait). Then resize the iframe to landscape from the outer page:

```js
const d = w.document, main = d.querySelector('.main');
// go two sheets down first so the top is not 208
touch(w, main, 'touchstart', 400, 300); await sleep(30); touch(w, main, 'touchend', 400, 300); await sleep(1600);
touch(w, main, 'touchstart', 400, 300); await sleep(30); touch(w, main, 'touchend', 400, 300); await sleep(1600);
const before = d.querySelector('section.current .awbox').dataset.n;
const f = document.querySelector('iframe'); f.style.width = '1180px'; f.style.height = '820px';
await sleep(400);
({ before, k2: d.querySelectorAll('section.k2').length, k1: d.querySelectorAll('section.k1').length,
   top: [...d.querySelector('section.current').querySelectorAll('.awbox')].map(b => b.dataset.n) });
```

Expected: `before: "206"`, `k2: 7`, `k1: 0`, `top: ["206","205"]`. Then back: set the iframe to 820×1180, wait 400ms, expect `section.k1` = 7 and top `["206"]`.

- [ ] **Step 3: Commit**

```bash
git add res/main.js && git commit -m "deck: turning the iPad rebuilds the pile with the same photo on top"
```

---

### Task 4: Desktop rows by aspect, regrouped live

**Files:**
- Modify: `res/main.js` desktop branch (the section-building loop, ~lines 489-509, and the keyboard handler)
- Modify: `res/main.css:90-93` (`div.awbox { width: 44% }`)

**Interfaces:**
- Consumes: `PER_ROW` (let) from Task 1, `boxes`, `sections`, `main`.
- Produces: `perRow()`, `regroup()`; `.main[data-per-row]` attribute.

- [ ] **Step 1: Build boxes once, group them separately**

Replace the desktop loop with:

```js
  function perRow() {
    const aspect = window.innerWidth / window.innerHeight;
    return aspect < 1 ? 1 : aspect < 2 ? 2 : 3;
  }
  PER_ROW = perRow();

  // The boxes are built once; sections are only the rows they are grouped into
  for (let j = PHOTOS.length - 1; j >= 0; j--) {
    const p = PHOTOS[j];
    const box = document.createElement('div');
    box.className = 'awbox';
    box.dataset.n = p.n;
    box.innerHTML = `
      <div class="awphoto">${mediaHTML(p)}</div>
      <p class="subtitle">afterworkphoto ${p.n}</p>`;
    const v = box.querySelector('video');
    if (v) {
      box.addEventListener('mouseenter', () => { v.play().catch(() => {}); });
      box.addEventListener('mouseleave', () => { v.pause(); });
    }
    boxes.push(box);
  }

  // Rows of PER_ROW boxes. Moving the existing boxes keeps their images;
  // the photo that was on screen stays on screen.
  function regroup() {
    const onScreen = sections.length
      ? sections.find(s => s.getBoundingClientRect().bottom > 0)?.querySelector('.awbox')
      : null;
    sections.forEach(s => s.remove());
    sections.length = 0;
    for (let i = 0; i < boxes.length; i += PER_ROW) {
      const section = document.createElement('section');
      boxes.slice(i, i + PER_ROW).forEach(b => section.appendChild(b));
      main.appendChild(section);
      sections.push(section);
    }
    main.dataset.perRow = PER_ROW;
    if (onScreen) onScreen.closest('section').scrollIntoView({ block: 'start' });
  }
  regroup();

  window.addEventListener('resize', () => {
    const n = perRow();
    if (n === PER_ROW) return;
    PER_ROW = n;
    regroup();
  });
```

(The keyboard handler already steps by `PER_ROW` after Task 1.)

- [ ] **Step 2: CSS widths per row count**

Replace `div.awbox { width: 44%; … }` (line 90) with:

```css
div.awbox {
	width: 44%;
	opacity: 0.12;
	transition: opacity 0.9s ease-in;
}

.main[data-per-row="1"] div.awbox {
	width: 88%;
}

.main[data-per-row="3"] div.awbox {
	width: 29%;
}
```

- [ ] **Step 3: Check the three aspects and a live resize**

Paste HARNESS; `?touch=0&tablet=0`, frame 1200×800:

```js
const d = w.document;
const count = () => d.querySelector('section').children.length;
const r = { wide: [count(), d.querySelector('.main').dataset.perRow] };
const f = document.querySelector('iframe');
f.style.width = '600px'; f.style.height = '900px'; await sleep(300); r.tall = [count(), d.querySelector('.main').dataset.perRow];
f.style.width = '1800px'; f.style.height = '800px'; await sleep(300); r.ultra = [count(), d.querySelector('.main').dataset.perRow];
r.boxesKept = d.querySelectorAll('.awbox').length;
r;
```

Expected: `wide: [2,"2"]`, `tall: [1,"1"]`, `ultra: [3,"3"]`, `boxesKept: 208`.

- [ ] **Step 4: Commit**

```bash
git add res/main.js res/main.css && git commit -m "desktop: 1, 2 or 3 photos per row by window aspect, regrouped on resize"
```

---

### Task 5: Videos are `afterworkvideo N`

**Files:**
- Modify: `res/main.js`: `mediaHTML` (top of file), `captionOf` (deck, Task 2), the desktop box caption (Task 4 code)

**Interfaces:**
- Produces: top-level `captionOf(p)`; the deck's local `captionOf` is removed.

- [ ] **Step 1: One caption function at the top**

Below `mediaHTML` at the top of `main.js` add:

```js
// A video is an afterworkvideo; the number is the same series as the photos
const captionOf = (p) => `afterwork${p.video ? 'video' : 'photo'} ${p.n}`;
```

Change `mediaHTML` to `function mediaHTML(p)` and its `alt` to `alt="${captionOf(p)}"` (hoisting: `captionOf` is a `const` — move it *above* `mediaHTML`). Remove the deck-local `captionOf` from Task 2, call `mediaHTML(p)` with one argument, and in the desktop box use `${captionOf(p)}` for the caption.

- [ ] **Step 2: Check against a video entry**

```bash
python3 -c "import json;d=json.load(open('photos.json'));print([p['n'] for p in d['photos'] if p.get('video')][:3])"
```

Take the first number printed (call it V). Paste HARNESS; `?touch=0&tablet=0`, frame 1200×800:

```js
const d = w.document;
d.querySelector(`.awbox[data-n="${V}"] .subtitle`).textContent;
```

Expected: `afterworkvideo V`. And for any photo: `afterworkphoto 208`. In a phone frame (`?touch=1&tablet=0`), scrub to V's sheet is not needed — instead check `captionOf` directly: `w.eval` is not available, so check the alt of a built sheet: `d.querySelector('section.current img').alt` → `afterworkphoto 208`.

If `photos.json` has no video, skip the V check and note it in the commit message.

- [ ] **Step 3: Commit**

```bash
git add res/main.js && git commit -m "videos are captioned afterworkvideo N; numbering shared with the photos"
```

---

### Task 6: Scrubber over photos, label as card + free neighbours, year marks clear

**Files:**
- Modify: `res/main.js` deck branch: scrubber block (`scrubLabel` creation, `markYears`, `scrubTo`, `touchend`)
- Modify: `res/main.css` inside `html.deck`: `.scrub-label`, `.scrub-label img`

**Interfaces:**
- Consumes: `N`, `photoAt`, `sheetOf`, `warmUp`, `strip`, `scrub`, `current`, `startMove`, `settle`, `mover`.
- Produces: `scrubPos` (float photo index), `scrubIndex` (int photo index), `neighbourCount(effectivePx)`, `renderLabel(index, count)`, `placeLabel(clientY)`, `labelRight` (px). Task 7 adds the gear on top of `scrubTo`.

- [ ] **Step 1: Label markup**

Replace `scrubLabel.innerHTML = '<img alt=""><span></span>';` with:

```js
  scrubLabel.innerHTML = `
    <div class="scrub-up"></div>
    <div class="scrub-card"><div class="scrub-text"><b></b><span></span></div><img alt=""></div>
    <div class="scrub-down"></div>`;
  const labelUp = scrubLabel.querySelector('.scrub-up');
  const labelDown = scrubLabel.querySelector('.scrub-down');
  const labelCard = scrubLabel.querySelector('.scrub-card');
  const labelN = scrubLabel.querySelector('.scrub-text b');
  const labelMonth = scrubLabel.querySelector('.scrub-text span');
  const labelPrint = scrubLabel.querySelector('.scrub-card img');
```

- [ ] **Step 2: Year marks set the label's right edge**

At the end of `markYears()` (after the loop) add:

```js
    // the label stops short of the widest year mark, so no year is ever covered
    let widest = 0;
    strip.querySelectorAll('.scrub-year').forEach(m => { widest = Math.max(widest, m.getBoundingClientRect().width); });
    scrubLabel.style.right = (16 + widest + 8) + 'px';
```

- [ ] **Step 3: Neighbour count and rendering**

Replace the `let scrubbing = false; let scrubIndex = 0;` lines and the whole `scrubTo` with:

```js
  let scrubbing = false;
  let scrubPos = 0;        // photo index, fractional while scrubbing
  let scrubIndex = 0;      // the photo shown

  // How many prints the label shows: one when a finger-width of strip is one
  // photo or less, otherwise the neighbours too. px = strip pixels per photo.
  function neighbourCount(px) { return px >= 6 ? 1 : px >= 2 ? 3 : 5; }

  // A print that is not in the cache yet stays blank until it arrives — and
  // only if it is still the wanted one by then (an <img> would otherwise keep
  // showing its old picture)
  function setPrint(img, p) {
    const thumb = warmUp(p.thumb);
    if (thumb.complete && thumb.naturalWidth) { img.src = p.thumb; img.style.visibility = ''; return; }
    img.style.visibility = 'hidden';
    img.dataset.want = p.thumb;
    thumb.addEventListener('load', () => {
      if (scrubbing && img.dataset.want === p.thumb) { img.src = p.thumb; img.style.visibility = ''; }
    }, { once: true });
  }

  function renderLabel(index, count) {
    const p = photoAt(index);
    labelN.textContent = p.n;
    labelMonth.textContent = monthYear(p);
    setPrint(labelPrint, p);
    const side = (count - 1) / 2;
    const fill = (box, from, to, step) => {
      const want = [];
      for (let i = from; step > 0 ? i <= to : i >= to; i += step) if (i >= 0 && i < N) want.push(i);
      while (box.children.length > want.length) box.lastElementChild.remove();
      while (box.children.length < want.length) { const im = document.createElement('img'); im.alt = ''; box.appendChild(im); }
      want.forEach((i, k) => setPrint(box.children[k], photoAt(i)));
    };
    fill(labelUp, index - side, index - 1, 1);     // newer, top to bottom
    fill(labelDown, index + 1, index + side, 1);   // older
  }

  function placeLabel(clientY) {
    const r = strip.getBoundingClientRect();
    const h = scrubLabel.offsetHeight;
    const cardMid = labelUp.offsetHeight + labelCard.offsetHeight / 2;
    const top = Math.min(r.bottom - h, Math.max(r.top, clientY - cardMid));
    scrubLabel.style.top = top + 'px';
  }

  let restTimer = 0;

  function scrubTo(clientX, clientY) {
    const r = strip.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    scrubPos = f * (N - 1);
    scrubIndex = Math.round(scrubPos);
    renderLabel(scrubIndex, neighbourCount(r.height / N));
    placeLabel(clientY);
    clearTimeout(restTimer);
    restTimer = setTimeout(() => warmUp(photoAt(scrubIndex).file), 200);
  }
```

Update the three callers to pass both coordinates: `scrubTo(e.touches[0].clientX, e.touches[0].clientY)`. In `touchend` replace

```js
    if (scrubIndex === current || mover) return;
    startMove(scrubIndex > current ? 1 : -1, scrubIndex);
```

with

```js
    const target = sheetOf(scrubIndex);
    if (target === current || mover) return;
    startMove(target > current ? 1 : -1, target);
```

- [ ] **Step 4: Label CSS**

Replace the `.scrub-label` and `.scrub-label img` rules with:

```css
	/* The finger's photo: number above month beside its print, one paper
	   card; neighbours, when the strip is too short for single-sheet hits,
	   float free above (newer) and below (older), dimmed, flush right */
	.scrub-label {
		position: fixed;
		right: 56px;            /* set from the year marks by main.js */
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s ease;
		z-index: 700;
		font: 700 13px/1.1 "Helvetica Neue", Helvetica, Arial, sans-serif;
		color: var(--ink);
		white-space: nowrap;
	}

	.scrub-up,
	.scrub-down {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
	}

	.scrub-up img,
	.scrub-down img {
		width: 44px;
		height: 44px;
		border-radius: 4px;
		display: block;
		opacity: 0.7;
		box-shadow: 0 0 0 1px var(--edge-dark);
	}

	.scrub-card {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 4px 4px 12px;
		background: var(--paper);
		border-radius: 6px;
		box-shadow: var(--sheet-edge), 0 12px 28px rgba(var(--shade), 0.4);
	}

	.scrub-text {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}

	.scrub-text b {
		font-size: 110%;
	}

	.scrub-text span {
		font-weight: 500;
		font-size: 11px;
		margin-top: 3px;
		opacity: 0.8;
	}

	.scrub-card img {
		width: 56px;
		height: 56px;
		border-radius: 4px;
		display: block;
		box-shadow: 0 0 0 1px var(--edge-dark);
	}
```

Keep `body.scrubbing .scrub-strip, body.scrubbing .scrub-label { opacity: 1; }` as is.

- [ ] **Step 5: Check label contents, neighbours and clearance**

Paste HARNESS; phone `?touch=1&tablet=0`, frame 400×820:

```js
const d = w.document, scrub = d.querySelector('.scrub'), strip = d.querySelector('.scrub-strip');
const r = scrub.getBoundingClientRect(), sr = strip.getBoundingClientRect();
touch(w, scrub, 'touchstart', r.left + 10, sr.top + sr.height * 0.5); await sleep(300);
const lab = d.querySelector('.scrub-label'), lr = lab.getBoundingClientRect();
const marks = [...d.querySelectorAll('.scrub-year')].map(m => m.getBoundingClientRect());
const out = {
  n: lab.querySelector('.scrub-text b').textContent, month: lab.querySelector('.scrub-text span').textContent,
  up: [...lab.querySelectorAll('.scrub-up img')].map(i => i.src.split('/').pop()),
  down: [...lab.querySelectorAll('.scrub-down img')].map(i => i.src.split('/').pop()),
  pxPerPhoto: +(sr.height / 208).toFixed(2),
  clearOfMarks: marks.every(m => lr.right <= m.left),
  cardAtFinger: Math.abs((lab.querySelector('.scrub-card').getBoundingClientRect().top + 32) - (sr.top + sr.height * 0.5)) < 3
};
touch(w, scrub, 'touchend', r.left + 10, sr.top + sr.height * 0.5);
out;
```

Expected: `n` ≈ "105" (the middle photo), one `up` thumb (n+1's file) and one `down` thumb (n−1's), `pxPerPhoto` ≈ 3.4–3.7 (→ 3 prints), `clearOfMarks: true`, `cardAtFinger: true`. At the very top of the strip (`sr.top + 1`): `n: "208"`, `up: []`, `down: [one]`.

iPad portrait `?touch=1&tablet=1`, 820×1180: `pxPerPhoto` ≈ 5.3 → still 3 prints. A frame of 400×1600 with the same page gives ≈ 7 px → `up: []`, `down: []` (one print).

- [ ] **Step 6: Release on a 2-up sheet lands on the sheet holding the photo**

iPad landscape `?touch=1&tablet=1`, 1180×820: scrub to 50% and release; after 1600ms `[...d.querySelector('section.current').querySelectorAll('.awbox')].map(b => b.dataset.n)` must contain the `n` the label showed.

- [ ] **Step 7: Commit**

```bash
git add res/main.js res/main.css && git commit -m "scrubber: label as a card with free neighbour prints; year marks never covered; photos, not sheets"
```

---

### Task 7: Precision gear

**Files:**
- Modify: `res/main.js` deck branch: `scrubTo`, `touchstart`/`touchmove` handlers; add the hint element
- Modify: `res/main.css` inside `html.deck`: `.scrub-hint`

**Interfaces:**
- Consumes: everything from Task 6.
- Produces: `GEAR_NEEDED_PX = 6`, `gearRate(clientX)`, `scrub-hint` element.

- [ ] **Step 1: Gear state and rate**

Above `scrubTo` add:

```js
  // Precision gear: when the strip gives less than GEAR_NEEDED_PX per photo,
  // sliding the finger left off the strip slows the scrub — ¼ from 60px in,
  // 1/16 from 160px. The touch-down sets the position from the strip; once a
  // finer gear has been used the position is relative to the finger's travel
  const GEAR_NEEDED_PX = 6;
  let gearsOn = false, fineUsed = false, lastY = 0;
  function gearRate(clientX) {
    if (!gearsOn) return 1;
    const d = scrub.getBoundingClientRect().left - clientX;
    return d < 60 ? 1 : d < 160 ? 0.25 : 1 / 16;
  }
  const hint = document.createElement('div');
  hint.className = 'scrub-hint';
  hint.textContent = '← finer';
  scrubLabel.appendChild(hint);
```

- [ ] **Step 2: Relative movement in `scrubTo`**

Replace the body of `scrubTo` with:

```js
  function scrubTo(clientX, clientY, first = false) {
    const r = strip.getBoundingClientRect();
    const rate = gearRate(clientX);
    if (rate < 1) fineUsed = true;
    if (first || !fineUsed) {
      const f = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
      scrubPos = f * (N - 1);
    } else {
      scrubPos += (clientY - lastY) * (N - 1) / r.height * rate;
      scrubPos = Math.min(N - 1, Math.max(0, scrubPos));
    }
    lastY = clientY;
    scrubIndex = Math.round(scrubPos);
    const count = neighbourCount(r.height / N / rate);
    renderLabel(scrubIndex, count);
    hint.hidden = !(gearsOn && rate === 1 && count > 1);
    placeLabel(clientY);
    clearTimeout(restTimer);
    restTimer = setTimeout(() => warmUp(photoAt(scrubIndex).file), 200);
  }
```

In `touchstart`: before `scrubTo(...)` add `gearsOn = strip.getBoundingClientRect().height / N < GEAR_NEEDED_PX; fineUsed = false;` and call `scrubTo(x, y, true)`.

- [ ] **Step 3: Hint CSS**

After the `.scrub-card img` rule add:

```css
	.scrub-hint {
		font: 600 10px/1 "Helvetica Neue", Helvetica, Arial, sans-serif;
		letter-spacing: 0.03em;
		color: var(--ink);
		opacity: 0.6;
		margin-top: 2px;
	}

	.scrub-hint[hidden] {
		display: none;
	}
```

- [ ] **Step 4: Check the gears**

Paste HARNESS; phone `?touch=1&tablet=0`, 400×820:

```js
const d = w.document, scrub = d.querySelector('.scrub'), strip = d.querySelector('.scrub-strip');
const r = scrub.getBoundingClientRect(), sr = strip.getBoundingClientRect();
const n = () => +d.querySelector('.scrub-text b').textContent;
const y0 = sr.top + sr.height * 0.5;
touch(w, scrub, 'touchstart', r.left + 10, y0); await sleep(50);
const a = n(), hintShown = !d.querySelector('.scrub-hint').hidden;
touch(w, scrub, 'touchmove', r.left + 10, y0 + 20); await sleep(50);           // gear 1: 20px ≈ 6 photos
const b = n();
touch(w, scrub, 'touchmove', r.left - 100, y0 + 20); await sleep(50);          // into ¼ gear, no vertical move
const c = n(), upsQuarter = d.querySelectorAll('.scrub-up img').length;
touch(w, scrub, 'touchmove', r.left - 100, y0 + 40); await sleep(50);          // 20px at ¼ ≈ 1.5 photos
const e = n();
touch(w, scrub, 'touchmove', r.left - 200, y0 + 40); await sleep(50);          // into 1/16
touch(w, scrub, 'touchmove', r.left - 200, y0 + 120); await sleep(50);         // 80px at 1/16 ≈ 1.5 photos
const g = n(), upsFine = d.querySelectorAll('.scrub-up img').length;
touch(w, scrub, 'touchend', r.left - 200, y0 + 120); await sleep(1600);
({ a, b, c, e, g, hintShown, upsQuarter, upsFine, top: d.querySelector('section.current .awbox').dataset.n });
```

Expected: `b` ≈ `a − 6`; `c === b` (changing gear alone moves nothing); `e` = `c − 1` or `c − 2`; `g` = `e − 1` or `e − 2`; `hintShown: true`; `upsQuarter: 0` (¼ gear → 13.6 px effective → 1 print); `upsFine: 0`; `top` equals `String(g)`.

With a tall frame (400×1600, ≈ 7 px per photo): `hintShown: false` and `c` differs from `b`'s mapping no more than the absolute position (gears off: `gearRate` returns 1, position stays absolute).

- [ ] **Step 5: Commit**

```bash
git add res/main.js res/main.css && git commit -m "scrubber: precision gear — sliding the finger in from the strip slows the pile"
```

---

### Task 8: Ship — version bump, docs

**Files:**
- Modify: `index.html:14,29` (`?v=20260823g` → `?v=20260823h`)
- Modify: `docs/details.md` (the scrubber/deck sections and "Known issues / to check")
- Modify: `README.md` only if it states "phone only" for the deck (check with `grep -n -i "phone\|mobile" README.md`)

- [ ] **Step 1: Bump the asset version**

```bash
sed -i '' 's/?v=20260823g/?v=20260823h/g' index.html && grep -c 20260823h index.html   # expect 2
```

- [ ] **Step 2: Document**

In `docs/details.md`: where the deck is described as the phone layout, say it is the layout of every touch device (`navigator.maxTouchPoints > 0`), with `K = 2` photos per sheet on a tablet held sideways and a rebuild on rotation; in the scrubber description add the label (card + free neighbours by `pxPerPhoto`), the year-mark clearance and the gear with its thresholds; in the desktop description add the 1/2/3 rule; add the `?touch=`/`?tablet=` test flags under "Local development". Under "Known issues / to check" add: *"iPad: verify on the device — rotation with a move in flight, the label near the strip ends with 5 prints, the corner radius fallback on iPad (no entry in SCREEN_RADII)."*

- [ ] **Step 3: Full regression in the browser**

Run the checks of Task 1 Step 3/4, Task 2 Step 5, Task 4 Step 3, Task 6 Step 5 and Task 7 Step 4 once more on the final code. All expected values must hold.

- [ ] **Step 4: Commit and push**

```bash
git add index.html docs/details.md README.md && git commit -m "iPad deck, rows by aspect, precision scrubber: version bump and docs" && git push
```
