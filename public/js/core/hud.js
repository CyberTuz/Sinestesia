// ═══════════════════════════════════════════════════════════════════════
// HUD
// ═══════════════════════════════════════════════════════════════════════

import { $, NOTE_NAMES, S, SCENES, noteName, reduceMotion } from './state.js';
import { claim, collect, emit } from './bus.js';
import { drawSigil } from './pattern.js';
import { ac, delay, master } from './audio.js';
import { thereminStop } from './instruments.js';

export const seqEl = $('#seq');
export const cells = [];
for (let i = 0; i < 16; i++) {
    const c = document.createElement('div');
    c.className = 'cell' + (i % 4 === 0 ? ' beat' : '');
    c.innerHTML = '<span class="n"></span><span class="b"></span>';
    seqEl.appendChild(c);
    cells.push(c);
}

export function renderPattern() {
    const p = S.pattern;
    p.steps.forEach((st, i) => {
        const c = cells[i];
        c.classList.toggle('rest', !st.gate);
        c.classList.toggle('accent', st.gate && st.accent);
        c.classList.toggle('slide', st.gate && st.slide);
        c.querySelector('.n').textContent = st.gate ? noteName(p.root + st.note) : '·';
        c.querySelector('.b').textContent = st.byte.toString(16).padStart(2, '0');
    });
    $('#r-phrase').textContent = p.label || '“' + p.text + '”';
    $('#r-hash').textContent = p.hex.slice(0, 32) + '…' + (p.real ? '' : ' (simulato)');
    $('#r-scale').textContent = `${p.scaleName} in ${NOTE_NAMES[p.root % 12]}`;
}

// collection of sigils from phrases already played; click one to bring its groove back
export const sigilsEl = $('#sigils');
export const history = [];

export function addSigil(p) {
    let entry = history.find(h => h.p.text === p.text);
    if (!entry) {
        const b = document.createElement('button');
        b.className = 'sigil';
        b.type = 'button';
        b.title = p.text;
        b.setAttribute('aria-label', `Bring back the groove of “${p.text}”`);
        const c = document.createElement('canvas');
        c.width = c.height = 88;
        drawSigil(c.getContext('2d'), p, 44, 44, 34, 1, 1.6, 0);
        b.appendChild(c);
        b.onclick = () => { S.pending = p; S.flash = 1; };
        entry = { p, b };
        history.push(entry);
        sigilsEl.appendChild(b);
        if (history.length > 12) history.shift().b.remove();
    }
    history.forEach(h => h.b.classList.toggle('current', h === entry));
}

export let activeCell = -1;
export function setActiveStep(i) {
    if (activeCell >= 0) cells[activeCell].classList.remove('on');
    cells[i].classList.add('on');
    activeCell = i;
    emit('heard', i);
}

export const scenesEl = $('#scenes');
SCENES.forEach((name, i) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.type = 'button'; b.textContent = name; b.title = name;
    b.onclick = () => setScene(i);
    scenesEl.appendChild(b);
});

export function setScene(i) {
    S.scene = i;
    S.flash = 1;
    [...scenesEl.children].forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    $('#r-scene').textContent = SCENES[i];
    $('#d-scene').textContent = SCENES[i];
}

// the dock's scene button steps through the scenes, like Tab
$('#d-scene').onclick = () => setScene((S.scene + 1) % SCENES.length);

export function toggle(btn, key, after) {
    S[key] = !S[key];
    btn.setAttribute('aria-pressed', String(S[key]));
    after?.();
}

$('#b-drums').onclick = e => toggle(e.currentTarget, 'drums');
$('#b-quant').onclick = e => toggle(e.currentTarget, 'quantize');
$('#b-echo').onclick = e => toggle(e.currentTarget, 'echo');
$('#b-voices').onclick = e => toggle(e.currentTarget, 'voices');

$('#b-hide').onclick = () => { setDrawer(false); document.body.classList.add('hud-off'); };
$('#hud-toggle').onclick = () => document.body.classList.remove('hud-off');
$('#b-full').onclick = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
};
$('#b-pause').onclick = e => {
    if (!ac) return;
    const b = e.currentTarget;
    S.paused = !S.paused;
    b.setAttribute('aria-label', S.paused ? 'Resume' : 'Pause');
    b.title = S.paused ? 'Resume' : 'Pause';
    b.setAttribute('aria-pressed', String(S.paused));
    if (S.paused) { thereminStop(); ac.suspend(); } else ac.resume();
};

// a slider with an <output> next to it shows its value there; the dock's volume has none
export function bindRange(id, fmt, onChange) {
    const el = $('#' + id), out = $('#' + id + '-o');
    const update = () => { if (out) out.textContent = fmt(+el.value); onChange(+el.value); };
    el.addEventListener('input', update);
    return el;
}

bindRange('vol', v => Math.round(v * 100), v => {
    S.volume = v;
    if (ac) master.gain.setTargetAtTime(v, ac.currentTime, 0.05);
});
bindRange('bpm', v => v, v => {
    S.bpm = v;
    $('#r-bpm').textContent = `${v} BPM · bar ${S.bar}`;
    if (ac) delay.delayTime.setTargetAtTime((60 / v) * 0.75, ac.currentTime, 0.2);
});
export const intenEl = bindRange('inten', v => Math.round(v * 100), v => { S.intensity = v; });
intenEl.value = S.intensity;
$('#inten-o').textContent = Math.round(S.intensity * 100);

export let toastTimer = null;
export function toast(msg, ms = 4500) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ── the dialogue terminal ──
export function termLine(who, text, label) {
    const term = $('#term');
    const row = document.createElement('div');
    row.className = 'tl ' + who + (who === 'tu' ? '' : ' typing');
    const w = document.createElement('span');
    w.className = 'who';
    w.textContent = label || { tu: 'YOU ›', macchina: 'MACHINE ›', regia: 'DIRECTOR ›' }[who] || who.toUpperCase() + ' ›';
    const tx = document.createElement('span');
    tx.className = 'tx';
    tx.textContent = text;
    row.append(w, tx);
    term.appendChild(row);
    while (term.children.length > 5) term.firstChild.remove();
    term.hidden = false;
    return tx;
}

export function typewrite(el, text) {
    const done = () => el.parentElement?.classList.remove('typing');
    if (reduceMotion) { el.textContent = text; done(); return; }
    let i = 0;
    const id = setInterval(() => {
        el.textContent = text.slice(0, ++i);
        if (i >= text.length) { clearInterval(id); done(); }
    }, 28);
}

// the terminal shows while a feature talks through it: the machine, the miner
export function updateTerm() {
    $('#term').hidden = !claim('term');
}

// ═══════════════════════════════════════════════════════════════════════
// INTERFACE: side drawer, quiet HUD, status line, gentle start
// ═══════════════════════════════════════════════════════════════════════

export function setDrawer(open) {
    const d = $('#drawer');
    document.body.classList.toggle('drawer-open', open);
    d.setAttribute('aria-hidden', String(!open));
    d.inert = !open;
    $('#menu-btn').setAttribute('aria-expanded', String(open));
    if (open) { document.body.classList.remove('calm'); $('#drawer-close').focus(); }
}

$('#menu-btn').onclick = () => setDrawer(!document.body.classList.contains('drawer-open'));
$('#drawer-close').onclick = () => setDrawer(false);

$('#b-seq').onclick = e => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    $('#seq').hidden = !on;
};

// the top bar fades back when nobody touches anything for a few seconds
export let calmTimer = null;
export function wake() {
    document.body.classList.remove('calm');
    clearTimeout(calmTimer);
    calmTimer = setTimeout(() => {
        if (!document.body.classList.contains('drawer-open')) document.body.classList.add('calm');
    }, 4000);
}
['pointermove', 'pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, wake, { passive: true }));

export let statusAt = 0;
export function statusTick() {
    const now = performance.now();
    if (now - statusAt < 500 || !S.pattern) return;
    statusAt = now;
    // features put their state in front: the duet, the radio, the story's chapter
    const parts = [...collect('status').reverse(), SCENES[S.scene], `${Math.round(S.bpm)} BPM`, `${S.pattern.scaleName} in ${NOTE_NAMES[S.pattern.root % 12]}`];
    $('#status').textContent = ac ? parts.join(' · ') : 'waiting';
}
