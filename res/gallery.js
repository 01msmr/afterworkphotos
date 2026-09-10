// three.js 0.180.0, vendored (MIT) — res/vendor/three.module.js, which in
// turn imports res/vendor/three.core.js; both are pinned together.
import { stats, stepStats } from './gallery/bench.js?v=20260911c';
import { elevator, lift, pressAt, setSetting } from './gallery/elevator.js?v=20260911c';
import { materials } from './gallery/frames.js?v=20260911c';
import { ELEVATOR, hangRoom, packRun, piecesOf, replan, rooms, spread, upright } from './gallery/hang.js?v=20260911c';
import { applyMode, buildRoom, stepMode } from './gallery/room.js?v=20260911c';
import { planOf } from './gallery/plan.js?v=20260911c';
import { camera, renderer, rig, scene, world } from './gallery/scene.js?v=20260911c';
import { EYE, state } from './gallery/state.js?v=20260911c';
import { makePiece, makeVideoPanel, stepVideos, videoCache } from './gallery/video.js?v=20260911c';
import { benchScan, fitRoom, stepPlanes } from './gallery/vr.js?v=20260911c';
import { applyLook, placeBody, stepWalk, walk } from './gallery/walk.js?v=20260911c';

// ---------------------------------------------------------------------------
// Boot

// The photos, and the buttons' font (res/fonts, @font-face in gallery.css):
// the faces are drawn on canvases when the lift is built, so the font
// must be in before the first room. Should it fail, the fallback prints.
Promise.all([
	fetch('/photos.json', { cache: 'no-cache' }).then(r => r.json()),   // root-absolute: the page lives at /gallery/
	document.fonts.load('300 56px Jost').catch(() => {}),
]).then(([d]) => { state.photos = d.photos; init(); });

function init() {
	hangRoom(rooms()[0].key);    // the newest room; builds the room around it
	benchScan();                 // ?scan=L on the bench: a floor plan as the Quest would hand one over

	// Arrival: you have just stepped out of the elevator, facing down the room.
	const o = elevator.originWorld();
	walk.pos.set(o.x - ELEVATOR.size, EYE, o.z);
	walk.yaw = Math.PI / 2; walk.pitch = 0;
	elevator.setDoors(1);
	applyLook();
}

renderer.setAnimationLoop((now, frame) => {
	if (frame) stepPlanes(frame);
	elevator.step(now);
	stepWalk(now);
	stepVideos(now);
	stepMode(now);
	renderer.render(scene, camera);
	if (stats) stepStats(now);
});

// Test-harness handle only: the plan's browser checks read the scene graph
// and camera through this. Nothing on the page uses it.
window.G = { scene, camera, renderer, state, buildRoom, applyMode, makePiece, rooms, hangRoom, walk, stepWalk, elevator, pressAt, setSetting, materials, rig, world, placeBody, lift, stepPlanes, stepVideos, videoCache, makeVideoPanel, replan, packRun, piecesOf, spread, upright, fitRoom, planOf };   // replan, packRun, piecesOf, spread, upright, fitRoom, planOf: for the bench's checks only
