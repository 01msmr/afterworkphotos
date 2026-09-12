import * as THREE from '../vendor/three.module.js';
import { bakeRoom, placeLabels } from './bake.js?v=20260916b';
import { addDots, findSpots } from './sticker.js?v=20260916b';
import { placeGuard } from './guard.js?v=20260916b';
import { clearZoom } from './zoom.js?v=20260916b';
import { setWire, wire } from './bench.js?v=20260916b';
import { elevator, roomLabel } from './elevator.js?v=20260916b';
import { FRAME, GRID_GAP, sc, textureCache } from './frames.js?v=20260916b';
import { WALL_STYLES, buildRoom, dadoTop, floorOf, rectRoom, shapeOf, wallColours } from './room.js?v=20260916b';
import { scene, world } from './scene.js?v=20260916b';
import { HANG_MAX, pieceY, state } from './state.js?v=20260916b';
import { framedSize, freeTexturesExcept, freeVideosExcept, makePiece } from './video.js?v=20260916b';
import { BODY_R } from './walk.js?v=20260916b';

// ---------------------------------------------------------------------------
// Hanging a year
//
// The pieces of a year, in date order. The year's group photos are
// pooled (Uli, 2026-09-06 — before, only six or more in a row made a
// grid) and packed into grids of six and four, a row of three or a pair
// — a grid of nine only where one saves a room (Uli, 2026-09-10) — cut
// from the pool in date order so neighbours stay together; a grid takes
// its place in the sequence at its first photo's date. A lone one left
// hangs single at 60; everything judged single hangs at 90.

// How to cut n group photos into grids of 6 and 4, a row of 3 or a pair
// (Uli): the most covered, then — not everything into the largest (Uli)
// — a mix: sixes and fours in balance (one more of either still is),
// then the fewest grids; on a full tie the walk's first, with the larger
// sizes. So 6 → 6, 8 → 6+2, 9 → 6+3, 12 → 6+4+2. A grid of nine only
// when `nines` allows one (Uli, 2026-09-10: fewer nines — one at most,
// and only when it saves a room), and then it is taken when it costs no
// coverage: 9 → 9, 10 → 6+4, 12 → 9+3, 15 → 9+6. Only one can be left.
const GRIDS = { 9: [3, 3], 6: [3, 2], 4: [2, 2], 3: [3, 1], 2: [2, 1] };   // cols, rows
const SIZES = [9, 6, 4, 3, 2];
export function packRun(n, nines = 0) {
	let best = null;
	const better = (a, b) => !b || a.covered > b.covered || (a.covered === b.covered && (a.c9 > b.c9 || (a.c9 === b.c9 && (a.skew < b.skew || (a.skew === b.skew && a.grids < b.grids)))));
	const walk = (k, left, counts, covered, grids) => {
		if (k === SIZES.length) { const c = { counts: { ...counts }, covered, grids, c9: counts[9], skew: Math.max(0, Math.abs(counts[6] - counts[4]) - 1) }; if (better(c, best)) best = c; return; }
		const g = SIZES[k];
		for (let c = Math.min(Math.floor(left / g), g === 9 ? nines : n); c >= 0; c--) { counts[g] = c; walk(k + 1, left - g * c, counts, covered + g * c, grids + c); }
	};
	walk(0, n, {}, 0, 0);
	return best.counts;
}
// A year's group photos in pools: cut where six weeks or more lie
// between two of them, so a grid never spans a season — a pool too small
// for a pair joins the one before.
const POOL_GAP_DAYS = 45;
function poolsOf(group) {
	const pools = [];
	for (const p of group) {
		const last = pools[pools.length - 1];
		if (last && (Date.parse(p.taken) - Date.parse(last[last.length - 1].taken)) / 86400000 < POOL_GAP_DAYS) last.push(p);
		else pools.push([p]);
	}
	for (let i = 1; i < pools.length; i++) if (pools[i].length < 2) { pools[i - 1].push(...pools[i]); pools.splice(i, 1); i--; }
	return pools;
}

// `loose`: every LOOSE_EVERY-th group photo of the year hangs as a 60 cm
// single instead of going into a grid — a room with space to spare shows
// a few of them on their own (Uli); rooms() tries this first and keeps it
// when the year still fits one floor. `nines`: how many grids of nine
// the year may have — none, or one, which the first pool able to use it
// takes (Uli, 2026-09-10: only the first nine, and only when it saves a
// room; rooms() decides that).
const LOOSE_EVERY = 5;
export function piecesOf(photos, loose = false, nines = 0) {
	const specs = photos.filter(p => p.hang !== 'group').map(p => ({ photos: [p], size: 0.9 }));
	const group = photos.filter(p => p.hang === 'group');
	if (loose) for (let i = LOOSE_EVERY - 1; i < group.length; i += LOOSE_EVERY) specs.push({ photos: [group[i]], size: 0.6 });
	const pooled = loose ? group.filter((_, i) => (i + 1) % LOOSE_EVERY) : group;
	for (const pool of poolsOf(pooled)) {
		const counts = packRun(pool.length, nines);
		nines -= counts[9];
		let i = 0;
		for (const g of SIZES) for (let c = 0; c < counts[g]; c++) {
			const [cols, rows] = GRIDS[g];
			specs.push({ photos: pool.slice(i, i + g), size: 0.4, cols, rows });
			i += g;
		}
		for (; i < pool.length; i++) specs.push({ photos: [pool[i]], size: 0.6 });
	}
	return specs.sort((a, b) => a.photos[0].taken.localeCompare(b.photos[0].taken));
}

// The elevator's corner is reserved: +x, -z, a 1.5 m square — room to stand
// in and turn round (Uli: enough place inside).
export const ELEVATOR = { size: 1.5 };
const WALL_MARGIN = 0.6;    // from a wall's end or the elevator: the corners stay empty (Uli)
const GAP = 1.2;            // gallery spacing between pieces
const GAP_MIN = 0.6;        // how tight the walls go before the middle fills — never crammed side by side (Uli)
const WALL_FULL = 0.9;      // and how tight they go before the middle is used at all (Uli: no long wall left empty)
const SHORT_RUN = 2.2;      // a wall this short would hold nothing at 60 cm margins
const SHORT_MARGIN = 0.25;  // what it keeps at its ends instead (Uli: use the small walls too)
const SHORT_LOOKAHEAD = 12; // and how far down the queue it looks for something that fits
const OFF_WALL = 0.001;     // a hair off the plaster, so the frame's back does not z-fight

// Each wall as a run the cursor walks along: the cabin's south face, then
// the outline's edges in order — clockwise from the elevator, the east
// wall (southward) first, the north wall (eastward, ending at the
// elevator) last, the cabin's 1.5 m cut off both. For a run: its start
// point, the unit direction the cursor moves in, the yaw a piece faces
// the room with (from the edge's inward normal: east −π/2, south π, west
// π/2, north 0, a chamfer between), and its length.
function wallRuns(shape) {
	const e = ELEVATOR.size, { W, D, outline } = shape, n = outline.length;
	// the cabin's south face first (Uli): plastered like the walls, room for one print
	const runs = [{ name: 'cabin', start: [W / 2, -D / 2 + e + 0.012], dir: [-1, 0], yaw: 0, len: e, margin: 0.15 }];   // faces +z, into the room, like the north wall
	outline.forEach((p, i) => {
		const q = outline[(i + 1) % n], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
		const dx = (q[0] - p[0]) / len, dz = (q[1] - p[1]) / len, cut = i === 0 ? e : 0;
		const yaw = Math.atan2(-dz || 0, dx || 0);                      // (|| 0: no −0, which would turn π into −π)
		const name = { 0: 'n', 1: 'w', 2: 's', '-1': 'e' }[Math.round(yaw / (Math.PI / 2))] || 'chamfer';
		runs.push({ name, start: [p[0] + dx * cut, p[1] + dz * cut], dir: [dx, dz], yaw, len: len - cut - (i === n - 1 ? e : 0) });
	});
	return runs;
}

// Lay pieces (with their widths) along the walls at a given gap; whatever
// does not fit comes back for the middle of the room.
// Which of the `pieces` still to hang go on a run of `len` at `gap`, and
// where: taken in order, one ahead in the queue pulled forward when the
// next does not fit but it does (LOOKAHEAD places at most), and the ones
// that fit spread evenly (Uli: the ways between were uneven), the room
// left over shared out between them and the two ends alike. Returns the
// pieces taken, in wall order.
const LOOKAHEAD = 3;
// A pair of small prints hangs side by side, but on a piece of wall too
// narrow for that it stands upright instead — one over the other (Uli,
// 2026-09-10). Its width is then one print's, its height two. Only a
// pair turns: a row of three upright would reach past the line.
// A grid of four or more small prints wants air round it: 40 cm of bare
// wall on either side (Uli, 2026-09-10), which is why one cannot stand on
// the cabin's 1.5 m face and goes to a wide wall instead. It is a
// **minimum, not an addition** (Uli, 2026-09-11: long walls stood near
// empty): the gallery's own spacing never goes under 60 cm, so on an
// ordinary wall the air is already there and the grid asks for no more
// room than it takes. Only where a wall's margin is tighter than that —
// a short wall, the cabin's face — does it claim the difference.
const SIDE_ROOM = 0.4;
const sideRoom = p => (p.photos && p.photos.length >= 4 ? SIDE_ROOM : 0);
const runWidth = (p, margin = WALL_MARGIN) => p.w + 2 * Math.max(0, sideRoom(p) - margin);
function uprightWidth(p) {
	return p.photos && p.photos.length === 2 && p.cols === 2 && p.rows === 1 ? specWidth({ ...p, cols: 1, rows: 2 }) : 0;
}
export function upright(p) { return { ...p, cols: 1, rows: 2, w: uprightWidth(p) }; }
// `budget`: at most this much picture on this wall, so the room's walls
// share what there is to hang (layWalls) — the positions still spread
// over the whole wall.
export function spread(pieces, len, gap, margin, lookahead = LOOKAHEAD, budget = Infinity) {
	const taken = [], up = [], widths = []; let total = 0;
	const room = Math.min(len - 2 * margin, budget);
	const fits = w => w > 0 && (taken.length ? total + gap : 0) + w <= room;
	for (;;) {
		let pick = -1, stood = false;
		for (let k = 0; k < Math.min(lookahead + 1, pieces.length); k++) {
			if (fits(runWidth(pieces[k], margin))) { pick = k; stood = false; break; }
			if (fits(uprightWidth(pieces[k]))) { pick = k; stood = true; break; }
		}
		if (pick < 0) break;
		const p = pieces.splice(pick, 1)[0], w = stood ? uprightWidth(p) : runWidth(p, margin);
		total += (taken.length ? gap : 0) + w; taken.push(p); up.push(stood); widths.push(w);
	}
	const free = len - 2 * margin - total, even = taken.length ? free / (taken.length + 1) : 0;
	const at = []; let cursor = margin + even;
	widths.forEach(w => { at.push(cursor + w / 2); cursor += w + gap + even; });
	return { taken, at, up };
}
// The walls take the grids first, then the singles, each in date order
// (Uli: groups on the walls, the big prints back to back in the middle).
// `limit`: at most that many pieces on the walls (the parity fix in layout).
function layWalls(pieces, shape, gap, limit = Infinity) {
	const placed = [], queue = [...pieces.filter(p => p.photos.length > 1), ...pieces.filter(p => p.photos.length === 1)];
	// a short wall keeps a smaller margin at its ends, or nothing at all
	// would stand on it (Uli, 2026-09-10: a small wall edge takes two small
	// frames, one over the other)
	const marginOf = r => r.margin ?? (r.len < SHORT_RUN ? SHORT_MARGIN : WALL_MARGIN);
	const usable = r => Math.max(0, r.len - 2 * marginOf(r));
	const wantOf = q => q.reduce((s, p) => s + runWidth(p), 0) + gap * Math.max(0, q.length - 1);
	const runs = wallRuns(shape);
	runs.forEach((run, i) => {
		// Every wall takes its share, so the room hangs evenly instead of
		// one wall crammed and the next bare (Uli, 2026-09-10): of what is
		// still to hang, this wall's part of the wall still to come — or
		// more, where the walls after it could not hold the rest.
		const later = runs.slice(i + 1).reduce((s, r) => s + usable(r), 0);
		const want = wantOf(queue), mine = usable(run);
		const budget = mine + later > 0 ? Math.max(want * mine / (mine + later), want - later) : 0;
		const short = run.len < SHORT_RUN;
		const margin = marginOf(run);
		// a short wall looks further down the queue for something that fits
		const { taken, at, up } = spread(queue.slice(0, Math.max(0, limit - placed.length)), run.len, gap, margin, short ? SHORT_LOOKAHEAD : LOOKAHEAD, budget);
		for (const q of taken) queue.splice(queue.indexOf(q), 1);
		taken.forEach((q, k) => {
			const p = up[k] ? upright(q) : q;
			const t = at[k];
			const x = run.start[0] + run.dir[0] * t;
			const z = run.start[1] + run.dir[1] * t;
			// step off the wall along the piece's facing direction
			const nx = Math.sin(run.yaw), nz = Math.cos(run.yaw);
			placed.push({ piece: p, x: x + nx * OFF_WALL, z: z + nz * OFF_WALL, yaw: run.yaw, wall: run.name, roomLeft: t - p.w / 2, roomRight: run.len - (t + p.w / 2) });
		});
	});
	return { placed, rest: queue };
}

// The middle of the room: rows down each rect's longer side, pieces back
// to back so each slot shows a face to either side, walkways of WALKWAY
// between rows and to the walls. A 4 m room takes two rows; every
// further 1.2 m of depth adds one.
const WALKWAY = 1.2;        // (Uli, 2026-09-10: like a real gallery — every way between rows at least 1.2)
// The rows share the depth evenly with the walls (Uli, 2026-09-06: the
// walking space alike everywhere): n rows at depth / (n + 1), as offsets
// from the near side; under two walkways across, none.
function middleRows(depth) {
	const n = Math.floor(depth / WALKWAY) - 1;
	return Array.from({ length: Math.max(0, n) }, (_, i) => (i + 1) * depth / (n + 1));
}
// The keep-out at the lift (Uli, 2026-09-10: no frame where one steps out
// of the elevator, least of all on the left, where the room is entered) —
// two rectangles, no middle piece in either:
//   the cabin and the exit square west of it, a walkway to the south and
//   the sides, so the left hand stays clear and the cabin's own print has
//   its viewing distance;
//   and, only straight out of the doors — in line with the exit square —
//   a walkway west of it as well.
// A row further south than the exit square keeps its length instead
// (Uli, 2026-09-10, from the top views: the mix of the two).
function keepOut({ W, D }) {
	const e = ELEVATOR.size, w = WALKWAY;
	return [
		{ x0: W / 2 - 2 * e,     x1: W / 2 + w,       z0: -D / 2 - w, z1: -D / 2 + e + w },
		{ x0: W / 2 - 2 * e - w, x1: W / 2 - 2 * e,   z0: -D / 2 - w, z1: -D / 2 + e     },
	];
}
// Along a row's line — points (s, c) in the row's along/across
// coordinates — the interval of s within `m` of the edge p→q (the edge's
// points in the same coordinates), or null: the line's cut through the
// capsule round the edge, one interval since the capsule is convex — the
// strip along the edge and the discs at its ends, hulled.
function nearEdge(p, q, c, m) {
	const len = Math.hypot(q[0] - p[0], q[1] - p[1]), da = (q[0] - p[0]) / len, dc = (q[1] - p[1]) / len;
	const lin = (k, b, lo, hi) => Math.abs(k) < 1e-9 ? (b > lo && b < hi ? [-Infinity, Infinity] : null) : [(lo - b) / k, (hi - b) / k].sort((x, y) => x - y);
	const t = lin(da, (c - p[1]) * dc - p[0] * da, 0, len), h = lin(-dc, p[0] * dc + (c - p[1]) * da, -m, m);   // along the edge, off it
	const parts = t && h && Math.max(t[0], h[0]) < Math.min(t[1], h[1]) ? [[Math.max(t[0], h[0]), Math.min(t[1], h[1])]] : [];
	for (const e of [p, q]) if (Math.abs(e[1] - c) < m) { const r = Math.sqrt(m * m - (e[1] - c) ** 2); parts.push([e[0] - r, e[0] + r]); }
	return parts.length ? [Math.min(...parts.map(v => v[0])), Math.max(...parts.map(v => v[1]))] : null;
}

const SLAB = { thick: 0.08, edge: 0.08 };   // behind a middle-row grid: its thickness, and how far past the group on every edge (Uli)
function layMiddle(rest, shape, gap) {
	const placed = [], ko = keepOut(shape), m = WALL_MARGIN;
	// what the walls did not take — back into date order (Uli, 2026-09-10:
	// neighbours in time side by side), since the walls take the grids
	// first and the singles after, which leaves the rest shuffled
	const pieces = [...rest].sort((a, b) => a.photos[0].taken.localeCompare(b.photos[0].taken));
	let i = 0;
	// rect by rect, largest first: rows along its longer side (an x-row's
	// pieces face ±z, a z-row's ±x), spread over its length
	for (const r of shape.rects) {
		const alongX = r.x1 - r.x0 >= r.z1 - r.z0, ac = ([x, z]) => alongX ? [x, z] : [z, x];   // a point as (along, across)
		const [a0, c0] = ac([r.x0, r.z0]), [a1, c1] = ac([r.x1, r.z1]);
		const kos = ko.map(k => { const [k0, kc0] = ac([k.x0, k.z0]), [k1, kc1] = ac([k.x1, k.z1]); return { k0, k1, kc0, kc1 }; });
		for (const across of middleRows(c1 - c0)) {
			const c = c0 + across;
			// the run: the rect's length less WALL_MARGIN at both ends, less
			// what comes within WALL_MARGIN of an outline edge (a chamfer, a
			// wall), less the keep-out's span when the row's footprint reaches
			// into it — the longest stretch left
			const cuts = shape.outline.map((p, k) => nearEdge(ac(p), ac(shape.outline[(k + 1) % shape.outline.length]), c, m)).filter(Boolean);
			for (const k of kos) if (c + SLAB.thick / 2 > k.kc0 && c - SLAB.thick / 2 < k.kc1) cuts.push([k.k0, k.k1]);
			let runs = [[a0 + m, a1 - m]];
			for (const [lo, hi] of cuts) runs = runs.flatMap(([s0, s1]) => [[s0, Math.min(s1, lo)], [Math.max(s0, hi), s1]].filter(([u, v]) => v > u));
			if (!runs.length) continue;
			const [s0, s1] = runs.reduce((best, s) => s[1] - s[0] > best[1] - best[0] ? s : best);
			// The row's slots, each a pair back to back, as wide as its wider
			// piece and spread evenly. Which pair, though, follows the walk
			// (Uli, 2026-09-10: neighbours in time side by side, not back to
			// back): the front of the row carries one date after another as
			// you walk along it, and the back carries the next ones in the
			// order you meet them coming round the end — so the row reads on
			// as a serpentine instead of hiding tomorrow behind today.
			// How many slots: as many as the run takes, tried from the most
			// down, since a slot is only as wide as the pair it ends up with.
			const left = pieces.length - i;
			if (!left) continue;
			let fit = null;
			for (let m = Math.ceil(left / 2); m >= 1 && !fit; m--) {
				const front = pieces.slice(i, i + m), back = pieces.slice(i + m, i + 2 * m).reverse();
				const slots = front.map((f, k) => ({ w: Math.max(f.w, back[k] ? back[k].w : 0), photos: [] }));
				const { taken, at } = spread(slots, s1 - s0, gap, 0, 0);
				if (taken.length === m) fit = { front, back, at };
			}
			if (!fit) continue;
			fit.front.forEach((a, k) => {
				const b = fit.back[k], s = s0 + fit.at[k];
				// a slot with a grid gets a slab (Uli): a wall-like block behind,
				// SLAB thick, the pair hanging on its two faces so nothing shows
				// through the grid's gaps; two singles hang back to back as before
				const slab = a.photos.length > 1 || (b && b.photos.length > 1);
				const off = slab ? SLAB.thick / 2 : FRAME.depth / 2;
				const put = (p, yaw, d) => placed.push({ piece: p, x: alongX ? s : c + d, z: alongX ? c + d : s, yaw, wall: 'mid', slab });
				put(a, alongX ? 0 : Math.PI / 2, off);                 // faces +z (south), or +x (east) in a z-row
				if (b) put(b, alongX ? Math.PI : -Math.PI / 2, -off);  // faces -z, or -x
			});
			i += fit.front.length + fit.back.length;
		}
	}
	return { placed, rest: pieces.slice(i) };
}

function yearOf(p) { return p.taken.slice(0, 4); }

// A piece's overall width from its spec alone, so rooms can be planned
// before a single mesh exists.
function specWidth(spec) {
	if (spec.photos.length === 1) return framedSize(spec.size);
	return spec.cols * framedSize(spec.size) + (spec.cols - 1) * GRID_GAP * sc();
}
function specHeight(spec) {
	if (spec.photos.length === 1) return framedSize(spec.size);
	return spec.rows * framedSize(spec.size) + (spec.rows - 1) * GRID_GAP * sc();
}

// Lay pieces into a room of the shape: gallery spacing first; when the
// walls run out, the spacing tightens; then the middle of the room takes
// the rest. Returns the placements and whatever still did not fit.
const GAP_MAX = 2.5;        // a sparse room spreads out this far, no further

function layout(items, shape) {
	let gap = GAP, walls, middle;
	for (;;) {
		walls = layWalls(items, shape, gap);
		middle = layMiddle(walls.rest, shape, gap);
		// The walls come first. Before this, the middle rows took whatever
		// the walls turned away at the gallery's own 1.2 m, and a seven-metre
		// wall could stand with two prints on it while the room's groups
		// filled the middle (Uli, 2026-09-11). So the spacing tightens — to
		// WALL_FULL, no further, or they would be crammed — while anything is
		// still being handed on, and only then does the middle take the rest.
		const handedOn = walls.rest.length && gap > WALL_FULL;
		if ((!middle.rest.length && !handedOn) || gap <= GAP_MIN) break;
		gap = Math.max(GAP_MIN, gap - 0.1);
	}
	// An odd number in the middle leaves a slab with a bare back (Uli: no
	// empty walls): one piece fewer on the walls makes it even, when the
	// middle has room for it.
	if (!middle.rest.length && middle.placed.length % 2 && walls.placed.length) {
		const w2 = layWalls(items, shape, gap, walls.placed.length - 1), m2 = layMiddle(w2.rest, shape, gap);
		if (!m2.rest.length) { walls = w2; middle = m2; }
	}
	// A thin room uses the whole perimeter (Uli: no two lonely prints in a
	// corner): while everything still fits on the walls, widen the spacing.
	if (!walls.rest.length && gap === GAP) {
		for (let g = GAP + 0.1; g <= GAP_MAX + 1e-9; g += 0.1) {
			const w = layWalls(items, shape, g);
			if (w.rest.length) break;
			walls = w; gap = g;
		}
		middle = { placed: [], rest: [] };
	}
	return { placed: [...walls.placed, ...middle.placed], rest: middle.rest, gap };
}

// ---------------------------------------------------------------------------
// Rooms
//
// One room per year — unless the year does not fit the room even with the
// spacing tightened and the middle full; then it splits into two rooms by
// date, the later half hanging in the second (Uli, 2026-08-28). Each room
// is a floor of the elevator: key "2018" or "2018-1" / "2018-2", the
// newest room at the top. Planned from widths only; meshes come at hanging.

let roomList = null;
// Every year re-planned: the lift and the real room drop the list (a
// module cannot assign another's binding).
export function clearRooms() { roomList = null; }

export function rooms() {
	if (roomList) return roomList;
	const byYear = new Map();
	for (const p of state.photos) {
		if (!byYear.has(yearOf(p))) byYear.set(yearOf(p), []);
		byYear.get(yearOf(p)).push(p);
	}
	// Thin years (a handful of pieces) share a floor with their neighbours
	// (Uli): consecutive years of at most THIN pieces merge into one room,
	// keyed "2009_2014", named by its first and last year.
	const THIN = 5;
	// A year's four hangings, in the order they are tried for one floor:
	// loose, packed, and each again with a grid of nine (Uli, 2026-09-10:
	// a nine only when it saves a room). A thin year has a handful of
	// pieces, never nine group photos; its sets with a nine are the same.
	const SETS = { loose: [true, 0], packed: [false, 0], loose9: [true, 1], packed9: [false, 1] };
	const setsOf = photos => Object.fromEntries(Object.entries(SETS).map(([k, [loose, nines]]) => [k, piecesOf(photos, loose, nines).map(s => ({ ...s, w: specWidth(s) }))]));
	const years = [...byYear.entries()].map(([year, photos]) => ({ year, photos, sets: setsOf(photos) }));
	const merged = [];
	for (const y of years) {
		const last = merged[merged.length - 1];
		if (last && last.thin && y.sets.packed.length <= THIN) {
			last.years.push(y.year); for (const k in SETS) last.sets[k].push(...y.sets[k]);
			continue;
		}
		merged.push({ years: [y.year], sets: y.sets, thin: y.sets.packed.length <= THIN });
	}
	roomList = [];
	for (const m of merged) {
		const year = m.years[0], span = m.years.length > 1 ? `${m.years[0]}\u2013${m.years[m.years.length - 1]}` : year;
		const one = shapeOf(m.years.join('_'));
		// one floor: the first of the four sets that fits
		const fitsOne = set => !layout([...set].reverse(), one).rest.length;
		const single = Object.keys(SETS).map(k => m.sets[k]).find(fitsOne);
		if (single) {
			const key = m.years.join('_');
			roomList.push({ key, year, span, years: m.years, part: 0, of: 1, specs: single, shape: one });
			continue;
		}
		// as many rooms as it takes: two, or more in a small real room \u2014
		// packed, with the nine only when that makes fewer of them
		const partsOf = specs => {
			let parts = 2;
			for (; parts <= 8; parts++) {
				const per = Math.ceil(specs.length / parts);
				const fits = Array.from({ length: parts }, (_, i) => specs.slice(i * per, (i + 1) * per))
					.every((slice, i) => !layout([...slice].reverse(), shapeOf(`${year}-${i + 1}`)).rest.length);
				if (fits || !state.real) break;               // a synthetic room may still grow; a real one must fit
			}
			return Math.min(parts, 8);
		};
		let specs = m.sets.packed, parts = partsOf(specs);
		const parts9 = partsOf(m.sets.packed9);
		if (parts9 < parts) { specs = m.sets.packed9; parts = parts9; }
		const per = Math.ceil(specs.length / parts);
		for (let i = 0; i < parts; i++) {
			const part = i + 1, key = `${year}-${part}`, slice = specs.slice(i * per, (i + 1) * per);
			if (!slice.length) continue;
			roomList.push({ key, year, span, years: m.years, part, of: parts, specs: slice, shape: shapeOf(key) });
		}
	}
	// newest room first: by year, then the later part
	roomList.sort((a, b) => b.year.localeCompare(a.year) || b.part - a.part);
	// **The favourites floor, one above the newest year** (Uli, 2026-09-13):
	// the photographs the visitor has stuck a red dot on, hung like any
	// other floor. It is always in the list — its button is there whether
	// or not anything is on it, dark and dead until the first dot (Uli:
	// darker than a visited floor, not lit; normal once there are any; and
	// never shown as visited at all). `year` sorts it above every real one.
	const favs = state.photos.filter(p => state.favs.has(p.id));
	const fspecs = favs.length ? piecesOf(favs, false, 0).map(sp => ({ ...sp, w: specWidth(sp) })) : [];
	roomList.unshift({ key: FAV_KEY, year: '9999', span: 'favourites', years: [], part: 0, of: 1,
		specs: fspecs, shape: shapeOf(FAV_KEY), favs: true, empty: !favs.length });
	return roomList;
}
// the favourites floor's key, known to the lift and the label stickers
export const FAV_KEY = 'favorites';
// Where a visitor lands, and what a step up or down may reach: the
// newest **year**, never the favourites floor. It sorts to the top of
// the list because it is the top floor, but it may hold nothing, and
// arriving in an empty room is no arrival at all (Uli, 2026-09-13).
export function firstRoom() { return rooms().find(r => !r.favs) || rooms()[0]; }
// the floors you can actually go to: the favourites one only once a dot is on it
export function openRooms() { return rooms().filter(r => !r.empty); }

export function roomByKey(key) {
	const r = rooms().find(r => r.key === key);
	if (!r) throw new Error(`no room ${key}`);
	return r;
}

// The pool a spot throws reaches POOL_SPILL past the piece on every side
// (makePiece). Where the wall ends sooner — a corner, the cabin's face —
// the pool ends with it, and moves over so it still sits under its piece.
const POOL_SPILL = 0.7;
function clipPool(pool, w, h, left = Infinity, right = Infinity) {
	const l = Math.max(0, Math.min(POOL_SPILL, left)), r = Math.max(0, Math.min(POOL_SPILL, right));
	if (l >= POOL_SPILL && r >= POOL_SPILL) return;
	pool.geometry.dispose();
	pool.geometry = new THREE.PlaneGeometry(w + l + r, h + 1.2);
	pool.position.x = (r - l) / 2;
}

export function hangRoom(key) {
	clearZoom();                                   // nothing left large belongs to the room that goes
	const room = roomByKey(key);
	const H = state.settings.H + state.settings.raise;   // the height switch: a metre more, over every floor (Uli)
	for (const name of ['pieces', 'baked']) {
		const old = scene.getObjectByName(name);
		if (old) { old.traverse(o => { if (o.isMesh && o.parent === old) o.geometry.dispose(); }); old.parent.remove(old); }
	}
	const pieces = new THREE.Group(); pieces.name = 'pieces';

	// newest first from the elevator
	const items = [...room.specs].reverse();

	// The settings' room is the room. Should half a year still not fit it
	// (it does not happen with this collection), the room grows in steps
	// of the same proportion rather than dropping a print — and says so.
	let shape = room.shape;
	let lay = layout(items, shape);
	while (lay.rest.length && shape.W < 40 && !state.real) {      // real walls do not grow
		shape = rectRoom(shape.W + 1.5, shape.D + 1);
		lay = layout(items, shape);
	}
	const { W, D } = shape;
	if (W !== room.shape.W) console.warn(`${key}: room grown to ${W} × ${D} to hang everything`);
	if (lay.rest.length) console.warn(`${key}: ${lay.rest.length} pieces do not fit the real room`);
	const floor = floorOf(room.year);
	// The pieces stay above the dado line (Uli): each hangs on the line or
	// just high enough to clear the dado (pieceY), never with its centre
	// above HANG_MAX — so the dado in a room drops to what its tallest
	// piece leaves under that.
	const tallest = Math.max(0, ...room.specs.map(specHeight));
	const style = WALL_STYLES[floor] || WALL_STYLES.lacquer;
	const dadoCap = Math.max(0, Math.min(dadoTop(style), HANG_MAX - 0.15 - tallest / 2));
	state.dadoCap = dadoCap;
	if (!state.room || state.room.W !== W || state.room.D !== D || state.room.floor !== floor || state.room.dadoCap !== dadoCap) {
		for (const name of ['room', 'elevator']) {
			const old = scene.getObjectByName(name);
			if (!old) continue;
			old.parent.remove(old);
			// the floor's textures go with the room
			const f = old.getObjectByName('floor');
			if (f) { for (const k of ['map', 'roughnessMap', 'normalMap', 'metalnessMap']) f.material[k]?.dispose(); f.material.dispose(); }
		}
		world.add(buildRoom(W, D, H, floor, dadoCap, shape));
		world.add(elevator.build(W, D, H, floor, dadoCap));
		state.room = { W, D, H, floor, dadoCap, shape };
	}

	state.gap = lay.gap;                           // the labels need it before the pieces exist
	state.placed = lay.placed;
	state.obstacles = [];
	const slabs = new Map();                       // a slot's slab: the larger of the pair's sizes
	for (const { piece: spec, x, z, yaw, wall, slab, roomLeft, roomRight } of lay.placed) {
		const piece = makePiece(spec);
		piece.position.set(x, pieceY(piece.userData.h), z);
		piece.rotation.y = yaw;
		piece.userData.wall = wall;
		placeLabels(piece, piece.userData.w, piece.userData.h, roomRight ?? Infinity, wall === 'mid');
		addDots(piece);                        // the red dot's place under each label (sticker.js)
		// a middle row stops the body (Uli): its footprint, the body's radius round it — long along x facing ±z, along z facing ±x
		const alongX = Math.abs(Math.cos(yaw)) > 0.5, [hx, hz] = alongX ? [spec.w / 2, SLAB.thick / 2] : [SLAB.thick / 2, spec.w / 2];
		if (wall === 'mid') state.obstacles.push({ x0: x - hx - BODY_R, x1: x + hx + BODY_R, z0: z - hz - BODY_R, z1: z + hz + BODY_R });
		if (slab) {
			// the slab's middle: half its thickness behind the face; the pair share it
			const xc = x - Math.sin(yaw) * SLAB.thick / 2, zc = z - Math.cos(yaw) * SLAB.thick / 2, k = `${xc.toFixed(4)}|${zc.toFixed(4)}`;
			const y = piece.position.y, h = piece.userData.h, drop = piece.userData.labelDrop || 0;
			const prev = slabs.get(k) || { x: xc, z: zc, yaw: alongX ? 0 : Math.PI / 2, w: 0, bottom: Infinity, top: -Infinity };
			slabs.set(k, { ...prev, w: Math.max(prev.w, piece.userData.w), bottom: Math.min(prev.bottom, y - h / 2 - drop), top: Math.max(prev.top, y + h / 2) });
		}
		// The warm pool a spot throws lies on the wall behind the piece. In
		// the middle of the room there is no wall, so it would hang in the
		// air: the light stays, the pool goes (Uli, 2026-08-29). On a wall
		// it now stops where the wall does (Uli, 2026-09-10: no shine on a
		// wall that is not there) — at an L room's inner corner, and on the
		// cabin's 1.5 m face, it had glowed past the plaster into the air.
		const pool = piece.getObjectByName('pool');
		if (pool && wall === 'mid') { pool.geometry.dispose(); pool.parent.remove(pool); }
		else if (pool) clipPool(pool, piece.userData.w, piece.userData.h, roomLeft, roomRight);
		pieces.add(piece);
	}
	// the slabs: the wall's colour, following day and night like a wall
	for (const sl of slabs.values()) {
		const paint = wallColours((WALL_STYLES[floor] || WALL_STYLES.lacquer).paint);
		const m = new THREE.Mesh(new THREE.BoxGeometry(sl.w + 2 * SLAB.edge, sl.top - sl.bottom + 2 * SLAB.edge, SLAB.thick), new THREE.MeshLambertMaterial({ color: paint[state.settings.dark ? 'dark' : 'light'] }));
		m.name = 'slab';
		m.position.set(sl.x, (sl.top + sl.bottom) / 2, sl.z);
		m.rotation.y = sl.yaw;
		m.userData.colours = paint;
		pieces.add(m);
	}

	world.add(pieces);
	world.updateMatrixWorld(true);
	findSpots();                               // where a red dot may go, in this room, in world coordinates
	world.add(bakeRoom(pieces));
	if (wire) setWire(true);
	const keep = new Set(); pieces.traverse(o => { if (o.name === 'photo') for (const [k, t] of textureCache) if (t === o.material.map) keep.add(k); });
	freeTexturesExcept(keep);
	const keepV = new Set(); pieces.traverse(o => { if (o.name === 'video') keepV.add(o.userData.n); });
	freeVideosExcept(keepV);
	state.year = room.year;
	state.roomKey = key;
	state.gap = lay.gap;
	elevator.light(key);
	if (!elevator.ride) elevator.show(roomLabel(room), '');
	placeGuard();                                  // the guard takes the far corner of the new room
	if (TOP) drawTop(shape, lay.placed);
	return pieces;
}

// Bench: plan every room afresh (state.real set by hand) and hang the newest.
export function replan() { clearRooms(); state.room = null; hangRoom(firstRoom().key); elevator.setDoors(1); }

// The bench's top view (?top=1, for checking and for Uli): a canvas in the
// page's corner, 40 px a metre — the outline, the cabin and its exit
// square, the keep-out hatched, every piece a bar with a tick for its
// front, the walls' in blue, the middle's in rust. Drawn on every hangRoom.
const TOP = new URLSearchParams(location.search).get('top') === '1';
let topCanvas = null;
function drawTop(shape, placed) {
	const S = 40, { W, D } = shape, e = ELEVATOR.size, ko = keepOut(shape);
	if (!topCanvas) {
		topCanvas = document.body.appendChild(document.createElement('canvas'));
		topCanvas.style.cssText = 'position:fixed;left:12px;top:12px;background:#fff;border:1px solid #888;z-index:9';
	}
	topCanvas.width = (W + 1) * S; topCanvas.height = (D + 1) * S;
	topCanvas.style.width = topCanvas.width + 'px'; topCanvas.style.height = topCanvas.height + 'px';   // the page's canvas rule fills the window
	const ctx = topCanvas.getContext('2d'), X = x => (x + W / 2 + 0.5) * S, Z = z => (z + D / 2 + 0.5) * S;
	ctx.beginPath(); shape.outline.forEach(([x, z], i) => ctx[i ? 'lineTo' : 'moveTo'](X(x), Z(z))); ctx.closePath();
	ctx.fillStyle = '#f4f1ea'; ctx.fill(); ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();
	const pat = document.createElement('canvas'); pat.width = pat.height = 8;                      // the keep-out, hatched
	const pc = pat.getContext('2d'); pc.strokeStyle = '#d3c4ad'; pc.beginPath(); pc.moveTo(0, 8); pc.lineTo(8, 0); pc.stroke();
	ctx.save(); ctx.clip(); ctx.fillStyle = ctx.createPattern(pat, 'repeat');
	for (const k of ko) ctx.fillRect(X(k.x0), Z(k.z0), (k.x1 - k.x0) * S, (k.z1 - k.z0) * S);
	ctx.restore();
	ctx.fillStyle = '#bbb'; ctx.fillRect(X(W / 2 - e), Z(-D / 2), e * S, e * S);                   // the cabin
	ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.strokeRect(X(W / 2 - 2 * e), Z(-D / 2), e * S, e * S); ctx.setLineDash([]);   // its exit
	ctx.lineWidth = 3;
	for (const { piece, x, z, yaw, wall } of placed) {
		const fx = Math.sin(yaw), fz = Math.cos(yaw), hw = piece.w / 2;                            // the facing, half the width
		ctx.strokeStyle = wall === 'mid' ? '#b5542a' : '#2a5ab5';
		ctx.beginPath(); ctx.moveTo(X(x - fz * hw), Z(z + fx * hw)); ctx.lineTo(X(x + fz * hw), Z(z - fx * hw));   // the bar, across the facing
		ctx.moveTo(X(x), Z(z)); ctx.lineTo(X(x + fx * 0.2), Z(z + fz * 0.2)); ctx.stroke();                          // the tick: its front
	}
}
