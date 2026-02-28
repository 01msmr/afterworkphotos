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

// Mobile: highlight image as it snaps into view
if (PER_SECTION === 1) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const box = entry.target.querySelector('.awbox');
      box.classList.toggle('in-view', entry.isIntersecting);
    });
  }, { root: main, threshold: 0.5 });
  sections.forEach(s => observer.observe(s));
}

// Desktop: keyboard + mouse
let selected = -1;
let lastMouseIndex = 0;
let mode = 'mouse';
let mouseHasMoved = false;

const cursor = document.createElement('div');
cursor.id = 'cursor';
document.body.appendChild(cursor);

document.addEventListener('mousemove', (e) => {
  cursor.style.left = e.clientX + 'px';
  cursor.style.top  = e.clientY + 'px';
  cursor.style.opacity = '1';
  mouseHasMoved = true;
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
