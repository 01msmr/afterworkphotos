import * as THREE from '../vendor/three.module.js';
import { ELEVATOR, rooms } from 'gallery/hang';
import { elevator } from 'gallery/elevator';
import { leadToPoint, switchTo } from 'gallery/jump';
import { guardSays } from 'gallery/guard';
import { pinTo } from 'gallery/paper';
import { camera, head, scene, world } from 'gallery/scene';
import { state } from 'gallery/state';

// ---------------------------------------------------------------------------
// The instant lift's strip (Uli, 2026-09-19)
//
// A on the right controller pins a black strip on the wall where the
// pointer points; the trigger held on it scrubs the collection by the
// pointer's height — the print beside it, laid out as the phone's scrub
// card (the year above at 50 %, the number on the print), newest at the
// top, white lines where a year begins. Released, the print stays. The
// print pressed (a white tick on it): the way to the lift's door is laid on the floor
// and a circle marks the spot; standing in it the room switches in the
// dark (jump.js, switchTo) and the line leads on to the print.

const STRIP = { w: 0.10, h: 1.2, card: 0.12, gap: 0.05 };   // h: set to the room's height when pinned; the grey strip touching it on the left: as wide, half as tall, centred
const GREEN = 0x46ff7a;
let group = null, strip = null, fine = null, card = null, mark = null, ring = null;
let fineFrom = null;                          // { y, at }: where a fine scrub began
let at = -1, held = null, ticked = false;   // the print shown; the controller scrubbing; the print pressed for the way
const thumbs = new Map();
const pile = () => state.photos.slice().reverse();   // newest first

const cardCanvas = document.createElement('canvas'); cardCanvas.width = 256; cardCanvas.height = 384;
const cardTex = new THREE.CanvasTexture(cardCanvas); cardTex.colorSpace = THREE.SRGBColorSpace; cardTex.anisotropy = 8;

function thumbFor(p) {
	let img = thumbs.get(p.thumb);
	if (!img) {
		img = new Image(); img.onload = () => drawCard(); img.src = '/' + p.thumb; thumbs.set(p.thumb, img);
		if (thumbs.size > 60) thumbs.delete(thumbs.keys().next().value);
	}
	return img;
}
// the phone's scrub card: the year above at half, the number on the print
function drawCard() {
	const g = cardCanvas.getContext('2d'), p = pile()[at];
	g.clearRect(0, 0, 256, 384);
	if (!p) { cardTex.needsUpdate = true; return; }
	const img = thumbFor(p), y0 = 128;
	g.fillStyle = '#222'; g.fillRect(0, y0, 256, 256);
	if (img.complete && img.naturalWidth) g.drawImage(img, 0, y0, 256, 256);
	const stroked = (text, x, y, size, alpha, fill = '#fff') => {
		g.globalAlpha = alpha; g.font = `700 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
		g.lineJoin = 'round'; g.lineWidth = size * 0.09; g.strokeStyle = '#222'; g.strokeText(text, x, y);
		g.fillStyle = fill; g.fillText(text, x, y); g.globalAlpha = 1;
	};
	g.textBaseline = 'alphabetic'; g.textAlign = 'center';
	stroked(p.taken.slice(0, 4), 128, y0 - 14, 112, 0.5, '#bfbfbf');   // the year: 25 % grey at half (Uli)
	g.textAlign = 'left';
	stroked(String(p.n), 10, 384 - 10, 72, 1);
	if (ticked) { g.strokeStyle = '#fff'; g.lineWidth = 16; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(92, 262); g.lineTo(122, 296); g.lineTo(178, 210); g.stroke(); }
	cardTex.needsUpdate = true;
}
function build() {
	group = new THREE.Group(); group.name = 'strip'; group.visible = false;
	strip = new THREE.Mesh(new THREE.PlaneGeometry(STRIP.w, STRIP.h), new THREE.MeshBasicMaterial({ color: 0x141311 }));
	strip.name = 'strip-rail'; group.add(strip);
	fine = new THREE.Mesh(new THREE.PlaneGeometry(STRIP.w, STRIP.h / 2), new THREE.MeshBasicMaterial({ color: 0x8a8a88 }));
	fine.name = 'strip-fine'; fine.position.x = -STRIP.w; group.add(fine);
	// the years' lines: one thin white bar where a year begins
	const list = pile(), lines = [];
	for (let i = 1; i < list.length; i++) if (list[i].taken.slice(0, 4) !== list[i - 1].taken.slice(0, 4)) lines.push(i);
	const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
	for (const i of lines) {
		const m = new THREE.Mesh(new THREE.PlaneGeometry(STRIP.w, 0.0015), lineMat);
		m.name = 'strip-year'; m.userData.i = i; m.position.set(0, STRIP.h / 2 - STRIP.h * i / (list.length - 1), 0.0005); group.add(m);
	}
	mark = new THREE.Mesh(new THREE.PlaneGeometry(STRIP.w + 0.02, 0.004), new THREE.MeshBasicMaterial({ color: GREEN }));
	mark.name = 'strip-mark'; mark.position.z = 0.001; group.add(mark);
	card = new THREE.Mesh(new THREE.PlaneGeometry(STRIP.card, STRIP.card * 1.5), new THREE.MeshBasicMaterial({ map: cardTex, transparent: true }));
	card.name = 'strip-card'; card.position.set(fine.position.x - STRIP.w / 2 - STRIP.gap - STRIP.card / 2, 0, 0.0005); group.add(card);
	scene.add(group);
	ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.36, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }));
	ring.name = 'strip-ring'; ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);
}
function show(i) {
	at = Math.max(0, Math.min(pile().length - 1, i));
	mark.position.y = STRIP.h / 2 - STRIP.h * at / (pile().length - 1);
	card.position.y = mark.position.y;
	drawCard();
}
// the spot a step outside the lift's doors, in the room's frame
const doorSpot = () => new THREE.Vector3(elevator.origin.x - ELEVATOR.size / 2 - 0.6, 0, elevator.origin.z);
const _rc = new THREE.Raycaster(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();

export const stripLift = {
	shown: () => !!group && group.visible,
	// A: pin it where the ray lands, or take it away
	toggle(rc) {
		if (!group) build();
		if (group.visible) { this.hide(); return; }
		const H = state.room ? state.room.H : 3;
		STRIP.h = H - 0.12; strip.geometry.dispose(); strip.geometry = new THREE.PlaneGeometry(STRIP.w, STRIP.h); fine.geometry.dispose(); fine.geometry = new THREE.PlaneGeometry(STRIP.w, STRIP.h / 2);
		for (const m of group.children) if (m.name === 'strip-year') m.position.y = STRIP.h / 2 - STRIP.h * m.userData.i / (pile().length - 1);
		if (pinTo(group, rc, STRIP.h / 2) !== 'wall') return;   // a wall or nothing
		ticked = false;
		const cur = pile().findIndex(p => p.taken.slice(0, 4) === String(state.year));
		show(at < 0 ? Math.max(0, cur) : at);
		group.visible = true;
	},
	hide() { if (!group) return; group.visible = false; held = null; ring.visible = false; if (ticked) { ticked = false; leadToPoint(null); } },
	// a press: on the rail, scrubbing begins (held until the trigger is let go); on the print, the way to the lift
	press(rc, controller = null) {
		if (!group || !group.visible) return false;
		const hit = rc.intersectObjects([strip, fine, card], false)[0];
		if (!hit || hit.distance > 3) return false;
		if (hit.object === card) {                       // the print pressed: the way to the lift, or off again
			ticked = !ticked; drawCard();
			if (ticked) { leadToPoint(doorSpot(), 0.4); ring.position.copy(world.localToWorld(doorSpot())); ring.position.y = world.position.y + 0.012; ring.visible = true; guardSays('toLift'); }
			else { leadToPoint(null); ring.visible = false; }
			return true;
		}
		fineFrom = null; held = controller || 'view'; this.scrub(rc);
		return true;
	},
	release() { held = null; fineFrom = null; },
	// held, the pointer may cross from one strip to the other: the grey one scrubs finely from where it was entered — its whole (half) height is one year's pictures
	scrub(rc) {
		const hit = rc.intersectObjects([strip, fine], false)[0];
		if (!hit) return;
		if (hit.object === strip) { fineFrom = null; show(Math.round((1 - hit.uv.y) * (pile().length - 1))); return; }
		if (!fineFrom) fineFrom = { y: hit.uv.y, at };
		const list = pile(), year = list[fineFrom.at].taken.slice(0, 4), inYear = list.filter(p => p.taken.slice(0, 4) === year).length;
		show(Math.round(fineFrom.at + (fineFrom.y - hit.uv.y) * inYear));
	},
	chosen: () => pile()[at] || null,
};
export function stepStrip() {
	if (!group || !group.visible) return;
	if (held) {
		if (held === 'view') _rc.setFromCamera(new THREE.Vector2(0, 0), camera);
		else { held.getWorldPosition(_o); held.getWorldQuaternion(_q); _d.set(0, 0, -1).applyQuaternion(_q); _rc.set(_o, _d); }
		stripLift.scrub(_rc);
	}
	if (ticked) {
		const spot = world.localToWorld(doorSpot()), h = head();
		if (Math.hypot(h.x - spot.x, h.z - spot.z) < 0.4) {
			const p = pile()[at], key = state.photos && p ? (roomOf(p) || null) : null;
			stripLift.hide();
			if (key && switchTo(key, p.n)) return;
		}
	}
}
const roomOf = p => { const r = rooms().find(r => !r.favs && r.specs.some(s => s.photos.some(q => q.n === p.n))); return r ? r.key : null; };
