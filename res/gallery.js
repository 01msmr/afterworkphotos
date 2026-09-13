// three.js 0.180.0, vendored (MIT) — res/vendor/three.module.js, which in
// turn imports res/vendor/three.core.js; both are pinned together.
import { stats, stepStats, wire } from './gallery/bench.js?v=20260916q';
import { elevator, lift, pressAt, setSetting } from './gallery/elevator.js?v=20260916q';
import { stepCards } from './gallery/bake.js?v=20260916q';   // after elevator.js: bake → frames → room → elevator is a cycle, and the lift's steel asks frames for a texture as it loads
import { materials } from './gallery/frames.js?v=20260916q';
import { ELEVATOR, hangRoom, packRun, piecesOf, replan, firstRoom, rooms, spread, upright } from './gallery/hang.js?v=20260916q';
import { stepSticker } from './gallery/sticker.js?v=20260916q';
import { jump, stepJump } from './gallery/jump.js?v=20260916q';
import { stepTablet, tabletHit, toggleTablet } from './gallery/tablet.js?v=20260916q';
import { nextLine, placeGuard, stepGuard } from './gallery/guard.js?v=20260916q';
import { musicLevel, playing, stepMusic } from './gallery/music.js?v=20260916q';
import { stepZoom, zoomLabel, zoomPrint } from './gallery/zoom.js?v=20260916q';
import { applyMode, buildRoom, stepMode } from './gallery/room.js?v=20260916q';
import { planOf } from './gallery/plan.js?v=20260916q';
import { camera, renderer, rig, scene, world } from './gallery/scene.js?v=20260916q';
import { EYE, state } from './gallery/state.js?v=20260916q';
import { makePiece, makeVideoPanel, stepDetail, stepVideos, videoCache } from './gallery/video.js?v=20260916q';
import { benchScan, fitRoom, stepPlanes } from './gallery/vr.js?v=20260916q';
import { applyLook, placeBody, stepWalk, walk } from './gallery/walk.js?v=20260916q';

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
	hangRoom(firstRoom().key);   // the newest year; builds the room around it (never the favourites floor, which may be empty)
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
	step('detail', () => stepDetail(now));
	step('light', () => stepMode(now));
	step('jump', () => stepJump(now));
	step('tablet', () => stepTablet());
	step('sticker', () => stepSticker());
	step('zoom', () => stepZoom(now));
	step('cards', () => stepCards());
	step('music', () => stepMusic(now));
	step('guard', () => stepGuard(now));
	step('render', () => renderer.render(scene, camera));
	step('probe', () => stepProbe(now));
	if (stats) step('stats', () => stepStats(now));
});

// What the headset actually gives, read off the lift's outside display
// **while the wire switch is on** (2026-09-13; the gallery does not wear
// its instruments): the depth buffer's bits — asked while the XR
// framebuffer is bound, which it is inside a render — the layer kind (a
// projection layer names its own depth format; a base layer takes the
// browser's), the frame rate, the draw calls, and how long the last hang
// took. Nothing on the bench.
const probe = { bits: 0, frames: 0, at: 0 };
const gl = renderer.getContext();
scene.onAfterRender = () => { if (!probe.bits && renderer.xr.isPresenting) probe.bits = gl.getParameter(gl.DEPTH_BITS); };
function stepProbe(now) {
	probe.frames++;
	if (now - probe.at < 1000) return;
	if (renderer.xr.isPresenting && probe.at && wire) {
		const rs = renderer.xr.getSession().renderState, kind = rs.layers && rs.layers.length ? 'proj' : 'base';
		elevator.note(`${probe.bits} bit · ${kind} · ${Math.round(probe.frames * 1000 / (now - probe.at))} fps · ${renderer.info.render.calls} calls · hang ${state.hangMs || 0} ms`);   // the calls of the last frame: fill or geometry, the number says which
	} else if (elevator.noteText) elevator.note('');
	probe.frames = 0; probe.at = now;
}

// Test-harness handle only: the plan's browser checks read the scene graph
// and camera through this. Nothing on the page uses it.
window.G = { scene, camera, renderer, state, buildRoom, applyMode, makePiece, rooms, hangRoom, walk, stepWalk, elevator, pressAt, setSetting, materials, rig, world, placeBody, lift, stepPlanes, stepVideos, videoCache, makeVideoPanel, stepDetail, replan, packRun, piecesOf, spread, upright, fitRoom, planOf, jump, toggleTablet, tabletHit, stepZoom, zoomLabel, zoomPrint, playing, musicLevel, stepMusic, placeGuard, stepGuard, nextLine };   // replan, packRun, piecesOf, spread, upright, fitRoom, planOf: for the bench's checks only
