import { elevator, refreshSwitches } from './elevator.js?v=20260910z';
import { renderer, scene } from './scene.js?v=20260910z';

// P: wireframes (Uli). ?stats=1: frame time on the cabin's display and in
// the hint, so the headset can report its own frame rate.
export let wire = false;
export function setWire(on) {
	wire = on;
	scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) m.wireframe = wire; });
}
addEventListener('keydown', e => { if (e.code === 'KeyP' && !e.repeat) { setWire(!wire); refreshSwitches(); } });
export const stats = new URLSearchParams(location.search).get('stats') === '1';
let frames = 0, statsT = performance.now(), fpsText = '';
export function stepStats(now) {
	frames++;
	if (now - statsT < 1000) return;
	const fps = Math.round(frames * 1000 / (now - statsT)); frames = 0; statsT = now;
	const i = renderer.info.render;
	fpsText = `${fps} fps · ${i.calls} calls · ${(i.triangles / 1000).toFixed(1)}k tris`;
	const hint = document.getElementById('hint'); if (hint) hint.textContent = fpsText;
	if (elevator.displays.length && !elevator.ride && !elevator.coming) elevator.show(`${fps} fps`, '');
}
