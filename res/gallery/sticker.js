import * as THREE from '../vendor/three.module.js';
import { camera, renderer, scene } from './scene.js?v=20260916e';
import { isFav, toggleFav } from './state.js?v=20260916e';
import { elevator } from './elevator.js?v=20260916e';   // only to ask whether the visitor is in the cabin
import { CARD_D } from './bake.js?v=20260916e';

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
export const DOT_R = 0.008;      // 1.6 cm across (Uli, 2026-09-13)
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
		// **A child of its card**, not of the piece (Uli, 2026-09-13): a
		// doubled label used to leave its sticker behind on the wall. Held by
		// the card, it doubles with it, comes forward with it, and travels
		// with it — and so does the cross, which is drawn wherever it is.
		// Its place is reckoned from the card's bottom right corner, a fresh
		// roll each hang, and in the card's own frame that corner is
		// (+cw/2, -ch/2).
		const half = card.userData.ch / 2;
		dot.position.set(L.cw / 2 - between(LEFT), -half - between(UNDER),
			mid ? CARD_D / 2 + 0.001 : -CARD_D / 2 + 0.0006);   // on the paper, or a hair off the plaster behind it
		dot.visible = isFav(p.id);
		card.add(dot);
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
		spots.push({ dot: o, photo: o.userData.photo, at: new THREE.Vector3(), aim: new THREE.Vector3() });
	});
	freshen();
}

// Where every place stands **now** — asked afresh each look, not kept from
// the hang: a card that has been doubled has carried its sticker up, out
// and over with it, and a place remembered from before would leave the
// cursor snapping at bare wall (Uli, 2026-09-13). The aim drops with the
// card's own scale, so the reach grows with what it reaches for.
function freshen() {
	for (const s of spots) {
		s.dot.getWorldPosition(s.at);
		const k = s.dot.parent ? s.dot.parent.scale.x : 1;
		s.aim.copy(s.at); s.aim.y -= AIM_DROP * k;
		s.scale = k;
	}
}
// the dot on the pointer, the cross that offers to take one off, and what
// the pointer is currently over
let held = null, cross = null, over = null;
// Once a press has been made, the pointer **shows nothing at all** until it
// has left the place and come back (Uli, 2026-09-13): the translucent dot
// that would otherwise appear the instant a sticker is lifted reads as the
// sticker still being there, half faded, rather than as an offer to put a
// new one on.
let settled = null;
// And while the cross is snapped over a sticker, **the sticker itself is
// hidden** (Uli) — the two sit in the same place now, so the sticker would
// otherwise peek out from behind a cross twice its size. It is back the
// moment the pointer leaves; it was never gone, only covered. Which is why
// stuck-ness is read off the favourites and not off whether the dot
// happens to be drawn: it is hidden exactly when it is stuck.
let lifted = null;
function putBack() {
	if (lifted) { lifted.dot.visible = isFav(lifted.photo.id); lifted = null; }
}
// The cross: **twice the sticker across** (Uli, 2026-09-13), so what it
// offers to lift is unmistakable. Its arms are longer than that span —
// turned 45 degrees, an arm of length L only reaches L/sqrt(2) sideways —
// so the arm is worked back out of the width wanted rather than guessed.
const X_SPAN = 4 * DOT_R, X_BAR = 0.0045;   // twice the sticker, whatever the sticker is
const X_ARM = X_SPAN / Math.SQRT1_2 - X_BAR;
// **A red cross where a press would take a sticker off** (Uli,
// 2026-09-13). Pointing at bare wall offers a dot; pointing at a sticker
// already stuck offered nothing at all before, so there was no way to see
// that the press would undo rather than do.
function heldCross() {
	if (!cross) {
		cross = new THREE.Group();
		cross.name = 'held-cross';
		for (const turn of [Math.PI / 4, -Math.PI / 4]) {
			const bar = new THREE.Mesh(new THREE.PlaneGeometry(X_ARM, X_BAR), heldMat);
			bar.rotation.z = turn;
			cross.add(bar);
		}
		cross.renderOrder = 3;
		cross.visible = false;
		scene.add(cross);
	}
	return cross;
}
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
	// 'elevator' too (Uli, 2026-09-13: a circle on the plate, a filled one
	// on a button) — the cabin is its own group beside the room, so a ray
	// aimed at the button plate went straight through it to a print on the
	// wall behind, and the lift's cursors could never come up at all.
	for (const n of ['room', 'pieces', 'elevator']) { const g = scene.getObjectByName(n); if (g) targets.push(g); }
	return targets.length ? rc.intersectObjects(targets, true)[0] : null;
}

// **What a press would do, drawn on the pointer.** The dot and the cross
// say a sticker goes on or comes off; these two say the rest of it — a
// press on a picture fills its frame, a press on a label doubles it, and
// neither said so before (Uli, 2026-09-13). Drawn out of bars and a ring
// rather than fetched as icons: two shapes do not earn a font, and they
// have to be meshes in the room, not marks on a page.
// White over a photograph, which may be anything; **black over a label**
// (Uli, 2026-09-13), which is always off-white paper and would swallow a
// white one whole.
const cursorMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false, side: THREE.DoubleSide });
const inkCursorMat = new THREE.MeshBasicMaterial({ color: 0x141311, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide });
const bar = (w, h, x, y, turn = 0, mat = cursorMat) => {
	const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
	m.position.set(x, y, 0); m.rotation.z = turn; return m;
};
// and a dark backing under the white, so the brackets hold against a pale
// photograph as well as a dark one (Uli, 2026-09-13). **Soft**, not a
// second rectangle: a blurred square, stretched behind each bar, so the
// dark fades out into the picture instead of ending on an edge of its own.
// Drawn first, so the white lies over it.
// A dark backing under the white, so the brackets hold against a pale
// photograph as well as a dark one. It follows **the icon's own shape** —
// a soft patch per corner (Uli, 2026-09-13): a disc under the whole thing
// was a rectangle of shade with the brackets floating in it.
const HALO = 0.014;              // how far the shade reaches past the L it backs
// **Four corner L's, not eight bars** (Uli, 2026-09-13). Two bars meeting
// at a corner meant two halos meeting there as well, and the shade pooled
// darker in the four corners than along the arms. One shape per corner,
// one halo per corner, even all the way round.
const softCache = new Map();
function softL(arm, thick, halo) {
	const key = `${arm}|${thick}|${halo}`;
	if (softCache.has(key)) return softCache.get(key);
	const box = arm + 2 * halo, N = 128, px = N / box, inset = halo * px, side = arm * px, t = thick * px;
	const c = document.createElement('canvas');
	c.width = c.height = N;
	const g = c.getContext('2d');
	g.filter = `blur(${Math.max(3, Math.round(halo * px * 0.55))}px)`;
	g.fillStyle = '#fff';
	// the L of a top-right corner, drawn in canvas coordinates (y down)
	g.beginPath();
	g.moveTo(inset, inset);                       // along the top, left to right
	g.lineTo(inset + side, inset);
	g.lineTo(inset + side, inset + side);         // down the right
	g.lineTo(inset + side - t, inset + side);
	g.lineTo(inset + side - t, inset + t);
	g.lineTo(inset, inset + t);
	g.closePath();
	g.fill();
	const tex = new THREE.CanvasTexture(c);
	softCache.set(key, tex);
	return tex;
}
// the same L as crisp geometry, in the corner's own box
function cornerL(arm, thick) {
	const sh = new THREE.Shape();
	sh.moveTo(-arm / 2, arm / 2);                 // along the top
	sh.lineTo(arm / 2, arm / 2);
	sh.lineTo(arm / 2, -arm / 2);                 // down the right
	sh.lineTo(arm / 2 - thick, -arm / 2);
	sh.lineTo(arm / 2 - thick, arm / 2 - thick);
	sh.lineTo(-arm / 2, arm / 2 - thick);
	sh.closePath();
	return new THREE.ShapeGeometry(sh);
}
// four corner brackets, the way a picture says it can be made larger
let expand = null;
function expandIcon() {
	if (!expand) {
		expand = new THREE.Group();
		expand.name = 'cursor-expand';
		const ARM = 0.0352, T = 0.0064, R = 0.048;   // 9.6 cm across
		const at = R - ARM / 2;
		const haloGeo = new THREE.PlaneGeometry(ARM + 2 * HALO, ARM + 2 * HALO);
		const haloMat = new THREE.MeshBasicMaterial({ map: softL(ARM, T, HALO), color: 0x14120f, transparent: true, opacity: 0.4, depthTest: false, side: THREE.DoubleSide });
		const lGeo = cornerL(ARM, T);
		// every halo down first, then every bracket over them
		for (const [geo, mat, z] of [[haloGeo, haloMat, 0], [lGeo, cursorMat, 0.0001]])
			for (const sx of [1, -1]) for (const sy of [1, -1]) {
				const m = new THREE.Mesh(geo, mat);
				m.position.set(sx * at, sy * at, z);
				m.scale.set(sx, sy, 1);              // the top-right L, turned into the other three
				expand.add(m);
			}
		expand.renderOrder = 3; expand.visible = false; scene.add(expand);
	}
	return expand;
}
// a loupe, the way a label says it can be read larger
let loupe = null;
function loupeIcon() {
	if (!loupe) {
		loupe = new THREE.Group();
		loupe.name = 'cursor-loupe';
		// The glass, and a handle long enough to be one: the first try left
		// 5.6 mm of handle beyond a 25 mm ring and read as a bare circle
		// (Uli, 2026-09-13). It runs from the ring's edge outwards now, its
		// own length again clear of the glass.
		const R_IN = 0.0095, R_OUT = 0.0125, HANDLE = 0.018, THICK = 0.004;
		const cx = -0.003, cy = 0.003, diag = Math.SQRT1_2;
		const ring = new THREE.Mesh(new THREE.RingGeometry(R_IN, R_OUT, 32), inkCursorMat);
		ring.position.set(cx, cy, 0);
		loupe.add(ring);
		// its middle sits half a handle out along the diagonal from the rim
		const reach = R_OUT + HANDLE / 2 - 0.002;
		loupe.add(bar(HANDLE, THICK, cx + reach * diag, cy - reach * diag, -Math.PI / 4, inkCursorMat));
		loupe.renderOrder = 3; loupe.visible = false; scene.add(loupe);
	}
	return loupe;
}
// **In the lift, a circle** (Uli, 2026-09-13): open on the plate, filled on
// a button — both the sticker's own size, so the pointer keeps one
// vocabulary from the wall to the cabin.
let ring = null, disc = null;
function ringIcon() {
	if (!ring) {
		ring = new THREE.Mesh(new THREE.RingGeometry(DOT_R - 0.0018, DOT_R, 32), cursorMat);
		ring.name = 'cursor-ring'; ring.renderOrder = 3; ring.visible = false; scene.add(ring);
	}
	return ring;
}
function discIcon() {
	if (!disc) {
		disc = new THREE.Mesh(new THREE.CircleGeometry(DOT_R, 32), cursorMat);
		disc.name = 'cursor-disc'; disc.renderOrder = 3; disc.visible = false; scene.add(disc);
	}
	return disc;
}
// what the ray is over, when it is not over a sticker's place
function overKind(hit) {
	for (let o = hit.object; o; o = o.parent) {
		if (o.name === 'photo' || o.name === 'photo-near' || o.name === 'photo-area') return 'print';
		if (o.name === 'label') return 'label';
		if (o.name.startsWith('cap-') || o.name.startsWith('print-') ||
		    o.name.startsWith('steel-') || o.name.startsWith('pocket-')) return 'button';
		if (o.name === 'plate') return 'plate';
	}
	return null;
}
// Laid on whatever the ray struck, a breath toward the eye, and **turned
// with the eye, not with the surface**. Taking the orientation from the
// face it lands on meant a face turned away turned the cursor with it, and
// the loupe came back with its grip on the other side (Uli, 2026-09-13:
// deactivate that completely). A cursor is a thing held in front of the
// view, not painted on the wall — so it simply wears the camera's own
// rotation and can never be seen from behind or mirrored.
const _fn = new THREE.Vector3(), _to = new THREE.Vector3(), _cq = new THREE.Quaternion();
function onSurface(obj, hit, from, flat) {
	_fn.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
	if (from && _fn.dot(_to.subVectors(from, hit.point)) < 0) _fn.negate();
	obj.position.copy(hit.point).addScaledVector(_fn, 0.0012);
	// **The brackets lie in the picture's own plane** (Uli, 2026-09-13), so
	// they run parallel to its borders and read as corners of *it* rather
	// than of the view. They can do that where the loupe could not: four
	// corners turned into each other are the same icon mirrored, so being
	// seen from the wrong side costs nothing. Everything else wears the
	// camera's rotation and cannot flip.
	if (flat) hit.object.getWorldQuaternion(obj.quaternion);
	else obj.quaternion.copy(camera.getWorldQuaternion(_cq));
}
// Each frame: the dot rides the wall under the pointer, and adheres to a
// place when the pointer comes near one.
export function stepSticker() {
	const d = heldDot(), x = heldCross();
	const rc = aimed();
	const hit = rc && surfaceHit(rc);
	if (!hit) { putBack(); settled = null; d.visible = x.visible = false; for (const c of [expand, loupe, ring, disc]) if (c) c.visible = false; over = null; return; }
	// **how near the pointer comes to the place**, not how near the surface
	// it happens to strike: the sticker is drawn to the ray itself (Uli,
	// "adheres to the pointer in 12 cm range"). A place further along the
	// ray than the surface in front of it is behind something, and is not
	// on offer.
	freshen();
	let near = null;
	for (const s of spots) {
		const gap = rc.ray.distanceToPoint(s.aim);
		if (gap >= SNAP || rc.ray.origin.distanceTo(s.aim) > hit.distance + 0.3) continue;
		if (!near || gap < near.gap) near = { s, gap };
	}
	over = near ? near.s : null;
	// exactly one cursor is up at a time
	putBack();
	if (over !== settled) settled = null;             // moved off: the pointer speaks again
	const stuck = over && isFav(over.photo.id);
	// **In the cabin, the two circles and nothing else** (Uli, 2026-09-13):
	// no dot on the steel, no brackets over a print seen through the open
	// doors. A lift is a lift; the wall's vocabulary is left outside it.
	const inLift = !!elevator.origin && elevator.inside();
	const kind = overKind(hit);
	const showing = settled ? null
		: inLift ? ({ button: discIcon(), plate: ringIcon() }[kind] || null)
		: over ? (stuck ? x : d)
		: ({ print: expandIcon(), label: loupeIcon(), button: discIcon(), plate: ringIcon() }[kind] || d);
	for (const c of [d, x, expand, loupe, ring, disc]) if (c && c !== showing) c.visible = false;
	if (!showing) return;                             // just pressed here, and still here: say nothing
	if (over) {
		// **Both snap to the place** (Uli, 2026-09-13). The dot sits where
		// the sticker would land; the cross **takes the sticker's own place**
		// on hover and goes on the click. Neither follows the pointer about:
		// what they show is where the thing is, not where the hand is.
		showing.position.copy(over.at);
		showing.quaternion.copy(over.dot.getWorldQuaternion(_q));
		showing.scale.setScalar(over.scale || 1);     // doubled with the card, as the sticker is
		showing.visible = true;
		if (showing === x) { over.dot.visible = false; lifted = over; }   // the cross covers it
	} else {
		// not at a sticker's place: say what a press *here* would do instead
		showing.scale.setScalar(1);
		onSurface(showing, hit, rc.ray.origin, showing === expand);
		showing.visible = true;
	}
}

// A press while a place is under the pointer sticks a dot on it, or takes
// one off. Returns whether the press was used up.
export function stickAt() {
	if (!over) return false;
	const on = toggleFav(over.photo.id);
	over.dot.visible = on;
	lifted = null;             // the press decides it; nothing is merely covered any more
	settled = over;            // and the pointer holds its tongue until this place is left
	return true;
}
export function stuckOn() { return over; }
