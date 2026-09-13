// ---------------------------------------------------------------------------
// State and settings
//
// Room defaults from the spec: 6 × 4 × 3 m. The eye stands at 1.6 m, frames
// centre at 1.5 m. Light mode is the white cube; dark mode is the same room
// at night, ambient almost off, the spots alone.

const DEFAULTS = { W: 6, D: 4, H: 3, dark: false, frame: 'maple', mat: 'white', scale: 1, labels: true, plan: 'grid', raise: 0, fill: false, talk: 'light' };   // plan: what a scanned room is made of (Uli, 2026-09-10) — see PLANS

// Settings come from the defaults, then what the switchboard saved last
// time (localStorage 'galleryS'), then the URL — /gallery/?frame=black
// &dark=1&mat=warm&scale=80&labels=0&W=8&D=5 — so a look can be shared.
// The three ways a scanned room becomes a plan (Uli, 2026-09-10): the
// main rectangle with its 50 cm extensions — an L or a U as scanned —
// the main rectangle alone, or the rectangle round the whole scan.
export const PLANS = ['grid', 'inside', 'around'];
// A metre more room over your head, or none — kept over every floor, so
// the whole lift is high or none of it is (Uli, 2026-09-10).
export const RAISES = [0, 1];
export function loadSettings() {
	const s = { ...DEFAULTS };
	try { Object.assign(s, JSON.parse(localStorage.getItem('galleryS')) || {}); } catch (e) {}
	// **The night is never remembered** (Uli, 2026-09-13): every visit opens
	// in the light room, whatever the switchboard was left on last time. The
	// switch still works, and ?dark=1 still shares a look — it is only the
	// saved value that is dropped, so nobody arrives in the dark by accident.
	s.dark = DEFAULTS.dark;
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
	if (!PLANS.includes(s.plan)) s.plan = DEFAULTS.plan;
	s.raise = RAISES.includes(Number(s.raise)) ? Number(s.raise) : DEFAULTS.raise;
	s.fill = s.fill === true || s.fill === '1' || s.fill === 'true';   // which way round a print rests (Uli, 2026-09-11)
	if (!['light', 'heavy'].includes(s.talk)) s.talk = DEFAULTS.talk;   // how much the guard says (Uli, 2026-09-12)
	if (![1, 0.8].includes(s.scale)) s.scale = DEFAULTS.scale;
	for (const k of ['W', 'D', 'H']) if (!(s[k] >= 2 && s[k] <= 40)) s[k] = DEFAULTS[k];
	return s;
}
const FRAME_COLOURS_KEYS = { maple: 1, oak: 1, walnut: 1, black: 1, white: 1 };

// settings.W/D is the smallest room; room.W/D is the one standing, which a
// crowded year may have grown (see hangYear).
// The red dots a visitor has stuck on (Uli, 2026-09-13). Theirs alone —
// kept in localStorage beside the settings, never sent anywhere — and the
// `favorites` floor is hung from them. A photograph is remembered by its
// id, not its number, so adding an older photograph to the site does not
// shift somebody's favourites onto other pictures.
export const FAVS_KEY = 'galleryF';
function loadFavs() {
	try { const a = JSON.parse(localStorage.getItem(FAVS_KEY)); return new Set(Array.isArray(a) ? a : []); } catch (e) { return new Set(); }
}
export function isFav(id) { return state.favs.has(id); }
export function favCount() { return state.favs.size; }
export function toggleFav(id) {
	state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
	try { localStorage.setItem(FAVS_KEY, JSON.stringify([...state.favs])); } catch (e) {}
	return state.favs.has(id);
}

export const state = {
	seen: {},           // floors already walked (Uli, 2026-09-11): their buttons go grey
	favs: loadFavs(),   // the photographs with a red dot on them (Uli, 2026-09-13)
	year: null, roomKey: null, settings: loadSettings(), room: null, real: null, photos: [], obstacles: [] };   // obstacles: the middle rows' footprints, for the bench's walk

export const EYE = 1.6;
const HANG_Y = 1.5;   // a piece's centre, the gallery's line
export const HANG_MAX = 1.65;   // the highest a centre goes (Uli: not too high) — a dado that would ask more drops instead
// Where a piece of height h hangs: on the line, or just enough higher
// to clear the room's dado (state.dadoCap) by a hand's width.
export function pieceY(h) { return Math.max(HANG_Y, (state.dadoCap || 0) + 0.15 + h / 2); }
