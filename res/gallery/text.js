import * as THREE from '../vendor/three.module.js';

// ---------------------------------------------------------------------------
// Text out of a distance field
//
// Every label card used to be a canvas of its own: 1.4 MB apiece, one per
// photograph, 105 MB in a large room — and it went soft the moment a card
// was doubled, because a canvas has only the pixels it was drawn with.
//
// One atlas replaces the lot (scripts/make-sdf-font.py). It holds, for
// every letter, **how far each pixel lies from the edge of that letter**;
// a shader can then find the edge at any size and draw it clean, so the
// same 4 MB draws a card across the room, a card doubled under your nose,
// and the year on a lift button. It does not grow with the gallery.
//
// Layout is done in the **1536-wide space the canvases used**, then scaled
// into metres, so every number the cards were tuned with still means what
// it meant.
export const DRAWN = 1536;

let font = null, atlas = null, ready = null;
export function loadFont() {
	if (ready) return ready;
	ready = (async () => {
		font = await fetch('/res/sdf-font.json').then(r => r.json());
		atlas = await new Promise((res, rej) => new THREE.TextureLoader().load('/res/sdf-font.png', res, undefined, rej));
		atlas.flipY = false;                       // UVs are read in the atlas's own rows
		atlas.minFilter = THREE.LinearMipmapLinearFilter;
		atlas.magFilter = THREE.LinearFilter;
		atlas.generateMipmaps = true;
		atlas.anisotropy = 8;
		return font;
	})();
	return ready;
}
export function fontReady() { return !!font; }

// One material for all of it: the colour rides on the vertices, so a card's
// heading and its lighter lines are still a single draw.
let material = null;
export function textMaterial() {
	if (!material) material = new THREE.ShaderMaterial({
		uniforms: { uMap: { value: atlas } },
		vertexShader: `
			attribute vec3 colour;
			varying vec2 vUv; varying vec3 vColour;
			void main() { vUv = uv; vColour = colour; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
		fragmentShader: `
			uniform sampler2D uMap;
			varying vec2 vUv; varying vec3 vColour;
			void main() {
				float d = texture2D(uMap, vUv).r;
				// the edge is at a half; how wide a half is depends on how big
				// the letter is on screen, which fwidth answers per pixel
				float w = max(fwidth(d), 0.0001);
				float a = smoothstep(0.5 - w, 0.5 + w, d);
				if (a < 0.01) discard;
				gl_FragColor = vec4(vColour, a);
			}`,
		transparent: true, depthWrite: false, side: THREE.DoubleSide,
	});
	material.uniforms.uMap.value = atlas;
	return material;
}

const _c = new THREE.Color();
// How wide a line runs, in the drawn space
export function measure(text, face, size) {
	let w = 0;
	for (const ch of text) {
		const g = font.glyphs[`${face}|${ch}`] || font.glyphs[`${face}|?`];
		if (g) w += g.adv * size;
	}
	return w;
}

// A mesh for some lines. Each line: { text, face, size, colour, x, middle,
// squeeze } in the drawn space — `middle` is the y a canvas would have used
// with textBaseline 'middle', which is what the cards were written against.
// `unit` turns the drawn space into metres; the mesh is centred on a box
// `DRAWN` x `height` drawn units, as the canvas was.
export function textMesh(lines, unit, height) {
	const pos = [], uvs = [], col = [], idx = [];
	const A = font.cell / (font.cols * font.cell), aw = font.cols * font.cell, ah = font.rows * font.cell;
	for (const line of lines) {
		const f = font.faces[line.face];
		// a canvas's 'middle' sits between the ascender and the descender
		const base = line.middle + (f.asc - f.desc) / 2 * line.size;
		const sx = line.squeeze || 1;
		let pen = line.x;
		_c.set(line.colour);
		for (const ch of line.text) {
			const g = font.glyphs[`${line.face}|${ch}`] || font.glyphs[`${line.face}|?`];
			if (!g) continue;
			if (g.cell >= 0 && g.w > 0) {
				const x0 = (pen + g.bx * line.size * sx), y0 = base - g.by * line.size;
				const w = g.w * line.size * sx, h = g.h * line.size;
				const cx = (g.cell % font.cols) * font.cell, cy = Math.floor(g.cell / font.cols) * font.cell;
				const u0 = cx / aw, u1 = (cx + font.cell) / aw, v0 = cy / ah, v1 = (cy + font.cell) / ah;
				const n = pos.length / 3;
				// drawn space is y-down; the mesh is y-up and centred
				const X = x => (x - DRAWN / 2) * unit, Y = y => (height / 2 - y) * unit;
				pos.push(X(x0), Y(y0), 0,  X(x0 + w), Y(y0), 0,  X(x0 + w), Y(y0 + h), 0,  X(x0), Y(y0 + h), 0);
				uvs.push(u0, v0,  u1, v0,  u1, v1,  u0, v1);
				for (let k = 0; k < 4; k++) col.push(_c.r, _c.g, _c.b);
				idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
			}
			pen += g.adv * line.size * sx;
		}
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geo.setAttribute('colour', new THREE.Float32BufferAttribute(col, 3));
	geo.setIndex(idx);
	const m = new THREE.Mesh(geo, textMaterial());
	m.name = 'text';
	return m;
}
