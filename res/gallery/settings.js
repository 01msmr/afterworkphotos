import { setWire, wire } from 'gallery/bench';
import { relabelConsole } from 'gallery/console';
import { elevator, roomLabel } from 'gallery/elevator';
import { MAT_COLOURS, applyFrameLook, materials } from 'gallery/frames';
import { clearRooms, firstRoom, hangRoom, raiseRoof, roomByKey, rooms } from 'gallery/hang';
import { refreshPaper } from 'gallery/paper';
import { applyMode } from 'gallery/room';
import { scene } from 'gallery/scene';
import { state } from 'gallery/state';
import { planAgain } from 'gallery/vr';
import { applyFill } from 'gallery/zoom';

// ---------------------------------------------------------------------------
// The options
//
// One table says what each option is and what changing it does (2026-09-19;
// it was a switch in elevator.js and a second list in paper.js saying the
// same things). `setSetting` looks the option up and applies it; the sheet
// (paper.js) draws the ones with a `sheet` entry, in the order given. An
// option that is not in `state.settings` (the wire) carries its own get
// and set; one whose box on the sheet means something other than its
// value says so in `sheet` — `inverted` for the passepartout (the box
// says the mat is there, the setting says the print fills the frame),
// `on`/`off` for a two-valued word.
//
// **No option reloads the room** (Uli): each applies in place — the fade,
// the frames' look, the labels' visibility, the prints' scale, the shell
// round the pieces for the ceiling. Only the bench's sizes (mat, scale,
// W, D, H) re-hang, and they are not on the sheet.

export const WOODS = ['maple', 'oak', 'walnut', 'black', 'white'];
export const LANGS = ['en', 'de'];
export const OPTIONS = [
	{ key: 'dark', sheet: { kind: 'check' }, apply(v) {
		applyMode(v);
		// night takes a dark wood with it and day a light one (Uli,
		// 2026-09-19) — unless the wood already suits; the wood switch
		// still goes wherever it is put afterwards
		const dark = ['walnut', 'black'].includes(state.settings.frame);
		if (v && !dark) setSetting('frame', 'walnut');
		else if (!v && dark) setSetting('frame', 'maple');
	} },
	{ key: 'frame', sheet: { kind: 'group', values: WOODS, rows: [3, 2] }, apply: v => applyFrameLook(materials.frame, v) },
	{ key: 'labels', sheet: { kind: 'check' }, apply: v => scene.traverse(o => { if (o.name === 'label' || o.name === 'label-rims') o.visible = v; }) },
	{ key: 'fill', sheet: { kind: 'check', word: 'mat', inverted: true }, apply: () => applyFill() },   // every print to the way it now rests
	{ key: 'talk', sheet: { kind: 'check', on: 'heavy', off: 'light' } },                              // the guard reads it as he speaks
	{ key: 'raise', sheet: { kind: 'check', on: 1, off: 0 }, apply: () => raiseRoof() },               // the shell only; the pictures stay as they hang
	{ key: 'wire', sheet: { kind: 'check' }, get: () => wire, set: v => setWire(v) },                   // the bench's wireframes; not saved
	// the sheet redraws itself; the console's words too — and the steel
	// plate outside and the displays, which carry the favourites floor's
	// word and kept the old language until the next ride (Uli, 2026-09-20)
	{ key: 'lang', sheet: { kind: 'group', values: LANGS, rows: [2] }, apply: () => { relabelConsole(); relabelFloor(); } },
	{ key: 'plan', apply: () => planAgain() },                                                          // the scan planned again
	{ key: 'mat', apply: v => { materials.mat.color.setHex(MAT_COLOURS[v]); rehang(); } },             // 'none' and back change the print's size
	// scale, W, D, H: the bench's sizes, a re-hang each (no entry: the default below)
];

// the floor's own name where it is written: the plate outside the cabin and
// the two displays (only they hold a word that a language changes)
function relabelFloor() {
	if (!state.roomKey) return;
	let name; try { name = roomLabel(roomByKey(state.roomKey)); } catch (e) { return; }
	elevator.engrave(name);
	if (!elevator.ride) elevator.show(name, '');
}

export function setSetting(k, v) {
	const o = OPTIONS.find(o => o.key === k);
	if (o && o.set) { if (o.get() !== v) o.set(v); refreshPaper(); return; }
	const s = state.settings;
	if (s[k] === v) return;
	s[k] = v;
	saveSettings();
	if (o && o.apply) o.apply(v); else if (!o) rehang();
	refreshPaper();
}
export function getSetting(k) {
	const o = OPTIONS.find(o => o.key === k);
	return o && o.get ? o.get() : state.settings[k];
}
function saveSettings() {
	try { localStorage.setItem('galleryS', JSON.stringify(state.settings)); } catch (e) {}
}
// the bench's sizes: every year planned afresh and the room hung again
function rehang() {
	clearRooms();                         // sizes may have changed which years split
	const wanted = state.roomKey;
	const key = rooms().some(r => r.key === wanted) ? wanted : rooms().find(r => r.year === state.year)?.key || firstRoom().key;
	state.room = null;                       // force the room and the cabin to rebuild
	hangRoom(key);
	elevator.setDoors(1);
}
