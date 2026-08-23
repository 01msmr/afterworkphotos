// Deck or list: a touch device gets the paper deck, a mouse-only machine the
// scroll list. ?touch=1|0 and ?tablet=1|0 override both, for testing only.
const TEST = new URLSearchParams(location.search);
const DECK = TEST.has('touch') ? TEST.get('touch') === '1' : navigator.maxTouchPoints > 0;
// iPad mini is 744 logical px on its short side, the largest iPhone 440
const TABLET = TEST.has('tablet') ? TEST.get('tablet') === '1'
  : Math.min(screen.width, screen.height) >= 700;
if (DECK) document.documentElement.classList.add('deck');
if (TABLET) document.documentElement.classList.add('tablet');
let PER_ROW = 2;   // desktop photos per row; derived from the window below

const main = document.querySelector('.main');
const boxes = [];
const sections = [];

/* ──────────────────────────────────────────────────────────
   Photos
   photos.json is the list, in date order: n (1 = oldest), id, taken,
   file, thumb and — for a video — video. The files carry date names
   (awp-2026-08-23-01.jpg); the site only ever shows n. Nothing is built
   until the list is here.
   ────────────────────────────────────────────────────────── */
let PHOTOS = [];

// A video is an afterworkvideo; the number is the same series as the photos
const captionOf = (p) => `afterwork${p.video ? 'video' : 'photo'} ${p.n}`;

/* ──────────────────────────────────────────────────────────
   Deep links
   #154 opens print 154; #y2017 opens that year's newest print — the year
   always wears its y, so photo numbers and years can never collide. The
   address follows along as the shown print changes (replaceState, no
   history).
   ────────────────────────────────────────────────────────── */
function hashTarget() {
  const h = location.hash.slice(1);
  if (!h) return null;
  if (/^y\d{4}$/.test(h)) return { year: h.slice(1) };
  if (/^\d+$/.test(h)) {
    const n = parseInt(h, 10);
    if (n >= 1 && n <= PHOTOS.length) return { n };
  }
  return null;
}

// the target as a photo number, or null
function targetN() {
  const t = hashTarget();
  if (!t) return null;
  if (t.n) return t.n;
  for (let i = PHOTOS.length - 1; i >= 0; i--) {
    if (PHOTOS[i].taken && PHOTOS[i].taken.slice(0, 4) === t.year) return PHOTOS[i].n;
  }
  return null;
}

function writeHash(n) {
  if (location.hash !== '#' + n) history.replaceState(null, '', '#' + n);
}

// A video does not play by itself: on the desktop it plays while the mouse
// is over it, on the phone while its sheet is the top one (see layout()).
function mediaHTML(p) {
  if (p.video) {
    return `<video src="${p.video}" poster="${p.file}" muted loop playsinline preload="metadata" width="100%"></video>`;
  }
  return `<img src="${p.file}" alt="${captionOf(p)}" width="100%">`;
}

fetch('photos.json', { cache: 'no-cache' }).then(r => r.json()).then(data => {
  PHOTOS = data.photos;
  init();
});

/* ──────────────────────────────────────────────────────────
   Title
   Fitted to its box: on a phone the sheet's width, centred; on a tablet and
   on the desktop a small box at the right, with the prints' own side margin
   (--side in the CSS), so its right edge is the rightmost print's.
   ────────────────────────────────────────────────────────── */
const title = document.querySelector('h1.title');

function fitTitle() {
  let lo = 1, hi = 200;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    title.style.fontSize = mid + 'px';
    if (title.scrollWidth <= title.clientWidth) lo = mid;
    else hi = mid;
  }
  title.style.fontSize = lo + 'px';
}

/* ──────────────────────────────────────────────────────────
   Reliable viewport height
   On iOS Safari / PWA the CSS 100vh ≠ window.innerHeight.
   We set a CSS custom property from JS and update on resize.
   ────────────────────────────────────────────────────────── */
function setAppHeight() {
  document.documentElement.style.setProperty('--app-height', window.innerHeight + 'px');
}
setAppHeight();
window.addEventListener('resize', setAppHeight);

/* ============================================================
   MOBILE: Card stack
   The photos lie on each other like a pile of daily prints, the newest on
   top. Swiping up lifts the top sheet off and uncovers the one before it;
   swiping down pulls the newer sheet back down over it. Either way it is the upper card that moves, travelling
   between "in place" and "off the top of the screen", with its bottom edge
   shadowing whatever lies below. The wraparound is the same move as any
   other, so there are no clones and nothing scrolls.
   ============================================================ */
function init() {
if (DECK) {

  const track = document.createElement('div');
  track.className = 'carousel-track';
  main.appendChild(track);

  // ── The pile ──
  // Photo index 0 is the newest (the last in PHOTOS), N-1 the oldest; sheet
  // index 0 is the top sheet. A sheet carries K photos: one upright, two
  // side by side when the device is held sideways. "Forward" is towards the
  // older ones; the last sheet wraps to the first.
  const N = PHOTOS.length;                      // photos
  const photoAt = (i) => PHOTOS[N - 1 - i];     // by photo index
  function sheetsPer() { return window.innerWidth > window.innerHeight ? 2 : 1; }
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

  // Only a window of seven sheets exists in the DOM at any time: the top one
  // and three either side. Sheets are built as they enter the window and
  // thrown away as they leave it, so a pile of hundreds costs what a pile of
  // seven does — and the three beyond the visible ones have their image
  // loaded before they are needed. A sheet in motion is always inside it.
  const WINDOW = 3;
  const sheets = new Map();     // index → section

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

  function sheet(i) {
    i = wrap(i);
    return sheets.get(i) || buildSheet(i);
  }

  // Live window height — the part you can actually see and touch
  function H() { return window.innerHeight; }

  /* ── Screen corner radius ──
     The phone's real corner, so the backdrop's corner fills and the sheets'
     corners match the glass. No browser reports it, so known models are
     looked up by logical screen size and pixel ratio (Apple's published
     display radii, in points). Unlisted devices keep the CSS fallback. */
  const SCREEN_RADII = [
    // [portrait width, portrait height, dpr, radius]
    [375, 667, 2, 0],       // SE 2nd/3rd, 8
    [414, 736, 3, 0],       // 8 Plus
    [375, 812, 3, 44],      // 12/13 mini (X, XS, 11 Pro share this size at 39)
    [414, 896, 2, 42],      // XR, 11
    [414, 896, 3, 39],      // XS Max, 11 Pro Max
    [390, 844, 3, 47],      // 12, 12 Pro, 13, 13 Pro, 14, 16e
    [428, 926, 3, 53],      // 12 Pro Max, 13 Pro Max, 14 Plus
    [393, 852, 3, 55],      // 14 Pro, 15, 15 Pro, 16
    [430, 932, 3, 55],      // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
    [402, 874, 3, 62],      // 16 Pro
    [440, 956, 3, 62]       // 16 Pro Max
  ];

  (function applyScreenRadius() {
    const w = Math.min(screen.width, screen.height);
    const h = Math.max(screen.width, screen.height);
    const dpr = Math.round(window.devicePixelRatio);
    const hit = SCREEN_RADII.find(r => r[0] === w && r[1] === h && r[2] === dpr);
    if (hit) document.documentElement.style.setProperty('--screen-radius', hit[3] + 'px');
  })();

  // ── Stack state ──
  const startN = targetN();
  let current = startN ? sheetOf(N - startN) : 0;   // sheet on top
  let mover = null;         // the sheet being lifted off or put back
  let under = null;         // the sheet it reveals / covers
  let dir = 0;              // +1 forward (lift off), -1 backward (put back)
  let landing = 0;          // the index a committed move lands on
  let travel = 0;           // how far the mover goes to clear the screen
  let moverBottom = 0;      // the mover's resting bottom edge (its shadow hangs below)
  let revealAt = 0;         // how far up it must be before the sheet beneath is dealt in
  let animating = false;
  let committed = false;    // does the pending move land on the neighbour?
  let finishTimer = 0;

  // Keeps the window of sheets around `current`, then assigns the stack
  // positions: the top sheet, the one beneath it and the one beneath that
  // are on view — beneath ones full size, so the top sheet's edge always
  // shows paper around it, never desk
  function layout() {
    const keep = new Set();
    for (let d = -WINDOW; d <= WINDOW; d++) keep.add(wrap(current + d));
    for (const [i, el] of sheets) {
      if (!keep.has(i)) { el.remove(); sheets.delete(i); }
    }
    keep.forEach(i => sheet(i));
    for (const [i, el] of sheets) {
      el.classList.toggle('current', i === current);
      el.classList.toggle('next', S > 1 && i === wrap(current + 1));
      el.classList.toggle('next2', S > 2 && i === wrap(current + 2));
      // a video plays only while its sheet is the top one
      el.querySelectorAll('video').forEach(v => { if (i === current) v.play().catch(() => {}); else v.pause(); });
    }
    writeHash(photosOf(current)[0].n);
  }
  layout();

  // Where the moving sheet rests at each end of its travel
  function homeY() { return dir > 0 ? 0 : -travel; }   // where it starts
  function awayY() { return dir > 0 ? -travel : 0; }   // where a committed move ends

  // Pick the moving sheet: the top one to lift off, the newer one to put
  // back. Normally the neighbour; the scrubber lands anywhere — then the
  // top sheet lifts off straight onto an older target, or a newer target
  // comes down straight onto the top sheet, as if the pile were cut there.
  function startMove(direction, target) {
    dir = direction;
    landing = target === undefined ? wrap(current + dir) : target;
    if (dir > 0) {
      mover = sheet(current);                 // lift the top sheet off
      under = sheet(landing);
    } else {
      mover = sheet(landing);                 // put the newer sheet back on
      under = sheet(current);
    }
    under.classList.add('under');
    mover.classList.add('mover');
    // A sheet pulled down from above the screen enters paper first: until
    // its bottom edge is on screen it wears only the flat sheet edge, the
    // long lifted shadow fades in (0.2s) once the edge has entered
    if (dir < 0) mover.classList.add('entering');
    // Measured in place: the sheet's bottom edge plus the shadow it casts
    // below itself, so nothing of it is left showing once it is "away"
    mover.style.transform = '';
    const bottom = mover.getBoundingClientRect().bottom;
    moverBottom = bottom;
    travel = bottom + 220;   // the lifted shadow reaches ~180px below the sheet
    // The sheet beneath shows its edges only once the mover's bottom edge is
    // 30% of the way up the screen — and loses them again on the way back down
    revealAt = bottom * 0.3;
    mover.style.transform = `translateY(${homeY()}px)`;
    updateReveal();
  }

  function moverY() {
    return new DOMMatrixReadOnly(getComputedStyle(mover).transform).m42;
  }

  function updateReveal() {
    if (!mover) return;
    const y = moverY();
    under.classList.toggle('revealed', -y >= revealAt);
    // the incoming sheet's bottom edge has entered: the lifted shadow may come
    if (dir < 0 && y > -moverBottom + 1) mover.classList.remove('entering');
  }

  // During an animated settle the position lives in CSS, so poll it per frame
  function trackReveal() {
    if (!animating) return;
    updateReveal();
    requestAnimationFrame(trackReveal);
  }

  // Follow the finger, no animation
  function dragTo(dy) {
    const pos = Math.min(0, Math.max(-travel, homeY() + dy));
    mover.classList.remove('animating');
    mover.style.transform = `translateY(${pos}px)`;
    updateReveal();
  }

  // Animate the rest of the way — through (commit) or back home (cancel)
  function settle(commit) {
    committed = commit;
    animating = true;
    // Flush the current position first, otherwise there is nothing to animate from
    void mover.offsetHeight;
    mover.classList.add('animating');
    mover.style.transform = `translateY(${commit ? awayY() : homeY()}px)`;
    requestAnimationFrame(trackReveal);
    clearTimeout(finishTimer);
    // transitionend can be skipped when the tab is backgrounded mid-slide;
    // well past the 1.2s settle so it never cuts a real one short
    finishTimer = setTimeout(finish, 2500);
  }

  function finish() {
    if (!mover) return;
    clearTimeout(finishTimer);
    if (committed) current = landing;
    mover.classList.remove('mover', 'animating', 'entering');
    mover.style.transform = '';
    under.classList.remove('under', 'revealed');
    layout();
    mover = under = null;
    dir = 0;
    animating = false;
  }

  track.addEventListener('transitionend', (e) => {
    if (!animating || e.target !== mover || e.propertyName !== 'transform') return;
    finish();
  });

  window.addEventListener('hashchange', () => {
    const n = targetN();
    if (n === null) return;
    const t = sheetOf(N - n);
    if (t === current || mover) return;
    startMove(t > current ? 1 : -1, t);
    settle(true);
  });

  function goForward() { if (!mover) { startMove(1); settle(true); } }
  function goBackward() { if (!mover) { startMove(-1); settle(true); } }

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

  fitTitle();
  window.addEventListener('resize', fitTitle);

  // A tap lights the title for a moment, then it fades back — iOS would
  // otherwise hold :hover until the next tap elsewhere
  let titleTimer = 0;
  title.addEventListener('touchstart', () => {
    title.classList.add('lit');
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => title.classList.remove('lit'), 2500);
  }, { passive: true });

  // ── Edge scrubber ──
  // The pile seen edge-on, along the right edge of the screen. A touch
  // there opens it; dragging runs through the pile (top = newest) with the
  // finger's sheet shown as a small print and its number and month; years
  // are marked along the edge. Letting go cuts the deck to that sheet.
  const scrub = document.createElement('div');
  scrub.className = 'scrub';
  scrub.innerHTML = '<div class="scrub-strip"></div>';
  const strip = scrub.querySelector('.scrub-strip');
  const scrubLabel = document.createElement('div');
  scrubLabel.className = 'scrub-label';
  scrubLabel.innerHTML = `
    <div class="scrub-up"></div>
    <div class="scrub-card"><div class="scrub-text"><b></b><span></span></div><img alt=""></div>
    <div class="scrub-down"></div>
    <div class="scrub-hint">← finer</div>`;
  const labelUp = scrubLabel.querySelector('.scrub-up');
  const labelDown = scrubLabel.querySelector('.scrub-down');
  const labelCard = scrubLabel.querySelector('.scrub-card');
  const labelN = scrubLabel.querySelector('.scrub-text b');
  const labelMonth = scrubLabel.querySelector('.scrub-text span');
  const labelPrint = scrubLabel.querySelector('.scrub-card img');
  const hint = scrubLabel.querySelector('.scrub-hint');
  document.body.append(scrub, scrubLabel);

  const monthYear = (p) => p.taken
    ? new Date(p.taken).toLocaleString('en', { month: 'short', year: 'numeric' })
    : 'undated';

  // year marks: the first sheet of each year, counted from the top. Years
  // with few sheets sit close together at the bottom; a mark that would
  // land within 18px of the previous one is left out.
  function markYears() {
    strip.querySelectorAll('.scrub-year').forEach(m => m.remove());
    const h = strip.getBoundingClientRect().height || 1;
    let last = null, lastY = -Infinity;
    for (let i = 0; i < N; i++) {
      const p = photoAt(i);
      const year = p.taken ? p.taken.slice(0, 4) : null;
      if (!year || year === last) continue;
      last = year;
      const f = N > 1 ? i / (N - 1) : 0;
      if (f * h - lastY < 18) continue;
      lastY = f * h;
      const mark = document.createElement('div');
      mark.className = 'scrub-year';
      mark.style.top = (f * 100) + '%';
      mark.textContent = year;
      strip.appendChild(mark);
    }
    // the label stops short of the widest year mark, so no year is ever covered
    let widest = 0;
    strip.querySelectorAll('.scrub-year').forEach(m => { widest = Math.max(widest, m.getBoundingClientRect().width); });
    scrubLabel.style.right = (16 + widest + 8) + 'px';
  }
  markYears();
  window.addEventListener('resize', markYears);

  let scrubbing = false;
  let scrubPos = 0;        // photo index, fractional while scrubbing
  let scrubIndex = 0;      // the photo shown

  // Nothing should appear empty while scrubbing. The thumbnails are fetched
  // once, in the background, as soon as the page is up — so the small print
  // under the finger is always there. The full photo of the sheet the finger
  // rests on is fetched ahead, so it is in the cache by the time the pile
  // is cut to it.
  const warm = new Map();          // url → Image, once requested
  function warmUp(url) {
    let img = warm.get(url);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.src = url;
      warm.set(url, img);
    }
    return img;
  }
  (function preloadThumbs() {
    let i = 0;
    const step = () => {
      for (let k = 0; k < 8 && i < N; k++, i++) warmUp(PHOTOS[i].thumb);
      if (i < N) setTimeout(step, 50);
    };
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
    idle(step);
  })();

  // How many prints the label shows: one when a finger-width of strip is one
  // photo or less, otherwise the neighbours too. px = strip pixels per photo
  // at the current gear.
  function neighbourCount(px) { return px >= 6 ? 1 : px >= 2 ? 3 : 5; }

  // Never the wrong picture: an <img> keeps showing its old image until the
  // new one has loaded, so only a thumbnail that is already there goes in;
  // otherwise the print stays blank paper until it arrives — and only if it
  // is still the wanted one by then
  function setPrint(img, p) {
    const thumb = warmUp(p.thumb);
    img.dataset.want = p.thumb;
    if (thumb.complete && thumb.naturalWidth) { img.src = p.thumb; img.style.visibility = ''; return; }
    img.style.visibility = 'hidden';
    thumb.addEventListener('load', () => {
      if (scrubbing && img.dataset.want === p.thumb) { img.src = p.thumb; img.style.visibility = ''; }
    }, { once: true });
  }

  // The finger's photo as a card — number, month, print — with the
  // neighbours floating above (newer) and below (older)
  function renderLabel(index, count) {
    const p = photoAt(index);
    labelN.textContent = p.n;
    labelMonth.textContent = monthYear(p);
    setPrint(labelPrint, p);
    const side = (count - 1) / 2;
    const fill = (box, from, to) => {
      const want = [];
      for (let i = from; i <= to; i++) if (i >= 0 && i < N) want.push(i);
      while (box.children.length > want.length) box.lastElementChild.remove();
      while (box.children.length < want.length) { const im = document.createElement('img'); im.alt = ''; box.appendChild(im); }
      want.forEach((i, k) => setPrint(box.children[k], photoAt(i)));
    };
    fill(labelUp, index - side, index - 1);
    fill(labelDown, index + 1, index + side);
  }

  // The card at the finger's height; the whole label kept on screen
  function placeLabel(clientY) {
    const r = strip.getBoundingClientRect();
    const h = scrubLabel.offsetHeight;
    const cardMid = labelUp.offsetHeight + labelCard.offsetHeight / 2;
    const top = Math.min(r.bottom - h, Math.max(r.top, clientY - cardMid));
    scrubLabel.style.top = top + 'px';
  }

  // Precision gear: when the strip gives less than GEAR_NEEDED_PX per photo,
  // sliding the finger left off the strip slows the scrub — ¼ from 60px in,
  // 1/16 from 160px. The touch-down sets the position from the strip; once a
  // finer gear has been used the position follows the finger's travel
  const GEAR_NEEDED_PX = 6;
  let gearsOn = false, fineUsed = false, lastY = 0;
  function gearRate(clientX) {
    if (!gearsOn) return 1;
    const d = scrub.getBoundingClientRect().left - clientX;
    return d < 60 ? 1 : d < 160 ? 0.25 : 1 / 16;
  }

  let restTimer = 0;

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
    // the finger resting on a photo for a moment is enough to fetch it
    clearTimeout(restTimer);
    restTimer = setTimeout(() => warmUp(photoAt(scrubIndex).file), 200);
  }

  scrub.addEventListener('touchstart', (e) => {
    if (animating) return;
    scrubbing = true;
    document.body.classList.add('scrubbing');
    gearsOn = strip.getBoundingClientRect().height / N < GEAR_NEEDED_PX;
    fineUsed = false;
    scrubTo(e.touches[0].clientX, e.touches[0].clientY, true);
  }, { passive: true });

  scrub.addEventListener('touchmove', (e) => {
    if (!scrubbing) return;
    e.preventDefault();
    scrubTo(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  scrub.addEventListener('touchend', () => {
    if (!scrubbing) return;
    scrubbing = false;
    document.body.classList.remove('scrubbing');
    const target = sheetOf(scrubIndex);
    if (target === current || mover) return;
    // older (further down the pile): lift the top sheet off onto it;
    // newer: bring it down onto the top sheet
    startMove(target > current ? 1 : -1, target);
    settle(true);
  }, { passive: true });

  // ── Tap zones ──
  // Where the screen splits into "tap here to go on" and "tap here to go back".
  // The sheets print a dotted line there (see section::after in the CSS).
  let dividerY = null;

  function computeDivider() {
    const box = sheet(current).querySelector('.awbox');
    if (!box) return;
    const boxRect = box.getBoundingClientRect();
    const wh = H() - boxRect.bottom;
    dividerY = wh > 0 ? boxRect.bottom + wh * 0.6 : H() * 0.6;
    document.documentElement.style.setProperty('--divider-y', dividerY + 'px');
  }

  function setDivider() { requestAnimationFrame(computeDivider); }

  // Straight away as well as on the events: a cached image fires no load event
  // and a backgrounded tab defers rAF — either would leave taps dead
  computeDivider();
  setDivider();
  // the top sheet may be a video, which has no img and no load event
  const topMedia = sheet(current).querySelector('img, video');
  topMedia.addEventListener(topMedia.tagName === 'VIDEO' ? 'loadeddata' : 'load', setDivider);
  window.addEventListener('load', setDivider);
  window.addEventListener('resize', setDivider);

  // ── Touch: drag + tap ──
  let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
  let dragging = false;

  main.addEventListener('touchstart', (e) => {
    if (animating) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
    dragging = false;
  }, { passive: true });

  main.addEventListener('touchmove', (e) => {
    if (animating) return;
    e.preventDefault();
    const dy = e.touches[0].clientY - touchStartY;
    const dx = e.touches[0].clientX - touchStartX;

    if (!dragging) {
      if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
      if (Math.abs(dx) > Math.abs(dy)) return;
      dragging = true;
    }

    // Swiping up lifts the current card off, down pulls the previous one over
    const wanted = dy < 0 ? 1 : -1;
    if (mover && wanted !== dir) {
      // The finger changed its mind — put that card back and take the other one
      committed = false;
      finish();
    }
    if (!mover) startMove(wanted);
    dragTo(dy);
  }, { passive: false });

  main.addEventListener('touchend', (e) => {
    const dy = e.changedTouches[0].clientY - touchStartY;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const elapsed = Date.now() - touchStartTime;

    if (dragging) {
      dragging = false;
      if (!mover) return;
      const absDy = Math.abs(dy);
      const velocity = absDy / Math.max(1, elapsed);
      const progress = absDy / travel;
      settle(progress > 0.2 || velocity > 0.4);
      return;
    }

    // ── Tap ──
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10 || elapsed > 300) return;
    if (animating) return;
    if (dividerY === null) computeDivider();
    if (dividerY === null) return;

    if (e.changedTouches[0].clientY > dividerY) goBackward();
    else goForward();
  }, { passive: true });

} else {

  /* ============================================================
     DESKTOP: scroll-snap + keyboard + mouse
     Same order as mobile: newest first, scrolling down goes back in time.
     ============================================================ */
  // Photos per row by the window's shape: taller than wide one, wider two,
  // wider than 2:1 three
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
      <p class="subtitle">${captionOf(p)}</p>`;
    boxes.push(box);
  }

  // A video plays only while it is the lit print: under the mouse, or the
  // one selected from the keyboard. At most one plays at a time.
  function playVideo(box) {
    boxes.forEach(b => { if (b !== box) { const v = b.querySelector('video'); if (v) v.pause(); } });
    const v = box && box.querySelector('video');
    if (v) v.play().catch(() => {});
  }
  boxes.forEach(box => {
    box.addEventListener('mouseenter', () => { if (mode === 'mouse') playVideo(box); });
    box.addEventListener('mouseleave', () => { if (mode === 'mouse') playVideo(null); });
  });

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
  fitTitle();
  window.addEventListener('resize', fitTitle);

  let gliding = false;        // the wall is on its way to a chosen print: the windows hold still
  let glideTarget = 0, glideTimer = 0;
  let approachTop = -1;       // where the wall is headed: the undim starts on approach
  let settledNear = false;    // the tail of the motion must not re-dim what has lit

  // A glide ends on arrival (or a safety timeout) — not on a pause in the
  // scroll events: a long smooth scroll starts so slowly that none fire for
  // a while, which must not count as "rested"
  function glideTo(top) {
    gliding = true;
    glideTarget = top;
    approachTop = top;
    settledNear = false;
    clearTimeout(glideTimer);
    glideTimer = setTimeout(() => { gliding = false; }, 6000);
    main.scrollTo({ top, behavior: 'smooth' });
  }

  // ── The wall's material ──
  // Plaster or concrete; clicking on empty wall (not a print, not the
  // knobs) switches, and the choice is kept
  try { if (localStorage.getItem('wall') === 'concrete') document.documentElement.classList.add('wall-concrete'); } catch (e) {}
  function toggleWall() {
    const concrete = document.documentElement.classList.toggle('wall-concrete');
    try { localStorage.setItem('wall', concrete ? 'concrete' : 'plaster'); } catch (e) {}
  }
  main.addEventListener('click', (e) => {
    if (e.target.closest('.awbox')) return;
    toggleWall();
  });

  // ── Single screen ──
  // The wall never free-scrolls: it shows one row and is switched row by
  // row — the same idea as the phone's deck. A wheel notch (or one trackpad
  // gesture, its inertia tail swallowed) moves one row; so do Page Up/Down
  // and Space; arrows, digits and the knobs as before. The glide to the next
  // row is the only motion.
  const rowOf = () => Math.round(main.scrollTop / (sections[0] ? sections[0].offsetHeight : 1));
  function stepRow(d) {
    const target = Math.max(0, Math.min(sections.length - 1, rowOf() + d));
    gliding = false;                                   // the user moves the wall: the windows follow again
    approachTop = sections[target].offsetTop;
    settledNear = false;
    clearTimeout(glideTimer);
    main.scrollTo({ top: sections[target].offsetTop, behavior: 'smooth' });
  }
  let wheelAcc = 0, wheelLockUntil = 0;
  main.addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now < wheelLockUntil) { wheelAcc = 0; return; }            // the tail of a gesture
    const notch = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50;   // a mouse wheel notch
    wheelAcc += e.deltaY;
    if (!notch && Math.abs(wheelAcc) < 40) return;                  // a trackpad: wait for enough travel
    stepRow(Math.sign(notch ? e.deltaY : wheelAcc));
    wheelAcc = 0;
    wheelLockUntil = now + 350;
  }, { passive: false });

  window.addEventListener('resize', () => {
    const n = perRow();
    if (n === PER_ROW) return;
    PER_ROW = n;
    regroup();
  });

  let selected = -1;
  let lastMouseIndex = 0;
  let mode = 'mouse';
  let mouseHasMoved = false;

  const cursor = document.createElement('div');
  cursor.id = 'cursor';
  document.body.appendChild(cursor);

  let idleTimer;
  document.addEventListener('mousemove', (e) => {
    goto.classList.remove('quiet');
    // The latest input wins: real mouse movement (not over the knobs, not
    // jitter) takes over from the keyboard — the selection light yields to
    // hover, exactly as a keypress takes over from the mouse
    if (mode === 'kbd' && Math.abs(e.movementX) + Math.abs(e.movementY) > 2
        && !(e.target instanceof Element && e.target.closest('.goto'))) {
      if (selected >= 0) boxes[selected].classList.remove('kbd-focus');
      selected = -1;
      document.body.classList.remove('kbd-active');
      mode = 'mouse';
      station = 0;
      applyStation();
      goto.classList.remove('quiet');
    }
    cursor.style.left = e.clientX + 'px';
    cursor.style.top = e.clientY + 'px';
    cursor.style.opacity = '0.65';
    mouseHasMoved = true;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { cursor.style.opacity = '0'; }, 2000);
  });

  boxes.forEach((box, i) => {
    box.addEventListener('mouseenter', () => {
      if (!mouseHasMoved) return;
      lastMouseIndex = i;
      if (mode === 'kbd') {
        if (selected >= 0) boxes[selected].classList.remove('kbd-focus');
        selected = -1;
        document.body.classList.remove('kbd-active');
        mode = 'mouse';
        playVideo(box);
      }
    });
  });

  // Light a print as the keyboard does, without scrolling
  function light(i) {
    if (selected >= 0) boxes[selected].classList.remove('kbd-focus');
    selected = Math.max(0, Math.min(boxes.length - 1, i));
    boxes[selected].classList.add('kbd-focus');
    playVideo(boxes[selected]);
    writeHash(+boxes[selected].dataset.n);
  }

  function select(i) {
    light(i);
    glideTo(boxes[selected].closest('section').offsetTop);
  }

  // ── Go-to: two knobs under the wall ──
  // A small machine centred below the prints: a year knob under its
  // window, a print knob under a window with number and date, and beside
  // them the print's image in a window (white paper until the first turn).
  // Scrolling on a knob turns it: the year knob steps a year, the print
  // knob a print (carrying into the next year at the ends). When the mouse
  // then leaves the unit — or clicks the print knob or the image — the wall
  // scrolls to the print and lights it, as a key would. Like the prints,
  // the unit is dim until the mouse is on it.
  const photoOfBox = (i) => PHOTOS[PHOTOS.length - 1 - i];
  const yearOf = (p) => p.taken ? p.taken.slice(0, 4) : 'undated';
  const years = [...new Set(PHOTOS.map(yearOf))].sort().reverse();      // newest first
  const goto = document.createElement('div');
  goto.className = 'goto';
  goto.innerHTML = `
    <div class="goto-col"><div class="goto-win goto-year">${`<span class="drum"><span class="strip">${'0123456789–'.split('').map(ch => `<i>${ch}</i>`).join('')}</span></span>`.repeat(4)}</div><div class="knob knob-year"><div class="face"><div class="ptr"></div></div></div></div>
    <div class="goto-col"><div class="goto-win goto-date"><b></b><span></span></div><div class="knob knob-print"><div class="face"><div class="ptr"></div></div></div></div>
    <div class="goto-win goto-img"><img alt=""></div>`;
  document.body.appendChild(goto);
  const yearDrums = [...goto.querySelectorAll('.goto-year .strip')];
  const gotoImg = goto.querySelector('.goto-img img');
  const gotoN = goto.querySelector('.goto-date b');
  const gotoDate = goto.querySelector('.goto-date span');
  const knobYear = goto.querySelector('.knob-year');
  const knobPrint = goto.querySelector('.knob-print');

  let goIdx = 0;              // the box the knobs point at
  let goTouched = false;      // the image window stays paper until a knob is turned
  let goPending = false;      // a turn happened; the wall follows when the mouse leaves
  let printAngle = 0;

  const fullDate = (p) => p.taken
    ? new Date(p.taken).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'undated';

  function showGoto() {
    const p = photoOfBox(goIdx);
    // four digit drums roll to the year's figures ('–' for an undated one)
    const y = yearOf(p).padStart(4, '–').slice(-4);
    yearDrums.forEach((d, i) => { const ch = y[i]; d.style.setProperty('--d', /[0-9]/.test(ch) ? +ch : 10); });
    const yi = years.indexOf(yearOf(p));
    knobYear.style.setProperty('--a', (years.length > 1 ? -150 + 300 * yi / (years.length - 1) : 0) + 'deg');
    knobPrint.style.setProperty('--a', printAngle + 'deg');
    if (goTouched) {
      gotoImg.src = p.thumb;
      gotoImg.style.visibility = '';
      gotoN.textContent = p.n;
      gotoDate.textContent = fullDate(p);
    } else {
      gotoImg.style.visibility = 'hidden';
      gotoN.textContent = '—';
      gotoDate.textContent = 'turn a knob';
    }
  }

  function goNow() {
    goPending = false;
    if (mode === 'mouse') { mode = 'kbd'; mouseHasMoved = false; document.body.classList.add('kbd-active'); }
    select(goIdx);
  }
  function armGoto() { goPending = true; }
  goto.addEventListener('mouseleave', () => { if (goPending) goNow(); });

  function turnYear(d) {
    // past either end the years wrap around
    const yi = (years.indexOf(yearOf(photoOfBox(goIdx))) + d + years.length) % years.length;
    goIdx = boxes.findIndex((b, i) => yearOf(photoOfBox(i)) === years[yi]);
    goTouched = true;
    showGoto();
    armGoto();
  }

  function turnPrint(d) {
    // past either end the pile wraps around
    goIdx = (goIdx + d + boxes.length) % boxes.length;
    printAngle += d * 18;
    goTouched = true;
    showGoto();
    armGoto();
  }

  // One notch of a mouse wheel (deltaY ≈ 100, or a line/page delta) is one
  // step; a trackpad sends many small deltas, which accumulate to steps
  function knobWheel(knob, turn) {
    let acc = 0;
    knob.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50) { acc = 0; turn(Math.sign(e.deltaY)); return; }
      acc += e.deltaY;
      while (acc >= 24) { acc -= 24; turn(1); }
      while (acc <= -24) { acc += 24; turn(-1); }
    }, { passive: false });
  }
  knobWheel(knobYear, turnYear);
  knobWheel(knobPrint, turnPrint);

  // Dragging a knob turns it too: press and pull up or down, ~14px per
  // step, the pointer captured so the pull may leave the knob. A real drag
  // swallows the release's click, so it cannot commit by accident.
  function knobDrag(knob, turn) {
    let dragging = false, acc = 0, lastY = 0, moved = 0;
    knob.addEventListener('pointerdown', (e) => {
      dragging = true; moved = 0; acc = 0; lastY = e.clientY;
      knob.setPointerCapture(e.pointerId);
    });
    knob.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = e.clientY - lastY;
      lastY = e.clientY;
      moved += Math.abs(dy);
      acc += dy;
      while (acc >= 14) { acc -= 14; turn(1); }
      while (acc <= -14) { acc += 14; turn(-1); }
    });
    knob.addEventListener('pointerup', () => { dragging = false; });
    knob.addEventListener('click', (e) => { if (moved > 5) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  }
  knobDrag(knobYear, turnYear);
  knobDrag(knobPrint, turnPrint);

  // Tab walks four stations: the wall's lit print, the year knob, the
  // print knob, the wall itself (its material) — full circle. A focused
  // knob shows the unit with a ring, arrows turn it, Enter commits; the
  // focused wall shows a dark border just inside the screen, arrows or
  // Enter switch its material.
  let station = 0;            // 0 print, 1 year knob, 2 print knob, 3 the wall
  function applyStation() {
    knobYear.classList.toggle('kfocus', station === 1);
    knobPrint.classList.toggle('kfocus', station === 2);
    goto.classList.toggle('kbd-open', station === 1 || station === 2);
    document.documentElement.classList.toggle('bg-focus', station === 3);
    if (station === 1 || station === 2) goto.classList.remove('quiet');
    else goto.classList.add('quiet');
  }
  // clicking the print knob or the image commits at once, without leaving
  goto.querySelector('.goto-img').addEventListener('click', () => { if (goTouched) goNow(); });
  knobPrint.addEventListener('click', () => { if (goTouched) goNow(); });

  // The windows show the row on screen — the chosen print if it is in that
  // row, else the row's first
  function syncGoto(top) {
    if (boxes[goIdx] && boxes[goIdx].closest('section') === top) return;
    goIdx = boxes.indexOf(top.querySelector('.awbox'));
    goPending = false;
    showGoto();
  }

  // The windows follow the wall when the user moves it — but hold still
  // while the wall glides to a print they chose. A moment after any
  // scrolling has come to rest, the row on screen lights up as if selected
  // from the keyboard (with the print's own slow fade-in)
  // Sync the windows to a row and light its first print (unless the
  // selected print already lives in that row)
  function lightRow(top) {
    syncGoto(top);
    const i = boxes.indexOf(top.querySelector('.awbox'));
    if (mode === 'mouse') { mode = 'kbd'; mouseHasMoved = false; document.body.classList.add('kbd-active'); }
    if (selected !== i && !(selected >= 0 && boxes[selected].closest('section') === top)) light(i);
  }

  // The motion has arrived: hover may light prints again
  function settle(target) {
    gliding = false;
    settledNear = true;
    document.body.classList.remove('moving');
    const top = target || sections.find(s => s.getBoundingClientRect().bottom > 0);
    if (top) lightRow(top);
  }

  let scrollTick = 0, scrollEndTimer = 0;
  main.addEventListener('scroll', () => {
    if (!settledNear) document.body.classList.add('moving');   // nothing undims while the wall moves
    if (gliding && Math.abs(main.scrollTop - glideTarget) < 2) { gliding = false; clearTimeout(glideTimer); }
    clearTimeout(scrollEndTimer);
    // nothing undims before the wall has come to rest: the step's target
    // only marks the arrival, the light comes from the rest-settle below
    if (approachTop >= 0 && Math.abs(main.scrollTop - approachTop) < 2) approachTop = -1;
    scrollEndTimer = setTimeout(() => {
      // a pause on the way is not the end: while a step or glide still has
      // a target, only the fully-inside check may light anything
      if (gliding || approachTop >= 0) return;
      settle();
    }, 300);
    if (gliding || scrollTick) return;
    scrollTick = requestAnimationFrame(() => {
      scrollTick = 0;
      const top = sections.find(s => s.getBoundingClientRect().bottom > 0);
      if (top) syncGoto(top);
    });
  }, { passive: true });
  showGoto();

  // a deep link opens on its print, instantly and lit
  const startN = targetN();
  if (startN !== null) {
    goIdx = PHOTOS.length - startN;
    goTouched = true;
    main.scrollTo({ top: boxes[goIdx].closest('section').offsetTop, behavior: 'instant' });
    if (mode === 'mouse') { mode = 'kbd'; document.body.classList.add('kbd-active'); }
    light(goIdx);
    showGoto();
  }

  window.addEventListener('hashchange', () => {
    const n = targetN();
    if (n === null) return;
    goIdx = PHOTOS.length - n;
    goTouched = true;
    showGoto();
    goNow();
  });

  // digits type a number into the date window; Enter goes at once
  let typed = '', typedTimer = 0;
  function typeDigit(ch) {
    clearTimeout(typedTimer);
    typed = (typed + ch).slice(-4);
    typedTimer = setTimeout(() => { typed = ''; }, 1500);
    const n = parseInt(typed, 10);
    if (n < 1 || n > PHOTOS.length) return;
    goIdx = PHOTOS.length - n;
    goTouched = true;
    showGoto();
    armGoto();
  }

  document.addEventListener('keydown', (e) => {
    cursor.style.opacity = '0';
    if (station === 0) goto.classList.add('quiet');   // keyboard in use: the knobs stay dim even under the mouse

    if (e.key === 'Escape') {
      station = 0;
      applyStation();
      if (selected >= 0) boxes[selected].classList.remove('kbd-focus');
      playVideo(null);
      selected = -1;
      document.body.classList.remove('kbd-active');
      mode = 'mouse';
      mouseHasMoved = false;
      return;
    }

    if (/^[0-9]$/.test(e.key)) { typeDigit(e.key); return; }

    if (e.key === 'PageDown') { e.preventDefault(); stepRow(e.shiftKey ? -1 : 1); return; }
    if (e.key === 'PageUp') { e.preventDefault(); stepRow(-1); return; }
    // Space is a second Enter (it does not page)
    const enter = e.key === 'Enter' || e.key === ' ';

    if (enter && typed) {
      e.preventDefault();
      typed = '';
      goNow();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (mode === 'mouse') { mode = 'kbd'; mouseHasMoved = false; document.body.classList.add('kbd-active'); }
      station = (station + (e.shiftKey ? 3 : 1)) % 4;
      applyStation();
      if (station === 0 && selected < 0) {
        const top = sections.find(s => s.getBoundingClientRect().bottom > 0);
        if (top) lightRow(top);
      }
      return;
    }

    if (enter && (station === 1 || station === 2)) {
      e.preventDefault();
      station = 0;
      applyStation();
      goNow();
      return;
    }

    if (enter && station === 3) {
      e.preventDefault();
      toggleWall();
      return;
    }

    if (enter) {
      e.preventDefault();
      if (mode === 'mouse') {
        mode = 'kbd';
        mouseHasMoved = false;
        document.body.classList.add('kbd-active');
      }
      const dir = e.shiftKey ? -1 : 1;
      const next = selected < 0
        ? (dir === 1 ? 0 : boxes.length - 1)
        : (selected + dir + boxes.length) % boxes.length;
      select(next);
      return;
    }

    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();

    if (station === 3) { toggleWall(); return; }

    if (station !== 0) {
      const d = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : -1;
      (station === 1 ? turnYear : turnPrint)(d);
      return;
    }

    if (mode === 'mouse') {
      mode = 'kbd';
      mouseHasMoved = false;
      document.body.classList.add('kbd-active');
      selected = lastMouseIndex;
    }

    if (e.key === 'ArrowDown') {
      if (selected + PER_ROW < boxes.length) select(selected + PER_ROW);
    } else if (e.key === 'ArrowUp') {
      if (selected - PER_ROW >= 0) select(selected - PER_ROW);
    } else if (e.key === 'ArrowRight') select(selected + 1);
    else if (e.key === 'ArrowLeft') select(selected - 1);
  });
}
}
