import * as THREE from '../vendor/three.module.js';
import { setWire, wire } from './bench.js?v=20260910k';
import { MAT_COLOURS, applyFrameLook, materials, tex, textureCache } from './frames.js?v=20260910k';
import { ELEVATOR, clearRooms, hangRoom, roomByKey, rooms } from './hang.js?v=20260910k';
import { WALL_STYLES, applyMode, dadoTop, dressWall, wallColours } from './room.js?v=20260910k';
import { camera, head, renderer, scene, world } from './scene.js?v=20260910k';
import { PLANS, state } from './state.js?v=20260910k';
import { fitRoom, planAgain } from './vr.js?v=20260910k';
import { placeBody, walk } from './walk.js?v=20260910k';

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
const PANEL = { low: 1.2, high: 1.8, depth: 0.03, cols: 10, margin: 0.03 };   // its centre at 1.5 m (Uli: 20 cm up), vertical on the wall (Uli), ten across; depth: the walnut block it is the face of

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
const GREEN = 0x46ff7a;                                                                                    // the lit floor
// The console's walnut (Uli): the dark wood set, tiled every half metre —
// `rx`, `ry` are the tiles across the face it is put on.
export const walnut = (rx, ry) => new THREE.MeshStandardMaterial({
	map: tex('wood-dark-color.jpg', true, ry, rx), roughnessMap: tex('wood-dark-rough.jpg', false, ry, rx), normalMap: tex('wood-dark-normal.jpg', false, ry, rx),
	normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1, metalness: 0, envMapIntensity: 0.4,
});
const pocketMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 });   // the black gap round a button
export const lightPanel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 1.6, roughness: 1 });
export const CABIN_LAMP = { light: 5, dark: 0.9 }, CABIN_PANEL = { light: 1.6, dark: 0.35 };   // the cabin at night: dimmer, not dark (Uli)

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
export function roomLabel(room) {
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

// The switchplate's buttons: a label, and the state they show.
const WOODS = ['maple', 'oak', 'walnut', 'black', 'white'];
const SWITCHES = [
	{ key: 'dark',   label: 'light',  value: () => state.settings.dark ? 'night' : 'day',  press: () => setSetting('dark', !state.settings.dark) },
	{ key: 'frame',  label: 'wood',   value: () => state.settings.frame,                   press: () => setSetting('frame', WOODS[(WOODS.indexOf(state.settings.frame) + 1) % WOODS.length]) },
	{ key: 'labels', label: 'labels', value: () => state.settings.labels ? 'on' : 'off',   press: () => setSetting('labels', !state.settings.labels) },
	{ key: 'plan',   label: 'plan',   value: () => state.settings.plan,                    press: () => setSetting('plan', PLANS[(PLANS.indexOf(state.settings.plan) + 1) % PLANS.length]) },   // what a scanned room is made of (Uli)
	{ key: 'view',   label: 'view',   value: () => 'reset',                                press: () => recentre() },
	{ key: 'wire',   label: 'wire',   value: () => wire ? 'on' : 'off',                    press: () => setWire(!wire), small: true },   // a smaller button centred under the rows (Uli)
];

// Recentre (Uli): the room turned and shifted round the visitor so that
// they stand a step outside the lift's doors looking down the long axis
// — the way they look becomes the long axis, the lift is at their back.
// In the headset the world moves, never the visitor; on the bench the
// body is placed as on arrival. A room fitted to the Quest's boundary is
// fitted again instead: its walls are the real ones.
function recentre() {
	const o = elevator.origin;
	if (!o) return;
	const arrival = new THREE.Vector3(o.x - ELEVATOR.size, 0, o.z);   // in the world's own frame
	if (!renderer.xr.isPresenting) { placeBody(arrival.x, arrival.z, Math.PI / 2); return; }
	if (state.bounded && state.bounded.boundsGeometry && state.bounded.boundsGeometry.length >= 3) {
		fitRoom(state.bounded.boundsGeometry.map(q => new THREE.Vector3(q.x, 0, q.z)), [], [], 0, 'bounds');
		return;
	}
	const h = head(), dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
	dir.y = 0; if (dir.lengthSq() < 1e-6) return; dir.normalize();
	// the world's yaw R takes its west (-x, the arrival's look) onto the gaze: (-cos R, sin R) = (dir.x, dir.z)
	const R = Math.atan2(dir.z, -dir.x);
	world.rotation.set(0, R, 0);
	world.position.set(h.x - (arrival.x * Math.cos(R) + arrival.z * Math.sin(R)), 0, h.z - (-arrival.x * Math.sin(R) + arrival.z * Math.cos(R)));
}
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
export function refreshSwitches() {
	for (const f of [...elevator.switches, ...settingsMap.switches]) if (f.userData.sw) { f.material.map.dispose(); f.material.map = switchFace(f.userData.sw); f.material.needsUpdate = true; }
}

// The switchplate: the four switches two by two on an anthracite plate,
// each a round button showing its state with its description printed
// under it (Uli). Built into `parent` with its middle at (px, py, pz),
// facing +z, the buttons proud that way. Returns what presses.
const SWITCHPLATE = { cols: 2, pitchX: 0.07, pitchY: 0.085, margin: 0.015, smallR: 0.013, smallPitch: 0.06 };
function buildSwitchplate(parent, px, py, pz) {
	const { cols, pitchX, pitchY, margin, smallR, smallPitch } = SWITCHPLATE;
	const big = SWITCHES.filter(sw => !sw.small), small = SWITCHES.filter(sw => sw.small);
	const rows = Math.ceil(big.length / cols);
	const plateW = cols * pitchX + 2 * margin, plateH = rows * pitchY + small.length * smallPitch + 2 * margin;
	const plate = new THREE.Mesh(new THREE.BoxGeometry(plateW, plateH, 0.024), panelPlate);
	plate.name = 'switchplate'; plate.position.set(px, py, pz); parent.add(plate);
	const geo = r => ({
		body: (g => { g.rotateX(Math.PI / 2); return g; })(new THREE.CylinderGeometry(r, r, BUTTON.rise, 12, 1, true)),   // axis along z
		face: new THREE.CircleGeometry(r * 0.92, 12),
		label: new THREE.PlaneGeometry(0.056 * r / BUTTON.r, 0.014 * r / BUTTON.r),
	});
	const G_big = geo(BUTTON.r), G_small = geo(smallR);
	const switches = [];
	const put = (sw, x, y, r, G) => {
		const z = pz + 0.012 + BUTTON.rise / 2;
		const b = new THREE.Mesh(G.body, metal); b.name = `switch-${sw.key}`; b.userData.action = sw.key; b.position.set(x, y, z); parent.add(b);
		const f = new THREE.Mesh(G.face, new THREE.MeshStandardMaterial({ map: switchFace(sw), roughness: 0.6 }));
		f.name = `switch-face-${sw.key}`; f.userData.action = sw.key; f.userData.sw = sw; f.position.set(x, y, z + BUTTON.rise / 2 + 0.0005); parent.add(f);
		const l = new THREE.Mesh(G.label, new THREE.MeshBasicMaterial({ map: switchLabel(sw), transparent: true }));
		l.name = `switch-label-${sw.key}`; l.position.set(x, y - r - 0.011 * r / BUTTON.r, pz + 0.0125); parent.add(l);
		switches.push(b, f);
	};
	big.forEach((sw, i) => {
		const col = i % cols, row = Math.floor(i / cols);
		put(sw, px - plateW / 2 + margin + pitchX * (col + 0.5), py + plateH / 2 - margin - pitchY * (row + 0.5) + 0.009, BUTTON.r, G_big);   // up a little: the label takes the room below
	});
	small.forEach((sw, i) => put(sw, px, py + plateH / 2 - margin - pitchY * rows - smallPitch * (i + 0.5) + 0.006, smallR, G_small));
	return switches;
}

// The settings map (Uli): the switchplate again, held up in front of you
// on B — a controller's B or Y button, the bench's B or O key — half a metre
// off, a little below the eyes and turned to them like a map, left where
// it was summoned; B again puts it away. Its switches press like the
// plate's.
export const settingsMap = {
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
	switches: [],       // the switchplate's buttons, outside on the cabin's room-facing side
	coming: null,       // { t0, wait } after a call, before the doors open
	open: 1,            // where the doors stand when idle, 0..1
	doorAnim: null,     // { from, to, t0 } an idle open or close
	leftAt: null,       // when the body last stepped out, for the doors to close behind

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
			const face = new THREE.Mesh(new THREE.PlaneGeometry(e, H - 0.004), new THREE.MeshLambertMaterial({ color: paint[mode] }));
			face.name = 'cabin-face'; face.userData.colours = paint; face.position.set(W / 2 - e / 2, H / 2, z1 + 0.011); g.add(face);
			dressWall(face, style, H, Math.min(dadoCap, dadoTop(style)), mode);
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
			const cb = new THREE.Mesh(bodyGeo, metal);
			cb.name = 'call'; cb.userData.call = true;
			cb.position.set(x0 - 0.01 - BUTTON.rise / 2, cy, cz);   // proud of the plate
			g.add(cb);
			const cf = new THREE.Mesh(new THREE.CircleGeometry(CALL_R * 0.92, 32), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 }));
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
		this.switches = buildSwitchplate(g, x0 - 0.45, 1.5, -D / 2 + 0.012);

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
		              travel: Math.min(30, 4 + 1.6 * floors) };   // near real time (Uli): a floor and a half a second per floor, 4 s to start and stop, half a minute at most
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
			// in the headset the visitor cannot be moved: the world is shifted
			// so the new room's cabin stands where the old one stood — before,
			// a room of another size left them outside the cabin, the doors
			// closed behind them and a call brought the lift again (Uli)
			else world.position.add(before.sub(this.originWorld()));
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
export function pressAt(ndcX, ndcY) {
	if (!elevator.buttons.length) return false;
	raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
	return pressAlong(raycaster, 2.2);
}
export function pressAlong(rc, reach) {
	const hit = rc.intersectObjects([...elevator.buttons, ...elevator.callButtons, ...elevator.switches, ...settingsMap.switches], false)[0];
	if (hit && hit.distance <= reach) {
		const u = hit.object.userData;
		if (u.action) { SWITCHES.find(sw => sw.key === u.action).press(); refreshSwitches(); }
		else if (u.call) elevator.call();
		else if (elevator.inside()) { elevator.press(u.key, hit.object); elevator.go(u.key); }   // a floor is chosen from inside the cabin only (Uli)
		return true;
	}
	// a label card: a press doubles it, the next press puts it back (Uli)
	const pieces = scene.getObjectByName('pieces');
	if (pieces) {
		const labels = [];
		pieces.traverse(o => { if (o.name === 'label' && o.visible) labels.push(o); });
		const l = rc.intersectObjects(labels, false)[0];
		if (l && l.distance <= 4) {
			// the whole block, a grid's cards together (Uli): it grows from the
			// corner that sits by the frame — top-left beside the piece, top-right
			// under it — so that corner stays and the block spreads down and out
			const L = l.object.parent.userData.labels, k = l.object.scale.x > 1.5 ? 1 : 2;
			const ax = L.cards[0].userData.below ? Math.max(...L.cards.map(c => c.userData.x0 + L.cw / 2)) : Math.min(...L.cards.map(c => c.userData.x0 - L.cw / 2));
			const ay = Math.max(...L.cards.map(c => c.userData.y0 + c.userData.ch / 2));
			for (const c of L.cards) {
				c.scale.set(k, k, 1);
				c.position.x = ax + (c.userData.x0 - ax) * k;
				c.position.y = ay + (c.userData.y0 - ay) * k;
			}
			return true;
		}
	}
	return false;
}

// The bench's overlay: Y lists the floors.
export const floors = document.getElementById('floors');
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
	if (e.code === 'KeyF') { floors.hidden = !floors.hidden; if (!floors.hidden) renderFloors(); }   // F lists the floors — Y turns now (Uli)
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
	clearRooms();                         // sizes may have changed which years split
	const wanted = state.roomKey;
	const key = rooms().some(r => r.key === wanted) ? wanted : rooms().find(r => r.year === state.year)?.key || rooms()[0].key;
	state.room = null;                       // force the room and the cabin to rebuild
	hangRoom(key);
	elevator.setDoors(1);
}

export function setSetting(k, v) {
	const s = state.settings;
	if (s[k] === v) return;
	s[k] = v;
	saveSettings();
	switch (k) {
		case 'dark':   applyMode(v); break;
		case 'frame':  applyFrameLook(materials.frame, v); break;
		case 'labels': scene.traverse(o => { if (o.name === 'label') o.visible = v; }); break;
		case 'plan':   planAgain(); break;    // the scan planned again; with no scan the switch only shows its state
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
