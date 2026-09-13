import * as THREE from '../vendor/three.module.js';
import { camera, scene } from './scene.js?v=20260916i';
import { state } from './state.js?v=20260916i';
import { CARD_READ_Z, CARD_REST_Z } from './bake.js?v=20260916i';

// ---------------------------------------------------------------------------
// What a press makes bigger
//
// A print pressed fills its frame: the photo grows over the passepartout,
// edge to edge, and a second press puts it back (Uli, 2026-09-11). A
// label pressed doubles, as it always has. Either way, **anything left
// large goes back to itself once it has been out of sight for twenty
// seconds** (Uli) — so a room walked away from is found as it was.

const HOLD = 20000;                 // ms out of view before it goes back (Uli, 2026-09-11)
const SEEN = { angle: Math.cos(50 * Math.PI / 180), range: 14 };   // what counts as being looked at
const big = new Map();              // the thing -> when it was last in view

const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _d = new THREE.Vector3();


// A print pressed fills its frame; pressed again it sits back in its mat
// — and **a group goes together** (Uli, 2026-09-11): press one of a
// grid's prints and every print of that grid does the same, since they
// are one picture hung in parts. The way round it rests in is the `fill`
// setting: with the mat by default, or filled by default and the press
// showing the mat.
const rest = print => (state.settings.fill ? print.userData.full : 1);
function groupOf(print) {
	let g = print;
	while (g.parent && !(g.name || '').startsWith('piece-')) g = g.parent;
	const out = [];
	(g.name || '').startsWith('piece-') ? g.traverse(o => { if (o.name === 'photo') out.push(o); }) : out.push(print);
	return out;
}
export function zoomPrint(print, now = performance.now()) {
	const full = print.userData.full;
	if (!full) return false;
	const out = print.scale.x < full - 0.001;                 // pressed while sitting in its mat
	const prints = groupOf(print);
	for (const p of prints) p.scale.setScalar(out ? p.userData.full : 1);
	const away = prints.filter(p => Math.abs(p.scale.x - rest(p)) > 0.001);
	for (const p of prints) big.delete(p);
	for (const p of away) big.set(p, now);                    // only what is not the way it rests comes back by itself
	return true;
}

// A label block: the cards together, growing from the corner that sits by
// the frame. Beside a piece that corner is the **bottom** left, so the
// block climbs away from the dado instead of down into it (Uli,
// 2026-09-11); under a piece it stays the top right.
export function zoomLabel(L, now = performance.now()) {
	const k = L.cards[0].scale.x > 1.5 ? 1 : 2;
	const below = L.cards[0].userData.below;
	const ax = below ? Math.max(...L.cards.map(c => c.userData.x0 + L.cw / 2)) : Math.min(...L.cards.map(c => c.userData.x0 - L.cw / 2));
	const ay = below ? Math.max(...L.cards.map(c => c.userData.y0 + c.userData.ch / 2))
	                 : Math.min(...L.cards.map(c => c.userData.y0 - c.userData.ch / 2));
	for (const c of L.cards) {
		c.scale.set(k, k, 1);
		c.position.x = ax + (c.userData.x0 - ax) * k;
		c.position.y = ay + (c.userData.y0 - ay) * k;
		// doubled, it stands clear of the dado, the rail, the skirting and
		// the wainscot's cap; at rest, back on the wall (bake.js)
		c.position.z = k > 1 ? CARD_READ_Z : CARD_REST_Z;
	}
	if (k > 1) big.set(L, now); else big.delete(L);
	return true;
}

function where(thing) {
	if (thing.isObject3D) return thing.getWorldPosition(_p);
	return thing.cards[0].getWorldPosition(_p);      // a label block: its first card stands for it
}

export function stepZoom(now) {
	if (!big.size) return;
	camera.getWorldDirection(_v);
	const eye = camera.getWorldPosition(_d.set(0, 0, 0)).clone();
	camera.getWorldDirection(_v);
	for (const [thing, seen] of [...big]) {
		const p = where(thing).clone();
		const to = p.sub(eye), len = to.length();
		if (len < SEEN.range && to.normalize().dot(_v) > SEEN.angle) { big.set(thing, now); continue; }
		if (now - seen < HOLD) continue;
		if (thing.isObject3D) { thing.scale.setScalar(rest(thing)); big.delete(thing); }   // back to the way it rests
		else zoomLabel(thing, now);
	}
}

// A room hung afresh takes everything with it; nothing left large can
// belong to the room that has gone.
export function clearZoom() { big.clear(); }
