import * as THREE from '../vendor/three.module.js';
import { lift } from 'gallery/sound';
import { hangRoom, layoutFor, openRooms, rooms } from 'gallery/hang';
import { blocksFor, standSpot, wayRound } from 'gallery/way';
import { camera, head, renderer, scene, world } from 'gallery/scene';
import { poolMaterial } from 'gallery/frames';
import { elevator } from 'gallery/elevator';
import { setDim } from 'gallery/room';
import { guardSays } from 'gallery/guard';
import { walk } from 'gallery/walk';
import { state } from 'gallery/state';

// ---------------------------------------------------------------------------
// The instant lift's switch, and the way on the floor
//
// `jump(key)` (the tablet's j, the bench's J) and the strip's print both
// go through switchTo: at the lift's door the room goes black, the other
// room is hung in the dark, the light comes back once what is in view has
// its pictures, and chalk on the floor leads to the print. (The glass
// tube that rode you between floors went on 2026-09-19.)

const floorY = () => world.position.y;
const ceilY = () => world.position.y + (state.room ? state.room.H : state.settings.H);

// Jump to a room by its key — or to the room a photo hangs in, when
// given its number (the tablet will hand one over).
export function jump(key) {
	const list = rooms();
	const room = list.find(r => r.key === key) || list.find(r => r.specs.some(sp => sp.photos.some(p => p.n === key)));
	if (!room || room.key === state.roomKey) return false;
	const n = list.some(r => r.key === key) ? room.specs[room.specs.length - 1].photos[0].n : key;   // a room asked for: its newest print
	return switchTo(room.key, n);
}

export function stepJump(now) {
	stepGuide(now);
	stepDark(now);
}

// The way to the print: chalk on the floor (Uli) — laid once, where it
// was drawn it stays; square-ended legs, a quarter round of GUIDE.r at
// every turn, an arrow at the print that stays half a minute after arriving,
// round every row, frame and the cabin (way.js), and a glow on the wall
// round the print led to.
const GUIDE = { w: 0.06, y: 0.003, opacity: 0.55, arrived: 1.1, r: 0.25, arrow: 0.14, stay: 30000 };
let guide = null, guideTo = null;            // the chalk on the floor, and where it leads (in the room's frame)
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
let wayFace = null, guideNear = 0, arrowUntil = 0;   // 0: the print's own distance (GUIDE.arrived); the arrow alone after arriving, until
const skin = () => { const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: GUIDE.opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -4, side: THREE.DoubleSide }); m.userData.noDim = true; return m; };   // the chalk shows in the dark
function clearGuide() { if (!guide) return; for (const m of [...guide.children]) { guide.remove(m); m.geometry.dispose(); m.material.dispose(); } }
const roomBlocks = () => blocksFor(state.placed, state.room.W, state.room.D);
// the chalk: legs with square ends, each turn a quarter round, the arrow
function drawWay(pts, face) {
	clearGuide();
	const r = GUIDE.r, y = 0;
	const leg = (p, q) => {
		const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz); if (len < 0.01) return;
		const g = new THREE.PlaneGeometry(GUIDE.w, len); g.rotateX(-Math.PI / 2); g.translate(0, 0, -len / 2);
		const m = new THREE.Mesh(g, skin()); m.position.set(p.x, y, p.z); m.rotation.y = Math.atan2(dx, dz) + Math.PI; m.renderOrder = 2; guide.add(m);
	};
	for (let i = 0; i < pts.length - 1; i++) {
		const p = pts[i].clone(), q = pts[i + 1].clone(), dir = q.clone().sub(p), len = dir.length(); dir.normalize();
		const turnBefore = i > 0 && len > r && pts[i].distanceTo(pts[i - 1]) > r, turnAfter = i < pts.length - 2 && len > r && pts[i + 2].distanceTo(pts[i + 1]) > r;
		if (turnBefore) p.addScaledVector(dir, r);
		if (turnAfter) q.addScaledVector(dir, -r);
		leg(p, q);
		if (!turnAfter) continue;
		const c = pts[i + 1], next = pts[i + 2].clone().sub(c).normalize();
		const centre = c.clone().addScaledVector(dir, -r).addScaledVector(next, r);
		// the ring from the leg's end round to the next leg's start: its start angle is the direction from the centre to the leg's end
		const from = Math.atan2(-(c.z - r * dir.z - centre.z), c.x - r * dir.x - centre.x), to = Math.atan2(-(c.z + r * next.z - centre.z), c.x + r * next.x - centre.x);
		let sweep = to - from; while (sweep > Math.PI) sweep -= 2 * Math.PI; while (sweep < -Math.PI) sweep += 2 * Math.PI;
		const ring = new THREE.RingGeometry(r - GUIDE.w / 2, r + GUIDE.w / 2, 12, 1, Math.min(from, from + sweep), Math.abs(sweep));
		ring.rotateX(-Math.PI / 2);
		const m = new THREE.Mesh(ring, skin()); m.position.set(centre.x, y, centre.z); m.renderOrder = 2; guide.add(m);
	}
	const end = pts[pts.length - 1];
	if (face) {
		const sh = new THREE.Shape(); sh.moveTo(0, GUIDE.arrow); sh.lineTo(-GUIDE.arrow * 0.5, 0); sh.lineTo(GUIDE.arrow * 0.5, 0); sh.closePath();
		const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2);
		const m = new THREE.Mesh(g, skin()); m.name = 'arrow'; m.position.copy(end); m.position.y = y + 0.0005;   // its base on the line's end
		m.rotation.y = Math.atan2(face.x, face.z) + Math.PI; m.renderOrder = 2; guide.add(m);
	}
	for (const m of guide.children) m.visible = true;
	guide.visible = true;
}
// a soft glow on the wall round the print led to, not on it (Uli)
let glow = null;
function glowRound(n) {
	if (glow) { glow.removeFromParent(); glow.geometry.dispose(); glow.material.dispose(); glow = null; }
	const pieces = scene.getObjectByName('pieces'); if (!pieces || n == null) return;
	let target = null; pieces.traverse(o => { if (!target && o.name === 'photo' && o.userData.photo && o.userData.photo.n === n) target = o; });
	if (!target) return;
	let piece = target; while (piece.parent && !(piece.name || '').startsWith('piece-')) piece = piece.parent;
	glow = new THREE.Mesh(new THREE.PlaneGeometry(piece.userData.w + 0.9, piece.userData.h + 0.9), poolMaterial.clone());
	glow.material.opacity = 0.9; glow.name = 'glow';
	glow.position.copy(piece.position); glow.rotation.copy(piece.rotation);
	glow.translateZ(-0.0006);                                              // between the plaster and the frame's back
	pieces.add(glow);
}
function layWay() {
	if (!guide) { guide = new THREE.Group(); guide.name = 'jump-guide'; }
	guide.position.set(0, GUIDE.y, 0); guide.rotation.set(0, 0, 0);
	world.add(guide);                                                    // drawn in the room's frame
	const from = world.worldToLocal(head().clone());
	drawWay((state.room && wayRound(from, guideTo, state.room.shape, roomBlocks(), GUIDE.r)) || [from.setY(0), guideTo.clone().setY(0)], wayFace);
}
export function leadTo(n) {
	const p = state.placed && state.placed.find(q => q.piece.photos.some(ph => ph.n === n));
	if (!p) { guideTo = null; return; }
	guideTo = new THREE.Vector3(p.x + Math.sin(p.yaw) * GUIDE.arrived, 0, p.z + Math.cos(p.yaw) * GUIDE.arrived);
	wayFace = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));  // from the spot to the print
	guideNear = 0; layWay(); glowRound(n);
}
// the way to a point in the room's frame (the lift's door), until within `near`
export function leadToPoint(v, near = 0) { guideTo = v ? v.clone() : null; guideNear = near; wayFace = null; glowRound(null); if (guideTo) layWay(); }
export const guided = () => !!guideTo;
// where to stand for the switch to a room: the nearest spot with a free standing circle here and there (Uli), in the room's frame
export function switchSpot(key) {
	if (!state.room) return null;
	const { shape, lay } = layoutFor(key);
	return standSpot(world.worldToLocal(head().clone()), [{ shape: state.room.shape, blocks: roomBlocks() }, { shape, blocks: blocksFor(lay.placed, shape.W, shape.D) }]);
}
// The switch in the dark (Uli, 2026-09-19): standing at the lift's door the
// room goes black over a second, the floor stays lit at half, the other
// room is hung and lit again, and the line leads to the print asked for.
let dark = null;                             // { to, n, t0, hung }
export function switchTo(key, n, stay = false) {   // stay: the body keeps its place in the room's frame (the strip's spot); else the cabin's
	if (dark || key === state.roomKey) return false;
	dark = { to: key, n, stay, t0: performance.now(), hung: false };
	lift.run((DARK + HOLD) / 1000 + 0.6);      // a quick engine: start, a moment of running, the stop
	return true;
}
const DARK = 4000, HOLD = 2000, LOADED = 10000;   // 4 s down, 2 s black, 4 s up (Uli), and up only once the pictures in view are on the GPU — 10 s at most
function stepDark(now) {
	if (!dark) return;
	const t = now - dark.t0;
	if (!dark.hung) {
		if (t < DARK) { setDim(t / DARK); return; }
		setDim(1);
		if (!dark.held) { dark.held = now; return; }
		if (now - dark.held < HOLD) return;
		const before = elevator.originWorld().clone();
		hangRoom(dark.to);
		setDim(1);                                 // the new room's lights are born full: black again in the same frame
		const o = elevator.originWorld();
		if (dark.stay) ;
		else if (renderer.xr.isPresenting) world.position.add(before.sub(o));          // the new cabin where the old stood, as a ride does
		else { const off = new THREE.Vector3().subVectors(head(), before); walk.pos.set(o.x + off.x, walk.pos.y, o.z + off.z); }
		dark.hung = true; dark.t0 = now; dark.lit = null;
		leadTo(dark.n);
		return;
	}
	if (!dark.lit) {                                      // black until what is in the view has its picture
		if (!inViewLoaded() && t < LOADED) return;
		dark.lit = now; guardSays('toPrint');
	}
	const u = now - dark.lit;
	setDim(1 - Math.min(1, u / DARK));
	if (u >= DARK) dark = null;
}
const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _c = new THREE.Vector3();
function inViewLoaded() {
	const pieces = scene.getObjectByName('pieces'); if (!pieces) return true;
	_frustum.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
	let ok = true;
	pieces.traverse(o => { if (ok && o.name === 'photo' && _frustum.containsPoint(o.getWorldPosition(_c)) && !o.material.map.image) ok = false; });
	return ok;
}
function stepGuide(now) {
	if (!guideTo) {
		if (guide && guide.visible && now > arrowUntil) guide.visible = false;   // the arrow stays a while
		if (glow) glowRound(null);
		return;
	}
	if (!guide) layWay();
	_a.copy(guideTo).applyMatrix4(world.matrixWorld);
	_b.copy(head());
	if (Math.hypot(_a.x - _b.x, _a.z - _b.z) < (guideNear || GUIDE.arrived)) {
		guideTo = null; guideNear = 0; glowRound(null);
		const arrow = guide.getObjectByName('arrow');
		for (const m of guide.children) m.visible = m === arrow;
		arrowUntil = arrow ? now + GUIDE.stay : 0;
		guide.visible = !!arrow;
		return;
	}
	guide.visible = true;
}

// The bench: J jumps to the next room down the list, to see the ride.
addEventListener('keydown', e => {
	if (e.code !== 'KeyJ' || e.repeat) return;
	e.preventDefault();
	const list = openRooms(), i = list.findIndex(r => r.key === state.roomKey);
	const next = list[(i + 1) % list.length];
	if (next) jump(next.specs[next.specs.length - 1].photos[0].n);   // its newest print, so the line has somewhere to lead
});
