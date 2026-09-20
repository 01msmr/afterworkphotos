import * as THREE from '../vendor/three.module.js';
import { materials, metal } from 'gallery/frames';
import { t } from 'gallery/lang';
import { renderer } from 'gallery/scene';

// ---------------------------------------------------------------------------
// The console: the lift's floor buttons
//
// Two walnut plates (in the frames' wood) on the cabin's south wall, the
// years down them newest at the top, a year's further rooms to its right,
// the favourites double-width over the topmost (Uli, 2026-09-19, from a
// 2D demo). A button is a black pocket in the plate, brushed steel at its
// bottom and a milky cap standing proud of it, with 1.5 mm corners and
// sides 12 % darker; the years are one atlas the caps wear on their front
// face. Built once (buildConsole) and carried from cabin to cabin
// (elevator.build); light(), press() and the ride's passing() are the
// elevator's, since they follow its state.
// (Out of elevator.js on 2026-09-19.)

export const BUTTON = { w: 0.06, h: 0.03, rise: 0.006, pitchX: 0.07, pitchY: 0.04, gap: 0.002, r: 0.02 };   // the floor buttons: a rectangular cap, its rise off the steel, the grid, the black gap round it; r: the round call and switch buttons
export const PANEL = { low: 1.2, high: 1.8, depth: 0.03, cols: 10, margin: 0.03 };
export const GREEN = 0x46ff7a, MILK = 0xe4e2dc;   // the lit floor; a cap's milky white — a touch greyer than 0xefece4 (Uli, 2026-09-19: slightly more greyish)                                                                                    // the lit floor
const pocketMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 });   // the black gap round a button: a millimetre proud of the plate, two depth steps before it (frames.js, STEPS)
const steelMat = metal.clone(); Object.assign(steelMat, { polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -4 });   // the button's floor, two more

// The print on a button: the year, left-aligned, in Jost Light (loaded
// before the first room, see the start); a split year's floors are
// "2018.1", "2018.2", the suffix smaller on the same baseline (Uli).
// Drawn on a clear canvas: the cap under it shows through.
// The favourites button carries **the sticker**, not a year — it is the one
// floor without one, and the dot says both what the floor is and what fills
// it (Uli, 2026-09-13). The cap behind it does the empty/normal work, so
// this face never changes.
// **It says 'favourites'** (Uli, 2026-09-13, after a day as the dot): the
// word in the years' own face, on a cap two buttons and their margin
// wide, lit in the sticker's red rather than the floors' green.
export const FAV_RED = 0xc8322b, FAV_LIT = 0x5a2a2a;
const FAV_W = BUTTON.w + BUTTON.pitchX;        // two caps and the gap between
// The year on a button cap: a canvas apiece in Jost, on the clear plane
// that takes the press. (A day on the shared distance-field atlas,
// 2026-09-13, and back: its contours crawled in stereo.) **512 x 256 and
// filtered anisotropically** (Uli, 2026-09-13: fuzzy, read sideways): the
// plate stands beside the door and is only ever seen at an angle, and a
// 256 canvas was just the panel's own count at 40 cm — the 512 is drawn
// in the old 256 space, so the numbers mean what they did. 512 KB each,
// thirty-odd of them.
const FACE_PX = 512;
// `wide`: the cap's width in caps — the favourites' word gets a wider one,
// the same face and the same left margin
// **The years are drawn once, into one atlas, and worn by the caps
// themselves** (2026-09-19, the frame rate in the cabin): every button
// used to carry a clear print 1.2 mm before its cap, a transparent draw
// call each and a layer to flicker against — 23 of them at the plate.
// Now the cap's front face samples its cell of a 4096 px atlas (a cell a
// face, the favourites two across), the sides and back a blank cell, and
// the same atlas is the emissive map, so the lit cap's glow leaves the
// letters dark as the print over it did. The letters are drawn as they
// were: a 256-space scaled to FACE_PX, Jost 300, the part after the year
// smaller.
const ATLAS_COLS = 8;
let atlas = null;                               // { tex, cells, rows, entries }: the one the caps wear
const atlasTex = () => atlas && atlas.tex;
function faceAtlas(entries) {
	const cells = [], rows = [];                    // cells: {cx, cy, wide} per entry; a cell is FACE_PX × FACE_PX / 2
	let cx = 1, cy = 0;                             // cell 0 of row 0 stays blank paper, for the sides and the back
	for (const e of entries) {
		if (cx + e.wide > ATLAS_COLS) { cx = 0; cy++; }
		cells.push({ cx, cy, wide: e.wide }); cx += e.wide;
	}
	const nRows = cy + 1;
	const c = document.createElement('canvas'); c.width = ATLAS_COLS * FACE_PX; c.height = nRows * FACE_PX / 2;
	atlas = { cells, rows: nRows, entries, canvas: c };
	drawAtlas();
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = renderer.capabilities.getMaxAnisotropy();
	atlas.tex = t;
	return atlas;
}
// the caps' words drawn again — the favourites in the language chosen
export function relabelConsole() { if (atlas) { drawAtlas(); atlas.tex.needsUpdate = true; } }
function drawAtlas() {
	const { canvas: c, cells, entries } = atlas;
	const g = c.getContext('2d');
	g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
	const font = px => `400 ${px}px Jost, "Helvetica Neue", Arial, sans-serif`;   // regular, black: readable on every cap (Uli)
	entries.forEach((e, i) => {
		const { cx, cy } = cells[i];
		g.save();
		g.translate(cx * FACE_PX, cy * FACE_PX / 2);
		g.scale(FACE_PX / 256, FACE_PX / 256);
		g.fillStyle = g.strokeStyle = '#000'; g.lineJoin = 'round'; g.lineWidth = 2.2;
		g.textAlign = 'left'; g.textBaseline = 'middle';
		g.font = font(56);
		const word = e.room.favs ? t('favourites') : e.year;   // in the language chosen; relabelConsole draws it again on a change
		g.strokeText(word, 36, 66); g.fillText(word, 36, 66);
		// a year's parts are written 2024.2, the favourites' with a space: Favoriten 2 (Uli, 2026-09-20)
		if (e.room.of > 1) { const w = g.measureText(word).width; const part = e.room.favs ? ` ${e.room.part}` : `.${e.room.part}`; g.font = font(45); g.lineWidth = 1.8; g.strokeText(part, 36 + w + 2, 66); g.fillText(part, 36 + w + 2, 66); }
		g.restore();
	});
}
// A cap's UVs pointed at its cell: the front face (normal -z, the one the
// cabin sees) spread over the cell — mirrored in u, since a face looked
// at from -z has its +x on the viewer's left — every other face at the
// blank cell's corner.
function faceUVs(geo, bw, h, cell, rows) {
	geo = geo.clone();
	const P = geo.attributes.position, N = geo.attributes.normal, uv = geo.attributes.uv;
	for (let i = 0; i < P.count; i++) {
		if (N.getZ(i) < -0.5) {
			const u = 0.5 - P.getX(i) / bw, v = P.getY(i) / h + 0.5;
			uv.setXY(i, (cell.cx + u * cell.wide) / ATLAS_COLS, 1 - (cell.cy + 1 - v) / rows);
		} else uv.setXY(i, 0.02 / ATLAS_COLS, 1 - 0.02 / rows);
	}
	uv.needsUpdate = true;
	return geo;
}

// **A button's plan has 1.5 mm corners, and its depth faces are 12 %
// darker than its front** (Uli, 2026-09-18). A rounded rectangle pushed
// out along z and centred on it, like the box it replaces. The darker
// sides are vertex colours — 0.88 where the normal lies in the plane — so
// a cap is still one material and one draw call, and light() goes on
// setting one colour; the lit cap's glow is emissive and stays whole.
const CORNER = 0.0015, SIDE_DARK = 0.88;
function roundedBox(w, h, d, r = CORNER) {
	const x = w / 2, y = h / 2, sh = new THREE.Shape();
	sh.moveTo(-x + r, -y); sh.lineTo(x - r, -y); sh.absarc(x - r, -y + r, r, -Math.PI / 2, 0);
	sh.lineTo(x, y - r); sh.absarc(x - r, y - r, r, 0, Math.PI / 2);
	sh.lineTo(-x + r, y); sh.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI);
	sh.lineTo(-x, -y + r); sh.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5);
	const geo = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false, curveSegments: 4 });
	geo.translate(0, 0, -d / 2);
	const n = geo.attributes.normal, col = new Float32Array(n.count * 3);
	for (let i = 0; i < n.count; i++) col.fill(Math.abs(n.getZ(i)) > 0.5 ? 1 : SIDE_DARK, i * 3, i * 3 + 3);
	geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
	return geo;
}
// the round buttons' bodies are all side: the steel, 12 % darker
export const sideMetal = metal.clone(); sideMetal.color.multiplyScalar(SIDE_DARK);

// Boxes already set in place, welded into one geometry.
function merged(geos) {
	const pos = [], nor = [], uv = [], idx = [];
	let base = 0;
	for (const g of geos) {
		const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, I = g.index;
		pos.push(...P.array); nor.push(...N.array); uv.push(...U.array);
		if (I) for (let i = 0; i < I.count; i++) idx.push(I.getX(i) + base);
		else for (let i = 0; i < P.count; i++) idx.push(i + base);       // an extrusion has no index
		base += P.count;
		g.dispose();
	}
	const out = new THREE.BufferGeometry();
	out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
	out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	out.setIndex(idx);
	return out;
}



// The plates and their buttons, set on the cabin's wall by elevator.build.
// Returns the width of the two plates together, for placing them.
export function buildConsole(elevator, roomList) {
	// The console on the south wall's inner face, beside the door, between
	// hand and eye height: walnut blocks standing on the wall, vertical
	// (Uli), their faces the plates — nothing of them in the wall. **The
	// years run down the plate, newest at the top, in two columns, a
	// plate per column** (Uli, 2026-09-19, from a 2D demo; it was a line
	// per decade, ten across, before): a year's second and third rooms
	// sit to the right of its first, so a column's plate is as wide as
	// its widest year; the favourites floor is a double-width button
	// over the topmost year. The thin years merged into one room each
	// keep a button of their own to it.
	const list = roomList;
	const favRooms = list.filter(r => r.favs);   // one floor, or its parts when the dots outgrew a real room (hang.js) — a line each
	// **Built once, but not for ever** (Uli, 2026-09-20: the favourites were
	// split and the console still carried the one button). The panel is
	// carried from cabin to cabin so a ride costs no canvases — and the
	// floors it was built for can change under it: a dot stuck splits the
	// favourites into parts, a room size re-splits the years. Whenever the
	// list's keys differ from the ones the caps wear, the panel is dropped
	// and made again; while they are the same, nothing is rebuilt.
	// **Two side by side once there are three** (Uli, 2026-09-20): one
	// favourites floor, or two, keeps a line each over the topmost year —
	// a double-wide button, the word reads at a glance. From three on they
	// would be a tower, so they pair up, two to a line, and the plate is
	// as wide as the pair.
	const favPerLine = favRooms.length >= 3 ? 2 : 1;
	const favLines = Math.ceil(favRooms.length / favPerLine);
	const favWide = 2 * favPerLine;
	const keys = list.map(r => r.key).join(' ');
	if (elevator.panel && elevator.panel.userData.keys !== keys) {
		elevator.panel.removeFromParent();
		elevator.panel.traverse(o => { if (o.isMesh) { o.geometry.dispose(); const m = o.material; if (m !== materials.frame) { if (m.map && m.map !== atlasTex()) m.map.dispose(); m.dispose(); } } });
		if (atlas) { atlas.tex.dispose(); atlas = null; }
		elevator.panel = null;
		elevator.buttons = [];
	}
	const byYear = new Map();                      // year -> its rooms, first part first
	for (const r of list) if (!r.favs) for (const y of r.years) byYear.set(y, [...(byYear.get(y) || []), r]);
	const years = [...byYear.keys()].sort((p, q) => Number(q) - Number(p));
	const rowsOf = years.map(y => ({ year: y, rooms: byYear.get(y).sort((p, q) => (p.part || 0) - (q.part || 0)) }));
	const half = Math.ceil(rowsOf.length / 2);
	const columns = [rowsOf.slice(0, half), rowsOf.slice(half)].filter(c => c.length);
	const margin = PANEL.margin, between = 0.02;   // and the gap between two plates
	const plates = columns.map((col, i) => {
		const wide = Math.max(i === 0 && favRooms.length ? favWide : 1, ...col.map(r => r.rooms.length));
		const rows = col.length + favLines;            // the favourites' lines on every plate: the years start on one line across them (Uli, 2026-09-19)
		return { col, wide, rows, w: wide * BUTTON.pitchX + 2 * margin, h: rows * BUTTON.pitchY + 2 * margin };
	});
	for (const p of plates) p.h = Math.max(...plates.map(q => q.h));   // both plates the same height (Uli, 2026-09-19): the shorter column leaves walnut under its last year
	const plateW = plates.reduce((sum, p) => sum + p.w, 0) + between * (plates.length - 1);
	// the block: its face at the panel's z = 0, its back on the skin; the buttons stand proud at -z
	// **The console is built once** (Uli, 2026-09-13: the plate glitched
	// as the doors shut). The cabin is made afresh with every room, at the
	// moment the doors have shut on a ride — and thirty-odd canvases drawn
	// and sent up again in front of the visitor was a hitch on the plate
	// every ride. The panel is the same object from cabin to cabin, only
	// set at the new cabin's wall.
	if (!elevator.panel) {
		const panel = new THREE.Group();
		panel.name = 'panel';
		// facing the south wall the viewer's left is +x: the first plate
		// stands at +x, the next to its right at smaller x, all hung from
		// one top edge
		const plateH = Math.max(...plates.map(p => p.h));
		let x1 = plateW / 2;                       // the running plate's left edge
		for (const p of plates) {
			// **the plates wear the frames' wood** (Uli, 2026-09-19): the same
			// material as the bars, so the wood switch dresses the console too
			const plate = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, PANEL.depth), materials.frame);
			plate.name = 'plate';
			p.x0 = x1; p.y0 = plateH / 2;          // the plate's top left corner, in the panel
			plate.position.set(x1 - p.w / 2, plateH / 2 - p.h / 2, PANEL.depth / 2);
			panel.add(plate);
			x1 -= p.w + between;
		}

		// A button: a black pocket in the plate, brushed steel at its bottom,
		// a **milky white cap** standing proud of it, the year printed on the
		// cap. Lit, the cap glows green (light()). The cap was clear — white
		// at 0.28 over the steel — until 2026-09-13 (Uli: milky, and plain
		// colours for its states, not translucency): thirty-odd translucent
		// caps were thirty-odd things in the transparent queue, sorted and
		// blended every frame, for a look the plate did not need.
		elevator.buttons = [];
		const { w, h, rise, gap } = BUTTON;
		// **The pockets are one mesh, the steels another** (2026-09-13):
		// neither moves — a press dips the cap alone — and forty-six draw
		// calls for them were a quarter of the cabin's.
		const pockets = [], steels = [];
		const sink = (geo, x, y, z, list) => list.push(geo.clone().translate(x, y, z));
		// The face stands 1.2 mm off its cap, not 0.3, and is pushed forward
		// again in the depth buffer (Uli, 2026-09-13: the button plate
		// glitched). Three tenths of a millimetre is finer than a 16-bit
		// depth buffer tells apart at arm's length (vr.js: 'layers'), and
		// the two surfaces flickered against each other, the more so in
		// stereo. **The push is a constant, not a slope**: a slope-scaled
		// offset grows with the viewing angle, and at the grazing angle the
		// plate is passed at on the way in it would pull a year forward
		// through the caps beside it.
		// the faces first, all of them into the atlas, then the buttons
		const entries = [];
		for (const room of favRooms) entries.push({ year: 'favourites', room, wide: 2 });
		for (const p of plates) for (const { year, rooms: rs } of p.col) for (const room of rs) entries.push({ year, room, wide: 1 });
		const atlas = faceAtlas(entries);
		let n = 0;
		// one button, `wide` caps across (the favourites: two), at a cell:
		// its pocket, its steel, and its cap wearing its year
		const geos = new Map();
		const button = (room, x, y, wide = 1) => {
			const bw = w + (wide - 1) * BUTTON.pitchX;
			if (!geos.has(wide)) geos.set(wide, { pocket: roundedBox(bw + 2 * gap, h + 2 * gap, 0.001, CORNER + gap), steel: roundedBox(bw, h, 0.002), cap: roundedBox(bw, h, rise) });
			const G = geos.get(wide);
			sink(G.pocket, x, y, -0.0005, pockets);
			sink(G.steel, x, y, -0.002, steels);
			const cap = new THREE.Mesh(faceUVs(G.cap, bw, h, atlas.cells[n++], atlas.rows), new THREE.MeshStandardMaterial({ color: MILK, map: atlas.tex, vertexColors: true, roughness: 0.45, metalness: 0, emissive: room.favs ? FAV_RED : GREEN, emissiveMap: atlas.tex, emissiveIntensity: 0, envMapIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -6 }));
			cap.name = `cap-${room.key}`;
			cap.userData.key = room.key;
			cap.userData.z0 = -0.003 - rise / 2;   // where it rests: a press dips it in and back
			cap.userData.cap = true;
			if (room.favs) cap.userData.fav = true;
			cap.position.set(x, y, cap.userData.z0);
			panel.add(cap);
			elevator.buttons.push(cap);
		};
		// a cell of a plate: column c (0 at the plate's left), row r (0 at its top)
		const cell = (p, c, r) => ({ x: p.x0 - margin - BUTTON.pitchX * (c + 0.5), y: p.y0 - margin - BUTTON.pitchY * (r + 0.5) });
		plates.forEach((p, i) => {
			let row = favLines;                        // the top lines are the favourites' — filled on the first plate, left empty on the others
			if (i === 0) favRooms.forEach((room, k) => {   // the favourites: two columns wide each, over the topmost year
				const { x, y } = cell(p, 0.5 + 2 * (k % favPerLine), Math.floor(k / favPerLine));
				button(room, x, y, 2);
			});
			for (const { rooms: rs } of p.col) {
				rs.forEach((room, c) => { const { x, y } = cell(p, c, row); button(room, x, y); });
				row++;
			}
		});
		const pm = new THREE.Mesh(merged(pockets), pocketMat); pm.name = 'pockets'; panel.add(pm);
		const sm = new THREE.Mesh(merged(steels), steelMat); sm.name = 'steels'; panel.add(sm);
		panel.userData.keys = keys;   // the floors these caps were made for
		elevator.panel = panel;
	}
	return plateW;
}
