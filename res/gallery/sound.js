import { elevator } from 'gallery/elevator';
import { head } from 'gallery/scene';

// ---------------------------------------------------------------------------
// The lift's sounds (out of elevator.js on 2026-09-19)

// The sound of the lift: Uli's recordings in res/sound/. ride.mp3 has a
// start and run (0.6–8.4 s), the stop (8.4–11.7 s) and the doors opening
// (13.3–15.3 s); a ride plays the start and as much run as it needs, then
// the stop; every door movement plays the door segment. bell.mp3, when
// there is one, rings on arrival; until then the arrival in call.mp3
// (15.4–18.6 s) stands in. The audio context has to be born of a press,
// so it is made on the first ride; the files are fetched at load and
// decoded then.
export const SOUND = {
	ride:  { file: '/res/sound/ride.mp3', run: [0.6, 8.4], stop: [8.4, 11.7], door: [13.3, 15.3] },
	bell:  { file: '/res/sound/bell.mp3' },
	call:  { file: '/res/sound/call.mp3', hum: [1.0, 6.0] },        // the lift coming, heard from outside
};
const STOP_LEN = SOUND.ride.stop[1] - SOUND.ride.stop[0];

export const lift = {
	ctx: null, master: null, raw: {}, buf: {},
	// Fetch and decode at load: a context made before any press starts
	// suspended but decodes fine, so the first ride has its sound ready.
	fetchAll() {
		this.open();
		for (const [k, v] of Object.entries(SOUND)) {
			fetch(v.file).then(r => r.ok ? r.arrayBuffer() : null).then(b => { if (b) { this.raw[k] = b; this.decode(); } }).catch(() => {});
		}
	},
	open() {
		if (this.ctx) return true;
		try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return false; }
		this.master = this.ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(this.ctx.destination);
		return true;
	},
	ready() {
		if (!this.open()) return false;
		if (this.ctx.state === 'suspended') this.ctx.resume();
		this.decode();
		return true;
	},
	decode() {
		if (!this.ctx) return;
		for (const k of Object.keys(this.raw)) {
			if (this.buf[k] || this.buf[k] === false) continue;
			this.buf[k] = false;                              // decoding
			this.ctx.decodeAudioData(this.raw[k].slice(0)).then(b => { this.buf[k] = b; }).catch(() => { delete this.buf[k]; });
		}
	},
	// play buffer `k` from `from` for `dur` seconds at time `at`, faded in and out
	// `muffle`: a low-pass at that many Hz, for a sound heard through a door
	play(k, from, dur, at = null, gain = 1, fadeIn = 0.05, fadeOut = 0.12, muffle = 0) {
		const b = this.buf[k];
		if (!b) return null;
		const ctx = this.ctx, t = at ?? ctx.currentTime;
		const src = ctx.createBufferSource(); src.buffer = b;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + fadeIn);
		g.gain.setValueAtTime(gain, t + dur - fadeOut);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(g);
		if (muffle) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = muffle; g.connect(f); f.connect(this.master); }
		else g.connect(this.master);
		src.start(t, from, dur + 0.02);
		return src;
	},
	// a ride of `seconds`: the start and the run for what is left after
	// the stop — the recording's run played over again, overlapping a
	// little, when the ride outlasts it — then the stop
	run(seconds) {
		if (!this.ready() || !this.buf.ride) return;
		const R = SOUND.ride, ctx = this.ctx, t = ctx.currentTime;
		const runLen = Math.max(0.4, seconds - STOP_LEN);
		// one source: the recording from its start, its steady middle looped
		// for as long as the ride runs (Uli: a ride must not start over)
		const src = ctx.createBufferSource(); src.buffer = this.buf.ride;
		src.loop = true; src.loopStart = R.run[0] + 2.0; src.loopEnd = R.run[1] - 0.2;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.03);
		g.gain.setValueAtTime(1, t + runLen - 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + runLen);
		src.connect(g); g.connect(this.master);
		src.start(t, R.run[0]); src.stop(t + runLen + 0.02);
		this.play('ride', R.stop[0], STOP_LEN, t + runLen - 0.1, 1, 0.1, 0.2);
	},
	// The doors: a lift has two, the cabin's and the shaft's, moving as
	// one — the near door is heard plain, the far one through it: a beat
	// behind, at a third, muffled (Uli). Both fall away with the distance
	// from the doors: full within a metre, a quarter at 2.5 m.
	slide() {
		if (!this.ready()) return;
		const R = SOUND.ride, t = this.ctx.currentTime;
		const d = elevator.doorsWorld ? head().distanceTo(elevator.doorsWorld()) : 1;
		const gain = 0.9 * Math.min(1, Math.pow(1 / Math.max(d, 1), 1.5));
		this.play('ride', R.door[0], R.door[1] - R.door[0], t, gain, 0.03, 0.15);
		this.play('ride', R.door[0], R.door[1] - R.door[0], t + 0.07, gain * 0.33, 0.03, 0.15, 900);
	},
	// a button's click: a short burst of band-passed noise with a tick on
	// top, made here, no file
	click() {
		if (!this.ready()) return;
		const ctx = this.ctx, t = ctx.currentTime, n = Math.floor(ctx.sampleRate * 0.03);
		const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
		for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
		const src = ctx.createBufferSource(); src.buffer = b;
		const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 1.2;
		const g = ctx.createGain(); g.gain.value = 0.44;
		src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
		const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(1900, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.025);
		const og = ctx.createGain(); og.gain.setValueAtTime(0.15, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
		o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.05);
	},
	bell() {
		if (!this.ready() || !this.buf.bell) return;
		this.play('bell', 0, this.buf.bell.duration, null, 1, 0.01, 0.1);
	},
	// the hum of the lift coming, for `seconds`, while you wait outside
	hum(seconds) {
		if (!this.ready()) return;
		const C = SOUND.call;
		this.play('call', C.hum[0], Math.min(seconds, C.hum[1] - C.hum[0]), null, 0.8, 0.3, 0.6);
	},
};
lift.fetchAll();

