const PHOTO_COUNT = 8;       // increment when adding photos
const PER_SECTION = window.innerWidth < 600 ? 1 : 2;

const main = document.querySelector('.main');
const boxes = [];
const sections = [];

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

// Mobile: fit title text to image width
if (PER_SECTION === 1) {
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
}

// Mobile: infinite loop — clone last/first section as ghost entries at both ends
let seamFirstTop = 0, seamLastTop = 0, teleporting = false;
if (PER_SECTION === 1) {
  history.scrollRestoration = 'manual';
  const preClone  = sections[sections.length - 1].cloneNode(true);
  const postClone = sections[0].cloneNode(true);
  preClone.classList.add('seam-pre');
  postClone.classList.add('seam-post');
  // preClone: extra height at bottom = shadow buffer; image stays at top (flex-start)
  preClone.style.height = 'calc(100vh + 33.33vh)';
  // postClone: extra height at top = shadow buffer; push content down to match real section
  const origPT = getComputedStyle(sections[0]).paddingTop;
  postClone.style.height = 'calc(100vh + 33.33vh)';
  postClone.style.paddingTop = `calc(33.33vh + ${origPT})`;
  postClone.style.scrollSnapAlign = 'end';
  main.insertBefore(preClone, main.firstChild);
  main.appendChild(postClone);
  // Reading offsetTop forces a synchronous layout — values are always correct here
  seamFirstTop = sections[0].offsetTop;
  seamLastTop  = sections[sections.length - 1].offsetTop;
  // Disable snap to avoid an animated scroll from 0 → seamFirstTop on load.
  // Hold teleporting=true so the loop timer can't fire during the settle.
  teleporting = true;
  main.style.scrollSnapType = 'none';
  main.scrollTop = seamFirstTop;
  void main.offsetHeight;
  main.style.scrollSnapType = 'y mandatory';
  requestAnimationFrame(() => requestAnimationFrame(() => { teleporting = false; }));
}

// Mobile: split tap zones in whitespace below image — upper 60% goes down, lower 40% goes up
if (PER_SECTION === 1) {
  const divider = document.createElement('div');
  divider.className = 'tap-divider';
  document.body.appendChild(divider);

  let dividerY = null;

  function setDivider() {
    requestAnimationFrame(() => {
      const box = sections[0].querySelector('.awbox');
      const boxRect = box.getBoundingClientRect();
      const secRect = sections[0].getBoundingClientRect();
      const whitespaceH = secRect.bottom - boxRect.bottom;
      if (whitespaceH <= 0) return;
      dividerY = boxRect.bottom + whitespaceH * 0.6;
      divider.style.top = dividerY + 'px';
    });
  }

  sections[0].querySelector('img').addEventListener('load', setDivider);
  window.addEventListener('load', setDivider);

  let touchStartX, touchStartY, touchStartTime;

  main.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
  }, { passive: true });

  main.addEventListener('touchend', (e) => {
    const dx = Math.abs(e.changedTouches[0].clientX - touchStartX);
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
    if (dx > 10 || dy > 10 || Date.now() - touchStartTime > 300) return;
    if (dividerY === null) return;

    const st = main.scrollTop, mainH = main.clientHeight;
    let current = 0, maxV = 0;
    sections.forEach((s, i) => {
      const v = Math.max(0, Math.min(st + mainH, s.offsetTop + s.offsetHeight) - Math.max(st, s.offsetTop));
      if (v > maxV) { maxV = v; current = i; }
    });

    const goForward = e.changedTouches[0].clientY > dividerY;
    const nextIdx = goForward
      ? (current + 1) % sections.length
      : (current - 1 + sections.length) % sections.length;
    sections[nextIdx].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, { passive: true });
}

// Mobile: scroll-driven opacity — fade only in the second half of each section's entry/exit
if (PER_SECTION === 1) {
  boxes.forEach(box => { box.style.opacity = 0; });

  function updateMobileOpacity() {
    const st = main.scrollTop;
    const mainH = main.clientHeight;
    sections.forEach((section) => {
      const box = section.querySelector('.awbox');
      const h   = section.offsetHeight;
      const top = section.offsetTop;
      const visible = Math.max(0, Math.min(st + mainH, top + h) - Math.max(st, top));
      const ratio = visible / h;
      box.style.opacity = Math.max(0, Math.min(1, (ratio - 0.5) * 2));
    });
  }

  main.addEventListener('scroll', updateMobileOpacity, { passive: true });
  updateMobileOpacity();

  // Infinite loop: after scroll settles on a clone, silently jump to the real section.
  // Clone snap positions are visually identical to the corresponding real section, so no
  // opacity masking is needed — just disable snap, jump, re-enable snap.
  function doTeleport(target) {
    teleporting = true;
    main.style.scrollSnapType = 'none';
    main.scrollTop = target;
    void main.offsetHeight;
    main.style.scrollSnapType = 'y mandatory';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      updateMobileOpacity();
      teleporting = false;
    }));
  }

  let loopTimer;
  main.addEventListener('scroll', () => {
    if (teleporting) return;
    clearTimeout(loopTimer);
    loopTimer = setTimeout(() => {
      const sH = main.clientHeight;
      const st = main.scrollTop;
      if (st < seamFirstTop * 0.5) {
        doTeleport(seamLastTop);
      } else if (st > seamLastTop + sH * 0.5) {
        doTeleport(seamFirstTop);
      }
    }, 400);
  }, { passive: true });
}

// Desktop: keyboard + mouse
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
  cursor.style.top  = e.clientY + 'px';
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

  // ESC: release all focus
  if (e.key === 'Escape') {
    if (selected >= 0) boxes[selected].classList.remove('kbd-focus');
    selected = -1;
    document.body.classList.remove('kbd-active');
    mode = 'mouse';
    mouseHasMoved = false;
    return;
  }

  // Enter / Tab (+ Shift for reverse): cycle all items left-to-right, top-to-bottom
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
    if (selected - PER_SECTION >= 0)           select(selected - PER_SECTION);
  } else if (e.key === 'ArrowRight') select(selected + 1);
    else if (e.key === 'ArrowLeft')  select(selected - 1);
});
