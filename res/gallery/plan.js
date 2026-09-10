
// ---------------------------------------------------------------------------
// The plan of a scanned room
//
// The Quest hands over the Guardian boundary: a hand-drawn polygon, many
// short wobbly edges. A rectangle round it wastes an L-shaped room's
// short arm; a rectangle inside it throws the arm away. So (Uli,
// 2026-09-10): the largest rectangle that fits inside the polygon — its
// edges measured, never snapped — and, growing out of that rectangle's
// four edges on a 50 cm grid, whatever of the scan it left out. An L
// room keeps its leg, a U room both of them.
//
// Everything here works in the walls' own frame (the polygon already
// turned so the walls run along x and z), in metres. `planOf` returns a
// room shape — `{ W, D, rects, outline }`, the bounding box centred on
// the origin — and where that box's middle lies in the frame it came
// from, so the world can be moved onto it.

const CELL = 0.5;        // the extensions' grid (Uli: corners of 50 cm and multiples of it)
const RASTER = 0.1;      // how finely the main rectangle is measured — it is not on the grid (Uli)
const FILL = 0.6;        // how much of a cell must lie inside the scan to be kept
const SOLID = 0.85;      // and how much of a raster cell the main rectangle needs — not all of it: a
                         // boundary is drawn by hand, and one inward wobble of a few centimetres
                         // would otherwise cut a whole column off the room (Uli, 2026-09-10: the
                         // room came out much smaller than it is)
const MIN_WIDE = 2;      // an extension runs at least this many cells along the wall — no wall under a metre (Uli)
const MIN_DEEP = 1;      // but may be one cell deep: a 50 cm return is still room (Uli: 50 cm and multiples)

const EPS = 1e-6;

// Is the point inside the polygon? A ray to +x, crossings counted.
function inPoly(poly, x, z) {
	let hit = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, zi] = poly[i], [xj, zj] = poly[j];
		if ((zi > z) !== (zj > z) && x < xi + (z - zi) / (zj - zi) * (xj - xi)) hit = !hit;
	}
	return hit;
}
// How much of the box lies inside the polygon, sampled n × n.
function cover(poly, x0, z0, w, d, n) {
	let k = 0;
	for (let i = 0; i < n; i++) for (let j = 0; j < n; j++)
		if (inPoly(poly, x0 + (i + 0.5) * w / n, z0 + (j + 0.5) * d / n)) k++;
	return k / (n * n);
}
function bboxOf(poly) {
	const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
	return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

// The largest rectangle inside the polygon: the scan rastered at RASTER
// (a cell counts only where all of it is inside), then the largest block
// of set cells — the histogram walk, a stack per row.
function largestRect(poly) {
	const b = bboxOf(poly);
	const nx = Math.floor((b.x1 - b.x0) / RASTER), nz = Math.floor((b.z1 - b.z0) / RASTER);
	if (nx < 1 || nz < 1) return null;
	const set = (i, j) => cover(poly, b.x0 + i * RASTER, b.z0 + j * RASTER, RASTER, RASTER, 4) >= SOLID;
	const h = new Array(nx).fill(0);
	let best = null;
	for (let j = 0; j < nz; j++) {
		for (let i = 0; i < nx; i++) h[i] = set(i, j) ? h[i] + 1 : 0;
		// the largest rectangle under this row's histogram
		const stack = [];
		for (let i = 0; i <= nx; i++) {
			const cur = i < nx ? h[i] : 0;
			while (stack.length && h[stack[stack.length - 1]] >= cur) {
				const top = stack.pop(), height = h[top];
				const left = stack.length ? stack[stack.length - 1] + 1 : 0;
				const area = height * (i - left);
				if (height && (!best || area > best.area)) best = { area, i0: left, i1: i, j0: j + 1 - height, j1: j + 1 };
			}
			stack.push(i);
		}
	}
	if (!best) return null;
	return { x0: b.x0 + best.i0 * RASTER, x1: b.x0 + best.i1 * RASTER, z0: b.z0 + best.j0 * RASTER, z1: b.z0 + best.j1 * RASTER };
}

// What the main rectangle leaves out, side by side: for each of its four
// edges a band of 50 cm cells, anchored on the edge and reaching outward.
// A column of the band is kept as deep as the scan holds — at least
// MIN_CELLS deep, and only in runs of MIN_CELLS columns of the same
// depth, so no extension is under a metre and no wall of one either
// (Uli: fewer corners with too little wall between them).
const SIDES = [
	{ name: 'e', along: 'z', out:  1 },
	{ name: 'w', along: 'z', out: -1 },
	{ name: 's', along: 'x', out:  1 },
	{ name: 'n', along: 'x', out: -1 },
];
function bandRects(poly, main, side) {
	const alongX = side.along === 'x';
	// the edge: its span (u0..u1) and where it lies (v0), outward positive
	const u0 = alongX ? main.x0 : main.z0, u1 = alongX ? main.x1 : main.z1;
	const v0 = side.out > 0 ? (alongX ? main.z1 : main.x1) : (alongX ? main.z0 : main.x0);
	const cols = Math.floor((u1 - u0) / CELL + EPS);
	if (cols < MIN_WIDE) return [];
	// how deep the scan reaches out of each column of the edge
	const depth = [];
	for (let i = 0; i < cols; i++) {
		const u = u0 + i * CELL;
		let d = 0;
		while (d < 40) {
			// the next cell out: between v0 + out·d·CELL and one CELL further
			const va = v0 + side.out * d * CELL, vb = va + side.out * CELL, v = Math.min(va, vb);
			const box = alongX ? { x0: u, z0: v } : { x0: v, z0: u };
			if (cover(poly, box.x0, box.z0, CELL, CELL, 5) < FILL) break;
			d++;
		}
		depth.push(d >= MIN_DEEP ? d : 0);
	}
	// A run of one depth shorter than MIN_WIDE is no wall to speak of: it
	// takes a neighbour's depth and merges into it — the shallower of the
	// two where it has both, so the room is never invented. Every pass
	// joins two runs, so it ends; the guard is there because a loop that
	// cannot make progress froze the page (a run at the end with no
	// neighbour before it kept its own depth for ever).
	for (let guard = 0; guard < 100; guard++) {
		const runs = [];
		for (let i = 0; i < cols; i++) {
			const last = runs[runs.length - 1];
			if (last && last.d === depth[i]) last.i1 = i + 1; else runs.push({ d: depth[i], i0: i, i1: i + 1 });
		}
		const bad = runs.find(r => r.i1 - r.i0 < MIN_WIDE);
		if (!bad) break;
		const at = runs.indexOf(bad), before = runs[at - 1], after = runs[at + 1];
		if (!before && !after) { depth.fill(0); break; }
		const d = !before ? after.d : !after ? before.d : Math.min(before.d, after.d);
		for (let i = bad.i0; i < bad.i1; i++) depth[i] = d;
	}
	// each run of one depth is a rectangle
	const rects = [];
	for (let i = 0; i < cols; ) {
		const d = depth[i];
		let k = i; while (k < cols && depth[k] === d) k++;
		if (d > 0) {
			const ua = u0 + i * CELL, ub = u0 + k * CELL;
			const va = v0, vb = v0 + side.out * d * CELL;
			rects.push(alongX
				? { x0: ua, x1: ub, z0: Math.min(va, vb), z1: Math.max(va, vb) }
				: { x0: Math.min(va, vb), x1: Math.max(va, vb), z0: ua, z1: ub });
		}
		i = k;
	}
	return rects;
}

// The outline of a set of rectangles that touch but do not overlap: the
// grid of all their edges, the cells they cover, every cell's four edges
// with the ones two cells share cancelled, and what is left chained into
// the loop. Clockwise seen from above with z downward, so the inward
// normal of an edge p→q is (−dz, dx) — the contract the layout reads.
export function outlineOf(rects) {
	const xs = [...new Set(rects.flatMap(r => [r.x0, r.x1]))].sort((a, b) => a - b);
	const zs = [...new Set(rects.flatMap(r => [r.z0, r.z1]))].sort((a, b) => a - b);
	const key = (x, z) => `${x.toFixed(4)}|${z.toFixed(4)}`;
	const edges = new Map();
	const add = (a, b) => { const k = key(...b) + '>' + key(...a); if (edges.has(k)) edges.delete(k); else edges.set(key(...a) + '>' + key(...b), [a, b]); };
	for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
		const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
		const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
		if (!rects.some(r => mx > r.x0 && mx < r.x1 && mz > r.z0 && mz < r.z1)) continue;
		add([x0, z0], [x1, z0]); add([x1, z0], [x1, z1]); add([x1, z1], [x0, z1]); add([x0, z1], [x0, z0]);
	}
	const from = new Map();
	for (const [a, b] of edges.values()) from.set(key(...a), b);
	const start = [...edges.values()][0][0];
	const loop = [start];
	for (let p = from.get(key(...start)); p && key(...p) !== key(...start); p = from.get(key(...p))) {
		loop.push(p);
		if (loop.length > 4000) break;
	}
	// drop the points that only carry a straight line on
	const out = loop.filter((p, i) => {
		const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
		return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > EPS;
	});
	// start at the north-east corner, walking the east wall southward
	const x1 = Math.max(...out.map(p => p[0])), z0 = Math.min(...out.map(p => p[1]));
	const at = out.findIndex(p => Math.abs(p[0] - x1) < EPS && Math.abs(p[1] - z0) < EPS);
	if (at < 0) return out;
	return [...out.slice(at), ...out.slice(0, at)];
}

// A shape from rectangles: the bounding box centred on the origin, the
// rectangles largest first, the outline traced. Returns the shape and
// where the box's middle lay before the shift.
function shapeOf(rects) {
	const b = bboxOf(rects.flatMap(r => [[r.x0, r.z0], [r.x1, r.z1]]));
	const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
	const moved = rects.map(r => ({ x0: r.x0 - cx, x1: r.x1 - cx, z0: r.z0 - cz, z1: r.z1 - cz }))
		.sort((p, q) => (q.x1 - q.x0) * (q.z1 - q.z0) - (p.x1 - p.x0) * (p.z1 - p.z0));
	return { shape: { W: b.x1 - b.x0, D: b.z1 - b.z0, rects: moved, outline: outlineOf(moved) }, cx, cz };
}

// The shape turned k quarter turns the way the world turns: a point
// (x, z) about y by −k·90° goes to (−z, x) each time.
export function rotShape(shape, k) {
	const turn = p => { let [x, z] = p; for (let i = 0; i < ((k % 4) + 4) % 4; i++) [x, z] = [-z, x]; return [x, z]; };
	const rects = shape.rects.map(r => {
		const a = turn([r.x0, r.z0]), b = turn([r.x1, r.z1]);
		return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) };
	});
	return shapeOf(rects).shape;
}

// Does the lift fit the shape's north-east corner? The cabin and the
// square one steps out into: 2 × ELEVATOR.size by ELEVATOR.size, hard
// against the corner. Only a turn that has it can be used.
export function cornerFree(shape, e) {
	const { W, D } = shape;
	const box = { x0: W / 2 - 2 * e, x1: W / 2, z0: -D / 2, z1: -D / 2 + e };
	const covered = (x, z) => shape.rects.some(r => x > r.x0 - EPS && x < r.x1 + EPS && z > r.z0 - EPS && z < r.z1 + EPS);
	for (let i = 0; i <= 6; i++) for (let j = 0; j <= 3; j++)
		if (!covered(box.x0 + (box.x1 - box.x0) * i / 6, box.z0 + (box.z1 - box.z0) * j / 3)) return false;
	return true;
}

// The plan of a scanned polygon, in one of three ways (the visitor's
// `plan` switch, Uli): `grid` the main rectangle with its extensions,
// `inside` the main rectangle alone, `around` the rectangle round the
// whole scan — what the gallery did before the shapes.
// How much floor a polygon has, by the shoelace formula.
function areaOf(poly) {
	let a = 0;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
	return Math.abs(a) / 2;
}
const rectsArea = rects => rects.reduce((s, r) => s + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
const KEEP = 0.85;       // a plan that holds less of the scan than this is not the room: the rectangle round it is (Uli)
const SIMPLE = 0.93;     // when this much of the rectangle round the scan lies inside it, the room *is* that
                         // rectangle — no corners invented, and none of the hand's wobble lost (Uli,
                         // 2026-09-10: it need not be an L or a U, a rectangle is fine where it fits best)
const WORTH = 0.08;      // and an extension has to add this much floor over the main rectangle to be worth its corners

export function planOf(poly, mode = 'grid') {
	const b = bboxOf(poly);
	const around = () => shapeOf([{ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 }]);
	if (mode === 'around') return around();
	const main = largestRect(poly);
	if (!main) return around();
	if (mode === 'inside') return shapeOf([main]);
	// a room that all but fills the rectangle round it is that rectangle
	if (cover(poly, b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0, 24) >= SIMPLE) { const r = around(); r.kept = 1; return r; }
	const rects = [main, ...SIDES.flatMap(s => bandRects(poly, main, s))];
	// A plan that leaves much of the scanned floor out is not the room —
	// the rectangle round the scan is nearer the truth then (Uli,
	// 2026-09-10: a very much smaller L than the room allows).
	// corners that gain little floor are not worth having: the main
	// rectangle alone is the quieter room (Uli)
	if (rectsArea(rects) < rectsArea([main]) * (1 + WORTH)) {
		const r = shapeOf([main]);
		r.kept = rectsArea([main]) / (areaOf(poly) || 1);
		if (r.kept >= KEEP) return r;
	}
	const plan = shapeOf(rects);
	plan.kept = rectsArea(rects) / (areaOf(poly) || 1);
	if (plan.kept >= KEEP) return plan;
	const box = around();                                 // the plan lost too much of the scan: the rectangle round it
	box.kept = plan.kept; box.fellBack = true;
	return box;
}
export { largestRect, inPoly };
