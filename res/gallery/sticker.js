import * as THREE from '../vendor/three.module.js';
import { camera, renderer, scene } from './scene.js?v=20260914s';
import { isFav, toggleFav } from './state.js?v=20260914s';

// ---------------------------------------------------------------------------
// Red dots
//
// A visitor marks a photograph the way a gallery marks a sold one: with a
// 1 cm red sticker (Uli, 2026-09-13). While the pointer is out, a dot
// rides the crossing of the ray and the wall; come within SNAP of the
// place a dot belongs and it leaves the pointer and adheres there, and a
// press sticks it on. A press on one already stuck peels it off.
//
// Where it belongs: **just under the label's right corner**, on the wall,
// since that is where a wall exists behind a frame (Uli) — and on the
// card's own paper for a piece in the middle of the room, where a slab
// hangs behind it and there is no wall to stick to.
//
// The place is **rolled afresh every time the room is hung** (Uli,
// 2026-09-13: they were always in the same spot, and a sticker put on by
// hand is not). It was a hash of the photograph's id, so a dot came back
// to the millimetre it left; a new roll each hang is what a sheet of
// stickers actually looks like on a wall.
//
// The dots are what the `favorites` floor is hung from (state.favs).
export const DOT_R = 0.0065;     // 1.3 cm across (Uli, 2026-09-13)
const LEFT = [-0.01, 0.06];      // how far left of the label's right corner — a centimetre further left than the first try (Uli, 2026-09-13)
const UNDER = [0.005, 0.015];    // and how far under its bottom edge (Uli: 0.5 to 1.5 cm)
const AIM_DROP = 0.10;           // **what you point at sits 10 cm under the sticker** (Uli): the
                                 // dot itself is tucked under the label, where a raised hand would
                                 // have to reach over the frame to get at it
const SNAP = 0.12;               // within this of that spot, the sticker leaves the pointer
const RED = 0xc8322b;
const between = ([a, b]) => a + Math.random() * (b - a);

const dotGeo = new THREE.CircleGeometry(DOT_R, 20);
const stuckMat = new THREE.MeshBasicMaterial({ color: RED });
const heldMat = new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.5, depthTest: false });

// A dot for every card of a piece, at its place, shown only if that
// photograph carries one. Called once the labels are placed.
export function addDots(piece) {
	const L = piece.userData.labels;
	if (!L) return;
	const mid = piece.userData.wall === 'mid';
	L.cards.forEach(card => {
		const p = card.userData.photo;
		if (!p) return;
		const dot = new THREE.Mesh(dotGeo, stuckMat);
		dot.name = 'dot';
		dot.userData.photo = p;
		// from the card's bottom right corner, a fresh roll each hang
		const right = card.position.x + L.cw / 2, bottom = card.position.y - card.userData.ch / 2;
		dot.position.set(right - between(LEFT), bottom - between(UNDER), mid ? 0.004 : 0.0006);   // on the paper, or a hair off the plaster
		dot.visible = isFav(p.id);
		piece.add(dot);
	});
}

// Every place a dot could go in the room that is standing, in world
// coordinates. Gathered when a room is hung, not every frame.
let spots = [];
export function findSpots() {
	spots = [];
	const pieces = scene.getObjectByName('pieces');
	if (!pieces) return;
	pieces.traverse(o => {
		if (o.name !== 'dot') return;
		const at = o.getWorldPosition(new THREE.Vector3());
		// the dot is drawn at `at`; it is **aimed at** from AIM_DROP lower
		const aim = at.clone(); aim.y -= AIM_DROP;
		spots.push({ dot: o, photo: o.userData.photo, at, aim });
	});
}

// the dot on the pointer, and what it is currently over
let held = null, over = null;
function heldDot() {
	if (!held) {
		held = new THREE.Mesh(dotGeo, heldMat);
		held.name = 'held-dot';
		held.renderOrder = 3;
		held.visible = false;
		scene.add(held);
	}
	return held;
}

// The ray the visitor is pointing: a controller in the headset (whichever
// hand is aimed at something nearer), the middle of the view on the bench.
const _rc = new THREE.Raycaster(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
function aimed() {
	if (!renderer.xr.isPresenting) {
		_rc.setFromCamera(new THREE.Vector2(0, 0), camera);
		return _rc;
	}
	let best = null;
	for (const i of [0, 1]) {
		const c = renderer.xr.getController(i);
		if (!c || !c.visible) continue;
		c.getWorldPosition(_o); c.getWorldQuaternion(_q);
		_d.set(0, 0, -1).applyQuaternion(_q);
		const rc = new THREE.Raycaster(_o.clone(), _d.clone());
		const hit = surfaceHit(rc);
		if (hit && (!best || hit.distance < best.d)) best = { rc, d: hit.distance };
	}
	return best && best.rc;
}
// What the pointer meets: the room's own surfaces **and the pieces** — a
// middle row hangs on a slab, not a wall, and a ray aimed at one used to
// carry straight through it to the wall beyond and drop the dot metres
// away (found on the bench, 2026-09-13).
function surfaceHit(rc) {
	const targets = [];
	for (const n of ['room', 'pieces']) { const g = scene.getObjectByName(n); if (g) targets.push(g); }
	return targets.length ? rc.intersectObjects(targets, true)[0] : null;
}

// Each frame: the dot rides the wall under the pointer, and adheres to a
// place when the pointer comes near one.
export function stepSticker() {
	const d = heldDot();
	const rc = aimed();
	const hit = rc && surfaceHit(rc);
	if (!hit) { d.visible = false; over = null; return; }
	// **how near the pointer comes to the place**, not how near the surface
	// it happens to strike: the sticker is drawn to the ray itself (Uli,
	// "adheres to the pointer in 12 cm range"). A place further along the
	// ray than the surface in front of it is behind something, and is not
	// on offer.
	let near = null;
	for (const s of spots) {
		const gap = rc.ray.distanceToPoint(s.aim);
		if (gap >= SNAP || rc.ray.origin.distanceTo(s.aim) > hit.distance + 0.3) continue;
		if (!near || gap < near.gap) near = { s, gap };
	}
	over = near ? near.s : null;
	if (over) {
		d.position.copy(over.at);
		d.quaternion.copy(over.dot.getWorldQuaternion(_q));
		d.visible = !over.dot.visible;        // no second dot over one already stuck
	} else {
		d.position.copy(hit.point).addScaledVector(hit.face.normal.clone().transformDirection(hit.object.matrixWorld), 0.0006);
		d.lookAt(d.position.clone().add(hit.face.normal.clone().transformDirection(hit.object.matrixWorld)));
		d.visible = true;
	}
}

// A press while a place is under the pointer sticks a dot on it, or takes
// one off. Returns whether the press was used up.
export function stickAt() {
	if (!over) return false;
	const on = toggleFav(over.photo.id);
	over.dot.visible = on;
	return true;
}
export function stuckOn() { return over; }
