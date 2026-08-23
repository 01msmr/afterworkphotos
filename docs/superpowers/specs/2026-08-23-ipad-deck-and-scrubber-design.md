# iPad deck, aspect-driven layouts, precision scrubber — design

Date: 2026-08-23. Decided in conversation (mockups in `.superpowers/brainstorm/`).

## Goal

- The iPad gets the paper deck (today phone-only): one photo per sheet in portrait, two in landscape, full-bleed sheet as on the phone (mockup choice A).
- The desktop keeps its scroll-snap list; photos per row follow the window's aspect: taller than wide → 1, wider → 2, wider than 2:1 → 3. Re-evaluated live on resize.
- The edge scrubber stays usable as the number of photos grows: neighbour prints in the label when the strip is too short for single-sheet hits, and a precision gear (slide the finger left off the strip to slow the scrub) — mockup choice C.
- Videos are captioned `afterworkvideo N`; the numbering is shared with photos, nothing is counted separately.

## 1. Mode: deck or list

`main.js` decides once at load: `DECK = navigator.maxTouchPoints > 0`. Touch devices (iPhone, iPad — also iPadOS Safari in desktop mode, which still reports touch points — and touch laptops) get the deck; mouse-only machines the list. `document.body.classList.add('deck')` switches the CSS: the block now under `@media (max-width: 600px)` becomes `body.deck { … }` selectors (same rules, different switch). `PER_SECTION` is removed; the deck has `K` (photos per sheet), the list has `PER_ROW`.

## 2. Sheets with K photos

- `TABLET = Math.min(screen.width, screen.height) >= 700` (iPad mini is 744 logical px, the largest iPhone 440).
- `K = TABLET && innerWidth > innerHeight ? 2 : 1`. The phone keeps `K = 1` in both orientations.
- Sheet count `S = ceil(N / K)`. `photosOf(i)` returns sheet *i*'s photos newest first: `PHOTOS[N-1-K·i], PHOTOS[N-2-K·i]` (the oldest sheet may hold one photo when N is odd).
- `buildSheet(i)` renders one `.awbox` per photo in a row inside the section; the letterpress CSS applies per print. Two prints side by side are each ≈ 44% of the sheet width, as on the desktop.
- Everything working on sheet indices — `wrap`, `layout`, the 7-sheet window, `startMove`, reveal, video play/pause per top sheet — is unchanged except that `N` becomes `S` there. Both prints of a 2-up sheet may play.
- The corner radius on iPads comes from the existing `env()`/safe-area fallback; the `SCREEN_RADII` table stays phone-only.

## 3. Rotation

`resize` (what iPadOS fires on rotate) recomputes `K`. If it changed: if a move is in flight, `finish()` it; remember the top sheet's newest photo; remove every sheet from the DOM and the map; set `current` to the sheet holding that photo; `layout()`. Year marks, divider and title already re-run on resize.

## 4. Scrubber

The strip addresses **photos**, not sheets. `pxPerPhoto = stripHeight / N`.

**Label.** A paper card: the number (bold, the caption's size) above the month, then the print under the finger (56 px) to their right — one landscape rectangle. The card is wider than the print, so its text part sticks out to the left (mockup v5 variant B). When neighbours apply, the adjacent photos (newer above, older below; 44 px, dimmed to ~70% and without any panel behind them) float free above and below the card, flush with the print's right edge. The card and the prints hug the finger's height; the whole label is clamped to stay on screen at the strip's ends.

**Year marks always visible.** The label's right edge sits left of the year marks: `right = 16px + widest mark + 8px`, measured from the marks after `markYears()`. The label is never drawn over a mark.

**Neighbour count.** `effectivePx = pxPerPhoto / rate` (rate = the current gear). `≥ 6 → 1 print`, `≥ 2 → 3`, `else 5`. Evaluated per `scrubTo()`, so the fan collapses as the finger slides into a finer gear. Today (N = 208): 3 prints on iPhone and iPad in gear 1; 1 in the fine gears.

**Gears.** Active only when needed, i.e. when `pxPerPhoto < 6` (one constant, `GEAR_NEEDED_PX`). Distance *d* of the finger left of the strip's touch zone: `d < 60 → 1×`, `d < 160 → ¼`, `else 1/16`. Touch-down sets the position absolutely from the strip as today; afterwards the position is relative: `pos += dy · (N−1)/stripHeight · rate`, clamped to `[0, N−1]`, `scrubIndex = round(pos)`. In gear 1 that equals today's mapping; after a finer gear the finger no longer lines up with the year marks (the offset is kept, as iOS does). A small `← finer` hint sits under the label while the finger is on the strip, gears are active and 3+ prints show. Release anywhere cuts to the sheet holding the shown photo.

**Touch zone.** `.scrub` stays 28 px wide for the touch-down; `touchmove` is tracked on the document while scrubbing so the finger may leave the strip.

## 5. Desktop list

`PER_ROW` from `innerWidth / innerHeight`: `< 1 → 1`, `< 2 → 2`, `else 3`. On resize, when it changes, the existing `.awbox` nodes are regrouped into new sections (no image reloads), and the section holding the photo that was on screen is scrolled into view. `.awbox` width: 1 → 88%, 2 → 44%, 3 → 29%. Keyboard up/down step by `PER_ROW`.

## 6. Videos

`captionOf(p)` = `afterwork${p.video ? 'video' : 'photo'} ${p.n}`, used for the caption and the `alt` text in both deck and list. The scrubber label shows only the number and month.

## 7. Testing

No test framework exists; the page is static. Verification is the same harness used for the `.under` fix: the page in a sized iframe in Chrome (400×820 phone, 820×1180 / 1180×820 iPad, desktop sizes), synthetic `TouchEvent`s on the scrubber and deck, sampled DOM state (classes, computed visibility, `data-n` of what is on top, label contents). Each step below lists what is sampled. Plus a real device check on the iPad at the end.

## Out of scope

- Phone in landscape stays as it is (K = 1).
- Combining a pick-from-fan gesture with the gears (can follow later).
- No new thumbnails, no manifest changes.
