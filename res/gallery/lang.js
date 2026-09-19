import { state } from 'gallery/state';

// the gallery's words in its languages; the sheet (paper.js) draws from T, everything else asks t()
export const T = {
	en: { title: 'options', dark: 'night mode', frame: 'frames', maple: 'maple', oak: 'oak', walnut: 'walnut', black: 'black', white: 'white', labels: 'labels', mat: 'with passepartouts', talk: 'guard talks more', raise: 'high ceiling', wire: 'wireframe', lang: 'language', en: 'English', de: 'German', favourites: 'favourites' },
	de: { title: 'Einstellungen', dark: 'Nachtmodus', frame: 'Bilderrahmen', maple: 'Ahorn', oak: 'Eiche', walnut: 'Nussbaum', black: 'schwarz', white: 'weiß', labels: 'Beschriftung', mat: 'mit Passepartouts', talk: 'Wärter redet mehr', raise: 'hohe Decke', wire: 'Drahtgitter', lang: 'Sprache', en: 'Englisch', de: 'Deutsch', favourites: 'Favoriten' },
};
export const t = key => (T[state.settings.lang] || T.en)[key] || T.en[key] || key;
