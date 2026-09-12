import * as THREE from '../vendor/three.module.js';
import { BUTTON, elevator, pressAlong, settingsMap } from './elevator.js?v=20260913s';
import { cornerFree, outlineOf, planOf, rotShape } from './plan.js?v=20260913s';
import { tabletHit } from './tablet.js?v=20260913s';
import { ELEVATOR, clearRooms, hangRoom, rooms } from './hang.js?v=20260913s';
import { camera, head, renderer, rig, scene, world } from './scene.js?v=20260913s';
import { loadSettings, state } from './state.js?v=20260913s';
import { placeBody, walk } from './walk.js?v=20260913s';

// ---------------------------------------------------------------------------
// VR (phase 2, first step)
//
// Where the browser says it can do immersive-vr — the Quest — a button
// offers it. In the headset you stand where the bench's camera stood, at
// real floor height, and walk by feet; a controller's trigger presses the
// lift button it points at — either hand. Nothing else of the bench
// (mouse, keys, the DOM panels) applies in there.

const vrButton = document.getElementById('vr');
const controllers = [0, 1].map(i => {
	const c = renderer.xr.getController(i);
	c.addEventListener('selectstart', () => {
		const rc = new THREE.Raycaster();
		const origin = c.getWorldPosition(new THREE.Vector3());
		const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(c.getWorldQuaternion(new THREE.Quaternion()));
		rc.set(origin, dir);
		if (tabletHit(rc)) return;   // the tablet on the open hand takes the ray first (Uli, 2026-09-11)
		pressAlong(rc, 3);   // the trigger presses what it points at, nothing else (Uli, 2026-09-10:
		                     // pointing at a wall must not turn the room — a switch for that first)
	});
	// a thin ray so you see what you point at
	const ray = new THREE.Line(
		new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
		new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
	ray.scale.z = 2;
	c.add(ray);
	rig.add(c);
	return c;
});

async function offerVR() {
	if (!navigator.xr || !vrButton) return;
	let ok = false;
	try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch (e) {}
	if (!ok) return;
	state.xrMode = 'immersive-vr';                       // no AR (Uli)
	vrButton.hidden = false;
	vrButton.addEventListener('click', async () => {
		try {
			// The room is set up at entry (Uli): the Guardian boundary gives the
			// rectangle, the wall you look at becomes the north wall. Planes are
			// still asked for, should a browser ever hand them over in VR.
			// Sharpness on the Quest 3 (Uli, 2026-09-05): the view rendered at
			// 1.3× the headset's default scale (set before the session), the
			// fixed foveation eased from full to 0.3 so the edges of the view
			// do not go soft where a print sits.
			renderer.xr.setFramebufferScaleFactor(1.3);
			const session = await navigator.xr.requestSession(state.xrMode, { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor', 'hand-tracking', 'plane-detection', 'mesh-detection'] });
			state.sessionT0 = performance.now();
			// Render in the boundary's own space: its polygon and the world then
			// share one origin and yaw (read in bounded-floor, rendered in
			// local-floor, the room landed turned and shifted).
			try { state.bounded = await session.requestReferenceSpace('bounded-floor'); } catch (e) { state.bounded = null; }
			if (state.bounded && state.bounded.boundsGeometry && state.bounded.boundsGeometry.length >= 3) {
				renderer.xr.setReferenceSpace(state.bounded);
				// The headset's own recentre (holding the Oculus button) turns
				// the space the boundary is given in, and the gallery's walls
				// would then stand across the real ones. WebXR says so with a
				// `reset` on the space: the boundary is read again in the new
				// space and the room fitted to it afresh (Uli, 2026-09-10: the
				// walls are not always parallel, or the view was reset).
				state.bounded.addEventListener('reset', () => {
					if (performance.now() - (state.matchedAt || 0) < 1000) return;   // a run that fires often must not refit every time
					state.matchedAt = performance.now();
					matchWalls();
				});
			} else state.bounded = null;
			session.addEventListener('end', () => { vrButton.hidden = false; document.body.classList.remove('xr'); rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); state.lookSet = false; if (state.real) { state.real = null; world.position.set(0, 0, 0); world.rotation.set(0, 0, 0); state.settings.H = loadSettings().H; clearRooms(); state.room = null; hangRoom(rooms()[0].key); } });
			await renderer.xr.setSession(session);
			renderer.xr.setFoveation(0.3);
			scene.traverse(o => { if (o.isDirectionalLight && o.castShadow) { o.shadow.mapSize.set(1024, 1024); o.shadow.map?.dispose(); o.shadow.map = null; } });
			document.body.classList.add('xr');
			vrButton.hidden = true;
			// stand where the bench stood, facing the same way
			const x = walk.pos.x, z = walk.pos.z, yaw = walk.yaw;
			walk.pos.set(0, 0, 0); walk.pitch = 0; camera.rotation.set(0, 0, 0);
			placeBody(x, z, yaw);
		} catch (e) { console.warn('VR session refused', e); }
	});
}
offerVR();

// Hands (Uli: by hand instead of the trigger, as an alternative): with
// hand tracking on, the tip of an index finger touching a button, the
// call button or a label presses it — one press per touch, then the
// finger has to leave and come back.
export const hands = [0, 1].map(i => { const h = renderer.xr.getHand(i); h.userData.touching = null; rig.add(h); return h; });
const TOUCH = 0.022;
const tip = new THREE.Vector3();
function stepHands() {
	const pieces = scene.getObjectByName('pieces');
	for (const h of hands) {
		const j = h.joints && h.joints['index-finger-tip'];
		if (!j || !j.visible) { h.userData.touching = null; continue; }
		j.getWorldPosition(tip);
		let hit = null;
		for (const b of [...elevator.buttons, ...elevator.callButtons, ...elevator.switches, ...settingsMap.switches]) {
			if (b.getWorldPosition(new THREE.Vector3()).distanceTo(tip) < TOUCH + BUTTON.r) { hit = b; break; }
		}
		if (!hit && pieces) pieces.traverse(o => {
			if (hit || o.name !== 'label' || !o.visible) return;
			const c = o.getWorldPosition(new THREE.Vector3());
			const half = Math.max(o.geometry.parameters.width, o.geometry.parameters.height) * o.scale.x / 2;
			if (c.distanceTo(tip) < half + TOUCH) hit = o;
		});
		if (hit && h.userData.touching !== hit) {
			h.userData.touching = hit;
			const rc = new THREE.Raycaster();
			const dir = hit.getWorldPosition(new THREE.Vector3()).sub(tip).normalize();
			rc.set(tip.clone().addScaledVector(dir, -0.05), dir);
			pressAlong(rc, 0.3);
		} else if (!hit) h.userData.touching = null;
	}
}

// In VR you walk by feet (Uli); nothing moves the body but the elevator.
// The controllers' B (right) and Y (left) — buttons[5] of the xr-standard
// gamepad — summon and put away the settings map, on the press's edge.
const bDown = new WeakMap();
function stepGamepads() {
	const session = renderer.xr.getSession();
	if (!session) return;
	for (const src of session.inputSources) {
		const b = src.gamepad && src.gamepad.buttons[5];
		if (!b) continue;
		if (b.pressed && !bDown.get(src)) settingsMap.toggle();
		bDown.set(src, b.pressed);
	}
}
export function stepXR(dt) { stepHands(); stepGamepads(); }

// ---------------------------------------------------------------------------
// The real room (phase 3)
//
// With plane-detection the headset hands over the planes of the room it
// scanned in Space Setup: the floor, the walls, the ceiling, as polygons
// with a pose and a label. From them: the walls' dominant direction, the
// floor's rectangle in that direction, the ceiling's height. The room is
// rebuilt to that rectangle, `world` is moved and turned onto it, and
// the lift takes the real corner nearest to where you stand. Every year
// is re-planned for this one room. Done once per session, when the
// floor and at least two walls have been seen.

let planesShown = 0;
export function stepPlanes(frame) {
	if (state.real) return;
	if (state.fitFailed && performance.now() - state.fitFailed < 1000) return;   // a fit that did not take is not retried every frame
	const ref = renderer.xr.getReferenceSpace();
	const walls = [], floors = [], ceilings = [];
	const planes = frame.detectedPlanes ? [...frame.detectedPlanes] : null;
	// say what is arriving on the lift's display, once a second, until the room snaps
	const now = performance.now();
	if (now - planesShown > 1000 && elevator.displays.length && !elevator.ride) {
		planesShown = now;
		elevator.show(planes ? `${planes.length} planes` : 'no planes api', '');
	}
	// no planes: the Guardian's boundary gives the rectangle — at once, from
	// where you stand and look (Uli: look straight at the middle of a wall)
	// wait for a real head pose (the first frames report the origin)
	const hp = head(); if (hp.lengthSq() < 1e-6 || Math.abs(hp.y) < 0.3) return;
	if ((!planes || !planes.length) && state.bounded && state.bounded.boundsGeometry && now - state.sessionT0 > 300) {
		const pts = state.bounded.boundsGeometry.map(q => new THREE.Vector3(q.x, 0, q.z));
		if (pts.length >= 3) { fitRoom(pts, [], [], 0, 'bounds'); return; }
	}
	if (!planes || !planes.length) {
		if (!state.bounded && now - state.sessionT0 > 300 && !state.lookSet) {
			// no boundary either: turn the room to the look, its north wall 1.5 m ahead
			state.lookSet = true;
			const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())); look.y = 0; look.normalize();
			const yaw = Math.atan2(-look.x, -look.z);
			const h = head(), D = state.room ? state.room.D : state.settings.D;
			world.rotation.y = yaw;
			world.position.set(h.x + look.x * (1.5 - D / 2), 0, h.z + look.z * (1.5 - D / 2));
			if (elevator.displays.length) elevator.show('turned to you', '');
		}
		return;
	}
	for (const plane of planes) {
		const pose = frame.getPose(plane.planeSpace, ref);
		if (!pose) continue;
		const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
		const pts = plane.polygon.map(q => new THREE.Vector3(q.x, q.y, q.z).applyMatrix4(m));
		const label = plane.semanticLabel || '';
		const normal = new THREE.Vector3(0, 1, 0).transformDirection(m);
		const entry = { pts, normal, label };
		if (plane.orientation === 'vertical' || label === 'wall') walls.push(entry);
		else if (label === 'ceiling' || (plane.orientation === 'horizontal' && pts[0].y > 1.5)) ceilings.push(entry);
		else if (label === 'floor' || plane.orientation === 'horizontal') floors.push(entry);
	}
	if (!floors.length || walls.length < 2) return;
	const floor = floors.reduce((a, b) => a.pts.length >= b.pts.length ? a : b);
	fitRoom(floor.pts, walls, ceilings, floor.pts.reduce((y, p) => y + p.y, 0) / floor.pts.length, 'planes');
}

// Fit the room to a floor polygon: the direction from the walls' normals
// when there are walls, else from the polygon's longest edge; the
// rectangle in that direction; the height from the ceiling or the walls.
export function fitRoom(floorPts, walls, ceilings, floorY, source) {
	let theta;
	if (walls.length) {
		// each wall's normal, folded into a quarter turn, weighted by length
		let sx = 0, sy = 0;
		for (const w of walls) {
			const a = Math.atan2(w.normal.x, w.normal.z);
			let len = 0; for (let i = 0; i < w.pts.length; i++) len += w.pts[i].distanceTo(w.pts[(i + 1) % w.pts.length]);
			sx += Math.cos(4 * a) * len; sy += Math.sin(4 * a) * len;
		}
		theta = Math.atan2(sy, sx) / 4;
	} else {
		// A boundary drawn by hand is many short edges, but the long runs of
		// it lie along the walls: the length-weighted mean of the edges'
		// directions, folded into a quarter turn, is where the walls point.
		// (The smallest box round the polygon was the first try and it
		// mis-turned a room with a swept corner or an alcove — Uli,
		// 2026-09-10: the orientation was not good and the room came out
		// small, which a wrong turn does.)
		let sx = 0, sy = 0;
		for (let i = 0; i < floorPts.length; i++) {
			const p = floorPts[i], q = floorPts[(i + 1) % floorPts.length];
			const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz);
			if (len < 0.05) continue;                     // a stub says nothing about a wall
			const a = Math.atan2(dz, dx);
			sx += Math.cos(4 * a) * len; sy += Math.sin(4 * a) * len;
		}
		// minus: `theta` is what the scan is turned *by* below (rotationY(-theta)
		// takes a direction at angle a to a + theta), not the walls' own angle
		theta = sx || sy ? -Math.atan2(sy, sx) / 4 : 0;
	}
	// the scan in the walls' own frame, and the plan drawn on it: the
	// biggest rectangle that fits, with the 50 cm extensions the scan
	// still holds (Uli, 2026-09-10 — an L or a U room keeps its arms),
	// or one of the two plainer plans the visitor's `plan` switch asks for
	const rot = new THREE.Matrix4().makeRotationY(-theta);
	const poly = floorPts.map(p => { const q = p.clone().applyMatrix4(rot); return [q.x, q.z]; });
	state.scan = { pts: floorPts.map(p => p.clone()), walls, ceilings, floorY, source };   // kept, so the switch can plan again without a new scan
	const plan = planOf(poly, state.settings.plan);
	if (!plan || plan.shape.W < 1.5 || plan.shape.D < 1.5) return;
	const centre = new THREE.Vector3(plan.cx, 0, plan.cz).applyMatrix4(new THREE.Matrix4().makeRotationY(theta));
	// ?scanline=1: the boundary as it arrived, drawn on the floor in the
	// session's own space, so the real room, the scan and the gallery's
	// walls can be seen against each other (Uli, 2026-09-10: the scan was
	// much bigger than the room that was built)
	if (new URLSearchParams(location.search).get('scanline') === '1') {
		const old = scene.getObjectByName('scanline'); if (old) { old.geometry.dispose(); old.parent.remove(old); }
		const g = new THREE.BufferGeometry().setFromPoints([...floorPts, floorPts[0]].map(p => new THREE.Vector3(p.x, floorY + 0.02, p.z)));
		const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x46ff7a }));
		line.name = 'scanline'; scene.add(line);
	}
	const H = ceilings.length ? Math.max(2.2, ceilings[0].pts[0].y - floorY) : Math.max(2.2, Math.min(3.2, walls.reduce((h, w) => Math.max(h, ...w.pts.map(p => p.y)), 0) - floorY || 2.6));

	// of the four turns that keep the walls on the walls, those with room
	// for the lift in the north-east corner (Uli: never in a cut corner)
	// — of them the one whose north wall is the wall you are looking at,
	// so the lift stands to your front right. A plan with no such corner
	// falls back to its main rectangle, which always has four.
	const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())); look.y = 0; look.normalize();
	// Which way round the room stands: of the four turns that keep the walls
	// on the walls, those with a free corner for the lift — and of those the
	// one with the most wall to hang on, so the room finds its own front
	// (Uli, 2026-09-10: it should not depend on facing a wall as you enter).
	// Where two turns are as good as each other, a square room say, the one
	// you are looking at wins.
	const turn = shape => {
		let best = null;
		for (let k = 0; k < 4; k++) {
			const turned = rotShape(shape, k);
			if (!cornerFree(turned, ELEVATOR.size)) continue;
			const yaw = theta + k * Math.PI / 2;
			const north = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
			const dot = north.dot(look);
			if (!best || dot > best.dot) best = { yaw, shape: turned, dot };
		}
		return best;
	};
	const best = turn(plan.shape) || turn(planOf(poly, 'inside').shape);
	if (!best) { state.fitFailed = performance.now(); return; }   // and not again for a second: a fit tried every frame stops the room
	const shape = best.shape;
	state.real = { W: shape.W, D: shape.D, H: Math.round(H * 20) / 20, yaw: best.yaw, centre, walls: walls.length, source, shape };
	console.info(`real room ${shape.W.toFixed(2)} × ${shape.D.toFixed(2)} × ${state.real.H} from ${source}, ${walls.length} walls, ${shape.rects.length} part${shape.rects.length > 1 ? 's' : ''}, ${shape.outline.length} corners, turned ${(best.yaw * 180 / Math.PI).toFixed(0)}°`);

	world.position.set(centre.x, floorY, centre.z);
	world.rotation.y = best.yaw;
	state.settings.H = state.real.H;                    // for this session: the lines, the cabin
	clearRooms();                                     // every year re-planned for this room
	state.room = null;                                   // the room and cabin rebuilt
	const key = rooms().some(r => r.key === state.roomKey) ? state.roomKey : (rooms().find(r => r.year === state.year) || rooms()[0]).key;
	hangRoom(key);
	elevator.setDoors(1); elevator.open = 1;
	// What the headset handed over, what was made of it, and how much of
	// the scan that holds — on both displays, so it can be read from the
	// room as well as from the cabin (Uli, 2026-09-10). It stays until the
	// lift is called; the `plan` switch says it again.
	const b = { x0: Math.min(...poly.map(p => p[0])), x1: Math.max(...poly.map(p => p[0])), z0: Math.min(...poly.map(p => p[1])), z1: Math.max(...poly.map(p => p[1])) };
	state.scanSaid = `${(b.x1 - b.x0).toFixed(1)}×${(b.z1 - b.z0).toFixed(1)}\u2192${shape.W.toFixed(1)}×${shape.D.toFixed(1)}`
		+ (plan.kept === undefined ? '' : ` ${Math.round(plan.kept * 100)}%`);
	console.info(`scan ${state.scanSaid}`);
	if (elevator.displays.length) elevator.show(state.scanSaid, '');
}

// The visitor's `plan` switch: the same scan planned again (Uli,
// 2026-09-10). Nothing to do before a room has been scanned.
export function planAgain() {
	if (!state.scan) return false;
	const { pts, walls, ceilings, floorY, source } = state.scan;
	state.real = null;
	fitRoom(pts, walls, ceilings, floorY, source);
	return true;
}

// ---------------------------------------------------------------------------
// The bench: a floor plan without a headset
//
// `?scan=L`, `?scan=U`, or rows of one character per 50 cm cell separated
// by `/` — `#` inside the room, `.` outside — become a boundary polygon
// as the Quest would hand one over: turned a few degrees and drawn by a
// wobbly hand. The `plan` setting then makes a room of it, the same code
// the headset runs.
const SCANS = {
	L: ['############', '############', '############', '############', '############', '############', '######......', '######......', '######......'],
	U: ['############', '############', '############', '############', '############', '############', '####....####', '####....####', '####....####'],
};
const CELL = 0.5, TURN = 7 * Math.PI / 180, WOBBLE = 0.02, STEP = 0.4;
export function benchScan() {
	const q = new URLSearchParams(location.search).get('scan');
	if (!q) return false;
	const rows = SCANS[q.toUpperCase()] || q.split('/');
	const cells = [];
	rows.forEach((row, j) => [...row].forEach((c, i) => {
		if (c === '#') cells.push({ x0: i * CELL, x1: (i + 1) * CELL, z0: j * CELL, z1: (j + 1) * CELL });
	}));
	if (cells.length < 4) return false;
	const line = outlineOf(cells);
	const cx = (Math.min(...line.map(p => p[0])) + Math.max(...line.map(p => p[0]))) / 2;
	const cz = (Math.min(...line.map(p => p[1])) + Math.max(...line.map(p => p[1]))) / 2;
	const pts = [];
	line.forEach((p, i) => {
		const n = line[(i + 1) % line.length], len = Math.hypot(n[0] - p[0], n[1] - p[1]);
		for (let k = 0, steps = Math.max(1, Math.round(len / STEP)); k < steps; k++) {
			const t = k / steps;
			const x = p[0] + (n[0] - p[0]) * t - cx + (Math.random() - 0.5) * WOBBLE;
			const z = p[1] + (n[1] - p[1]) * t - cz + (Math.random() - 0.5) * WOBBLE;
			pts.push(new THREE.Vector3(x * Math.cos(TURN) - z * Math.sin(TURN), 0, x * Math.sin(TURN) + z * Math.cos(TURN)));
		}
	});
	state.real = null;
	fitRoom(pts, [], [], 0, 'bench');
	return true;
}


// Fit the room to the boundary as it stands now — after the headset's
// view was reset, or whenever the walls are to be found again (the
// `view` switch does it too, through recentre()). Returns false where
// there is no boundary to match.
export function matchWalls() {
	const b = state.bounded;
	if (!b || !b.boundsGeometry || b.boundsGeometry.length < 3) return false;
	state.real = null;
	fitRoom(b.boundsGeometry.map(q => new THREE.Vector3(q.x, 0, q.z)), [], [], 0, 'bounds');
	return true;
}
