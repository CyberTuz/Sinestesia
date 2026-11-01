// ═══════════════════════════════════════════════════════════════════════
// KEYBOARD → NOTES
// ═══════════════════════════════════════════════════════════════════════

import { $, S, SCENES } from './state.js';
import { claim, emit } from './bus.js';
import { charMidi, patternFrom } from './pattern.js';
import { ac, applyMouseToAudio } from './audio.js';
import {
    bell, glitchSound, lead, playAs, rim, thereminMove, thereminStart, thereminStop, whoosh
} from './instruments.js';
import { nextGridTime, stepDur } from './sequencer.js';
import { setDrawer, setScene } from './hud.js';
import { fx, sparks, spawnLetter } from './overlay.js';

export const typeEl = $('#type');

export const keyToMidi = ch => charMidi(ch, S.pattern);

export function handleChar(ch) {
    const t = nextGridTime();
    S.flash = 1;
    S.hue = (S.hue + (ch.codePointAt(0) % 12) / 48) % 1;
    spawnLetter(ch);
    if (ch === ' ') { whoosh(t); return; }
    if (/[0-9]/.test(ch)) {
        const n = ch === '0' ? 10 : +ch;
        const p = S.pattern, len = p.scale.length;
        const sd = stepDur() / 2;
        for (let k = 0; k < n; k++) {
            const deg = k * 2;
            lead(p.root + 36 + 12 * Math.floor(deg / len) + p.scale[deg % len], t + k * sd, 0.75);
        }
        return;
    }
    if (/[\p{L}]/u.test(ch)) {
        const m = keyToMidi(ch);
        playAs(S.role, m, t, ch);
        emit('note', m, t, ch);
        return;
    }
    rim(t);
    bell(keyToMidi(ch) + 12, t);
}

// a note played with something other than a letter key (the on-screen keys): it sounds and travels like one
export function playNote(m, ch) {
    const t = nextGridTime();
    S.flash = 1;
    S.hue = (S.hue + (ch.codePointAt(0) % 12) / 48) % 1;
    spawnLetter(ch);
    playAs(S.role, m, t, ch);
    emit('note', m, t, ch);
}

window.addEventListener('keydown', e => {
    if (e.target.matches('input[type="range"]')) return;
    if (e.target.matches('button') && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.key === 'Escape') {
        if (document.body.classList.contains('drawer-open')) setDrawer(false);
        else document.body.classList.toggle('hud-off');
        return;
    }
    if (e.target.closest && e.target.closest('#drawer, #rd-dial, #studio, #duet')) return;
    if (e.key === 'Tab') { e.preventDefault(); setScene((S.scene + 1) % SCENES.length); return; }
    // a feature can take a key first: the story's heartbeat chapter takes the space bar
    if (claim('key', e)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target !== typeEl) typeEl.focus();
    if (!ac || S.paused) return;
    if (e.key === 'Backspace') {
        glitchSound(ac.currentTime);
        S.glitch = 1;
        return;
    }
    if (e.key.length === 1 && !e.repeat) handleChar(e.key);
});

$('#prompt').addEventListener('submit', async e => {
    e.preventDefault();
    const text = typeEl.value.trim();
    if (!text) return;
    // a feature can take the line instead of turning it into a groove: the story's answers
    if (claim('submit', text)) { typeEl.value = ''; return; }
    S.lastPhrase = text;
    emit('phrase', text);
    S.pending = await patternFrom(text);
    typeEl.value = '';
    S.flash = 1;
    if (ac) whoosh(ac.currentTime);
});

// ═══════════════════════════════════════════════════════════════════════
// MOUSE → MODULATION
// ═══════════════════════════════════════════════════════════════════════

export let lastMove = { x: 0, y: 0, t: 0 }, energy = 0;

export function onPointerMove(e) {
    const x = e.clientX / innerWidth, y = e.clientY / innerHeight;
    S.mouse = [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
    const now = performance.now();
    const dt = Math.max(1, now - lastMove.t);
    const speed = Math.hypot(e.clientX - lastMove.x, e.clientY - lastMove.y) / dt;
    lastMove = { x: e.clientX, y: e.clientY, t: now };
    applyMouseToAudio();
    thereminMove();

    energy += speed;
    if (speed > 0.6) {
        const dpr = fx.width / innerWidth;
        sparks.push({ x: e.clientX * dpr, y: e.clientY * dpr, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, life: 1, hue: (S.hue * 360 + x * 200) % 360 });
        if (sparks.length > 200) sparks.shift();
    }
    if (ac && !S.paused && energy > 14 && now - S.sparkAt > stepDur() * 1000) {
        const p = S.pattern, len = p.scale.length;
        const deg = Math.floor(x * len * 2);
        bell(p.root + 48 + 12 * Math.floor(deg / len) + p.scale[deg % len], nextGridTime());
        energy = 0;
        S.sparkAt = now;
    }
}

fx.addEventListener('pointermove', onPointerMove);
fx.addEventListener('pointerdown', e => {
    onPointerMove(e);
    if (claim('press', e)) return;
    try { fx.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
    thereminStart();
});
fx.addEventListener('pointerup', thereminStop);
fx.addEventListener('pointercancel', thereminStop);
window.addEventListener('blur', thereminStop);
