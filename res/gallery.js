// three.js 0.180.0, vendored (MIT) — res/vendor/three.module.js, which in
// turn imports res/vendor/three.core.js; both are pinned together.
import { stats, stepStats } from './gallery/bench.js?v=20260913h';
import { elevator, lift, pressAt, setSetting } from './gallery/elevator.js?v=20260913h';
import { materials } from './gallery/frames.js?v=20260913h';
import { ELEVATOR, hangRoom, packRun, piecesOf, replan, rooms, spread, upright } from './gallery/hang.js?v=20260913h';
import { jump, stepJump } from './gallery/jump.js?v=20260913h';
import { stepTablet, tabletHit, toggleTablet } from './gallery/tablet.js?v=20260913h';
import { nextLine, placeGuard, stepGuard } from './gallery/guard.js?v=20260913h';
import { musicLevel, playing, stepMusic } from './gallery/music.js?v=20260913h';
import { stepZoom, zoomLabel, zoomPrint } from './gallery/zoom.js?v=20260913h';
import { applyMode, buildRoom, stepMode } from './gallery/room.js?v=20260913h';
import { planOf } from './gallery/plan.js?v=20260913h';
import { camera, renderer, rig, scene, world } from './gallery/scene.js?v=20260913h';
import { EYE, state } from './gallery/state.js?v=20260913h';
import { makePiece, makeVideoPanel, stepVideos, videoCache } from './gallery/video.js?v=20260913h';
import { benchScan, fitRoom, stepPlanes } from './gallery/vr.js?v=20260913h';
import { applyLook, placeBody, stepWalk, walk } from './gallery/walk.js?v=20260913h';

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

// The frame. Anything that throws in here would end the loop for good —
// three asks for the next frame only after the callback returns, so one
// error leaves the room standing still and nothing answering (Uli,
// 2026-09-10, in the headset). So each step is guarded on its own: a step
// that fails is skipped, said once, and the room keeps rendering.
const said = new Set();
function step(name, fn) {
	try { fn(); } catch (e) {
		if (said.has(name)) return;
		said.add(name);
		console.error(`${name} failed, skipped from here on`, e);
		// and say so where it can be read in the headset, on the lift's displays
		try { elevator.show(`${name}: ${String(e.message || e).slice(0, 22)}`, ''); } catch (ignored) {}
	}
}
renderer.setAnimationLoop((now, frame) => {
	if (frame) step('planes', () => stepPlanes(frame));
	step('lift', () => elevator.step(now));
	step('walk', () => stepWalk(now));
	step('videos', () => stepVideos(now));
	step('light', () => stepMode(now));
	step('jump', () => stepJump(now));
	step('tablet', () => stepTablet());
	step('zoom', () => stepZoom(now));
	step('music', () => stepMusic(now));
	step('guard', () => stepGuard(now));
	step('render', () => renderer.render(scene, camera));
	if (stats) step('stats', () => stepStats(now));
});

// Test-harness handle only: the plan's browser checks read the scene graph
// and camera through this. Nothing on the page uses it.
window.G = { scene, camera, renderer, state, buildRoom, applyMode, makePiece, rooms, hangRoom, walk, stepWalk, elevator, pressAt, setSetting, materials, rig, world, placeBody, lift, stepPlanes, stepVideos, videoCache, makeVideoPanel, replan, packRun, piecesOf, spread, upright, fitRoom, planOf, jump, toggleTablet, tabletHit, stepZoom, zoomLabel, zoomPrint, playing, musicLevel, stepMusic, placeGuard, stepGuard, nextLine };   // replan, packRun, piecesOf, spread, upright, fitRoom, planOf: for the bench's checks only
