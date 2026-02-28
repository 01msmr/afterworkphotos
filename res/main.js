const PHOTO_COUNT = 8;       // increment when adding photos
const PER_SECTION = 2;

const main = document.querySelector('.main');

for (let i = PHOTO_COUNT; i >= 1; i -= PER_SECTION) {
  const section = document.createElement('section');
  for (let j = i; j > i - PER_SECTION && j >= 1; j--) {
    const box = document.createElement('div');
    box.className = 'awbox';
    box.innerHTML = `
      <div class="awphoto"><img src="img/${j}.jpg" width="100%"></div>
      <p class="subtitle">afterworkphoto ${j}</p>`;
    section.appendChild(box);
  }
  main.appendChild(section);
}

const ANIM_TIME = 250;
const QUIET = 800;

onePageScroll('.main', {
  sectionContainer: 'section',
  easing: 'ease-out',
  animationTime: ANIM_TIME,
  pagination: false,
  updateURL: false,
  loop: false,
  keyboard: true,
  responsiveFallback: false
});

// onepage.js only binds the deprecated mousewheel/DOMMouseScroll events,
// missing Firefox and modern trackpad gestures entirely.
// Replace them with the standard wheel event.
document.removeEventListener('mousewheel', _mouseWheelHandler);
document.removeEventListener('DOMMouseScroll', _mouseWheelHandler);

let lastScroll = 0;
document.addEventListener('wheel', (e) => {
  e.preventDefault();
  const now = Date.now();
  if (now - lastScroll < QUIET + ANIM_TIME) return;
  lastScroll = now;
  if (e.deltaY > 0) moveDown(main);
  else moveUp(main);
}, { passive: false });
