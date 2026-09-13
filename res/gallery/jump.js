import * as THREE from '../vendor/three.module.js';
import { SOUND, lift } from './elevator.js?v=20260916h';
import { hangRoom, openRooms, rooms } from './hang.js?v=20260916h';
import { head, scene, world } from './scene.js?v=20260916h';
import { state } from './state.js?v=20260916h';

// ---------------------------------------------------------------------------
// The instant lift
//
// A hollow cylinder a metre across, brushed steel, that comes down over
// you out of the ceiling with a sliding metal sound, rides the length of
// two floors, and lifts away again on the room you jumped to — you
// standing exactly where you stood (Uli, 2026-09-11). It is how a print
// found somewhere else in the collection is reached without walking back
// to the lift; the room changes while the wall of the cylinder is round
// you, so the change is never seen.

const R = 0.5, TALL = 2.4;                 // a metre across, taller than a visitor
const DOWN = 1400, RIDE = 2600, UP = 1400; // ms: coming down, the ride, lifting away
const ease = t => t * t * (3 - 2 * t);     // slow at both ends, like the cabin's doors
// The glass milks over for the ride: through half-clear walls the change
// of room would be seen happening, which is the one thing it is there to
// hide. It clears again as it lifts.
const GLASS = { open: 0.5, riding: 0.97 };

let tube = null, phase = null, at = 0, to = null, swapped = false;
let guide = null, guideTo = null, want = null;   // the line on the floor, and the print it leads to

function build() {
	const g = new THREE.CylinderGeometry(R, R, TALL, 48, 1, true);   // open at both ends: a tube, not a tin
	g.translate(0, TALL / 2, 0);                                     // its origin at its foot
	// soft glass, not steel (Uli, 2026-09-11): milky and unsharp, so the
	// room beyond is only a suggestion of itself. Real transmission would
	// cost a pass of its own on the Quest; a white standard material at
	// half opacity reads the same from the inside.
	const m = new THREE.MeshStandardMaterial({ color: 0xdfe7ec, roughness: 0.9, metalness: 0, transparent: true, opacity: GLASS.open, side: THREE.DoubleSide, depthWrite: false });
	tube = new THREE.Mesh(g, m);
	tube.name = 'jump-tube';
	tube.visible = false;
	scene.add(tube);                     // in the session's own space, not the room's: the room moves, the tube does not
	return tube;
}

const floorY = () => world.position.y;
const ceilY = () => world.position.y + (state.room ? state.room.H : state.settings.H);

// Jump to a room by its key — or to the room a photo hangs in, when
// given its number (the tablet will hand one over).
export function jump(key) {
	if (phase) return false;                        // one ride at a time
	const list = rooms();
	const room = list.find(r => r.key === key) || list.find(r => r.specs.some(s => s.photos.some(p => p.n === key)));
	if (!room || room.key === state.roomKey) return false;
	want = list.some(r => r.key === key) ? null : key;   // a photo's number, when that is what was asked for
	if (!tube) build();
	const h = head();
	tube.position.set(h.x, ceilY(), h.z);           // over your head, in the ceiling
	tube.visible = true;
	to = room.key; phase = 'down'; at = performance.now(); swapped = false;
	lift.play('ride', SOUND.ride.door[0], 1.5, null, 0.9);          // the metal slide
	return true;
}

export function stepJump(now) {
	stepGuide();
	if (!phase) return;
	const t = now - at;
	const top = ceilY(), foot = floorY();
	if (phase === 'down') {
		const f = ease(Math.min(1, t / DOWN));
		tube.position.y = top + (foot - top) * f;
		tube.material.opacity = GLASS.open + (GLASS.riding - GLASS.open) * f;
		if (t < DOWN) return;
		phase = 'ride'; at = now;
		lift.play('ride', SOUND.ride.run[0], RIDE / 1000, null, 0.45, 0.1, 0.4, 900);   // the run, heard through steel
		return;
	}
	if (phase === 'ride') {
		// the room changes halfway, while the wall of the tube is all there is to see
		if (!swapped && t > RIDE / 2) { swapped = true; hangRoom(to); if (want !== null) leadTo(want); }
		if (t < RIDE) return;
		phase = 'up'; at = now;
		lift.play('ride', SOUND.ride.door[0], 1.5, null, 0.9);
		return;
	}
	const f = ease(Math.min(1, t / UP));
	tube.position.y = foot + (top - foot) * f;
	tube.material.opacity = GLASS.riding + (GLASS.open - GLASS.riding) * f;
	if (t < UP) return;
	tube.visible = false; phase = null; to = null;
}

// The way to the print you jumped for: a white line along the floor from
// where you stand to a step in front of it, at seven tenths so the floor
// still shows through (Uli, 2026-09-11). It follows you as you walk and
// goes out when you are there.
const GUIDE = { w: 0.06, y: 0.012, opacity: 0.7, arrived: 1.1 };
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
// The way is laid **rectangular** (Uli, 2026-09-12): two strips at a
// right angle, the long leg first and the turn onto the print after, the
// way a floor is marked in a building rather than cut across.
function buildGuide() {
	const g = new THREE.PlaneGeometry(GUIDE.w, 1);
	g.rotateX(-Math.PI / 2); g.translate(0, 0, -0.5);      // a strip running from its origin to -z, one metre
	const skin = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: GUIDE.opacity, depthWrite: false });
	guide = new THREE.Group(); guide.name = 'jump-guide';
	for (const name of ['leg-1', 'leg-2', 'leg-3']) {
		const m = new THREE.Mesh(g, skin());
		m.name = name; m.renderOrder = 2;
		guide.add(m);
	}
	scene.add(guide);
}
// The aisle to walk: the middle rows cut the floor into walkways, and
// the line takes the one whose centre lies nearest the print. Returns
// the axis it runs along and where its middle is, in the session's own
// frame — or null where the room has no rows and the floor is all aisle.
function walkway(target, me) {
	const mid = (state.placed || []).filter(p => p.wall === 'mid');
	if (!mid.length || !state.room) return null;
	const alongX = Math.abs(Math.cos(mid[0].yaw)) > 0.5;    // an x-row faces ±z, so its aisles run along x
	const { W, D } = state.room, keep = 0.55;
	const span = alongX ? D : W;
	// the lines the rows stand on, and the walls, in the room's own frame
	const cuts = [...new Set(mid.map(p => +( alongX ? p.z : p.x).toFixed(2)))].sort((a, b) => a - b);
	const edges = [-span / 2 + keep, ...cuts, span / 2 - keep];
	const centres = [];
	for (let i = 0; i < edges.length - 1; i++) {
		const c = (edges[i] + edges[i + 1]) / 2;
		if (edges[i + 1] - edges[i] > 0.9) centres.push(c);   // wide enough to walk
	}
	if (!centres.length) return null;
	// the print's own across-coordinate, back in the room's frame
	const t = world.worldToLocal(target.clone());
	const want = alongX ? t.z : t.x;
	let best = centres[0];
	for (const c of centres) if (Math.abs(c - want) < Math.abs(best - want)) best = c;
	// and out again into the session's frame, where the line is drawn
	const p = world.localToWorld(new THREE.Vector3(alongX ? 0 : best, 0, alongX ? best : 0));
	return [alongX ? 'x' : 'z', alongX ? p.z : p.x];
}

// one leg of the way: from (x0,z0) to (x1,z1), along an axis
function layLeg(m, x0, z0, x1, z1, y) {
	const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
	m.visible = len > 0.02;
	if (!m.visible) return;
	m.position.set(x0, y, z0);
	m.rotation.y = Math.atan2(dx, dz) + Math.PI;
	m.scale.z = len;
}
function leadTo(n) {
	const p = state.placed && state.placed.find(q => q.piece.photos.some(ph => ph.n === n));
	guideTo = p ? new THREE.Vector3(p.x + Math.sin(p.yaw) * GUIDE.arrived, 0, p.z + Math.cos(p.yaw) * GUIDE.arrived) : null;
}
function stepGuide() {
	if (!guideTo) { if (guide) guide.visible = false; return; }
	if (!guide) buildGuide();
	_a.copy(guideTo).applyMatrix4(world.matrixWorld);      // the print stands in the room's frame, you in the session's
	_b.copy(head());
	const dx = _a.x - _b.x, dz = _a.z - _b.z, len = Math.hypot(dx, dz);
	if (len < GUIDE.arrived) { guideTo = null; guide.visible = false; return; }
	guide.visible = true;
	const y = world.position.y + GUIDE.y;
	// **Down the middle of a walkway** (Uli, 2026-09-12), not across the
	// room: step out to the centre line of the aisle that runs toward the
	// print, walk it, and turn in at the end. Where a room has no middle
	// rows the floor is one walkway and two legs are the whole of it.
	const aisle = walkway(_a, _b);
	if (aisle === null) {
		const corner = Math.abs(dx) > Math.abs(dz) ? [_a.x, _b.z] : [_b.x, _a.z];
		layLeg(guide.getObjectByName('leg-1'), _b.x, _b.z, corner[0], corner[1], y);
		layLeg(guide.getObjectByName('leg-2'), corner[0], corner[1], _a.x, _a.z, y);
		guide.getObjectByName('leg-3').visible = false;
		return;
	}
	const [axis, mid] = aisle;                              // 'x': the aisle runs along x at z = mid
	if (axis === 'x') {
		layLeg(guide.getObjectByName('leg-1'), _b.x, _b.z, _b.x, mid, y);
		layLeg(guide.getObjectByName('leg-2'), _b.x, mid, _a.x, mid, y);
		layLeg(guide.getObjectByName('leg-3'), _a.x, mid, _a.x, _a.z, y);
	} else {
		layLeg(guide.getObjectByName('leg-1'), _b.x, _b.z, mid, _b.z, y);
		layLeg(guide.getObjectByName('leg-2'), mid, _b.z, mid, _a.z, y);
		layLeg(guide.getObjectByName('leg-3'), mid, _a.z, _a.x, _a.z, y);
	}
}

// The bench: J jumps to the next room down the list, to see the ride.
addEventListener('keydown', e => {
	if (e.code !== 'KeyJ' || e.repeat) return;
	e.preventDefault();
	const list = openRooms(), i = list.findIndex(r => r.key === state.roomKey);
	const next = list[(i + 1) % list.length];
	if (next) jump(next.specs[next.specs.length - 1].photos[0].n);   // its newest print, so the line has somewhere to lead
});
