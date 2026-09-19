import * as THREE from '../vendor/three.module.js';
import { ELEVATOR } from 'gallery/hang';

// Ways on the floor: a 10 cm grid over the room; the rows, every wall
// piece and the cabin blocked, the body's radius round them.

export const CELL = 0.1, BODY = 0.3, WALL_ZONE = 0.45, STAND = 0.4;   // STAND: the standing circle's radius (80 cm across, Uli)

// the blocked rectangles of a layout, in the room's frame
export function blocksFor(placed, W, D) {
	const e = ELEVATOR.size, out = [{ x0: W / 2 - e - BODY, x1: W / 2, z0: -D / 2, z1: -D / 2 + e + BODY }];   // the cabin
	for (const p of placed || []) {
		const alongX = Math.abs(Math.cos(p.yaw)) > 0.5, w = p.piece.w / 2 + BODY, d = p.wall === 'mid' ? BODY : WALL_ZONE;
		out.push(alongX ? { x0: p.x - w, x1: p.x + w, z0: p.z - d, z1: p.z + d } : { x0: p.x - d, x1: p.x + d, z0: p.z - w, z1: p.z + w });
	}
	return out;
}
const inRect = (x, z, o, grow = 0) => x > o.x0 - grow && x < o.x1 + grow && z > o.z0 - grow && z < o.z1 + grow;
// inside the outline (a polygon of [x, z]), or the rectangle when there is none
export function inside(x, z, shape, margin = 0) {
	const { W, D, outline } = shape;
	if (!outline) return Math.abs(x) < W / 2 - margin && Math.abs(z) < D / 2 - margin;
	let hit = false;
	for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
		const [xi, zi] = outline[i], [xj, zj] = outline[j];
		if (zi > z !== zj > z && x < (xj - xi) * (z - zi) / (zj - zi) + xi) hit = !hit;
		if (margin) {   // the distance to the edge
			const dx = xj - xi, dz = zj - zi, t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / (dx * dx + dz * dz)));
			if (Math.hypot(x - xi - t * dx, z - zi - t * dz) < margin) return false;
		}
	}
	return hit;
}
// the grid: cells outside the outline or in a block are blocked
export function grid(shape, blocks) {
	const { W, D } = shape, nx = Math.ceil(W / CELL), nz = Math.ceil(D / CELL);
	const at = (i, j) => [-W / 2 + (i + 0.5) * CELL, -D / 2 + (j + 0.5) * CELL];
	const cell = p => [Math.max(0, Math.min(nx - 1, Math.floor((p.x + W / 2) / CELL))), Math.max(0, Math.min(nz - 1, Math.floor((p.z + D / 2) / CELL)))];
	const blocked = (i, j) => { const [x, z] = at(i, j); return !inside(x, z, shape) || blocks.some(o => inRect(x, z, o)); };
	// the nearest free cell: an end inside a block (standing at a frame) joins from there
	const free = ([i, j]) => {
		if (!blocked(i, j)) return [i, j];
		for (let r = 1; r < 12; r++) {
			let best = null, bd = Infinity;
			for (let x = i - r; x <= i + r; x++) for (let z = j - r; z <= j + r; z++) {
				if (x < 0 || z < 0 || x >= nx || z >= nz || blocked(x, z)) continue;
				const d = (x - i) ** 2 + (z - j) ** 2; if (d < bd) { bd = d; best = [x, z]; }
			}
			if (best) return best;
		}
		return null;
	};
	return { nx, nz, at, cell, blocked, free };
}
// breadth first from a cell: the previous cell of every cell reached
function flood(g, start, goal = -1) {
	const { nx, nz, blocked } = g, prev = new Int32Array(nx * nz).fill(-1), q = [start]; prev[start] = start;
	for (let h = 0; h < q.length; h++) {
		const c = q[h], i = c % nx, j = (c / nx) | 0;
		if (c === goal) break;
		for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
			const x = i + di, z = j + dj; if (x < 0 || z < 0 || x >= nx || z >= nz) continue;
			const n = x + z * nx; if (prev[n] >= 0 || blocked(x, z)) continue;
			prev[n] = c; q.push(n);
		}
	}
	return prev;
}
// the way from one point to another, reduced to its turns, or null when there is none
export function wayRound(from, to, shape, blocks, r = 0.25) {
	const g = grid(shape, blocks), s = g.free(g.cell(from)), t = g.free(g.cell(to));
	if (!s || !t) return null;
	const start = s[0] + s[1] * g.nx, goal = t[0] + t[1] * g.nx, prev = flood(g, start, goal);
	if (prev[goal] < 0) return null;
	const cells = []; for (let c = goal; c !== prev[c]; c = prev[c]) cells.push(c); cells.push(start); cells.reverse();
	const pts = cells.map(c => { const [x, z] = g.at(c % g.nx, (c / g.nx) | 0); return new THREE.Vector3(x, 0, z); });
	pts.unshift(from.clone().setY(0)); pts.push(to.clone().setY(0));
	const turns = [pts[0]];
	for (let k = 1; k < pts.length - 1; k++) { const a = pts[k - 1], b = pts[k], c = pts[k + 1]; if (Math.abs((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)) > 1e-4) turns.push(b); }
	turns.push(pts[pts.length - 1]);
	// no short legs: an inner point closer than two radii to its neighbour goes, so every turn gets its round
	for (let i = 1; i < turns.length; ) { if (turns[i].distanceTo(turns[i - 1]) < 2 * r && turns.length > 2) turns.splice(i === turns.length - 1 ? i - 1 : i, 1); else i++; }
	return turns;
}
// which of the points can be walked to from `from`
export function reachable(from, points, shape, blocks) {
	const g = grid(shape, blocks), s = g.free(g.cell(from));
	if (!s) return points.map(() => false);
	const prev = flood(g, s[0] + s[1] * g.nx);
	return points.map(p => { const [i, j] = g.cell(p); return !g.blocked(i, j) && prev[i + j * g.nx] >= 0; });
}
// the nearest point to `near` with a standing circle free in every room given: clear of their blocks, inside their outlines
export function standSpot(near, rooms) {
	const W = Math.min(...rooms.map(r => r.shape.W)), D = Math.min(...rooms.map(r => r.shape.D));
	const ok = (x, z) => rooms.every(r => inside(x, z, r.shape, STAND) && !r.blocks.some(o => inRect(x, z, o, STAND - BODY)));
	let best = null, bd = Infinity;
	for (let x = -W / 2 + STAND; x <= W / 2 - STAND; x += CELL) for (let z = -D / 2 + STAND; z <= D / 2 - STAND; z += CELL) {
		const d = (x - near.x) ** 2 + (z - near.z) ** 2;
		if (d < bd && ok(x, z)) { bd = d; best = new THREE.Vector3(x, 0, z); }
	}
	return best;
}
