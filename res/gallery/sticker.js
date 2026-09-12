import * as THREE from '../vendor/three.module.js';
import { camera, renderer, scene } from './scene.js?v=20260915p';
import { isFav, toggleFav } from './state.js?v=20260915p';

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
	for (const n of ['room', 'pieces']) { const g = scene.getObjectByName(n); if (g) targets.push(g); }
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
// and a dark backing under the white, so the brackets hold against a pale
// photograph as well as a dark one (Uli, 2026-09-13). **Soft**, not a
// second rectangle: a blurred square, stretched behind each bar, so the
// dark fades out into the picture instead of ending on an edge of its own.
// Drawn first, so the white lies over it.
// A dark backing under the white, so the brackets hold against a pale
// photograph as well as a dark one. It follows **the icon's own shape** —
// one soft patch behind each bar (Uli, 2026-09-13): a disc under the whole
// thing was a rectangle of shade with the brackets floating in it, too
// much of it and too soft. A blurred square stretched behind each bar
// instead, so the dark hugs the arms and fades off their edges.
let softTex = null;
function soft() {
	if (!softTex) {
		const c = document.createElement('canvas');
		c.width = c.height = 64;
		const g = c.getContext('2d');
		g.filter = 'blur(12px)';
		g.fillStyle = '#fff';
		g.fillRect(17, 17, 30, 30);
		softTex = new THREE.CanvasTexture(c);
	}
	return softTex;
}
const haloMat = new THREE.MeshBasicMaterial({ map: soft(), color: 0x14120f, transparent: true, opacity: 0.4, depthTest: false, side: THREE.DoubleSide });   // a third darker than 0.3 (Uli, 2026-09-13)
const HALO = 0.014;              // how far the shade reaches past the bar it backs (Uli: bigger, softer)
const bar = (w, h, x, y, turn = 0, mat = cursorMat) => {
	const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
	m.position.set(x, y, 0); m.rotation.z = turn; return m;
};
// four corner brackets, the way a picture says it can be made larger
let expand = null;
function expandIcon() {
	if (!expand) {
		expand = new THREE.Group();
		expand.name = 'cursor-expand';
		const R = 0.048, ARM = 0.0352, T = 0.0064;   // 9.6 cm across — 1.6x the first size (Uli, 2026-09-13)
		// every halo goes down first, then every bracket over them
		for (const [grow, mat] of [[HALO, haloMat], [0, cursorMat]])
			for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
				expand.add(bar(ARM + 2 * grow, T + 2 * grow, sx * (R - ARM / 2), sy * R, 0, mat));   // along the top or bottom
				expand.add(bar(T + 2 * grow, ARM + 2 * grow, sx * R, sy * (R - ARM / 2), 0, mat));   // and down the side
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
// what the ray is over, when it is not over a sticker's place
function overKind(hit) {
	for (let o = hit.object; o; o = o.parent) {
		if (o.name === 'photo' || o.name === 'photo-near') return 'print';
		if (o.name === 'label') return 'label';
	}
	return null;
}
// laid on whatever the ray struck, a breath proud of it and facing out
function onSurface(obj, hit) {
	const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
	obj.position.copy(hit.point).addScaledVector(n, 0.0008);
	obj.lookAt(obj.position.clone().add(n));
}
// Each frame: the dot rides the wall under the pointer, and adheres to a
// place when the pointer comes near one.
export function stepSticker() {
	const d = heldDot(), x = heldCross();
	const rc = aimed();
	const hit = rc && surfaceHit(rc);
	if (!hit) { putBack(); settled = null; d.visible = x.visible = false; if (expand) expand.visible = false; if (loupe) loupe.visible = false; over = null; return; }
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
	// exactly one cursor is up at a time
	putBack();
	if (over !== settled) settled = null;             // moved off: the pointer speaks again
	const stuck = over && isFav(over.photo.id);
	const showing = settled ? null
		: over ? (stuck ? x : d)
		: ({ print: expandIcon(), label: loupeIcon() }[overKind(hit)] || d);
	for (const c of [d, x, expand, loupe]) if (c && c !== showing) c.visible = false;
	if (!showing) return;                             // just pressed here, and still here: say nothing
	if (over) {
		// **Both snap to the place** (Uli, 2026-09-13). The dot sits where
		// the sticker would land; the cross **takes the sticker's own place**
		// on hover and goes on the click. Neither follows the pointer about:
		// what they show is where the thing is, not where the hand is.
		showing.position.copy(over.at);
		showing.quaternion.copy(over.dot.getWorldQuaternion(_q));
		showing.visible = true;
		if (showing === x) { over.dot.visible = false; lifted = over; }   // the cross covers it
	} else {
		// not at a sticker's place: say what a press *here* would do instead
		onSurface(showing, hit);
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
