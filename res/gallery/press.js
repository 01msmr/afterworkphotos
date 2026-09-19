import * as THREE from '../vendor/three.module.js';
import { elevator } from 'gallery/elevator';
import { FAV_KEY, clearRooms, rooms } from 'gallery/hang';
import { paper } from 'gallery/paper';
import { stripLift } from 'gallery/strip';
import { camera, scene } from 'gallery/scene';
import { favCount, state } from 'gallery/state';
import { stickAt } from 'gallery/sticker';
import { zoomLabel, zoomPrint } from 'gallery/zoom';

// ---------------------------------------------------------------------------
// A press: what the trigger (or the bench's click) does along its ray —
// the sheet, a button, a sticker's place, a label, a print, in that order.
// And the bench's floor list on F. (Out of elevator.js on 2026-09-19.)

// Picking a button: a ray from the pointer while it is free, from the
// middle of the view while it is taken.
const raycaster = new THREE.Raycaster();
export function pressAt(ndcX, ndcY) {
	if (!elevator.buttons.length) return false;
	raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
	return pressAlong(raycaster, 2.2);
}
export function pressAlong(rc, reach, hand = null) {
	if (stripLift.press(rc, hand)) return true;    // the instant lift's strip, then the sheet, before anything else
	if (paper.press(rc)) return true;
	const hit = rc.intersectObjects([...elevator.buttons, ...elevator.callButtons], false)[0];
	if (hit && hit.distance <= reach) {
		const u = hit.object.userData;
		if (u.call) elevator.call();
		// a dead favourites button takes the press and does nothing with it:
		// no dip, no bell, the lift stays where it is (Uli, 2026-09-13)
		else if (String(u.key).startsWith(FAV_KEY) && !favCount()) return true;
		else if (elevator.inside()) { elevator.press(u.key, hit.object); elevator.go(u.key); }   // a floor is chosen from inside the cabin only (Uli)
		return true;
	}
	// **a red dot first** (Uli, 2026-09-13): where the pointer has come
	// within reach of the place a sticker goes, the press sticks one on —
	// or takes off the one already there — and gets no further.
	// the floor list and the button follow at once: a first dot lights the
	// favourites button, the last one taken off puts it out again
	if (stickAt()) { clearRooms(); rooms(); elevator.light(state.roomKey); return true; }
	// a label card: a press doubles it, the next press puts it back; a
	// print: a press fills its frame over the mat, the next puts it back
	// (Uli, 2026-09-11). Both come back by themselves once out of sight —
	// zoom.js keeps that.
	const pieces = scene.getObjectByName('pieces');
	if (pieces) {
		const labels = [], prints = [];
		pieces.traverse(o => {
			if (o.name === 'label' && o.visible) labels.push(o);
			else if (o.name === 'photo' && o.visible) prints.push(o);
			// the pane over the frame's opening: never drawn, but pressed
			else if (o.name === 'photo-area') prints.push(o);
		});
		const l = rc.intersectObjects(labels, false)[0];
		if (l && l.distance <= 4) return zoomLabel(l.object.parent.userData.labels);
		const ph = rc.intersectObjects(prints, false)[0];
		if (ph && ph.distance <= 6) return zoomPrint(ph.object.userData.print || ph.object);   // a press on the mat is a press on its picture
	}
	return false;
}

// The bench's overlay: Y lists the floors.
export const floors = document.getElementById('floors');
function renderFloors() {
	floors.innerHTML = rooms().map(r =>
		`<button data-key="${r.key}"${r.key === state.roomKey ? ' aria-current="true"' : ''}>${r.favs ? r.span : r.years.length > 1 ? `${r.years[0]}<small>\u2013${r.years[r.years.length - 1]}</small>` : r.year}${r.of > 1 ? `<small>.${r.part}</small>` : ''}</button>`).join('');
}
floors.addEventListener('click', e => {
	const b = e.target.closest('button');
	if (!b) return;
	floors.hidden = true;
	elevator.press(b.dataset.key);
	elevator.go(b.dataset.key);
});
addEventListener('keydown', e => {
	if (e.code === 'KeyF') { floors.hidden = !floors.hidden; if (!floors.hidden) renderFloors(); }   // F lists the floors — Y turns now (Uli)
	if (e.code === 'Escape') floors.hidden = true;
});

// ---------------------------------------------------------------------------
