import * as THREE from '../vendor/three.module.js';
import { SOUND, lift } from 'gallery/sound';
import { hangRoom, openRooms, rooms } from 'gallery/hang';
import { head, renderer, scene, world } from 'gallery/scene';
import { elevator } from 'gallery/elevator';
import { setDim } from 'gallery/room';
import { guardSays } from 'gallery/guard';
import { walk } from 'gallery/walk';
import { state } from 'gallery/state';

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
	stepDark(now);
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
const GUIDE = { w: 0.06, y: 0.003, opacity: 0.55, arrived: 1.1, spot: 0.1 };   // chalk on the floor (Uli): flat, at half; a 20 cm disc where to stand
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
// The way is laid **rectangular** (Uli, 2026-09-12): two strips at a
// right angle, the long leg first and the turn onto the print after, the
// way a floor is marked in a building rather than cut across.
function buildGuide() {
	const g = new THREE.PlaneGeometry(GUIDE.w, 1);
	g.rotateX(-Math.PI / 2); g.translate(0, 0, -0.5);      // a strip running from its origin to -z, one metre
	const skin = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: GUIDE.opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -4 });
	guide = new THREE.Group(); guide.name = 'jump-guide';
	guide.userData.legGeo = g; guide.userData.skin = skin;
	for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(g, skin()); m.name = `leg-${i + 1}`; m.renderOrder = 2; guide.add(m); }
	const disc = new THREE.Mesh(new THREE.CircleGeometry(GUIDE.spot, 32), skin());
	disc.name = 'spot'; disc.rotation.x = -Math.PI / 2; disc.renderOrder = 2; guide.add(disc);
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
export function leadTo(n) {
	const p = state.placed && state.placed.find(q => q.piece.photos.some(ph => ph.n === n));
	guideTo = p ? new THREE.Vector3(p.x + Math.sin(p.yaw) * GUIDE.arrived, 0, p.z + Math.cos(p.yaw) * GUIDE.arrived) : null;
}
// the way to a point in the room's frame (the lift's door), until within `near`
export function leadToPoint(v, near = 0) { guideTo = v ? v.clone() : null; guideNear = near; }
export const guided = () => !!guideTo;
let guideNear = 0;                         // 0: the print's own distance (GUIDE.arrived)
// The switch in the dark (Uli, 2026-09-19): standing at the lift's door the
// room goes black over a second, the floor stays lit at half, the other
// room is hung and lit again, and the line leads to the print asked for.
let dark = null;                             // { to, n, t0, hung }
export function switchTo(key, n) {
	if (dark || key === state.roomKey) return false;
	dark = { to: key, n, t0: performance.now(), hung: false };
	lift.run((DARK + HOLD) / 1000 + 0.6);      // a quick engine: start, a moment of running, the stop
	return true;
}
const DARK = 2000, HOLD = 800;                 // 2 s down, 0.8 s black, 2 s up (Uli: twice as long, with a wait)
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
		if (renderer.xr.isPresenting) world.position.add(before.sub(o));               // the new cabin where the old stood, as a ride does
		else { const off = new THREE.Vector3().subVectors(head(), before); walk.pos.set(o.x + off.x, walk.pos.y, o.z + off.z); }
		dark.hung = true; dark.t0 = now;
		leadTo(dark.n);
		guardSays('toPrint');
		return;
	}
	setDim(1 - Math.min(1, t / DARK));
	if (t >= DARK) dark = null;
}
// the way round the rows: a breadth-first path on a 10 cm grid of the room,
// the rows' footprints (state.obstacles) blocked, then the turns only
const CELL = 0.1;
function wayRound(from, to) {
	if (!state.room || !state.obstacles.length) return null;
	const { W, D } = state.room, nx = Math.ceil(W / CELL), nz = Math.ceil(D / CELL);
	const cell = p => [Math.max(0, Math.min(nx - 1, Math.floor((p.x + W / 2) / CELL))), Math.max(0, Math.min(nz - 1, Math.floor((p.z + D / 2) / CELL)))];
	const blocked = (i, j) => { const x = -W / 2 + (i + 0.5) * CELL, z = -D / 2 + (j + 0.5) * CELL; return state.obstacles.some(o => x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1); };
	const [sx, sz] = cell(from), [tx, tz] = cell(to);
	const prev = new Int32Array(nx * nz).fill(-1), q = [sx + sz * nx]; prev[q[0]] = q[0];
	while (q.length) {
		const c = q.shift(), i = c % nx, j = (c / nx) | 0;
		if (i === tx && j === tz) break;
		for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
			const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
			const n = a + b * nx; if (prev[n] >= 0 || blocked(a, b)) continue;
			prev[n] = c; q.push(n);
		}
	}
	const end = tx + tz * nx; if (prev[end] < 0) return null;
	const cells = []; for (let c = end; c !== prev[c]; c = prev[c]) cells.push(c); cells.push(sx + sz * nx); cells.reverse();
	const pts = cells.map(c => new THREE.Vector3(-W / 2 + ((c % nx) + 0.5) * CELL, 0, -D / 2 + (((c / nx) | 0) + 0.5) * CELL));
	const turns = [from.clone().setY(0)];
	for (let k = 1; k < pts.length - 1; k++) { const a = pts[k - 1], b = pts[k], c = pts[k + 1]; if ((b.x - a.x) * (c.z - b.z) !== (b.z - a.z) * (c.x - b.x)) turns.push(b); }
	turns.push(to.clone().setY(0));
	return turns;
}
function stepGuide() {
	if (!guideTo) { if (guide) guide.visible = false; return; }
	if (!guide) buildGuide();
	_a.copy(guideTo).applyMatrix4(world.matrixWorld);      // the print stands in the room's frame, you in the session's
	_b.copy(head());
	const dx = _a.x - _b.x, dz = _a.z - _b.z, len = Math.hypot(dx, dz);
	if (len < (guideNear || GUIDE.arrived)) { guideTo = null; guideNear = 0; guide.visible = false; return; }
	guide.visible = true;
	const y = world.position.y + GUIDE.y;
	const disc = guide.getObjectByName('spot'); disc.position.set(_a.x, y + 0.0005, _a.z); disc.visible = !guideNear;   // the disc marks a print's place, not the lift's (that has its ring)
	for (const m of guide.children) if (m.name.startsWith('leg-')) m.visible = false;
	// round the rows, in the room's frame: a step that ends inside a row's footprint takes the grid way
	const way = wayRound(world.worldToLocal(_b.clone()), world.worldToLocal(_a.clone()));
	if (way) {
		const legs = guide.children.filter(m => m.name.startsWith('leg-'));
		for (let k = 0; k < way.length - 1 && k < legs.length; k++) { const p = world.localToWorld(way[k].clone()), q = world.localToWorld(way[k + 1].clone()); layLeg(legs[k], p.x, p.z, q.x, q.z, y); }
		return;
	}
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
