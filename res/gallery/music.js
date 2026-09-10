import { elevator, lift } from './elevator.js?v=20260911y';
import { head, world } from './scene.js?v=20260911y';

// ---------------------------------------------------------------------------
// The music in the lift
//
// Low-key jazz, the kind a lift has: a soft electric piano on seventh
// chords, a walking bass under it and brushes on two and four (Uli,
// 2026-09-11). Four short pieces, and the next one in turn starts every
// time someone steps into the cabin.
//
// Nothing is downloaded: the pieces are played here, note by note,
// through the same audio the lift's sounds use — a file of real music
// would be someone else's to license, and this way the whole gallery
// stays four files of sound.
//
// It is loudest in the cabin and falls away across the room, and with the
// doors shut there is nothing to hear outside at all (Uli).

const BPM = [72, 80, 76, 88];
// ii - V - I - VI, the turnaround every lift knows, in four keys. Each
// chord is a root (a semitone count from A) and the thirds above it.
const CHORDS = [
	[[2, 'm7'], [7, '7'], [0, 'maj7'], [9, 'm7']],      // Bm7 E7 Amaj7 F#m7
	[[5, 'm7'], [10, '7'], [3, 'maj7'], [0, 'm7']],     // Dm7 G7 Cmaj7 Am7
	[[9, 'm7'], [2, '7'], [7, 'maj7'], [4, 'm7']],      // F#m7 B7 Emaj7 C#m7
	[[7, 'm7'], [0, '7'], [5, 'maj7'], [2, 'm7']],      // Em7 A7 Dmaj7 Bm7
];
const SHAPE = { m7: [0, 3, 7, 10], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11] };
const A4 = 440;
const hz = (semis, octave) => A4 * Math.pow(2, semis / 12 + octave);

const FAR = 7;              // metres: past this, nothing carries
const NEAR = 1.2;           // inside the cabin, in effect
const LOUD = 0.5;           // its loudest, against the lift's own sounds
const RISE = 0.12;          // how fast the loudness follows you

let track = 0, gain = null, filter = null, nextBar = 0, bar = 0, want = 0, has = 0, wasIn = false;

function open() {
	if (gain || !lift.ctx) return gain;
	const ctx = lift.ctx;
	filter = ctx.createBiquadFilter();
	filter.type = 'lowpass'; filter.frequency.value = 2600; filter.Q.value = 0.4;   // through the cabin's walls
	gain = ctx.createGain(); gain.gain.value = 0;
	filter.connect(gain); gain.connect(ctx.destination);
	return gain;
}

// A soft key: two detuned triangles under a slow attack and a long tail.
function key(at, f, dur, level) {
	const ctx = lift.ctx;
	const g = ctx.createGain();
	g.gain.setValueAtTime(0.0001, at);
	g.gain.exponentialRampToValueAtTime(level, at + 0.04);
	g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
	for (const detune of [-4, 4]) {
		const o = ctx.createOscillator();
		o.type = 'triangle'; o.frequency.value = f; o.detune.value = detune;
		o.connect(g); o.start(at); o.stop(at + dur + 0.05);
	}
	g.connect(filter);
}
// The bass: one round sine, plucked.
function bass(at, f, dur) {
	const ctx = lift.ctx;
	const g = ctx.createGain();
	g.gain.setValueAtTime(0.0001, at);
	g.gain.exponentialRampToValueAtTime(0.5, at + 0.02);
	g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
	const o = ctx.createOscillator();
	o.type = 'sine'; o.frequency.setValueAtTime(f, at);
	o.connect(g); o.start(at); o.stop(at + dur + 0.05);
	g.connect(filter);
}
// A brush on the snare: a short breath of noise, high and soft.
function brush(at) {
	const ctx = lift.ctx;
	const n = ctx.createBufferSource();
	const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.12), ctx.sampleRate);
	const d = b.getChannelData(0);
	for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
	n.buffer = b;
	const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3800;
	const g = ctx.createGain(); g.gain.value = 0.08;
	n.connect(hp); hp.connect(g); g.connect(filter);
	n.start(at);
}

// One bar of the piece: the chord held, the bass walking under it, the
// brushes on two and four.
function playBar(at, beat) {
	const chord = CHORDS[track][bar % 4];
	const [root, kind] = chord;
	SHAPE[kind].forEach((s, i) => key(at + i * 0.012, hz(root + s, 0), beat * 3.4, 0.09));
	const walk = [0, 7, 12, 7];
	for (let b = 0; b < 4; b++) {
		bass(at + b * beat, hz(root + walk[b], -2), beat * 0.9);
		if (b === 1 || b === 3) brush(at + b * beat);
	}
	bar++;
}

// How loud it should be from where you stand: full in the cabin, less
// across the room, nothing at all outside a shut cabin.
function level() {
	if (!elevator.origin) return 0;
	const o = elevator.origin, h = world.worldToLocal(head().clone());   // the cabin stands in the room's own frame
	const d = Math.hypot(h.x - o.x, h.z - o.z);
	const inside = elevator.inside();
	if (!inside && elevator.open < 0.5) return 0;                     // the doors are shut: a sealed box
	if (inside) return LOUD;
	return LOUD * Math.max(0, 1 - Math.max(0, d - NEAR) / (FAR - NEAR));
}

export function stepMusic(now) {
	if (!lift.ctx || lift.ctx.state !== 'running') return;
	if (!open()) return;
	// the next piece each time someone steps in (Uli)
	const inside = elevator.inside();
	if (inside && !wasIn) { track = (track + 1) % CHORDS.length; bar = 0; }
	wasIn = inside;

	want = level();
	has += (want - has) * RISE;
	gain.gain.setTargetAtTime(Math.max(0, has), lift.ctx.currentTime, 0.08);
	if (has < 0.002 && want === 0) { nextBar = 0; return; }           // nothing to hear, nothing to schedule

	const beat = 60 / BPM[track], barLen = beat * 4;
	const t = lift.ctx.currentTime;
	if (!nextBar || nextBar < t) nextBar = t + 0.08;
	while (nextBar < t + 0.6) { playBar(nextBar, beat); nextBar += barLen; }   // half a second ahead, no more
}
