import * as THREE from '../vendor/three.module.js';
import { jump } from './jump.js?v=20260911k';
import { camera, head, rig, scene } from './scene.js?v=20260911k';
import { state } from './state.js?v=20260911k';
import { hands } from './vr.js?v=20260911k';

// ---------------------------------------------------------------------------
// The tablet on the open hand
//
// Hold a hand open, palm up, and a tablet the size of an iPad mini lies
// above it, showing the whole collection as a wall of thumbnails, newest
// first — the same photos as the site, drawn here, since a page cannot be
// put on a surface inside a session (Uli, 2026-09-11).
//
// Beside it, to its right, a **scrub line**: a strip half the tablet's
// width and three times its height, which the other hand's controller
// points at to run through the years the way the scrubber on the iPad
// does — where you point on it is where you are in the pile. Point at a
// thumbnail and it fills the tablet, with a **j** beside it; press the j
// and the instant lift takes you to the room that print hangs in.

const W = 0.135, H = 0.195;                 // an iPad mini stood upright (Uli, 2026-09-11)
const STRIP = { w: W / 2, h: H * 3, gap: 0.012, fill: 0.3 };   // the scrub zone: half the width, three times the height,
                                            // and drawn, so its reach can be seen (Uli: 70 % transparent)
const PX = 620;                             // the face's canvas, narrow side
const LIFT = 0.06;                          // how far above the palm it lies

let group = null, face = null, strip = null, ctx = null, tex = null, stripTex = null;
let at = 0;                                 // the first photo shown, an index into the pile
let shown = false, bench = false;
const thumbs = new Map();                   // src -> Image, only what is on the face

const pile = () => state.photos.slice().reverse();   // newest first, as the site shows them

// ---------------------------------------------------------------------------
// The two canvases: the face, and the scrub zone beside it

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
function draw() {
	if (!ctx) return;
	const w = ctx.canvas.width, h = ctx.canvas.height;
	ctx.fillStyle = '#111214'; ctx.fillRect(0, 0, w, h);
	const list = pile();
	const p = list[at];
	if (p) {
		// one print, as the site shows one sheet at a time (Uli): the photo
		// large, its line under it, and the jump letter in the corner
		const img = thumbFor(p), m = 0.05 * w;
		const box = { x: m, y: m, w: w - 2 * m, h: h * 0.7 };
		if (img && img.complete && img.naturalWidth) {
			const sc = Math.min(box.w / img.naturalWidth, box.h / img.naturalHeight);
			const iw = img.naturalWidth * sc, ih = img.naturalHeight * sc;
			ctx.drawImage(img, box.x + (box.w - iw) / 2, box.y + (box.h - ih) / 2, iw, ih);
		}
		const d = p.taken;
		ctx.fillStyle = '#e9e6e0'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
		ctx.font = `300 ${Math.round(w * 0.058)}px Jost, Helvetica Neue, Arial, sans-serif`;
		ctx.fillText(`afterworkphoto ${p.n} \u00b7 ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`, m, h * 0.76);
		ctx.fillStyle = '#a8a49c';
		ctx.font = `300 ${Math.round(w * 0.05)}px Jost, Helvetica Neue, Arial, sans-serif`;
		if (p.desc) ctx.fillText(p.desc, m, h * 0.82);
		if (p.place) ctx.fillText(p.place, m, h * 0.87);
		// the j: press it and the instant lift takes you to this print (Uli)
		ctx.fillStyle = '#46ff7a';
		ctx.font = `300 ${Math.round(w * 0.22)}px Jost, Helvetica Neue, Arial, sans-serif`;
		ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
		ctx.fillText('j', w - m, h - m * 0.6);
	}
	tex.needsUpdate = true;
}

function drawStrip() {
	const c = stripTex.image, g = c.getContext('2d');
	g.clearRect(0, 0, c.width, c.height);
	// the whole zone drawn, so its reach can be seen — mostly transparent (Uli)
	g.fillStyle = `rgba(255,255,255,${STRIP.fill})`;
	g.fillRect(0, 0, c.width, c.height);
	g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 3;
	g.beginPath(); g.moveTo(c.width / 2, 10); g.lineTo(c.width / 2, c.height - 10); g.stroke();
	const total = Math.max(1, pile().length - 1);
	const y = 10 + (c.height - 20) * Math.min(1, at / total);
	g.fillStyle = 'rgba(255,255,255,0.9)';
	g.beginPath(); g.arc(c.width / 2, y, 11, 0, Math.PI * 2); g.fill();
	stripTex.needsUpdate = true;
}

function thumbFor(p) {
	let img = thumbs.get(p.thumb);
	if (!img) {
		img = new Image();
		img.onload = () => draw();
		img.src = '/' + p.thumb;
		thumbs.set(p.thumb, img);
		if (thumbs.size > 80) { const first = thumbs.keys().next().value; thumbs.delete(first); }   // only what is near the face
	}
	return img;
}

// ---------------------------------------------------------------------------
// The thing itself

function build() {
	group = new THREE.Group(); group.name = 'tablet'; group.visible = false;
	const c = document.createElement('canvas');
	c.width = PX; c.height = Math.round(PX * H / W);   // upright
	ctx = c.getContext('2d');
	tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
	// the body: a dark slab, the face a hair proud of it
	const body = new THREE.Mesh(new THREE.BoxGeometry(W + 0.008, H + 0.008, 0.006),
		new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.4 }));
	face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex }));
	face.position.z = 0.0035; face.name = 'tablet-face';
	const sc = document.createElement('canvas'); sc.width = 96; sc.height = 512;
	stripTex = new THREE.CanvasTexture(sc);
	strip = new THREE.Mesh(new THREE.PlaneGeometry(STRIP.w, STRIP.h),
		new THREE.MeshBasicMaterial({ map: stripTex, transparent: true, depthWrite: false }));
	strip.position.set(W / 2 + STRIP.gap + STRIP.w / 2, 0, 0.0035);
	strip.name = 'tablet-strip';
	group.add(body, face, strip);
	scene.add(group);
	draw(); drawStrip();
}

// Where it lies: over the open palm, turned to the eyes; on the bench,
// an arm's length in front of them.
function place() {
	const h = head();
	if (bench) {
		const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
		group.position.copy(h).addScaledVector(dir, 0.45).add(new THREE.Vector3(0, -0.12, 0));
		group.quaternion.copy(camera.getWorldQuaternion(new THREE.Quaternion()));
		return;
	}
	const palm = openHand();
	if (!palm) return;
	group.position.copy(palm).add(new THREE.Vector3(0, LIFT, 0));
	group.lookAt(h);
}

// An open hand, palm up: every fingertip well clear of the wrist, and the
// palm lying flat enough to carry something.
const _w = new THREE.Vector3(), _t = new THREE.Vector3(), _m = new THREE.Vector3(), _p = new THREE.Vector3();
function openHand() {
	for (const hand of hands) {
		const j = hand.joints;
		if (!j || !j['wrist'] || !j['wrist'].visible) continue;
		j['wrist'].getWorldPosition(_w);
		const tips = ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip'];
		let open = true;
		for (const t of tips) {
			const jt = j[t];
			if (!jt || !jt.visible) { open = false; break; }
			jt.getWorldPosition(_t);
			if (_t.distanceTo(_w) < 0.12) { open = false; break; }
		}
		if (!open) continue;
		const mm = j['middle-finger-metacarpal'], pm = j['pinky-finger-metacarpal'];
		if (!mm || !pm) continue;
		mm.getWorldPosition(_m); pm.getWorldPosition(_p);
		const n = new THREE.Vector3().subVectors(_m, _w).cross(new THREE.Vector3().subVectors(_p, _w)).normalize();
		if (Math.abs(n.y) < 0.55) continue;              // held flat, either way round
		return _m.clone().lerp(_w, 0.3);                 // the middle of the palm
	}
	return null;
}

export function stepTablet() {
	if (!group) return;
	const want = bench ? shown : !!openHand();
	if (want !== group.visible) { group.visible = want; if (want) { draw(); drawStrip(); } }
	if (group.visible) place();
}

// The bench: T lays it out in front of you, T again puts it away.
export function toggleTablet() {
	if (!group) build();
	bench = true; shown = !shown;
	if (shown) { draw(); drawStrip(); }
	return shown;
}

// A ray from a controller, a hand or the bench's crosshair: the strip
// scrubs through every photo there is, the j jumps. True when it was ours.
export function tabletHit(rc) {
	if (!group || !group.visible) return false;
	const s = rc.intersectObject(strip, false)[0];
	if (s) {
		const local = strip.worldToLocal(s.point.clone());
		const f = Math.min(1, Math.max(0, 0.5 - local.y / STRIP.h));
		at = Math.round(f * Math.max(0, pile().length - 1));
		draw(); drawStrip();
		return true;
	}
	const f = rc.intersectObject(face, false)[0];
	if (!f) return false;
	const local = face.worldToLocal(f.point.clone());
	const u = (local.x + W / 2) / W, v = 0.5 - local.y / H;
	const p = pile()[at];
	if (p && u > 0.6 && v > 0.84) { group.visible = false; shown = false; jump(p.n); }   // the j, in the lower corner
	return true;
}

addEventListener('keydown', e => {
	if (e.code === 'KeyT' && !e.repeat) { e.preventDefault(); toggleTablet(); }
});
