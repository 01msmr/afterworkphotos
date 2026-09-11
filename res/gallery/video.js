import * as THREE from '../vendor/three.module.js';
import { addLabel } from './bake.js?v=20260912h';
import { FRAME, GRID_GAP, MAT_Z, PRINT_SCALE, matWidth, materials, photoTexture, poolMaterial, sc, textureCache } from './frames.js?v=20260912h';
import { camera, scene } from './scene.js?v=20260912h';
import { pieceY, state } from './state.js?v=20260912h';

// ---------------------------------------------------------------------------
// Videos — the LED panel
//
// A photo that is a video hangs as a panel of light in place of a print:
// a visible matrix of diodes, the video playing on it (Uli's spec). No
// frame, no mat, no glass; the panel is the size the print would have
// been. The video texture is the picture; a second texture — a grid of
// dark lines, one cell per diode — lies a hair in front, so what you see
// is a wall of diodes, not a screen.
//
// A panel plays only while it is looked at (see stepVideos): its own
// pixels are the light in the room, so a room of stills stays still.
export const videoCache = new Map();     // n → { el, texture }
function videoTexture(p) {
	if (!videoCache.has(p.n)) {
		const el = document.createElement('video');
		el.src = '/' + p.video;
		el.loop = true;
		el.muted = true;                 // no sound in the gallery; the lift has the room's
		el.playsInline = true;
		el.preload = 'auto';
		el.crossOrigin = 'anonymous';
		const t = new THREE.VideoTexture(el);
		t.colorSpace = THREE.SRGBColorSpace;
		videoCache.set(p.n, { el, texture: t, playing: false });
	}
	return videoCache.get(p.n);
}
export function freeVideosExcept(keep) {
	for (const [n, v] of videoCache) {
		if (keep.has(n)) continue;
		v.el.pause(); v.el.removeAttribute('src'); v.el.load();
		v.texture.dispose();
		videoCache.delete(n);
	}
}

// The diode grid: dark lines between cells, drawn once and repeated over
// the panel. LED_PITCH is a diode's size on the wall, so a 90 cm panel
// shows 90/0.9 = 100 of them across — large enough to read as diodes,
// fine enough to keep the picture.
const LED_PITCH = 0.006;          // metres per diode — 0.66 of the first try (Uli: finer)
let ledTex = null;
function ledGrid() {
	if (ledTex) return ledTex;
	const px = 16;
	const c = document.createElement('canvas'); c.width = c.height = px;
	const ctx = c.getContext('2d');
	ctx.fillStyle = '#000'; ctx.fillRect(0, 0, px, px);
	// one diode: a round-ish lit face with a dark gap around it
	ctx.globalCompositeOperation = 'destination-out';
	ctx.beginPath(); ctx.arc(px / 2, px / 2, px * 0.42, 0, Math.PI * 2); ctx.fill();
	ledTex = new THREE.CanvasTexture(c);
	ledTex.wrapS = ledTex.wrapT = THREE.RepeatWrapping;
	ledTex.colorSpace = THREE.SRGBColorSpace;
	return ledTex;
}

// A video panel, in place of makeFramedPrint for a video: the picture,
// and the diode mask over it. Its outer size is the framed print's, so a
// video hangs in the rhythm of the wall it stands in.
export function makeVideoPanel(p, size) {
	const g = new THREE.Group();
	g.name = `panel-${p.n}`;
	const k = sc();
	const outer = (size + 2 * matWidth(size) + 2 * FRAME.face) * k;
	const v = videoTexture(p);

	// the panel's body is as deep as a frame is; the picture lies on its
	// front face, the diodes a hair in front of that
	const depth = FRAME.depth * k * 0.6;
	const face = new THREE.Mesh(new THREE.PlaneGeometry(outer, outer),
		new THREE.MeshBasicMaterial({ map: v.texture }));
	face.name = 'video';
	face.position.z = depth + 0.0005;
	face.userData = { n: p.n };
	g.add(face);

	// the diodes: black between them, so the picture shows through the holes
	const cells = Math.max(24, Math.round(outer / LED_PITCH));
	const grid = ledGrid().clone();
	grid.needsUpdate = true;
	grid.wrapS = grid.wrapT = THREE.RepeatWrapping;
	grid.repeat.set(cells, cells);
	const mask = new THREE.Mesh(new THREE.PlaneGeometry(outer, outer),
		new THREE.MeshBasicMaterial({ map: grid, transparent: true }));
	mask.name = 'leds';
	mask.position.z = depth + 0.001;
	g.add(mask);

	// the panel's own body, a shallow dark box behind the diodes
	const body = new THREE.Mesh(new THREE.BoxGeometry(outer, outer, depth),
		new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.7, metalness: 0.2 }));
	body.name = 'panel-body';
	body.position.z = depth / 2;
	body.castShadow = true;
	body.receiveShadow = true;
	g.add(body);

	g.userData = { n: p.n, w: outer, h: outer, video: true };
	return g;
}

export function freeTexturesExcept(keep) {
	for (const [key, t] of textureCache) if (!keep.has(key)) { t.dispose(); textureCache.delete(key); }
}

// Outer edge of one framed print of a given print size.
export const framedSize = size => (size + 2 * matWidth(size) + 2 * FRAME.face) * sc();

// A frame bar: a closed square section with all four long edges
// chamfered, mitred at 45 degrees at both ends so the four bars meet
// corner to corner (Uli) — no open ends to see into from the side. Built
// along x (a horizontal bar: face across y, depth along z), the mitre
// cutting each vertex's x by how far it sits from the outer edge; turned
// for a vertical bar. Sixteen triangles.
const barCache = new Map();
function barGeometry(length, face, depth, horizontal) {
	const key = `${length.toFixed(4)}|${face.toFixed(4)}|${depth.toFixed(4)}|${horizontal}`;
	if (barCache.has(key)) return barCache.get(key);
	const c = Math.min(FRAME.chamfer, face / 3), fw = face / 2, L = length / 2;
	// the section, anticlockwise seen from +x, starting at the outer back corner
	const prof = [[fw, c], [fw, depth - c], [fw - c, depth], [-fw + c, depth], [-fw, depth - c], [-fw, c], [-fw + c, 0], [fw - c, 0]];
	// the mitre: the outer edge (y = +fw) runs the full length, the inner (y = -fw) is shorter by the face
	const xEnd = (y, sign) => sign * (L - (fw - y));
	const pos = [], nor = [], uv = [];
	let v = 0;
	for (let i = 0; i < prof.length; i++) {
		const [y0, z0] = prof[i], [y1, z1] = prof[(i + 1) % prof.length];
		const len = Math.hypot(y1 - y0, z1 - z0);
		const ny = (z1 - z0) / len, nz = -(y1 - y0) / len;
		const quad = [[xEnd(y0, -1), y0, z0, 0, v], [xEnd(y0, 1), y0, z0, length, v], [xEnd(y1, 1), y1, z1, length, v + len], [xEnd(y1, -1), y1, z1, 0, v + len]];
		// wound anticlockwise seen from outside, so the faces are front faces (they were back faces: see-through from the side)
		for (const t of [[0, 2, 1], [0, 3, 2]]) for (const k of t) { const q = quad[k]; pos.push(q[0], q[1], q[2]); nor.push(0, ny, nz); uv.push(q[3], q[4]); }
		v += len;
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	if (!horizontal) g.rotateZ(Math.PI / 2);
	barCache.set(key, g);
	return g;
}

function makeFramedPrint(p, size) {
	const g = new THREE.Group();
	g.name = `print-${p.n}`;
	const k = sc();
	const face = FRAME.face * k;
	const inner = (size + 2 * matWidth(size)) * k;   // the mat board's edge = frame's inner edge
	const outer = inner + 2 * face;

	// the mat board: only its face shows, its edges are under the frame
	const board = new THREE.Mesh(new THREE.PlaneGeometry(inner, inner), materials.mat);
	board.name = 'mat';
	board.position.z = MAT_Z;
	g.add(board);
	// the backing board: hardboard closing the frame behind the mat, so a
	// frame seen from behind (a middle row's empty face, a wall walked
	// through on the bench) is a closed thing, not a hollow moulding
	const back = new THREE.Mesh(new THREE.PlaneGeometry(inner, inner), materials.back);
	back.name = 'back';
	back.position.z = 0.0005;
	back.rotation.y = Math.PI;                       // faces out of the back
	g.add(back);

	const printed = size * (state.settings.mat === 'none' ? 1 : PRINT_SCALE) * k;
	// The print is **lit**, not painted on (Uli, 2026-09-11: from the side
	// they looked like glowing objects, which they are not). An unlit
	// material keeps its full brightness whatever the light and whatever
	// the angle, so a print seen edge-on stayed bright while its mat, its
	// frame and the wall behind it fell away — the look of something that
	// gives light rather than takes it. Lambert dims with the room and with
	// the angle, as paper does; `emissive` keeps a little of the picture in
	// the dark of a night room, where the pools are all there is.
	const print = new THREE.Mesh(new THREE.PlaneGeometry(printed, printed),
		new THREE.MeshLambertMaterial({ map: photoTexture(p, size), emissive: 0xffffff, emissiveMap: photoTexture(p, size), emissiveIntensity: 0.16 }));
	print.name = 'photo';
	print.position.z = MAT_Z + 0.001;                // a millimetre proud of the mat (Uli)
	print.userData.full = inner / printed;           // what it scales to when pressed: over the mat, edge to edge (Uli)
	if (state.settings.fill) print.scale.setScalar(print.userData.full);   // unless filling the frame is the way round it starts (Uli)
	g.add(print);
	// the shadow that millimetre throws: a faint dark rim just behind the
	// print, a hair larger and pushed down and to the right
	const rim = new THREE.Mesh(new THREE.PlaneGeometry(printed + 0.003, printed + 0.003), materials.rim);
	rim.name = 'photo-shadow';
	rim.position.set(0.0008, -0.0008, MAT_Z + 0.0004);
	g.add(rim);

	// Four bars around the board. Horizontal bars run the full outer width;
	// vertical bars fill between them — the overlap reads as a mitre from
	// any angle the viewer can take. Bars sit flush with the wall at z=0
	// and come 4 cm into the room. Their long edges carry the chamfer.
	const bar = (name, w, h, x, y) => {
		const horizontal = name === 'bar-top' || name === 'bar-bottom';
		const m = new THREE.Mesh(barGeometry(horizontal ? w : h, horizontal ? h : w, FRAME.depth * k, horizontal), materials.frame);
		m.name = name;
		m.position.set(x, y, 0);                       // the bar's back is the wall
		// built with its outer edge at +y: the bottom bar and the right bar are mirrored
		if (name === 'bar-bottom') m.scale.y = -1;
		if (name === 'bar-right') m.scale.x = -1;
		m.castShadow = true;
		m.receiveShadow = true;
		g.add(m);
	};
	// all four the full outer length, mitred at the corners
	const half = inner / 2 + face / 2;
	bar('bar-top',    outer, face, 0,  half);
	bar('bar-bottom', outer, face, 0, -half);
	bar('bar-left',   face, outer, -half, 0);
	bar('bar-right',  face, outer,  half, 0);

	g.userData = { n: p.n, w: outer, h: outer };
	return g;
}

// Two 0.5 mm lines from a piece's top corners up to the ceiling. Their
// length follows from where the piece hangs: centre at HANG_Y, ceiling at H.
// The wires to the ceiling. Every print has its own pair, a grid's as
// well as a single's (Uli, 2026-09-11) — a group hung from two wires at
// its outer edges looked like one board, not like prints. `top` is how
// high the thing's top edge is above the floor; the wires are children of
// it, so they carry its own width.
function addLines(node, w, h, top) {
	const drop = state.settings.H + state.settings.raise - top;
	if (drop <= 0) return;
	const geo = new THREE.PlaneGeometry(0.0012, drop);   // a ribbon: at 0.6 mm no one can tell it from a thread
	for (const x of [-w / 2 + FRAME.face / 2, w / 2 - FRAME.face / 2]) {
		const line = new THREE.Mesh(geo, materials.line);
		line.name = 'line';
		line.position.set(x, h / 2 + drop / 2, FRAME.depth / 2);
		node.add(line);
	}
}

export function makePiece(spec) {
	const piece = new THREE.Group();
	const { photos, size } = spec;
	piece.name = `piece-${photos[0].n}`;
	let w, h;

	if (photos.length === 1) {
		const fp = photos[0].video ? makeVideoPanel(photos[0], size) : makeFramedPrint(photos[0], size);
		piece.add(fp);
		({ w, h } = fp.userData);
	} else {
		const { cols, rows } = spec;
		const cell = framedSize(size), gap = GRID_GAP * sc();
		w = cols * cell + (cols - 1) * gap;
		h = rows * cell + (rows - 1) * gap;
		// Date order reads like the site: left to right, top row first.
		photos.forEach((p, i) => {
			const c = i % cols, r = Math.floor(i / cols);
			const fp = p.video ? makeVideoPanel(p, size) : makeFramedPrint(p, size);
			fp.position.set(-w / 2 + cell / 2 + c * (cell + gap),
			                 h / 2 - cell / 2 - r * (cell + gap), 0);
			piece.add(fp);
			addLines(fp, fp.userData.w, fp.userData.h, pieceY(h) + fp.position.y + fp.userData.h / 2);   // its own wires
		});
	}

	if (photos.length === 1) addLines(piece, w, h, pieceY(h) + h / 2);
	addLabel(piece, spec, w, h);
	// the warm pool on the wall behind, wider than the piece
	const pool = new THREE.Mesh(new THREE.PlaneGeometry(w + 1.4, h + 1.2), poolMaterial);
	pool.name = 'pool';
	pool.position.set(0, 0.1, -0.0005 + 0.0008);
	piece.add(pool);
	Object.assign(piece.userData, { n: photos[0].n, w, h });   // the labels' block (addLabel) is already on it
	return piece;
}

// ---------------------------------------------------------------------------
// A panel plays while it is looked at
//
// The video is light in the room, so it runs only when it has the eye:
// the panel nearest the middle of the view, within LOOK_ANGLE of where
// the head points and LOOK_RANGE metres away, plays; every other panel
// pauses where it stands. Turning away stops it — a room of panels never
// plays more than the one being watched, which is also what the frame
// rate wants. Checked a few times a second, not every frame.
const LOOK_ANGLE = Math.cos(0.35);   // ~20° off the view's centre
const LOOK_RANGE = 9;                // metres
const LOOK_EVERY = 150;              // ms between checks
let lookedAt = 0, lastLook = 0;
const _eye = new THREE.Vector3(), _dir = new THREE.Vector3(), _to = new THREE.Vector3(), _pn = new THREE.Vector3();

export function stepVideos(now) {
	if (!videoCache.size) return;
	if (now - lastLook < LOOK_EVERY) return;
	lastLook = now;
	camera.getWorldPosition(_eye);
	camera.getWorldDirection(_dir);
	const group = scene.getObjectByName('pieces');
	let best = 0, bestDot = LOOK_ANGLE;
	if (group) {
		group.traverse(o => {
			if (o.name !== 'video') return;
			o.getWorldPosition(_pn);
			_to.copy(_pn).sub(_eye);
			const dist = _to.length();
			if (dist > LOOK_RANGE) return;
			const dot = _to.normalize().dot(_dir);
			if (dot > bestDot) { bestDot = dot; best = o.userData.n; }
		});
	}
	if (best === lookedAt) return;
	lookedAt = best;
	for (const [n, v] of videoCache) {
		if (n === best) {
			if (!v.playing) { v.playing = true; v.el.play().catch(() => { v.playing = false; }); }
		} else if (v.playing) {
			v.playing = false;
			v.el.pause();
		}
	}
}
