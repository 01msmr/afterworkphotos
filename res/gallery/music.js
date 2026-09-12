import { elevator, lift } from './elevator.js?v=20260913h';
import { head, world } from './scene.js?v=20260913h';

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
const DUCK = 0.33;          // what is left of it while the guard speaks


const buffers = new Map();  // file -> AudioBuffer
let at = -1, gain = null, filter = null, source = null, has = 0, starting = false;

function open() {
	if (gain || !lift.ctx) return gain;
	const ctx = lift.ctx;
	filter = ctx.createBiquadFilter();
	filter.type = 'lowpass'; filter.frequency.value = 2400; filter.Q.value = 0.3;   // heard through steel
	gain = ctx.createGain(); gain.gain.value = 0;
	filter.connect(gain); gain.connect(ctx.destination);
	return gain;
}

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
// across the room, nothing at all outside a shut one.
function level() {
	if (!elevator.origin) return 0;
	const o = elevator.origin, h = world.worldToLocal(head().clone());   // the cabin stands in the room's own frame
	const d = Math.hypot(h.x - o.x, h.z - o.z);
	if (elevator.inside()) return LOUD;
	if (elevator.open < 0.5) return 0;                        // the doors are shut: a sealed box
	return LOUD * Math.max(0, 1 - Math.max(0, d - NEAR) / (FAR - NEAR));
}

export function stepMusic(now) {
	if (!lift.ctx || lift.ctx.state !== 'running' || !open()) return;
	const want = level() * (performance.now() < duckUntil ? DUCK : 1);
	// it begins the first time anyone comes near enough to hear it, and
	// from then on it plays on, piece after piece
	if (!source && !starting && want > 0.002) start();
	if (!source && has < 0.001) return;

	has += (want - has) * RISE;
	gain.gain.setTargetAtTime(Math.max(0, has), lift.ctx.currentTime, 0.08);
}

// The guard talks over it: while he is speaking the music steps back to
// a third and comes up again after (Uli, 2026-09-12 — both at once, which
// is what a real lobby does). `seconds` is how long the line lasts.
let duckUntil = 0;
export function duckMusic(seconds) { duckUntil = Math.max(duckUntil, performance.now() + seconds * 1000 + 250); }

// What is playing and how loud, for the bench's checks.
export function playing() { return source ? TRACKS[at].name : null; }
export function musicLevel() { return +has.toFixed(3); }
