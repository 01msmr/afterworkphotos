import * as THREE from '../vendor/three.module.js';

// ---------------------------------------------------------------------------
// Renderer, scene, camera

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = false;               // no cast shadows (Uli, 2026-09-05): the hard cut-outs looked wrong; the meshes keep their flags should they come back
document.getElementById('stage').appendChild(renderer.domElement);

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(66, 1, 0.05, 100);
// Everything built — room, pieces, lift — lives in `world`; the rig
// (the body) does not. A real room (phase 3) moves and turns `world` so
// its walls land on the real ones, while the body stays where it is.
export const world = new THREE.Group();
world.name = 'world';
scene.add(world);
export const rig = new THREE.Group();     // the body: on the bench at the origin, in VR the thing that walks
rig.name = 'rig';
rig.add(camera);
scene.add(rig);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');   // switched to bounded-floor at session start when the Quest has a boundary
const headPos = new THREE.Vector3();
export function head() { return camera.getWorldPosition(headPos); }   // where the eyes are, in the world

function resize() {
	renderer.setSize(innerWidth, innerHeight);
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
