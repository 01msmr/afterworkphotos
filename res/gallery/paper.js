import * as THREE from '../vendor/three.module.js';
import { T, t } from 'gallery/lang';
import { LANGS, OPTIONS, getSetting, setSetting } from 'gallery/settings';
import { PRINT_GLOW } from 'gallery/frames';
import { camera, head, scene, world } from 'gallery/scene';
import { state } from 'gallery/state';

// ---------------------------------------------------------------------------
// The options sheet
//
// The settings are a sheet of white paper, written in felt pen, stuck to
// the wall with three strips of tape (Uli, 2026-09-19, from a 2D demo
// tuned over twenty rounds; it replaces the switchplate by the lift and
// the map held up on B). **B pins it where the pointer points**: upright
// on a wall or a slab, its foot never under 50 cm; flat on the floor
// turned to the one who put it there. B again takes it away, so does a
// press on one of its tape strips, and a ride
// leaves it behind (hangRoom hides it). A press anywhere on a line sets
// that option — a two-way option is one box, a group (the frames' wood,
// the language) a box per value — and the tick comes down big first,
// the way a pen does, then settles. Chosen values are written 100 %
// black, the rest 35 %; the headings of the groups in italics; a credit
// line in the gallery's own Jost under it all. Two languages, the sheet
// itself in the one chosen.
//
// One canvas, redrawn on every change, over the paper's own photograph
// (res/textures/paper-color.jpg, ambientCG Paper001); the pen is Kalam
// bold (res/fonts; Permanent Marker turned out to have no lowercase). The lines' places on the canvas are kept
// as they are drawn (`areas`), so a press on the sheet finds its line by
// the uv it lands on.

const SHEET = { w: 0.63, h: 0.891, px: 1536 };   // three times A4: A4 and A2 were too small to read in the headset
const WALL_SCALE = 0.8;                          // on a wall it is a little smaller
const AWAY = 3.5, LOOK = Math.cos(50 * Math.PI / 180), IGNORED = 15000, IGNORED_START = 5000;   // it goes when walked away from, or not looked at: 15 s, the start's sheet 5 s
let seen = 0, ignored = IGNORED;
const PX = SHEET.px, PY = Math.round(PX * SHEET.h / SHEET.w);
// the sheet's layout, in canvas pixels (the demo's 440 px sheet, ×3.5)
const L = { pad: 114, title: 150, titleGap: 99, font: 78, pitch: 147, indent: 90, box: 63, boxLine: 5, gap: 45, between: 33, credit: 50, tick: { w: 42, h: 95, line: 12 }, big: 1.7 };
export const PENS = { kalam: 'bold 1em Kalam', gloria: '1em "Gloria Hallelujah"', marker: '1em "Permanent Marker"' };
let pen = 'kalam';                              // the face in use; the bench may try another (paper.pen)
const INK = '#111111', FAINT = '#a6a6a6';
const font = (px, italic = false) => (italic ? 'italic ' : '') + PENS[pen].replace('1em', px + 'px') + ', "Marker Felt", sans-serif';
// what is on the sheet, from the options' registry (settings.js): a
// `check` is one box, a `group` a box per value under a heading, `rows`
// how the values are split into lines; `word` the line's word where it is
// not the key's, `inverted` a box that means the opposite of the value,
// on/off the values a two-valued word stands for
const LINES = OPTIONS.filter(o => o.sheet).map(o => {
	const sh = o.sheet, val = v => sh.inverted ? !v : v;
	return {
		key: sh.word || o.key, kind: sh.kind, values: sh.values, rows: sh.rows,
		get: () => sh.kind === 'group' ? getSetting(o.key) : sh.on !== undefined ? getSetting(o.key) === sh.on : val(getSetting(o.key)),
		set: v => setSetting(o.key, sh.kind === 'group' ? v : sh.on !== undefined ? (v ? sh.on : sh.off) : val(v)),
	};
});

const canvas = document.createElement('canvas'); canvas.width = PX; canvas.height = PY;
const tex = new THREE.CanvasTexture(canvas);
tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
let paperImg = null;                    // the paper's photograph, once it is in
const img = new Image(); img.onload = () => { paperImg = img; draw(); }; img.src = '/res/textures/paper-color.jpg';
for (const f of [`bold ${L.font}px Kalam`, `${L.font}px "Gloria Hallelujah"`, `${L.font}px "Permanent Marker"`]) document.fonts.load(f).then(() => draw()).catch(() => {});

let areas = [];                         // { line, value, x0, x1, y0, y1 } as drawn
let flash = null;                       // { key, value, until }: the tick just set, drawn big for a moment
const words = () => T[state.settings.lang] || T.en;   // the sheet's words (lang.js)

// the box and its tick: a thin square, the tick a felt-pen stroke that
// overshoots it, `k` times its size while it is fresh
function box(g, x, y, on, k = 1) {
	g.lineWidth = L.boxLine; g.strokeStyle = on ? INK : FAINT;
	g.strokeRect(x, y - L.box + 8, L.box, L.box);
	if (!on) return;
	g.save();
	g.translate(x + L.box * 0.55, y - L.box * 0.45);
	g.scale(k, k);
	g.strokeStyle = INK; g.lineWidth = L.tick.line; g.lineCap = 'round'; g.lineJoin = 'round';
	g.beginPath(); g.moveTo(-L.tick.w * 0.5, -L.tick.h * 0.05); g.lineTo(-L.tick.w * 0.05, L.tick.h * 0.35); g.lineTo(L.tick.w * 0.6, -L.tick.h * 0.6); g.stroke();
	g.restore();
}
function draw() {
	const g = canvas.getContext('2d'), t = words();
	areas = [];
	g.fillStyle = '#f7f4ec'; g.fillRect(0, 0, PX, PY);
	if (paperImg) g.drawImage(paperImg, 0, 0, PX, PY);
	// the paper's edge: a faint line and shading, as the demo had
	g.strokeStyle = 'rgba(0,0,0,0.10)'; g.lineWidth = 2; g.strokeRect(1, 1, PX - 2, PY - 2);
	g.textBaseline = 'alphabetic';
	let y = L.pad + L.title;
	g.fillStyle = INK; g.font = font(L.title); g.textAlign = 'center'; g.fillText(t.title, PX / 2, y);
	y += L.titleGap;
	g.textAlign = 'left';
	const fresh = (key, value) => flash && flash.key === key && flash.value === value && performance.now() < flash.until;
	const item = (line, value, x, yy, label, on) => {
		g.font = font(L.font);
		box(g, x, yy, on, fresh(line.key, value) ? L.big : 1);
		g.fillStyle = on ? INK : FAINT;
		g.fillText(label, x + L.box + L.gap, yy);
		const w = L.box + L.gap + g.measureText(label).width;
		areas.push({ line, value, x0: x - 10, x1: x + w + 10, y0: yy - L.font, y1: yy + 20 });
		return w;
	};
	for (const line of LINES) {
		y += L.font;
		if (line.kind === 'check') {
			item(line, true, L.pad, y, t[line.key], line.get());
			areas[areas.length - 1].x1 = PX - L.pad;      // the whole line takes the press
		} else {
			g.font = font(L.font, true); g.fillStyle = INK; g.fillText(t[line.key], L.pad, y);
			let i = 0;
			for (const n of line.rows) {
				y += L.font + L.between;
				let x = L.pad + L.indent;
				for (let k = 0; k < n && i < line.values.length; k++, i++) {
					const v = line.values[i];
					x += item(line, v, x, y, t[v], line.get() === v) + L.gap + 6;
				}
			}
		}
		y += L.pitch - L.font;
	}
	// the credit, in the gallery's own type
	y += L.credit;
	g.fillStyle = '#555555'; g.textAlign = 'center';
	g.font = `300 ${L.credit}px Jost, "Helvetica Neue", Arial, sans-serif`;
	const a = '© 2026 msmr', b = 's', c = ' afterworkphotos';
	const wa = g.measureText(a).width, wc = g.measureText(c).width;
	g.font = `300 ${L.credit * 0.7}px Jost, "Helvetica Neue", Arial, sans-serif`; const wb = g.measureText(b).width;
	const x0 = PX / 2 - (wa + wb + wc) / 2;
	g.textAlign = 'left';
	g.font = `300 ${L.credit}px Jost, "Helvetica Neue", Arial, sans-serif`; g.fillText(a, x0, y); g.fillText(c, x0 + wa + wb, y);
	g.font = `300 ${L.credit * 0.7}px Jost, "Helvetica Neue", Arial, sans-serif`; g.fillText(b, x0 + wa, y - L.credit * 0.45);
	tex.needsUpdate = true;
}

// the sheet in the room: the paper, and three strips of tape
let group = null, sheet = null;
const tapeMat = new THREE.MeshBasicMaterial({ color: 0xfff6dc, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -6 });
function build() {
	group = new THREE.Group(); group.name = 'paper'; group.visible = false;
	// lit like paper by day; at night it keeps a little of itself, as the
	// prints do (PRINT_GLOW), so it stays readable in a room lit by the
	// pools alone (Uli, 2026-09-19)
	sheet = new THREE.Mesh(new THREE.PlaneGeometry(SHEET.w, SHEET.h), new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: PRINT_GLOW[state.settings.dark ? 'dark' : 'light'], polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -4 }));
	sheet.name = 'sheet';
	group.add(sheet);
	const tape = (x, y, turn) => {
		const m = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.045), tapeMat);
		m.position.set(x, y, 0.0004); m.rotation.z = turn; m.name = 'tape'; group.add(m);
	};
	tape(-SHEET.w / 2 + 0.024, SHEET.h / 2 - 0.018, -0.66);
	tape(SHEET.w / 2 - 0.024, SHEET.h / 2 - 0.018, 0.66);
	tape(0, -SHEET.h / 2 + 0.012, 0.03);
	scene.add(group);
	draw();
}

const _rc = new THREE.Raycaster(), _n = new THREE.Vector3(), _d = new THREE.Vector3();
// nothing to stick to: held up in front of the visitor, as the map was
function hold(h) {
	const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())); fwd.y = 0; fwd.normalize();
	group.position.copy(h).addScaledVector(fwd, 0.7); group.position.y -= 0.1;
	group.lookAt(h);
}
// a group stuck where the ray lands: upright on a wall (`scale`, foot not under
// 50 cm, 5 cm off the plaster, clear of frames and labels — freeSpot) or flat
// on the floor turned to the visitor. Returns 'wall', 'floor', or null.
export function pinTo(group, rc, hh, scale = 1) {
	const targets = ['room', 'pieces', 'elevator'].map(n => scene.getObjectByName(n)).filter(Boolean);
	const hit = rc && rc.intersectObjects(targets, true).find(h => h.distance < 6);
	if (!hit) return null;
	const h = head();
	_n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
	if (_n.dot(_d.subVectors(h, hit.point)) < 0) _n.negate();
	group.position.copy(hit.point).addScaledVector(_n, 0.002);
	if (Math.abs(_n.y) < 0.5) {
		group.position.addScaledVector(_n, 0.045);
		group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _n.clone().setY(0).normalize());
		group.scale.setScalar(scale);
		const H = state.room ? state.room.H : 3, half = hh * scale;
		let yLow = 0.5 + half, yHigh = H - 0.05 - half;
		if (yLow > yHigh) yLow = yHigh = H / 2;          // floor to ceiling: only slid along the wall
		group.position.y = Math.max(yLow, Math.min(yHigh, group.position.y));
		return freeSpot(group, _n, yLow, yHigh) ? 'wall' : null;
	}
	group.scale.setScalar(1);
	_d.subVectors(hit.point, h); _d.y = 0; _d.normalize();
	group.rotation.set(_n.y > 0 ? -Math.PI / 2 : Math.PI / 2, Math.atan2(-_d.x, -_d.z), 0, 'YXZ');
	return 'floor';
}
// the sheet slid along the wall (right axis `r`) and up until its box meets
// no piece's — a piece's box holds its frame and its labels. Returns
// whether a spot was found; the group stands at it.
const _box = new THREE.Box3(), _pb = new THREE.Box3(), _r = new THREE.Vector3(), _p0 = new THREE.Vector3();
function freeSpot(group, n, yLow, yHigh) {
	const pieces = scene.getObjectByName('pieces');
	const boxes = [];
	if (pieces) for (const o of pieces.children) if ((o.name || '').startsWith('piece-') || o.name === 'slab') boxes.push(new THREE.Box3().setFromObject(o).expandByScalar(0.03));
	_r.set(-n.z, 0, n.x).normalize();               // along the wall
	_p0.copy(group.position);
	// and never past a wall's end into the corner: the sheet's corners stay
	// inside the room's plan (its rects, in the world's own frame)
	const rects = state.room && state.room.shape ? state.room.shape.rects : null;
	const inRoom = () => {
		if (!rects) return true;
		for (const c of [[_box.min.x, _box.min.z], [_box.max.x, _box.min.z], [_box.min.x, _box.max.z], [_box.max.x, _box.max.z]]) {
			const q = world.worldToLocal(new THREE.Vector3(c[0], 0, c[1]));
			if (!rects.some(r => q.x > r.x0 - 0.02 && q.x < r.x1 + 0.02 && q.z > r.z0 - 0.02 && q.z < r.z1 + 0.02)) return false;
		}
		return true;
	};
	const clear = () => { group.updateMatrixWorld(true); _box.setFromObject(group).expandByScalar(0.06); return inRoom() && !boxes.some(b => b.intersectsBox(_box)); };   // 6 cm about it: the sheet stands 5 cm off the wall, the frames' boxes end at 4
	const steps = [0];
	for (let d = 0.05; d <= 2; d += 0.05) steps.push(d, -d);
	// heights nearest the aim first, down as well as up
	const ys = [_p0.y];
	for (let dy = 0.15; ; dy += 0.15) { let any = false; if (_p0.y + dy <= yHigh) { ys.push(_p0.y + dy); any = true; } if (_p0.y - dy >= yLow) { ys.push(_p0.y - dy); any = true; } if (!any) break; }
	for (const y of ys) {
		for (const d of steps) {
			group.position.copy(_p0).addScaledVector(_r, d); group.position.y = y;
			if (clear()) return true;
		}
	}
	group.position.copy(_p0);
	return false;
}
export const paper = {
	shown: () => !!group && group.visible,
	// B: stick it where the ray lands, or take it away
	toggle(rc) {
		if (!group) build();
		if (group.visible) { group.visible = false; return; }
		if (!pinTo(group, rc, SHEET.h / 2, WALL_SCALE)) hold(head());
		draw();
		group.visible = true; seen = performance.now(); ignored = IGNORED;
	},
	// at the start: flat on the floor, a metre ahead, its top away
	showOnFloor() {
		if (!group) build();
		const h = head();
		const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())); fwd.y = 0;
		if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); fwd.normalize();
		group.position.copy(h).addScaledVector(fwd, 1.2); group.position.y = 0.002;
		group.scale.setScalar(1);
		group.rotation.set(-Math.PI / 2, Math.atan2(-fwd.x, -fwd.z), 0, 'YXZ');
		draw();
		group.visible = true; seen = performance.now(); ignored = IGNORED_START;
	},
	hide() { if (group) group.visible = false; },
	// a press on the sheet: the line under it is set. Returns whether the press was used up.
	press(rc) {
		if (!group || !group.visible) return false;
		// a press on any of the tape strips takes the sheet down (Uli, 2026-09-19)
		const tape = rc.intersectObjects(group.children.filter(o => o.name === 'tape'), false)[0];
		if (tape && tape.distance <= 3) { group.visible = false; return true; }
		const hit = rc.intersectObject(sheet, false)[0];
		if (!hit || hit.distance > 3) return false;
		const x = hit.uv.x * PX, y = (1 - hit.uv.y) * PY;   // the canvas' own pixels, whatever its size
		const a = areas.find(a => x >= a.x0 && x <= a.x1 && y >= a.y0 && y <= a.y1);
		if (!a) return true;                         // on the paper, beside the lines: the press is used, nothing set
		const line = a.line;
		if (line.kind === 'check') line.set(!line.get()); else line.set(a.value);
		flash = { key: line.key, value: line.kind === 'check' ? true : a.value, until: performance.now() + 450 };
		draw();
		return true;
	},
	// the pointer over the sheet, for the cursor
	hit(rc) { return group && group.visible ? rc.intersectObject(sheet, false)[0] || null : null; },
	group: () => group,
	areas: () => areas,
	pen(name) { if (PENS[name]) { pen = name; draw(); } },
};
// the sheet says the settings as they are, whoever changed them
export function refreshPaper() { if (group && group.visible) draw(); }
// the big tick settles: one redraw once its moment is over
export function stepPaper(now) {
	if (flash && now >= flash.until) { flash = null; if (group && group.visible) draw(); }
	if (!group || !group.visible) return;
	sheet.material.emissiveIntensity = PRINT_GLOW[state.settings.dark ? 'dark' : 'light'];
	// ignored: walked away from, or out of the view for IGNORED
	const h = head(), to = _d.subVectors(group.position, h), dist = to.length();
	if (dist > AWAY) { group.visible = false; return; }
	const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
	if (to.normalize().dot(fwd) > LOOK) seen = now;
	else if (now - seen > ignored) group.visible = false;
}
