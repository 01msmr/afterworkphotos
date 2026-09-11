import * as THREE from '../vendor/three.module.js';
import { ELEVATOR } from './hang.js?v=20260912w';
import { inPoly } from './plan.js?v=20260912w';
import { head, world } from './scene.js?v=20260912w';
import { state } from './state.js?v=20260912w';

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
// It stands in the corner furthest from the lift, moves about the room
// and speaks aloud — **and is not to be seen**: a voice in the room, and
// the card only where a browser has none. It never speaks twice
// about the same thing, and never within a quarter of a minute of itself.

const GREY = 0x3c3f44, SEE = 0.75;        // a quarter transparent (Uli)
const EDGE = 0.015;                        // and drawn round with a 1.5 cm outline (Uli, 2026-09-12)
const EDGE_GREY = 0x1b1d20;
const TALL = 1.8;                          // a person's height, full size (Uli)
const CLOSE = 0.55;                        // m from a print: too close

// What it says. Several of everything, so it is never the same guard
// twice (Uli, 2026-09-12), and **how much of it** is the visitor's
// choice: `talk` light means warnings and little else, heavy means one
// who likes the sound of his own voice. {n} is the count on the floor,
// {year} its year, {desc} and {place} a picture's own words.
const LINES = {
	greet: [
		'{n} photographs on this floor. Take your time.',
		'Welcome to {year}. {n} pictures in this room.',
		'This floor is {year}. Mind the step out of the lift.',
		'Good day. Everything here was taken in {year}.',
		'{year}. The newest are on the wall you are facing.',
	],
	warn: [
		'A little further back, please.',
		'Not so close to the picture, please.',
		'Please keep an arm\'s length from the prints.',
		'Careful — that one is nearer than it looks.',
		'Behind the line, if you would.',
	],
	tell: [
		'{desc} — {place}.',
		'That one is from {month} {year}.',
		'{place}, {year}. One of the better ones.',
		'Take your time. Nobody is waiting.',
		'The lift is behind you when you are ready.',
		'Press a picture and it fills its frame.',
		'Touch a label and it grows.',
	],
	chat: [
		'Quiet today.',
		'The light in here never changes. It suits them.',
		'Some of these I have looked at a thousand times.',
		'The whole building holds four hundred and thirty.',
		'The lift takes its time. It always has.',
		'There is another floor above this one.',
		'Mind the row in the middle.',
	],
};
// light: it warns you and leaves you alone. heavy: it talks.
export const TALK = ['light', 'heavy'];
const MOOD = {
	light: { rest: 40000, still: 90000, chat: 0 },
	heavy: { rest: 12000, still: 30000, chat: 45000 },
};
const mood = () => MOOD[state.settings.talk] || MOOD.light;
let lastLine = '';
function pick(kind, fill) {
	const all = LINES[kind];
	for (let i = 0; i < 8; i++) {
		let t = all[Math.floor(Math.random() * all.length)];
		if (t === lastLine && all.length > 1) continue;
		lastLine = t;
		return t.replace(/\{(\w+)\}/g, (m, k) => (fill && fill[k] !== undefined ? fill[k] : ''));
	}
	return all[0];
}
const MOVED = 0.4;                         // m that counts as having moved
// It stays where it is and walks a round now and then: the first three
// minutes after you come onto a floor, then every seven (Uli, 2026-09-12).
const FIRST_ROUND = 180000, EVERY = 420000;
const PACE = 0.45;                         // m/s — a guard is in no hurry
// It speaks aloud, calmly; only a warning is raised (Uli). The browser's
// own voice says it — nothing is fetched and no one is recorded — and
// where a browser has no voice, it stays silent — there is no caption.
const VOICE = { calm: 0.5, warn: 1, rate: 0.92, pitch: 0.92 };

let guard = null, saidAt = 0, card = null, cardTex = null, until = 0;
let stillSince = 0, last = new THREE.Vector3(), warnedOf = null, greeted = null;
let cameAt = 0, nextRound = 0, walkTo = null, voice = null;
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

// The figure is **flat and drawn, not built** (Uli, 2026-09-12): one
// silhouette on a plane that turns to the visitor — soft all through,
// nothing square about it, a coat-like body with the arms in it and the
// legs suggested below. The outline is a stroke of the same path, half
// of it standing outside the fill, so it runs round the whole figure at
// one thickness and shows no seam where the parts meet.
const PX = 640;                            // the canvas is this tall; the figure is TALL metres
const WIDE = 0.33;                         // the drawing's own proportions: a person is this narrow

// The figure is a real person's outline, not one I drew: a standing man
// from openclipart by way of publicdomainvectors, CC0, and shaped like a
// person actually is (Uli, 2026-09-12 — see res/textures/LICENSE.txt).
// It arrives as an SVG, is tinted to the guard's grey, and gets its
// outline the honest way: the same shape stamped eight times round a
// small circle in the darker grey, with the grey one laid on top.
const SRC = '/res/textures/guard-silhouette.svg';
const HIP = 0.52;                          // how far down the figure its legs begin
const STRIDE = 0.075;                      // how far a leg swings, as a share of the width
let img = null, ready = false;

// The silhouette in one colour, its own alpha kept.
function tinted(colour, w, h) {
	const c = document.createElement('canvas'); c.width = w; c.height = h;
	const g = c.getContext('2d');
	g.drawImage(img, 0, 0, w, h);
	g.globalCompositeOperation = 'source-in';
	g.fillStyle = colour; g.fillRect(0, 0, w, h);
	return c;
}
// One pose: the body as it is, and the legs carried left and right, so a
// still picture of a person becomes a person mid-stride.
function pose(g, src, swing, dx, dy) {
	const w = src.width, h = src.height, hip = h * HIP, foot = swing * STRIDE * w;
	const part = (x0, y0, ww, hh, ox) => {
		g.save(); g.beginPath(); g.rect(x0, y0, ww, hh); g.clip();
		g.drawImage(src, dx + ox, dy);
		g.restore();
	};
	part(0, 0, w, hip, 0);                                  // head, body, arms
	part(0, hip, w / 2, h - hip, -foot);                    // the near leg
	part(w / 2, hip, w / 2, h - hip, foot);                 // and the far one
}

function figureTexture(swing) {
	const w = Math.round(PX * WIDE), h = PX;
	const c = document.createElement('canvas'); c.width = w; c.height = h;
	const g = c.getContext('2d');
	const hex = n => '#' + n.toString(16).padStart(6, '0');
	const grey = tinted(hex(GREY), w, h), dark = tinted(hex(EDGE_GREY), w, h);
	const r = EDGE / TALL * PX;                             // 1.5 cm of a 1.8 m figure (Uli)
	for (let i = 0; i < 8; i++) pose(g, dark, swing, Math.cos(i / 8 * Math.PI * 2) * r, Math.sin(i / 8 * Math.PI * 2) * r);
	pose(g, grey, swing, 0, 0);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

// Six poses across one stride, the swing following a sine, so the legs
// pass through the middle quickly and linger at the ends, as legs do.
const POSES = [0, 1, 2, 3, 4, 5].map(i => Math.sin(i / 6 * Math.PI * 2));
let frames = null, fig = null, phase = 0, sway = 0;

function build() {
	guard = new THREE.Group(); guard.name = 'guard'; guard.visible = false;
	const c = document.createElement('canvas'); c.width = 640; c.height = 128;
	cardTex = new THREE.CanvasTexture(c); cardTex.colorSpace = THREE.SRGBColorSpace;
	card = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.124), new THREE.MeshBasicMaterial({ map: cardTex, transparent: true, depthWrite: false }));
	card.position.set(0.44, TALL - 0.06, 0.02);
	card.visible = false;
	// **Nothing is drawn** (Uli, 2026-09-12: remove the silhouette, keep
	// the voice). The guard is where it is, walks its round, watches how
	// close you come and speaks — it is simply not to be seen. Everything
	// that made a figure of it is kept below, unused, for the day it is
	// wanted back.
	ready = true;
	guard.add(card);
	// It belongs to the **room**, not to the session: its corner is given in
	// the room's own coordinates, and in the headset the room is moved and
	// turned onto the real walls. Hung on the scene instead, it stood
	// wherever the room had been before — heard but never seen (Uli,
	// 2026-09-12).
	world.add(guard);
}


// The voice: whatever calm English one the browser has, said slowly.
// **Not every browser has one** — a headset may carry no speech at all,
// and then the guard stood there saying nothing (Uli, 2026-09-12, on the
// Quest). So the first thing it says is timed: if nothing has begun
// within a second and a half, there is no voice here, and from then on it
// puts its words on a card instead. Words on a card beat silence.
let mute = false, tried = false;
function speak(text, loud) {
	const S = window.speechSynthesis;
	if (!S) { mute = true; return false; }
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
		let began = false;
		u.onstart = () => { began = true; };
		u.onerror = () => { mute = true; };
		S.speak(u);
		if (!tried) {                                    // the first one settles it
			tried = true;
			setTimeout(() => { if (!began) mute = true; }, 1500);
		}
		return true;
	} catch (e) { mute = true; return false; }
}
// It speaks. There is no card and no bubble (Uli, 2026-09-12: real
// speech): a guard says things, a museum does not caption them.
function write(text) {
	const c = cardTex.image, g = c.getContext('2d');
	g.clearRect(0, 0, c.width, c.height);
	g.fillStyle = 'rgba(24,25,27,0.82)';
	g.beginPath(); g.roundRect(0, 20, c.width, 88, 10); g.fill();
	g.fillStyle = '#e9e6e0'; g.textAlign = 'left'; g.textBaseline = 'middle';
	g.font = '300 30px Jost, "Helvetica Neue", Arial, sans-serif';
	g.fillText(text.slice(0, 52), 20, 64);
	cardTex.needsUpdate = true;
}
function say(text, now, loud = false) {
	if (now - saidAt < mood().rest) return false;
	speak(text, loud);
	if (mute) { write(text); card.visible = true; until = now + 7000; }   // no voice here: the words on a card
	saidAt = now;
	return true;
}

// Where it stands: the corner of the room furthest from the lift, a
// little off both walls, facing the room.
export function placeGuard() {
	if (!guard) build();
	const r = state.room;
	if (!r) { guard.visible = false; return; }
	// the corner furthest from the lift that is really floor: in an L or a
	// U room the bounding box has corners the room does not
	const spots = places();
	const cab = [r.W / 2 - ELEVATOR.size / 2, -r.D / 2 + ELEVATOR.size / 2];
	const far = spots.reduce((best, p) => {
		const d = Math.hypot(p[0] - cab[0], p[1] - cab[1]);
		return !best || d > best.d ? { p, d } : best;
	}, null);
	guard.position.set(far ? far.p[0] : 0, 0, far ? far.p[1] : 0);
	guard.visible = ready;
	saidAt = 0; warnedOf = null; if (card) card.visible = false;
	stillSince = 0; walkTo = null;
	cameAt = performance.now(); nextRound = cameAt + FIRST_ROUND;   // its first round, three minutes in
}

// Where it can stand: the corners of every part of the plan, a little off
// the walls, and only those that are inside the room — the corner of a
// bounding box is not floor in an L or a U. The lift's own square is left
// alone.
const M = 0.55;
function places() {
	const r = state.room, shape = r.shape, e = ELEVATOR.size;
	const out = [], seen = new Set();
	for (const q of shape ? shape.rects : [{ x0: -r.W / 2, x1: r.W / 2, z0: -r.D / 2, z1: r.D / 2 }]) {
		for (const x of [q.x0 + M, q.x1 - M]) for (const z of [q.z0 + M, q.z1 - M]) {
			if (x > r.W / 2 - 2 * e - M && z < -r.D / 2 + e + M) continue;    // the lift and the way out of it
			if (shape && !inPoly(shape.outline, x, z)) continue;
			const k = `${x.toFixed(2)}|${z.toFixed(2)}`;
			if (seen.has(k)) continue;
			seen.add(k); out.push([x, z]);
		}
	}
	return out;
}
function stepRound(now, dt) {
	if (!walkTo) {
		if (now < nextRound) return false;
		const c = places();
		if (c.length < 2) { nextRound = now + EVERY; return false; }
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
		return false;
	}
	const step = Math.min(d, PACE * dt);
	guard.position.x += dx / d * step; guard.position.z += dz / d * step;
	guard.rotation.y = Math.atan2(dx, dz);              // it faces the way it walks
	// the legs scissor at two steps a second, and it rises a little on each
	return true;
}

const _h = new THREE.Vector3();
export function stepGuard(now) {
	if (!guard || !guard.visible || !state.room) return;
	_h.copy(world.worldToLocal(head().clone()));            // the visitor, in the room's own frame — where the guard lives
	_h.y = 0;
	if (card.visible && now > until) card.visible = false;
	// walking its round, it watches where it is going, not you
	const dt = Math.min(0.05, (now - (stepGuard.last || now)) / 1000); stepGuard.last = now;
	if (stepRound(now, dt)) return;
	// otherwise it turns to whoever is in the room — and breathes, sways
	// and shifts its weight, since nobody stands perfectly still (Uli,
	// 2026-09-12: does it move naturally, at least a little?)
	const dx = _h.x - guard.position.x, dz = _h.z - guard.position.z;
	if (dx * dx + dz * dz > 0.04) {
		const to = Math.atan2(dx, dz);
		let turn = to - guard.rotation.y;
		while (turn > Math.PI) turn -= Math.PI * 2;
		while (turn < -Math.PI) turn += Math.PI * 2;
		guard.rotation.y += turn * Math.min(1, dt * 2.2);  // it turns its head, it does not snap round
	}


	// a floor entered for the first time: a word about the year
	if (greeted !== state.roomKey) {
		const n = (state.placed || []).reduce((s, p) => s + p.piece.photos.length, 0);
		if (say(pick('greet', { n, year: state.year }), now)) { greeted = state.roomKey; return; }
	}
	// too close to a print: the thing a guard is really for
	let near = null;
	for (const p of state.placed || []) {
		const d = Math.hypot(p.x - _h.x, p.z - _h.z);
		if (d < CLOSE + p.piece.w / 2 && (!near || d < near.d)) near = { p, d };
	}
	if (near) {
		if (warnedOf !== near.p && say(pick('warn'), now, true)) { warnedOf = near.p; return; }
	} else warnedOf = null;

	// standing still a long while: something to look at
	if (_h.distanceTo(last) > MOVED) { last.copy(_h); stillSince = now; return; }
	if (!stillSince) { stillSince = now; return; }
	const m = mood();
	if (now - stillSince > m.still) {
		stillSince = now;
		const p = (state.placed || [])[Math.floor(Math.random() * (state.placed || []).length)];
		const ph = p && p.piece.photos[0], d = ph ? ph.taken : '';
		say(pick('tell', {
			desc: (ph && ph.desc) || 'That one', place: (ph && ph.place) || 'somewhere',
			month: d ? MONTHS[+d.slice(5, 7) - 1] : '', year: d.slice(0, 4) || state.year,
		}), now);
		return;
	}
	// heavy: it finds something to say now and then, whether or not you move
	if (m.chat && now - saidAt > m.chat) say(pick('chat'), now);
}
