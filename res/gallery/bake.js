import * as THREE from '../vendor/three.module.js';
import { materials, poolMaterial } from './frames.js?v=20260914s';
import { renderer, world } from './scene.js?v=20260914s';
import { state } from './state.js?v=20260914s';
import { DRAWN, measure, textMesh } from './text.js?v=20260914s';

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
	const groups = { bars: [], mats: [], backs: [], rims: [], lines: [], pools: [] };
	pieces.traverse(o => {
		if (!o.isMesh) return;
		if (o.name.startsWith('bar-')) groups.bars.push(o);
		else if (o.name === 'mat') groups.mats.push(o);
		else if (o.name === 'back') groups.backs.push(o);
		else if (o.name === 'photo-shadow') groups.rims.push(o);
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
	add(groups.mats, materials.mat, 'mats', false);
	add(groups.backs, materials.back, 'backs', false);
	add(groups.rims, materials.rim, 'rims', false);
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
// **The letters come out of the distance-field atlas** (Uli, 2026-09-13),
// not off a canvas of their own. A canvas card was 1.4 MB apiece, one per
// photograph, 81 MB of a single room — and it had only the pixels it was
// drawn with, so it went soft the moment a card was doubled. The atlas is
// one 4 MB texture for the whole gallery, buttons included, and it draws
// a clean edge at any size: a doubled card is now as sharp as a near one.
//
// The card itself is the paper — a plain plane, no texture at all — with
// the text a child of it, so a press that doubles the card carries the
// letters with it. The layout is still written in the 1536-wide space the
// canvases used, so every number the cards were tuned with means what it
// meant.
const CARD_H = 2 * (80 + 64 * CARD_LINES);       // the paper, in that space
// **A card is 4 mm of board standing off the wall** (Uli, 2026-09-13), not
// a sheet lying on it. Lambert rather than unlit, so its four edges shade
// against its face and the thickness is actually seen — with enough
// emissive that the paper stays paper in a night room, which is what the
// unlit material was for before it had any sides to show.
const CARD_D = 0.004, CARD_GLOW = 0.5;
const PAPER = 0xfdfcfa, INK = [0x141311, 0x3d3a36];
const FACE = ['bold', 'medium'];                 // the first line heavier, as it was at 600 against 500
const SIZE = [84, 76];
function makeCard(lines, cw) {
	const ch = cw * CARD_H / DRAWN;
	const card = new THREE.Mesh(new THREE.BoxGeometry(cw, ch, CARD_D),
		new THREE.MeshLambertMaterial({ color: PAPER, emissive: PAPER, emissiveIntensity: CARD_GLOW }));
	card.name = 'label';
	card.visible = state.settings.labels;
	card.userData.ch = ch;
	const unit = cw / DRAWN;
	const rows = lines.slice(0, CARD_LINES).map((line, i) => {
		const k = i === 0 ? 0 : 1;
		const size = SIZE[k], face = FACE[k];
		const room = DRAWN - 160, wide = measure(line, face, size);
		// a line too long for the paper is squeezed to fit rather than
		// running off it — the same squeeze the canvas did
		return { text: line, face, size, colour: INK[k], x: 80, middle: 2 * (40 + 32 + 64 * i), squeeze: wide > room ? room / wide : 1 };
	});
	const text = textMesh(rows, unit, CARD_H);
	text.position.z = CARD_D / 2 + 0.0002;        // on the board's face, a breath proud of it
	card.add(text);
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
		card.position.set(x0 + col * (L.cw + LABEL_GAP) + L.cw / 2, y0 - row * (L.ch + LABEL_GAP) - card.userData.ch / 2, CARD_D / 2);   // its back on the wall, its face 4 mm out
		Object.assign(card.userData, { x0: card.position.x, y0: card.position.y, below });
	});
	piece.userData.labelDrop = below ? 0.03 + L.bh : 0;   // what hangs under the frame, for the slab
}
