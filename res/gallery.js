// three.js 0.180.0, vendored (MIT) — res/vendor/three.module.js, which in
// turn imports res/vendor/three.core.js; both are pinned together.
import * as THREE from './vendor/three.module.js';

// ---------------------------------------------------------------------------
// State and settings
//
// Room defaults from the spec: 6 × 4 × 3 m. The eye stands at 1.6 m, frames
// centre at 1.5 m. Light mode is the white cube; dark mode is the same room
// at night, ambient almost off, the spots alone.

const DEFAULTS = { W: 6, D: 4, H: 3, dark: false, frame: 'oak', mat: 'white', scale: 1, labels: true };

// Settings come from the defaults, then what the switchboard saved last
// time (localStorage 'galleryS'), then the URL — /gallery/?frame=black
// &dark=1&mat=warm&scale=80&labels=0&W=8&D=5 — so a look can be shared.
function loadSettings() {
	const s = { ...DEFAULTS };
	try { Object.assign(s, JSON.parse(localStorage.getItem('galleryS')) || {}); } catch (e) {}
	const q = new URLSearchParams(location.search);
	for (const k of Object.keys(DEFAULTS)) {
		if (!q.has(k)) continue;
		const v = q.get(k);
		if (k === 'dark' || k === 'labels') s[k] = v === '1' || v === 'true';
		else if (k === 'scale') s[k] = Number(v) > 1 ? Number(v) / 100 : Number(v);
		else if (k === 'W' || k === 'D' || k === 'H') s[k] = Number(v);
		else s[k] = v;
	}
	if (!(s.frame in FRAME_COLOURS_KEYS)) s.frame = DEFAULTS.frame;
	if (!['white', 'warm', 'none'].includes(s.mat)) s.mat = DEFAULTS.mat;
	if (![1, 0.8].includes(s.scale)) s.scale = DEFAULTS.scale;
	for (const k of ['W', 'D', 'H']) if (!(s[k] >= 2 && s[k] <= 40)) s[k] = DEFAULTS[k];
	return s;
}
const FRAME_COLOURS_KEYS = { oak: 1, walnut: 1, black: 1, white: 1 };

// settings.W/D is the smallest room; room.W/D is the one standing, which a
// crowded year may have grown (see hangYear).
const state = { year: null, roomKey: null, settings: loadSettings(), room: null, photos: [] };

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
const rig = new THREE.Group();     // the body: on the bench at the origin, in VR the thing that walks
rig.name = 'rig';
rig.add(camera);
scene.add(rig);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
const headPos = new THREE.Vector3();
function head() { return camera.getWorldPosition(headPos); }   // where the eyes are, in the world

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

// Every room is its own (Uli: not the same room over and over): a look —
// the wall's white, the floor — and a shape, chosen from the room's key
// so a year always gets the same room. Dark mode keeps the differences
// as tints of the dark.
const LOOKS = [
	{ name: 'warm white / concrete', wall: { light: 0xf2f1ee, dark: 0x1b1b1b }, floor: { light: 0xc9c6c0, dark: 0x2a2927 } },
	{ name: 'cool white / pale oak',  wall: { light: 0xeff1f2, dark: 0x191b1d }, floor: { light: 0xd8c4a0, dark: 0x2e271d } },
	{ name: 'greige / dark stone',    wall: { light: 0xe9e5dd, dark: 0x1e1c19 }, floor: { light: 0x7d7a74, dark: 0x1a1918 } },
	{ name: 'pale grey / concrete',   wall: { light: 0xe4e4e2, dark: 0x171717 }, floor: { light: 0xb9b7b2, dark: 0x262524 } },
];
const CEILING = { light: 0xffffff, dark: 0x141414 };
// Proportions relative to the settings' room: as set, wider and shallower, deeper and narrower.
const SHAPES = [[1, 1], [1.2, 0.85], [0.85, 1.25]];

function hashKey(key) {
	let h = 7;
	for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return h;
}
function lookOf(key)  { return LOOKS[hashKey(key) % LOOKS.length]; }
function shapeOf(key) {
	const [fw, fd] = SHAPES[(hashKey(key) >>> 3) % SHAPES.length];   // unsigned shift: a signed one can go negative
	const r = v => Math.round(v * 2) / 2;                 // to the half metre
	return { W: r(state.settings.W * fw), D: r(state.settings.D * fd) };
}

const AMBIENT = { light: 0.55, dark: 0.08 };
const FILL    = { light: 0.5,  dark: 0.06 };

function buildRoom(W, D, H, look = LOOKS[0]) {
	const room = new THREE.Group();
	room.name = 'room';
	room.userData.look = look.name;

	const mode = state.settings.dark ? 'dark' : 'light';
	const COLOURS = { wall: look.wall, floor: look.floor, ceiling: CEILING };
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
		m.userData.colours = COLOURS[key];
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

	// Sky-and-ground fill: the ceiling's white bouncing down, the floor's
	// grey bouncing up. Keeps every wall lit between the spots.
	const fill = new THREE.HemisphereLight(0xfffaf2, 0x8c8880, FILL[mode]);
	fill.name = 'fill';
	fill.position.set(0, H, 0);
	room.add(fill);

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
		if (o.isMesh && o.userData.colours) o.material.color.setHex(o.userData.colours[mode]);
		if (o.isAmbientLight) o.intensity = AMBIENT[mode];
		if (o.isHemisphereLight) o.intensity = FILL[mode];
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
const MAT = { 0.9: 0.09, 0.6: 0.06, 0.4: 0.045 };     // mat width per nominal print size: the spec's 6/4/3 plus half (Uli)
const PRINT_SCALE = 0.9;                               // the print inside is a little smaller than nominal, the mat takes the rest (Uli)
const MAT_COLOURS = { white: 0xfaf9f6, warm: 0xf3ecdd, none: 0xfaf9f6 };

// The mat's width for a nominal size under the current settings ('none'
// runs the print to the frame), and the overall scale (100 % or 80 %, for
// a small real room) that every dimension of a framed print follows.
const matWidth = size => state.settings.mat === 'none' ? 0 : MAT[size];
const sc = () => state.settings.scale;
const GRID_GAP = 0.08;                                 // between frames in a grid

const FRAME_COLOURS = { oak: 0xb08d57, walnut: 0x5b4633, black: 0x171717, white: 0xf4f2ee };

// Materials are shared: one per frame colour, one mat, one line. Switching
// the frame colour (task 1.6) recolours the shared material once.
const materials = {
	frame: new THREE.MeshStandardMaterial({ color: FRAME_COLOURS[state.settings.frame], roughness: 0.62, metalness: 0 }),
	mat:   new THREE.MeshStandardMaterial({ color: MAT_COLOURS[state.settings.mat], roughness: 0.95 }),
	line:  new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.6, roughness: 0.1, thickness: 0.001 }),
};

const textures = new THREE.TextureLoader();
const textureCache = new Map();
function photoTexture(p) {
	if (!textureCache.has(p.n)) {
		const t = textures.load('/' + p.file);   // photos.json paths are relative to the site root
		t.colorSpace = THREE.SRGBColorSpace;
		t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
		textureCache.set(p.n, t);
	}
	return textureCache.get(p.n);
}

// Outer edge of one framed print of a given print size.
const framedSize = size => (size + 2 * matWidth(size) + 2 * FRAME.face) * sc();

function makeFramedPrint(p, size) {
	const g = new THREE.Group();
	g.name = `print-${p.n}`;
	const k = sc();
	const face = FRAME.face * k;
	const inner = (size + 2 * matWidth(size)) * k;   // the mat board's edge = frame's inner edge
	const outer = inner + 2 * face;

	const board = new THREE.Mesh(new THREE.BoxGeometry(inner, inner, 0.006), materials.mat);
	board.name = 'mat';
	board.position.z = 0.003;
	board.castShadow = true;
	g.add(board);

	const printed = size * (state.settings.mat === 'none' ? 1 : PRINT_SCALE) * k;
	const print = new THREE.Mesh(new THREE.PlaneGeometry(printed, printed),
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
	const half = inner / 2 + face / 2;
	bar('bar-top',    outer, face, 0,  half);
	bar('bar-bottom', outer, face, 0, -half);
	bar('bar-left',   face, inner, -half, 0);
	bar('bar-right',  face, inner,  half, 0);

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
		const cell = framedSize(size), gap = GRID_GAP * sc();
		w = cols * cell + (cols - 1) * gap;
		h = rows * cell + (rows - 1) * gap;
		// Date order reads like the site: left to right, top row first.
		photos.forEach((p, i) => {
			const c = i % cols, r = Math.floor(i / cols);
			const fp = makeFramedPrint(p, size);
			fp.position.set(-w / 2 + cell / 2 + c * (cell + gap),
			                 h / 2 - cell / 2 - r * (cell + gap), 0);
			piece.add(fp);
		});
	}

	addLines(piece, w, h);
	addLabel(piece, spec, w, h);
	piece.userData = { n: photos[0].n, w, h };
	return piece;
}

// A small card to the lower right of a piece, two or three lines: the
// number and month, the description, the place (Uli). A grid's card gives
// its range and the first print's words.
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
function labelLines(photos) {
	const a = photos[0], b = photos[photos.length - 1];
	const when = `${MONTHS[Number(a.taken.slice(5, 7)) - 1]} ${a.taken.slice(0, 4)}`;
	const lines = [photos.length === 1 ? `afterworkphoto ${a.n} \u00b7 ${when}` : `afterworkphotos ${a.n}\u2013${b.n} \u00b7 ${when}`];
	if (a.desc) lines.push(a.desc);
	if (a.place) lines.push(a.place);
	return lines;
}
function addLabel(piece, spec, w, h) {
	const lines = labelLines(spec.photos);
	const c = document.createElement('canvas');
	c.width = 768; c.height = 80 + 64 * lines.length;
	const g = c.getContext('2d');
	g.fillStyle = '#fbfaf7'; g.fillRect(0, 0, c.width, c.height);
	g.textBaseline = 'middle';
	lines.forEach((line, i) => {
		g.fillStyle = i === 0 ? '#3a3835' : '#6b6862';
		g.font = `${i === 0 ? 500 : 400} ${i === 0 ? 40 : 36}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
		g.fillText(line, 40, 40 + 32 + 64 * i);
	});
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	const cw = 0.24, ch = cw * c.height / c.width;
	const card = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), new THREE.MeshLambertMaterial({ map: t }));
	card.name = 'label';
	card.position.set(w / 2 + 0.05 + cw / 2, -h / 2 + ch / 2, 0.002);
	card.visible = state.settings.labels;
	piece.add(card);
}

// ---------------------------------------------------------------------------
// Hanging a year
//
// The pieces of a year, in date order: a run of six or more group photos
// becomes grids of nine then six; what will not fill a grid hangs single at
// 60; everything judged single hangs at 90. Same rule as the review page.

function packRun(n) {
	let best = { nine: 0, six: 0, covered: 0 };
	for (let nine = Math.floor(n / 9); nine >= 0; nine--) {
		const six = Math.floor((n - 9 * nine) / 6);
		const covered = 9 * nine + 6 * six;
		if (covered > best.covered) best = { nine, six, covered };
	}
	return best;
}

function piecesOf(photos) {
	const specs = [];
	let run = [];
	const flush = () => {
		if (!run.length) return;
		const { nine, six } = packRun(run.length);
		let i = 0;
		for (const g of [...Array(nine).fill(9), ...Array(six).fill(6)]) {
			specs.push({ photos: run.slice(i, i + g), size: 0.4, cols: 3, rows: g / 3 });
			i += g;
		}
		for (; i < run.length; i++) specs.push({ photos: [run[i]], size: 0.6 });
		run = [];
	};
	for (const p of photos) {
		if (p.hang === 'group') { run.push(p); continue; }
		flush();
		specs.push({ photos: [p], size: 0.9 });
	}
	flush();
	return specs;
}

// The elevator's corner is reserved: +x, -z, a 1.5 m square — room to stand
// in and turn round (Uli: enough place inside).
const ELEVATOR = { size: 1.5 };
const WALL_MARGIN = 0.6;    // from a wall's end or the elevator: the corners stay empty (Uli)
const GAP = 1.2;            // gallery spacing between pieces
const GAP_MIN = 0.1;        // how tight the walls go before the middle fills
const OFF_WALL = 0.001;     // a hair off the plaster, so the frame's back does not z-fight

// Each wall as a run the cursor walks along, clockwise from the elevator:
// east (southward), south (westward), west (northward), north (eastward,
// ending at the elevator). For a run: its start point, the unit direction
// the cursor moves in, the yaw a piece faces the room with, and its length.
function wallRuns(W, D) {
	const e = ELEVATOR.size;
	return [
		{ name: 'e', start: [ W / 2, -D / 2 + e], dir: [0,  1], yaw: -Math.PI / 2, len: D - e },
		{ name: 's', start: [ W / 2,  D / 2],     dir: [-1, 0], yaw:  Math.PI,     len: W },
		{ name: 'w', start: [-W / 2,  D / 2],     dir: [0, -1], yaw:  Math.PI / 2, len: D },
		{ name: 'n', start: [-W / 2, -D / 2],     dir: [1,  0], yaw:  0,           len: W - e },
	];
}

// Lay pieces (with their widths) along the walls at a given gap; whatever
// does not fit comes back for the middle of the room.
function layWalls(pieces, W, D, gap) {
	const placed = [];
	let i = 0;
	for (const run of wallRuns(W, D)) {
		let cursor = WALL_MARGIN;
		while (i < pieces.length) {
			const w = pieces[i].w;
			if (cursor + w > run.len - WALL_MARGIN) break;
			const t = cursor + w / 2;
			const x = run.start[0] + run.dir[0] * t;
			const z = run.start[1] + run.dir[1] * t;
			// step off the wall along the piece's facing direction
			const nx = Math.sin(run.yaw), nz = Math.cos(run.yaw);
			placed.push({ piece: pieces[i], x: x + nx * OFF_WALL, z: z + nz * OFF_WALL, yaw: run.yaw, wall: run.name });
			cursor += w + gap;
			i++;
		}
	}
	return { placed, rest: pieces.slice(i) };
}

// The middle of the room: rows down the long axis, pieces back to back so
// each slot shows a face to either side, walkways of WALKWAY between rows
// and to the walls. A 4 m room takes one row; every further 1.5 m of
// depth adds one.
const WALKWAY = 1.5;
function middleRows(D) {
	const n = Math.max(1, Math.floor(D / WALKWAY) - 1);
	return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * WALKWAY);
}

function layMiddle(pieces, W, D, gap) {
	const placed = [];
	let i = 0;
	for (const z of middleRows(D)) {
		let cursor = WALL_MARGIN;
		while (i < pieces.length) {
			const a = pieces[i], b = pieces[i + 1];
			const w = Math.max(a.w, b ? b.w : 0);
			if (cursor + w > W - WALL_MARGIN) break;
			const x = -W / 2 + cursor + w / 2;
			placed.push({ piece: a, x, z: z + FRAME.depth / 2, yaw: 0, wall: 'mid' });        // faces +z (south)
			if (b) placed.push({ piece: b, x, z: z - FRAME.depth / 2, yaw: Math.PI, wall: 'mid' });  // faces -z
			cursor += w + gap;
			i += 2;
		}
	}
	return { placed, rest: pieces.slice(i) };
}

function yearOf(p) { return p.taken.slice(0, 4); }

// A piece's overall width from its spec alone, so rooms can be planned
// before a single mesh exists.
function specWidth(spec) {
	if (spec.photos.length === 1) return framedSize(spec.size);
	return spec.cols * framedSize(spec.size) + (spec.cols - 1) * GRID_GAP * sc();
}

// Lay pieces into a room of W × D: gallery spacing first; when the walls
// run out, the spacing tightens; then the middle of the room takes the
// rest. Returns the placements and whatever still did not fit.
const GAP_MAX = 2.5;        // a sparse room spreads out this far, no further

function layout(items, W, D) {
	let gap = GAP, walls, middle;
	for (;;) {
		walls = layWalls(items, W, D, gap);
		middle = layMiddle(walls.rest, W, D, gap);
		if (!middle.rest.length || gap <= GAP_MIN) break;
		gap = Math.max(GAP_MIN, gap - 0.1);
	}
	// A thin room uses the whole perimeter (Uli: no two lonely prints in a
	// corner): while everything still fits on the walls, widen the spacing.
	if (!walls.rest.length && gap === GAP) {
		for (let g = GAP + 0.1; g <= GAP_MAX + 1e-9; g += 0.1) {
			const w = layWalls(items, W, D, g);
			if (w.rest.length) break;
			walls = w; gap = g;
		}
		middle = { placed: [], rest: [] };
	}
	return { placed: [...walls.placed, ...middle.placed], rest: middle.rest, gap };
}

// ---------------------------------------------------------------------------
// Spots and their shadows
//
// A shadow map costs a texture unit in every shader, and WebGL gives
// sixteen. A room with two dozen spots cannot have two dozen shadows. So
// the spots per piece light only, and a pool of eight shadow-casting
// spots stands in for the eight nearest the viewer: each frame the pool
// takes those spots' places (their own light goes dark meanwhile), and
// the frames around you throw shadows while the far ones simply glow.

const SPOT = { colour: 0xfff1dc, power: 9, angle: 0.62, penumbra: 1.0 };
const SHADOW_POOL = 8;

const shadowSpots = new THREE.Group();
shadowSpots.name = 'shadow-spots';
for (let i = 0; i < SHADOW_POOL; i++) {
	const s = new THREE.SpotLight(SPOT.colour, 0, 0, SPOT.angle, SPOT.penumbra, 2);
	s.castShadow = true;
	s.shadow.mapSize.set(512, 512);
	s.shadow.bias = -0.0005;
	s.shadow.radius = 4;
	shadowSpots.add(s);
}
scene.add(shadowSpots);

function stepShadows() {
	const pieces = scene.getObjectByName('pieces');
	if (!pieces) return;
	const near = pieces.children
		.map(p => ({ p, d: p.position.distanceToSquared(head()) }))
		.sort((a, b) => a.d - b.d)
		.slice(0, SHADOW_POOL)
		.map(o => o.p);
	for (const p of pieces.children) p.userData.spot.intensity = SPOT.power;
	shadowSpots.children.forEach((s, i) => {
		const p = near[i];
		if (!p) { s.intensity = 0; return; }
		s.position.copy(p.userData.spot.position);
		s.target = p;
		s.intensity = SPOT.power;
		p.userData.spot.intensity = 0;
	});
}

// ---------------------------------------------------------------------------
// Rooms
//
// One room per year — unless the year does not fit the room even with the
// spacing tightened and the middle full; then it splits into two rooms by
// date, the later half hanging in the second (Uli, 2026-08-28). Each room
// is a floor of the elevator: key "2018" or "2018-1" / "2018-2", the
// newest room at the top. Planned from widths only; meshes come at hanging.

let roomList = null;

function rooms() {
	if (roomList) return roomList;
	const byYear = new Map();
	for (const p of state.photos) {
		if (!byYear.has(yearOf(p))) byYear.set(yearOf(p), []);
		byYear.get(yearOf(p)).push(p);
	}
	// Thin years (a handful of pieces) share a floor with their neighbours
	// (Uli): consecutive years of at most THIN pieces merge into one room,
	// keyed "2009_2014", named by its first and last year.
	const THIN = 5;
	const years = [...byYear.entries()].map(([year, photos]) => ({ year, photos, specs: piecesOf(photos).map(s => ({ ...s, w: specWidth(s) })) }));
	const merged = [];
	for (const y of years) {
		const last = merged[merged.length - 1];
		if (last && last.thin && y.specs.length <= THIN) {
			last.years.push(y.year); last.specs.push(...y.specs);
			continue;
		}
		merged.push({ years: [y.year], specs: y.specs, thin: y.specs.length <= THIN });
	}
	roomList = [];
	for (const m of merged) {
		const year = m.years[0], span = m.years.length > 1 ? `${m.years[0]}\u2013${m.years[m.years.length - 1]}` : year;
		const specs = m.specs;
		const one = shapeOf(m.years.join('_'));
		if (!layout([...specs].reverse(), one.W, one.D).rest.length) {
			const key = m.years.join('_');
			roomList.push({ key, year, span, years: m.years, part: 0, of: 1, specs, shape: one, look: lookOf(key) });
			continue;
		}
		const half = Math.ceil(specs.length / 2);
		for (const [part, slice] of [[1, specs.slice(0, half)], [2, specs.slice(half)]]) {
			const key = `${year}-${part}`;
			roomList.push({ key, year, span, years: m.years, part, of: 2, specs: slice, shape: shapeOf(key), look: lookOf(key) });
		}
	}
	// newest room first: by year, then the later part
	roomList.sort((a, b) => b.year.localeCompare(a.year) || b.part - a.part);
	return roomList;
}

function roomByKey(key) {
	const r = rooms().find(r => r.key === key);
	if (!r) throw new Error(`no room ${key}`);
	return r;
}

function hangRoom(key) {
	const room = roomByKey(key);
	const H = state.settings.H;
	for (const name of ['pieces', 'spots']) {
		const old = scene.getObjectByName(name);
		if (old) scene.remove(old);
	}
	const pieces = new THREE.Group(); pieces.name = 'pieces';
	const spots  = new THREE.Group(); spots.name  = 'spots';

	// newest first from the elevator
	const items = [...room.specs].reverse();

	// The settings' room is the room. Should half a year still not fit it
	// (it does not happen with this collection), the room grows in steps
	// of the same proportion rather than dropping a print — and says so.
	let { W, D } = room.shape;
	let lay = layout(items, W, D);
	while (lay.rest.length && W < 40) {
		W += 1.5; D += 1;
		lay = layout(items, W, D);
	}
	if (W !== room.shape.W) console.warn(`${key}: room grown to ${W} × ${D} to hang everything`);
	if (!state.room || state.room.W !== W || state.room.D !== D || state.room.look !== room.look.name) {
		for (const name of ['room', 'elevator']) {
			const old = scene.getObjectByName(name);
			if (old) scene.remove(old);
		}
		scene.add(buildRoom(W, D, H, room.look));
		scene.add(elevator.build(W, D, H));
		state.room = { W, D, H, look: room.look.name };
	}

	for (const { piece: spec, x, z, yaw, wall } of lay.placed) {
		const piece = makePiece(spec);
		piece.position.set(x, HANG_Y, z);
		piece.rotation.y = yaw;
		piece.userData.wall = wall;
		pieces.add(piece);

		// One spot per piece from the ceiling track, a metre out into the
		// room from the piece, angled down at its centre. Soft, not harsh
		// (Uli): a wide cone with the whole edge feathered, modest power, so
		// a piece is lifted from its wall rather than picked out of the dark.
		// The spot itself throws no shadow: shadows come from the pool below,
		// which stands in for the spots nearest the viewer.
		const spot = new THREE.SpotLight(SPOT.colour, SPOT.power, 0, SPOT.angle, SPOT.penumbra, 2);
		spot.position.set(x + Math.sin(yaw) * 1.0, H - 0.05, z + Math.cos(yaw) * 1.0);
		spot.target = piece;
		piece.userData.spot = spot;
		spots.add(spot);
	}

	scene.add(pieces, spots);
	state.year = room.year;
	state.roomKey = key;
	state.gap = lay.gap;
	elevator.light(key);
	return pieces;
}

// ---------------------------------------------------------------------------
// The elevator
//
// A cabin in the room's +x, -z corner, ELEVATOR.size square, the room's
// height. Its doors are on the west face, so you step out looking down
// the long axis of the room. Inside, on the south wall beside the door,
// the panel: two columns of round buttons, one per room, the newest at
// the top, the year printed on each and a small "1/2" line where a year
// has two rooms. The lit button is the room you stand in. A press closes
// the doors, hangs the other room, and opens them again: one second.

const DOOR = { w: 0.8, h: 2.1, thick: 0.03 };
const CABIN_WALL = 0.08;
const LINER = 0.02;                                        // the cabin's own skin on the room's two walls
const BUTTON = { r: 0.02, rise: 0.008, pitch: 0.05 };     // radius, how far it stands proud, spacing
const PANEL = { low: 1.0, high: 1.6, tilt: 22 * Math.PI / 180, cols: 8 };   // between hand and eye, turned up toward the eye, side by side

// Brushed steel, not mirror: without an environment to reflect, a highly
// metallic surface renders near black, so the cabin is a dull satin.
const metal = new THREE.MeshStandardMaterial({ color: 0xa9a7a2, metalness: 0.35, roughness: 0.45 });
const cabinInner = new THREE.MeshLambertMaterial({ color: 0xcfccc5 });
const cabinFloor = new THREE.MeshLambertMaterial({ color: 0x5a5854 });
const panelPlate = new THREE.MeshStandardMaterial({ color: 0xb5b2ac, metalness: 0.4, roughness: 0.5 });
const lightPanel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 1.6, roughness: 1 });

// The face of a button: the year, and beneath it "1/2" for a split year.
function buttonFace(room) {
	const c = document.createElement('canvas');
	c.width = c.height = 128;
	const g = c.getContext('2d');
	g.fillStyle = '#f2efe8';
	g.beginPath(); g.arc(64, 64, 64, 0, Math.PI * 2); g.fill();
	g.fillStyle = '#1b1b1b';
	g.textAlign = 'center';
	g.textBaseline = 'middle';
	if (room.years.length > 1) {
		g.font = '600 34px -apple-system, "Helvetica Neue", Arial, sans-serif';
		g.fillText(room.years[0], 64, 46);
		g.fillText('\u2013' + room.years[room.years.length - 1].slice(2), 64, 84);
	} else if (room.of === 1) {
		g.font = '600 46px -apple-system, "Helvetica Neue", Arial, sans-serif';
		g.fillText(room.year, 64, 66);
	} else {
		g.font = '600 40px -apple-system, "Helvetica Neue", Arial, sans-serif';
		g.fillText(room.year, 64, 52);
		g.font = '500 24px -apple-system, "Helvetica Neue", Arial, sans-serif';
		g.fillText(`${room.part}/${room.of}`, 64, 92);
	}
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

const elevator = {
	group: null,
	doors: null,        // [north panel, south panel]
	buttons: [],
	ride: null,         // { t0, key } while the doors are moving
	origin: null,       // cabin's inner centre on the floor, world coords

	build(W, D, H) {
		const e = ELEVATOR.size;
		const g = new THREE.Group();
		g.name = 'elevator';
		const x0 = W / 2 - e, z1 = -D / 2 + e;   // west face at x0, south face at z1
		// the cabin's inside: between the west wall, the south wall, and the liners on north and east
		const ix0 = x0 + CABIN_WALL, ix1 = W / 2 - LINER, iz0 = -D / 2 + LINER, iz1 = z1 - CABIN_WALL;
		this.origin = new THREE.Vector3((ix0 + ix1) / 2, 0, (iz0 + iz1) / 2);

		const box = (name, w, h, d, x, y, z, m) => {
			const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
			mesh.name = name; mesh.position.set(x, y, z);
			mesh.castShadow = mesh.receiveShadow = true;
			g.add(mesh); return mesh;
		};

		// The cabin is its own box: a closed lift shows nothing of the room.
		box('cabin-s', e, H, CABIN_WALL, W / 2 - e / 2, H / 2, z1 - CABIN_WALL / 2, metal);        // south wall, panel inside
		box('cabin-n', e, H, LINER, W / 2 - e / 2, H / 2, -D / 2 + LINER / 2, cabinInner);         // liner on the room's north wall
		box('cabin-e', LINER, H, e, W / 2 - LINER / 2, H / 2, -D / 2 + e / 2, cabinInner);         // liner on the room's east wall
		box('cabin-floor', e, 0.01, e, W / 2 - e / 2, 0.005, -D / 2 + e / 2, cabinFloor);
		box('cabin-ceiling', e, 0.02, e, W / 2 - e / 2, H - 0.01, -D / 2 + e / 2, cabinInner);
		// West face: two jambs and a lintel around the door opening.
		const jamb = (e - DOOR.w) / 2;
		box('jamb-n', CABIN_WALL, DOOR.h, jamb, x0 + CABIN_WALL / 2, DOOR.h / 2, -D / 2 + jamb / 2, metal);
		box('jamb-s', CABIN_WALL, DOOR.h, jamb, x0 + CABIN_WALL / 2, DOOR.h / 2, z1 - jamb / 2, metal);
		box('lintel', CABIN_WALL, H - DOOR.h, e, x0 + CABIN_WALL / 2, DOOR.h + (H - DOOR.h) / 2, -D / 2 + e / 2, metal);

		// Two door panels behind the jambs, sliding apart along z: the north
		// one into the room's north wall, the south one along the cabin's
		// south wall. Closed, they meet at the opening's centre.
		const zc = -D / 2 + e / 2;
		const dx = x0 + CABIN_WALL + DOOR.thick / 2 + 0.005;
		this.doors = [
			box('door-n', DOOR.thick, DOOR.h, DOOR.w / 2, dx, DOOR.h / 2, zc - DOOR.w / 4, metal),
			box('door-s', DOOR.thick, DOOR.h, DOOR.w / 2, dx, DOOR.h / 2, zc + DOOR.w / 4, metal),
		];
		for (const d of this.doors) d.userData.closedZ = d.position.z;

		// Light in the cabin: a glowing panel in the ceiling and the lamp
		// behind it that actually lights the walls and the buttons.
		const panelLight = box('cabin-light', e * 0.5, 0.005, e * 0.5, this.origin.x, H - 0.025, this.origin.z, lightPanel);
		panelLight.castShadow = false;
		const lamp = new THREE.PointLight(0xfff4e6, 5, 3.5, 2);
		lamp.name = 'cabin-lamp';
		lamp.position.set(this.origin.x, H - 0.15, this.origin.z);
		g.add(lamp);

		// The panel on the south wall's inner face, beside the door, between
		// hand and eye height and tilted up toward the eye like a sloped desk
		// (Uli): the buttons side by side in rows of eight, read row by row,
		// the newest room top left, a split year's halves next to each other.
		const n = rooms().length, cols = PANEL.cols, rows = Math.ceil(n / cols);
		const plateW = cols * BUTTON.pitch + 0.03, plateH = rows * BUTTON.pitch + 0.03;
		const panel = new THREE.Group();
		panel.name = 'panel';
		panel.position.set(ix0 + 0.10 + plateW / 2, (PANEL.low + PANEL.high) / 2, iz1 - 0.012);
		panel.rotation.x = PANEL.tilt;                 // faces turn up toward the eye
		g.add(panel);
		const plate = new THREE.Mesh(new THREE.BoxGeometry(plateW, plateH, 0.024), panelPlate);
		plate.name = 'plate';
		plate.castShadow = plate.receiveShadow = true;
		panel.add(plate);

		this.buttons = [];
		const body = new THREE.CylinderGeometry(BUTTON.r, BUTTON.r, BUTTON.rise, 32);
		body.rotateX(Math.PI / 2);                     // axis along z
		const faceGeo = new THREE.CircleGeometry(BUTTON.r * 0.92, 32);
		rooms().forEach((room, i) => {
			const col = i % cols, row = Math.floor(i / cols);
			const x = -plateW / 2 + 0.015 + BUTTON.pitch * (col + 0.5);
			const y =  plateH / 2 - 0.015 - BUTTON.pitch * (row + 0.5);
			const z = -0.012 - BUTTON.rise / 2;        // proud of the plate's front (-z)
			const b = new THREE.Mesh(body, metal);
			b.name = `button-${room.key}`;
			b.userData.key = room.key;
			b.position.set(x, y, z);
			panel.add(b);
			// The printed face: a flat disc on the button's front, turned to
			// face into the cabin (-z) so the year reads upright.
			const face = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({ map: buttonFace(room), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 }));
			face.name = `face-${room.key}`;
			face.userData.key = room.key;
			face.position.set(x, y, z - BUTTON.rise / 2 - 0.0005);
			face.rotation.y = Math.PI;
			panel.add(face);
			b.userData.face = face;
			this.buttons.push(b, face);                // both press
		});
		this.group = g;
		return g;
	},

	light(key) {
		for (const b of this.buttons) {
			if (!b.userData.face) continue;                 // faces are handled through their button
			const m = b.userData.face.material;
			const on = b.userData.key === key;
			m.emissiveIntensity = on ? 0.5 : 0;
			m.emissiveMap = on ? m.map : null;
			m.needsUpdate = true;
		}
	},

	// Doors: 0 closed, 1 open.
	setDoors(open) {
		const [n, s] = this.doors;
		n.position.z = n.userData.closedZ - open * DOOR.w / 2;
		s.position.z = s.userData.closedZ + open * DOOR.w / 2;
	},

	go(key) {
		if (this.ride || key === state.roomKey) return;
		this.ride = { key, t0: performance.now(), hung: false };
		placeBody(this.origin.x, this.origin.z, Math.PI / 2);   // into the cabin, facing the doors
	},

	// Called every frame. Half a second closing; the swap behind closed
	// doors; then the doors stay shut until every print of the new room has
	// its picture and the shaders are built (Uli: no switching to be seen);
	// half a second opening.
	step(now) {
		if (!this.ride) return;
		const r = this.ride;
		const t = (now - r.t0) / 1000;
		if (t < 0.5) { this.setDoors(1 - t / 0.5); return; }
		if (!r.hung) {
			hangRoom(r.key);                       // may rebuild the room and this cabin
			placeBody(this.origin.x, this.origin.z, Math.PI / 2);
			this.setDoors(0);
			renderer.compile(scene, camera);
			r.hung = true;
			r.photos = roomByKey(r.key).specs.flatMap(sp => sp.photos);
			return;
		}
		if (!r.ready) {
			const loaded = r.photos.every(p => textureCache.get(p.n)?.image);
			if (!loaded && t < 8) return;          // wait; but never lock a visitor in
			r.ready = true;
			r.tOpen = now;
			return;
		}
		const o = (now - r.tOpen) / 500;
		if (o < 1) { this.setDoors(o); return; }
		this.setDoors(1);
		this.ride = null;
	},
};

// Picking a button: a ray from the pointer while it is free, from the
// middle of the view while it is taken.
const raycaster = new THREE.Raycaster();
function pressAt(ndcX, ndcY) {
	if (!elevator.buttons.length) return false;
	raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
	return pressAlong(raycaster, 1.6);
}
function pressAlong(rc, reach) {
	const hit = rc.intersectObjects(elevator.buttons, false)[0];
	if (!hit || hit.distance > reach) return false;
	elevator.go(hit.object.userData.key);
	return true;
}

// The bench's overlay: Y lists the floors.
const floors = document.getElementById('floors');
function renderFloors() {
	floors.innerHTML = rooms().map(r =>
		`<button data-key="${r.key}"${r.key === state.roomKey ? ' aria-current="true"' : ''}>${r.years.length > 1 ? `${r.years[0]}<small>\u2013${r.years[r.years.length - 1]}</small>` : r.year}${r.of > 1 ? `<small>${r.part}/${r.of}</small>` : ''}</button>`).join('');
}
floors.addEventListener('click', e => {
	const b = e.target.closest('button');
	if (!b) return;
	floors.hidden = true;
	elevator.go(b.dataset.key);
});
addEventListener('keydown', e => {
	if (e.code === 'KeyY') { floors.hidden = !floors.hidden; if (!floors.hidden) renderFloors(); }
	if (e.code === 'Escape') floors.hidden = true;
});

// ---------------------------------------------------------------------------
// The switchboard
//
// The settings, and what each one does when it changes. Light and frame
// and mat colour touch shared materials and are instant; mat 'none', the
// scale and the room's size change what hangs and rehang. On the bench
// the board is a small DOM panel, S toggles it; in VR (phase 2) it is a
// panel on the wall beside the elevator with the same controls.

function saveSettings() {
	try { localStorage.setItem('galleryS', JSON.stringify(state.settings)); } catch (e) {}
}

function rehang() {
	roomList = null;                         // sizes may have changed which years split
	const wanted = state.roomKey;
	const key = rooms().some(r => r.key === wanted) ? wanted : rooms().find(r => r.year === state.year)?.key || rooms()[0].key;
	state.room = null;                       // force the room and the cabin to rebuild
	hangRoom(key);
	elevator.setDoors(1);
}

function setSetting(k, v) {
	const s = state.settings;
	if (s[k] === v) return;
	s[k] = v;
	saveSettings();
	switch (k) {
		case 'dark':   applyMode(v); break;
		case 'frame':  materials.frame.color.setHex(FRAME_COLOURS[v]); break;
		case 'labels': scene.traverse(o => { if (o.name === 'label') o.visible = v; }); break;
		case 'mat':
			materials.mat.color.setHex(MAT_COLOURS[v]);
			rehang();                         // 'none' and back change the print's size
			break;
		default: rehang();                    // scale, W, D, H
	}
	renderBoard();
}

const board = document.getElementById('board');
function renderBoard() {
	const s = state.settings;
	const opt = (name, values, labels = values) => values.map((v, i) =>
		`<button data-k="${name}" data-v="${v}" aria-pressed="${String(s[name]) === String(v)}">${labels[i]}</button>`).join('');
	board.innerHTML = `
		<div class="row"><span>light</span>${opt('dark', [false, true], ['day', 'night'])}</div>
		<div class="row"><span>frame</span>${opt('frame', ['oak', 'walnut', 'black', 'white'])}</div>
		<div class="row"><span>mat</span>${opt('mat', ['white', 'warm', 'none'])}</div>
		<div class="row"><span>scale</span>${opt('scale', [1, 0.8], ['100 %', '80 %'])}</div>
		<div class="row"><span>labels</span>${opt('labels', [true, false], ['on', 'off'])}</div>
		<div class="row"><span>room</span>
			<label>W <input data-k="W" type="number" min="3" max="40" step="0.5" value="${s.W}"></label>
			<label>D <input data-k="D" type="number" min="3" max="40" step="0.5" value="${s.D}"></label>
			<label>H <input data-k="H" type="number" min="2.4" max="6" step="0.1" value="${s.H}"></label>
		</div>`;
}
board.addEventListener('click', e => {
	const b = e.target.closest('button[data-k]');
	if (!b) return;
	const k = b.dataset.k, raw = b.dataset.v;
	const v = raw === 'true' ? true : raw === 'false' ? false : isNaN(Number(raw)) ? raw : Number(raw);
	setSetting(k, v);
});
board.addEventListener('change', e => {
	const i = e.target.closest('input[data-k]');
	if (!i) return;
	const v = Number(i.value);
	if (v >= Number(i.min) && v <= Number(i.max)) setSetting(i.dataset.k, v);
});
addEventListener('keydown', e => {
	if (e.code === 'KeyS' && !walk.locked()) { board.hidden = !board.hidden; if (!board.hidden) renderBoard(); }
});

// ---------------------------------------------------------------------------
// Walking (the bench)
//
// First person on the desktop: a click takes the pointer, the mouse turns
// the head, W A S D or the arrows walk at eye height, Esc gives the pointer
// back. The camera's yaw and pitch are kept here as numbers and applied
// each frame, which keeps the horizon level (no roll creeping in). Clamped
// to the room less WALL_KEEP, so you can lean close to a frame but not
// through the plaster.

const WALK_SPEED = 1.6;         // m/s, a gallery pace
const LOOK_SPEED = 0.0022;      // radians per pixel
const PITCH_MAX = Math.PI * 80 / 180;
const WALL_KEEP = 0.3;

const KNEEL = 0.9;              // eye height kneeling, for the low prints of a grid

const walk = {
	pos: camera.position,        // the same vector; there is one truth
	yaw: 0, pitch: 0,
	eye: EYE,                    // where the eye is heading: EYE or KNEEL
	keys: new Set(),
	lockedForTest: false,        // harness-only: pretend the pointer is taken
	locked() { return this.lockedForTest || document.pointerLockElement === renderer.domElement; },
};

renderer.domElement.addEventListener('click', e => {
	if (walk.locked()) { pressAt(0, 0); return; }
	// a button under the pointer is pressed; anywhere else takes the pointer
	if (pressAt((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)) return;
	renderer.domElement.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
	document.body.classList.toggle('locked', walk.locked());
});

addEventListener('mousemove', e => {
	if (!walk.locked()) return;
	walk.yaw   -= e.movementX * LOOK_SPEED;
	walk.pitch -= e.movementY * LOOK_SPEED;
	walk.pitch  = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, walk.pitch));
});

const KEYS = {
	KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back',
	KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};
addEventListener('keydown', e => {
	if (KEYS[e.code]) { walk.keys.add(KEYS[e.code]); e.preventDefault(); }
	if (e.code === 'KeyV' && !e.repeat) walk.eye = walk.eye === EYE ? KNEEL : EYE;   // kneel / stand
});
addEventListener('keyup',   e => { if (KEYS[e.code]) walk.keys.delete(KEYS[e.code]); });
addEventListener('blur',    () => walk.keys.clear());

// Set the camera from yaw and pitch: yaw about the world's up, then pitch
// about the camera's own right. Yaw 0 looks north (-z).
function applyLook() {
	camera.rotation.set(0, 0, 0);
	camera.rotateY(walk.yaw);
	camera.rotateX(walk.pitch);
}

// Put the body at a spot on the floor, facing a yaw. On the bench that is
// the camera; in VR the rig moves so that the head lands there.
function placeBody(x, z, yaw) {
	if (renderer.xr.isPresenting) {
		rig.rotation.y = yaw;
		rig.position.set(0, 0, 0);
		rig.updateMatrixWorld(true);
		const h = head();
		rig.position.set(x - h.x, 0, z - h.z);
	} else {
		walk.pos.set(x, walk.pos.y, z);
		walk.yaw = yaw; walk.pitch = 0;
	}
}

function clampToRoom(v) {
	const { W, D } = state.room || state.settings;
	v.x = Math.max(-W / 2 + WALL_KEEP, Math.min(W / 2 - WALL_KEEP, v.x));
	v.z = Math.max(-D / 2 + WALL_KEEP, Math.min(D / 2 - WALL_KEEP, v.z));
	return v;
}

let lastT = performance.now();
function stepWalk(now) {
	// never more than a twentieth of a second, never backwards
	const dt = Math.max(0, Math.min(0.05, (now - lastT) / 1000));
	lastT = now;
	if (renderer.xr.isPresenting) { stepXR(dt); return; }
	const k = walk.keys;
	let fwd = (k.has('fwd') ? 1 : 0) - (k.has('back') ? 1 : 0);
	let side = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0);
	if (fwd || side) {
		const len = Math.hypot(fwd, side);
		fwd /= len; side /= len;
		// forward is where the yaw points on the floor; right is 90° clockwise
		const dx = (-Math.sin(walk.yaw) * fwd + Math.cos(walk.yaw) * side) * WALK_SPEED * dt;
		const dz = (-Math.cos(walk.yaw) * fwd - Math.sin(walk.yaw) * side) * WALK_SPEED * dt;
		const { W, D } = state.room || state.settings;
		walk.pos.x = Math.max(-W / 2 + WALL_KEEP, Math.min(W / 2 - WALL_KEEP, walk.pos.x + dx));
		walk.pos.z = Math.max(-D / 2 + WALL_KEEP, Math.min(D / 2 - WALL_KEEP, walk.pos.z + dz));
	}
	// kneel or rise over a third of a second
	walk.pos.y += (walk.eye - walk.pos.y) * Math.min(1, dt * 9);
	if (Math.abs(walk.eye - walk.pos.y) < 0.002) walk.pos.y = walk.eye;
	applyLook();
}

// ---------------------------------------------------------------------------
// VR (phase 2, first step)
//
// Where the browser says it can do immersive-vr — the Quest — a button
// offers it. In the headset you stand where the bench's camera stood, at
// real floor height; the left thumbstick walks, the right snap-turns; a
// controller's trigger presses the lift button it points at. Nothing else
// of the bench (mouse, keys, the DOM panels) applies in there.

const vrButton = document.getElementById('vr');
const SNAP = Math.PI / 6;           // a snap turn, 30 degrees
const XR_SPEED = 1.4;               // m/s on the stick
const controllers = [0, 1].map(i => {
	const c = renderer.xr.getController(i);
	c.userData.turned = false;
	c.addEventListener('selectstart', () => {
		const rc = new THREE.Raycaster();
		const origin = c.getWorldPosition(new THREE.Vector3());
		const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(c.getWorldQuaternion(new THREE.Quaternion()));
		rc.set(origin, dir);
		pressAlong(rc, 3);
	});
	// a thin ray so you see what you point at
	const ray = new THREE.Line(
		new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
		new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
	ray.scale.z = 2;
	c.add(ray);
	rig.add(c);
	return c;
});

async function offerVR() {
	if (!navigator.xr || !vrButton) return;
	let ok = false;
	try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch (e) {}
	if (!ok) return;
	vrButton.hidden = false;
	vrButton.addEventListener('click', async () => {
		try {
			const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
			session.addEventListener('end', () => { vrButton.hidden = false; document.body.classList.remove('xr'); rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); });
			await renderer.xr.setSession(session);
			document.body.classList.add('xr');
			vrButton.hidden = true;
			// stand where the bench stood, facing the same way
			const x = walk.pos.x, z = walk.pos.z, yaw = walk.yaw;
			walk.pos.set(0, 0, 0); walk.pitch = 0; camera.rotation.set(0, 0, 0);
			placeBody(x, z, yaw);
		} catch (e) { console.warn('VR session refused', e); }
	});
}
offerVR();

const move = new THREE.Vector3();
function stepXR(dt) {
	const session = renderer.xr.getSession();
	if (!session) return;
	for (const src of session.inputSources) {
		const g = src.gamepad;
		if (!g || g.axes.length < 4) continue;
		const x = g.axes[2], y = g.axes[3];      // the thumbstick on a Quest touch controller
		if (src.handedness === 'left') {
			if (Math.abs(x) < 0.15 && Math.abs(y) < 0.15) continue;
			// walk where the head looks, on the floor
			const q = camera.getWorldQuaternion(new THREE.Quaternion());
			const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q); fwd.y = 0; fwd.normalize();
			const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q); right.y = 0; right.normalize();
			move.copy(fwd).multiplyScalar(-y).addScaledVector(right, x).multiplyScalar(XR_SPEED * dt);
			const h = head();
			const target = clampToRoom(new THREE.Vector3(h.x + move.x, 0, h.z + move.z));
			rig.position.x += target.x - h.x;
			rig.position.z += target.z - h.z;
		} else if (src.handedness === 'right') {
			// snap turn about the head, once per push of the stick
			const c = controllers[1];
			if (Math.abs(x) > 0.7) {
				if (!c.userData.turned) {
					c.userData.turned = true;
					const h = head();
					const a = x > 0 ? -SNAP : SNAP;
					rig.rotation.y += a;
					rig.updateMatrixWorld(true);
					const h2 = head();
					rig.position.x += h.x - h2.x;
					rig.position.z += h.z - h2.z;
				}
			} else c.userData.turned = false;
		}
	}
}

// ---------------------------------------------------------------------------
// Boot

fetch('/photos.json', { cache: 'no-cache' })   // root-absolute: the page lives at /gallery/
	.then(r => r.json())
	.then(d => { state.photos = d.photos; init(); });

function init() {
	hangRoom(rooms()[0].key);    // the newest room; builds the room around it

	// Arrival: you have just stepped out of the elevator, facing down the room.
	walk.pos.set(elevator.origin.x - ELEVATOR.size, EYE, elevator.origin.z);
	walk.yaw = Math.PI / 2; walk.pitch = 0;
	elevator.setDoors(1);
	applyLook();
}

renderer.setAnimationLoop(now => {
	elevator.step(now);
	stepWalk(now);
	stepShadows();
	renderer.render(scene, camera);
});

// Test-harness handle only: the plan's browser checks read the scene graph
// and camera through this. Nothing on the page uses it.
window.G = { scene, camera, renderer, state, buildRoom, applyMode, makePiece, rooms, hangRoom, walk, stepWalk, stepShadows, elevator, pressAt, setSetting, materials, rig, placeBody };
