import * as THREE from '../vendor/three.module.js';
import { walnut } from './elevator.js?v=20260915g';
import { renderer, scene } from './scene.js?v=20260915g';
import { state } from './state.js?v=20260915g';

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

export const FRAME = { face: 0.03, depth: 0.03, chamfer: 0.0015 };   // a square section (Uli), a 1.5 mm chamfer on the long edges
const MAT = { 0.9: 0.09, 0.6: 0.06, 0.4: 0.045 };     // mat width per nominal print size: the spec's 6/4/3 plus half (Uli)
export const MAT_Z = 0.014;                                   // the mat 14 mm off the wall: 8 mm further forward (Uli)
export const PRINT_SCALE = 0.9;                               // the print inside is a little smaller than nominal, the mat takes the rest (Uli)
export const MAT_COLOURS = { white: 0xfaf9f6, warm: 0xf3ecdd, none: 0xfaf9f6 };

// The mat's width for a nominal size under the current settings ('none'
// runs the print to the frame), and the overall scale (100 % or 80 %, for
// a small real room) that every dimension of a framed print follows.
export const matWidth = size => state.settings.mat === 'none' ? 0 : MAT[size];
export const sc = () => state.settings.scale;
export const GRID_GAP = 0.08;                                 // between frames in a grid

const FRAME_COLOURS = { oak: 0xb08d57, walnut: 0x5b4633, black: 0x171717, white: 0xf4f2ee };

// Materials are shared: one per frame colour, one mat, one line. Switching
// the frame colour (task 1.6) recolours the shared material once.
// Photographed textures (ambientCG, CC0 — res/textures/LICENSE.txt): a
// light oak and a dark hardwood for the frames, a clean shiny steel for
// the lift. Each is colour, roughness and normal; the metal has its
// metalness too. The frame bars' UVs are in metres (ExtrudeGeometry), so
// a tile every half metre; the cabin's boxes stretch one tile per face.
const texLoader = new THREE.TextureLoader();
export function tex(file, srgb, repeat, along = repeat) {
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
export function applyFrameLook(m, name) {
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
// the environment's reflections — steel, walnut, caps — which no light
// switches off: they fade with the night too (applyModeF)
export const ENV_INTENSITY = { light: 1, dark: 0.12 };
// A print keeps its daylight face at night (Uli, 2026-09-13: the pictures
// were too dark in dark mode — make them look as they do by day, without
// making them shine like a light source). The room's ambient and fill go
// from 1.9/1.4 to 0.08/0.06, which takes about four fifths of the light
// off a print, and there is no way to light one alone: three.js tests a
// light's layers against the **camera's**, not the object's, so a light
// for the prints only would light everything or nothing. What is left is
// the print's own emissive, mixed with the mode like everything else.
// The dark value is **measured, not guessed**: a 90 cm print rendered to
// an offscreen target from a metre away, straight on, reads 65.7 by day.
// The road to 0.6, all of it measured the same way:
//   0.16  reads 12.5 — a fifth of daylight. Too dark (Uli, 2026-09-13).
//   1.02  reads 65.6 — its own daylight face to a fifth of a percent, and
//         **too lit** in the room: matching the day exactly makes a print
//         the brightest thing in a dark gallery, which reads as a lamp
//         however faithful the number is (Uli).
//   1.6   reads 100.8, half again brighter than day. Never.
//   0.6   reads about 40 — half way between the dark it was and the day
//         it would be. A picture you can see at night, in a room that is
//         still night. This is the one (Uli: an in-between of the two).
// The Lambert term still carries the rest, so a print goes on dimming as
// you come at it from the side, which is what kept them from reading as
// lamps in the first place (Uli, 2026-09-11).
export const PRINT_GLOW = { light: 0.16, dark: 0.6 };
scene.environmentIntensity = ENV_INTENSITY[state.settings.dark ? 'dark' : 'light'];
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
export const poolMaterial = new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false });   // turned down by day (room.js, POOL)

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

export const materials = {
	frame: new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 0.5 }),
	mat:   new THREE.MeshLambertMaterial({ color: MAT_COLOURS[state.settings.mat] }),
	rim:   new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
	line:  new THREE.MeshBasicMaterial({ color: 0xe8e4dc, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
	back:  new THREE.MeshLambertMaterial({ map: fadedWood('wood-maple-color.jpg', '#d6c6a4', 0.6) }),   // the cheap pale board closing a frame's back: the grain faded 60 % into a flat colour (Uli)
};

applyFrameLook(materials.frame, state.settings.frame);

const textures = new THREE.TextureLoader();
export const textureCache = new Map();
// What a print carries as it hangs, and what it swaps to when someone
// comes up to it (Uli, 2026-09-13): **the photograph's own file, which is
// 1200** — the site shows the same one, so there is one set and not two —
// and the largest file there when a visitor is within 1.2 m. A 90 and a
// 60 take the 1200 whole; a 40 in a grid is shrunk to 512 px on a canvas,
// a quarter of the memory, since nobody reads a grid print from close to.
// A 2000 px square costs 16 MB of video memory against 6 MB at 1200, so
// it is worth having for the one or two prints a visitor is actually
// standing at, and ruinous for a whole room at once — the more so in a
// room hung with two or three times the frames, where the wall's 1200s
// are already the larger bill. The texture's image stays empty until
// loaded, which is what the lift waits for. Textures of a room you have
// left are freed.
const PHOTO_PX = { 0.9: 1200, 0.6: 1200, 0.4: 512 };
const NEAR_PX = 2000;
const name = p => p.file.slice(p.file.lastIndexOf('/') + 1);
export function photoTexture(p, size) {
	const px = PHOTO_PX[size] || 1200;                // 1200 is the photograph's own file: an unlisted size takes it whole
	const key = `${p.n}@${px}`;
	if (!textureCache.has(key)) {
		const t = new THREE.Texture();
		t.colorSpace = THREE.SRGBColorSpace;
		t.anisotropy = 8;                        // prints seen at an angle stay sharp; the Quest 3 affords it (Uli, 2026-09-05)
		const img = new Image();
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
		img.src = '/' + p.file;                  // photos.json paths are relative to the site root; the file itself is the 1200
		textureCache.set(key, t);
	}
	return textureCache.get(key);
}

// The same photograph at its largest, for a visitor standing close. It
// tries the 2000 px set and falls back to the plain 1200 — so it is
// always the best that exists, whatever has been made. (The 1600 set
// that once sat between the two is gone, 2026-09-13.)
export function nearTexture(p) {
	const key = `${p.n}@near`;
	if (!textureCache.has(key)) {
		const t = new THREE.Texture();
		t.colorSpace = THREE.SRGBColorSpace;
		t.anisotropy = 8;
		const img = new Image();
		const tries = [`img/${NEAR_PX}/${name(p)}`, p.file];
		let at = 0;
		img.onerror = () => { if (++at < tries.length) img.src = '/' + tries[at]; };
		img.onload = () => img.decode().catch(() => {}).then(() => {
			t.image = img; t.needsUpdate = true; renderer.initTexture(t);
		});
		img.src = '/' + tries[0];
		textureCache.set(key, t);
	}
	return textureCache.get(key);
}
export function dropNear(p) {
	const key = `${p.n}@near`;
	const t = textureCache.get(key);
	if (t) { t.dispose(); textureCache.delete(key); }
}
