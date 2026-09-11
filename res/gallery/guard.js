import * as THREE from '../vendor/three.module.js';
import { ELEVATOR } from './hang.js?v=20260912f';
import { head, scene, world } from './scene.js?v=20260912f';
import { state } from './state.js?v=20260912f';

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
// is in the room, and speaks on a card beside it. It never speaks twice
// about the same thing, and never within a quarter of a minute of itself.

const GREY = 0x3c3f44, SEE = 0.75;        // a quarter transparent (Uli)
const EDGE = 0.015;                        // and drawn round with a 1.5 cm outline (Uli, 2026-09-12)
const EDGE_GREY = 0x1b1d20;
const TALL = 1.8;                          // a person's height, full size (Uli)
const SAY_FOR = 7000;                      // ms a card stays up
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
// where there is no voice the card still carries the words.
const VOICE = { calm: 0.5, warn: 1, rate: 0.92, pitch: 0.92 };

let guard = null, card = null, cardTex = null, saidAt = 0, until = 0;
let stillSince = 0, last = new THREE.Vector3(), warnedOf = null, greeted = null;
let cameAt = 0, nextRound = 0, walkTo = null, voice = null;

// The figure: a head, a body, two arms, two legs — boxes and a sphere,
// nothing more. Detail would only draw the eye (Uli: not much details).
function build() {
	guard = new THREE.Group(); guard.name = 'guard'; guard.visible = false;
	const m = new THREE.MeshLambertMaterial({ color: GREY, transparent: true, opacity: SEE, depthWrite: false });
	// Each part twice: the part itself, and the same shape 1.5 cm bigger
	// turned inside out behind it — the old way to draw a line round a
	// thing, and it costs no shader (Uli: a 1.5 cm outline).
	const line = new THREE.MeshBasicMaterial({ color: EDGE_GREY, transparent: true, opacity: SEE, side: THREE.BackSide, depthWrite: false });
	const put = (geo, x, y, z) => {
		const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); guard.add(o);
		geo.computeBoundingSphere();
		const grow = 1 + EDGE / Math.max(0.05, geo.boundingSphere.radius);
		const e = new THREE.Mesh(geo, line); e.position.set(x, y, z); e.scale.setScalar(grow); guard.add(e);
		return o;
	};
	put(new THREE.SphereGeometry(0.105, 16, 12), 0, TALL - 0.11, 0);                        // head
	put(new THREE.CylinderGeometry(0.052, 0.06, 0.1, 10), 0, TALL - 0.245, 0);              // neck
	put(new THREE.BoxGeometry(0.42, 0.62, 0.21), 0, TALL - 0.6, 0);                         // chest and shoulders
	put(new THREE.BoxGeometry(0.34, 0.22, 0.19), 0, TALL - 1.0, 0);                         // waist
	for (const s of [-1, 1]) {
		put(new THREE.CylinderGeometry(0.055, 0.05, 0.62, 8), s * 0.245, TALL - 0.62, 0);     // arms, at its sides
		put(new THREE.CylinderGeometry(0.075, 0.062, 0.92, 8), s * 0.1, TALL - 1.55, 0);      // legs
	}
	// the card it speaks on, beside its head
	const c = document.createElement('canvas'); c.width = 512; c.height = 128;
	cardTex = new THREE.CanvasTexture(c); cardTex.colorSpace = THREE.SRGBColorSpace;
	card = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.13), new THREE.MeshBasicMaterial({ map: cardTex, transparent: true, depthWrite: false }));
	card.position.set(0.42, TALL - 0.12, 0.02);
	card.visible = false;
	guard.add(card);
	scene.add(guard);
}

function write(text) {
	const c = cardTex.image, g = c.getContext('2d');
	g.clearRect(0, 0, c.width, c.height);
	g.fillStyle = 'rgba(24,25,27,0.82)';
	g.beginPath(); g.roundRect(0, 18, c.width, 92, 10); g.fill();
	g.fillStyle = '#e9e6e0'; g.textAlign = 'left'; g.textBaseline = 'middle';
	g.font = '300 34px Jost, "Helvetica Neue", Arial, sans-serif';
	g.fillText(text.slice(0, 42), 22, 64);
	cardTex.needsUpdate = true;
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
function say(text, now, loud = false) {
	if (now - saidAt < REST) return false;
	write(text);
	speak(text, loud);
	card.visible = true; saidAt = now; until = now + SAY_FOR;
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
	card.visible = false; saidAt = 0; until = 0; warnedOf = null;
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
	if (d < 0.05) { walkTo = null; nextRound = now + EVERY; return false; }
	const step = Math.min(d, PACE * dt);
	guard.position.x += dx / d * step; guard.position.z += dz / d * step;
	guard.rotation.y = Math.atan2(dx, dz);              // it faces the way it walks
	return true;
}

const _h = new THREE.Vector3();
export function stepGuard(now) {
	if (!guard || !guard.visible || !state.room) return;
	_h.copy(world.worldToLocal(head().clone()));            // the visitor, in the room's own frame
	_h.y = 0;
	if (card.visible && now > until) card.visible = false;
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
