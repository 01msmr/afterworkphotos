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
   MOBILE: Carousel with CSS transform
   ============================================================ */
if (PER_SECTION === 1) {

  // Build carousel track
  const track = document.createElement('div');
  track.className = 'carousel-track';
  main.appendChild(track);

  // Build real sections
  for (let i = PHOTO_COUNT; i >= 1; i -= PER_SECTION) {
    const section = document.createElement('section');
    for (let j = i; j > i - PER_SECTION && j >= 1; j--) {
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

  // Clone last → prepend, clone first → append (seamless wrap)
  const preClone = sections[N - 1].cloneNode(true);
  const postClone = sections[0].cloneNode(true);
  preClone.classList.add('clone');
  postClone.classList.add('clone');
  track.insertBefore(preClone, track.firstChild);
  track.appendChild(postClone);

  // Collect ALL awbox elements (clones included) for opacity control
  const allBoxes = Array.from(track.querySelectorAll('.awbox'));

  // Slot layout: [cloneLast₀] [section₁] [section₂] … [sectionₙ] [cloneFirst_{N+1}]
  let currentSlot = 1;    // first real section
  let animating = false;

  // Always use live window.innerHeight for calculations
  function H() { return window.innerHeight; }

  function setTransform(slot, animate) {
    if (animate) {
      track.classList.add('animating');
    } else {
      track.classList.remove('animating');
    }
    track.style.transform = `translateY(${-slot * H()}px)`;
  }

  // ── Opacity ──
  // Force all awbox to fully opaque first, then set only the current one to 1
  function updateOpacity() {
    const realIdx = ((currentSlot - 1) % N + N) % N;
    allBoxes.forEach(box => { box.style.opacity = '0.12'; });
    // Current real section
    sections[realIdx].querySelector('.awbox').style.opacity = '1';
    // Matching clone (if we're showing a clone during wrap)
    if (currentSlot === 0) preClone.querySelector('.awbox').style.opacity = '1';
    if (currentSlot === N + 1) postClone.querySelector('.awbox').style.opacity = '1';
  }

  // ── Initial state ──
  setTransform(currentSlot, false);
  // Ensure opacity is correct after a micro-delay (images may not have laid out yet)
  updateOpacity();
  requestAnimationFrame(updateOpacity);

  // ── Transition end: handle clone → real jump ──
  track.addEventListener('transitionend', (e) => {
    // Only react to the track's own transform transition
    if (e.target !== track) return;
    if (currentSlot === 0) {
      currentSlot = N;
      setTransform(currentSlot, false);
    } else if (currentSlot === N + 1) {
      currentSlot = 1;
      setTransform(currentSlot, false);
    }
    animating = false;
    updateOpacity();
  });

  function goTo(slot) {
    if (animating) return;
    animating = true;
    currentSlot = slot;
    // Pre-set opacity for the target so the arriving card is already bright
    updateOpacity();
    setTransform(currentSlot, true);
  }

  function goForward() { goTo(currentSlot + 1); }
  function goBackward() { goTo(currentSlot - 1); }

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
  window.addEventListener('resize', () => { fitTitle(); setTransform(currentSlot, false); });

  // ── Tap divider ──
  const divider = document.createElement('div');
  divider.className = 'tap-divider';
  document.body.appendChild(divider);
  let dividerY = null;

  function setDivider() {
    requestAnimationFrame(() => {
      const box = sections[0].querySelector('.awbox');
      if (!box) return;
      const boxRect = box.getBoundingClientRect();
      const wh = H() - boxRect.bottom;
      dividerY = wh > 0 ? boxRect.bottom + wh * 0.6 : H() * 0.6;
      divider.style.top = dividerY + 'px';
    });
  }
  sections[0].querySelector('img').addEventListener('load', setDivider);
  window.addEventListener('load', setDivider);
  window.addEventListener('resize', setDivider);

  // ── Touch: drag + tap ──
  let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
  let dragging = false;
  let dragStartSlot = 0;

  main.addEventListener('touchstart', (e) => {
    if (animating) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
    dragging = false;
    dragStartSlot = currentSlot;
    track.classList.remove('animating');
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

    const h = H();
    const offset = -dragStartSlot * h + dy;
    track.style.transform = `translateY(${offset}px)`;

    // Live opacity during drag
    const floatSlot = dragStartSlot - dy / h;
    updateDragOpacity(floatSlot);
  }, { passive: false });

  function updateDragOpacity(floatSlot) {
    // Total slots: 0..N+1
    allBoxes.forEach(box => { box.style.opacity = '0.12'; });
    // Find the two nearest slots and interpolate
    const lo = Math.floor(floatSlot);
    const hi = lo + 1;
    const frac = floatSlot - lo;
    setSlotOpacity(lo, 1 - frac);
    setSlotOpacity(hi, frac);
  }

  function setSlotOpacity(slot, weight) {
    if (weight < 0.05) return;
    const op = Math.max(0.12, weight);
    if (slot === 0) {
      preClone.querySelector('.awbox').style.opacity = op;
    } else if (slot === N + 1) {
      postClone.querySelector('.awbox').style.opacity = op;
    } else if (slot >= 1 && slot <= N) {
      sections[slot - 1].querySelector('.awbox').style.opacity = op;
    }
  }

  main.addEventListener('touchend', (e) => {
    const dy = e.changedTouches[0].clientY - touchStartY;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const elapsed = Date.now() - touchStartTime;

    if (dragging) {
      const absDy = Math.abs(dy);
      const velocity = absDy / Math.max(1, elapsed);
      const progress = absDy / H();
      const commit = progress > 0.2 || velocity > 0.4;

      if (commit) {
        if (dy < 0) goForward();
        else goBackward();
      } else {
        animating = true;
        currentSlot = dragStartSlot;
        updateOpacity();
        setTransform(currentSlot, true);
      }
      dragging = false;
      return;
    }

    // ── Tap ──
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10 || elapsed > 300) return;
    if (animating || dividerY === null) return;

    if (e.changedTouches[0].clientY > dividerY) goBackward();
    else goForward();
  }, { passive: true });

} else {

  /* ============================================================
     DESKTOP: scroll-snap + keyboard + mouse (unchanged)
     ============================================================ */
  for (let i = PHOTO_COUNT; i >= 1; i -= PER_SECTION) {
    const section = document.createElement('section');
    for (let j = i; j > i - PER_SECTION && j >= 1; j--) {
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