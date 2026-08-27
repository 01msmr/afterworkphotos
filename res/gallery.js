// three.js 0.180.0, vendored (MIT) — res/vendor/three.module.js, which in
// turn imports res/vendor/three.core.js; both are pinned together.
import * as THREE from './vendor/three.module.js';

// ---------------------------------------------------------------------------
// State and settings
//
// Room defaults from the spec: 6 × 4 × 3 m. The eye stands at 1.6 m, frames
// centre at 1.5 m. Light mode is the white cube; dark mode is the same room
// at night, ambient almost off, the spots alone.

const DEFAULTS = { W: 6, D: 4, H: 3, dark: false };

const state = { year: null, settings: { ...DEFAULTS }, photos: [] };

const EYE = 1.6;

// ---------------------------------------------------------------------------
// Renderer, scene, camera

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(66, 1, 0.05, 100);

function resize() {
	renderer.setSize(innerWidth, innerHeight);
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// The room
//
// A group named "room" encloses [-W/2..W/2] × [0..H] × [-D/2..D/2]: a floor,
// four walls, a ceiling, each a named plane facing inward, plus the base
// lights. North is -z (the wall the camera faces on arrival), east is +x.
// Wall and ambient values are what applyMode() switches; the spots that
// light each piece come later (task 1.3) and go in their own group.

const COLOURS = {
	wall:    { light: 0xf2f1ee, dark: 0x1b1b1b },
	floor:   { light: 0xc9c6c0, dark: 0x2a2927 },
	ceiling: { light: 0xffffff, dark: 0x141414 },
};

const AMBIENT = { light: 0.55, dark: 0.08 };

function buildRoom(W, D, H) {
	const room = new THREE.Group();
	room.name = 'room';

	const mode = state.settings.dark ? 'dark' : 'light';
	const mat = key => new THREE.MeshLambertMaterial({ color: COLOURS[key][mode] });

	// Each surface: a plane sized to its span, rotated to face the room's
	// inside, positioned on the boundary. PlaneGeometry lies in xy facing +z.
	const surface = (name, key, w, h, pos, rot) => {
		const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(key));
		m.name = name;
		m.position.set(...pos);
		m.rotation.set(...rot);
		m.receiveShadow = true;
		m.userData.surface = key;
		room.add(m);
	};

	surface('floor',   'floor',   W, D, [0, 0, 0],       [-Math.PI / 2, 0, 0]);
	surface('ceiling', 'ceiling', W, D, [0, H, 0],       [ Math.PI / 2, 0, 0]);
	surface('wall-n',  'wall',    W, H, [0, H / 2, -D / 2], [0, 0, 0]);
	surface('wall-s',  'wall',    W, H, [0, H / 2,  D / 2], [0, Math.PI, 0]);
	surface('wall-e',  'wall',    D, H, [ W / 2, H / 2, 0], [0, -Math.PI / 2, 0]);
	surface('wall-w',  'wall',    D, H, [-W / 2, H / 2, 0], [0,  Math.PI / 2, 0]);

	const ambient = new THREE.AmbientLight(0xffffff, AMBIENT[mode]);
	ambient.name = 'ambient';
	room.add(ambient);

	// A warm wash from above and slightly behind the viewer, so the walls
	// have a base tone before any spot is on. Shadows come from the spots.
	const wash = new THREE.DirectionalLight(0xfff2e0, 0.25);
	wash.name = 'wash';
	wash.position.set(0, H, D / 4);
	wash.target.position.set(0, 0, -D / 4);
	room.add(wash, wash.target);

	return room;
}

// Switch between the white cube and the room at night without rebuilding:
// every surface remembers which colour family it belongs to.
function applyMode(dark) {
	state.settings.dark = dark;
	const mode = dark ? 'dark' : 'light';
	const room = scene.getObjectByName('room');
	if (!room) return;
	room.traverse(o => {
		if (o.isMesh && o.userData.surface) o.material.color.setHex(COLOURS[o.userData.surface][mode]);
		if (o.isAmbientLight) o.intensity = AMBIENT[mode];
	});
}

// ---------------------------------------------------------------------------
// Boot

fetch('photos.json', { cache: 'no-cache' })
	.then(r => r.json())
	.then(d => { state.photos = d.photos; init(); });

function init() {
	const { W, D, H } = state.settings;
	scene.add(buildRoom(W, D, H));

	// Arrival: standing a little back from the middle, eye height, facing north.
	camera.position.set(0, EYE, 1.5);
	camera.lookAt(0, EYE, -D / 2);
}

renderer.setAnimationLoop(() => renderer.render(scene, camera));

// Test-harness handle only: the plan's browser checks read the scene graph
// and camera through this. Nothing on the page uses it.
window.G = { scene, camera, renderer, state, buildRoom, applyMode };
