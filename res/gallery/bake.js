import * as THREE from '../vendor/three.module.js';
import { materials, poolMaterial, queueUpload } from 'gallery/frames';
import { renderer, scene, world } from 'gallery/scene';
import { state } from 'gallery/state';

// ---------------------------------------------------------------------------
// Baking a room
//
// Once a room is hung nothing in it moves until the next ride, so the
// parts that share a material — every bar, every mat, rim, line, pool —
// are welded into one mesh each, in world coordinates. What stays its
// own mesh: each print (its own texture) and each label (pressable).

const _nm = new THREE.Matrix3();
function weld(meshes, material, name, ranges = null) {
	const pos = [], nor = [], uv = [];
	for (const m of meshes) {
		m.updateWorldMatrix(true, false);
		const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
		if (ranges) ranges.set(m, { start: pos.length / 3, count: g.attributes.position.count, geo: g });
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
		if (m.geometry.index && !ranges) g.dispose();   // kept where a range refers to it
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	if (nor.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
	if (uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	const mesh = new THREE.Mesh(g, material);
	mesh.name = name;
	return mesh;
}
// **A doubled card takes its shadow with it** (Uli, 2026-09-19: the shadow
// stayed on the wall). The cards' shadows are one welded mesh; the weld
// keeps each source's run of vertices (`ranges`), and followCard writes
// the card's own six again from where the card now stands. The source
// mesh is gone from the scene but keeps its local matrix under the card.
const _rel = new THREE.Matrix4(), _v = new THREE.Vector3();
export function followCard(card) {
	const welded = scene.getObjectByName('label-rims'), rim = card.userData.rim;
	const r = welded && welded.userData.ranges && welded.userData.ranges.get(rim);
	if (!r) return;
	card.updateWorldMatrix(true, false);
	_rel.copy(world.matrixWorld).invert().multiply(card.matrixWorld).multiply(rim.matrix);
	const P = welded.geometry.attributes.position, S = r.geo.attributes.position;
	for (let i = 0; i < r.count; i++) { _v.fromBufferAttribute(S, i).applyMatrix4(_rel); P.setXYZ(r.start + i, _v.x, _v.y, _v.z); }
	P.needsUpdate = true;
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
	const add = (list, material, name, shadow, ranges = null) => {
		if (!list.length) return;
		const m = weld(list, material, name, ranges);
		if (ranges) m.userData.ranges = ranges;
		m.castShadow = shadow; m.receiveShadow = shadow;
		baked.add(m);
		for (const o of list) { o.parent.remove(o); if (!o.geometry.userData.shared) o.geometry.dispose(); }   // welded: the originals go
	};
	add(groups.pools, poolMaterial, 'pools', false);
	add(groups.mats, materials.mat, 'mats', false);
	add(groups.backs, materials.back, 'backs', false);
	add(groups.rims, materials.rim, 'rims', false);
	add(groups.labelRims, materials.rim, 'label-rims', false, new Map());   // with its ranges, for followCard
	const lr = baked.getObjectByName('label-rims'); if (lr) lr.visible = state.settings.labels;   // and go with the labels switch
	add(groups.bars, materials.frame, 'frames', true);
	add(groups.lines, materials.line, 'lines', false);
	atlasLabels(pieces);                              // the cards' atlases, one a looking direction
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
// photograph, 229 MB in the 74-frame room, until the one-channel atlases
// (below, 2026-09-20): a quarter of that, four textures a room. The
// layout below is written in the old 1536 space and scaled, so
// every number the cards were tuned with still means what it did.
// **The card a tenth larger** (Uli, 2026-09-20): the letters grew heavier
// and the paper round them wanted to grow with them. 1408 px rather than
// 1280 keeps the pixels per centimetre the doubled card was tuned for.
const CARD_PX = 1408, CARD_DRAWN = 1536;
const CARD_H = 2 * (80 + 64 * CARD_LINES);       // the paper, in that space
export const CARD_PY = Math.round(CARD_H * CARD_PX / CARD_DRAWN);   // 453: a card's rows in the atlas
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
export const CARD_REST_Z = CARD_D / 2, CARD_READ_Z = 0.05;   // doubled: before the frames' 4 cm as well as the wall's dressing (Uli, 2026-09-19: never behind anything)
// **Black, heavier, and a stroke round every letter** (Uli, 2026-09-20: too
// thin, not sharp enough from 1.2 m on). What a card loses with distance
// is not size but darkness: at 2 m a 24 cm card is 140 panel pixels wide,
// the 1280 are folded three times, and a stroke that thin goes grey in
// the folding. Compared on tests/text-demo.html at 1.2, 2 and 3 m: 600/500
// in #141311/#3d3a36 (until today) against 700/600 in black with a 3 px
// stroke — the body lines stay black at 3 m where they were grey. Uli
// took the values halfway between the two.
const PAPER = '#fdfcfa', INK = ['#0a0a09', '#302e2c'], WEIGHT = [650, 550], STROKE = 1.5;   // halfway between the old and the demo's C (Uli, 2026-09-20: the values in between)
const SIZE = [110, 100];         // 84/76 until 2026-09-13 (Uli: too small). A third bigger buys about a third more distance — a body line is readable at 2 m now rather than 1.5
// **One canvas for every card of a looking direction, one byte a pixel**
// (Uli, 2026-09-20). Seventy-four canvases at 1280 × 453 were 229 MB on
// the GPU and as much again in RAM, the canvases kept under their
// textures — the biggest thing in a room, and known (2026-09-13). An
// atlas alone saves nothing (assessed 2026-09-19: the same pixels, plus
// padding); what saves is the format. The ink is grey on paper — the
// warm tint is 2/255, which no panel shows — so a card is one channel
// (RedFormat) and the material reads that channel as grey (greyMaterial).
// A quarter of the bytes; and a room's cards are four textures and four
// uploads, one per direction a piece can face (atlasLabels), not
// seventy-four.
// A card is still drawn one at a time, on the one scratch canvas, two a
// frame after the hang (stepCards; the doors are shut for two or three
// seconds anyway): its red channel is read back, taken from sRGB to
// linear on the way — a one-channel texture has no sRGB decode on the
// GPU — and copied, rows turned over (a canvas runs top-down, a texture
// bottom-up), into its direction's byte array at its cell. When the
// direction's last card is in, the array goes up as one texture through
// the same queue as the photographs (frames.js, stepUploads), and the
// cards' material takes it: map for map, the program built once at the
// bake and never again.
const scratch = document.createElement('canvas');
scratch.width = CARD_PX; scratch.height = CARD_PY;
const sg = scratch.getContext('2d', { willReadFrequently: true });
function drawCard(lines) {
	const g = sg, k = CARD_PX / CARD_DRAWN;
	g.setTransform(k, 0, 0, k, 0, 0);
	g.fillStyle = PAPER; g.fillRect(0, 0, CARD_DRAWN, CARD_H);
	g.textBaseline = 'middle';
	lines.slice(0, CARD_LINES).forEach((line, i) => {
		const j = i === 0 ? 0 : 1;
		g.fillStyle = g.strokeStyle = INK[j]; g.lineWidth = STROKE; g.lineJoin = 'round';
		g.font = `${WEIGHT[j]} ${SIZE[j]}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
		const room = CARD_DRAWN - 160;
		const wide = g.measureText(line).width;
		const ink = (x, y) => { g.fillText(line, x, y); g.strokeText(line, x, y); };
		g.save();
		// a line too long for the paper is squeezed to fit rather than running off it
		if (wide > room) { g.translate(80, 0); g.scale(room / wide, 1); ink(0, 2 * (40 + 32 + 64 * i)); }
		else ink(80, 2 * (40 + 32 + 64 * i));
		g.restore();
	});
	g.setTransform(1, 0, 0, 1, 0, 0);
	return g.getImageData(0, 0, CARD_PX, CARD_PY).data;
}
// sRGB to linear, eight bits to eight: the paper keeps 251 of its 253, the ink's 20 becomes 1
const LINEAR = new Uint8Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LINEAR[i] = Math.round(255 * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); }
const PAPER_LIN = LINEAR[0xfd];
function greyTexture(data, w, h) {
	const t = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
	t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
	t.anisotropy = renderer.capabilities.getMaxAnisotropy();
	return t;
}
const PAPER_R8 = greyTexture(new Uint8Array([PAPER_LIN]), 1, 1);   // one paper pixel: what a card wears until its atlas is up
PAPER_R8.needsUpdate = true;
// A card's material (see CARD_D: the atlas is the board's front face, its
// map and its emissive map both): the one channel read as grey by two
// lines patched into the program — one key, so every direction's
// material is the one program.
function greyMaterial() {
	const m = new THREE.MeshLambertMaterial({ map: PAPER_R8, emissive: PAPER, emissiveMap: PAPER_R8, emissiveIntensity: CARD_GLOW });
	// the shader here still holds its #include lines (they are expanded
	// after this hook), so the two chunks are put in by hand, swizzled
	const grey = chunk => THREE.ShaderChunk[chunk].replace(/texture2D\( (map|emissiveMap), (vMapUv|vEmissiveMapUv) \)/g, 'texture2D( $1, $2 ).rrra');
	m.onBeforeCompile = s => {
		s.fragmentShader = s.fragmentShader
			.replace('#include <map_fragment>', grey('map_fragment'))
			.replace('#include <emissivemap_fragment>', grey('emissivemap_fragment'));
	};
	m.customProgramCacheKey = () => 'grey';
	return m;
}
const paperMaterial = greyMaterial();   // from a card's making to the bake
// **One draw call a card** (2026-09-13). A box with six materials is six
// draw calls, and the 74-frame room spent 444 of them on its labels —
// the biggest single cost of a frame in the headset (66 fps in the
// cabin). One geometry per card size, its five other faces' UVs pointed
// at a spot of bare paper in the card's top-left margin, so one material
// draws the whole board: paper edges, a paper back, the card on the
// front. The bake gives each card its own copy with the UVs moved into
// its cell of the atlas (cellGeometry).
const cardGeometries = new Map();
function cardGeometry(cw, ch) {
	const key = `${cw}|${ch}`;
	if (!cardGeometries.has(key)) {
		const geo = new THREE.BoxGeometry(cw, ch, CARD_D);
		geo.clearGroups();                                       // one material for all six faces
		const uv = geo.attributes.uv;                            // faces in order px nx py ny pz nz, four corners each: pz is 16..19
		for (let i = 0; i < uv.count; i++) if (i < 16 || i > 19) uv.setXY(i, 0.02, 0.97);   // paper: inside the left margin, under the top one
		uv.needsUpdate = true;
		geo.userData.shared = true;                              // one per card size, never disposed with a room
		cardGeometries.set(key, geo);
	}
	return cardGeometries.get(key);
}
function cellGeometry(cw, ch, u0, v0, du, dv) {
	const geo = cardGeometry(cw, ch).clone();
	geo.userData = {};                                           // its own, not shared: it goes with the room
	const uv = geo.attributes.uv;
	for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * du, v0 + uv.getY(i) * dv);
	uv.needsUpdate = true;
	return geo;
}
// The atlases of a room: every card grouped by the way its piece faces —
// eighth turns, so the four walls, the middle rows' two faces and a
// chamfer's own — each direction's cards in columns of a card's width, as
// square as their number allows, never wider than the GPU's largest
// texture. Called at the bake, when every piece has its yaw.
const CARDS_A_FRAME = 1;                        // a draw and its blit are 1.5 ms on the bench (2026-09-20): one a frame, so the headset keeps its frame
let pending = [];
export function atlasLabels(pieces) {
	const dirs = new Map();
	pieces.traverse(o => {
		if (o.name !== 'label') return;
		const key = Math.round(o.parent.rotation.y * 4 / Math.PI) & 7;
		if (!dirs.has(key)) dirs.set(key, { cards: [] });
		dirs.get(key).cards.push(o);
	});
	const maxTex = renderer.capabilities.maxTextureSize;
	for (const dir of dirs.values()) {
		const n = dir.cards.length;
		// as square as the count allows, and inside the GPU's largest
		// texture **both ways**: enough columns that the rows fit too
		const fit = Math.floor(maxTex / CARD_PX), rowsFit = Math.floor(maxTex / CARD_PY);
		const cols = Math.min(fit, Math.max(1, Math.ceil(n / rowsFit), Math.ceil(Math.sqrt(n * CARD_PY / CARD_PX))));
		const W = cols * CARD_PX, H = Math.min(rowsFit, Math.ceil(n / cols)) * CARD_PY;
		Object.assign(dir, { W, H, done: 0, data: new Uint8Array(W * H).fill(PAPER_LIN), material: greyMaterial() });
		// **The labels switch hides the paper, not the card** (Uli, 2026-09-20:
		// the stickers could not be shown with the labels off). A sticker is
		// its card's child, so a card made invisible took its dot with it;
		// the material made invisible leaves the card in the scene, its dot
		// drawn, and only the paper gone (settings.js, press.js, sticker.js).
		dir.material.visible = state.settings.labels;
		dir.tex = greyTexture(dir.data, W, H);
		dir.material.userData.atlas = dir.tex;                   // freed with the room (hang.js, disposeRoom)
		dir.cards.forEach((card, i) => {
			const col = i % cols, row = Math.floor(i / cols);
			card.geometry = cellGeometry(card.userData.cw, card.userData.ch, col * CARD_PX / W, row * CARD_PY / H, CARD_PX / W, CARD_PY / H);
			card.material = dir.material;
			pending.push({ card, dir, col, row });
		});
	}
}
function blit(px, dir, col, row) {
	const x0 = col * CARD_PX, top = (row + 1) * CARD_PY - 1;   // the atlas runs bottom-up, the card top-down
	for (let r = 0; r < CARD_PY; r++) {
		const a = (top - r) * dir.W + x0, s = r * CARD_PX * 4;
		for (let x = 0; x < CARD_PX; x++) dir.data[a + x] = LINEAR[px[s + x * 4]];
	}
}
export function stepCards() {
	for (let n = 0; n < CARDS_A_FRAME && pending.length; n++) {
		const { card, dir, col, row } = pending.shift();
		// a card whose room has gone is not drawn — but it is still counted,
		// or its direction never completes and every card on that wall keeps
		// its one paper pixel for the life of the room
		if (card.parent) blit(drawCard(card.userData.lines), dir, col, row);
		if (++dir.done < dir.cards.length) continue;
		queueUpload(dir.tex, () => { dir.material.map = dir.tex; dir.material.emissiveMap = dir.tex; });   // up in its turn, then on the cards: a map for a map, the defines have not moved
	}
}
export function clearCards() { pending = []; }
function makeCard(lines, cw) {
	const ch = cw * CARD_H / CARD_DRAWN;
	const card = new THREE.Mesh(cardGeometry(cw, ch), paperMaterial);   // bare paper, until the bake gives it its direction's atlas and its cell (atlasLabels)
	card.name = 'label';
	Object.assign(card.userData, { cw, ch, lines });
	// The shadow those 4 mm throw. **Painted, not cast**: real shadows have
	// been off since 2026-09-05 (Uli — the hard cut-outs looked wrong), and
	// a print fakes its own the same way, a faint plane a hair larger nudged
	// down and to the right. A board standing off the wall with nothing
	// under it reads as printed on the wall rather than laid against it.
	const rim = new THREE.Mesh(new THREE.PlaneGeometry(cw + 0.004, ch + 0.004), materials.rim);
	rim.name = 'label-shadow';
	rim.position.set(0.0012, -0.0012, -CARD_D / 2 + 0.0003);   // a hair *in front of* the wall (it sat 0.4 mm inside it and flickered through), under the board's face
	card.add(rim);
	card.userData.rim = rim;                                    // welded away at the bake; found again by followCard
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
// between the cards' columns, and between their rows (Uli: a small gap).
// **A break where a row of pictures ends** (Uli, 2026-09-20, from a
// screenshot): a grid's cards that did not fit beside it fall into one
// column, and there the cards of the first row of pictures and the first
// card of the second ran on at the same 3.5 cm. Cards keep their 3.5 cm;
// where the column crosses from one row of pictures to the next, a
// further LABEL_ROW_BREAK opens — 7 cm in all (Uli; 5.5 first) — so each row's
// cards read as a group.
// (A day earlier every row had been set 6 cm apart — not what was meant.)
const LABEL_GAP = 0.02, LABEL_VGAP = 0.035, LABEL_ROW_BREAK = 0.035, SINGLE_CARD = 0.264, LABEL_OFF = 0.05, CORNER_KEEP = 0.35;   // the card 24 cm until 2026-09-20, a tenth larger since
export function addLabel(piece, spec, w, h) {
	// a row of three or a pair stacks its cards in a column (Uli); a grid keeps its pattern
	// one size of card for everything, a grid's as well as a single's
	// (Uli, 2026-09-12: all the same, whatever is shown on them)
	const grid = spec.photos.length > 1, cw = SINGLE_CARD, cols = grid && spec.rows > 1 ? spec.cols : 1;
	const cards = spec.photos.map(p => { const c = makeCard(labelLines([p]), cw); c.userData.photo = p; return c; });   // the card knows its photograph: the red dot under it is that photograph's (sticker.js)
	const ch = Math.max(...cards.map(c => c.userData.ch));
	const rows = Math.ceil(cards.length / cols);
	piece.userData.labels = { cards, cols, cols0: cols, cw, ch, bw: cols * cw + (cols - 1) * LABEL_GAP, bh: rows * ch + (rows - 1) * LABEL_VGAP, grid };   // (the rows' gap, not the columns'; placeLabels sets it again for the place it finds)   // cols0: the grid's own pattern; cols: as placed
	for (const c of cards) piece.add(c);
	placeLabels(piece, w, h, Infinity);
}
// `roomRight`: how far the wall runs on past the piece's right edge.
export function placeLabels(piece, w, h, roomRight, forceBelow = false) {
	const L = piece.userData.labels;
	if (!L) return;
	// **Where the grid's own pattern does not fit beside the piece, one
	// column does** (Uli, 2026-09-19): the cards stacked down the right
	// side, before they go under the piece at all — a small wall with a
	// six or a four on it kept sending them under
	// (a single column keeps CORNER_KEEP clear beyond it as well: the
	// corner stays empty, and the floor's steel plate stands in the one by
	// the cabin)
	const fits = (cols, keep = 0) => state.gap >= cols * L.cw + (cols - 1) * LABEL_GAP + 2 * LABEL_OFF && roomRight >= cols * L.cw + (cols - 1) * LABEL_GAP + LABEL_OFF + 0.03 + keep;
	const cols = !L.grid || forceBelow ? L.cols0 : fits(L.cols0) ? L.cols0 : fits(1, CORNER_KEEP) ? 1 : L.cols0;
	const below = !L.grid || forceBelow || !fits(cols);
	L.cols = cols;
	const rows = Math.ceil(L.cards.length / cols);
	// folded into one column, a grid's cards cross from one row of pictures to the next every cols0 cards: a break there
	const fold = cols === 1 && L.cols0 > 1, breakOf = i => fold ? Math.floor(i / L.cols0) * LABEL_ROW_BREAK : 0;
	L.bw = cols * L.cw + (cols - 1) * LABEL_GAP; L.bh = rows * L.ch + (rows - 1) * LABEL_VGAP + breakOf(L.cards.length - 1);
	// the block's top-left corner: beside with its bottom on the piece's
	// bottom, or under it with its right on the piece's right
	const x0 = below ? w / 2 - L.bw : w / 2 + LABEL_OFF, y0 = below ? -h / 2 - 0.03 : -h / 2 + L.bh;
	L.cards.forEach((card, i) => {
		const col = i % L.cols, row = Math.floor(i / L.cols);
		card.position.set(x0 + col * (L.cw + LABEL_GAP) + L.cw / 2, y0 - row * (L.ch + LABEL_VGAP) - breakOf(i) - card.userData.ch / 2, CARD_REST_Z);   // its back on the wall, its face 4 mm out
		Object.assign(card.userData, { x0: card.position.x, y0: card.position.y, below });
	});
	piece.userData.labelDrop = below ? 0.03 + L.bh : 0;   // what hangs under the frame, for the slab
}
