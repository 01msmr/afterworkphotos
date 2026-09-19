import * as THREE from '../vendor/three.module.js';
import { materials, tex, textureCache } from 'gallery/frames';
import { ELEVATOR, FAV_KEY, clearRooms, hangRoom, hangRoomSteps, roomByKey, rooms } from 'gallery/hang';
import { WALL_STYLES, dadoTop, dressWall, edgeLines, wallColours } from 'gallery/room';
import { camera, head, renderer, scene, world } from 'gallery/scene';
import { zoomLabel, zoomPrint } from 'gallery/zoom';
import { stickAt } from 'gallery/sticker';
import { dropAllNear } from 'gallery/video';   // the floor's 2000s, handed back when it is left
import { favCount, state } from 'gallery/state';
import { placeBody, walk } from 'gallery/walk';
import { paper } from 'gallery/paper';

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

export const DOOR = { w: 0.7, h: 2.1, thick: 0.03 };            // 0.7 in a 1.5 m front: an open panel stays behind its jamb (Uli)
const CABIN_WALL = 0.08;
const DISPLAY = { w: 0.44, h: 0.11 };                      // the floor display above the door
const DOOR_T = 1800;                                       // ms for the doors to open or close — the length of their sound
const BELL_GAP = 800;                                      // ms between the bell and the doors
export const BUTTON = { w: 0.06, h: 0.03, rise: 0.006, pitchX: 0.07, pitchY: 0.04, gap: 0.002, r: 0.02 };   // the floor buttons: a rectangular cap, its rise off the steel, the grid, the black gap round it; r: the round call and switch buttons
const PANEL = { low: 1.2, high: 1.8, depth: 0.03, cols: 10, margin: 0.03 };
const FLOOR_PLATE = { w: 0.30, h: 0.10, d: 0.006, font: 150 };   // the engraved floor plate outside (Uli, 2026-09-19): 30 × 10 cm of steel, the label 6 cm high   // its centre at 1.5 m (Uli: 20 cm up), vertical on the wall (Uli), ten across; depth: the walnut block it is the face of

// Brushed steel, matte (Uli): the roughness map is left out so nothing on
// the sheet turns glossy, the environment only just shows in it.
export const metal = new THREE.MeshStandardMaterial({
	map: tex('metal-color.jpg', true, 1), metalnessMap: tex('metal-metalness.jpg', false, 1),
	normalMap: tex('metal-normal.jpg', false, 1), normalScale: new THREE.Vector2(0.5, 0.5),
	metalness: 1, roughness: 0.85, envMapIntensity: 0.45,
});
const cabinInner = new THREE.MeshLambertMaterial({ color: 0xcfccc5 });
const displayBack = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.4, metalness: 0.2 });
const cabinFloor = new THREE.MeshLambertMaterial({ color: 0x5a5854 });
const panelPlate = new THREE.MeshStandardMaterial({ color: 0x2b2b2d, metalness: 0.5, roughness: 0.45 });   // anthracite: the switchplate outside
const GREEN = 0x46ff7a, MILK = 0xe4e2dc;   // the lit floor; a cap's milky white — a touch greyer than 0xefece4 (Uli, 2026-09-19: slightly more greyish)                                                                                    // the lit floor
const pocketMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 });   // the black gap round a button: a millimetre proud of the plate, two depth steps before it (frames.js, STEPS)
const steelMat = metal.clone(); Object.assign(steelMat, { polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -4 });   // the button's floor, two more
export const lightPanel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 1.6, roughness: 1 });
export const CABIN_LAMP = { light: 5, dark: 0.5 }, CABIN_PANEL = { light: 1.6, dark: 0.2 };   // the cabin at night: dim (Uli, 2026-09-19: darker than the 0.9 / 0.35 it had)

// The print on a button: the year, left-aligned, in Jost Light (loaded
// before the first room, see the start); a split year's floors are
// "2018.1", "2018.2", the suffix smaller on the same baseline (Uli).
// Drawn on a clear canvas: the cap under it shows through.
// The favourites button carries **the sticker**, not a year — it is the one
// floor without one, and the dot says both what the floor is and what fills
// it (Uli, 2026-09-13). The cap behind it does the empty/normal work, so
// this face never changes.
// **It says 'favourites'** (Uli, 2026-09-13, after a day as the dot): the
// word in the years' own face, on a cap two buttons and their margin
// wide, lit in the sticker's red rather than the floors' green.
const FAV_RED = 0xc8322b, FAV_LIT = 0x5a2a2a;
const FAV_W = BUTTON.w + BUTTON.pitchX;        // two caps and the gap between
// The year on a button cap: a canvas apiece in Jost, on the clear plane
// that takes the press. (A day on the shared distance-field atlas,
// 2026-09-13, and back: its contours crawled in stereo.) **512 x 256 and
// filtered anisotropically** (Uli, 2026-09-13: fuzzy, read sideways): the
// plate stands beside the door and is only ever seen at an angle, and a
// 256 canvas was just the panel's own count at 40 cm — the 512 is drawn
// in the old 256 space, so the numbers mean what they did. 512 KB each,
// thirty-odd of them.
const FACE_PX = 512;
// `wide`: the cap's width in caps — the favourites' word gets a wider one,
// the same face and the same left margin
// **The years are drawn once, into one atlas, and worn by the caps
// themselves** (2026-09-19, the frame rate in the cabin): every button
// used to carry a clear print 1.2 mm before its cap, a transparent draw
// call each and a layer to flicker against — 23 of them at the plate.
// Now the cap's front face samples its cell of a 4096 px atlas (a cell a
// face, the favourites two across), the sides and back a blank cell, and
// the same atlas is the emissive map, so the lit cap's glow leaves the
// letters dark as the print over it did. The letters are drawn as they
// were: a 256-space scaled to FACE_PX, Jost 300, the part after the year
// smaller.
const ATLAS_COLS = 8;
function faceAtlas(entries) {
	const cells = [], rows = [];                    // cells: {cx, cy, wide} per entry; a cell is FACE_PX × FACE_PX / 2
	let cx = 1, cy = 0;                             // cell 0 of row 0 stays blank paper, for the sides and the back
	for (const e of entries) {
		if (cx + e.wide > ATLAS_COLS) { cx = 0; cy++; }
		cells.push({ cx, cy, wide: e.wide }); cx += e.wide;
	}
	const nRows = cy + 1;
	const c = document.createElement('canvas'); c.width = ATLAS_COLS * FACE_PX; c.height = nRows * FACE_PX / 2;
	const g = c.getContext('2d');
	g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
	const font = px => `300 ${px}px Jost, "Helvetica Neue", Arial, sans-serif`;
	entries.forEach((e, i) => {
		const { cx, cy } = cells[i];
		g.save();
		g.translate(cx * FACE_PX, cy * FACE_PX / 2);
		g.scale(FACE_PX / 256, FACE_PX / 256);
		g.fillStyle = e.room.favs ? '#c8322b' : '#1d1c1a';
		g.textAlign = 'left'; g.textBaseline = 'middle';
		g.font = font(56);
		g.fillText(e.year, 36, 66);
		if (e.room.of > 1) { const w = g.measureText(e.year).width; g.font = font(45); g.fillText(`.${e.room.part}`, 36 + w + 2, 66); }
		g.restore();
	});
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = renderer.capabilities.getMaxAnisotropy();
	return { tex: t, cells, rows: nRows };
}
// A cap's UVs pointed at its cell: the front face (normal -z, the one the
// cabin sees) spread over the cell — mirrored in u, since a face looked
// at from -z has its +x on the viewer's left — every other face at the
// blank cell's corner.
function faceUVs(geo, bw, h, cell, rows) {
	geo = geo.clone();
	const P = geo.attributes.position, N = geo.attributes.normal, uv = geo.attributes.uv;
	for (let i = 0; i < P.count; i++) {
		if (N.getZ(i) < -0.5) {
			const u = 0.5 - P.getX(i) / bw, v = P.getY(i) / h + 0.5;
			uv.setXY(i, (cell.cx + u * cell.wide) / ATLAS_COLS, 1 - (cell.cy + 1 - v) / rows);
		} else uv.setXY(i, 0.02 / ATLAS_COLS, 1 - 0.02 / rows);
	}
	uv.needsUpdate = true;
	return geo;
}

// **A button's plan has 1.5 mm corners, and its depth faces are 12 %
// darker than its front** (Uli, 2026-09-18). A rounded rectangle pushed
// out along z and centred on it, like the box it replaces. The darker
// sides are vertex colours — 0.88 where the normal lies in the plane — so
// a cap is still one material and one draw call, and light() goes on
// setting one colour; the lit cap's glow is emissive and stays whole.
const CORNER = 0.0015, SIDE_DARK = 0.88;
function roundedBox(w, h, d, r = CORNER) {
	const x = w / 2, y = h / 2, sh = new THREE.Shape();
	sh.moveTo(-x + r, -y); sh.lineTo(x - r, -y); sh.absarc(x - r, -y + r, r, -Math.PI / 2, 0);
	sh.lineTo(x, y - r); sh.absarc(x - r, y - r, r, 0, Math.PI / 2);
	sh.lineTo(-x + r, y); sh.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI);
	sh.lineTo(-x, -y + r); sh.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5);
	const geo = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false, curveSegments: 4 });
	geo.translate(0, 0, -d / 2);
	const n = geo.attributes.normal, col = new Float32Array(n.count * 3);
	for (let i = 0; i < n.count; i++) col.fill(Math.abs(n.getZ(i)) > 0.5 ? 1 : SIDE_DARK, i * 3, i * 3 + 3);
	geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
	return geo;
}
// the round buttons' bodies are all side: the steel, 12 % darker
const sideMetal = metal.clone(); sideMetal.color.multiplyScalar(SIDE_DARK);

// Boxes already set in place, welded into one geometry.
function merged(geos) {
	const pos = [], nor = [], uv = [], idx = [];
	let base = 0;
	for (const g of geos) {
		const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, I = g.index;
		pos.push(...P.array); nor.push(...N.array); uv.push(...U.array);
		if (I) for (let i = 0; i < I.count; i++) idx.push(I.getX(i) + base);
		else for (let i = 0; i < P.count; i++) idx.push(i + base);       // an extrusion has no index
		base += P.count;
		g.dispose();
	}
	const out = new THREE.BufferGeometry();
	out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
	out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	out.setIndex(idx);
	return out;
}

// The floor display: the room you are on; during a ride, each floor
// passed, with the direction. Drawn on a canvas, shown inside and out.
function drawDisplay(ctx, text, arrow, note = '') {
	const c = ctx.canvas;
	ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, c.width, c.height);
	// a small line in the corner, for what the headset gives (gallery.js, the probe)
	if (note) { ctx.fillStyle = '#7a5a2a'; ctx.font = '400 24px "Helvetica Neue", Arial, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.fillText(note, c.width - 10, c.height - 10); }
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
export function roomLabel(room) {
	if (room.favs) return room.span;                // 'favourites', never its sorting year 9999 (Uli, 2026-09-13)
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
export const SOUND = {
	ride:  { file: '/res/sound/ride.mp3', run: [0.6, 8.4], stop: [8.4, 11.7], door: [13.3, 15.3] },
	bell:  { file: '/res/sound/bell.mp3' },
	call:  { file: '/res/sound/call.mp3', hum: [1.0, 6.0] },        // the lift coming, heard from outside
};
const STOP_LEN = SOUND.ride.stop[1] - SOUND.ride.stop[0];

export const lift = {
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
	// a ride of `seconds`: the start and the run for what is left after
	// the stop — the recording's run played over again, overlapping a
	// little, when the ride outlasts it — then the stop
	run(seconds) {
		if (!this.ready() || !this.buf.ride) return;
		const R = SOUND.ride, ctx = this.ctx, t = ctx.currentTime;
		const runLen = Math.max(0.4, seconds - STOP_LEN);
		// one source: the recording from its start, its steady middle looped
		// for as long as the ride runs (Uli: a ride must not start over)
		const src = ctx.createBufferSource(); src.buffer = this.buf.ride;
		src.loop = true; src.loopStart = R.run[0] + 2.0; src.loopEnd = R.run[1] - 0.2;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.03);
		g.gain.setValueAtTime(1, t + runLen - 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + runLen);
		src.connect(g); g.connect(this.master);
		src.start(t, R.run[0]); src.stop(t + runLen + 0.02);
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

// (The switchplate, its map on B and the recentre went on 2026-09-19:
// the settings are the paper sheet now, gallery/paper.js.)

// The shaft in the door seam (Uli): the two leaves close with a narrow
// gap between them, centred, and in it the shaft shows — during the ride
// the shaft wall passes, a floor's divider slab and its lit landing for
// every floor passed, one more hint that the cabin moves. One storey of
// shaft on a canvas (the landing's light in the lower seven tenths, the
// wall above the door, the slab), tiled and scrolled; at rest the landing
// fills the seam.
const SLOT = { gap: 0.012, storey: 3 };
function shaftTexture() {
	const c = document.createElement('canvas'); c.width = 64; c.height = 512;
	const g = c.getContext('2d');
	g.fillStyle = '#1c1c1c'; g.fillRect(0, 0, 64, 51);                     // the slab between the floors
	g.fillStyle = '#3b3a38'; g.fillRect(0, 51, 64, 103);                   // the shaft wall over the door
	for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.12})`; g.fillRect(Math.random() * 64, 51, 1 + Math.random() * 3, 103); }
	g.fillStyle = '#5a5855'; g.fillRect(0, 49, 64, 3);
	const grad = g.createLinearGradient(0, 154, 0, 512); grad.addColorStop(0, '#f3ecdc'); grad.addColorStop(1, '#d9cfb8');
	g.fillStyle = grad; g.fillRect(0, 154, 64, 358);                       // the landing, lit
	g.fillStyle = '#fff4dc'; g.fillRect(0, 152, 64, 3);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.repeat.set(1, DOOR.h / SLOT.storey);                                // the seam is a door high; a storey of shaft is three metres
	return t;
}

export const elevator = {
	group: null,
	shaftTex: shaftTexture(),   // shared across rebuilds: its scroll is the ride's
	doors: null,        // [north panel, south panel]
	buttons: [],
	displays: [],       // { tex, ctx } inside and outside
	ride: null,         // while the doors are moving or the cabin travels
	origin: null,       // cabin's inner centre on the floor, world coords
	callButtons: [],
	coming: null,       // { t0, wait } after a call, before the doors open
	away: false,        // the cabin has left this floor: called elsewhere after its doors shut on their own
	open: 1,            // where the doors stand when idle, 0..1
	panel: null,        // the console: built once, carried from cabin to cabin
	noteText: '',       // a line under the floor on the outside display: what the headset gives
	doorAnim: null,     // { from, to, t0 } an idle open or close
	leftAt: null,       // when the body last stepped out, for the doors to close behind
	outAt: null,        // and when it left the cabin, for counting a floor seen
	outOf: null,

	build(W, D, H, floor = 'lacquer', dadoCap = Infinity) {
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
		// the south face, the one side without the door, is plastered like the
		// room's walls (Uli), dressed like them and hung like them (the 'cabin' run)
		{
			const style = WALL_STYLES[floor] || WALL_STYLES.lacquer, mode = state.settings.dark ? 'dark' : 'light', paint = wallColours(style.paint);
			// **flush with the steel, and a centimetre into floor and ceiling**
			// (Uli, 2026-09-19: it floated 11 mm before the steel, a gap seen
			// from the side, and its edges 2 mm short of floor and ceiling were
			// a wiggling slit). Half a millimetre before the steel with two
			// depth steps; its top and bottom edges inside the slabs, where
			// nothing is coplanar with them.
			const face = new THREE.Mesh(new THREE.PlaneGeometry(e, H + 0.02), new THREE.MeshLambertMaterial({ color: paint[mode], polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 }));
			face.name = 'cabin-face'; face.userData.colours = paint; face.position.set(W / 2 - e / 2, H / 2, z1 + 0.0005); g.add(face);
			dressWall(face, style, H, Math.min(dadoCap, dadoTop(style)), mode);
			g.add(edgeLines([[W / 2 - e, z1 + 0.0005, W / 2, z1 + 0.0005]], H));   // a wall like the room's, with their edge lines (room.js)
		}
		// 5 mm off the room's north and east walls: a face flush with a wall
		// shimmered along the cabin's edges too (Uli)
		box('cabin-n', e, H - 0.004, t, W / 2 - e / 2, H / 2, -D / 2 + t / 2 + 0.005, metal);
		box('cabin-e', t, H - 0.004, e, W / 2 - t / 2 - 0.005, H / 2, -D / 2 + e / 2, metal);
		box('cabin-floor', e, 0.01, e, W / 2 - e / 2, 0.007, -D / 2 + e / 2, cabinFloor);
		box('cabin-ceiling', e, 0.02, e, W / 2 - e / 2, H - 0.012, -D / 2 + e / 2, cabinInner);
		// Inner skins so the inside reads as a cabin, not raw steel.
		box('skin-s', e - 2 * t, H - 0.04, 0.01, W / 2 - e / 2, H / 2, iz1 - 0.005, cabinInner);
		box('skin-n', e - 2 * t, H - 0.04, 0.01, W / 2 - e / 2, H / 2, iz0 + 0.005, cabinInner);
		box('skin-e', 0.01, H - 0.04, e - 2 * t, ix1 - 0.005, H / 2, -D / 2 + e / 2, cabinInner);

		// West face: two jambs and a lintel around the door opening, and an
		// architrave standing proud of the face round the door outside.
		const jamb = (e - DOOR.w) / 2;
		box('jamb-n', t, DOOR.h - 0.002, jamb, x0 + t / 2, 0.002 + (DOOR.h - 0.002) / 2, -D / 2 + jamb / 2, metal);
		box('jamb-s', t, DOOR.h - 0.002, jamb, x0 + t / 2, 0.002 + (DOOR.h - 0.002) / 2, z1 - jamb / 2, metal);
		box('lintel', t, H - DOOR.h - 0.002, e, x0 + t / 2, DOOR.h + (H - DOOR.h - 0.002) / 2, -D / 2 + e / 2, metal);
		const zc = -D / 2 + e / 2, arch = 0.07, proud = 0.03;
		box('arch-n', proud, DOOR.h + arch - 0.002, arch, x0 - proud / 2, 0.002 + (DOOR.h + arch - 0.002) / 2, zc - DOOR.w / 2 - arch / 2, metal);
		box('arch-s', proud, DOOR.h + arch - 0.002, arch, x0 - proud / 2, 0.002 + (DOOR.h + arch - 0.002) / 2, zc + DOOR.w / 2 + arch / 2, metal);
		box('arch-top', proud, arch, DOOR.w + 2 * arch, x0 - proud / 2, DOOR.h + arch / 2, zc, metal);

		// The call station outside (Uli): a steel plate on the cabin's face
		// south of the door surround, at hand height, with one big round
		// button on it — on the cabin, not in the air.
		this.callButtons = [];
		{
			const CALL_R = 0.03, cy = 1.15, cz = zc + DOOR.w / 2 + arch + 0.09;
			box('call-plate', 0.01, 0.15, 0.09, x0 - 0.005, cy, cz, panelPlate);
			const c = document.createElement('canvas'); c.width = c.height = 128;
			const g2 = c.getContext('2d');
			g2.fillStyle = '#f2efe8'; g2.beginPath(); g2.arc(64, 64, 64, 0, Math.PI * 2); g2.fill();
			g2.fillStyle = '#1b1b1b';
			g2.beginPath(); g2.moveTo(64, 30); g2.lineTo(92, 62); g2.lineTo(36, 62); g2.closePath(); g2.fill();
			g2.beginPath(); g2.moveTo(64, 98); g2.lineTo(92, 66); g2.lineTo(36, 66); g2.closePath(); g2.fill();
			const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
			const bodyGeo = new THREE.CylinderGeometry(CALL_R, CALL_R, BUTTON.rise, 32); bodyGeo.rotateZ(Math.PI / 2);   // axis along x
			const cb = new THREE.Mesh(bodyGeo, sideMetal);
			cb.name = 'call'; cb.userData.call = true;
			cb.position.set(x0 - 0.01 - BUTTON.rise / 2, cy, cz);   // proud of the plate
			g.add(cb);
			const cf = new THREE.Mesh(new THREE.CircleGeometry(CALL_R * 0.92, 32), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -4 }));   // half a millimetre off the button's end: four depth steps
			cf.name = 'call-face'; cf.userData.call = true;
			cf.position.set(cb.position.x - BUTTON.rise / 2 - 0.0005, cy, cz);
			cf.rotation.y = -Math.PI / 2;                    // faces -x, the room
			g.add(cf);
			cb.userData.face = cf;
			// a wide unseen disc round it: a press near the button calls too (Uli)
			const reach = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), new THREE.MeshBasicMaterial({ visible: false }));
			reach.name = 'call-reach'; reach.userData.call = true; reach.position.set(x0 - 0.002, cy, cz); reach.rotation.y = -Math.PI / 2; g.add(reach);
			this.callButtons.push(cb, cf, reach);
		}

		// The switchplate (Uli): on the room's north wall just west of the
		// cabin — the wall on your right as you step out of the doors — so
		// the settings are at hand on leaving. In the corner's empty margin,
		// before the first frame.
		// **A steel plate with the floor engraved on it** stands where the
		// switchplate stood (Uli, 2026-09-19): on the room's north wall just
		// west of the cabin, at eye height, the year and its part cut into
		// brushed steel and blacked. The switches are on the paper sheet (B).
		{
			const plate = new THREE.Mesh(new THREE.BoxGeometry(FLOOR_PLATE.w, FLOOR_PLATE.h, FLOOR_PLATE.d), new THREE.MeshStandardMaterial({ map: this.engraving(), metalness: 0.85, roughness: 0.5, envMapIntensity: 0.45 }));
			plate.name = 'floor-plate';
			plate.position.set(x0 - 0.05 - FLOOR_PLATE.w / 2, 1.5, -D / 2 + FLOOR_PLATE.d / 2 + 0.0005);   // 5 cm from the cabin: inside the CORNER_KEEP the labels leave (bake.js)
			g.add(plate);
			this.floorPlate = plate;
		}

		// Two door panels behind the jambs, sliding apart along z into the
		// cabin's own walls' thickness; closed, they meet at the centre.
		// closed, they leave SLOT.gap between them at the centre, with the shaft in it
		const dx = x0 + t + DOOR.thick / 2 + 0.005, leaf = DOOR.w / 2 - SLOT.gap / 2;
		this.doors = [
			box('door-n', DOOR.thick, DOOR.h - 0.004, leaf, dx, DOOR.h / 2, zc - SLOT.gap / 2 - leaf / 2, metal),
			box('door-s', DOOR.thick, DOOR.h - 0.004, leaf, dx, DOOR.h / 2, zc + SLOT.gap / 2 + leaf / 2, metal),
		];
		for (const d of this.doors) d.userData.closedZ = d.position.z;
		const seam = new THREE.Mesh(new THREE.PlaneGeometry(SLOT.gap, DOOR.h - 0.004), new THREE.MeshBasicMaterial({ map: this.shaftTex, side: THREE.DoubleSide }));
		seam.name = 'shaft-seam'; seam.position.set(dx, DOOR.h / 2, zc); seam.rotation.y = Math.PI / 2; g.add(seam);
		this.seam = seam;

		// Floor displays above the door, one facing into the cabin, one out.
		this.displays = []; this.said = null;   // new canvases: whatever was said is said again
		const display = (name, x, ry) => {
			const c = document.createElement('canvas'); c.width = 512; c.height = 128;
			const ctx = c.getContext('2d');
			const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
			const back = box(name + '-back', 0.02, DISPLAY.h + 0.03, DISPLAY.w + 0.03, x, DOOR.h + 0.16, zc, displayBack);
			back.castShadow = false;
			const face = new THREE.Mesh(new THREE.PlaneGeometry(DISPLAY.w, DISPLAY.h), new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -4 }));   // a millimetre before its back: four depth steps (frames.js, STEPS)
			face.name = name;
			face.position.set(x + (ry > 0 ? 0.011 : -0.011), DOOR.h + 0.16, zc);
			face.rotation.y = ry;
			g.add(face);
			this.displays.push({ tex, ctx });
		};
		display('display-in',  x0 + t + 0.015, Math.PI / 2);     // inside, on the door wall, facing +x into the cabin
		display('display-out', x0 - 0.015,    -Math.PI / 2);     // outside, over the doors, facing -x into the room —
		                                                         // it says what floor the lift is at, and what was made of
		                                                         // the scan, to someone standing in the room (Uli, 2026-09-10)
		// Light in the cabin: a glowing panel in the ceiling and the lamp
		// behind it that actually lights the walls and the buttons.
		const panelLight = box('cabin-light', e * 0.5, 0.005, e * 0.5, this.origin.x, H - 0.025, this.origin.z, lightPanel);
		panelLight.castShadow = false;
		const lamp = new THREE.PointLight(0xfff4e6, CABIN_LAMP[state.settings.dark ? 'dark' : 'light'], 3.5, 2);
		lamp.name = 'cabin-lamp';
		lamp.position.set(this.origin.x, H - 0.15, this.origin.z);
		g.add(lamp);

		// The console on the south wall's inner face, beside the door, between
		// hand and eye height: walnut blocks standing on the wall, vertical
		// (Uli), their faces the plates — nothing of them in the wall. **The
		// years run down the plate, newest at the top, in two columns, a
		// plate per column** (Uli, 2026-09-19, from a 2D demo; it was a line
		// per decade, ten across, before): a year's second and third rooms
		// sit to the right of its first, so a column's plate is as wide as
		// its widest year; the favourites floor is a double-width button
		// over the topmost year. The thin years merged into one room each
		// keep a button of their own to it.
		const list = rooms();
		const favRoom = list.find(r => r.favs);
		const byYear = new Map();                      // year -> its rooms, first part first
		for (const r of list) if (!r.favs) for (const y of r.years) byYear.set(y, [...(byYear.get(y) || []), r]);
		const years = [...byYear.keys()].sort((p, q) => Number(q) - Number(p));
		const rowsOf = years.map(y => ({ year: y, rooms: byYear.get(y).sort((p, q) => (p.part || 0) - (q.part || 0)) }));
		const half = Math.ceil(rowsOf.length / 2);
		const columns = [rowsOf.slice(0, half), rowsOf.slice(half)].filter(c => c.length);
		const margin = PANEL.margin, between = 0.02;   // and the gap between two plates
		const plates = columns.map((col, i) => {
			const wide = Math.max(i === 0 && favRoom ? 2 : 1, ...col.map(r => r.rooms.length));
			const rows = col.length + (i === 0 && favRoom ? 1 : 0);
			return { col, wide, rows, w: wide * BUTTON.pitchX + 2 * margin, h: rows * BUTTON.pitchY + 2 * margin };
		});
		for (const p of plates) p.h = Math.max(...plates.map(q => q.h));   // both plates the same height (Uli, 2026-09-19): the shorter column leaves walnut under its last year
		const plateW = plates.reduce((sum, p) => sum + p.w, 0) + between * (plates.length - 1);
		// the block: its face at the panel's z = 0, its back on the skin; the buttons stand proud at -z
		// **The console is built once** (Uli, 2026-09-13: the plate glitched
		// as the doors shut). The cabin is made afresh with every room, at the
		// moment the doors have shut on a ride — and thirty-odd canvases drawn
		// and sent up again in front of the visitor was a hitch on the plate
		// every ride. The panel is the same object from cabin to cabin, only
		// set at the new cabin's wall.
		if (!this.panel) {
			const panel = new THREE.Group();
			panel.name = 'panel';
			// facing the south wall the viewer's left is +x: the first plate
			// stands at +x, the next to its right at smaller x, all hung from
			// one top edge
			const plateH = Math.max(...plates.map(p => p.h));
			let x1 = plateW / 2;                       // the running plate's left edge
			for (const p of plates) {
				// **the plates wear the frames' wood** (Uli, 2026-09-19): the same
				// material as the bars, so the wood switch dresses the console too
				const plate = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, PANEL.depth), materials.frame);
				plate.name = 'plate';
				p.x0 = x1; p.y0 = plateH / 2;          // the plate's top left corner, in the panel
				plate.position.set(x1 - p.w / 2, plateH / 2 - p.h / 2, PANEL.depth / 2);
				panel.add(plate);
				x1 -= p.w + between;
			}

			// A button: a black pocket in the plate, brushed steel at its bottom,
			// a **milky white cap** standing proud of it, the year printed on the
			// cap. Lit, the cap glows green (light()). The cap was clear — white
			// at 0.28 over the steel — until 2026-09-13 (Uli: milky, and plain
			// colours for its states, not translucency): thirty-odd translucent
			// caps were thirty-odd things in the transparent queue, sorted and
			// blended every frame, for a look the plate did not need.
			this.buttons = [];
			const { w, h, rise, gap } = BUTTON;
			// **The pockets are one mesh, the steels another** (2026-09-13):
			// neither moves — a press dips the cap alone — and forty-six draw
			// calls for them were a quarter of the cabin's.
			const pockets = [], steels = [];
			const sink = (geo, x, y, z, list) => list.push(geo.clone().translate(x, y, z));
			// The face stands 1.2 mm off its cap, not 0.3, and is pushed forward
			// again in the depth buffer (Uli, 2026-09-13: the button plate
			// glitched). Three tenths of a millimetre is finer than a 16-bit
			// depth buffer tells apart at arm's length (vr.js: 'layers'), and
			// the two surfaces flickered against each other, the more so in
			// stereo. **The push is a constant, not a slope**: a slope-scaled
			// offset grows with the viewing angle, and at the grazing angle the
			// plate is passed at on the way in it would pull a year forward
			// through the caps beside it.
			// the faces first, all of them into the atlas, then the buttons
			const entries = [];
			if (favRoom) entries.push({ year: 'favourites', room: favRoom, wide: 2 });
			for (const p of plates) for (const { year, rooms: rs } of p.col) for (const room of rs) entries.push({ year, room, wide: 1 });
			const atlas = faceAtlas(entries);
			let n = 0;
			// one button, `wide` caps across (the favourites: two), at a cell:
			// its pocket, its steel, and its cap wearing its year
			const geos = new Map();
			const button = (room, x, y, wide = 1) => {
				const bw = w + (wide - 1) * BUTTON.pitchX;
				if (!geos.has(wide)) geos.set(wide, { pocket: roundedBox(bw + 2 * gap, h + 2 * gap, 0.001, CORNER + gap), steel: roundedBox(bw, h, 0.002), cap: roundedBox(bw, h, rise) });
				const G = geos.get(wide);
				sink(G.pocket, x, y, -0.0005, pockets);
				sink(G.steel, x, y, -0.002, steels);
				const cap = new THREE.Mesh(faceUVs(G.cap, bw, h, atlas.cells[n++], atlas.rows), new THREE.MeshStandardMaterial({ color: MILK, map: atlas.tex, vertexColors: true, roughness: 0.45, metalness: 0, emissive: room.favs ? FAV_RED : GREEN, emissiveMap: atlas.tex, emissiveIntensity: 0, envMapIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -6 }));
				cap.name = `cap-${room.key}`;
				cap.userData.key = room.key;
				cap.userData.z0 = -0.003 - rise / 2;   // where it rests: a press dips it in and back
				cap.userData.cap = true;
				if (room.favs) cap.userData.fav = true;
				cap.position.set(x, y, cap.userData.z0);
				panel.add(cap);
				this.buttons.push(cap);
			};
			// a cell of a plate: column c (0 at the plate's left), row r (0 at its top)
			const cell = (p, c, r) => ({ x: p.x0 - margin - BUTTON.pitchX * (c + 0.5), y: p.y0 - margin - BUTTON.pitchY * (r + 0.5) });
			plates.forEach((p, i) => {
				let row = 0;
				if (i === 0 && favRoom) {                  // the favourites: two columns wide, over the topmost year
					const { x, y } = cell(p, 0.5, row++);
					button(favRoom, x, y, 2);
				}
				for (const { rooms: rs } of p.col) {
					rs.forEach((room, c) => { const { x, y } = cell(p, c, row); button(room, x, y); });
					row++;
				}
			});
			const pm = new THREE.Mesh(merged(pockets), pocketMat); pm.name = 'pockets'; panel.add(pm);
			const sm = new THREE.Mesh(merged(steels), steelMat); sm.name = 'steels'; panel.add(sm);
			this.panel = panel;
		}
		this.panel.position.set(ix0 + 0.10 + plateW / 2, (PANEL.low + PANEL.high) / 2, iz1 - 0.0105 - PANEL.depth);
		g.add(this.panel);
		this.group = g;
		return g;
	},

	// The engraved plate's face: brushed steel drawn as fine streaks, the
	// floor's label cut in — black, with a hair of light along its lower
	// right edge where the cut catches the room's light. Drawn again for
	// every floor (engrave, from hangRoom); the same canvas from cabin to cabin.
	engraving(text = this.engraved || '') {
		if (!this.plateTex) {
			const c = document.createElement('canvas'); c.width = 768; c.height = 256;
			this.plateTex = new THREE.CanvasTexture(c); this.plateTex.colorSpace = THREE.SRGBColorSpace; this.plateTex.anisotropy = 8;
		}
		const c = this.plateTex.image, g = c.getContext('2d');
		g.fillStyle = '#b9bab8'; g.fillRect(0, 0, c.width, c.height);
		for (let y = 0; y < c.height; y += 2) { g.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},${0.03 + Math.random() * 0.07})`; g.fillRect(0, y, c.width, 1); }
		// centred by the glyphs' own box, not the font's line (Uli: centred
		// both ways), and cut thick: the light face stroked to a bold
		g.textAlign = 'center'; g.textBaseline = 'alphabetic';
		g.font = `300 ${FLOOR_PLATE.font}px Jost, "Helvetica Neue", Arial, sans-serif`;
		const m = g.measureText(text), y = c.height / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
		g.lineJoin = 'round'; g.lineWidth = FLOOR_PLATE.font * 0.06;
		g.strokeStyle = g.fillStyle = 'rgba(255,255,255,0.45)'; g.strokeText(text, c.width / 2 + 2, y + 2); g.fillText(text, c.width / 2 + 2, y + 2);   // the cut's lit edge
		g.strokeStyle = g.fillStyle = '#0e0e0e'; g.strokeText(text, c.width / 2, y); g.fillText(text, c.width / 2, y);
		this.plateTex.needsUpdate = true;
		return this.plateTex;
	},
	engrave(text) { if (text !== this.engraved) { this.engraved = text; this.engraving(text); } },

	show(text, arrow) {
		// **Only what has changed is drawn** (2026-09-18): a ride calls this
		// every frame with the floor it is passing, and both displays were
		// drawn and sent to the GPU again every frame of every ride — found
		// in the uploads of the frames after the doors shut.
		const said = `${text}|${arrow}|${this.noteText}`;
		if (said === this.said) return;
		this.said = said;
		this.shown = { text, arrow };
		this.displays.forEach((d, i) => { drawDisplay(d.ctx, text, arrow, i === 1 ? this.noteText : ''); d.tex.needsUpdate = true; });   // the note on the outside one
	},

	// The line under the floor on the outside display
	note(text) { this.noteText = text; if (this.shown) this.show(this.shown.text, this.shown.arrow); },

	// A floor is counted seen once you have been out of its cabin for
	// twenty seconds — long enough that a step out and straight back in
	// does not count (Uli, 2026-09-11). Its button then sits in a darker
	// grey, so what is left to see stands out.
	SEEN_AFTER: 20000,
	stepSeen(now) {
		if (this.inside() || !state.roomKey) { this.outAt = null; return; }
		if (this.outAt === null || this.outAt === undefined) { this.outAt = now; this.outOf = state.roomKey; return; }
		if (now - this.outAt < this.SEEN_AFTER || state.seen[this.outOf]) return;
		state.seen[this.outOf] = true;
		this.light(state.roomKey);                          // the greys are set with the lights
	},
	// The favourites floor's cap has its own three (Uli, 2026-09-13): dark
	// and dead while nothing is stuck on it — **darker than a visited
	// floor**, and not lit — plain white like any unvisited floor once
	// there is a dot, and green when you are standing on it. It is **never
	// shown as visited**: a floor of your own favourites is not somewhere
	// you have got out of the way.
	FAV_DEAD: 0x26282a,
	light(key) {
		let lit = null;
		for (const b of this.buttons) {
			if (!b.userData.cap) continue;                  // the prints carry no light
			const m = b.material, on = b.userData.key === key;
			if (b.userData.fav) {
				const empty = !favCount();
				m.emissiveIntensity = on ? 1.3 : 0;
				m.color.set(on ? FAV_LIT : empty ? this.FAV_DEAD : MILK);   // lit, the sticker's red (Uli)
				if (on && !lit) lit = b;
				continue;
			}
			const seen = !on && state.seen[b.userData.key];
			m.emissiveIntensity = on ? 1.3 : 0;
			m.color.set(on ? 0x2a5a38 : seen ? 0x4e5053 : MILK);   // lit, the cap fills with green light; seen, it goes grey — a darker grey than the first try (Uli, 2026-09-12), a shade lighter than 0x45474a (Uli, 2026-09-19: just a little)
			if (on && !lit) lit = b;
		}
		// (the little green lamp that spilled from the lit cap went on 2026-09-19:
		// a point light is paid for by every lit fragment in the room, and at
		// 0.004 over 8 cm it was hardly seen)
	},

	// The floor being passed on a ride lights faintly on the console as
	// the display counts it (Uli, 2026-09-19) — a paler cap with a little
	// of the green in it; the floor pressed keeps its full light.
	passing(key) {
		if (key === this.passed) return;
		this.passed = key;
		this.light(this.ride ? this.ride.key : state.roomKey);
		if (!this.ride || key === this.ride.key) return;
		for (const b of this.buttons) {
			if (!b.userData.cap || b.userData.key !== key || b.userData.fav) continue;
			b.material.emissiveIntensity = 0.35;
			b.material.color.set(0xf4f3ee);
		}
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
	// The cap goes in and comes back. It used to run on two straight ramps
	// and the turn between them read as a jiggle (Uli, 2026-09-12); now it
	// is eased in and eased out, a little slower, so the cap moves as
	// something with weight behind it does.
	stepPress(now) {
		const a = this.pressAnim;
		if (!a) return;
		const f = Math.min(1, (now - a.t0) / 260);
		const ease = t => t * t * (3 - 2 * t);
		const k = f < 0.4 ? ease(f / 0.4) : ease(1 - (f - 0.4) / 0.6);
		for (const m of a.meshes) m.position.z = m.userData.z0 + k * BUTTON.rise * 0.7;
		if (f >= 1) { for (const m of a.meshes) m.position.z = m.userData.z0; this.pressAnim = null; }
	},

	placeInCabin() {
		const o = this.originWorld();
		placeBody(o.x, o.z, Math.PI / 2 + world.rotation.y);
	},

	// Doors: 0 closed, 1 open.
	// Every opening is heard (Uli, 2026-09-12: the lift's sound every time
	// the doors open). The slide is played here, where the leaves actually
	// part, rather than at each of the places that set them going — a ride
	// arriving, a call answered, a room fitted to a scan — since one of
	// those always got forgotten.
	setDoors(open) {
		const was = this.open;
		// **The slide is heard as the leaves start to move** (Uli,
		// 2026-09-13: the sound was late). It waited for them to pass half
		// open, which is halfway through the opening — and on the way shut
		// it never played at all, since `open` only falls and the test only
		// ever caught a rise. Now it goes off as they leave the jamb, either
		// way round.
		if (was !== undefined && ((was <= 0.001 && open > 0.001) || (was >= 0.999 && open < 0.999))) lift.slide();
		this.open = open;
		const [n, s] = this.doors;
		n.position.z = n.userData.closedZ - open * DOOR.w / 2;
		s.position.z = s.userData.closedZ + open * DOOR.w / 2;
		if (this.seam) this.seam.visible = open < 0.02;   // the shaft shows only while the leaves are shut (Uli)
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
	// after you have walked out — and then, **mostly, the cabin is called
	// elsewhere and goes** (Uli, 2026-09-13), the music with it: nothing
	// behind those doors to hear. Sometimes it stays, humming to itself at
	// a twentieth through the steel. Which of the two it did decides what
	// a call does: a cabin that is here just opens its doors; one that has
	// gone is heard coming, rings, and then opens. It was always heard
	// coming before, which was a lift that had never left returning.
	LEAVES: 0.7,
	// A call: the button lights; the lift is heard coming for a few seconds
	// (Uli: a humming while waiting outside), then the bell and the doors —
	// or, still standing here, the doors alone.
	call() {
		if (this.ride || this.coming || this.open === 1) return;
		if (this.doorAnim) {                                  // closing: the lift is here, the doors come back
			if (this.doorAnim.to === 1) return;
			this.doorAnim = { from: this.open, to: 1, t0: performance.now(), dur: DOOR_T * (1 - this.open) };
			return;
		}
		this.callButtons[1].material.emissiveIntensity = 0.5; this.callButtons[1].material.emissiveMap = this.callButtons[1].material.map; this.callButtons[1].material.needsUpdate = true;
		if (!this.away) { this.doorAnim = { from: 0, to: 1, t0: performance.now() }; return; }   // setDoors sounds the slide
		this.coming = { t0: performance.now(), wait: 4500 };
		lift.hum(this.coming.wait / 1000);
		this.show(roomLabel(roomByKey(state.roomKey)), '\u25b2');
	},

	stepIdle(now) {
		if (this.coming) {
			const c = this.coming;
			if (now - c.t0 < c.wait) return;
			if (!c.rang) { c.rang = true; c.t0 = now + BELL_GAP - c.wait; this.show(roomLabel(roomByKey(state.roomKey)), ''); lift.bell(); return; }
			this.coming = null;
			this.away = false;                     // it is back
			this.doorAnim = { from: 0, to: 1, t0: now };
			lift.slide();
			return;
		}
		if (this.doorAnim) {
			const a = this.doorAnim, f = Math.max(0, Math.min(1, (now - a.t0) / (a.dur || DOOR_T)));
			this.setDoors(a.from + (a.to - a.from) * f);   // setDoors keeps `open` and sounds the slide
			if (f >= 1) {
				this.doorAnim = null;
				if (a.to === 1) this.leftAt = now;     // opened on a call: time to walk in starts now
				else if (Math.random() < this.LEAVES) { this.away = true; lift.hum(3); }   // shut behind you: called elsewhere, heard going
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
		this.doorAnim = null; this.coming = null; this.leftAt = null; this.away = false;   // you are in it
		this.setDoors(1);
		const list = rooms();
		const from = list.findIndex(r => r.key === state.roomKey), to = list.findIndex(r => r.key === key);
		const floors = Math.abs(to - from);
		// the list runs newest first, so a smaller index is a higher floor
		const path = list.slice(Math.min(from, to), Math.max(from, to) + 1);
		if (to < from) path.reverse();
		// the doors close from where they stand: back-date t0 by what is already shut
		this.ride = { key, t0: performance.now() - (1 - fromOpen) * DOOR_T, hung: false, floors, up: to < from, path,
		              travel: Math.min(22.5, 3 + 1.2 * floors) };   // near real time (Uli): 1.2 s a floor, 3 s to start and stop, 22.5 s at most — a quarter faster than the first timing (Uli, 2026-09-19)
		if (!this.inside()) this.placeInCabin();                 // pressed from the room (the bench's Y list): into the cabin; a body in the cabin stays as it stands (Uli)
	},

	// The body where it stood in the cabin, whichever cabin now stands:
	// on the bench the body is moved; in the headset the visitor cannot
	// be, so the world is shifted until the new cabin stands where the
	// old one stood — before, a room of another size left them outside
	// the cabin, the doors closed behind them and a call brought the lift
	// again (Uli). Once per frame of the hang, since the shell may have
	// moved the cabin in any of its steps. **The world's matrix is brought
	// up to date first** (2026-09-18, the evening: in the headset the room
	// stood wrong after a ride — the visitor outside the cabin, frames
	// gone from the middle, the pointer buried in a wall). originWorld()
	// reads through world.matrixWorld, which only the render updates: the
	// step after a shift read the cabin where it had been *before* the
	// shift, took that for the place to hold, and shifted the world back.
	// `before` is the one place to hold, never re-read.
	keepPlace(r) {
		world.updateMatrixWorld(true);
		const o = this.originWorld();
		if (!renderer.xr.isPresenting) walk.pos.set(o.x + r.off.x, walk.pos.y, o.z + r.off.z);
		else world.position.add(new THREE.Vector3().subVectors(r.before, o));
	},

	// Called every frame. Half a second closing; then the cabin travels —
	// the display counting the floors, the motor sounding, longer for
	// more floors — and the other room is hung meanwhile; the doors stay
	// shut until that room's pictures are in (Uli: no switching to be
	// seen); then the bell, and half a second opening.
	step(now) {
		this.stepSeen(now);
		this.stepPress(now);
		if (!this.ride) { this.stepIdle(now); return; }
		const r = this.ride;
		const t = (now - r.t0) / 1000;
		const close = DOOR_T / 1000;
		if (t < close) { this.setDoors(1 - t / close); return; }
		if (!r.hung) {
			// **One step of the hang a frame** (2026-09-18): the room is made
			// in pieces over the first frames of the travel (hangRoomSteps),
			// the doors shut all the while; the body and the world are set
			// once it stands.
			if (!r.hanging) {
				paper.hide();                      // the options sheet stays on the floor that is left
				dropAllNear();                     // the floor is left: its 2000s go back before the next floor's are read
				lift.run(r.travel);
				// the new room's cabin may stand elsewhere: the body keeps its
				// place and look in the cabin, not put back facing the doors (Uli)
				r.before = this.originWorld().clone(); r.off = new THREE.Vector3().subVectors(walk.pos, r.before);
				r.hanging = hangRoomSteps(r.key);  // may rebuild the room and this cabin
			}
			// a step that throws must not leave the lift standing with its
			// doors shut: the rest of the hang is run whole, and if that
			// throws too the ride goes on with what stands (the error is on
			// the display either way, through step() in gallery.js)
			let done = false;
			try { done = r.hanging.next().done; } catch (e) { console.error('hang step failed', e); try { hangRoom(r.key); } catch (e2) { console.error('hang failed', e2); } done = true; try { elevator.show(`hang: ${String(e.message || e).slice(0, 22)}`, ''); } catch (ignored) {} }
			if (!done) { this.keepPlace(r); return; }
			this.keepPlace(r);
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
			this.passing(r.path[i].key);
			// the shaft passes in the seam: one storey per floor, eased in and
			// out — and for the last storey the seam clears and the room the
			// lift arrives at shows through the gap (Uli)
			const p = tt / r.travel, e = p * p * (3 - 2 * p);
			this.shaftTex.offset.y = (r.up ? 1 : -1) * e * r.floors;
			if (this.seam) this.seam.visible = e * r.floors < r.floors - 1;
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
		r.sliding = true;   // the slide is played by setDoors, as the leaves part
		const o = (now - r.tOpen) / DOOR_T;
		if (o < 1) { this.setDoors(o); return; }
		this.setDoors(1);
		this.leftAt = null;
		this.ride = null;
		this.passed = null;
	},
};

// Picking a button: a ray from the pointer while it is free, from the
// middle of the view while it is taken.
const raycaster = new THREE.Raycaster();
export function pressAt(ndcX, ndcY) {
	if (!elevator.buttons.length) return false;
	raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
	return pressAlong(raycaster, 2.2);
}
export function pressAlong(rc, reach) {
	if (paper.press(rc)) return true;             // the options sheet takes a press on it first
	const hit = rc.intersectObjects([...elevator.buttons, ...elevator.callButtons], false)[0];
	if (hit && hit.distance <= reach) {
		const u = hit.object.userData;
		if (u.call) elevator.call();
		// a dead favourites button takes the press and does nothing with it:
		// no dip, no bell, the lift stays where it is (Uli, 2026-09-13)
		else if (u.key === FAV_KEY && !favCount()) return true;
		else if (elevator.inside()) { elevator.press(u.key, hit.object); elevator.go(u.key); }   // a floor is chosen from inside the cabin only (Uli)
		return true;
	}
	// **a red dot first** (Uli, 2026-09-13): where the pointer has come
	// within reach of the place a sticker goes, the press sticks one on —
	// or takes off the one already there — and gets no further.
	// the floor list and the button follow at once: a first dot lights the
	// favourites button, the last one taken off puts it out again
	if (stickAt()) { clearRooms(); rooms(); elevator.light(state.roomKey); return true; }
	// a label card: a press doubles it, the next press puts it back; a
	// print: a press fills its frame over the mat, the next puts it back
	// (Uli, 2026-09-11). Both come back by themselves once out of sight —
	// zoom.js keeps that.
	const pieces = scene.getObjectByName('pieces');
	if (pieces) {
		const labels = [], prints = [];
		pieces.traverse(o => {
			if (o.name === 'label' && o.visible) labels.push(o);
			else if (o.name === 'photo' && o.visible) prints.push(o);
			// the pane over the frame's opening: never drawn, but pressed
			else if (o.name === 'photo-area') prints.push(o);
		});
		const l = rc.intersectObjects(labels, false)[0];
		if (l && l.distance <= 4) return zoomLabel(l.object.parent.userData.labels);
		const ph = rc.intersectObjects(prints, false)[0];
		if (ph && ph.distance <= 6) return zoomPrint(ph.object.userData.print || ph.object);   // a press on the mat is a press on its picture
	}
	return false;
}

// The bench's overlay: Y lists the floors.
export const floors = document.getElementById('floors');
function renderFloors() {
	floors.innerHTML = rooms().map(r =>
		`<button data-key="${r.key}"${r.key === state.roomKey ? ' aria-current="true"' : ''}>${r.favs ? r.span : r.years.length > 1 ? `${r.years[0]}<small>\u2013${r.years[r.years.length - 1]}</small>` : r.year}${r.of > 1 ? `<small>.${r.part}</small>` : ''}</button>`).join('');
}
floors.addEventListener('click', e => {
	const b = e.target.closest('button');
	if (!b) return;
	floors.hidden = true;
	elevator.press(b.dataset.key);
	elevator.go(b.dataset.key);
});
addEventListener('keydown', e => {
	if (e.code === 'KeyF') { floors.hidden = !floors.hidden; if (!floors.hidden) renderFloors(); }   // F lists the floors — Y turns now (Uli)
	if (e.code === 'Escape') floors.hidden = true;
});

// ---------------------------------------------------------------------------
// The bench's keys (the settings themselves are gallery/settings.js and
// their sheet gallery/paper.js, since 2026-09-19)

addEventListener('keydown', e => {
	if (e.code === 'KeyF') { floors.hidden = !floors.hidden; if (!floors.hidden) renderFloors(); }   // F lists the floors — Y turns now (Uli)
	if (e.code === 'Escape') floors.hidden = true;
});

addEventListener('keydown', e => {
	if ((e.code === 'KeyB' || e.code === 'KeyO') && !e.repeat) { const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(0, 0), camera); paper.toggle(rc); }   // B like the controller's, or O (Uli): the sheet where the view's middle points
});
