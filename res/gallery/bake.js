import * as THREE from '../vendor/three.module.js';
import { materials, poolMaterial } from './frames.js?v=20260916o';
import { renderer, world } from './scene.js?v=20260916o';
import { state } from './state.js?v=20260916o';

// ---------------------------------------------------------------------------
// Baking a room
//
// Once a room is hung nothing in it moves until the next ride, so the
// parts that share a material — every bar, every mat, rim, line, pool —
// are welded into one mesh each, in world coordinates. What stays its
// own mesh: each print (its own texture) and each label (pressable).

const _nm = new THREE.Matrix3();
function weld(meshes, material, name) {
	const pos = [], nor = [], uv = [];
	for (const m of meshes) {
		m.updateWorldMatrix(true, false);
		const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
		const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
		// into world's own frame, not the scene's: the welded mesh is a child of world
		const rel = new THREE.Matrix4().copy(world.matrixWorld).invert().multiply(m.matrixWorld);
		_nm.getNormalMatrix(rel);
		const v = new THREE.Vector3(), n = new THREE.Vector3();
		// a mirrored mesh (negative scale) has its winding flipped: bake it back
		const flip = rel.determinant() < 0;
		for (let t = 0; t < P.count; t += 3) {
			const order = flip ? [t + 2, t + 1, t] : [t, t + 1, t + 2];
			for (const i of order) {
				v.fromBufferAttribute(P, i).applyMatrix4(rel); pos.push(v.x, v.y, v.z);
				if (N) { n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize(); nor.push(n.x, n.y, n.z); }
				if (U) uv.push(U.getX(i), U.getY(i));
			}
		}
		if (m.geometry.index) g.dispose();
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	if (nor.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
	if (uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	const mesh = new THREE.Mesh(g, material);
	mesh.name = name;
	return mesh;
}

export function bakeRoom(pieces) {
	const baked = new THREE.Group(); baked.name = 'baked';
	const groups = { bars: [], mats: [], backs: [], rims: [], lines: [], pools: [], labelRims: [] };
	pieces.traverse(o => {
		if (!o.isMesh) return;
		if (o.name.startsWith('bar-')) groups.bars.push(o);
		else if (o.name === 'mat') groups.mats.push(o);
		else if (o.name === 'back') groups.backs.push(o);
		else if (o.name === 'photo-shadow') groups.rims.push(o);
		else if (o.name === 'label-shadow') groups.labelRims.push(o);   // the cards' shadows too: 74 draw calls into one; a doubled card covers its own
		else if (o.name === 'line') groups.lines.push(o);
		else if (o.name === 'pool') groups.pools.push(o);
	});
	const add = (list, material, name, shadow) => {
		if (!list.length) return;
		const m = weld(list, material, name);
		m.castShadow = shadow; m.receiveShadow = shadow;
		baked.add(m);
		for (const o of list) o.parent.remove(o);
	};
	add(groups.pools, poolMaterial, 'pools', false);
	const pm = baked.getObjectByName('pools'); if (pm) pm.visible = state.settings.pools;   // the pools switch
	add(groups.mats, materials.mat, 'mats', false);
	add(groups.backs, materials.back, 'backs', false);
	add(groups.rims, materials.rim, 'rims', false);
	add(groups.labelRims, materials.rim, 'label-rims', false);
	const lr = baked.getObjectByName('label-rims'); if (lr) lr.visible = state.settings.labels;   // and go with the labels switch
	add(groups.bars, materials.frame, 'frames', true);
	add(groups.lines, materials.line, 'lines', false);
	return baked;
}

// A small card to the lower right of a piece, two or three lines: the
// number and month, the description, the place (Uli). A grid's card gives
// its range and the first print's words.
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
function labelLines(photos) {
	const a = photos[0], b = photos[photos.length - 1];
	const when = `${MONTHS[Number(a.taken.slice(5, 7)) - 1]} ${a.taken.slice(0, 4)}`;
	const lines = [photos.length === 1 ? `afterworkphoto ${a.n} \u00b7 ${when}` : `afterworkphotos ${a.n}\u2013${b.n} \u00b7 ${when}`];
	if (a.desc) lines.push(a.desc);
	if (a.place) lines.push(a.place);
	return lines;
}
// One label card: the lines drawn at twice the size they were (Uli:
// sharper), 1536 px across, `cw` metres wide. Named 'label' so the labels
// switch and a press (doubling it) find it; x0/y0 remember its place.
// Every card is the same card (Uli, 2026-09-12): three lines' worth of
// paper whether a photograph has a place and a description or neither,
// so a wall of labels is a wall of one size. A line too long for the
// paper is squeezed to fit rather than running off it.
const CARD_LINES = 3;
// **The letters are drawn on a canvas, in Helvetica** (Uli, 2026-09-13,
// back after a day on a distance-field atlas: the atlas held each glyph in
// a 48 px cell, which is magnified on a doubled card and mush across the
// room, and its edges wobbled in stereo — canvas text is the same letter
// the site sets, and it was sharp). 1280 px across (1024 until today):
// a doubled 24 cm card read at 0.7 m spans 38 degrees, 946 panel pixels
// and about 1130 as the browser renders it; 1024 is under that and 1280
// the first size above it. 3.1 MB apiece with its mipmaps, one per
// photograph: 229 MB in the 74-frame room, 147 MB at 1024 — the biggest
// thing in a room's memory, and known to be (Uli: there is the RAM for
// it). The layout below is written in the old 1536 space and scaled, so
// every number the cards were tuned with still means what it did.
const CARD_PX = 1280, CARD_DRAWN = 1536;
const CARD_H = 2 * (80 + 64 * CARD_LINES);       // the paper, in that space
// **A card is 4 mm of board standing off the wall** (Uli, 2026-09-13), not
// a sheet lying on it. Lambert rather than unlit, so its four edges shade
// against its face and the thickness is actually seen — with enough
// emissive that the paper stays paper in a night room, which is what the
// unlit material was for before it had any sides to show. The canvas is
// the board's **front face** — its map and its emissive map both, as a
// print's is, so the ink stays ink at night — paper and letters one
// surface, with nothing standing in front of it to crawl.
export const CARD_D = 0.004;
const CARD_GLOW = 0.5;
// Where a card rests, and where it stands when it is doubled to be read.
// **A doubled card must never end up buried in the wall's own dressing**
// (Uli, 2026-09-13). Measured off the plaster, a wall carries: the dado
// panel at 2 mm, the wainscot at 6, its rail at 12, the skirting at 15 and
// the wainscot's cap at 20 — while a card's back sits on the wall itself.
// A card at rest hangs above all that, but doubled it grows downward and
// reaches into it, and the cap alone is five times the card's thickness.
// It does not have to be moved out of the way: it comes **forward** of the
// lot, 26 mm out, which clears the deepest of them by 5 mm and reads as a
// card lifted toward you to be read — which is what it is.
export const CARD_REST_Z = CARD_D / 2, CARD_READ_Z = 0.026;
const PAPER = '#fdfcfa', INK = ['#141311', '#3d3a36'];   // near-black, a weight up: what the headset's pixels can still resolve is contrast (Uli)
const SIZE = [110, 100];         // 84/76 until 2026-09-13 (Uli: too small). A third bigger buys about a third more distance — a body line is readable at 2 m now rather than 1.5
function cardCanvas(lines) {
	const c = document.createElement('canvas');
	const k = CARD_PX / CARD_DRAWN;
	c.width = CARD_PX; c.height = Math.round(CARD_H * k);
	const g = c.getContext('2d');
	g.scale(k, k);
	g.fillStyle = PAPER; g.fillRect(0, 0, CARD_DRAWN, CARD_H);
	g.textBaseline = 'middle';
	lines.slice(0, CARD_LINES).forEach((line, i) => {
		const j = i === 0 ? 0 : 1;
		g.fillStyle = INK[j];
		g.font = `${j === 0 ? 600 : 500} ${SIZE[j]}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
		const room = CARD_DRAWN - 160;
		const wide = g.measureText(line).width;
		g.save();
		// a line too long for the paper is squeezed to fit rather than running off it
		if (wide > room) { g.translate(80, 0); g.scale(room / wide, 1); g.fillText(line, 0, 2 * (40 + 32 + 64 * i)); }
		else g.fillText(line, 80, 2 * (40 + 32 + 64 * i));
		g.restore();
	});
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = renderer.capabilities.getMaxAnisotropy();
	return t;
}
// **One draw call a card** (2026-09-13). A box with six materials is six
// draw calls, and the 74-frame room spent 444 of them on its labels —
// the biggest single cost of a frame in the headset (66 fps in the
// cabin). One geometry per card size, its five other faces' UVs pointed
// at a spot of bare paper in the canvas's top-left margin, so one
// material with the canvas on it draws the whole board: paper edges, a
// paper back, the card on the front.
const cardGeometries = new Map();
function cardGeometry(cw, ch) {
	const key = `${cw}|${ch}`;
	if (!cardGeometries.has(key)) {
		const geo = new THREE.BoxGeometry(cw, ch, CARD_D);
		geo.clearGroups();                                       // one material for all six faces
		const uv = geo.attributes.uv;                            // faces in order px nx py ny pz nz, four corners each: pz is 16..19
		for (let i = 0; i < uv.count; i++) if (i < 16 || i > 19) uv.setXY(i, 0.02, 0.97);   // paper: inside the left margin, under the top one
		uv.needsUpdate = true;
		cardGeometries.set(key, geo);
	}
	return cardGeometries.get(key);
}
// **The canvas is drawn after the hang, a few cards a frame** (Uli,
// 2026-09-13: the view stuck in the cabin as the doors shut). Seventy
// canvases drawn and 170 MB sent up in the frame the room was hung held
// the headset for a good part of a second; the doors are shut for two
// or three seconds anyway. A card starts with one paper pixel for its
// map — a map, so its program never has to be built twice — and its own
// canvas is swapped in when its turn comes (stepCards).
const PAPER_PX = new THREE.DataTexture(new Uint8Array([0xfd, 0xfc, 0xfa, 255]), 1, 1);
PAPER_PX.colorSpace = THREE.SRGBColorSpace; PAPER_PX.needsUpdate = true;
const CARDS_A_FRAME = 2;
let pending = [];
export function stepCards() {
	for (let n = 0; n < CARDS_A_FRAME && pending.length; n++) {
		const { card, lines } = pending.shift();
		if (!card.parent) continue;                              // the room it belonged to has gone
		const t = cardCanvas(lines);
		renderer.initTexture(t);
		card.material.map = t; card.material.emissiveMap = t;    // no needsUpdate: a map for a map, the defines have not moved
	}
}
export function clearCards() { pending = []; }
function makeCard(lines, cw) {
	const ch = cw * CARD_H / CARD_DRAWN;
	const face = new THREE.MeshLambertMaterial({ map: PAPER_PX, emissive: PAPER, emissiveMap: PAPER_PX, emissiveIntensity: CARD_GLOW });
	const card = new THREE.Mesh(cardGeometry(cw, ch), face);
	pending.push({ card, lines });
	card.name = 'label';
	card.visible = state.settings.labels;
	card.userData.ch = ch;
	// The shadow those 4 mm throw. **Painted, not cast**: real shadows have
	// been off since 2026-09-05 (Uli — the hard cut-outs looked wrong), and
	// a print fakes its own the same way, a faint plane a hair larger nudged
	// down and to the right. A board standing off the wall with nothing
	// under it reads as printed on the wall rather than laid against it.
	const rim = new THREE.Mesh(new THREE.PlaneGeometry(cw + 0.004, ch + 0.004), materials.rim);
	rim.name = 'label-shadow';
	rim.position.set(0.0012, -0.0012, -CARD_D / 2 + 0.0003);   // a hair *in front of* the wall (it sat 0.4 mm inside it and flickered through), under the board's face
	card.add(rim);
	return card;
}
// A piece's labels: a single's one card, a grid's one card per print laid
// out in the grid's own pattern LABEL_GAP apart (Uli). A single's card
// hangs under the frame, 3 cm below it, flush with its right edge. A
// grid's block stands beside the group to its right, its bottom on the
// group's bottom edge (Uli: bottom right, not top) — and goes under it,
// flush right, where the wall has no room beside: the neighbour too
// close, the wall's end too near (never into a corner), or in the middle
// of the room, where the slab reaches down to hold it. Built with the
// spacing known; a grid is placed for good in hangRoom, when the room to
// its right is.
const LABEL_GAP = 0.02, GRID_CARD = 0.16, SINGLE_CARD = 0.24, LABEL_OFF = 0.05;
export function addLabel(piece, spec, w, h) {
	// a row of three or a pair stacks its cards in a column (Uli); a grid keeps its pattern
	// one size of card for everything, a grid's as well as a single's
	// (Uli, 2026-09-12: all the same, whatever is shown on them)
	const grid = spec.photos.length > 1, cw = SINGLE_CARD, cols = grid && spec.rows > 1 ? spec.cols : 1;
	const cards = spec.photos.map(p => { const c = makeCard(labelLines([p]), cw); c.userData.photo = p; return c; });   // the card knows its photograph: the red dot under it is that photograph's (sticker.js)
	const ch = Math.max(...cards.map(c => c.userData.ch));
	const rows = Math.ceil(cards.length / cols);
	piece.userData.labels = { cards, cols, cw, ch, bw: cols * cw + (cols - 1) * LABEL_GAP, bh: rows * ch + (rows - 1) * LABEL_GAP, grid };
	for (const c of cards) piece.add(c);
	placeLabels(piece, w, h, Infinity);
}
// `roomRight`: how far the wall runs on past the piece's right edge.
export function placeLabels(piece, w, h, roomRight, forceBelow = false) {
	const L = piece.userData.labels;
	if (!L) return;
	const below = !L.grid || forceBelow || state.gap < L.bw + 2 * LABEL_OFF || roomRight < L.bw + LABEL_OFF + 0.03;
	// the block's top-left corner: beside with its bottom on the piece's
	// bottom, or under it with its right on the piece's right
	const x0 = below ? w / 2 - L.bw : w / 2 + LABEL_OFF, y0 = below ? -h / 2 - 0.03 : -h / 2 + L.bh;
	L.cards.forEach((card, i) => {
		const col = i % L.cols, row = Math.floor(i / L.cols);
		card.position.set(x0 + col * (L.cw + LABEL_GAP) + L.cw / 2, y0 - row * (L.ch + LABEL_GAP) - card.userData.ch / 2, CARD_REST_Z);   // its back on the wall, its face 4 mm out
		Object.assign(card.userData, { x0: card.position.x, y0: card.position.y, below });
	});
	piece.userData.labelDrop = below ? 0.03 + L.bh : 0;   // what hangs under the frame, for the slab
}
