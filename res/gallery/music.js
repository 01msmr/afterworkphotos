import { elevator, lift } from './elevator.js?v=20260915o';
import * as THREE from '../vendor/three.module.js';
import { camera, head, world } from './scene.js?v=20260915o';

// ---------------------------------------------------------------------------
// The music in the lift
//
// Seven pieces of lounge jazz, playing one after another in the cabin
// from the first time anyone comes near it — quiet ones, none of them
// harsh or quick: Kevin MacLeod's, under Creative Commons Attribution, the
// credit in res/sound/LICENSE.txt. Ninety seconds of each, mono, so the
// seven together weigh less than one of the gallery's photographs.
//
// It is loudest in the cabin and falls away across the room, and with the
// doors shut there is nothing to hear outside at all (Uli). Nothing is
// fetched until the first ride: a visitor who never takes the lift never
// pays for the music.

const TRACKS = [
	{ file: 'jazz-backbay.mp3',   name: 'Backbay Lounge' },
	{ file: 'jazz-bossa.mp3',     name: 'Bossa Antigua' },
	{ file: 'jazz-apero.mp3',     name: 'Apero Hour' },
	{ file: 'jazz-crinoline.mp3', name: 'Crinoline Dreams' },
	{ file: 'jazz-noel.mp3',      name: 'Nouvelle Noel' },
	{ file: 'jazz-deuces.mp3',    name: 'Deuces' },
	{ file: 'jazz-smooth.mp3',    name: "Smooth Lovin'" },
];

const FAR = 4;              // metres: past this, nothing carries (Uli, 2026-09-12: heard at two and
                            // four metres, less loud, and gone after four)
const NEAR = 1.2;           // as good as inside the cabin
const LOUD = 0.42;          // its loudest, against the lift's own sounds
const RISE = 0.1;           // how fast the loudness follows you


const buffers = new Map();  // file -> AudioBuffer
let at = -1, gain = null, filter = null, source = null, has = 0, starting = false;

// It plays **out of the cabin**, not out of the middle of your head (Uli,
// 2026-09-12): a panner set where the lift stands, so it comes from that
// side of the room and swings round you as you turn. The panner is asked
// only for the direction — its own distance rolloff is switched off and
// the loudness stays with `level()`, which Uli tuned.
let panner = null;
function open() {
	if (gain || !lift.ctx) return gain;
	const ctx = lift.ctx;
	filter = ctx.createBiquadFilter();
	filter.type = 'lowpass'; filter.frequency.value = 2400; filter.Q.value = 0.3;   // heard through steel
	gain = ctx.createGain(); gain.gain.value = 0;
	panner = ctx.createPanner();
	panner.panningModel = 'HRTF'; panner.distanceModel = 'linear';
	panner.refDistance = 1; panner.maxDistance = 1000; panner.rolloffFactor = 0;
	filter.connect(gain); gain.connect(panner); panner.connect(ctx.destination);
	return gain;
}
// Where the ears are, and where the cabin is. The listener follows the
// head every frame; both the music and the guard's voice hang off it.
const _e = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3();
export function earsAt(ctx) {
	const l = ctx.listener, h = head();
	camera.getWorldDirection(_f);
	_u.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
	if (l.positionX) {
		const t = ctx.currentTime;
		l.positionX.setValueAtTime(h.x, t); l.positionY.setValueAtTime(h.y, t); l.positionZ.setValueAtTime(h.z, t);
		l.forwardX.setValueAtTime(_f.x, t); l.forwardY.setValueAtTime(_f.y, t); l.forwardZ.setValueAtTime(_f.z, t);
		l.upX.setValueAtTime(_u.x, t); l.upY.setValueAtTime(_u.y, t); l.upZ.setValueAtTime(_u.z, t);
	} else if (l.setPosition) {                              // the older way, still all some browsers have
		l.setPosition(h.x, h.y, h.z);
		l.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z);
	}
}
function pannerAt(p, v) {
	if (!p) return;
	if (p.positionX) { const t = lift.ctx.currentTime; p.positionX.setValueAtTime(v.x, t); p.positionY.setValueAtTime(v.y, t); p.positionZ.setValueAtTime(v.z, t); }
	else p.setPosition(v.x, v.y, v.z);
}
export { pannerAt };

async function load(file) {
	if (buffers.has(file)) return buffers.get(file);
	buffers.set(file, null);                                  // one fetch, however often it is asked for
	try {
		const r = await fetch('/res/sound/' + file);
		const b = await lift.ctx.decodeAudioData(await r.arrayBuffer());
		buffers.set(file, b);
		return b;
	} catch (e) { console.warn('music', file, e); return null; }
}

// The next piece in turn, from its top. **Once it is playing it never
// stops** (Uli, 2026-09-12: as in the real world) — the lift's music is
// on whether anyone is listening or not; walking away only turns it down.
// When a piece ends the next one begins, so the seven go round for ever.
async function start() {
	if (starting) return;
	starting = true;
	at = (at + 1) % TRACKS.length;
	const b = await load(TRACKS[at].file);
	starting = false;
	if (!b || !gain) return;
	if (source) { try { source.onended = null; source.stop(); } catch (e) {} source.disconnect(); }
	source = lift.ctx.createBufferSource();
	source.buffer = b; source.loop = false;
	source.connect(filter);
	source.onended = () => { source = null; start(); };     // straight on to the next
	source.start();
}

// How loud it should be from where you stand: full in the cabin, less
// across the room, a trace through shut doors, and nothing at all once
// the cabin has left the floor you are standing on.
const SHUT = 0.05;          // through a shut door, the cabin still here (Uli, 2026-09-13: 5%)
function level() {
	if (!elevator.origin) return 0;
	const o = elevator.origin, h = world.worldToLocal(head().clone());   // the cabin stands in the room's own frame
	const d = Math.hypot(h.x - o.x, h.z - o.z);
	if (elevator.inside()) return LOUD;
	// **the cabin is not on this floor** — travelling without you, or away
	// and humming its way back after a call. There is nothing behind those
	// doors to hear (Uli, 2026-09-13)
	if (elevator.ride || elevator.coming) return 0;
	const near = LOUD * Math.max(0, 1 - Math.max(0, d - NEAR) / (FAR - NEAR));
	// shut, but standing right there: it was a sealed box until 2026-09-13,
	// and a lift with music in it is not silent from outside — you hear it
	// the way you hear a lobby through a door (Uli)
	return elevator.open < 0.5 ? near * SHUT : near;
}

export function stepMusic(now) {
	if (!lift.ctx || lift.ctx.state !== 'running' || !open()) return;
	earsAt(lift.ctx);                                         // the listener rides with the head
	// out of the **seam between the doors**, not the middle of the cabin (Uli, 2026-09-12)
	if (elevator.origin && elevator.doorsWorld) pannerAt(panner, elevator.doorsWorld().clone().setY(1.3));   // the cabin is not there on the first frames
	const want = level();
	// it begins the first time anyone comes near enough to hear it, and
	// from then on it plays on, piece after piece
	if (!source && !starting && want > 0.002) start();
	if (!source && has < 0.001) return;

	has += (want - has) * RISE;
	gain.gain.setTargetAtTime(Math.max(0, has), lift.ctx.currentTime, 0.08);
}

// **The music is never turned down for him** (Uli, 2026-09-13). It stepped
// back to a third while he spoke, from 2026-09-12; a lobby does do that,
// but the dip itself was the thing you heard. He picks his moment instead
// — guard.js will not start a line while the music is up — and once he has
// started he finishes, music or no music (QUIET, and his longest line is
// under 15 s, so he never runs on over it for longer than that).

// What is playing and how loud, for the bench's checks.
export function playing() { return source ? TRACKS[at].name : null; }
export function musicLevel() { return +has.toFixed(3); }
