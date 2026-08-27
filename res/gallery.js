// three.js 0.180.0, vendored (MIT) — res/vendor/three.module.js, which in
// turn imports res/vendor/three.core.js; both are pinned together.
import * as THREE from './vendor/three.module.js';

// ---------------------------------------------------------------------------
// State and settings
//
// Room defaults from the spec: 6 × 4 × 3 m. The eye stands at 1.6 m, frames
// centre at 1.5 m. Light mode is the white cube; dark mode is the same room
// at night, ambient almost off, the spots alone.

const DEFAULTS = { W: 6, D: 4, H: 3, dark: false, frame: 'oak' };

const state = { year: null, settings: { ...DEFAULTS }, photos: [] };

const EYE = 1.6;
const HANG_Y = 1.5;   // every piece's centre, the gallery's line

// ---------------------------------------------------------------------------
// Renderer, scene, camera

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
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// The room
//
// A group named "room" encloses [-W/2..W/2] × [0..H] × [-D/2..D/2]: a floor,
// four walls, a ceiling, each a named plane facing inward, plus the base
// lights. North is -z (the wall the camera faces on arrival), east is +x.
// Wall and ambient values are what applyMode() switches; the spots that
// light each piece come later (task 1.3) and go in their own group.

const COLOURS = {
	wall:    { light: 0xf2f1ee, dark: 0x1b1b1b },
	floor:   { light: 0xc9c6c0, dark: 0x2a2927 },
	ceiling: { light: 0xffffff, dark: 0x141414 },
};

const AMBIENT = { light: 0.55, dark: 0.08 };

function buildRoom(W, D, H) {
	const room = new THREE.Group();
	room.name = 'room';

	const mode = state.settings.dark ? 'dark' : 'light';
	const mat = key => new THREE.MeshLambertMaterial({ color: COLOURS[key][mode] });

	// Each surface: a plane sized to its span, rotated to face the room's
	// inside, positioned on the boundary. PlaneGeometry lies in xy facing +z.
	const surface = (name, key, w, h, pos, rot) => {
		const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(key));
		m.name = name;
		m.position.set(...pos);
		m.rotation.set(...rot);
		m.receiveShadow = true;
		m.userData.surface = key;
		room.add(m);
	};

	surface('floor',   'floor',   W, D, [0, 0, 0],       [-Math.PI / 2, 0, 0]);
	surface('ceiling', 'ceiling', W, D, [0, H, 0],       [ Math.PI / 2, 0, 0]);
	surface('wall-n',  'wall',    W, H, [0, H / 2, -D / 2], [0, 0, 0]);
	surface('wall-s',  'wall',    W, H, [0, H / 2,  D / 2], [0, Math.PI, 0]);
	surface('wall-e',  'wall',    D, H, [ W / 2, H / 2, 0], [0, -Math.PI / 2, 0]);
	surface('wall-w',  'wall',    D, H, [-W / 2, H / 2, 0], [0,  Math.PI / 2, 0]);

	const ambient = new THREE.AmbientLight(0xffffff, AMBIENT[mode]);
	ambient.name = 'ambient';
	room.add(ambient);

	// A warm wash from above and slightly behind the viewer, so the walls
	// have a base tone before any spot is on. Shadows come from the spots.
	const wash = new THREE.DirectionalLight(0xfff2e0, 0.25);
	wash.name = 'wash';
	wash.position.set(0, H, D / 4);
	wash.target.position.set(0, 0, -D / 4);
	room.add(wash, wash.target);

	return room;
}

// Switch between the white cube and the room at night without rebuilding:
// every surface remembers which colour family it belongs to.
function applyMode(dark) {
	state.settings.dark = dark;
	const mode = dark ? 'dark' : 'light';
	const room = scene.getObjectByName('room');
	if (!room) return;
	room.traverse(o => {
		if (o.isMesh && o.userData.surface) o.material.color.setHex(COLOURS[o.userData.surface][mode]);
		if (o.isAmbientLight) o.intensity = AMBIENT[mode];
	});
}

// ---------------------------------------------------------------------------
// The frames
//
// makePiece(spec) builds one hung piece as a group facing +z with its origin
// at the piece's centre; Hang (task 1.3) places and turns it. A single is
// { photos: [p], size: 0.9 | 0.6 }; a grid is { photos: [p...], size: 0.4,
// cols: 3, rows: 2 | 3 }. The group's userData carries { n, w, h }: the
// first photo's number and the piece's overall metres including frames.
//
// One framed print, from the wall outward: the mat board (a stiff white
// sheet the print sits on), the print 2 mm proud of it, and the frame bars
// around the mat's edge, 3 cm face and 4 cm deep, mitred by overlap. Two
// lines rise from the frame's top corners to the ceiling. No glass.

const FRAME = { face: 0.03, depth: 0.04 };
const MAT = { 0.9: 0.06, 0.6: 0.04, 0.4: 0.03 };      // mat width per print size
const GRID_GAP = 0.08;                                 // between frames in a grid

const FRAME_COLOURS = { oak: 0xb08d57, walnut: 0x5b4633, black: 0x171717, white: 0xf4f2ee };

// Materials are shared: one per frame colour, one mat, one line. Switching
// the frame colour (task 1.6) recolours the shared material once.
const materials = {
	frame: new THREE.MeshStandardMaterial({ color: FRAME_COLOURS[state.settings.frame], roughness: 0.62, metalness: 0 }),
	mat:   new THREE.MeshStandardMaterial({ color: 0xfaf9f6, roughness: 0.95 }),
	line:  new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.6, roughness: 0.1, thickness: 0.001 }),
};

const textures = new THREE.TextureLoader();
const textureCache = new Map();
function photoTexture(p) {
	if (!textureCache.has(p.n)) {
		const t = textures.load(p.file);
		t.colorSpace = THREE.SRGBColorSpace;
		t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
		textureCache.set(p.n, t);
	}
	return textureCache.get(p.n);
}

// Outer edge of one framed print of a given print size.
const framedSize = size => size + 2 * MAT[size] + 2 * FRAME.face;

function makeFramedPrint(p, size) {
	const g = new THREE.Group();
	g.name = `print-${p.n}`;
	const mat = MAT[size];
	const inner = size + 2 * mat;               // the mat board's edge = frame's inner edge
	const outer = inner + 2 * FRAME.face;

	const board = new THREE.Mesh(new THREE.BoxGeometry(inner, inner, 0.006), materials.mat);
	board.name = 'mat';
	board.position.z = 0.003;
	board.castShadow = true;
	g.add(board);

	const print = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
		new THREE.MeshBasicMaterial({ map: photoTexture(p) }));
	print.name = 'photo';
	print.position.z = 0.006 + 0.002;
	g.add(print);

	// Four bars around the board. Horizontal bars run the full outer width;
	// vertical bars fill between them — the overlap reads as a mitre from
	// any angle the viewer can take. Bars sit flush with the wall at z=0
	// and come 4 cm into the room.
	const bar = (name, w, h, x, y) => {
		const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, FRAME.depth), materials.frame);
		m.name = name;
		m.position.set(x, y, FRAME.depth / 2);
		m.castShadow = true;
		m.receiveShadow = true;
		g.add(m);
	};
	const half = inner / 2 + FRAME.face / 2;
	bar('bar-top',    outer, FRAME.face, 0,  half);
	bar('bar-bottom', outer, FRAME.face, 0, -half);
	bar('bar-left',   FRAME.face, inner, -half, 0);
	bar('bar-right',  FRAME.face, inner,  half, 0);

	g.userData = { n: p.n, w: outer, h: outer };
	return g;
}

// Two 0.5 mm lines from a piece's top corners up to the ceiling. Their
// length follows from where the piece hangs: centre at HANG_Y, ceiling at H.
function addLines(piece, w, h) {
	const drop = state.settings.H - (HANG_Y + h / 2);
	if (drop <= 0) return;
	const geo = new THREE.CylinderGeometry(0.0006, 0.0006, drop, 6);
	for (const x of [-w / 2 + FRAME.face / 2, w / 2 - FRAME.face / 2]) {
		const line = new THREE.Mesh(geo, materials.line);
		line.name = 'line';
		line.position.set(x, h / 2 + drop / 2, FRAME.depth / 2);
		piece.add(line);
	}
}

function makePiece(spec) {
	const piece = new THREE.Group();
	const { photos, size } = spec;
	piece.name = `piece-${photos[0].n}`;
	let w, h;

	if (photos.length === 1) {
		const fp = makeFramedPrint(photos[0], size);
		piece.add(fp);
		({ w, h } = fp.userData);
	} else {
		const { cols, rows } = spec;
		const cell = framedSize(size);
		w = cols * cell + (cols - 1) * GRID_GAP;
		h = rows * cell + (rows - 1) * GRID_GAP;
		// Date order reads like the site: left to right, top row first.
		photos.forEach((p, i) => {
			const c = i % cols, r = Math.floor(i / cols);
			const fp = makeFramedPrint(p, size);
			fp.position.set(-w / 2 + cell / 2 + c * (cell + GRID_GAP),
			                 h / 2 - cell / 2 - r * (cell + GRID_GAP), 0);
			piece.add(fp);
		});
	}

	addLines(piece, w, h);
	piece.userData = { n: photos[0].n, w, h };
	return piece;
}

// ---------------------------------------------------------------------------
// Boot

fetch('photos.json', { cache: 'no-cache' })
	.then(r => r.json())
	.then(d => { state.photos = d.photos; init(); });

function init() {
	const { W, D, H } = state.settings;
	scene.add(buildRoom(W, D, H));

	// Arrival: standing a little back from the middle, eye height, facing north.
	camera.position.set(0, EYE, 1.5);
	camera.lookAt(0, EYE, -D / 2);
}

renderer.setAnimationLoop(() => renderer.render(scene, camera));

// Test-harness handle only: the plan's browser checks read the scene graph
// and camera through this. Nothing on the page uses it.
window.G = { scene, camera, renderer, state, buildRoom, applyMode, makePiece };
