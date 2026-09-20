import * as THREE from '../vendor/three.module.js';
import { lift } from 'gallery/sound';
import { hangRoom, layoutFor, openRooms, rooms } from 'gallery/hang';
import { blocksFor, standSpot, wayRound } from 'gallery/way';
import { camera, head, renderer, scene, world } from 'gallery/scene';
import { dropTex, poolMaterial } from 'gallery/frames';
import { elevator } from 'gallery/elevator';
import { setDim, takeFloor } from 'gallery/room';
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
// **Chalk, and one piece of it** (Uli, 2026-09-20: not a paper band). It
// was a plane per leg and a ring per turn — flat white ribbons meeting at
// seams, which is what read as paper. The way is now **one mesh**: the
// path sampled through its rounded turns into a centre line, ribboned
// once, and a chalk texture laid along it — grainy, its edges eaten away,
// so the line is a stroke rubbed onto the floor rather than a tape laid
// on it. The arrow stays its own mesh: it outlives the line by half a
// minute after one arrives.
let chalkTex = null;
function chalk() {
	if (chalkTex) return chalkTex;
	const W = 64, H = 256;
	const c = document.createElement('canvas'); c.width = W; c.height = H;
	const g = c.getContext('2d');
	const img = g.createImageData(W, H);
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const u = (x + 0.5) / W * 2 - 1;                      // -1..1 across the stroke
		// full in the middle, eaten away toward the edges, and grainy all through
		const edge = Math.max(0, 1 - Math.pow(Math.abs(u), 2.4));
		const grain = 0.55 + 0.45 * Math.random();
		const bite = Math.abs(u) > 0.62 && Math.random() < 0.45 ? 0 : 1;   // the odd bite out of the edge
		const a = Math.max(0, Math.min(1, edge * grain * bite));
		const i = (y * W + x) * 4;
		img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
		img.data[i + 3] = Math.round(a * 255);
	}
	g.putImageData(img, 0, 0);
	chalkTex = new THREE.CanvasTexture(c);
	chalkTex.wrapS = THREE.ClampToEdgeWrapping; chalkTex.wrapT = THREE.RepeatWrapping;   // across the stroke once, along it over and over
	chalkTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
	chalkTex.userData.shared = true;
	return chalkTex;
}
const skin = () => { const m = new THREE.MeshBasicMaterial({ map: chalk(), color: 0xffffff, transparent: true, opacity: GUIDE.opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -4, side: THREE.DoubleSide }); m.userData.noDim = true; return m; };   // the chalk shows in the dark
function clearGuide() { if (!guide) return; for (const m of [...guide.children]) { guide.remove(m); m.geometry.dispose(); m.material.dispose(); } }
const roomBlocks = () => blocksFor(state.placed, state.room.W, state.room.D);
// The path's centre line: the legs shortened by the turn radius, every
// turn a quarter round sampled into steps, so the whole way is one run of
// points with no corner to seam.
const TURN_STEPS = 7, CHALK_TILE = 0.45;     // metres of line per tile of the grain
function centreLine(pts, r) {
	const line = [pts[0].clone().setY(0)];
	const push = p => { const last = line[line.length - 1]; if (!last || last.distanceTo(p) > 1e-4) line.push(p.clone().setY(0)); };
	for (let i = 0; i < pts.length - 1; i++) {
		const p = pts[i].clone().setY(0), q = pts[i + 1].clone().setY(0), dir = q.clone().sub(p), len = dir.length();
		if (len < 1e-4) continue;
		dir.normalize();
		const turnBefore = i > 0 && len > r && pts[i].distanceTo(pts[i - 1]) > r;
		const turnAfter = i < pts.length - 2 && len > r && pts[i + 2].distanceTo(pts[i + 1]) > r;
		if (turnBefore) p.addScaledVector(dir, r);
		if (turnAfter) q.addScaledVector(dir, -r);
		push(p); push(q);
		if (!turnAfter) continue;
		const c = pts[i + 1], next = pts[i + 2].clone().sub(c).setY(0).normalize();
		const centre = c.clone().setY(0).addScaledVector(dir, -r).addScaledVector(next, r);
		const from = Math.atan2(q.z - centre.z, q.x - centre.x);
		const end = c.clone().setY(0).addScaledVector(next, r);
		let sweep = Math.atan2(end.z - centre.z, end.x - centre.x) - from;
		while (sweep > Math.PI) sweep -= 2 * Math.PI; while (sweep < -Math.PI) sweep += 2 * Math.PI;
		for (let k = 1; k <= TURN_STEPS; k++) { const a = from + sweep * k / TURN_STEPS; push(new THREE.Vector3(centre.x + r * Math.cos(a), 0, centre.z + r * Math.sin(a))); }
	}
	return line;
}
// One ribbon along the centre line — two vertices a stroke's width apart
// at every point, the grain running with the distance walked — **and the
// arrow in the same mesh** (Uli, 2026-09-20). The arrow's triangle is
// appended to the same buffers, and the range of indices it occupies is
// kept: once the visitor has arrived the mesh draws that range alone, so
// the arrow outlives the line without a second object or a second draw.
function wayMesh(line, w, end, face) {
	const pos = [], uv = [], idx = [];
	let along = 0;
	for (let i = 0; i < line.length; i++) {
		const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
		const t = b.clone().sub(a); if (t.lengthSq() < 1e-9) t.set(0, 0, 1);
		t.normalize();
		const n = new THREE.Vector3(-t.z, 0, t.x).multiplyScalar(w / 2);
		if (i > 0) along += line[i].distanceTo(line[i - 1]);
		pos.push(line[i].x - n.x, 0, line[i].z - n.z, line[i].x + n.x, 0, line[i].z + n.z);
		uv.push(0, along / CHALK_TILE, 1, along / CHALK_TILE);
		if (i) { const k = 2 * i; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
	}
	const arrow = { start: idx.length, count: 0, at: end ? end.clone() : null, face: face ? face.clone() : null };
	if (end && face) {
		// a triangle standing on the line's end, pointing the way the face
		// looks: its own three vertices, drawn in the same chalk
		const f = face.clone().setY(0).normalize(), side = new THREE.Vector3(-f.z, 0, f.x);
		const A = GUIDE.arrow, base = end.clone(), k = pos.length / 3;
		const tip = base.clone().addScaledVector(f, A);
		const l = base.clone().addScaledVector(side, A * 0.5), r = base.clone().addScaledVector(side, -A * 0.5);
		for (const [v, u, vv] of [[tip, 0.5, 1], [l, 0, 0], [r, 1, 0]]) { pos.push(v.x, 0.0005, v.z); uv.push(u, vv); }
		idx.push(k, k + 1, k + 2);
		arrow.count = 3;
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	g.setIndex(idx);
	g.computeVertexNormals();
	return { geometry: g, arrow, all: idx.length };
}
// the chalk: one stroke the whole way, the arrow at its end in the same mesh
function drawWay(pts, face) {
	clearGuide();
	const line = centreLine(pts, GUIDE.r);
	guide.userData.path = line;                          // the way itself, for the bench's checks
	if (line.length < 2) return;
	const { geometry, arrow, all } = wayMesh(line, GUIDE.w, pts[pts.length - 1].clone().setY(0), face);
	const m = new THREE.Mesh(geometry, skin());
	m.name = 'way'; m.renderOrder = 2; guide.add(m);
	Object.assign(guide.userData, { arrow, all });
	geometry.setDrawRange(0, all);
	guide.visible = true;
}
// the whole way, or the arrow alone once it has been walked
function showWay(whole) {
	const m = guide && guide.getObjectByName('way');
	if (!m) return;
	const { arrow, all } = guide.userData;
	if (whole) m.geometry.setDrawRange(0, all);
	else m.geometry.setDrawRange(arrow.start, arrow.count);
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
// **To the picture, not to the group it hangs in** (Uli, 2026-09-20). The
// way ended in front of the piece's middle and the arrow pointed there —
// which for a grid of six is the middle of the grid, not the photograph
// asked for. The line leads to **that photograph's own place** on the
// wall, and the arrow points from the spot at it.
export function leadTo(n) {
	const p = state.placed && state.placed.find(q => q.piece.photos.some(ph => ph.n === n));
	if (!p) { guideTo = null; return; }
	const at = new THREE.Vector3(p.x, 0, p.z);
	const pieces = scene.getObjectByName('pieces');
	if (pieces) {                                                        // the photograph itself, where it hangs in its piece
		let print = null; pieces.traverse(o => { if (!print && o.name === 'photo' && o.userData.photo && o.userData.photo.n === n) print = o; });
		if (print) { const w = print.getWorldPosition(new THREE.Vector3()); world.worldToLocal(w); at.set(w.x, 0, w.z); }
	}
	const out = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));  // out of the wall, into the room
	guideTo = at.clone().addScaledVector(out, GUIDE.arrived);
	wayFace = at.clone().sub(guideTo).setY(0).normalize();               // from the spot to the photograph
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
		// **The room is changed as soon as it is black, not at the end of the
		// wait** (Uli, 2026-09-20: in the wait between the dim and the
		// relight, animate the floor changing). The wait was a pause with
		// nothing in it and the hang came after it — so there was no new
		// floor to change into while one waited. Now the hang is the first
		// thing the black does, and the two seconds that follow are what the
		// floor of the year left takes to fade into the year arrived. The
		// pictures get those two seconds to arrive in as well.
		if (dark.held) {
			stepFloorFade(now);                    // the floor of the year left goes over the wait
			if (now - dark.held < HOLD) return;
			dark.hung = true; dark.t0 = now; dark.lit = null;
			return;
		}
		dark.held = now;
		const before = elevator.originWorld().clone();
		// the floor of the room being left, kept back from the rebuild so it
		// can fade into the new one while everything else is black
		const oldFloor = takeFloor(), oldSlug = state.room && state.room.floor;
		hangRoom(dark.to);
		if (oldFloor) {
			oldFloor.material.transparent = true; oldFloor.material.depthWrite = false;
			oldFloor.material.polygonOffset = true; oldFloor.material.polygonOffsetFactor = 0; oldFloor.material.polygonOffsetUnits = -4;   // a step in front of the new floor, not a millimetre
			oldFloor.renderOrder = 1;
			world.add(oldFloor);
			dark.floor = { mesh: oldFloor, from: now, drop: oldSlug !== (state.room && state.room.floor) };
		}
		setDim(1);                                 // the new room's lights are born full: black again in the same frame
		const o = elevator.originWorld();
		if (dark.stay) ;
		else if (renderer.xr.isPresenting) world.position.add(before.sub(o));          // the new cabin where the old stood, as a ride does
		else { const off = new THREE.Vector3().subVectors(head(), before); walk.pos.set(o.x + off.x, walk.pos.y, o.z + off.z); }
		leadTo(dark.n);
		return;
	}
	stepFloorFade(now);
	if (!dark.lit) {                                      // black until what is in the view has its picture
		if (!inViewLoaded() && t < LOADED) return;
		dark.lit = now; guardSays('toPrint');
	}
	const u = now - dark.lit;
	setDim(1 - Math.min(1, u / DARK));
	if (u >= DARK) dark = null;
}
// the old floor over the new one, going in FLOOR_FADE; its own light kept
// level with the new floor's, so the two read as one surface changing
const FLOOR_FADE = 1900;   // nearly the whole two seconds the room is black (Uli: over twenty frames, not a dozen)
function stepFloorFade(now) {
	const f = dark && dark.floor; if (!f) return;
	const k = Math.min(1, (now - f.from) / FLOOR_FADE);
	const lit = scene.getObjectByName('floor');
	if (lit) f.mesh.material.emissiveIntensity = lit.material.emissiveIntensity;
	f.mesh.material.opacity = 1 - k;
	if (k < 1) return;
	f.mesh.removeFromParent();
	if (f.drop) for (const key of ['map', 'roughnessMap', 'normalMap', 'metalnessMap', 'emissiveMap']) if (f.mesh.material[key]) dropTex(f.mesh.material[key]);   // a floor the next room does not use goes whole, as buildShell would have dropped it
	f.mesh.geometry.dispose(); f.mesh.material.dispose();
	dark.floor = null;
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
		const arrow = guide.userData.arrow;
		showWay(false);                                  // the arrow alone, out of the one mesh
		arrowUntil = arrow && arrow.count ? now + GUIDE.stay : 0;
		guide.visible = !!(arrow && arrow.count);
		return;
	}
	showWay(true);
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
