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

// Mobile: split tap zones in whitespace below image — upper 2/3 goes up, lower 1/3 goes down
if (PER_SECTION === 1) {
  sections.forEach(section => {
    const divider = document.createElement('div');
    divider.className = 'tap-divider';
    section.appendChild(divider);
  });

  function positionDividers() {
    sections.forEach(section => {
      const box = section.querySelector('.awbox');
      const boxBottom = box.offsetTop + box.offsetHeight;
      const whitespaceH = section.offsetHeight - boxBottom;
      const divider = section.querySelector('.tap-divider');
      divider.style.top    = boxBottom + 'px';
      divider.style.height = (whitespaceH * 0.6) + 'px';
    });
  }
  window.addEventListener('load', positionDividers);
  window.addEventListener('resize', positionDividers);
  sections.forEach(s => s.querySelector('img').addEventListener('load', positionDividers));

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

    const tapY = e.changedTouches[0].clientY;
    const st = main.scrollTop;
    const mainH = main.clientHeight;
    let current = 0, maxV = 0;
    sections.forEach((s, i) => {
      const v = Math.max(0, Math.min(st + mainH, s.offsetTop + s.offsetHeight) - Math.max(st, s.offsetTop));
      if (v > maxV) { maxV = v; current = i; }
    });

    const section = sections[current];
    const boxRect = section.querySelector('.awbox').getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    if (tapY <= boxRect.bottom || tapY >= sectionRect.bottom) return;

    const dividerY = boxRect.bottom + (sectionRect.bottom - boxRect.bottom) * 0.6;
    const next = tapY > dividerY
      ? (current - 1 + sections.length) % sections.length
      : (current + 1) % sections.length;
    sections[next].scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      const top = section.offsetTop;
      const h   = section.offsetHeight;
      const visible = Math.max(0, Math.min(st + mainH, top + h) - Math.max(st, top));
      const ratio = visible / h;
      box.style.opacity = Math.max(0, Math.min(1, (ratio - 0.5) * 2));
    });
  }

  main.addEventListener('scroll', updateMobileOpacity, { passive: true });
  updateMobileOpacity();
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
