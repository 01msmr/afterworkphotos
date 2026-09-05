// three.js 0.180.0, vendored (MIT) — res/vendor/three.module.js, which in
// turn imports res/vendor/three.core.js; both are pinned together.
import * as THREE from './vendor/three.module.js';

// ---------------------------------------------------------------------------
// State and settings
//
// Room defaults from the spec: 6 × 4 × 3 m. The eye stands at 1.6 m, frames
// centre at 1.5 m. Light mode is the white cube; dark mode is the same room
// at night, ambient almost off, the spots alone.

const DEFAULTS = { W: 6, D: 4, H: 3, dark: false, frame: 'maple', mat: 'white', scale: 1, labels: true };

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
const FRAME_COLOURS_KEYS = { maple: 1, oak: 1, walnut: 1, black: 1, white: 1 };

// settings.W/D is the smallest room; room.W/D is the one standing, which a
// crowded year may have grown (see hangYear).
const state = { year: null, roomKey: null, settings: loadSettings(), room: null, real: null, photos: [], obstacles: [] };   // obstacles: the middle rows' footprints, for the bench's walk

const EYE = 1.6;
const HANG_Y = 1.5;   // every piece's centre, the gallery's line

// ---------------------------------------------------------------------------
// Renderer, scene, camera

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = false;               // no cast shadows (Uli, 2026-09-05): the hard cut-outs looked wrong; the meshes keep their flags should they come back
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(66, 1, 0.05, 100);
// Everything built — room, pieces, lift — lives in `world`; the rig
// (the body) does not. A real room (phase 3) moves and turns `world` so
// its walls land on the real ones, while the body stays where it is.
const world = new THREE.Group();
world.name = 'world';
scene.add(world);
const rig = new THREE.Group();     // the body: on the bench at the origin, in VR the thing that walks
rig.name = 'rig';
rig.add(camera);
scene.add(rig);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');   // switched to bounded-floor at session start when the Quest has a boundary
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

// The floor of a room is its year's, and stays it, so a year is remembered
// by what one stands on (Uli, 2026-09-05): the entry floor a grey lacquer,
// every other year a texture of its own — ambientCG sets in res/textures
// (see LICENSE.txt there). `metres` is what one tile of the texture covers
// on the floor; the metals carry a metalness map. A year not in the table
// takes a spare, in turn.
const FLOORS = {
	lacquer:         { colour: { light: 0x6e6f71, dark: 0x2a2a2c }, roughness: 0.25 },
	warehouse:       { metres: 2 },        // worn planks, knots and nail holes
	'planks-dark':   { metres: 2 },        // the darker old planks
	checker:         { metres: 1, metal: true },   // diamond plate
	plates:          { metres: 1, metal: true },   // flat brushed plates
	herringbone:     { metres: 1.5 },
	basket:          { metres: 1.5 },      // basket parquet
	concrete:        { metres: 2 },        // polished, light
	'concrete-dark': { metres: 2 },
	terrazzo:        { metres: 1 },        // antique
	'terrazzo-grey': { metres: 1 },
	marble:          { metres: 1.5 },      // grey, polished
	'marble-tiles':  { metres: 1 },
	checkered:       { metres: 1 },        // cream and black shop tiles
	rubber:          { metres: 1 },        // studded gym floor
};
const FLOOR_OF_YEAR = {
	2026: 'lacquer', 2025: 'herringbone', 2024: 'concrete', 2023: 'warehouse', 2022: 'terrazzo', 2021: 'checker',
	2020: 'marble', 2019: 'basket', 2018: 'checkered', 2017: 'concrete-dark', 2016: 'planks-dark', 2015: 'terrazzo-grey',
	2009: 'marble-tiles',                  // the merged thin years, 2009–2014
};
const SPARE_FLOORS = ['plates', 'rubber'];
function floorOf(year) { return FLOOR_OF_YEAR[year] || SPARE_FLOORS[Number(year) % SPARE_FLOORS.length]; }

// The floor's material: the lacquer is a colour with the room mirrored
// softly in it; a textured floor repeats its tile every `metres`. In dark
// mode the texture is dimmed through the material's colour (applyMode).
function floorMaterial(slug, W, D) {
	const f = FLOORS[slug];
	if (!f.metres) return { material: new THREE.MeshStandardMaterial({ color: f.colour.light, roughness: f.roughness, metalness: 0, envMapIntensity: 1 }), colours: f.colour };
	const t = kind => tex(`floor-${slug}-${kind}.jpg`, kind === 'color', D / f.metres, W / f.metres);
	const material = new THREE.MeshStandardMaterial({
		map: t('color'), roughnessMap: t('rough'), normalMap: t('normal'), normalScale: new THREE.Vector2(0.7, 0.7),
		metalnessMap: f.metal ? t('metalness') : null, metalness: f.metal ? 1 : 0, roughness: 1, envMapIntensity: f.metal ? 0.5 : 0.35,
	});
	return { material, colours: { light: 0xffffff, dark: 0x4a4a4a } };
}
function shapeOf(key) {
	if (state.real) return { W: state.real.W, D: state.real.D };     // a real room is the room, for every year
	const [fw, fd] = SHAPES[(hashKey(key) >>> 3) % SHAPES.length];   // unsigned shift: a signed one can go negative
	const r = v => Math.round(v * 2) / 2;                 // to the half metre
	return { W: r(state.settings.W * fw), D: r(state.settings.D * fd) };
}

// A Lambert wall gets the ambient and the hemisphere fill over π, so an
// off-white wall needs about three units of the two together to render
// near its paint: with these it stands at its paint by day (Uli,
// 2026-09-05: the walls had read mid-grey), never blown white.
const AMBIENT = { light: 1.9,  dark: 0.08 };
const FILL    = { light: 1.4,  dark: 0.06 };

function buildRoom(W, D, H, look = LOOKS[0], floor = 'lacquer') {
	const room = new THREE.Group();
	room.name = 'room';
	room.userData.look = look.name;

	const mode = state.settings.dark ? 'dark' : 'light';
	const COLOURS = { wall: look.wall, floor: look.floor, ceiling: CEILING };
	const mat = key => new THREE.MeshLambertMaterial({ color: COLOURS[key][mode] });

	// Each surface: a plane sized to its span, rotated to face the room's
	// inside, positioned on the boundary. PlaneGeometry lies in xy facing +z.
	const surface = (name, key, w, h, pos, rot, material = mat(key), colours = COLOURS[key]) => {
		const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
		m.name = name;
		m.position.set(...pos);
		m.rotation.set(...rot);
		m.receiveShadow = true;
		m.userData.surface = key;
		m.userData.colours = colours;
		m.material.color.setHex(colours[mode]);
		room.add(m);
	};

	const fl = floorMaterial(floor, W, D);
	surface('floor',   'floor',   W, D, [0, 0, 0],       [-Math.PI / 2, 0, 0], fl.material, fl.colours);
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
	const fill = new THREE.HemisphereLight(0xfffaf2, 0xa8a49e, FILL[mode]);   // a light neutral ground, so no wall goes yellow-grey
	fill.name = 'fill';
	fill.position.set(0, H, 0);
	room.add(fill);

	// The key light: a warm directional from high in the middle of the
	// room, a little forward. It cast the room's one shadow map until the
	// shadows went (renderer.shadowMap above); its set-up stays for that.
	const sun = new THREE.DirectionalLight(0xfff2e0, mode === 'dark' ? 0.9 : 1.1);
	sun.name = 'sun';
	sun.position.set(0.15, H + 2, 0.1);          // all but overhead: the walls share the fills alike, the floor takes the sun
	sun.target.position.set(0, 0, 0);
	sun.castShadow = renderer.shadowMap.enabled;
	const half = Math.max(W, D) / 2 + 0.5;
	Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 0.5, far: H + 6 });
	sun.shadow.mapSize.set(renderer.xr.isPresenting ? 1024 : 2048, renderer.xr.isPresenting ? 1024 : 2048);
	sun.shadow.bias = -0.0006;
	sun.shadow.normalBias = 0.01;
	room.add(sun, sun.target);

	return room;
}

// Switch between the white cube and the room at night without rebuilding:
// every surface remembers which colour family it belongs to. The switch
// is a fade (Uli): `modeF` runs from 0 (day) to 1 (night) over MODE_T,
// stepped every frame, and everything the mode touches — the surfaces'
// colours, the fills, the sun, the cabin's lamp and light panel — is set
// from it.
const MODE_T = 1200;
let modeF = state.settings.dark ? 1 : 0, modeAt = null;
function applyMode(dark) {
	state.settings.dark = dark;
	modeAt = performance.now();
}
const _ca = new THREE.Color(), _cb = new THREE.Color();
function applyModeF(f) {
	const mix = (a, b) => a + (b - a) * f;
	const room = scene.getObjectByName('room');
	if (room) room.traverse(o => {
		if (o.isMesh && o.userData.colours) o.material.color.copy(_ca.setHex(o.userData.colours.light).lerp(_cb.setHex(o.userData.colours.dark), f));
		if (o.isAmbientLight) o.intensity = mix(AMBIENT.light, AMBIENT.dark);
		if (o.isHemisphereLight) o.intensity = mix(FILL.light, FILL.dark);
		if (o.isDirectionalLight) o.intensity = mix(1.1, 0.9);
	});
	const lamp = scene.getObjectByName('cabin-lamp');
	if (lamp) lamp.intensity = mix(CABIN_LAMP.light, CABIN_LAMP.dark);
	lightPanel.emissiveIntensity = mix(CABIN_PANEL.light, CABIN_PANEL.dark);
}
function stepMode(now) {
	const target = state.settings.dark ? 1 : 0;
	if (modeF === target) { modeAt = null; return; }
	const dt = modeAt === null ? MODE_T : now - modeAt;
	modeAt = now;
	modeF = target > modeF ? Math.min(target, modeF + dt / MODE_T) : Math.max(target, modeF - dt / MODE_T);
	applyModeF(modeF);
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

const FRAME = { face: 0.03, depth: 0.03, chamfer: 0.0015 };   // a square section (Uli), a 1.5 mm chamfer on the long edges
const MAT = { 0.9: 0.09, 0.6: 0.06, 0.4: 0.045 };     // mat width per nominal print size: the spec's 6/4/3 plus half (Uli)
const MAT_Z = 0.014;                                   // the mat 14 mm off the wall: 8 mm further forward (Uli)
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
// Photographed textures (ambientCG, CC0 — res/textures/LICENSE.txt): a
// light oak and a dark hardwood for the frames, a clean shiny steel for
// the lift. Each is colour, roughness and normal; the metal has its
// metalness too. The frame bars' UVs are in metres (ExtrudeGeometry), so
// a tile every half metre; the cabin's boxes stretch one tile per face.
const texLoader = new THREE.TextureLoader();
function tex(file, srgb, repeat, along = repeat) {
	const t = texLoader.load('/res/textures/' + file, loaded => renderer.initTexture(loaded));   // to the GPU as it arrives
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	// the bars' u runs their length and the images' grain runs their x, so
	// no turn: grain along the bar (Uli), stretched by `along`
	t.repeat.set(along, repeat);
	t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
	if (srgb) t.colorSpace = THREE.SRGBColorSpace;
	return t;
}
// stretched one and a half times along the bar, so the grain runs calmer (Uli)
const woodSet = n => ({ map: tex(`wood-${n}-color.jpg`, true, 2, 2 / 1.5), roughnessMap: tex(`wood-${n}-rough.jpg`, false, 2, 2 / 1.5), normalMap: tex(`wood-${n}-normal.jpg`, false, 2, 2 / 1.5) });
const WOOD = { maple: woodSet('maple'), light: woodSet('light'), dark: woodSet('dark') };
// The frame colours as a wood and a tint over it: oak and walnut are the
// woods themselves; black and white are the light wood stained.
const FRAME_LOOKS = {
	maple:  { wood: 'maple', tint: 0xffffff },
	oak:    { wood: 'light', tint: 0xffffff },
	walnut: { wood: 'dark',  tint: 0xffffff },
	black:  { wood: 'light', tint: 0x2a2724 },
	white:  { wood: 'light', tint: 0xf6f3ec },
};
function applyFrameLook(m, name) {
	const look = FRAME_LOOKS[name] || FRAME_LOOKS.oak, w = WOOD[look.wood];
	m.map = w.map; m.roughnessMap = w.roughnessMap; m.normalMap = w.normalMap;
	m.color.setHex(look.tint);
	m.needsUpdate = true;
}

// Something to reflect: a small gradient cube — bright ceiling, grey
// walls, dark floor — run through PMREM as the scene's environment, so
// the steel shines and the varnish on the wood catches a highlight.
function makeEnvironment() {
	const faces = [];
	for (let i = 0; i < 6; i++) {
		const c = document.createElement('canvas'); c.width = c.height = 32;
		const g = c.getContext('2d');
		const grad = g.createLinearGradient(0, 0, 0, 32);
		if (i === 2)      { grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#f4f2ee'); }   // +y: the lit ceiling
		else if (i === 3) { grad.addColorStop(0, '#5a5854'); grad.addColorStop(1, '#3a3936'); }   // -y: the floor
		else              { grad.addColorStop(0, '#f2f1ee'); grad.addColorStop(1, '#8c8a85'); }   // walls: light above, darker below
		g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
		faces.push(c);
	}
	const cube = new THREE.CubeTexture(faces);
	cube.colorSpace = THREE.SRGBColorSpace;
	cube.needsUpdate = true;
	const pmrem = new THREE.PMREMGenerator(renderer);
	const env = pmrem.fromCubemap(cube).texture;
	pmrem.dispose();
	return env;
}
scene.environment = makeEnvironment();
scene.environmentIntensity = 0.6;

// The warm pool a spot would throw on the wall around a piece, as a
// decal: one radial gradient, additive, no lighting cost. Lets the
// room read "lit per piece" with four lights in the whole scene.
function poolTexture() {
	const c = document.createElement('canvas'); c.width = c.height = 128;
	const g = c.getContext('2d');
	const grad = g.createRadialGradient(64, 56, 4, 64, 64, 64);
	grad.addColorStop(0, 'rgba(255,238,210,0.55)');
	grad.addColorStop(0.55, 'rgba(255,238,210,0.18)');
	grad.addColorStop(1, 'rgba(255,238,210,0)');
	g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
	const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const poolMaterial = new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

// A wood's colour map faded toward a flat colour: the image drawn on a
// canvas and the colour laid over it at `fade`. Blank until the image is in.
function fadedWood(file, colour, fade) {
	const c = document.createElement('canvas'); c.width = c.height = 512;
	const g = c.getContext('2d');
	g.fillStyle = colour; g.fillRect(0, 0, 512, 512);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	const img = new Image();
	img.onload = () => { g.globalAlpha = 1; g.drawImage(img, 0, 0, 512, 512); g.globalAlpha = fade; g.fillRect(0, 0, 512, 512); t.needsUpdate = true; };
	img.src = '/res/textures/' + file;
	return t;
}

const materials = {
	frame: new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 0.5 }),
	mat:   new THREE.MeshLambertMaterial({ color: MAT_COLOURS[state.settings.mat] }),
	rim:   new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
	line:  new THREE.MeshBasicMaterial({ color: 0xe8e4dc, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
	back:  new THREE.MeshLambertMaterial({ map: fadedWood('wood-maple-color.jpg', '#d6c6a4', 0.6) }),   // the cheap pale board closing a frame's back: the grain faded 60 % into a flat colour (Uli)
};

applyFrameLook(materials.frame, state.settings.frame);

const textures = new THREE.TextureLoader();
const textureCache = new Map();
// A print's texture at the size its print needs: the 1600 px file
// (img/1600, the gallery's own set — the main page never loads it) for a
// 90, the 1000 px file for a 60, shrunk to 512 px on a canvas for a 40
// in a grid (a quarter of the memory). A photo without a 1600 (an old
// one, a video's still) falls back to its 1000. The texture's image
// stays empty until loaded, which is what the lift waits for. Textures
// of a room you have left are freed.
const PHOTO_PX = { 0.9: 1600, 0.6: 1000, 0.4: 512 };
const hdFile = p => 'img/1600/' + p.file.slice(p.file.lastIndexOf('/') + 1);
function photoTexture(p, size) {
	const px = PHOTO_PX[size] || 1000;
	const key = `${p.n}@${px}`;
	if (!textureCache.has(key)) {
		const t = new THREE.Texture();
		t.colorSpace = THREE.SRGBColorSpace;
		t.anisotropy = 8;                        // prints seen at an angle stay sharp; the Quest 3 affords it (Uli, 2026-09-05)
		const img = new Image();
		img.onerror = () => { if (img.src.includes('/img/1600/')) img.src = '/' + p.file; };
		// decoded off the main thread, then sent to the GPU at once: each
		// print costs its frame as it arrives during the ride, not all of
		// them the frame the doors open (Uli: the view lagged a second or two)
		img.onload = () => img.decode().catch(() => {}).then(() => {
			if (px >= img.width) { t.image = img; }
			else {
				const c = document.createElement('canvas'); c.width = c.height = px;
				c.getContext('2d').drawImage(img, 0, 0, px, px);
				t.image = c;
			}
			t.needsUpdate = true;
			renderer.initTexture(t);
		});
		img.src = '/' + (px > 1000 ? hdFile(p) : p.file);   // photos.json paths are relative to the site root
		textureCache.set(key, t);
	}
	return textureCache.get(key);
}
// ---------------------------------------------------------------------------
// Videos — the LED panel
//
// A photo that is a video hangs as a panel of light in place of a print:
// a visible matrix of diodes, the video playing on it (Uli's spec). No
// frame, no mat, no glass; the panel is the size the print would have
// been. The video texture is the picture; a second texture — a grid of
// dark lines, one cell per diode — lies a hair in front, so what you see
// is a wall of diodes, not a screen.
//
// A panel plays only while it is looked at (see stepVideos): its own
// pixels are the light in the room, so a room of stills stays still.
const videoCache = new Map();     // n → { el, texture }
function videoTexture(p) {
	if (!videoCache.has(p.n)) {
		const el = document.createElement('video');
		el.src = '/' + p.video;
		el.loop = true;
		el.muted = true;                 // no sound in the gallery; the lift has the room's
		el.playsInline = true;
		el.preload = 'auto';
		el.crossOrigin = 'anonymous';
		const t = new THREE.VideoTexture(el);
		t.colorSpace = THREE.SRGBColorSpace;
		videoCache.set(p.n, { el, texture: t, playing: false });
	}
	return videoCache.get(p.n);
}
function freeVideosExcept(keep) {
	for (const [n, v] of videoCache) {
		if (keep.has(n)) continue;
		v.el.pause(); v.el.removeAttribute('src'); v.el.load();
		v.texture.dispose();
		videoCache.delete(n);
	}
}

// The diode grid: dark lines between cells, drawn once and repeated over
// the panel. LED_PITCH is a diode's size on the wall, so a 90 cm panel
// shows 90/0.9 = 100 of them across — large enough to read as diodes,
// fine enough to keep the picture.
const LED_PITCH = 0.006;          // metres per diode — 0.66 of the first try (Uli: finer)
let ledTex = null;
function ledGrid() {
	if (ledTex) return ledTex;
	const px = 16;
	const c = document.createElement('canvas'); c.width = c.height = px;
	const ctx = c.getContext('2d');
	ctx.fillStyle = '#000'; ctx.fillRect(0, 0, px, px);
	// one diode: a round-ish lit face with a dark gap around it
	ctx.globalCompositeOperation = 'destination-out';
	ctx.beginPath(); ctx.arc(px / 2, px / 2, px * 0.42, 0, Math.PI * 2); ctx.fill();
	ledTex = new THREE.CanvasTexture(c);
	ledTex.wrapS = ledTex.wrapT = THREE.RepeatWrapping;
	ledTex.colorSpace = THREE.SRGBColorSpace;
	return ledTex;
}

// A video panel, in place of makeFramedPrint for a video: the picture,
// and the diode mask over it. Its outer size is the framed print's, so a
// video hangs in the rhythm of the wall it stands in.
function makeVideoPanel(p, size) {
	const g = new THREE.Group();
	g.name = `panel-${p.n}`;
	const k = sc();
	const outer = (size + 2 * matWidth(size) + 2 * FRAME.face) * k;
	const v = videoTexture(p);

	// the panel's body is as deep as a frame is; the picture lies on its
	// front face, the diodes a hair in front of that
	const depth = FRAME.depth * k * 0.6;
	const face = new THREE.Mesh(new THREE.PlaneGeometry(outer, outer),
		new THREE.MeshBasicMaterial({ map: v.texture }));
	face.name = 'video';
	face.position.z = depth + 0.0005;
	face.userData = { n: p.n };
	g.add(face);

	// the diodes: black between them, so the picture shows through the holes
	const cells = Math.max(24, Math.round(outer / LED_PITCH));
	const grid = ledGrid().clone();
	grid.needsUpdate = true;
	grid.wrapS = grid.wrapT = THREE.RepeatWrapping;
	grid.repeat.set(cells, cells);
	const mask = new THREE.Mesh(new THREE.PlaneGeometry(outer, outer),
		new THREE.MeshBasicMaterial({ map: grid, transparent: true }));
	mask.name = 'leds';
	mask.position.z = depth + 0.001;
	g.add(mask);

	// the panel's own body, a shallow dark box behind the diodes
	const body = new THREE.Mesh(new THREE.BoxGeometry(outer, outer, depth),
		new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.7, metalness: 0.2 }));
	body.name = 'panel-body';
	body.position.z = depth / 2;
	body.castShadow = true;
	body.receiveShadow = true;
	g.add(body);

	g.userData = { n: p.n, w: outer, h: outer, video: true };
	return g;
}

function freeTexturesExcept(keep) {
	for (const [key, t] of textureCache) if (!keep.has(key)) { t.dispose(); textureCache.delete(key); }
}

// Outer edge of one framed print of a given print size.
const framedSize = size => (size + 2 * matWidth(size) + 2 * FRAME.face) * sc();

// A frame bar: a closed square section with all four long edges
// chamfered, mitred at 45 degrees at both ends so the four bars meet
// corner to corner (Uli) — no open ends to see into from the side. Built
// along x (a horizontal bar: face across y, depth along z), the mitre
// cutting each vertex's x by how far it sits from the outer edge; turned
// for a vertical bar. Sixteen triangles.
const barCache = new Map();
function barGeometry(length, face, depth, horizontal) {
	const key = `${length.toFixed(4)}|${face.toFixed(4)}|${depth.toFixed(4)}|${horizontal}`;
	if (barCache.has(key)) return barCache.get(key);
	const c = Math.min(FRAME.chamfer, face / 3), fw = face / 2, L = length / 2;
	// the section, anticlockwise seen from +x, starting at the outer back corner
	const prof = [[fw, c], [fw, depth - c], [fw - c, depth], [-fw + c, depth], [-fw, depth - c], [-fw, c], [-fw + c, 0], [fw - c, 0]];
	// the mitre: the outer edge (y = +fw) runs the full length, the inner (y = -fw) is shorter by the face
	const xEnd = (y, sign) => sign * (L - (fw - y));
	const pos = [], nor = [], uv = [];
	let v = 0;
	for (let i = 0; i < prof.length; i++) {
		const [y0, z0] = prof[i], [y1, z1] = prof[(i + 1) % prof.length];
		const len = Math.hypot(y1 - y0, z1 - z0);
		const ny = (z1 - z0) / len, nz = -(y1 - y0) / len;
		const quad = [[xEnd(y0, -1), y0, z0, 0, v], [xEnd(y0, 1), y0, z0, length, v], [xEnd(y1, 1), y1, z1, length, v + len], [xEnd(y1, -1), y1, z1, 0, v + len]];
		// wound anticlockwise seen from outside, so the faces are front faces (they were back faces: see-through from the side)
		for (const t of [[0, 2, 1], [0, 3, 2]]) for (const k of t) { const q = quad[k]; pos.push(q[0], q[1], q[2]); nor.push(0, ny, nz); uv.push(q[3], q[4]); }
		v += len;
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	if (!horizontal) g.rotateZ(Math.PI / 2);
	barCache.set(key, g);
	return g;
}

function makeFramedPrint(p, size) {
	const g = new THREE.Group();
	g.name = `print-${p.n}`;
	const k = sc();
	const face = FRAME.face * k;
	const inner = (size + 2 * matWidth(size)) * k;   // the mat board's edge = frame's inner edge
	const outer = inner + 2 * face;

	// the mat board: only its face shows, its edges are under the frame
	const board = new THREE.Mesh(new THREE.PlaneGeometry(inner, inner), materials.mat);
	board.name = 'mat';
	board.position.z = MAT_Z;
	g.add(board);
	// the backing board: hardboard closing the frame behind the mat, so a
	// frame seen from behind (a middle row's empty face, a wall walked
	// through on the bench) is a closed thing, not a hollow moulding
	const back = new THREE.Mesh(new THREE.PlaneGeometry(inner, inner), materials.back);
	back.name = 'back';
	back.position.z = 0.0005;
	back.rotation.y = Math.PI;                       // faces out of the back
	g.add(back);

	const printed = size * (state.settings.mat === 'none' ? 1 : PRINT_SCALE) * k;
	const print = new THREE.Mesh(new THREE.PlaneGeometry(printed, printed),
		new THREE.MeshBasicMaterial({ map: photoTexture(p, size) }));
	print.name = 'photo';
	print.position.z = MAT_Z + 0.001;                // a millimetre proud of the mat (Uli)
	g.add(print);
	// the shadow that millimetre throws: a faint dark rim just behind the
	// print, a hair larger and pushed down and to the right
	const rim = new THREE.Mesh(new THREE.PlaneGeometry(printed + 0.003, printed + 0.003), materials.rim);
	rim.name = 'photo-shadow';
	rim.position.set(0.0008, -0.0008, MAT_Z + 0.0004);
	g.add(rim);

	// Four bars around the board. Horizontal bars run the full outer width;
	// vertical bars fill between them — the overlap reads as a mitre from
	// any angle the viewer can take. Bars sit flush with the wall at z=0
	// and come 4 cm into the room. Their long edges carry the chamfer.
	const bar = (name, w, h, x, y) => {
		const horizontal = name === 'bar-top' || name === 'bar-bottom';
		const m = new THREE.Mesh(barGeometry(horizontal ? w : h, horizontal ? h : w, FRAME.depth * k, horizontal), materials.frame);
		m.name = name;
		m.position.set(x, y, 0);                       // the bar's back is the wall
		// built with its outer edge at +y: the bottom bar and the right bar are mirrored
		if (name === 'bar-bottom') m.scale.y = -1;
		if (name === 'bar-right') m.scale.x = -1;
		m.castShadow = true;
		m.receiveShadow = true;
		g.add(m);
	};
	// all four the full outer length, mitred at the corners
	const half = inner / 2 + face / 2;
	bar('bar-top',    outer, face, 0,  half);
	bar('bar-bottom', outer, face, 0, -half);
	bar('bar-left',   face, outer, -half, 0);
	bar('bar-right',  face, outer,  half, 0);

	g.userData = { n: p.n, w: outer, h: outer };
	return g;
}

// Two 0.5 mm lines from a piece's top corners up to the ceiling. Their
// length follows from where the piece hangs: centre at HANG_Y, ceiling at H.
function addLines(piece, w, h) {
	const drop = state.settings.H - (HANG_Y + h / 2);
	if (drop <= 0) return;
	const geo = new THREE.PlaneGeometry(0.0012, drop);   // a ribbon: at 0.6 mm no one can tell it from a thread
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
		const fp = photos[0].video ? makeVideoPanel(photos[0], size) : makeFramedPrint(photos[0], size);
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
			const fp = p.video ? makeVideoPanel(p, size) : makeFramedPrint(p, size);
			fp.position.set(-w / 2 + cell / 2 + c * (cell + gap),
			                 h / 2 - cell / 2 - r * (cell + gap), 0);
			piece.add(fp);
		});
	}

	addLines(piece, w, h);
	addLabel(piece, spec, w, h);
	// the warm pool on the wall behind, wider than the piece
	const pool = new THREE.Mesh(new THREE.PlaneGeometry(w + 1.4, h + 1.2), poolMaterial);
	pool.name = 'pool';
	pool.position.set(0, 0.1, -0.0005 + 0.0008);
	piece.add(pool);
	piece.userData = { n: photos[0].n, w, h };
	return piece;
}

// ---------------------------------------------------------------------------
// Baking a room
//
// Once a room is hung nothing in it moves until the next ride, so the
// parts that share a material — every bar, every mat, rim, line, pool —
// are welded into one mesh each, in world coordinates. What stays its
// own mesh: each print (its own texture) and each label (pressable).

const _nm = new THREE.Matrix3();
function weld(meshes, material, name) {
	const pos = [], nor = [], uv = [];
	for (const m of meshes) {
		m.updateWorldMatrix(true, false);
		const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
		const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
		// into world's own frame, not the scene's: the welded mesh is a child of world
		const rel = new THREE.Matrix4().copy(world.matrixWorld).invert().multiply(m.matrixWorld);
		_nm.getNormalMatrix(rel);
		const v = new THREE.Vector3(), n = new THREE.Vector3();
		// a mirrored mesh (negative scale) has its winding flipped: bake it back
		const flip = rel.determinant() < 0;
		for (let t = 0; t < P.count; t += 3) {
			const order = flip ? [t + 2, t + 1, t] : [t, t + 1, t + 2];
			for (const i of order) {
				v.fromBufferAttribute(P, i).applyMatrix4(rel); pos.push(v.x, v.y, v.z);
				if (N) { n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize(); nor.push(n.x, n.y, n.z); }
				if (U) uv.push(U.getX(i), U.getY(i));
			}
		}
		if (m.geometry.index) g.dispose();
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	if (nor.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
	if (uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	const mesh = new THREE.Mesh(g, material);
	mesh.name = name;
	return mesh;
}

function bakeRoom(pieces) {
	const baked = new THREE.Group(); baked.name = 'baked';
	const groups = { bars: [], mats: [], backs: [], rims: [], lines: [], pools: [] };
	pieces.traverse(o => {
		if (!o.isMesh) return;
		if (o.name.startsWith('bar-')) groups.bars.push(o);
		else if (o.name === 'mat') groups.mats.push(o);
		else if (o.name === 'back') groups.backs.push(o);
		else if (o.name === 'photo-shadow') groups.rims.push(o);
		else if (o.name === 'line') groups.lines.push(o);
		else if (o.name === 'pool') groups.pools.push(o);
	});
	const add = (list, material, name, shadow) => {
		if (!list.length) return;
		const m = weld(list, material, name);
		m.castShadow = shadow; m.receiveShadow = shadow;
		baked.add(m);
		for (const o of list) o.parent.remove(o);
	};
	add(groups.pools, poolMaterial, 'pools', false);
	add(groups.mats, materials.mat, 'mats', false);
	add(groups.backs, materials.back, 'backs', false);
	add(groups.rims, materials.rim, 'rims', false);
	add(groups.bars, materials.frame, 'frames', true);
	add(groups.lines, materials.line, 'lines', false);
	return baked;
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
	// drawn at twice the size it was (Uli: sharper), 1536 px across a 24 cm card
	const c = document.createElement('canvas');
	c.width = 1536; c.height = 2 * (80 + 64 * lines.length);
	const g = c.getContext('2d');
	g.fillStyle = '#fbfaf7'; g.fillRect(0, 0, c.width, c.height);
	g.textBaseline = 'middle';
	lines.forEach((line, i) => {
		g.fillStyle = i === 0 ? '#3a3835' : '#6b6862';
		g.font = `${i === 0 ? 500 : 400} ${i === 0 ? 80 : 72}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
		g.fillText(line, 80, 2 * (40 + 32 + 64 * i));
	});
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 8;
	const cw = 0.24, ch = cw * c.height / c.width;
	const card = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), new THREE.MeshLambertMaterial({ map: t }));
	card.name = 'label';
	// Lower right of the piece where the wall has room; when the pieces
	// hang closer than the card needs, below the frame instead (Uli), so
	// no card runs into the next frame.
	const below = state.gap < cw + 0.05 + 0.05;
	if (!below) card.position.set(w / 2 + 0.05 + cw / 2, -h / 2 + ch / 2, 0.002);
	else card.position.set(w / 2 - cw / 2, -h / 2 - 0.03 - ch / 2, 0.002);
	card.userData = { x0: card.position.x, y0: card.position.y, below };
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
const GAP_MIN = 0.6;        // how tight the walls go before the middle fills — never crammed side by side (Uli)
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
		// as many rooms as it takes: two, or more in a small real room
		let parts = 2;
		for (; parts <= 8; parts++) {
			const per = Math.ceil(specs.length / parts);
			const fits = Array.from({ length: parts }, (_, i) => specs.slice(i * per, (i + 1) * per))
				.every((slice, i) => !layout([...slice].reverse(), shapeOf(`${year}-${i + 1}`).W, shapeOf(`${year}-${i + 1}`).D).rest.length);
			if (fits || !state.real) break;                   // a synthetic room may still grow; a real one must fit
		}
		parts = Math.min(parts, 8);
		const per = Math.ceil(specs.length / parts);
		for (let i = 0; i < parts; i++) {
			const part = i + 1, key = `${year}-${part}`, slice = specs.slice(i * per, (i + 1) * per);
			if (!slice.length) continue;
			roomList.push({ key, year, span, years: m.years, part, of: parts, specs: slice, shape: shapeOf(key), look: lookOf(key) });
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
	for (const name of ['pieces', 'baked']) {
		const old = scene.getObjectByName(name);
		if (old) { old.traverse(o => { if (o.isMesh && o.parent === old) o.geometry.dispose(); }); old.parent.remove(old); }
	}
	const pieces = new THREE.Group(); pieces.name = 'pieces';

	// newest first from the elevator
	const items = [...room.specs].reverse();

	// The settings' room is the room. Should half a year still not fit it
	// (it does not happen with this collection), the room grows in steps
	// of the same proportion rather than dropping a print — and says so.
	let { W, D } = room.shape;
	let lay = layout(items, W, D);
	while (lay.rest.length && W < 40 && !state.real) {      // real walls do not grow
		W += 1.5; D += 1;
		lay = layout(items, W, D);
	}
	if (W !== room.shape.W) console.warn(`${key}: room grown to ${W} × ${D} to hang everything`);
	if (lay.rest.length) console.warn(`${key}: ${lay.rest.length} pieces do not fit the real room`);
	const floor = floorOf(room.year);
	if (!state.room || state.room.W !== W || state.room.D !== D || state.room.look !== room.look.name || state.room.floor !== floor) {
		for (const name of ['room', 'elevator']) {
			const old = scene.getObjectByName(name);
			if (!old) continue;
			old.parent.remove(old);
			// the floor's textures go with the room
			const f = old.getObjectByName('floor');
			if (f) { for (const k of ['map', 'roughnessMap', 'normalMap', 'metalnessMap']) f.material[k]?.dispose(); f.material.dispose(); }
		}
		world.add(buildRoom(W, D, H, room.look, floor));
		world.add(elevator.build(W, D, H));
		state.room = { W, D, H, look: room.look.name, floor };
	}

	state.gap = lay.gap;                           // the labels need it before the pieces exist
	state.obstacles = [];
	for (const { piece: spec, x, z, yaw, wall } of lay.placed) {
		const piece = makePiece(spec);
		piece.position.set(x, HANG_Y, z);
		piece.rotation.y = yaw;
		piece.userData.wall = wall;
		// a middle row stops the body (Uli): its footprint, the body's radius round it
		if (wall === 'mid') state.obstacles.push({ x0: x - spec.w / 2 - BODY_R, x1: x + spec.w / 2 + BODY_R, z0: z - FRAME.depth - BODY_R, z1: z + FRAME.depth + BODY_R });
		// A piece in the middle of the room has no wall behind it: the warm
		// pool a spot throws would hang in the air. The light stays, the
		// pool goes (Uli, 2026-08-29).
		if (wall === 'mid') {
			const pool = piece.getObjectByName('pool');
			if (pool) { pool.geometry.dispose(); pool.parent.remove(pool); }
		}
		pieces.add(piece);
	}

	world.add(pieces);
	world.updateMatrixWorld(true);
	world.add(bakeRoom(pieces));
	if (wire) setWire(true);
	const keep = new Set(); pieces.traverse(o => { if (o.name === 'photo') for (const [k, t] of textureCache) if (t === o.material.map) keep.add(k); });
	freeTexturesExcept(keep);
	const keepV = new Set(); pieces.traverse(o => { if (o.name === 'video') keepV.add(o.userData.n); });
	freeVideosExcept(keepV);
	state.year = room.year;
	state.roomKey = key;
	state.gap = lay.gap;
	elevator.light(key);
	if (!elevator.ride) elevator.show(roomLabel(room), '');
	return pieces;
}

// ---------------------------------------------------------------------------
// The elevator
//
// A cabin in the room's +x, -z corner, ELEVATOR.size square, the room's
// height. Its doors are on the west face, so you step out looking down
// the long axis of the room. Inside, on the south wall beside the door,
// the console: a dark sloped plate with a green-lit rim and round
// buttons laid out like floors — a row per decade, ten across, the year
// printed on each. The lit button is the room you stand in. A press
// closes the doors, hangs the other room, and opens them again.

const DOOR = { w: 0.7, h: 2.1, thick: 0.03 };            // 0.7 in a 1.5 m front: an open panel stays behind its jamb (Uli)
const CABIN_WALL = 0.08;
const DISPLAY = { w: 0.44, h: 0.11 };                      // the floor display above the door
const DOOR_T = 1800;                                       // ms for the doors to open or close — the length of their sound
const BELL_GAP = 800;                                      // ms between the bell and the doors
const BUTTON = { w: 0.06, h: 0.03, rise: 0.006, pitchX: 0.07, pitchY: 0.04, gap: 0.002, r: 0.02 };   // the floor buttons: a rectangular cap, its rise off the steel, the grid, the black gap round it; r: the round call and switch buttons
const PANEL = { low: 1.2, high: 1.8, depth: 0.03, cols: 10, margin: 0.03 };   // its centre at 1.5 m (Uli: 20 cm up), vertical on the wall (Uli), ten across; depth: the walnut block it is the face of

// Brushed steel, matte (Uli): the roughness map is left out so nothing on
// the sheet turns glossy, the environment only just shows in it.
const metal = new THREE.MeshStandardMaterial({
	map: tex('metal-color.jpg', true, 1), metalnessMap: tex('metal-metalness.jpg', false, 1),
	normalMap: tex('metal-normal.jpg', false, 1), normalScale: new THREE.Vector2(0.5, 0.5),
	metalness: 1, roughness: 0.85, envMapIntensity: 0.45,
});
const cabinInner = new THREE.MeshLambertMaterial({ color: 0xcfccc5 });
const displayBack = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.4, metalness: 0.2 });
const cabinFloor = new THREE.MeshLambertMaterial({ color: 0x5a5854 });
const panelPlate = new THREE.MeshStandardMaterial({ color: 0x2b2b2d, metalness: 0.5, roughness: 0.45 });   // anthracite: the switchplate outside
const GREEN = 0x46ff7a;                                                                                    // the lit floor
// The console's walnut (Uli): the dark wood set, tiled every half metre —
// `rx`, `ry` are the tiles across the face it is put on.
const walnut = (rx, ry) => new THREE.MeshStandardMaterial({
	map: tex('wood-dark-color.jpg', true, ry, rx), roughnessMap: tex('wood-dark-rough.jpg', false, ry, rx), normalMap: tex('wood-dark-normal.jpg', false, ry, rx),
	normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1, metalness: 0, envMapIntensity: 0.4,
});
const pocketMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 });   // the black gap round a button
const lightPanel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 1.6, roughness: 1 });
const CABIN_LAMP = { light: 5, dark: 1.8 }, CABIN_PANEL = { light: 1.6, dark: 0.5 };   // the cabin at night: dimmer, not dark (Uli)

// The print on a button: the year, left-aligned, in Jost Light (loaded
// before the first room, see the start); a split year's floors are
// "2018.1", "2018.2", the suffix smaller on the same baseline (Uli).
// Drawn on a clear canvas: the cap under it shows through.
function buttonFace(year, room) {
	const c = document.createElement('canvas');
	c.width = 256; c.height = 128;
	const g = c.getContext('2d');
	g.fillStyle = '#1d1c1a';
	g.textAlign = 'left';
	g.textBaseline = 'middle';
	const font = px => `300 ${px}px Jost, "Helvetica Neue", Arial, sans-serif`;
	g.font = font(56);
	g.fillText(year, 36, 66);
	if (room.of > 1) {
		const w = g.measureText(year).width;
		g.font = font(45);
		g.fillText(`.${room.part}`, 36 + w + 2, 66);
	}
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

// The floor display: the room you are on; during a ride, each floor
// passed, with the direction. Drawn on a canvas, shown inside and out.
function drawDisplay(ctx, text, arrow) {
	const c = ctx.canvas;
	ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, c.width, c.height);
	ctx.fillStyle = '#ffb347';
	ctx.textBaseline = 'middle';
	ctx.font = '600 84px "Helvetica Neue", Arial, sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText(text, c.width / 2 + (arrow ? 24 : 0), c.height / 2 + 4);
	if (arrow) {
		ctx.font = '600 60px "Helvetica Neue", Arial, sans-serif';
		ctx.textAlign = 'left';
		ctx.fillText(arrow, 28, c.height / 2 + 4);
	}
}
function roomLabel(room) {
	if (room.years.length > 1) return room.span;
	return room.of > 1 ? `${room.year}.${room.part}` : room.year;
}

// The sound of the lift: Uli's recordings in res/sound/. ride.mp3 has a
// start and run (0.6–8.4 s), the stop (8.4–11.7 s) and the doors opening
// (13.3–15.3 s); a ride plays the start and as much run as it needs, then
// the stop; every door movement plays the door segment. bell.mp3, when
// there is one, rings on arrival; until then the arrival in call.mp3
// (15.4–18.6 s) stands in. The audio context has to be born of a press,
// so it is made on the first ride; the files are fetched at load and
// decoded then.
const SOUND = {
	ride:  { file: '/res/sound/ride.mp3', run: [0.6, 8.4], stop: [8.4, 11.7], door: [13.3, 15.3] },
	bell:  { file: '/res/sound/bell.mp3' },
	call:  { file: '/res/sound/call.mp3', hum: [1.0, 6.0] },        // the lift coming, heard from outside
};
const STOP_LEN = SOUND.ride.stop[1] - SOUND.ride.stop[0];

const lift = {
	ctx: null, master: null, raw: {}, buf: {},
	// Fetch and decode at load: a context made before any press starts
	// suspended but decodes fine, so the first ride has its sound ready.
	fetchAll() {
		this.open();
		for (const [k, v] of Object.entries(SOUND)) {
			fetch(v.file).then(r => r.ok ? r.arrayBuffer() : null).then(b => { if (b) { this.raw[k] = b; this.decode(); } }).catch(() => {});
		}
	},
	open() {
		if (this.ctx) return true;
		try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return false; }
		this.master = this.ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(this.ctx.destination);
		return true;
	},
	ready() {
		if (!this.open()) return false;
		if (this.ctx.state === 'suspended') this.ctx.resume();
		this.decode();
		return true;
	},
	decode() {
		if (!this.ctx) return;
		for (const k of Object.keys(this.raw)) {
			if (this.buf[k] || this.buf[k] === false) continue;
			this.buf[k] = false;                              // decoding
			this.ctx.decodeAudioData(this.raw[k].slice(0)).then(b => { this.buf[k] = b; }).catch(() => { delete this.buf[k]; });
		}
	},
	// play buffer `k` from `from` for `dur` seconds at time `at`, faded in and out
	// `muffle`: a low-pass at that many Hz, for a sound heard through a door
	play(k, from, dur, at = null, gain = 1, fadeIn = 0.05, fadeOut = 0.12, muffle = 0) {
		const b = this.buf[k];
		if (!b) return null;
		const ctx = this.ctx, t = at ?? ctx.currentTime;
		const src = ctx.createBufferSource(); src.buffer = b;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + fadeIn);
		g.gain.setValueAtTime(gain, t + dur - fadeOut);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(g);
		if (muffle) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = muffle; g.connect(f); f.connect(this.master); }
		else g.connect(this.master);
		src.start(t, from, dur + 0.02);
		return src;
	},
	// a ride of `seconds`: the start and the run for what is left after the stop, then the stop
	run(seconds) {
		if (!this.ready()) return;
		const R = SOUND.ride, t = this.ctx.currentTime;
		const runLen = Math.max(0.4, Math.min(seconds - STOP_LEN, R.run[1] - R.run[0]));
		this.play('ride', R.run[0], runLen, t, 1, 0.03, 0.15);
		this.play('ride', R.stop[0], STOP_LEN, t + runLen - 0.1, 1, 0.1, 0.2);
	},
	// The doors: a lift has two, the cabin's and the shaft's, moving as
	// one — the near door is heard plain, the far one through it: a beat
	// behind, at a third, muffled (Uli). Both fall away with the distance
	// from the doors: full within a metre, a quarter at 2.5 m.
	slide() {
		if (!this.ready()) return;
		const R = SOUND.ride, t = this.ctx.currentTime;
		const d = elevator.doorsWorld ? head().distanceTo(elevator.doorsWorld()) : 1;
		const gain = 0.9 * Math.min(1, Math.pow(1 / Math.max(d, 1), 1.5));
		this.play('ride', R.door[0], R.door[1] - R.door[0], t, gain, 0.03, 0.15);
		this.play('ride', R.door[0], R.door[1] - R.door[0], t + 0.07, gain * 0.33, 0.03, 0.15, 900);
	},
	// a button's click: a short burst of band-passed noise with a tick on
	// top, made here, no file
	click() {
		if (!this.ready()) return;
		const ctx = this.ctx, t = ctx.currentTime, n = Math.floor(ctx.sampleRate * 0.03);
		const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
		for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
		const src = ctx.createBufferSource(); src.buffer = b;
		const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 1.2;
		const g = ctx.createGain(); g.gain.value = 0.44;
		src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
		const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(1900, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.025);
		const og = ctx.createGain(); og.gain.setValueAtTime(0.15, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
		o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.05);
	},
	bell() {
		if (!this.ready() || !this.buf.bell) return;
		this.play('bell', 0, this.buf.bell.duration, null, 1, 0.01, 0.1);
	},
	// the hum of the lift coming, for `seconds`, while you wait outside
	hum(seconds) {
		if (!this.ready()) return;
		const C = SOUND.call;
		this.play('call', C.hum[0], Math.min(seconds, C.hum[1] - C.hum[0]), null, 0.8, 0.3, 0.6);
	},
};
lift.fetchAll();

// The switchplate's buttons: a label, and the state they show.
const WOODS = ['maple', 'oak', 'walnut', 'black', 'white'];
const SWITCHES = [
	{ key: 'dark',   label: 'light',  value: () => state.settings.dark ? 'night' : 'day',  press: () => setSetting('dark', !state.settings.dark) },
	{ key: 'frame',  label: 'wood',   value: () => state.settings.frame,                   press: () => setSetting('frame', WOODS[(WOODS.indexOf(state.settings.frame) + 1) % WOODS.length]) },
	{ key: 'labels', label: 'labels', value: () => state.settings.labels ? 'on' : 'off',   press: () => setSetting('labels', !state.settings.labels) },
	{ key: 'wire',   label: 'wire',   value: () => wire ? 'on' : 'off',                    press: () => setWire(!wire) },
];
// A switch's face shows its state; its description is printed on the
// plate under it (Uli).
function switchFace(sw) {
	const c = document.createElement('canvas'); c.width = c.height = 128;
	const g = c.getContext('2d');
	g.fillStyle = '#f2efe8'; g.beginPath(); g.arc(64, 64, 64, 0, Math.PI * 2); g.fill();
	g.fillStyle = '#1b1b1b'; g.textAlign = 'center'; g.textBaseline = 'middle';
	g.font = '300 34px Jost, "Helvetica Neue", Arial, sans-serif'; g.fillText(sw.value(), 64, 66);
	const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function switchLabel(sw) {
	const c = document.createElement('canvas'); c.width = 256; c.height = 64;
	const g = c.getContext('2d');
	g.fillStyle = '#d8d5cf'; g.textAlign = 'center'; g.textBaseline = 'middle';
	g.font = '300 40px Jost, "Helvetica Neue", Arial, sans-serif'; g.fillText(sw.label, 128, 34);
	const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function refreshSwitches() {
	for (const f of [...elevator.switches, ...settingsMap.switches]) if (f.userData.sw) { f.material.map.dispose(); f.material.map = switchFace(f.userData.sw); f.material.needsUpdate = true; }
}

// The switchplate: the four switches two by two on an anthracite plate,
// each a round button showing its state with its description printed
// under it (Uli). Built into `parent` with its middle at (px, py, pz),
// facing +z, the buttons proud that way. Returns what presses.
const SWITCHPLATE = { cols: 2, pitchX: 0.07, pitchY: 0.085, margin: 0.015 };
function buildSwitchplate(parent, px, py, pz) {
	const { cols, pitchX, pitchY, margin } = SWITCHPLATE, rows = Math.ceil(SWITCHES.length / cols);
	const plateW = cols * pitchX + 2 * margin, plateH = rows * pitchY + 2 * margin;
	const plate = new THREE.Mesh(new THREE.BoxGeometry(plateW, plateH, 0.024), panelPlate);
	plate.name = 'switchplate'; plate.position.set(px, py, pz); parent.add(plate);
	const bodyGeo = new THREE.CylinderGeometry(BUTTON.r, BUTTON.r, BUTTON.rise, 12, 1, true); bodyGeo.rotateX(Math.PI / 2);   // axis along z
	const faceGeo = new THREE.CircleGeometry(BUTTON.r * 0.92, 12);
	const labelGeo = new THREE.PlaneGeometry(0.056, 0.014);
	const switches = [];
	SWITCHES.forEach((sw, i) => {
		const col = i % cols, row = Math.floor(i / cols);
		const x = px - plateW / 2 + margin + pitchX * (col + 0.5);
		const y = py + plateH / 2 - margin - pitchY * (row + 0.5) + 0.009;   // up a little: the label takes the room below
		const z = pz + 0.012 + BUTTON.rise / 2;
		const b = new THREE.Mesh(bodyGeo, metal); b.name = `switch-${sw.key}`; b.userData.action = sw.key; b.position.set(x, y, z); parent.add(b);
		const f = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({ map: switchFace(sw), roughness: 0.6 }));
		f.name = `switch-face-${sw.key}`; f.userData.action = sw.key; f.userData.sw = sw; f.position.set(x, y, z + BUTTON.rise / 2 + 0.0005); parent.add(f);
		const l = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({ map: switchLabel(sw), transparent: true }));
		l.name = `switch-label-${sw.key}`; l.position.set(x, y - BUTTON.r - 0.011, pz + 0.0125); parent.add(l);
		switches.push(b, f);
	});
	return switches;
}

// The settings map (Uli): the switchplate again, held up in front of you
// on B — a controller's B or Y button, the bench's B or O key — half a metre
// off, a little below the eyes and turned to them like a map, left where
// it was summoned; B again puts it away. Its switches press like the
// plate's.
const settingsMap = {
	group: null, switches: [],
	toggle() {
		if (!this.group) { this.group = new THREE.Group(); this.group.name = 'settings-map'; this.switches = buildSwitchplate(this.group, 0, 0, 0); scene.add(this.group); }
		else if (this.group.visible) { this.group.visible = false; return; }
		const h = head().clone(), fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
		fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); fwd.normalize();
		this.group.position.copy(h).addScaledVector(fwd, 0.5); this.group.position.y -= 0.12;
		this.group.lookAt(h);                          // +z, the buttons' side, toward the eyes
		this.group.visible = true;
	},
};

const elevator = {
	group: null,
	doors: null,        // [north panel, south panel]
	buttons: [],
	displays: [],       // { tex, ctx } inside and outside
	ride: null,         // while the doors are moving or the cabin travels
	origin: null,       // cabin's inner centre on the floor, world coords
	callButtons: [],
	switches: [],       // the switchplate's buttons, outside on the cabin's room-facing side
	coming: null,       // { t0, wait } after a call, before the doors open
	open: 1,            // where the doors stand when idle, 0..1
	doorAnim: null,     // { from, to, t0 } an idle open or close
	leftAt: null,       // when the body last stepped out, for the doors to close behind

	build(W, D, H) {
		const e = ELEVATOR.size, t = CABIN_WALL;
		const g = new THREE.Group();
		g.name = 'elevator';
		const x0 = W / 2 - e, z1 = -D / 2 + e;   // west face at x0, south face at z1
		// the cabin's inside, between its own four walls
		const ix0 = x0 + t, ix1 = W / 2 - t, iz0 = -D / 2 + t, iz1 = z1 - t;
		this.origin = new THREE.Vector3((ix0 + ix1) / 2, 0, (iz0 + iz1) / 2);

		const box = (name, w, h, d, x, y, z, m) => {
			const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
			mesh.name = name; mesh.position.set(x, y, z);
			mesh.castShadow = mesh.receiveShadow = true;
			g.add(mesh); return mesh;
		};

		// A cabin all round (Uli): its own four walls, floor and ceiling, steel
		// outside, satin inside — not the room's plaster on two sides.
		// 2 mm short of the room's ceiling and floor: a face flush with either
		// shimmered along the cabin's top edge (Uli)
		box('cabin-s', e, H - 0.004, t, W / 2 - e / 2, H / 2, z1 - t / 2, metal);
		box('cabin-n', e, H - 0.004, t, W / 2 - e / 2, H / 2, -D / 2 + t / 2, metal);
		box('cabin-e', t, H - 0.004, e, W / 2 - t / 2, H / 2, -D / 2 + e / 2, metal);
		box('cabin-floor', e, 0.01, e, W / 2 - e / 2, 0.007, -D / 2 + e / 2, cabinFloor);
		box('cabin-ceiling', e, 0.02, e, W / 2 - e / 2, H - 0.012, -D / 2 + e / 2, cabinInner);
		// Inner skins so the inside reads as a cabin, not raw steel.
		box('skin-s', e - 2 * t, H - 0.04, 0.01, W / 2 - e / 2, H / 2, iz1 - 0.005, cabinInner);
		box('skin-n', e - 2 * t, H - 0.04, 0.01, W / 2 - e / 2, H / 2, iz0 + 0.005, cabinInner);
		box('skin-e', 0.01, H - 0.04, e - 2 * t, ix1 - 0.005, H / 2, -D / 2 + e / 2, cabinInner);

		// West face: two jambs and a lintel around the door opening, and an
		// architrave standing proud of the face round the door outside.
		const jamb = (e - DOOR.w) / 2;
		box('jamb-n', t, DOOR.h, jamb, x0 + t / 2, DOOR.h / 2, -D / 2 + jamb / 2, metal);
		box('jamb-s', t, DOOR.h, jamb, x0 + t / 2, DOOR.h / 2, z1 - jamb / 2, metal);
		box('lintel', t, H - DOOR.h, e, x0 + t / 2, DOOR.h + (H - DOOR.h) / 2, -D / 2 + e / 2, metal);
		const zc = -D / 2 + e / 2, arch = 0.07, proud = 0.03;
		box('arch-n', proud, DOOR.h + arch, arch, x0 - proud / 2, (DOOR.h + arch) / 2, zc - DOOR.w / 2 - arch / 2, metal);
		box('arch-s', proud, DOOR.h + arch, arch, x0 - proud / 2, (DOOR.h + arch) / 2, zc + DOOR.w / 2 + arch / 2, metal);
		box('arch-top', proud, arch, DOOR.w + 2 * arch, x0 - proud / 2, DOOR.h + arch / 2, zc, metal);

		// The call button outside, on the south side of the door at hand height.
		this.callButtons = [];
		{
			const c = document.createElement('canvas'); c.width = c.height = 128;
			const g2 = c.getContext('2d');
			g2.fillStyle = '#f2efe8'; g2.beginPath(); g2.arc(64, 64, 64, 0, Math.PI * 2); g2.fill();
			g2.fillStyle = '#1b1b1b';
			g2.beginPath(); g2.moveTo(64, 30); g2.lineTo(92, 62); g2.lineTo(36, 62); g2.closePath(); g2.fill();
			g2.beginPath(); g2.moveTo(64, 98); g2.lineTo(92, 66); g2.lineTo(36, 66); g2.closePath(); g2.fill();
			const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
			const bodyGeo = new THREE.CylinderGeometry(BUTTON.r, BUTTON.r, BUTTON.rise, 32); bodyGeo.rotateZ(Math.PI / 2);   // axis along x
			const cb = new THREE.Mesh(bodyGeo, metal);
			cb.name = 'call'; cb.userData.call = true;
			cb.position.set(x0 - proud - BUTTON.rise / 2, 1.1, zc + DOOR.w / 2 + arch + 0.09);
			g.add(cb);
			const cf = new THREE.Mesh(new THREE.CircleGeometry(BUTTON.r * 0.92, 32), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 }));
			cf.name = 'call-face'; cf.userData.call = true;
			cf.position.set(cb.position.x - BUTTON.rise / 2 - 0.0005, 1.1, cb.position.z);
			cf.rotation.y = -Math.PI / 2;                    // faces -x, the room
			g.add(cf);
			cb.userData.face = cf;
			this.callButtons.push(cb, cf);
		}

		// The switchplate (Uli): on the room's north wall just west of the
		// cabin — the wall on your right as you step out of the doors — so
		// the settings are at hand on leaving. In the corner's empty margin,
		// before the first frame.
		this.switches = buildSwitchplate(g, x0 - 0.45, 1.5, -D / 2 + 0.012);

		// Two door panels behind the jambs, sliding apart along z into the
		// cabin's own walls' thickness; closed, they meet at the centre.
		const dx = x0 + t + DOOR.thick / 2 + 0.005;
		this.doors = [
			box('door-n', DOOR.thick, DOOR.h, DOOR.w / 2, dx, DOOR.h / 2, zc - DOOR.w / 4, metal),
			box('door-s', DOOR.thick, DOOR.h, DOOR.w / 2, dx, DOOR.h / 2, zc + DOOR.w / 4, metal),
		];
		for (const d of this.doors) d.userData.closedZ = d.position.z;

		// Floor displays above the door, one facing into the cabin, one out.
		this.displays = [];
		const display = (name, x, ry) => {
			const c = document.createElement('canvas'); c.width = 512; c.height = 128;
			const ctx = c.getContext('2d');
			const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
			const back = box(name + '-back', 0.02, DISPLAY.h + 0.03, DISPLAY.w + 0.03, x, DOOR.h + 0.16, zc, displayBack);
			back.castShadow = false;
			const face = new THREE.Mesh(new THREE.PlaneGeometry(DISPLAY.w, DISPLAY.h), new THREE.MeshBasicMaterial({ map: tex }));
			face.name = name;
			face.position.set(x + (ry > 0 ? 0.011 : -0.011), DOOR.h + 0.16, zc);
			face.rotation.y = ry;
			g.add(face);
			this.displays.push({ tex, ctx });
		};
		display('display-in',  x0 + t + 0.015, Math.PI / 2);     // inside, on the door wall, facing +x into the cabin
		display('display-out', x0 - 0.015, -Math.PI / 2);        // outside, above the architrave, facing the room
		const cur = rooms().find(r => r.key === state.roomKey);   // may be gone after a re-plan
		this.show(cur ? roomLabel(cur) : '', '');

		// Light in the cabin: a glowing panel in the ceiling and the lamp
		// behind it that actually lights the walls and the buttons.
		const panelLight = box('cabin-light', e * 0.5, 0.005, e * 0.5, this.origin.x, H - 0.025, this.origin.z, lightPanel);
		panelLight.castShadow = false;
		const lamp = new THREE.PointLight(0xfff4e6, CABIN_LAMP[state.settings.dark ? 'dark' : 'light'], 3.5, 2);
		lamp.name = 'cabin-lamp';
		lamp.position.set(this.origin.x, H - 0.15, this.origin.z);
		g.add(lamp);

		// The console on the south wall's inner face, beside the door, between
		// hand and eye height: a walnut block standing on the wall, vertical
		// (Uli), its face the plate — nothing of it in the wall. The buttons
		// sit like floors (Uli): a line per decade, the newest at the top,
		// ten across with the year ending in 1 at the left and 0 at the
		// right, so a year always has the same place, and a year's further
		// floors on lines under its decade's, in its column, like a
		// sub-table. The next decade's line starts below the lowest button
		// of the one above. A year without a room leaves its place empty;
		// the thin years merged into one room each keep a button to it.
		const list = rooms();
		const decade = y => Math.floor((Number(y) - 1) / 10);
		const deep = new Map();                        // decade -> lines it takes
		for (const r of list) for (const y of r.years) { const d = decade(y); deep.set(d, Math.max(deep.get(d) || 1, r.of || 1)); }
		const top = Math.max(...deep.keys()), bottom = Math.min(...deep.keys());
		const start = new Map(); let rows = 0;
		for (let d = top; d >= bottom; d--) { start.set(d, rows); rows += deep.get(d) || 1; }
		const cols = PANEL.cols, margin = PANEL.margin;
		const plateW = cols * BUTTON.pitchX + 2 * margin, plateH = rows * BUTTON.pitchY + 2 * margin;
		// the block: its face at the panel's z = 0, its back on the skin; the buttons stand proud at -z
		const panel = new THREE.Group();
		panel.name = 'panel';
		panel.position.set(ix0 + 0.10 + plateW / 2, (PANEL.low + PANEL.high) / 2, iz1 - 0.0105 - PANEL.depth);
		g.add(panel);
		const plate = new THREE.Mesh(new THREE.BoxGeometry(plateW, plateH, PANEL.depth), walnut(plateW / 0.5, plateH / 0.5));
		plate.name = 'plate';
		plate.position.z = PANEL.depth / 2;
		panel.add(plate);
		// the lit floor's lamp: a little green light in front of the lit button, spilling onto the plate
		this.floorLamp = new THREE.PointLight(GREEN, 0.004, 0.08, 2);
		this.floorLamp.name = 'floor-lamp';
		this.floorLamp.visible = false;
		panel.add(this.floorLamp);

		// A button: a black pocket in the plate, brushed steel at its bottom,
		// a clear cap standing proud of it, the year printed on the cap. Lit,
		// the cap glows green (light()).
		this.buttons = [];
		const { w, h, rise, gap } = BUTTON;
		const pocketGeo = new THREE.BoxGeometry(w + 2 * gap, h + 2 * gap, 0.001);
		const steelGeo = new THREE.BoxGeometry(w, h, 0.002);
		const capGeo = new THREE.BoxGeometry(w, h, rise);
		const printGeo = new THREE.PlaneGeometry(w, h);
		// facing the south wall the viewer's left is +x, so the columns run down x
		const cell = (y, r) => ({
			x: plateW / 2 - margin - BUTTON.pitchX * ((Number(y) - 1) % 10 + 0.5),
			y: plateH / 2 - margin - BUTTON.pitchY * (start.get(decade(y)) + Math.max((r.part || 0) - 1, 0) + 0.5),
		});
		for (const room of list) for (const year of room.years) {
			const { x, y } = cell(year, room);
			const put = (name, geo, material, z) => {
				const m = new THREE.Mesh(geo, material);
				m.name = `${name}-${room.key}`;
				m.userData.key = room.key;
				m.userData.z0 = z;                     // where it rests: a press dips it in and back
				m.position.set(x, y, z);
				panel.add(m);
				return m;
			};
			put('pocket', pocketGeo, pocketMat, -0.0005);
			put('steel', steelGeo, metal, -0.002);
			const cap = put('cap', capGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, roughness: 0.3, metalness: 0, emissive: GREEN, emissiveIntensity: 0, envMapIntensity: 0.5 }), -0.003 - rise / 2);
			cap.userData.cap = true;
			// the print: a clear plane a hair before the cap, turned to face
			// into the cabin (-z) so the year reads the right way round
			const print = put('print', printGeo, new THREE.MeshBasicMaterial({ map: buttonFace(year, room), transparent: true, depthWrite: false }), -0.003 - rise - 0.0003);
			print.rotation.y = Math.PI;
			print.renderOrder = 2;
			this.buttons.push(cap, print);              // both press
		}
		this.group = g;
		return g;
	},

	show(text, arrow) {
		for (const d of this.displays) { drawDisplay(d.ctx, text, arrow); d.tex.needsUpdate = true; }
	},

	light(key) {
		let lit = null;
		for (const b of this.buttons) {
			if (!b.userData.cap) continue;                  // the prints carry no light
			const m = b.material, on = b.userData.key === key;
			m.emissiveIntensity = on ? 1.3 : 0;
			m.opacity = on ? 0.9 : 0.28;                    // lit, the cap fills with green light
			m.color.set(on ? 0x2a5a38 : 0xffffff);
			if (on && !lit) lit = b;
		}
		// the floor's lamp stands 2 cm off the (first) lit button
		this.floorLamp.visible = !!lit;
		if (lit) { this.floorLamp.position.copy(lit.position); this.floorLamp.position.z -= 0.02; }
	},

	// A press, before anything else happens (Uli): the button lights at
	// once, its cap dips in and springs back over a fifth of a second, and
	// it clicks. `at` is the mesh that was hit — of a merged room's several
	// buttons only that one dips; from the bench's list, all of them.
	press(key, at = null) {
		lift.click();
		if (!(this.ride && !this.ride.ready)) this.light(key);   // travelling, the light is the ride's
		const same = b => !at || (Math.abs(b.position.x - at.position.x) < 1e-4 && Math.abs(b.position.y - at.position.y) < 1e-4);
		this.pressAnim = { meshes: this.buttons.filter(b => b.userData.key === key && same(b)), t0: performance.now() };
	},
	stepPress(now) {
		const a = this.pressAnim;
		if (!a) return;
		const f = (now - a.t0) / 200, k = f < 0.35 ? f / 0.35 : Math.max(0, 1 - (f - 0.35) / 0.65);
		for (const m of a.meshes) m.position.z = m.userData.z0 + k * BUTTON.rise * 0.7;
		if (f >= 1) this.pressAnim = null;
	},

	placeInCabin() {
		const o = this.originWorld();
		placeBody(o.x, o.z, Math.PI / 2 + world.rotation.y);
	},

	// Doors: 0 closed, 1 open.
	setDoors(open) {
		const [n, s] = this.doors;
		n.position.z = n.userData.closedZ - open * DOOR.w / 2;
		s.position.z = s.userData.closedZ + open * DOOR.w / 2;
	},

	// Is the body in the cabin?
	// The cabin's centre in the scene (world may be turned to the real room).
	originWorld() { return world.localToWorld(this.origin.clone()); },
	// the doors' middle, at chest height, in the scene
	doorsWorld() { return world.localToWorld(new THREE.Vector3(this.origin.x - ELEVATOR.size / 2, 1.2, this.origin.z)); },
	inside() {
		if (!this.origin) return true;
		const h = world.worldToLocal(head().clone()), e = ELEVATOR.size / 2 + 0.1;
		return Math.abs(h.x - this.origin.x) < e && Math.abs(h.z - this.origin.z) < e;
	},

	// The doors on their own: a call opens them; they close some seconds
	// after you have walked out.
	// A call: the button lights, the lift is heard coming for a few seconds
	// (Uli: a humming while waiting outside), then the bell and the doors.
	call() {
		if (this.ride || this.coming || this.open === 1) return;
		if (this.doorAnim) {                                  // closing: the lift is here, the doors come back
			if (this.doorAnim.to === 1) return;
			this.doorAnim = { from: this.open, to: 1, t0: performance.now(), dur: DOOR_T * (1 - this.open) };
			lift.slide();
			return;
		}
		this.coming = { t0: performance.now(), wait: 4500 };
		lift.hum(this.coming.wait / 1000);
		this.show(roomLabel(roomByKey(state.roomKey)), '\u25b2');
		this.callButtons[1].material.emissiveIntensity = 0.5; this.callButtons[1].material.emissiveMap = this.callButtons[1].material.map; this.callButtons[1].material.needsUpdate = true;
	},

	stepIdle(now) {
		if (this.coming) {
			const c = this.coming;
			if (now - c.t0 < c.wait) return;
			if (!c.rang) { c.rang = true; c.t0 = now + BELL_GAP - c.wait; this.show(roomLabel(roomByKey(state.roomKey)), ''); lift.bell(); return; }
			this.coming = null;
			this.doorAnim = { from: 0, to: 1, t0: now };
			lift.slide();
			return;
		}
		if (this.doorAnim) {
			const a = this.doorAnim, f = Math.max(0, Math.min(1, (now - a.t0) / (a.dur || DOOR_T)));
			this.open = a.from + (a.to - a.from) * f;
			this.setDoors(this.open);
			if (f >= 1) {
				this.doorAnim = null;
				if (a.to === 1) this.leftAt = now;     // opened on a call: time to walk in starts now
				const m = this.callButtons[1].material; m.emissiveIntensity = 0; m.emissiveMap = null; m.needsUpdate = true;
			}
			return;
		}
		if (this.inside()) { this.leftAt = null; return; }
		if (this.open < 1) return;
		if (this.leftAt === null) { this.leftAt = now; return; }
		if (now - this.leftAt > 7000) { this.doorAnim = { from: 1, to: 0, t0: now }; lift.slide(); }
	},

	// Ride again or leave — both stay possible (Uli): after arriving the
	// doors stay open while you stand in the cabin; a press starts the
	// next ride even while they are still opening (they reverse from
	// where they are), and walking out lets them close behind you.
	go(key) {
		if (key === state.roomKey) return;
		if (this.ride && !this.ride.ready) return;         // travelling: no
		let fromOpen = 1;
		if (this.ride) fromOpen = Math.max(0, Math.min(1, (performance.now() - this.ride.tOpen) / DOOR_T));   // caught while opening
		else if (this.doorAnim || this.coming) fromOpen = this.open;
		this.doorAnim = null; this.coming = null; this.open = 1; this.leftAt = null;
		lift.slide();
		const list = rooms();
		const from = list.findIndex(r => r.key === state.roomKey), to = list.findIndex(r => r.key === key);
		const floors = Math.abs(to - from);
		// the list runs newest first, so a smaller index is a higher floor
		const path = list.slice(Math.min(from, to), Math.max(from, to) + 1);
		if (to < from) path.reverse();
		// the doors close from where they stand: back-date t0 by what is already shut
		this.ride = { key, t0: performance.now() - (1 - fromOpen) * DOOR_T, hung: false, floors, up: to < from, path,
		              travel: Math.max(6, Math.min(9, 2.5 + 0.35 * floors)) };   // long enough for the run to be heard before the stop
		if (!this.inside()) this.placeInCabin();                 // pressed from the room (the bench's Y list): into the cabin; a body in the cabin stays as it stands (Uli)
	},

	// Called every frame. Half a second closing; then the cabin travels —
	// the display counting the floors, the motor sounding, longer for
	// more floors — and the other room is hung meanwhile; the doors stay
	// shut until that room's pictures are in (Uli: no switching to be
	// seen); then the bell, and half a second opening.
	step(now) {
		this.stepPress(now);
		if (!this.ride) { this.stepIdle(now); return; }
		const r = this.ride;
		const t = (now - r.t0) / 1000;
		const close = DOOR_T / 1000;
		if (t < close) { this.setDoors(1 - t / close); return; }
		if (!r.hung) {
			lift.run(r.travel);
			// the new room's cabin may stand elsewhere: the body keeps its
			// place and look in the cabin, not put back facing the doors (Uli)
			const before = this.originWorld().clone(), off = new THREE.Vector3().subVectors(walk.pos, before);
			hangRoom(r.key);                       // may rebuild the room and this cabin
			if (!renderer.xr.isPresenting) { const o = this.originWorld(); walk.pos.set(o.x + off.x, walk.pos.y, o.z + off.z); }
			this.setDoors(0);
			renderer.compile(scene, camera);
			r.hung = true;
			r.photos = roomByKey(r.key).specs.flatMap(sp => sp.photos);
			return;
		}
		const tt = t - close;
		if (tt < r.travel) {
			// the floor passed: the path's index by the fraction of the travel
			const i = Math.min(r.path.length - 1, Math.floor(tt / r.travel * r.path.length));
			this.show(roomLabel(r.path[i]), r.up ? '▲' : '▼');
			return;
		}
		if (!r.ready) {
			const loaded = r.photos.every(p => [...textureCache.keys()].some(k => k.startsWith(p.n + '@') && textureCache.get(k).image));
			if (!loaded && t < 10) return;         // wait; but never lock a visitor in
			r.ready = true;
			r.tOpen = now + BELL_GAP;              // the bell first, the doors after a breath
			this.show(roomLabel(roomByKey(r.key)), '');
			lift.bell();
			return;
		}
		if (now < r.tOpen) return;
		if (!r.sliding) { r.sliding = true; lift.slide(); }
		const o = (now - r.tOpen) / DOOR_T;
		if (o < 1) { this.setDoors(o); return; }
		this.setDoors(1);
		this.open = 1; this.leftAt = null;
		this.ride = null;
	},
};

// Picking a button: a ray from the pointer while it is free, from the
// middle of the view while it is taken.
const raycaster = new THREE.Raycaster();
function pressAt(ndcX, ndcY) {
	if (!elevator.buttons.length) return false;
	raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
	return pressAlong(raycaster, 2.2);
}
function pressAlong(rc, reach) {
	const hit = rc.intersectObjects([...elevator.buttons, ...elevator.callButtons, ...elevator.switches, ...settingsMap.switches], false)[0];
	if (hit && hit.distance <= reach) {
		const u = hit.object.userData;
		if (u.action) { SWITCHES.find(sw => sw.key === u.action).press(); refreshSwitches(); }
		else if (u.call) elevator.call();
		else { elevator.press(u.key, hit.object); elevator.go(u.key); }
		return true;
	}
	// a label card: a press doubles it, the next press puts it back (Uli)
	const pieces = scene.getObjectByName('pieces');
	if (pieces) {
		const labels = [];
		pieces.traverse(o => { if (o.name === 'label' && o.visible) labels.push(o); });
		const l = rc.intersectObjects(labels, false)[0];
		if (l && l.distance <= 4) {
			const card = l.object, big = card.scale.x > 1.5;
			// grow from the card's top-right corner, which sits by the frame, so it
			// stays where it is and spreads down and out
			const w = card.geometry.parameters.width, h = card.geometry.parameters.height;
			const k = big ? 1 : 2;
			card.scale.set(k, k, 1);
			card.position.x = card.userData.x0 + (k - 1) * w / 2 * (card.userData.below ? -1 : 1);
			card.position.y = card.userData.y0 - (k - 1) * h / 2;
			return true;
		}
	}
	return false;
}

// The bench's overlay: Y lists the floors.
const floors = document.getElementById('floors');
function renderFloors() {
	floors.innerHTML = rooms().map(r =>
		`<button data-key="${r.key}"${r.key === state.roomKey ? ' aria-current="true"' : ''}>${r.years.length > 1 ? `${r.years[0]}<small>\u2013${r.years[r.years.length - 1]}</small>` : r.year}${r.of > 1 ? `<small>.${r.part}</small>` : ''}</button>`).join('');
}
floors.addEventListener('click', e => {
	const b = e.target.closest('button');
	if (!b) return;
	floors.hidden = true;
	elevator.press(b.dataset.key);
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
// scale and the room's size change what hangs and rehang. They are set
// on the switchplate by the lift and on the settings map (B); the ones
// not on it (mat, scale, the room's size) by the URL (?mat=none&scale=0.8
// &W=7) — the DOM board that had them went (Uli, 2026-09-05).

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
		case 'frame':  applyFrameLook(materials.frame, v); break;
		case 'labels': scene.traverse(o => { if (o.name === 'label') o.visible = v; }); break;
		case 'mat':
			materials.mat.color.setHex(MAT_COLOURS[v]);
			rehang();                         // 'none' and back change the print's size
			break;
		default: rehang();                    // scale, W, D, H
	}
	refreshSwitches();
}

addEventListener('keydown', e => {
	if ((e.code === 'KeyB' || e.code === 'KeyO') && !e.repeat) settingsMap.toggle();   // B like the controller's, or O (Uli)
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

// Taking the pointer: a click. A browser that refuses (Firefox, 2026-09-05)
// says so in the hint, and a drag on the canvas turns the view instead;
// a drag that moved is not a click, so it presses nothing.
let drag = null, dragged = false;
renderer.domElement.addEventListener('click', e => {
	if (dragged) { dragged = false; return; }
	if (walk.locked()) { pressAt(0, 0); return; }
	// a button under the pointer is pressed; anywhere else takes the pointer
	if (pressAt((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)) return;
	let p = null;
	try { p = renderer.domElement.requestPointerLock(); } catch (err) { lockFailed(err); }
	if (p && p.catch) p.catch(lockFailed);
});
document.addEventListener('pointerlockchange', () => {
	document.body.classList.toggle('locked', walk.locked());
});
document.addEventListener('pointerlockerror', () => lockFailed());
function lockFailed(err) {
	const hint = document.getElementById('hint');
	if (hint) hint.textContent = `the browser refused the pointer${err ? ` (${err.name || err})` : ''} \u00b7 drag to look around \u00b7 W A S D to walk \u00b7 Y for the floors \u00b7 B or O for the settings`;
	console.warn('pointer lock refused', err || '');
}
renderer.domElement.addEventListener('mousedown', e => { if (!walk.locked() && e.button === 0) drag = { x: e.clientX, y: e.clientY }; });
addEventListener('mouseup', () => { drag = null; });

function turn(dx, dy) {
	walk.yaw   -= dx * LOOK_SPEED;
	walk.pitch -= dy * LOOK_SPEED;
	walk.pitch  = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, walk.pitch));
}
addEventListener('mousemove', e => {
	if (walk.locked()) { turn(e.movementX, e.movementY); return; }
	if (!drag) return;
	const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
	if (dx || dy) { dragged = true; drag.x = e.clientX; drag.y = e.clientY; turn(dx, dy); }
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
	// In a session the body is never moved: you walk by feet and stand in
	// the real cabin; turning the rig here spun the whole room round the
	// visitor on every ride (Uli: jump-rotation on a year button).
	if (renderer.xr.isPresenting) return;
	walk.pos.set(x, walk.pos.y, z);
	walk.yaw = yaw; walk.pitch = 0;
}

function clampToRoom(v) {
	const { W, D } = state.room || state.settings;
	v.x = Math.max(-W / 2 + WALL_KEEP, Math.min(W / 2 - WALL_KEEP, v.x));
	v.z = Math.max(-D / 2 + WALL_KEEP, Math.min(D / 2 - WALL_KEEP, v.z));
	return v;
}

const BODY_R = 0.25;   // how close the body's middle comes to a frame
// Is `p` in a middle row's footprint?
function inObstacle(p) { return state.obstacles.some(o => p.x > o.x0 && p.x < o.x1 && p.z > o.z0 && p.z < o.z1); }
// Does a step from `a` to `b` cross the cabin's walls? Only the doorway
// lets one through: the west face, the door's width about the cabin's
// middle, with the doors open.
function throughCabinWall(a, b) {
	const { W, D } = state.room || state.settings;
	const e = ELEVATOR.size, x0 = W / 2 - e, z1 = -D / 2 + e, zc = -D / 2 + e / 2;
	const inCabin = p => p.x > x0 && p.z < z1;
	if (inCabin(a) === inCabin(b)) return false;
	const inDoorway = p => Math.abs(p.z - zc) < DOOR.w / 2 - 0.08;
	return !(inDoorway(a) && inDoorway(b) && elevator.open > 0.5);
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
		const to = new THREE.Vector3(walk.pos.x + dx, 0, walk.pos.z + dz);
		clampToRoom(to);
		// the cabin's walls and the middle rows stop the body (Uli): into
		// the cabin only through the open door; a blocked step slides along
		// the wall or the row instead
		const blocked = p => throughCabinWall(walk.pos, p) || (inObstacle(p) && !inObstacle(walk.pos));
		if (blocked(to)) {
			const along = new THREE.Vector3(to.x, 0, walk.pos.z), across = new THREE.Vector3(walk.pos.x, 0, to.z);
			to.copy(!blocked(along) ? along : !blocked(across) ? across : walk.pos);
		}
		walk.pos.x = to.x; walk.pos.z = to.z;
	}
	// kneel or rise over a third of a second
	walk.pos.y += (walk.eye - walk.pos.y) * Math.min(1, dt * 9);
	if (Math.abs(walk.eye - walk.pos.y) < 0.002) walk.pos.y = walk.eye;
	applyLook();
}

// ---------------------------------------------------------------------------
// A panel plays while it is looked at
//
// The video is light in the room, so it runs only when it has the eye:
// the panel nearest the middle of the view, within LOOK_ANGLE of where
// the head points and LOOK_RANGE metres away, plays; every other panel
// pauses where it stands. Turning away stops it — a room of panels never
// plays more than the one being watched, which is also what the frame
// rate wants. Checked a few times a second, not every frame.
const LOOK_ANGLE = Math.cos(0.35);   // ~20° off the view's centre
const LOOK_RANGE = 9;                // metres
const LOOK_EVERY = 150;              // ms between checks
let lookedAt = 0, lastLook = 0;
const _eye = new THREE.Vector3(), _dir = new THREE.Vector3(), _to = new THREE.Vector3(), _pn = new THREE.Vector3();

function stepVideos(now) {
	if (!videoCache.size) return;
	if (now - lastLook < LOOK_EVERY) return;
	lastLook = now;
	camera.getWorldPosition(_eye);
	camera.getWorldDirection(_dir);
	const group = scene.getObjectByName('pieces');
	let best = 0, bestDot = LOOK_ANGLE;
	if (group) {
		group.traverse(o => {
			if (o.name !== 'video') return;
			o.getWorldPosition(_pn);
			_to.copy(_pn).sub(_eye);
			const dist = _to.length();
			if (dist > LOOK_RANGE) return;
			const dot = _to.normalize().dot(_dir);
			if (dot > bestDot) { bestDot = dot; best = o.userData.n; }
		});
	}
	if (best === lookedAt) return;
	lookedAt = best;
	for (const [n, v] of videoCache) {
		if (n === best) {
			if (!v.playing) { v.playing = true; v.el.play().catch(() => { v.playing = false; }); }
		} else if (v.playing) {
			v.playing = false;
			v.el.pause();
		}
	}
}

// ---------------------------------------------------------------------------
// VR (phase 2, first step)
//
// Where the browser says it can do immersive-vr — the Quest — a button
// offers it. In the headset you stand where the bench's camera stood, at
// real floor height, and walk by feet; a controller's trigger presses the
// lift button it points at — either hand. Nothing else of the bench
// (mouse, keys, the DOM panels) applies in there.

const vrButton = document.getElementById('vr');
const controllers = [0, 1].map(i => {
	const c = renderer.xr.getController(i);
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
	state.xrMode = 'immersive-vr';                       // no AR (Uli)
	vrButton.hidden = false;
	vrButton.addEventListener('click', async () => {
		try {
			// The room is set up at entry (Uli): the Guardian boundary gives the
			// rectangle, the wall you look at becomes the north wall. Planes are
			// still asked for, should a browser ever hand them over in VR.
			// Sharpness on the Quest 3 (Uli, 2026-09-05): the view rendered at
			// 1.3× the headset's default scale (set before the session), the
			// fixed foveation eased from full to 0.3 so the edges of the view
			// do not go soft where a print sits.
			renderer.xr.setFramebufferScaleFactor(1.3);
			const session = await navigator.xr.requestSession(state.xrMode, { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor', 'hand-tracking', 'plane-detection', 'mesh-detection'] });
			state.sessionT0 = performance.now();
			// Render in the boundary's own space: its polygon and the world then
			// share one origin and yaw (read in bounded-floor, rendered in
			// local-floor, the room landed turned and shifted).
			try { state.bounded = await session.requestReferenceSpace('bounded-floor'); } catch (e) { state.bounded = null; }
			if (state.bounded && state.bounded.boundsGeometry && state.bounded.boundsGeometry.length >= 3) renderer.xr.setReferenceSpace(state.bounded);
			else state.bounded = null;
			session.addEventListener('end', () => { vrButton.hidden = false; document.body.classList.remove('xr'); rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); state.lookSet = false; if (state.real) { state.real = null; world.position.set(0, 0, 0); world.rotation.set(0, 0, 0); state.settings.H = loadSettings().H; roomList = null; state.room = null; hangRoom(rooms()[0].key); } });
			await renderer.xr.setSession(session);
			renderer.xr.setFoveation(0.3);
			scene.traverse(o => { if (o.isDirectionalLight && o.castShadow) { o.shadow.mapSize.set(1024, 1024); o.shadow.map?.dispose(); o.shadow.map = null; } });
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

// Hands (Uli: by hand instead of the trigger, as an alternative): with
// hand tracking on, the tip of an index finger touching a button, the
// call button or a label presses it — one press per touch, then the
// finger has to leave and come back.
const hands = [0, 1].map(i => { const h = renderer.xr.getHand(i); h.userData.touching = null; rig.add(h); return h; });
const TOUCH = 0.022;
const tip = new THREE.Vector3();
function stepHands() {
	const pieces = scene.getObjectByName('pieces');
	for (const h of hands) {
		const j = h.joints && h.joints['index-finger-tip'];
		if (!j || !j.visible) { h.userData.touching = null; continue; }
		j.getWorldPosition(tip);
		let hit = null;
		for (const b of [...elevator.buttons, ...elevator.callButtons, ...elevator.switches, ...settingsMap.switches]) {
			if (b.getWorldPosition(new THREE.Vector3()).distanceTo(tip) < TOUCH + BUTTON.r) { hit = b; break; }
		}
		if (!hit && pieces) pieces.traverse(o => {
			if (hit || o.name !== 'label' || !o.visible) return;
			const c = o.getWorldPosition(new THREE.Vector3());
			const half = Math.max(o.geometry.parameters.width, o.geometry.parameters.height) * o.scale.x / 2;
			if (c.distanceTo(tip) < half + TOUCH) hit = o;
		});
		if (hit && h.userData.touching !== hit) {
			h.userData.touching = hit;
			const rc = new THREE.Raycaster();
			const dir = hit.getWorldPosition(new THREE.Vector3()).sub(tip).normalize();
			rc.set(tip.clone().addScaledVector(dir, -0.05), dir);
			pressAlong(rc, 0.3);
		} else if (!hit) h.userData.touching = null;
	}
}

// In VR you walk by feet (Uli); nothing moves the body but the elevator.
// The controllers' B (right) and Y (left) — buttons[5] of the xr-standard
// gamepad — summon and put away the settings map, on the press's edge.
const bDown = new WeakMap();
function stepGamepads() {
	const session = renderer.xr.getSession();
	if (!session) return;
	for (const src of session.inputSources) {
		const b = src.gamepad && src.gamepad.buttons[5];
		if (!b) continue;
		if (b.pressed && !bDown.get(src)) settingsMap.toggle();
		bDown.set(src, b.pressed);
	}
}
function stepXR(dt) { stepHands(); stepGamepads(); }

// ---------------------------------------------------------------------------
// Boot

// The photos, and the buttons' font (res/fonts, @font-face in gallery.css):
// the faces are drawn on canvases when the lift is built, so the font
// must be in before the first room. Should it fail, the fallback prints.
Promise.all([
	fetch('/photos.json', { cache: 'no-cache' }).then(r => r.json()),   // root-absolute: the page lives at /gallery/
	document.fonts.load('300 56px Jost').catch(() => {}),
]).then(([d]) => { state.photos = d.photos; init(); });

function init() {
	hangRoom(rooms()[0].key);    // the newest room; builds the room around it

	// Arrival: you have just stepped out of the elevator, facing down the room.
	const o = elevator.originWorld();
	walk.pos.set(o.x - ELEVATOR.size, EYE, o.z);
	walk.yaw = Math.PI / 2; walk.pitch = 0;
	elevator.setDoors(1);
	applyLook();
}

// P: wireframes (Uli). ?stats=1: frame time on the cabin's display and in
// the hint, so the headset can report its own frame rate.
let wire = false;
function setWire(on) {
	wire = on;
	scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) m.wireframe = wire; });
}
addEventListener('keydown', e => { if (e.code === 'KeyP' && !e.repeat) { setWire(!wire); refreshSwitches(); } });
const stats = new URLSearchParams(location.search).get('stats') === '1';
let frames = 0, statsT = performance.now(), fpsText = '';
function stepStats(now) {
	frames++;
	if (now - statsT < 1000) return;
	const fps = Math.round(frames * 1000 / (now - statsT)); frames = 0; statsT = now;
	const i = renderer.info.render;
	fpsText = `${fps} fps · ${i.calls} calls · ${(i.triangles / 1000).toFixed(1)}k tris`;
	const hint = document.getElementById('hint'); if (hint) hint.textContent = fpsText;
	if (elevator.displays.length && !elevator.ride && !elevator.coming) elevator.show(`${fps} fps`, '');
}

// ---------------------------------------------------------------------------
// The real room (phase 3)
//
// With plane-detection the headset hands over the planes of the room it
// scanned in Space Setup: the floor, the walls, the ceiling, as polygons
// with a pose and a label. From them: the walls' dominant direction, the
// floor's rectangle in that direction, the ceiling's height. The room is
// rebuilt to that rectangle, `world` is moved and turned onto it, and
// the lift takes the real corner nearest to where you stand. Every year
// is re-planned for this one room. Done once per session, when the
// floor and at least two walls have been seen.

let planesShown = 0;
function stepPlanes(frame) {
	if (state.real) return;
	const ref = renderer.xr.getReferenceSpace();
	const walls = [], floors = [], ceilings = [];
	const planes = frame.detectedPlanes ? [...frame.detectedPlanes] : null;
	// say what is arriving on the lift's display, once a second, until the room snaps
	const now = performance.now();
	if (now - planesShown > 1000 && elevator.displays.length && !elevator.ride) {
		planesShown = now;
		elevator.show(planes ? `${planes.length} planes` : 'no planes api', '');
	}
	// no planes: the Guardian's boundary gives the rectangle — at once, from
	// where you stand and look (Uli: look straight at the middle of a wall)
	// wait for a real head pose (the first frames report the origin)
	const hp = head(); if (hp.lengthSq() < 1e-6 || Math.abs(hp.y) < 0.3) return;
	if ((!planes || !planes.length) && state.bounded && state.bounded.boundsGeometry && now - state.sessionT0 > 300) {
		const pts = state.bounded.boundsGeometry.map(q => new THREE.Vector3(q.x, 0, q.z));
		if (pts.length >= 3) { fitRoom(pts, [], [], 0, 'bounds'); return; }
	}
	if (!planes || !planes.length) {
		if (!state.bounded && now - state.sessionT0 > 300 && !state.lookSet) {
			// no boundary either: turn the room to the look, its north wall 1.5 m ahead
			state.lookSet = true;
			const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())); look.y = 0; look.normalize();
			const yaw = Math.atan2(-look.x, -look.z);
			const h = head(), D = state.room ? state.room.D : state.settings.D;
			world.rotation.y = yaw;
			world.position.set(h.x + look.x * (1.5 - D / 2), 0, h.z + look.z * (1.5 - D / 2));
			if (elevator.displays.length) elevator.show('turned to you', '');
		}
		return;
	}
	for (const plane of planes) {
		const pose = frame.getPose(plane.planeSpace, ref);
		if (!pose) continue;
		const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
		const pts = plane.polygon.map(q => new THREE.Vector3(q.x, q.y, q.z).applyMatrix4(m));
		const label = plane.semanticLabel || '';
		const normal = new THREE.Vector3(0, 1, 0).transformDirection(m);
		const entry = { pts, normal, label };
		if (plane.orientation === 'vertical' || label === 'wall') walls.push(entry);
		else if (label === 'ceiling' || (plane.orientation === 'horizontal' && pts[0].y > 1.5)) ceilings.push(entry);
		else if (label === 'floor' || plane.orientation === 'horizontal') floors.push(entry);
	}
	if (!floors.length || walls.length < 2) return;
	const floor = floors.reduce((a, b) => a.pts.length >= b.pts.length ? a : b);
	fitRoom(floor.pts, walls, ceilings, floor.pts.reduce((y, p) => y + p.y, 0) / floor.pts.length, 'planes');
}

// Fit the room to a floor polygon: the direction from the walls' normals
// when there are walls, else from the polygon's longest edge; the
// rectangle in that direction; the height from the ceiling or the walls.
function fitRoom(floorPts, walls, ceilings, floorY, source) {
	let theta;
	if (walls.length) {
		// each wall's normal, folded into a quarter turn, weighted by length
		let sx = 0, sy = 0;
		for (const w of walls) {
			const a = Math.atan2(w.normal.x, w.normal.z);
			let len = 0; for (let i = 0; i < w.pts.length; i++) len += w.pts[i].distanceTo(w.pts[(i + 1) % w.pts.length]);
			sx += Math.cos(4 * a) * len; sy += Math.sin(4 * a) * len;
		}
		theta = Math.atan2(sy, sx) / 4;
	} else {
		// a boundary drawn by hand is many short wobbly edges: the angle that
		// gives the smallest box round the polygon is the walls' direction
		let bestA = 0, bestArea = Infinity;
		for (let deg = 0; deg < 90; deg += 0.5) {
			const a = deg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
			let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
			for (const p of floorPts) { const x = p.x * c - p.z * sn, z = p.x * sn + p.z * c; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
			const area = (x1 - x0) * (z1 - z0);
			if (area < bestArea) { bestArea = area; bestA = a; }
		}
		theta = bestA;                                    // the scan rotates as fitRoom does below, so the angle carries straight over
	}
	const rot = new THREE.Matrix4().makeRotationY(-theta);
	let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
	for (const p of floorPts) { const q = p.clone().applyMatrix4(rot); minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z); }
	let W = maxX - minX, D = maxZ - minZ;
	if (W < 1.5 || D < 1.5) return;
	const centreLocal = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
	const centre = centreLocal.applyMatrix4(new THREE.Matrix4().makeRotationY(theta));
	const H = ceilings.length ? Math.max(2.2, ceilings[0].pts[0].y - floorY) : Math.max(2.2, Math.min(3.2, walls.reduce((h, w) => Math.max(h, ...w.pts.map(p => p.y)), 0) - floorY || 2.6));

	// of the four turns that keep the walls on the walls, the one whose
	// north wall is the wall you are looking at (the lift then stands in
	// the corner to your front right)
	const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())); look.y = 0; look.normalize();
	let best = null;
	for (let k = 0; k < 4; k++) {
		const yaw = theta + k * Math.PI / 2, odd = k % 2 === 1;
		const w = odd ? D : W, d = odd ? W : D;
		const north = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
		const dot = north.dot(look);
		if (!best || dot > best.dot) best = { yaw, W: w, D: d, dot };
	}
	state.real = { W: Math.round(best.W * 20) / 20, D: Math.round(best.D * 20) / 20, H: Math.round(H * 20) / 20, yaw: best.yaw, centre, walls: walls.length, source };
	console.info(`real room ${state.real.W} × ${state.real.D} × ${state.real.H} from ${source}, ${walls.length} walls, turned ${(best.yaw * 180 / Math.PI).toFixed(0)}°`);

	world.position.set(centre.x, floorY, centre.z);
	world.rotation.y = best.yaw;
	state.settings.H = state.real.H;                    // for this session: the lines, the cabin
	roomList = null;                                     // every year re-planned for this room
	state.room = null;                                   // the room and cabin rebuilt
	const key = rooms().some(r => r.key === state.roomKey) ? state.roomKey : (rooms().find(r => r.year === state.year) || rooms()[0]).key;
	hangRoom(key);
	elevator.setDoors(1); elevator.open = 1;
	if (elevator.displays.length) elevator.show(`${state.real.W} × ${state.real.D} ${source === 'planes' ? 'walls' : 'boundary'}`, '');
}

renderer.setAnimationLoop((now, frame) => {
	if (frame) stepPlanes(frame);
	elevator.step(now);
	stepWalk(now);
	stepVideos(now);
	stepMode(now);
	renderer.render(scene, camera);
	if (stats) stepStats(now);
});

// Test-harness handle only: the plan's browser checks read the scene graph
// and camera through this. Nothing on the page uses it.
window.G = { scene, camera, renderer, state, buildRoom, applyMode, makePiece, rooms, hangRoom, walk, stepWalk, elevator, pressAt, setSetting, materials, rig, world, placeBody, lift, stepPlanes, stepVideos, videoCache, makeVideoPanel };
