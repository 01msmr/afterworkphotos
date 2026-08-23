const PHOTO_COUNT = 8;       // increment when adding photos
const PER_SECTION = window.innerWidth < 600 ? 1 : 2;

const main = document.querySelector('.main');
const boxes = [];
const sections = [];

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
   The photos lie on each other like a stack of prints, photo 1 on top of
   photo 2 on top of … Swiping up lifts the current card off and uncovers the
   next number underneath; swiping down pulls the previous card back down over
   the current one. Either way it is the upper card that moves, travelling
   between "in place" and "off the top of the screen", with its bottom edge
   shadowing whatever lies below. The wraparound is the same move as any
   other, so there are no clones and nothing scrolls.
   ============================================================ */
if (PER_SECTION === 1) {

  // Build the deck, lowest number on top
  const track = document.createElement('div');
  track.className = 'carousel-track';
  main.appendChild(track);

  for (let i = 1; i <= PHOTO_COUNT; i += PER_SECTION) {
    const section = document.createElement('section');
    for (let j = i; j < i + PER_SECTION && j <= PHOTO_COUNT; j++) {
      const box = document.createElement('div');
      box.className = 'awbox';
      box.innerHTML = `
        <div class="awphoto"><img src="img/${j}.jpg" alt="afterworkphoto ${j}" loading="lazy" width="100%"></div>
        <p class="subtitle">afterworkphoto ${j}</p>`;
      section.appendChild(box);
      boxes.push(box);
    }
    track.appendChild(section);
    sections.push(section);
  }

  const N = sections.length;
  const wrap = (i) => ((i % N) + N) % N;

  // Live window height — the part you can actually see and touch
  function H() { return window.innerHeight; }

  // ── Stack state ──
  let current = 0;          // sheet on top
  let mover = null;         // the sheet being lifted off or put back
  let under = null;         // the sheet it reveals / covers
  let dir = 0;              // +1 forward (lift off), -1 backward (put back)
  let travel = 0;           // how far the mover goes to clear the screen
  let revealAt = 0;         // how far up it must be before the sheet beneath is dealt in
  let animating = false;
  let committed = false;    // does the pending move land on the neighbour?
  let finishTimer = 0;

  sections[current].classList.add('current');

  // Where the moving sheet rests at each end of its travel
  function homeY() { return dir > 0 ? 0 : -travel; }   // where it starts
  function awayY() { return dir > 0 ? -travel : 0; }   // where a committed move ends

  // Pick the moving sheet: the top one to lift off, the previous one to put back
  function startMove(direction) {
    dir = direction;
    if (dir > 0) {
      mover = sections[current];              // lift the top sheet off
      under = sections[wrap(current + 1)];
    } else {
      mover = sections[wrap(current - 1)];    // put the previous sheet back on
      under = sections[current];
    }
    under.classList.add('under');
    mover.classList.add('mover');
    // Measured in place: the sheet's bottom edge plus the shadow it casts
    // below itself, so nothing of it is left showing once it is "away"
    mover.style.transform = '';
    const bottom = mover.getBoundingClientRect().bottom;
    travel = bottom + 70;
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
    under.classList.toggle('revealed', -moverY() >= revealAt);
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
    // transitionend can be skipped when the tab is backgrounded mid-slide
    finishTimer = setTimeout(finish, 1200);
  }

  function finish() {
    if (!mover) return;
    clearTimeout(finishTimer);
    if (committed) current = wrap(current + dir);
    mover.classList.remove('mover', 'animating');
    mover.style.transform = '';
    under.classList.remove('under', 'revealed');
    sections.forEach((s, i) => s.classList.toggle('current', i === current));
    mover = under = null;
    dir = 0;
    animating = false;
  }

  track.addEventListener('transitionend', (e) => {
    if (!animating || e.target !== mover || e.propertyName !== 'transform') return;
    finish();
  });

  function goForward() { if (!mover) { startMove(1); settle(true); } }
  function goBackward() { if (!mover) { startMove(-1); settle(true); } }

  // ── Fit title ──
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
  fitTitle();
  window.addEventListener('resize', fitTitle);

  // ── Tap zones ──
  // Where the screen splits into "tap here to go on" and "tap here to go back".
  // Nothing is drawn for it — a line here would sit over the cards.
  let dividerY = null;

  function computeDivider() {
    const box = sections[0].querySelector('.awbox');
    if (!box) return;
    const boxRect = box.getBoundingClientRect();
    const wh = H() - boxRect.bottom;
    dividerY = wh > 0 ? boxRect.bottom + wh * 0.6 : H() * 0.6;
  }

  function setDivider() { requestAnimationFrame(computeDivider); }

  // Straight away as well as on the events: a cached image fires no load event
  // and a backgrounded tab defers rAF — either would leave taps dead
  computeDivider();
  setDivider();
  sections[0].querySelector('img').addEventListener('load', setDivider);
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
     Same order as mobile: scrolling down goes to the next number.
     ============================================================ */
  for (let i = 1; i <= PHOTO_COUNT; i += PER_SECTION) {
    const section = document.createElement('section');
    for (let j = i; j < i + PER_SECTION && j <= PHOTO_COUNT; j++) {
      const box = document.createElement('div');
      box.className = 'awbox';
      box.innerHTML = `
        <div class="awphoto"><img src="img/${j}.jpg" alt="afterworkphoto ${j}" loading="lazy" width="100%"></div>
        <p class="subtitle">afterworkphoto ${j}</p>`;
      section.appendChild(box);
      boxes.push(box);
    }
    main.appendChild(section);
    sections.push(section);
  }

  let selected = -1;
  let lastMouseIndex = 0;
  let mode = 'mouse';
  let mouseHasMoved = false;

  const cursor = document.createElement('div');
  cursor.id = 'cursor';
  document.body.appendChild(cursor);

  let idleTimer;
  document.addEventListener('mousemove', (e) => {
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
      }
    });
  });

  function select(i) {
    if (selected >= 0) boxes[selected].classList.remove('kbd-focus');
    selected = Math.max(0, Math.min(boxes.length - 1, i));
    requestAnimationFrame(() => {
      boxes[selected].classList.add('kbd-focus');
      boxes[selected].closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  document.addEventListener('keydown', (e) => {
    cursor.style.opacity = '0';

    if (e.key === 'Escape') {
      if (selected >= 0) boxes[selected].classList.remove('kbd-focus');
      selected = -1;
      document.body.classList.remove('kbd-active');
      mode = 'mouse';
      mouseHasMoved = false;
      return;
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
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

    if (mode === 'mouse') {
      mode = 'kbd';
      mouseHasMoved = false;
      document.body.classList.add('kbd-active');
      selected = lastMouseIndex;
    }

    if (e.key === 'ArrowDown') {
      if (selected + PER_SECTION < boxes.length) select(selected + PER_SECTION);
    } else if (e.key === 'ArrowUp') {
      if (selected - PER_SECTION >= 0) select(selected - PER_SECTION);
    } else if (e.key === 'ArrowRight') select(selected + 1);
    else if (e.key === 'ArrowLeft') select(selected - 1);
  });
}