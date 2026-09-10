import * as THREE from '../vendor/three.module.js';
import { DOOR, elevator, floors, pressAt } from './elevator.js?v=20260910h';
import { inPoly } from './plan.js?v=20260910h';
import { rectRoom } from './room.js?v=20260910h';
import { ELEVATOR, rooms } from './hang.js?v=20260910h';
import { camera, renderer } from './scene.js?v=20260910h';
import { EYE, state } from './state.js?v=20260910h';
import { stepXR } from './vr.js?v=20260910h';

// ---------------------------------------------------------------------------
// Walking (the bench)
//
// First person on the desktop: a click takes the pointer, the mouse turns
// the head, W A S D or the arrows walk at eye height, Esc gives the pointer
// back. The camera's yaw and pitch are kept here as numbers and applied
// each frame, which keeps the horizon level (no roll creeping in). Clamped
// to the room less WALL_KEEP, so you can lean close to a frame but not
// through the plaster.

const WALK_SPEED = 1.6;         // m/s, a gallery pace
const LOOK_SPEED = 0.0022;      // radians per pixel
const PITCH_MAX = Math.PI * 80 / 180;
const WALL_KEEP = 0.3;

// The point of the segment p→q nearest (x, z), and how far away it is.
function onSegment(p, q, x, z) {
	const dx = q[0] - p[0], dz = q[1] - p[1], l2 = dx * dx + dz * dz;
	const t = l2 ? Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[1]) * dz) / l2)) : 0;
	const cx = p[0] + t * dx, cz = p[1] + t * dz;
	return { x: cx, z: cz, d: Math.hypot(x - cx, z - cz) };
}

const KNEEL = 0.9;              // eye height kneeling, for the low prints of a grid

export const walk = {
	pos: camera.position,        // the same vector; there is one truth
	yaw: 0, pitch: 0,
	eye: EYE,                    // where the eye is heading: EYE or KNEEL
	keys: new Set(),
	lockedForTest: false,        // harness-only: pretend the pointer is taken
	locked() { return this.lockedForTest || document.pointerLockElement === renderer.domElement; },
};

// Taking the pointer: a click. A browser that refuses (Firefox, 2026-09-05)
// says so in the hint, and a drag on the canvas turns the view instead;
// a drag that moved is not a click, so it presses nothing.
let drag = null, dragged = false;
renderer.domElement.addEventListener('click', e => {
	if (dragged) { dragged = false; return; }
	if (walk.locked()) { pressAt(0, 0); return; }
	// a button under the pointer is pressed; anywhere else takes the pointer
	if (pressAt((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)) return;
	let p = null;
	try { p = renderer.domElement.requestPointerLock(); } catch (err) { lockFailed(err); }
	if (p && p.catch) p.catch(lockFailed);
});
document.addEventListener('pointerlockchange', () => {
	document.body.classList.toggle('locked', walk.locked());
});
document.addEventListener('pointerlockerror', () => lockFailed());
function lockFailed(err) {
	const hint = document.getElementById('hint');
	if (hint) hint.textContent = `the browser refused the pointer${err ? ` (${err.name || err})` : ''} \u00b7 drag to look around \u00b7 W A S D to walk \u00b7 Y for the floors \u00b7 B or O for the settings`;
	console.warn('pointer lock refused', err || '');
}
renderer.domElement.addEventListener('mousedown', e => { if (!walk.locked() && e.button === 0) drag = { x: e.clientX, y: e.clientY }; });
addEventListener('mouseup', () => { drag = null; });

function turn(dx, dy) {
	walk.yaw   -= dx * LOOK_SPEED;
	walk.pitch -= dy * LOOK_SPEED;
	walk.pitch  = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, walk.pitch));
}
addEventListener('mousemove', e => {
	if (walk.locked()) { turn(e.movementX, e.movementY); return; }
	if (!drag) return;
	const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
	if (dx || dy) { dragged = true; drag.x = e.clientX; drag.y = e.clientY; turn(dx, dy); }
});

const KEYS = {
	KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back',
	KeyA: 'left', KeyD: 'right',
	// Turning on the spot, held (Uli: smooth, no jump). On the arrows: a
	// browser's own single-key shortcuts are its, not the page's — Vivaldi
	// swallowed Q, E and Y whatever the page did with them (Uli,
	// 2026-09-10) — and no browser binds an arrow.
	ArrowLeft: 'turnL', ArrowRight: 'turnR',
};
// The bench's own keys, so a check needs no mouse and never leaves the
// view (Uli, 2026-09-10): the eye up and down, turning on the spot, and
// the lift — called from where one stands, ridden a floor at a time.
const EYE_MIN = 0.5, EYE_MAX = 2.2, EYE_STEP = 0.1;
const TURN_RATE = Math.PI / 2;         // radians a second: a quarter turn (Uli: smooth, not a jump)
// A browser has keys of its own — Vivaldi takes Q and E (Uli, 2026-09-10)
// — so every key the bench uses is caught here first and stopped.
const BENCH_KEYS = new Set(['KeyV', 'KeyQ', 'KeyE', 'KeyR', 'Comma', 'Period']);
addEventListener('keydown', e => {
	if (BENCH_KEYS.has(e.code) && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); }
	if (KEYS[e.code]) { walk.keys.add(KEYS[e.code]); e.preventDefault(); }
	if (e.code === 'KeyV' && !e.repeat) walk.eye = walk.eye === EYE ? KNEEL : EYE;   // kneel / stand
	if (e.code === 'KeyQ' || e.code === 'KeyE')                                      // Q lower, E higher (Uli)
		walk.eye = Math.max(EYE_MIN, Math.min(EYE_MAX, walk.eye + (e.code === 'KeyE' ? EYE_STEP : -EYE_STEP)));
	if (e.code === 'KeyR' && !e.repeat) elevator.call();                             // R rings for the lift from where one stands
	if ((e.code === 'Comma' || e.code === 'Period') && !e.repeat && elevator.inside()) {
		// inside the cabin: the floor below or above, the list newest first
		const list = rooms(), i = list.findIndex(r => r.key === state.roomKey);
		const to = list[i + (e.code === 'Period' ? -1 : 1)];
		if (to) elevator.go(to.key);
	}
}, true);
// A dot in the middle of the view while the pointer is taken, so one can
// see what a click is about to press (Uli: the lift without the mouse).
const cross = document.body.appendChild(document.createElement('div'));
cross.style.cssText = 'position:fixed;left:50%;top:50%;width:7px;height:7px;margin:-3.5px 0 0 -3.5px;border-radius:50%;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.55);opacity:.55;pointer-events:none;display:none;z-index:5';
addEventListener('pointerlockchange', () => { cross.style.display = walk.locked() ? 'block' : 'none'; });
addEventListener('keyup',   e => { if (KEYS[e.code]) walk.keys.delete(KEYS[e.code]); });
addEventListener('blur',    () => walk.keys.clear());

// Set the camera from yaw and pitch: yaw about the world's up, then pitch
// about the camera's own right. Yaw 0 looks north (-z).
export function applyLook() {
	camera.rotation.set(0, 0, 0);
	camera.rotateY(walk.yaw);
	camera.rotateX(walk.pitch);
}

// Put the body at a spot on the floor, facing a yaw. On the bench that is
// the camera; in VR the rig moves so that the head lands there.
export function placeBody(x, z, yaw) {
	// In a session the body is never moved: you walk by feet and stand in
	// the real cabin; turning the rig here spun the whole room round the
	// visitor on every ride (Uli: jump-rotation on a year button).
	if (renderer.xr.isPresenting) return;
	walk.pos.set(x, walk.pos.y, z);
	walk.yaw = yaw; walk.pitch = 0;
}

function clampToRoom(v) {
	const { W, D } = state.room || state.settings;
	// the plan's own walls, not a rectangle's (Uli, 2026-09-10: an L or a U
	// room): inside the outline, and WALL_KEEP off every edge of it. A
	// segment pushes only where it is near, so a room's inner corner lets
	// one round it instead of walling off the other arm.
	const shape = (state.room && state.room.shape) || rectRoom(W, D);
	const out = shape.outline;
	if (!inPoly(out, v.x, v.z)) {            // outside: back to the nearest wall first
		let near = null;
		out.forEach((p, i) => {
			const c = onSegment(p, out[(i + 1) % out.length], v.x, v.z);
			if (!near || c.d < near.d) near = c;
		});
		if (near) { v.x = near.x; v.z = near.z; }
	}
	for (let pass = 0; pass < 2; pass++) out.forEach((p, i) => {
		const q = out[(i + 1) % out.length];
		const c = onSegment(p, q, v.x, v.z);
		if (c.d >= WALL_KEEP) return;
		const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
		const nx = -(q[1] - p[1]) / len, nz = (q[0] - p[0]) / len;      // the edge's inward normal
		const push = WALL_KEEP - c.d;
		if (c.d > 1e-4) { v.x += (v.x - c.x) / c.d * push; v.z += (v.z - c.z) / c.d * push; }
		else { v.x += nx * push; v.z += nz * push; }
	});
	return v;
}

export const BODY_R = 0.25;   // how close the body's middle comes to a frame
// Is `p` in a middle row's footprint?
function inObstacle(p) { return state.obstacles.some(o => p.x > o.x0 && p.x < o.x1 && p.z > o.z0 && p.z < o.z1); }
// Does a step from `a` to `b` cross the cabin's walls? Only the doorway
// lets one through: the west face, the door's width about the cabin's
// middle, with the doors open.
function throughCabinWall(a, b) {
	const { W, D } = state.room || state.settings;
	const e = ELEVATOR.size, x0 = W / 2 - e, z1 = -D / 2 + e, zc = -D / 2 + e / 2;
	const inCabin = p => p.x > x0 && p.z < z1;
	if (inCabin(a) === inCabin(b)) return false;
	const inDoorway = p => Math.abs(p.z - zc) < DOOR.w / 2 - 0.08;
	return !(inDoorway(a) && inDoorway(b) && elevator.open > 0.5);
}

let lastT = performance.now();
export function stepWalk(now) {
	// never more than a twentieth of a second, never backwards
	const dt = Math.max(0, Math.min(0.05, (now - lastT) / 1000));
	lastT = now;
	if (renderer.xr.isPresenting) { stepXR(dt); return; }
	const k = walk.keys;
	// turning on the spot, as long as the key is held (Uli, 2026-09-10)
	const turn = (k.has('turnL') ? 1 : 0) - (k.has('turnR') ? 1 : 0);
	if (turn) walk.yaw += turn * TURN_RATE * dt;
	let fwd = (k.has('fwd') ? 1 : 0) - (k.has('back') ? 1 : 0);
	let side = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0);
	if (fwd || side) {
		const len = Math.hypot(fwd, side);
		fwd /= len; side /= len;
		// forward is where the yaw points on the floor; right is 90° clockwise
		const dx = (-Math.sin(walk.yaw) * fwd + Math.cos(walk.yaw) * side) * WALK_SPEED * dt;
		const dz = (-Math.cos(walk.yaw) * fwd - Math.sin(walk.yaw) * side) * WALK_SPEED * dt;
		const { W, D } = state.room || state.settings;
		const to = new THREE.Vector3(walk.pos.x + dx, 0, walk.pos.z + dz);
		clampToRoom(to);
		// the cabin's walls and the middle rows stop the body (Uli): into
		// the cabin only through the open door; a blocked step slides along
		// the wall or the row instead
		const blocked = p => throughCabinWall(walk.pos, p) || (inObstacle(p) && !inObstacle(walk.pos));
		if (blocked(to)) {
			const along = new THREE.Vector3(to.x, 0, walk.pos.z), across = new THREE.Vector3(walk.pos.x, 0, to.z);
			to.copy(!blocked(along) ? along : !blocked(across) ? across : walk.pos);
		}
		walk.pos.x = to.x; walk.pos.z = to.z;
	}
	// kneel or rise over a third of a second
	walk.pos.y += (walk.eye - walk.pos.y) * Math.min(1, dt * 9);
	if (Math.abs(walk.eye - walk.pos.y) < 0.002) walk.pos.y = walk.eye;
	applyLook();
}
