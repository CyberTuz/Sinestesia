// ── first-visit tips: one short line at a time, each waiting for you to try it before the next ──

import { $, S } from '../core/state.js';
import { feature, loaded, on } from '../core/bus.js';

const KEY = 'sinestesia-tips';
const tip = $('#tip'), text = $('#tip-text');
const touch = matchMedia('(pointer: coarse)').matches;

// each tip ends when you do what it says (or after a while, so nobody gets stuck)
function steps() {
    return [
        loaded.has('keys') && touch
            ? { say: 'Tap the keys: every one is a note', until: 'notes' }
            : { say: touch ? 'Tap the line below and type: every letter is a note' : 'Type any letter: every key is a note', until: 'notes' },
        { say: 'Type a word and press Enter: it becomes the groove', until: 'phrase' },
        !touch && { say: 'Move the mouse: left and right open the filter, up and down the echo', until: 'move' },
        { say: touch ? 'Hold a finger on the screen and slide it: a theremin' : 'Hold the mouse button and slide: a theremin', until: 'hold' },
        loaded.has('spells') && { say: 'Hold and draw a triangle: a spell', until: 'spell' },
        { say: 'The story and the Studio wait in the bar below. Have fun.', until: 'time' }
    ].filter(Boolean);
}

let list = [], step = -1, timer = null, notes = 0, travel = 0, lastMove = null, downAt = 0;

function seen() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
}

function show(i) {
    clearTimeout(timer);
    step = i;
    if (i >= list.length) { finish(); return; }
    // the story and the Studio have their own guidance: the tips wait until you are back
    if (S.story || S.takeover) {
        tip.classList.remove('in');
        timer = setTimeout(() => show(i), 3000);
        return;
    }
    text.textContent = list[i].say;
    tip.hidden = false;
    requestAnimationFrame(() => tip.classList.add('in'));
    timer = setTimeout(() => next(), list[i].until === 'time' ? 7000 : 16000);
}

// the done tip fades, the next one comes in a moment later
function next() {
    clearTimeout(timer);
    tip.classList.remove('in');
    const i = step + 1;
    step = -1;
    timer = setTimeout(() => show(i), 900);
}

function did(kind) {
    if (step >= 0 && list[step]?.until === kind) next();
}

function finish() {
    clearTimeout(timer);
    step = list.length;
    tip.classList.remove('in');
    setTimeout(() => { tip.hidden = true; }, 500);
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* the tips may come back next time */ }
}

// a tip on screen steps aside as soon as the story or the Studio opens
on('frame', () => { if (step >= 0 && tip.classList.contains('in') && (S.story || S.takeover)) show(step); });
on('note', () => { if (++notes >= 3) did('notes'); });
on('phrase', () => did('phrase'));
on('spell', () => did('spell'));
addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    if (lastMove) travel += Math.hypot(e.clientX - lastMove[0], e.clientY - lastMove[1]);
    lastMove = [e.clientX, e.clientY];
    if (travel > 900) did('move');
}, { passive: true });
$('#fx').addEventListener('pointerdown', () => { downAt = performance.now(); });
addEventListener('pointerup', () => {
    if (downAt && performance.now() - downAt > 700) did('hold');
    downAt = 0;
});

$('#tip-skip').onclick = finish;

on('started', () => {
    if (seen()) return;
    list = steps();
    // let the sound rise for a few seconds first
    timer = setTimeout(() => show(0), 4000);
});
feature('tips');
