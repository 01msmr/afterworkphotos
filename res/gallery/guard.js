import * as THREE from '../vendor/three.module.js';
import { ELEVATOR } from './hang.js?v=20260912m';
import { inPoly } from './plan.js?v=20260912m';
import { head, world } from './scene.js?v=20260912m';
import { state } from './state.js?v=20260912m';

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

let guard = null, saidAt = 0;
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
const WIDE = 0.5;                          // and this fraction of its height across

// The path, drawn for a 512-wide canvas of 1024. A person, not a shape:
// the head an oval, the shoulders sloped and not level with each other,
// a waist, arms that hang a little away from the body with a gap at the
// hip, legs that taper to small feet (Uli, 2026-09-12: more natural,
// less geometric). `swing` runs -1 to 1 and scissors the legs; the arms
// swing against them, as arms do.
function silhouette(g, swing = 0) {
	const foot = 30 * swing, knee = 14 * swing, arm = -10 * swing;
	g.beginPath();
	g.moveTo(256, 44);
	// the head: an oval, a touch narrower at the jaw
	g.bezierCurveTo(300, 44, 312, 88, 306, 132);
	g.bezierCurveTo(302, 162, 292, 178, 284, 186);
	// the neck, and the right shoulder sloping off it
	g.bezierCurveTo(282, 200, 284, 208, 292, 214);
	g.bezierCurveTo(330, 224, 360, 248, 374, 288);
	// the arm: out, then in to the hand, with the body's line behind it
	g.bezierCurveTo(384, 330, 390 + arm, 392, 388 + arm, 446);
	g.bezierCurveTo(386 + arm, 512, 378 + arm, 566, 368 + arm, 596);
	g.bezierCurveTo(362 + arm, 614, 348 + arm, 616, 342 + arm, 600);
	g.bezierCurveTo(336, 578, 340, 546, 344, 508);
	// the waist coming back in, and the hip
	g.bezierCurveTo(348, 470, 346, 430, 340, 396);
	g.bezierCurveTo(344, 452, 348, 508, 350, 560);
	// the right leg: thigh, knee, calf, a small foot
	g.bezierCurveTo(352 + knee, 620, 348 + knee, 700, 342 + foot, 772);
	g.bezierCurveTo(336 + foot, 856, 330 + foot, 930, 326 + foot, 968);
	g.bezierCurveTo(324 + foot, 986, 306 + foot, 992, 292 + foot, 986);
	g.bezierCurveTo(282 + foot, 980, 280 + foot, 964, 282 + foot, 944);
	g.bezierCurveTo(286 + foot, 890, 284 + knee, 812, 276, 740);
	// up between the legs and down the left one
	g.bezierCurveTo(270, 700, 262, 698, 256, 728);
	g.bezierCurveTo(248, 800, 240 - knee, 878, 238 - foot, 944);
	g.bezierCurveTo(238 - foot, 964, 234 - foot, 980, 222 - foot, 986);
	g.bezierCurveTo(208 - foot, 992, 190 - foot, 986, 188 - foot, 968);
	g.bezierCurveTo(184 - foot, 930, 178 - foot, 856, 172 - foot, 772);
	g.bezierCurveTo(166 - knee, 700, 162 - knee, 620, 164, 560);
	// the left hip, waist, arm and shoulder, and back to the head
	g.bezierCurveTo(166, 508, 170, 452, 174, 396);
	g.bezierCurveTo(168, 430, 166, 470, 170, 508);
	g.bezierCurveTo(174, 546, 178, 578, 172, 600);
	g.bezierCurveTo(166 - arm, 616, 152 - arm, 614, 146 - arm, 596);
	g.bezierCurveTo(136 - arm, 566, 128 - arm, 512, 126 - arm, 446);
	g.bezierCurveTo(124 - arm, 392, 130, 330, 140, 288);
	g.bezierCurveTo(154, 248, 184, 224, 222, 214);
	g.bezierCurveTo(230, 208, 232, 200, 230, 186);
	g.bezierCurveTo(222, 178, 212, 162, 208, 132);
	g.bezierCurveTo(202, 88, 212, 44, 256, 44);
	g.closePath();
}

function figureTexture(swing) {
	const c = document.createElement('canvas');
	c.width = Math.round(PX * WIDE); c.height = PX;
	const g = c.getContext('2d');
	g.setTransform(c.width / 512, 0, 0, PX / 1024, 0, 0);   // the path above is drawn 512 by 1024
	const hex = n => '#' + n.toString(16).padStart(6, '0');
	silhouette(g, swing);
	// the outline first: a stroke twice the width, half of it left outside
	g.lineJoin = 'round'; g.lineCap = 'round';
	g.lineWidth = 2 * EDGE / TALL * 1024;                  // 1.5 cm of a 1.8 m figure (Uli)
	g.strokeStyle = hex(EDGE_GREY);
	g.stroke();
	g.fillStyle = hex(GREY);
	g.fill();
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

// Six poses across one stride, the swing following a sine, so the legs
// pass through the middle quickly and linger at the ends, as legs do.
const POSES = [0, 0.87, 0.87, 0, -0.87, -0.87].map((v, i) => Math.sin(i / 6 * Math.PI * 2));
let frames = null, fig = null, phase = 0, sway = 0;

function build() {
	guard = new THREE.Group(); guard.name = 'guard'; guard.visible = false;
	frames = POSES.map(figureTexture);
	fig = new THREE.Mesh(new THREE.PlaneGeometry(TALL * WIDE, TALL),
		new THREE.MeshBasicMaterial({ map: frames[0], transparent: true, opacity: SEE, depthWrite: false }));
	fig.position.y = TALL / 2;
	fig.name = 'guard-figure';
	guard.add(fig);
	// It belongs to the **room**, not to the session: its corner is given in
	// the room's own coordinates, and in the headset the room is moved and
	// turned onto the real walls. Hung on the scene instead, it stood
	// wherever the room had been before — heard but never seen (Uli,
	// 2026-09-12).
	world.add(guard);
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
	if (now - saidAt < mood().rest) return false;
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
	// the corner furthest from the lift that is really floor: in an L or a
	// U room the bounding box has corners the room does not
	const spots = places();
	const cab = [r.W / 2 - ELEVATOR.size / 2, -r.D / 2 + ELEVATOR.size / 2];
	const far = spots.reduce((best, p) => {
		const d = Math.hypot(p[0] - cab[0], p[1] - cab[1]);
		return !best || d > best.d ? { p, d } : best;
	}, null);
	guard.position.set(far ? far.p[0] : 0, 0, far ? far.p[1] : 0);
	guard.visible = true;
	saidAt = 0; warnedOf = null;
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
		fig.material.map = frames[0]; fig.position.y = TALL / 2; fig.rotation.z = 0;
		return false;
	}
	const step = Math.min(d, PACE * dt);
	guard.position.x += dx / d * step; guard.position.z += dz / d * step;
	guard.rotation.y = Math.atan2(dx, dz);              // it faces the way it walks
	// the legs scissor at two steps a second, and it rises a little on each
	phase += step / 0.62;                                // a pace is about 62 cm
	fig.material.map = frames[Math.floor(phase * frames.length) % frames.length];
	fig.position.y = TALL / 2 + Math.abs(Math.sin(phase * Math.PI)) * 0.014;
	fig.rotation.z = Math.sin(phase * Math.PI * 2) * 0.012;   // the body rolls a little over each pace
	return true;
}

const _h = new THREE.Vector3();
export function stepGuard(now) {
	if (!guard || !guard.visible || !state.room) return;
	_h.copy(world.worldToLocal(head().clone()));            // the visitor, in the room's own frame — where the guard lives
	_h.y = 0;
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
	const s = now / 1000;
	fig.scale.y = 1 + Math.sin(s * 1.35) * 0.004;          // breath
	fig.position.y = TALL / 2 * fig.scale.y;
	sway += ((Math.sin(s * 0.37) + Math.sin(s * 0.23)) * 0.006 - sway) * 0.04;
	fig.rotation.z = sway;                                  // the weight going slowly from one foot to the other

	// a floor entered for the first time: a word about the year
	if (greeted !== state.roomKey) {
		greeted = state.roomKey;
		const n = (state.placed || []).reduce((s, p) => s + p.piece.photos.length, 0);
		if (say(pick('greet', { n, year: state.year }), now)) return;
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
