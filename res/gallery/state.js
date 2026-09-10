// ---------------------------------------------------------------------------
// State and settings
//
// Room defaults from the spec: 6 × 4 × 3 m. The eye stands at 1.6 m, frames
// centre at 1.5 m. Light mode is the white cube; dark mode is the same room
// at night, ambient almost off, the spots alone.

const DEFAULTS = { W: 6, D: 4, H: 3, dark: false, frame: 'maple', mat: 'white', scale: 1, labels: true };

// Settings come from the defaults, then what the switchboard saved last
// time (localStorage 'galleryS'), then the URL — /gallery/?frame=black
// &dark=1&mat=warm&scale=80&labels=0&W=8&D=5 — so a look can be shared.
export function loadSettings() {
	const s = { ...DEFAULTS };
	try { Object.assign(s, JSON.parse(localStorage.getItem('galleryS')) || {}); } catch (e) {}
	const q = new URLSearchParams(location.search);
	for (const k of Object.keys(DEFAULTS)) {
		if (!q.has(k)) continue;
		const v = q.get(k);
		if (k === 'dark' || k === 'labels') s[k] = v === '1' || v === 'true';
		else if (k === 'scale') s[k] = Number(v) > 1 ? Number(v) / 100 : Number(v);
		else if (k === 'W' || k === 'D' || k === 'H') s[k] = Number(v);
		else s[k] = v;
	}
	if (!(s.frame in FRAME_COLOURS_KEYS)) s.frame = DEFAULTS.frame;
	if (!['white', 'warm', 'none'].includes(s.mat)) s.mat = DEFAULTS.mat;
	if (![1, 0.8].includes(s.scale)) s.scale = DEFAULTS.scale;
	for (const k of ['W', 'D', 'H']) if (!(s[k] >= 2 && s[k] <= 40)) s[k] = DEFAULTS[k];
	return s;
}
const FRAME_COLOURS_KEYS = { maple: 1, oak: 1, walnut: 1, black: 1, white: 1 };

// settings.W/D is the smallest room; room.W/D is the one standing, which a
// crowded year may have grown (see hangYear).
export const state = { year: null, roomKey: null, settings: loadSettings(), room: null, real: null, photos: [], obstacles: [] };   // obstacles: the middle rows' footprints, for the bench's walk

export const EYE = 1.6;
const HANG_Y = 1.5;   // a piece's centre, the gallery's line
export const HANG_MAX = 1.65;   // the highest a centre goes (Uli: not too high) — a dado that would ask more drops instead
// Where a piece of height h hangs: on the line, or just enough higher
// to clear the room's dado (state.dadoCap) by a hand's width.
export function pieceY(h) { return Math.max(HANG_Y, (state.dadoCap || 0) + 0.15 + h / 2); }
