import * as THREE from '../vendor/three.module.js';
import { renderer, scene } from 'gallery/scene';
import { state } from 'gallery/state';

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

export const FRAME = { face: 0.03, depth: 0.03, radius: 0.002 };   // a square section (Uli), its four long edges rounded 2 mm (Uli, 2026-09-13; a 1.5 mm chamfer before)
const MAT = { 0.9: 0.09, 0.6: 0.06, 0.4: 0.045 };     // mat width per nominal print size: the spec's 6/4/3 plus half (Uli)
// ---------------------------------------------------------------------------
// STEPS: what stands on what, and how the depth buffer is told
//
// The headset's depth buffer resolves 2.7 mm at three metres if it is
// 16 bits deep (near 0.05), and everything in this gallery that lies a
// hair off something else flickered against it (Uli, 2026-09-13, all
// day): a print over its mat, the print's shadow under it, a year over
// its cap, a pocket in the plate, a dot on a card. Millimetres cannot
// win that — but a polygon offset's **units** are whole steps of the
// depth buffer, whatever a step happens to be, so a layer pushed by
// units stands in front of the layer under it at any distance and any
// depth. Every stack has its ladder, small enough (eight steps at most,
// under 3 mm at a metre with 16 bits, microns with 24) that nothing can
// climb through a frame bar or a board:
//   wall 0 · pool -2 · rim -2 · mat 0 · print -4 · near sheet -6
//   plate 0 · pocket -2 · steel -4 · cap -6 · year -8
//   card 0 · dot -8;   dado/wainscot -2 · inlaid frames -4
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
// **One texture per file and tiling, however often it is asked for** (Uli,
// 2026-09-13: the button plate glitched as the doors shut). The cabin is
// built afresh with every room, and its console asked for its walnut each
// time — three files fetched, decoded and sent up again while the visitor
// stood in front of it, the plate black until they landed. Asked for a
// second time, a texture is the one already there.
const texCache = new Map();
export function tex(file, srgb, repeat, along = repeat) {
	const key = `${file}|${srgb}|${repeat}|${along}`;
	if (texCache.has(key)) return texCache.get(key);
	// **Through the same queue as the photographs** (2026-09-18: two long
	// frames were left just after the hang — a new floor's three or four
	// 1024s arriving together, as <img>s with flipY on, which is the CPU
	// copy). Decoded off the thread and turned over there
	// (`imageOrientation`), so the texture's own flipY is off and the UVs
	// stay as they were; sent up in its turn (stepUploads).
	const t = new THREE.Texture();
	t.flipY = false;
	fetch('/res/textures/' + file)
		.then(r => { if (!r.ok) throw new Error(`${r.status} ${file}`); return r.blob(); })
		.then(b => decode(b, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
		.then(bmp => uploads.push([t, bmp]))
		.catch(e => console.warn('texture not loaded', e));
	texCache.set(key, t);
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	// the bars' u runs their length and the images' grain runs their x, so
	// no turn: grain along the bar (Uli), stretched by `along`
	t.repeat.set(along, repeat);
	t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
	if (srgb) t.colorSpace = THREE.SRGBColorSpace;
	return t;
}
// A room's floor maps go with the room: let go of whole — the GPU's copy,
// the bitmap, the cache's entry — so the floor's next visit asks afresh
// and comes up through the queue, not all at once at its first draw as a
// disposed texture still holding its image does.
export function dropTex(t) {
	for (const [k, v] of texCache) if (v === t) texCache.delete(k);
	t.dispose();
	t.userData.freed = true;
	if (t.image && t.image.close) t.image.close();
}
// stretched one and a half times along the bar, so the grain runs calmer (Uli)
const woodSet = n => ({ map: tex(`wood-${n}-color.jpg`, true, 2, 2 / 1.5), roughnessMap: tex(`wood-${n}-rough.jpg`, false, 2, 2 / 1.5), normalMap: tex(`wood-${n}-normal.jpg`, false, 2, 2 / 1.5) });
const WOOD = { maple: woodSet('maple'), light: woodSet('light'), dark: woodSet('dark') };
// **Maple, less red and a little lighter** (Uli, 2026-09-13). It cannot be
// done with the material's tint: that multiplies the picture, so it can
// only ever darken. The wash goes into the picture itself — the grain kept
// and a pale, barely warm coat laid over it, which lifts the whole thing
// and takes the red down with it.
WOOD.maple.map = fadedWood('wood-maple-color.jpg', '#f4efe6', 0.32);
WOOD.maple.map.repeat.copy(WOOD.light.map.repeat);
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
export const poolMaterial = new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 });   // turned down by day (room.js, POOL)

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
	// **A thin seidenmatt lacquer on every frame** (Uli, 2026-09-13): not a
	// gloss, a satin — the wood's own roughness map still does the work,
	// scaled down so the surface holds a soft highlight instead of none
	// at all, with a little more of the room in it. Costs nothing: one
	// material, shared by every frame on every floor.
	frame: new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 0.9 }),
	mat:   new THREE.MeshLambertMaterial({ color: MAT_COLOURS[state.settings.mat] }),
	rim:   new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 }),   // a shadow lies a hair off its surface: two depth steps forward, whatever a step is (see STEPS)
	line:  new THREE.MeshBasicMaterial({ color: 0xe8e4dc, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
	back:  new THREE.MeshLambertMaterial({ map: fadedWood('wood-maple-color.jpg', '#d6c6a4', 0.6) }),   // the cheap pale board closing a frame's back: the grain faded 60 % into a flat colour (Uli)
};

applyFrameLook(materials.frame, state.settings.frame);

export const textureCache = new Map();
// What a print carries as it hangs, and what it swaps to when someone
// comes up to it (Uli, 2026-09-13): **the photograph's own file, which is
// 1200** — the site shows the same one, so there is one set and not two —
// and the largest file there when a visitor is within 1.2 m. A 90 and a
// 60 take the 1200 whole; a 40 in a grid is shrunk to 512 px on the way
// in, a quarter of the memory, since nobody reads a grid print from close
// to. A 2000 px square costs 16 MB of video memory against 6 MB at 1200
// (a third more each with their mipmaps), so it is worth having for the
// one or two prints a visitor is actually standing at, and ruinous for a
// whole room at once — the more so in a room hung with two or three times
// the frames, where the wall's 1200s are already the larger bill. The
// texture's image stays empty until loaded, which is what the lift waits
// for. Textures of a room you have left are freed.
const PHOTO_PX = { 0.9: 1200, 0.6: 1200, 0.4: 512 };
const NEAR_PX = 2000;
const name = p => p.file.slice(p.file.lastIndexOf('/') + 1);
// A file to the GPU **without a hitch**. It used to arrive as an <img>
// with three's default flipY on, and that makes Chromium take the CPU
// path: the decoded 16 MB of a 2000 copied and turned over row by row
// before texImage2D — tens of milliseconds on the headset, mid-walk, at
// the very moment the sheet landed (Uli, 2026-09-13: the swap still
// stuttered once the shader rebuild was gone). Why anything turns it at
// all: WebGL's first texture row is the bottom of the picture, a JPEG's
// is the top, and a plane's UVs put v = 1 at the top. **Nothing flips a
// pixel any more** (Uli): the texture's own flipY is off, the bitmap goes
// up as decoded, and the picture is read upside down instead — a repeat
// of -1 on v, which is a matrix in the shader and costs nothing.
// createImageBitmap decodes off the main thread and hands over a bitmap
// the GPU already holds, so the upload is a copy on the GPU. A shrink for
// a grid's 40s rides in the same call, off the thread too. `files` is
// tried in order — the 2000 first, the 1200 where none was made.
function fetchInto(t, files, px) {
	let at = 0;
	const fit = px ? { resizeWidth: px, resizeHeight: px, resizeQuality: 'high' } : {};
	const next = () => fetch('/' + files[at])
		.then(r => { if (!r.ok) throw new Error(`${r.status} ${files[at]}`); return r.blob(); })
		.then(b => decode(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', ...fit }))
		.then(bmp => { uploads.push([t, bmp]); })   // to the GPU in its turn (stepUploads), not as it lands
		.catch(e => { if (++at < files.length) next(); else console.warn('photo not loaded', e); });
	next();
}
// **A frame sends the GPU a budget of pixels, not whatever has landed**
// (Uli, 2026-09-18: the view wiggles as the doors shut). A room's
// thirty-odd files, asked for together at the hang, land together, and
// each went up as it landed — three and four 1200s to an animation
// frame, 100 ms frames one after another while the headset swims the
// stale picture. That was the wiggle, never the hang (2 to 20 ms). The
// bitmaps queue here and a frame takes `GPU_PX` of them: one 1200, or
// five of a grid's 512s; a 2000 goes alone. **Pixels, not milliseconds**:
// initTexture returns in under a millisecond most of the time and the
// copy is paid later, in the GPU process — a budget of 4 ms let ten
// uploads through and the frame took 40. The label cards draw on the
// same budget (bake.js, stepCards), so a frame carries cards or a
// photograph, not both. **The texture gets its image at its upload**, so
// whatever asks `t.image` — the lift holding its doors, the near sheet
// waiting to show — is asking whether it is on the GPU.
// **And one decode at a time** (2026-09-18, the frame rate at the doors,
// again). With the uploads spread, frames of 30 and 45 ms were left in
// which the loop's own steps took a millisecond: the time was outside
// it — `createImageBitmap` decodes off the thread, but what it hands
// back lands on the main thread, and thirty of them, started together
// at the hang, land together, several to a frame, 15 ms each. Timed
// step by step (frameCost, gallery.js) and proved by serialising the
// decodes from the console: only the hang's own frame was left. So the
// blobs queue here, one decode is in flight at a time, and the next is
// started from stepUploads — a frame decodes one file and sends one up.
// A decode that does not come back within DECODE_WAIT does not hold the
// rest up: the next is started anyway (and its own result still lands).
const decodes = [];
let decoding = 0;                            // when the decode in flight was started, or 0
const DECODE_WAIT = 3000;
const decode = (blob, opts) => new Promise((res, rej) => decodes.push({ blob, opts, res, rej }));
function stepDecodes() {
	if (!decodes.length || (decoding && performance.now() - decoding < DECODE_WAIT)) return;
	const d = decodes.shift();
	const started = decoding = performance.now();
	const free = () => { if (decoding === started) decoding = 0; };
	createImageBitmap(d.blob, d.opts).then(b => { free(); d.res(b); }, e => { free(); d.rej(e); });
}
const GPU_PX = 1.5e6;
export const gpu = { px: 0 };                // what this frame has sent so far
const uploads = [];
export function stepUploads() {
	stepDecodes();
	gpu.px = 0;
	while (uploads.length) {
		const [t, bmp] = uploads[0], px = bmp.width * bmp.height;
		if (gpu.px && gpu.px + px > GPU_PX) break;               // the first of a frame always goes, whatever its size
		uploads.shift();
		if (t.userData.freed) { bmp.close(); continue; }         // let go while it waited
		t.image = bmp; t.needsUpdate = true; renderer.initTexture(t);
		gpu.px += px;
	}
}
export const gpuRoom = px => !gpu.px || gpu.px + px <= GPU_PX;
function emptyTexture() {
	const t = new THREE.Texture();
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 8;                        // prints seen at an angle stay sharp; the Quest 3 affords it (Uli, 2026-09-05)
	t.flipY = false;                         // no pixel is turned; the picture is read bottom-up instead (fetchInto)
	t.repeat.y = -1; t.offset.y = 1;
	return t;
}
export function photoTexture(p, size) {
	const px = PHOTO_PX[size] || 1200;                // 1200 is the photograph's own file: an unlisted size takes it whole
	const key = `${p.n}@${px}`;
	if (!textureCache.has(key)) {
		const t = emptyTexture();
		fetchInto(t, [p.file], px < 1200 ? px : 0);   // photos.json paths are relative to the site root; the file itself is the 1200
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
		const t = emptyTexture();
		fetchInto(t, [`img/${NEAR_PX}/${name(p)}`, p.file], 0);
		textureCache.set(key, t);
	}
	return textureCache.get(key);
}
// Freeing a texture frees its bitmap as well: dispose() lets go of the
// GPU copy, close() of the decoded one, and only the two together give the
// memory back.
export function freeTexture(key) {
	const t = textureCache.get(key);
	if (!t) return;
	t.dispose();
	t.userData.freed = true;                 // a bitmap still queued for it is closed in its turn (stepUploads)
	if (t.image && t.image.close) t.image.close();
	textureCache.delete(key);
}
export function dropNear(p) { freeTexture(`${p.n}@near`); }
