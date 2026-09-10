import * as THREE from '../vendor/three.module.js';
import { camera, scene } from './scene.js?v=20260911y';

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

// The shadow the frame throws on a print that fills it (Uli,
// 2026-09-11): filled, the photo is up against the moulding and there is
// no mat left to catch anything, so the frame falls on the picture
// itself. The light in this gallery always comes from the top left, so
// the shadow lies along the **bottom and the right** (Uli) — and softly,
// a wide falling-off, not an edge. One canvas serves every frame; the
// overlay is made when a print is filled and goes when it sits back.
let shadowTex = null;
function shadow() {
	if (shadowTex) return shadowTex;
	const c = document.createElement('canvas'); c.width = c.height = 256;
	const g = c.getContext('2d');
	// a band in from one edge: dense at the edge and gone within a
	// twentieth of the picture — the width a moulding's own edge throws,
	// not a haze (Uli, 2026-09-11: keep them small and a bit denser)
	const band = (x0, y0, x1, y1, a) => {
		const grad = g.createLinearGradient(x0, y0, x1, y1);
		grad.addColorStop(0, `rgba(0,0,0,${a})`);
		grad.addColorStop(0.45, `rgba(0,0,0,${(a * 0.35).toFixed(3)})`);
		grad.addColorStop(1, 'rgba(0,0,0,0)');
		g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
	};
	band(0, 256, 0, 242, 0.72);     // up from the bottom, about 5 % of the height
	band(256, 0, 244, 0, 0.62);     // in from the right
	shadowTex = new THREE.CanvasTexture(c);
	return shadowTex;
}
function addShadow(print) {
	if (!print.parent || !print.userData.inner || print.parent.getObjectByName('frame-shadow')) return;
	const m = new THREE.Mesh(new THREE.PlaneGeometry(print.userData.inner, print.userData.inner),
		new THREE.MeshBasicMaterial({ map: shadow(), transparent: true, depthWrite: false }));
	m.name = 'frame-shadow';
	m.position.set(print.position.x, print.position.y, print.position.z + 0.0006);
	m.renderOrder = 3;
	print.parent.add(m);
}
function dropShadow(print) {
	const m = print.parent && print.parent.getObjectByName('frame-shadow');
	if (m) { m.geometry.dispose(); m.material.dispose(); m.parent.remove(m); }
}

// A print: pressed once it fills the frame, pressed again it sits back in
// its mat.
export function zoomPrint(print, now = performance.now()) {
	const full = print.userData.full;
	if (!full) return false;
	const out = print.scale.x < full - 0.001;
	print.scale.setScalar(out ? full : 1);
	if (out) { addShadow(print); big.set(print, now); } else { dropShadow(print); big.delete(print); }
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
		if (thing.isObject3D) zoomPrint(thing, now); else zoomLabel(thing, now);   // pressed again, in effect: back to itself
	}
}

// A room hung afresh takes everything with it; nothing left large can
// belong to the room that has gone.
export function clearZoom() { big.clear(); }
