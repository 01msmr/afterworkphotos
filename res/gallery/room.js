import * as THREE from '../vendor/three.module.js';
import { CABIN_LAMP, lightPanel, metal } from './elevator.js?v=20260912a';
import { ENV_INTENSITY, poolMaterial, tex } from './frames.js?v=20260912a';
import { camera, renderer, scene } from './scene.js?v=20260912a';
import { state } from './state.js?v=20260912a';

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

// The floor of a room is its year's, and stays it, so a year is remembered
// by what one stands on (Uli, 2026-09-05): the entry floor a grey lacquer,
// every other year a texture of its own — ambientCG sets in res/textures
// (see LICENSE.txt there). `metres` is what one tile of the texture covers
// on the floor; the metals carry a metalness map. A year not in the table
// takes a spare, in turn.
const FLOORS = {
	lacquer:         { colour: { light: 0x56575a, dark: 0x232325 }, roughness: 0.3 },
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

// The walls follow the floor (Uli, 2026-09-06, from a swatch page): the
// paint, and under it one of — a dado (the lower part in a second colour,
// a thin rail on its top edge, its height the style's), a skirting board,
// or wood panelling with inlaid frames (the gallery's maple or walnut;
// never wood on a wood floor). Most rooms stay quiet, a few carry colour.
// At night the paint goes to a ninth, the rest to a third (wallDark).
export const WALL_STYLES = {
	lacquer:         { paint: 0xf4f4f2 },
	herringbone:     { paint: 0xf3efe6, dado: { h: 0.9,  colour: 0xe9e1d2 }, rail: 0xc9bda8 },
	concrete:        { paint: 0xe8e8e6, dado: { h: 0.9,  colour: 0xbdbcb8 }, rail: 0x9a9994 },
	warehouse:       { paint: 0xefebe3, dado: { h: 1.1,  colour: 0x4a4744 }, rail: 0x2e2c2a },
	terrazzo:        { paint: 0xf1ead8, dado: { h: 1.0,  colour: 0x3f5a4c }, rail: 0x2e4238 },
	checker:         { paint: 0xdcdcda, dado: { h: 0.7,  colour: 0x3b3b3b }, rail: 0x3a3a3a },
	marble:          { paint: 0xf5f5f3, skirting: { h: 0.15, floor: 'marble' } },
	basket:          { paint: 0xf2ede4, dado: { h: 0.9,  colour: 0xe6dfd2 }, rail: 0xb8ad9a },
	checkered:       { paint: 0xf0e9d8, dado: { h: 1.2,  colour: 0x6e3f3a }, rail: 0x1b1b1b },
	'concrete-dark': { paint: 0xddd8ce, dado: { h: 0.6,  colour: 0xb9b2a6 } },
	'planks-dark':   { paint: 0xe4e0d8, dado: { h: 1.0,  colour: 0x4d4640 }, rail: 0x3a3430 },
	'terrazzo-grey': { paint: 0xececea, wainscot: { h: 0.85, wood: 'maple' } },
	'marble-tiles':  { paint: 0xf4f3f0, wainscot: { h: 0.95, wood: 'dark' } },
	plates:          { paint: 0xe2e2e0, dado: { h: 0.75, colour: 0xa9a9a6 } },
	rubber:          { paint: 0x8d8b86, dado: { h: 1.0,  colour: 0x5a5855 } },
};
const wallDark = (hex, k) => { const c = new THREE.Color(hex).multiplyScalar(k); return c.getHex(); };
export const wallColours = (hex, k = 0.11) => ({ light: hex, dark: wallDark(hex, k) });
// how high a style's dado or panelling reaches — the line the pieces stay above
export const dadoTop = style => (style.dado && style.dado.h) || (style.wainscot && style.wainscot.h) || 0;
export function floorOf(year) { return FLOOR_OF_YEAR[year] || SPARE_FLOORS[Number(year) % SPARE_FLOORS.length]; }

// The floor's material: the lacquer is a colour with the room mirrored
// softly in it; a textured floor repeats its tile every `metres`. In dark
// mode the texture is dimmed through the material's colour (applyMode).
function floorMaterial(slug, W, D, perMetre = false) {
	const f = FLOORS[slug];
	if (!f.metres) return { material: new THREE.MeshStandardMaterial({ color: f.colour.light, roughness: f.roughness, metalness: 0, envMapIntensity: 0.6 }), colours: f.colour };
	const t = kind => tex(`floor-${slug}-${kind}.jpg`, kind === 'color', (perMetre ? 1 : D) / f.metres, (perMetre ? 1 : W) / f.metres);
	const material = new THREE.MeshStandardMaterial({
		map: t('color'), roughnessMap: t('rough'), normalMap: t('normal'), normalScale: new THREE.Vector2(0.7, 0.7),
		metalnessMap: f.metal ? t('metalness') : null, metalness: f.metal ? 1 : 0, roughness: 1, envMapIntensity: f.metal ? 0.5 : 0.35,
	});
	// under the day's fills a texture at full colour washed out (Uli): two thirds
	return { material, colours: { light: 0xa8a8a8, dark: 0x3a3a3a } };
}
const CEILING = { light: 0xffffff, dark: 0x141414 };
// Proportions relative to the settings' room: as set, wider and shallower, deeper and narrower.
const SHAPES = [[1, 1], [1.2, 0.85], [0.85, 1.25]];

function hashKey(key) {
	let h = 7;
	for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return h;
}
export function shapeOf(key) {
	if (state.real) return state.real.shape || rectRoom(state.real.W, state.real.D);   // a real room is the room, for every year
	const [fw, fd] = SHAPES[(hashKey(key) >>> 3) % SHAPES.length];   // unsigned shift: a signed one can go negative
	const r = v => Math.round(v * 2) / 2;                 // to the half metre
	return rectRoom(r(state.settings.W * fw), r(state.settings.D * fd));
}
// A room is a shape: its bounding box W × D centred on the origin, `rects`
// a decomposition into rectangles (largest first; a chamfered corner's
// triangle in none), and `outline` its corners from the north-east corner
// walking the east wall southward — axis-aligned edges, or a 45° one
// where a corner is cut. A rectangle: one rect, four corners.
export function rectRoom(W, D) {
	return { W, D, rects: [{ x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 }], outline: [[W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2], [-W / 2, -D / 2]] };
}

// A Lambert wall gets the ambient and the hemisphere fill over π, so an
// off-white wall needs about three units of the two together to render
// near its paint: with these it stands at its paint by day (Uli,
// 2026-09-05: the walls had read mid-grey), never blown white.
// A wall's dressing, as children of the wall's plane (its local +z is the
// room): the dado a plane a hair proud, the rail and the skirting thin
// boxes, the panelling the wood with a canvas of inlaid frames over it
// and a cap rail. `top` is the dado's or panelling's height in this room
// — the style's, or less where the room's tallest piece needs the wall.
export function dressWall(wall, style, H, top, mode) {
	const w = wall.geometry.parameters.width;
	const add = (mesh, name, colours) => { mesh.name = name; mesh.userData.colours = colours; mesh.material.color.setHex(colours[mode]); wall.add(mesh); return mesh; };
	const plane = (ww, hh, y, z, colour, k) => add(new THREE.Mesh(new THREE.PlaneGeometry(ww, hh), new THREE.MeshLambertMaterial({ color: colour })), 'dado', wallColours(colour, k)).position.set(0, y - H / 2, z);
	const bar = (hh, depth, y, colour, name, k = 0.35) => add(new THREE.Mesh(new THREE.BoxGeometry(w, hh, depth), new THREE.MeshLambertMaterial({ color: colour })), name, wallColours(colour, k)).position.set(0, y - H / 2, depth / 2);
	if (style.dado && top > 0) {
		plane(w, top, top / 2, 0.002, style.dado.colour, 0.35);
		if (style.rail) bar(0.025, 0.012, top, style.rail, 'rail');
	}
	if (style.skirting) {
		const sk = style.skirting, m = new THREE.MeshLambertMaterial(sk.floor ? { map: tex(`floor-${sk.floor}-color.jpg`, true, sk.h / 0.5, w / 0.5) } : { color: sk.colour });
		add(new THREE.Mesh(new THREE.BoxGeometry(w, sk.h, 0.015), m), 'skirting', wallColours(0xffffff, 0.35)).position.set(0, sk.h / 2 - H / 2, 0.0075);
	}
	if (style.wainscot && top > 0) {
		const wood = style.wainscot.wood, rx = w / 0.5, ry = top / 0.5;
		const m = new THREE.MeshStandardMaterial({ map: tex(`wood-${wood}-color.jpg`, true, ry, rx), roughnessMap: tex(`wood-${wood}-rough.jpg`, false, ry, rx), normalMap: tex(`wood-${wood}-normal.jpg`, false, ry, rx), normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1, metalness: 0, envMapIntensity: 0.3 });
		add(new THREE.Mesh(new THREE.PlaneGeometry(w, top), m), 'wainscot', wallColours(0xffffff, 0.35)).position.set(0, top / 2 - H / 2, 0.006);
		// the inlaid frames: one panel cell drawn once, repeated every 0.7 m
		const frames = new THREE.Mesh(new THREE.PlaneGeometry(w, top), new THREE.MeshBasicMaterial({ map: panelFrames(w / 0.7), transparent: true, depthWrite: false }));
		add(frames, 'wainscot-frames', wallColours(0xffffff, 0.35)).position.set(0, top / 2 - H / 2, 0.0065);
		bar(0.03, 0.02, top, wood === 'maple' ? 0xd8c7a3 : 0x4a3626, 'cap');
	}
}
// A canvas of one panel's inlaid frame — a light line above a dark one,
// the raised moulding — tiled `across` times along the wall.
function panelFrames(across) {
	const c = document.createElement('canvas'); c.width = 512; c.height = 512;
	const g = c.getContext('2d');
	const box = (inset, colour, width) => { g.strokeStyle = colour; g.lineWidth = width; g.strokeRect(inset, inset, 512 - 2 * inset, 512 - 2 * inset); };
	box(60, 'rgba(0,0,0,0.35)', 6); box(66, 'rgba(255,255,255,0.35)', 4); box(84, 'rgba(255,255,255,0.3)', 3); box(88, 'rgba(0,0,0,0.3)', 5);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(across, 1);
	return t;
}

// The warm pool each print throws on the wall behind it. By day it is
// turned down: at full strength the white walls read as glowing rather
// than white (Uli, 2026-09-11). At night the pools are most of the light
// there is, so they stay.
const POOL = { light: 0.62, dark: 1 };
const AMBIENT = { light: 1.9,  dark: 0.08 };
const FILL    = { light: 1.4,  dark: 0.06 };

export function buildRoom(W, D, H, floor = 'lacquer', dadoCap = Infinity, shape = null) {
	shape = shape || rectRoom(W, D);
	const room = new THREE.Group();
	room.name = 'room';
	const style = WALL_STYLES[floor] || WALL_STYLES.lacquer;

	const mode = state.settings.dark ? 'dark' : 'light';
	const COLOURS = { wall: wallColours(style.paint), ceiling: CEILING };
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

	// The floor and the ceiling are the plan itself — a rectangle, or the
	// L or U of a scanned room (Uli, 2026-09-10). A ShapeGeometry's UVs are
	// the plan's own metres, so the floor's texture repeats per metre
	// rather than once over the room.
	const plan = new THREE.Shape(shape.outline.map(([x, z]) => new THREE.Vector2(x, -z)));
	const fl = floorMaterial(floor, W, D, true);
	const floorGeo = new THREE.ShapeGeometry(plan); floorGeo.rotateX(-Math.PI / 2);
	const ceilGeo = new THREE.ShapeGeometry(new THREE.Shape(shape.outline.map(([x, z]) => new THREE.Vector2(x, z)))); ceilGeo.rotateX(Math.PI / 2);
	const face = (name, key, geo, y, material = mat(key), colours = COLOURS[key]) => {
		const m = new THREE.Mesh(geo, material);
		m.name = name; m.position.y = y; m.receiveShadow = true;
		m.userData.surface = key; m.userData.colours = colours;
		m.material.color.setHex(colours[mode]);
		room.add(m);
	};
	face('floor', 'floor', floorGeo, 0, fl.material, fl.colours);
	face('ceiling', 'ceiling', ceilGeo, H);

	// A wall per edge of the plan, facing the room: the edge's inward
	// normal is (−dz, dx), the plane turned to it.
	shape.outline.forEach(([x, z], i) => {
		const [qx, qz] = shape.outline[(i + 1) % shape.outline.length];
		const len = Math.hypot(qx - x, qz - z);
		if (len < 1e-4) return;
		const dx = (qx - x) / len, dz = (qz - z) / len;
		const name = `wall-${i}`;
		surface(name, 'wall', len, H, [(x + qx) / 2, H / 2, (z + qz) / 2], [0, Math.atan2(-dz, dx || 0), 0]);
		dressWall(room.getObjectByName(name), style, H, Math.min(dadoCap, dadoTop(style)), mode);
	});

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
export function applyMode(dark) {
	state.settings.dark = dark;
	modeAt = performance.now();
}
const _ca = new THREE.Color(), _cb = new THREE.Color();
function applyModeF(f) {
	const mix = (a, b) => a + (b - a) * f;
	for (const name of ['room', 'pieces']) {   // the pieces group for the slabs behind the middle rows
		const g = scene.getObjectByName(name);
		if (!g) continue;
		g.traverse(o => {
		if (o.isMesh && o.userData.colours) o.material.color.copy(_ca.setHex(o.userData.colours.light).lerp(_cb.setHex(o.userData.colours.dark), f));
		if (o.isAmbientLight) o.intensity = mix(AMBIENT.light, AMBIENT.dark);
		if (o.isHemisphereLight) o.intensity = mix(FILL.light, FILL.dark);
		if (o.isDirectionalLight) o.intensity = mix(1.1, 0.9);
		});
	}
	const lamp = scene.getObjectByName('cabin-lamp');
	if (lamp) lamp.intensity = mix(CABIN_LAMP.light, CABIN_LAMP.dark);
	lightPanel.emissiveIntensity = mix(CABIN_PANEL.light, CABIN_PANEL.dark);
	scene.environmentIntensity = mix(ENV_INTENSITY.light, ENV_INTENSITY.dark);
	poolMaterial.opacity = mix(POOL.light, POOL.dark);
}
export function stepMode(now) {
	const target = state.settings.dark ? 1 : 0;
	if (modeF === target) { modeAt = null; return; }
	const dt = modeAt === null ? MODE_T : now - modeAt;
	modeAt = now;
	modeF = target > modeF ? Math.min(target, modeF + dt / MODE_T) : Math.max(target, modeF - dt / MODE_T);
	applyModeF(modeF);
}
