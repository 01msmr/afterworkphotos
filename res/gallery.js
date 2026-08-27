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

// settings.W/D is the smallest room; room.W/D is the one standing, which a
// crowded year may have grown (see hangYear).
const state = { year: null, roomKey: null, settings: { ...DEFAULTS }, room: null, photos: [] };

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

	const printed = size * PRINT_SCALE;
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
	return spec.cols * framedSize(spec.size) + (spec.cols - 1) * GRID_GAP;
}

// Lay pieces into a room of W × D: gallery spacing first; when the walls
// run out, the spacing tightens; then the middle of the room takes the
// rest. Returns the placements and whatever still did not fit.
function layout(items, W, D) {
	let gap = GAP, walls, middle;
	for (;;) {
		walls = layWalls(items, W, D, gap);
		middle = layMiddle(walls.rest, W, D, gap);
		if (!middle.rest.length || gap <= GAP_MIN) break;
		gap = Math.max(GAP_MIN, gap - 0.1);
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
		.map(p => ({ p, d: p.position.distanceToSquared(camera.position) }))
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
	roomList = [];
	for (const [year, photos] of byYear) {
		const specs = piecesOf(photos).map(s => ({ ...s, w: specWidth(s) }));
		const one = shapeOf(year);
		if (!layout([...specs].reverse(), one.W, one.D).rest.length) {
			roomList.push({ key: year, year, part: 0, of: 1, specs, shape: one, look: lookOf(year) });
			continue;
		}
		const half = Math.ceil(specs.length / 2);
		for (const [part, slice] of [[1, specs.slice(0, half)], [2, specs.slice(half)]]) {
			const key = `${year}-${part}`;
			roomList.push({ key, year, part, of: 2, specs: slice, shape: shapeOf(key), look: lookOf(key) });
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
	if (room.of === 1) {
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
		// into the cabin, facing the doors
		walk.pos.set(this.origin.x, walk.pos.y, this.origin.z);
		walk.yaw = Math.PI / 2; walk.pitch = 0;
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
			walk.pos.set(this.origin.x, walk.pos.y, this.origin.z);
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
	const hit = raycaster.intersectObjects(elevator.buttons, false)[0];
	if (!hit || hit.distance > 1.6) return false;
	elevator.go(hit.object.userData.key);
	return true;
}

// The bench's overlay: Y lists the floors.
const floors = document.getElementById('floors');
function renderFloors() {
	floors.innerHTML = rooms().map(r =>
		`<button data-key="${r.key}"${r.key === state.roomKey ? ' aria-current="true"' : ''}>${r.year}${r.of > 1 ? `<small>${r.part}/${r.of}</small>` : ''}</button>`).join('');
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

let lastT = performance.now();
function stepWalk(now) {
	// never more than a twentieth of a second, never backwards
	const dt = Math.max(0, Math.min(0.05, (now - lastT) / 1000));
	lastT = now;
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
// Boot

fetch('photos.json', { cache: 'no-cache' })
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
window.G = { scene, camera, renderer, state, buildRoom, applyMode, makePiece, rooms, hangRoom, walk, stepWalk, stepShadows, elevator, pressAt };
