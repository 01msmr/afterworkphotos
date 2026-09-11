import * as THREE from '../vendor/three.module.js';
import { ELEVATOR } from './hang.js?v=20260912h';
import { head, scene, world } from './scene.js?v=20260912h';
import { state } from './state.js?v=20260912h';

// ---------------------------------------------------------------------------
// The guard
//
// A museum has someone standing in the corner who says "not so close,
// please" and, if you stand long enough, tells you something about what
// you are looking at. This is that person (Uli, 2026-09-11): **full
// size, dark grey, a quarter transparent** and with no detail to speak of
// — a silhouette, not a portrait, so nothing about it asks to be looked
// at closely.
//
// It stands in the corner furthest from the lift, turns to face whoever
// is in the room, and speaks aloud. It never speaks twice
// about the same thing, and never within a quarter of a minute of itself.

const GREY = 0x3c3f44, SEE = 0.75;        // a quarter transparent (Uli)
const EDGE = 0.015;                        // and drawn round with a 1.5 cm outline (Uli, 2026-09-12)
const EDGE_GREY = 0x1b1d20;
const TALL = 1.8;                          // a person's height, full size (Uli)
const REST = 15000;                        // ms before it will speak again
const CLOSE = 0.55;                        // m from a print: too close
const STILL = 45000;                       // ms unmoved before it offers something
const MOVED = 0.4;                         // m that counts as having moved
// It stays where it is and walks a round now and then: the first three
// minutes after you come onto a floor, then every seven (Uli, 2026-09-12).
const FIRST_ROUND = 180000, EVERY = 420000;
const PACE = 0.45;                         // m/s — a guard is in no hurry
// It speaks aloud, calmly; only a warning is raised (Uli). The browser's
// own voice says it — nothing is fetched and no one is recorded — and
// where a browser has no voice, it stays silent — there is no caption.
const VOICE = { calm: 0.5, warn: 1, rate: 0.92, pitch: 0.92 };

let guard = null, saidAt = 0;
let stillSince = 0, last = new THREE.Vector3(), warnedOf = null, greeted = null;
let cameAt = 0, nextRound = 0, walkTo = null, voice = null;

// The figure is **flat and drawn, not built** (Uli, 2026-09-12): one
// silhouette on a plane that turns to the visitor — soft all through,
// nothing square about it, a coat-like body with the arms in it and the
// legs suggested below. The outline is a stroke of the same path, half
// of it standing outside the fill, so it runs round the whole figure at
// one thickness and shows no seam where the parts meet.
const PX = 1024;                           // the canvas is this tall; the figure is TALL metres
const WIDE = 0.52;                         // and this fraction of its height across

// The path, drawn for a 512-wide canvas. `swing` runs -1 to 1 and opens
// the legs: seen head-on, a figure whose legs scissor is a figure
// walking (Uli, 2026-09-12: let it walk like real).
function silhouette(g, swing = 0) {
	const foot = 26 * swing, knee = 12 * swing;
	g.beginPath();
	g.moveTo(256, 52);
	// head, jaw and neck
	g.bezierCurveTo(322, 52, 330, 128, 306, 172);
	g.bezierCurveTo(300, 190, 302, 198, 312, 208);
	// shoulder, and the arm lying in the coat
	g.bezierCurveTo(352, 228, 380, 276, 390, 352);
	g.bezierCurveTo(400, 440, 398, 520, 388, 596);
	g.bezierCurveTo(384, 626, 374, 642, 356, 650);
	// the right leg, its foot, and up the inside
	g.bezierCurveTo(352 + knee, 720, 348 + foot, 840, 340 + foot, 964);
	g.bezierCurveTo(338 + foot, 986, 320 + foot, 994, 300 + foot, 990);
	g.bezierCurveTo(286 + foot, 986, 280 + foot, 972, 280 + foot, 950);
	g.bezierCurveTo(278 + foot, 860, 272 + knee, 780, 262, 706);
	// between the legs, and the left leg down and back up
	g.bezierCurveTo(258, 690, 254, 690, 250, 706);
	g.bezierCurveTo(240 - knee, 780, 234 - foot, 860, 232 - foot, 950);
	g.bezierCurveTo(232 - foot, 972, 226 - foot, 986, 212 - foot, 990);
	g.bezierCurveTo(192 - foot, 994, 174 - foot, 986, 172 - foot, 964);
	g.bezierCurveTo(164 - foot, 840, 160 - knee, 720, 156, 650);
	// the left side of the coat, the shoulder and the neck back to the head
	g.bezierCurveTo(138, 642, 128, 626, 124, 596);
	g.bezierCurveTo(114, 520, 112, 440, 122, 352);
	g.bezierCurveTo(132, 276, 160, 228, 200, 208);
	g.bezierCurveTo(210, 198, 212, 190, 206, 172);
	g.bezierCurveTo(182, 128, 190, 52, 256, 52);
	g.closePath();
}

function figureTexture(swing) {
	const c = document.createElement('canvas');
	c.width = Math.round(PX * WIDE); c.height = PX;
	const g = c.getContext('2d');
	g.setTransform(c.width / 512, 0, 0, 1, 0, 0);          // the path above is drawn 512 wide
	const hex = n => '#' + n.toString(16).padStart(6, '0');
	silhouette(g, swing);
	// the outline first: a stroke twice the width, half of it left outside
	g.lineJoin = 'round'; g.lineCap = 'round';
	g.lineWidth = 2 * EDGE / TALL * PX;                   // 1.5 cm of a 1.8 m figure (Uli)
	g.strokeStyle = hex(EDGE_GREY);
	g.stroke();
	g.fillStyle = hex(GREY);
	g.fill();
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

// Four poses, the legs closed, open, closed, open the other way: the
// oldest walk cycle there is.
const POSES = [0, 1, 0, -1];
let frames = null, fig = null, phase = 0;

function build() {
	guard = new THREE.Group(); guard.name = 'guard'; guard.visible = false;
	frames = POSES.map(figureTexture);
	fig = new THREE.Mesh(new THREE.PlaneGeometry(TALL * WIDE, TALL),
		new THREE.MeshBasicMaterial({ map: frames[0], transparent: true, opacity: SEE, depthWrite: false }));
	fig.position.y = TALL / 2;
	fig.name = 'guard-figure';
	guard.add(fig);
	scene.add(guard);
}


// The voice: whatever calm English one the browser has, said slowly.
function speak(text, loud) {
	const S = window.speechSynthesis;
	if (!S) return;
	try {
		if (!voice) {
			const all = S.getVoices() || [];
			voice = all.find(v => /en(-|_)GB/i.test(v.lang) && v.localService) || all.find(v => /^en/i.test(v.lang)) || all[0] || null;
		}
		S.cancel();
		const u = new SpeechSynthesisUtterance(text);
		if (voice) u.voice = voice;
		u.rate = VOICE.rate; u.pitch = VOICE.pitch;
		u.volume = loud ? VOICE.warn : VOICE.calm;      // calm, unless a picture is in danger (Uli)
		S.speak(u);
	} catch (e) {}
}
// It speaks. There is no card and no bubble (Uli, 2026-09-12: real
// speech): a guard says things, a museum does not caption them.
function say(text, now, loud = false) {
	if (now - saidAt < REST) return false;
	speak(text, loud);
	saidAt = now;
	return true;
}

// Where it stands: the corner of the room furthest from the lift, a
// little off both walls, facing the room.
export function placeGuard() {
	if (!guard) build();
	const r = state.room;
	if (!r) { guard.visible = false; return; }
	const x = -r.W / 2 + 0.55, z = r.D / 2 - 0.55;          // the south-west corner; the lift has the north-east
	guard.position.set(x, 0, z);
	guard.visible = true;
	saidAt = 0; warnedOf = null;
	stillSince = 0; walkTo = null;
	cameAt = performance.now(); nextRound = cameAt + FIRST_ROUND;   // its first round, three minutes in
}

// Its round: the room's corners in turn, a little off the walls, at a
// walking pace. The lift's corner is left alone.
function corners() {
	const r = state.room, e = ELEVATOR.size, m = 0.55;
	return [[-r.W / 2 + m, r.D / 2 - m], [r.W / 2 - m, r.D / 2 - m], [r.W / 2 - m, -r.D / 2 + e + m], [-r.W / 2 + m, -r.D / 2 + m]];
}
function stepRound(now, dt) {
	if (!walkTo) {
		if (now < nextRound) return false;
		const c = corners();
		let at = 0, best = Infinity;
		c.forEach(([x, z], i) => { const d = Math.hypot(x - guard.position.x, z - guard.position.z); if (d < best) { best = d; at = i; } });
		const to = c[(at + 1) % c.length];
		walkTo = new THREE.Vector3(to[0], 0, to[1]);
		return true;
	}
	const dx = walkTo.x - guard.position.x, dz = walkTo.z - guard.position.z;
	const d = Math.hypot(dx, dz);
	if (d < 0.05) {                                     // arrived: it stands again, feet together
		walkTo = null; nextRound = now + EVERY;
		fig.material.map = frames[0]; fig.position.y = TALL / 2;
		return false;
	}
	const step = Math.min(d, PACE * dt);
	guard.position.x += dx / d * step; guard.position.z += dz / d * step;
	guard.rotation.y = Math.atan2(dx, dz);              // it faces the way it walks
	// the legs scissor at two steps a second, and it rises a little on each
	phase += step / 0.62;                                // a pace is about 62 cm
	fig.material.map = frames[Math.floor(phase * 2) % frames.length];
	fig.position.y = TALL / 2 + Math.abs(Math.sin(phase * Math.PI)) * 0.012;
	return true;
}

const _h = new THREE.Vector3();
export function stepGuard(now) {
	if (!guard || !guard.visible || !state.room) return;
	_h.copy(world.worldToLocal(head().clone()));            // the visitor, in the room's own frame
	_h.y = 0;
	// walking its round, it watches where it is going, not you
	const dt = Math.min(0.05, (now - (stepGuard.last || now)) / 1000); stepGuard.last = now;
	if (stepRound(now, dt)) return;
	// otherwise it turns to whoever is in the room
	const dx = _h.x - guard.position.x, dz = _h.z - guard.position.z;
	if (dx * dx + dz * dz > 0.04) guard.rotation.y = Math.atan2(dx, dz);

	// a floor entered for the first time: a word about the year
	if (greeted !== state.roomKey) {
		greeted = state.roomKey;
		const n = (state.placed || []).reduce((s, p) => s + p.piece.photos.length, 0);
		if (say(`${n} photographs on this floor. Take your time.`, now)) return;
	}
	// too close to a print: the thing a guard is really for
	let near = null;
	for (const p of state.placed || []) {
		const d = Math.hypot(p.x - _h.x, p.z - _h.z);
		if (d < CLOSE + p.piece.w / 2 && (!near || d < near.d)) near = { p, d };
	}
	if (near) {
		if (warnedOf !== near.p && say('A little further back, please.', now, true)) { warnedOf = near.p; return; }
	} else warnedOf = null;

	// standing still a long while: something to look at
	if (_h.distanceTo(last) > MOVED) { last.copy(_h); stillSince = now; return; }
	if (!stillSince) { stillSince = now; return; }
	if (now - stillSince > STILL) {
		stillSince = now;
		const p = (state.placed || [])[Math.floor(Math.random() * (state.placed || []).length)];
		const ph = p && p.piece.photos[0];
		say(ph ? `${ph.desc || 'This one'} — ${ph.place || 'unknown place'}.` : 'The lift takes you to another year.', now);
	}
}
