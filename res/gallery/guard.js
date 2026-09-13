import * as THREE from '../vendor/three.module.js';
import { elevator, lift } from './elevator.js?v=20260916i';   // its audio, and where the cabin stands
import { ELEVATOR } from './hang.js?v=20260916i';
import { pannerAt } from './music.js?v=20260916i';
import { inPoly } from './plan.js?v=20260916i';
import { head, scene, world } from './scene.js?v=20260916i';
import { state } from './state.js?v=20260916i';

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
// nothing else. It never speaks twice
// about the same thing, and never within a quarter of a minute of itself.

const GREY = 0x3c3f44, SEE = 0.75;        // a quarter transparent (Uli)
const EDGE = 0.015;                        // and drawn round with a 1.5 cm outline (Uli, 2026-09-12)
const EDGE_GREY = 0x1b1d20;
const TALL = 1.8;                          // a person's height, full size (Uli)
const CLOSE = 0.55;                        // m off a print before he says anything at all (Uli, 2026-09-13)
const HARSHER = 0.3;                       // and inside this he stops being polite about it

// What it says. Several of everything, so it is never the same guard
// twice (Uli, 2026-09-12), and **how much of it** is the visitor's
// choice: `talk` light means warnings and little else, heavy means one
// who likes the sound of his own voice. {n} is the count on the floor,
// {year} its year, {desc} and {place} a picture's own words.
const LINES = {
	greet: [
		'Good day. Take your time.',
		'Welcome. The newest are on the wall you are facing.',
		'Afternoon. Mind the step out of the lift.',
		'Everything on this floor was taken in one year.',
		'Do have a look round.',
	],
	warn: [
		'A little further back, please.',
		'Not so close to the picture, please.',
		'Please keep an arm\u2019s length from the prints.',
		'Careful. That one is nearer than it looks.',
		'Behind the line, if you would.',
		'Sir. The print, please.',
		'That is close enough, thank you.',
	],
	rush: [
		'Not so fast in here, please.',
		'Steady. There is a print right there.',
		'Slowly, please. That one is glass to me.',
		'Careful, you are coming at it rather quickly.',
	],
	row: [
		'Mind the row, please.',
		'There are prints on both sides of that.',
		'Careful going round the row.',
	],
	// he asks before he tells: the first word is as often an apology
	humble: [
		'Sorry to interrupt.',
		'Forgive me, sir. A little further back?',
		'If you would not mind, a step back.',
		'Excuse me. That is quite close.',
	],
	// and now and then he makes a small joke of it
	joke: [
		'That one is not going anywhere, I promise.',
		'I have counted them all. Twice.',
		'You may look as long as you like. From there.',
		'Every fingerprint, I have to explain.',
		'If it falls, we both have a problem.',
		'I know them better than the man who took them.',
	],
	// the one before he closes the room
	last: [
		'That is the last time I ask you.',
		'Right. I am closing this room.',
		'Enough. The prints come down.',
	],
	closed: [
		'The room is closed. Come back when you can keep your distance.',
		'They are down. You may look at the walls instead.',
	],
	open: [
		'Very well. They are back. Mind them this time.',
	],
	// what is left when calling across the room has not worked either
	harsh: [
		'That is enough now.',
		'I will not ask again.',
		'Step back. Thank you.',
		'Sir. I mean it.',
	],
	// what he calls across the room when the polite line went unheeded
	call: [
		'Hey.',
		'Hello?',
		'Mister!',
		'Please\u2026',
		'Did I not ask you?',
		'Excuse me!',
		'I am talking to you.',
	],
	// and what he says when someone is all but touching a print
	stop: [
		'Stop!',
		'Stop, please! Not that close!',
		'Away from the print. Now.',
	],
	tell: [
		'Take your time. Nobody is waiting.',
		'The lift is behind you when you are ready.',
		'Press a picture and it fills its frame.',
		'Touch a label and it grows.',
		'That one is worth a closer look. From here, mind.',
		'They were all taken after work.',
	],
	chat: [
		'Quiet today.',
		'The light in here never changes. It suits them.',
		'Some of these I have looked at a thousand times.',
		'The whole building holds four hundred and thirty.',
		'The lift takes its time. It always has.',
		'There is another floor above this one.',
	],
	// and now and then he runs on a bit. It is a boring job and it shows:
	// long sentences, and a little put out about something (Uli, 2026-09-13)
	ramble: [
		'I have stood in this corner since they opened the doors, and in all that time not one visitor has asked me which of them is any good, which is just as well, because after all these years I have not settled on an answer.',
		'They hang them, they light them, they put a little card underneath, and then they leave a man standing here for eight hours to make sure nobody touches the glass, of which, I might point out, there is none.',
		'People come up in the lift, walk the whole room in about four minutes, and go back down again, and I am left standing here wondering what it was exactly they came all this way to see.',
		'Every one of these was taken after work, which means somebody was tired and stopped anyway to look at something, and I have had a great deal of time to think about that, rather more than is strictly necessary.',
		'It is not a difficult job, this one, only a very long one, and I have come to understand that those are not at all the same thing.',
		'The lift takes its time, the pictures do not move, and I am told the light in here never changes, which is the sort of thing people say when they have been in the room for about a minute.',
	],
};
// light: it warns you and leaves you alone. heavy: it talks.
export const TALK = ['light', 'heavy'];
const MOOD = {
	light: { rest: 40000, still: 90000, chat: 0 },
	heavy: { rest: 12000, still: 30000, chat: 45000 },
};
// A guard interrupts himself for a picture. Anything about their safety
// gets its own short rest and is said **most times it happens** (Uli,
// 2026-09-12) — not every single time, which would be a machine.
const WARN_REST = 4000, WARN_AGAIN = 20000, WARN_ODDS = 0.85;
const FAST = 1.3;                          // m/s toward a print: too fast
const ROW_NEAR = 0.45;                     // m from a middle row's slab
const ROW_PATIENCE = 5000;                 // and how long he lets you stand there first (Uli)
const NARROW = 1.1;                        // m: something hanging this near on the other side means a narrow way
// He says his piece twice and then holds his tongue for a while — a guard
// who repeats himself every four seconds is a nag (Uli, 2026-09-12).
// Persist and he stops being polite: the third time and after he simply
// calls across the room, and inside VERY_CLOSE of a print he says stop.
const SAY_TWICE = 2, THEN_WAIT = 15000, FORGET = 30000;
const GREETS = 0.15;                       // how often he bothers to say hello at all (Uli: 0.25, then 0.33, and down to 0.15 on 2026-09-13 — he was greeting too much)
const JOKES = 0.25;                        // and how often a first word is a joke rather than a rule
const RAMBLES = 0.12;                      // and how often he runs on instead of saying the short thing (Uli, 2026-09-13: 0.25 was too much of it — a long line is 15 s and they came round often)
const VERY_CLOSE = 0.15;                   // m off a print: a hand's breadth, and he says stop (Uli)
const mood = () => MOOD[state.settings.talk] || MOOD.light;
// Every line of a kind is used before any of them comes round again
// (Uli, 2026-09-12: different phrases, not repeats): a shuffled bag per
// kind, drawn from until it is empty and then shuffled afresh — and never
// so that the last of one bag is the first of the next.
const bags = new Map();
function pick(kind) {
	const all = LINES[kind];
	let bag = bags.get(kind);
	if (!bag || !bag.left.length) {
		const order = all.map((_, i) => i);
		for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
		if (bag && order.length > 1 && order[0] === bag.last) [order[0], order[1]] = [order[1], order[0]];
		bag = { left: order, last: bag ? bag.last : -1 };
		bags.set(kind, bag);
	}
	const i = bag.left.shift();
	bag.last = i;
	return { kind, i, text: all[i] };
}
const MOVED = 0.4;                         // m that counts as having moved
// It stays where it is and walks a round now and then: the first three
// minutes after you come onto a floor, then every seven (Uli, 2026-09-12).
const FIRST_ROUND = 180000, EVERY = 420000;
const PACE = 0.45;                         // m/s — a guard is in no hurry
// It speaks aloud, calmly; only a warning is raised (Uli). The browser's
// own voice says it — nothing is fetched and no one is recorded — and
// where a browser has no voice, it stays silent — there is no caption.

let guard = null, saidAt = 0;
let stillSince = 0, last = new THREE.Vector3(), greeted = null;
const warnedAt = new Map();                // a print -> when it was last spoken about
let wasAt = new THREE.Vector3(), lastT = 0;
let strikes = 0, lastStrike = 0, quietUntil = 0, rowSince = 0;
let rage = 0, rageFrom = 0, shutUntil = 0;

// The prints off the walls, and back again: their faces are simply not
// drawn, so the frames and their mats stay where they are and the room
// reads as one that has been closed rather than one that has emptied.
function shutPrints(off) {
	const pieces = scene.getObjectByName('pieces');
	if (!pieces) return;
	pieces.traverse(o => { if (o.name === 'photo' || o.name === 'video') o.visible = !off; });
}
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

	// **Nothing is drawn** (Uli, 2026-09-12: remove the silhouette, keep
	// the voice). The guard is where it is, walks its round, watches how
	// close you come and speaks — it is simply not to be seen. Everything
	// that made a figure of it is kept below, unused, for the day it is
	// wanted back.
	ready = true;

	// It belongs to the **room**, not to the session: its corner is given in
	// the room's own coordinates, and in the headset the room is moved and
	// turned onto the real walls. Hung on the scene instead, it stood
	// wherever the room had been before — heard but never seen (Uli,
	// 2026-09-12).
	world.add(guard);
}


// The voice is **recorded**, not the browser's (Uli, 2026-09-12: a
// headset that has no speech engine showed cards instead, and cards are
// not what a guard does). Every line he has is a small file in
// res/sound/guard, said once and kept; they go through the same audio
// the lift's sounds use, so whatever is heard in there is heard here.
// It falls away with the distance from where he stands, and a warning is
// said at full.
const SAY_FAR = 9;                         // metres: past this he is not heard
// how loud each kind is said
const TEMPER = {
	greet: 0.6, tell: 0.6, chat: 0.55, ramble: 0.52, joke: 0.6, humble: 0.62,   // he mutters the long ones
	warn: 0.72, row: 0.7, rush: 0.9, call: 1, harsh: 1.15, stop: 1.25, last: 1.3, closed: 1.05, open: 0.75,
};
const RAGE = 3, RAGE_IN = 30000, SHUT_FOR = 45000;   // three in half a minute and the room is shut
let voices = new Map(), vGain = null;

function out() {
	if (vGain || !lift.ctx) return vGain;
	vGain = lift.ctx.createGain(); vGain.gain.value = 1;
	vGain.connect(lift.ctx.destination);
	return vGain;
}
async function line(kind, i) {
	const key = `${kind}-${i}`;
	if (voices.has(key)) return voices.get(key);
	voices.set(key, null);
	try {
		const r = await fetch(`/res/sound/guard/${key}.mp3`);
		const b = await lift.ctx.decodeAudioData(await r.arrayBuffer());
		voices.set(key, b);
		return b;
	} catch (e) { console.warn('guard', key, e); return null; }
}
// how loud from where you are: full beside him, gone across a big room
function heard() {
	if (!guard) return 1;
	const d = Math.hypot(_h.x - guard.position.x, _h.z - guard.position.z);
	return Math.max(0.25, 1 - Math.max(0, d - 1) / SAY_FAR);
}
async function speak(kind, i, loud) {
	if (!lift.ctx || lift.ctx.state !== 'running' || !out()) return;
	const b = await line(kind, i);
	if (!b) return;
	const src = lift.ctx.createBufferSource();
	src.buffer = b;
	// Loudness here; the **pitch is in the recording itself** — the sharper
	// lines were spoken higher and quicker by the synthesiser, not played
	// faster, which would only have sounded like a wound-up tape (Uli,
	// 2026-09-13).
	const g = lift.ctx.createGain();
	g.gain.value = (TEMPER[kind] || 0.7) * heard();
	// **out of the corner he stands in** (Uli, 2026-09-12), not out of the
	// middle of your head: a panner where he is, asked for the direction
	// only — the loudness is `heard()`, by the distance across the room
	const p = lift.ctx.createPanner();
	p.panningModel = 'HRTF'; p.distanceModel = 'linear';
	p.refDistance = 1; p.maxDistance = 1000; p.rolloffFactor = 0;
	pannerAt(p, guard.getWorldPosition(new THREE.Vector3()).setY(1.6));
	src.connect(g); g.connect(p); p.connect(vGain);
	src.start();
}

// **He speaks over the music** (Uli, 2026-09-13). The music is never turned
// down for him either — both simply play, as in a real lobby. He waited for
// a gap earlier the same day, which kept him quiet through whole rooms:
// the music reaches most of the floor from an open cabin.
function say(said, now, loud = false) {
	if (now - saidAt < (loud ? WARN_REST : mood().rest)) return false;
	speak(said.kind, said.i, loud);
	saidAt = now;
	return true;
}

// For the bench's checks: what the picker would say next.
export function nextLine(kind) { return pick(kind).text; }

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
	saidAt = 0; warnedAt.clear(); lastT = 0;
	strikes = 0; quietUntil = 0; rowSince = 0; rage = 0; shutUntil = 0;   // a new floor, a fresh start for whoever walks in
	shutPrints(false);                           // and whatever he took down is back up
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
	// While the room is shut there is nothing more to say, and when its
	// time is up the prints go back on the walls (Uli, 2026-09-13). This
	// comes before everything else: he may be halfway round the room.
	if (shutUntil) {
		if (now < shutUntil) return;
		shutUntil = 0; rage = 0; strikes = 0; quietUntil = 0; warnedAt.clear();
		shutPrints(false);
		say(pick('open'), now);
		return;
	}
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


	// a word on arriving, but only sometimes — a guard does not greet
	// every entrance (Uli, 2026-09-12) — and **not until the visitor is
	// out in the room** (Uli, 2026-09-13: the greeting came as the doors
	// closed on the way out). The next floor is hung during the ride, so
	// state.roomKey turns over while the old room is still around you and
	// you are still in the cabin; the new room's guard was greeting a
	// closing door. He waits now until the lift has stopped and you have
	// stepped out of it.
	if (greeted !== state.roomKey && !elevator.ride && !elevator.inside()) {
		greeted = state.roomKey;
		if (Math.random() < GREETS && say(pick('greet'), now)) return;
	}
	// How fast, and toward what: a guard watches the room, not a clock.
	const dt2 = Math.max(0.001, (now - (lastT || now)) / 1000);
	const speed = lastT ? _h.distanceTo(wasAt) / dt2 : 0;
	lastT = now; wasAt.copy(_h);

	// anything that puts a print at risk — coming too close to one, coming
	// at one quickly, or crowding a middle row — and it says so, most
	// times (Uli, 2026-09-12)
	let near = null, row = null;
	for (const p of state.placed || []) {
		const d = Math.hypot(p.x - _h.x, p.z - _h.z);
		if (p.wall === 'mid') { if (d < ROW_NEAR + p.piece.w / 2 && (!row || d < row.d)) row = { p, d }; }
		else if (p.wall !== 'cabin' && d < CLOSE && (!near || d < near.d)) {
			// only from the front: behind a print there is nothing to hurt, and
			// nothing to look at either (Uli, 2026-09-13)
			const front = (_h.x - p.x) * Math.sin(p.yaw) + (_h.z - p.z) * Math.cos(p.yaw);
			if (front > 0) near = { p, d };
		}
	}
	// A narrow way with prints hung on both sides is nobody's fault: there
	// is nowhere to stand further back, and a guard knows it (Uli,
	// 2026-09-12). Where something hangs within a stride on each side of
	// you he says nothing, about the print or the row, and only a hand on
	// the glass still counts.
	const first = near || row;
	let hemmed = false;
	if (first) {
		const ax = first.p.x - _h.x, az = first.p.z - _h.z, al = Math.hypot(ax, az) || 1;
		for (const p of state.placed || []) {
			if (p === first.p) continue;
			const bx = p.x - _h.x, bz = p.z - _h.z, bl = Math.hypot(bx, bz);
			if (bl > NARROW || bl < 0.2) continue;                 // its own back-to-back twin is not the far side
			if ((ax * bx + az * bz) / (al * bl) < -0.35) { hemmed = true; break; }
		}
	}
	if (hemmed) {
		row = null;
		if (near && near.d > VERY_CLOSE) near = null;
	}
	// He holds his tongue **as you leave** — at the doors, in the cabin —
	// but not as you arrive: arriving happens at the lift too, and the
	// greeting above has already had its chance (Uli, 2026-09-12).
	const o = elevator.origin;
	const atLift = elevator.inside() || (o && Math.hypot(_h.x - o.x, _h.z - o.z) < ELEVATOR.size * 1.4);
	if (atLift) { rowSince = 0; return; }
	// behave for half a minute and he forgets you were ever told
	if (strikes && now - lastStrike > FORGET) strikes = 0;
	const fresh = p => now - (warnedAt.get(p) || -1e9) > WARN_AGAIN;
	const mind = (p, kind, d) => {
		// A hand's breadth off a print is not something to wait one's turn
		// about, and neither is walking back inside thirty centimetres: both
		// cut through his quiet and through the rest he would give you (Uli,
		// 2026-09-13).
		const stop = d !== undefined && d < VERY_CLOSE;
		const sharp = d !== undefined && d < HARSHER;
		if (!sharp && now < quietUntil) return false;         // he has said his piece; he is waiting
		if (!sharp && (!fresh(p) || Math.random() > WARN_ODDS)) return false;
		// The ladder (Uli, 2026-09-12): humble or plain to begin with, a
		// small joke now and then; calling across the room once he has been
		// ignored twice; hard words when even that is ignored; and `stop`
		// whenever a hand is a breath from a print.
		// The temper follows the distance as much as the count: a first word
		// at 55 cm is polite, inside 30 cm it is not, and a hand's breadth is
		// always stop (Uli, 2026-09-13).
		const say_ = stop ? 'stop'
			: strikes >= SAY_TWICE * 2 ? 'harsh'
			: sharp ? (strikes >= SAY_TWICE ? 'harsh' : 'call')
			: strikes >= SAY_TWICE ? 'call'
			: kind !== 'warn' ? kind
			: Math.random() < JOKES ? 'joke'
			: Math.random() < 0.5 ? 'humble' : 'warn';
		// Three inside half a minute and he stops asking: a last word, and
		// the prints come off the walls until he is satisfied (Uli,
		// 2026-09-13). They come back by themselves.
		rage = now - rageFrom > RAGE_IN ? 1 : rage + 1;
		if (rage === 1) rageFrom = now;
		if (rage >= RAGE && !shutUntil) {
			say(pick('last'), now, true);
			shutUntil = now + SHUT_FOR;
			setTimeout(() => { shutPrints(true); say(pick('closed'), performance.now(), true); }, 1400);
			warnedAt.set(p, now); strikes++; lastStrike = now;
			return true;
		}
		if (!say(pick(say_), now, true)) return false;
		warnedAt.set(p, now);
		strikes++; lastStrike = now;
		if (strikes % SAY_TWICE === 0) quietUntil = now + THEN_WAIT;
		return true;
	};
	if (near && speed > FAST && mind(near.p, 'rush', near.d)) return;
	if (near && mind(near.p, 'warn', near.d)) return;
	// a row is only worth a word if you have been crowding it a while (Uli)
	rowSince = row ? (rowSince || now) : 0;
	if (row && now - rowSince > ROW_PATIENCE && mind(row.p, 'row')) return;

	// standing still a long while: something to look at
	if (_h.distanceTo(last) > MOVED) { last.copy(_h); stillSince = now; return; }
	if (!stillSince) { stillSince = now; return; }
	const m = mood();
	if (now - stillSince > m.still) {
		stillSince = now;
		say(pick(Math.random() < RAMBLES ? 'ramble' : 'tell'), now);
		return;
	}
	// heavy: it finds something to say now and then, whether or not you move
	if (m.chat && now - saidAt > m.chat) say(pick(Math.random() < RAMBLES ? 'ramble' : 'chat'), now);
}
