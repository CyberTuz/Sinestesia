// ── on-screen keys: a row of notes to tap, shown on phones and tablets (and on any screen, from the controls) ──

import { $, S, noteName } from '../core/state.js';
import { actions, feature, on } from '../core/bus.js';
import { degreeMidi } from '../core/pattern.js';
import { ac } from '../core/audio.js';
import { playNote } from '../core/input.js';

const COUNT = 10;
const row = $('#keys');
const toggleBtn = $('#b-keys');

// ten steps up the groove's scale, over two octaves: whatever you tap fits the music
const keys = Array.from({ length: COUNT }, (_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'key';
    b.dataset.i = i;
    row.appendChild(b);
    return b;
});

function label() {
    if (!S.pattern) return;
    keys.forEach((b, i) => {
        const m = degreeMidi(S.pattern, i);
        b.textContent = noteName(m).replace(/-?\d+$/, '');
        b.setAttribute('aria-label', `Play ${noteName(m)}`);
    });
}

function show(on) {
    row.hidden = !on;
    toggleBtn.setAttribute('aria-pressed', String(on));
    if (on) label();
}

// pointerdown rather than click: on a touch screen the note sounds the moment the finger lands
row.addEventListener('pointerdown', e => {
    const b = e.target.closest('.key');
    if (!b || !ac || S.paused) return;
    e.preventDefault();
    const i = +b.dataset.i;
    playNote(degreeMidi(S.pattern, i), b.textContent || '♪');
    b.classList.add('hit');
    setTimeout(() => b.classList.remove('hit'), 140);
});
row.addEventListener('contextmenu', e => e.preventDefault());

toggleBtn.onclick = () => show(row.hidden);

// the story borrows the row: it shows it, and lights the keys she sings
actions.keys = {
    shown: () => !row.hidden,
    show,
    flash(i) {
        const b = keys[i];
        if (!b) return;
        b.classList.add('hit');
        setTimeout(() => b.classList.remove('hit'), 260);
    }
};

on('ready', label);
on('pattern', label);
feature('keys');
// a touch screen has no letter keys at hand, so the row is there from the start
show(matchMedia('(pointer: coarse)').matches);
