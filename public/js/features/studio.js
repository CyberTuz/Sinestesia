// ═══════════════════════════════════════════════════════════════════════
// STUDIO: a groovebox to build your own track — drum grid, editable acid bass, mixer, shareable code
// ═══════════════════════════════════════════════════════════════════════

import { $, S, SCALES, SCENES, noteName } from '../core/state.js';
import { actions, feature, mode, on, stopModes } from '../core/bus.js';
import {
    FX, ac, applyMouseToAudio, bass, delay, eqHigh, eqLow, eqMid, leadBus, makeDrive, master, pad,
    resonance
} from '../core/audio.js';
import { clap, hat, kick, perc, playBass, rim } from '../core/instruments.js';
import { stepDur, stepIndex } from '../core/sequencer.js';
import { renderPattern, setDrawer, setScene, toast } from '../core/hud.js';
import { MEMORY, saveMemory } from '../core/memory.js';

const TRACKS = [
    { id: 'kick', name: 'Kick' }, { id: 'clap', name: 'Clap' }, { id: 'hat', name: 'Closed hat' },
    { id: 'open', name: 'Open hat' }, { id: 'rim', name: 'Rim' }, { id: 'perc', name: 'Perc' }
];
const stepsOn = (...on) => Array.from({ length: 16 }, (_, i) => (on.includes(i) ? 1 : 0));
const STUDIO = {
    on: false, built: false, restored: false, swing: 0.08,
    // 0 = off, 1 = on, 2 = accent
    grid: {
        kick: stepsOn(0, 4, 8, 12), clap: stepsOn(4, 12), hat: stepsOn(1, 3, 5, 7, 9, 11, 13, 15),
        open: stepsOn(2, 6, 10, 14), rim: stepsOn(7, 15), perc: stepsOn()
    },
    euclid: { kick: [4, 0], clap: [2, 4], hat: [8, 1], open: [4, 2], rim: [2, 7], perc: [0, 0] },
    vol: { kick: 0.9, clap: 0.7, hat: 0.55, open: 0.55, rim: 0.5, perc: 0.7, bass: 0.9, pad: 0.7, lead: 0.8 },
    mute: {}, solo: null,
    bass: { cutoff: 0.42, reso: 0.6, env: 0.55, decay: 0.35, drive: 0.4 },
    kill: { low: false, mid: false, high: false },
    bus: {}, cols: [], playhead: -1,
    // eight pattern slots; the one playing lives in grid / S.pattern.steps / auto and is saved back when you leave it
    slots: new Array(8).fill(null), cur: 0, queued: null,
    song: { on: false, start: false, seq: [], spb: 2, pos: 0, bar: 0 },
    // recorded knob moves: per knob, 16 values (or null where nothing was recorded)
    auto: { cutoff: null, reso: null, env: null, decay: null, drive: null },
    rec: false, touch: new Set(), k: null, lastDrive: -1,
    madness: 0, mut: null
};
const KNOBS = Object.keys(STUDIO.bass);
STUDIO.k = { ...STUDIO.bass };

// Euclidean rhythm: spread k hits as evenly as possible over 16 steps, then rotate
function euclid(k, rot = 0) {
    const out = new Array(16).fill(0);
    if (k <= 0) return out;
    for (let i = 0; i < 16; i++) {
        if (Math.floor(i * k / 16) !== Math.floor((i - 1) * k / 16)) out[(i + rot) % 16] = 1;
    }
    return out;
}

function trackAudible(id) {
    return !STUDIO.mute[id] && (!STUDIO.solo || STUDIO.solo === id);
}

function playTrack(id, t, vel) {
    const out = STUDIO.bus[id] || master;
    if (id === 'kick') kick(t, vel, out);
    else if (id === 'clap') clap(t, vel, out);
    else if (id === 'hat') hat(t, false, vel, out);
    else if (id === 'open') hat(t, true, vel, out);
    else if (id === 'rim') rim(t, vel, out);
    else perc(t, vel, out);
}

// 0 off, 1 on, 2 accent, 3 roll: two hits inside the step
function studioDrums(i, t) {
    const tt = i % 2 ? t + STUDIO.swing * stepDur() : t;
    const pi = studioIndex(i);
    const grid = STUDIO.mut ? STUDIO.mut.grid : STUDIO.grid;
    for (const tr of TRACKS) {
        const v = grid[tr.id][pi];
        if (!v || !trackAudible(tr.id)) continue;
        if (v === 3) {
            playTrack(tr.id, tt, 0.8);
            playTrack(tr.id, tt + stepDur() / 2, 0.55);
        } else playTrack(tr.id, tt, v === 2 ? 1 : 0.7);
    }
}

// while a Repeat pad is held the sequencer keeps looping the same slice; time (and the bar count) runs on underneath
function studioIndex(i) {
    return STUDIO.on && PADS.repeat ? PADS.anchor + (i % PADS.repeat) : i;
}

// the kick goes straight to the master so the Pump pad can breathe everything else around it
function studioBuses() {
    if (!ac || STUDIO.bus.kick) return;
    for (const tr of TRACKS) {
        const g = ac.createGain();
        g.connect(tr.id === 'kick' ? master : FX.pump);
        STUDIO.bus[tr.id] = g;
    }
}

function applyLevels() {
    if (!ac) return;
    const t = ac.currentTime;
    for (const tr of TRACKS) STUDIO.bus[tr.id].gain.setTargetAtTime(STUDIO.vol[tr.id], t, 0.02);
    bass.vol.gain.setTargetAtTime(STUDIO.on ? STUDIO.vol.bass : 1, t, 0.02);
    pad.vol.gain.setTargetAtTime(STUDIO.on ? STUDIO.vol.pad : 1, t, 0.05);
    leadBus.gain.setTargetAtTime(STUDIO.on ? STUDIO.vol.lead : 1, t, 0.02);
    const k = STUDIO.kill;
    eqLow.gain.setTargetAtTime(STUDIO.on && k.low ? -40 : 0, t, 0.01);
    eqMid.gain.setTargetAtTime(STUDIO.on && k.mid ? -40 : 0, t, 0.01);
    eqHigh.gain.setTargetAtTime(STUDIO.on && k.high ? -40 : 0, t, 0.01);
    bass.filt.Q.setTargetAtTime(resonance(), t, 0.05);
    bass.drive.curve = makeDrive(STUDIO.on ? 1 + STUDIO.bass.drive * 5 : 2.4);
    STUDIO.lastDrive = -1;
}

// ── the bass line: every step is a note of the scale you can move, accent or slide ──
function scaleTones(p) {
    const out = [];
    for (let o = 0; o < 3; o++) for (const s of p.scale) out.push(s + 12 * o);
    return out;
}

function previewBass(st) {
    if (!ac) return;
    playBass(ac.currentTime + 0.01, { ...st, gate: true }, { gate: false });
}

function nudgeNote(i, dir) {
    const st = S.pattern.steps[i], tones = scaleTones(S.pattern);
    const next = dir > 0 ? tones.find(n => n > st.note) : tones.slice().reverse().find(n => n < st.note);
    if (next !== undefined) st.note = next;
    st.gate = true;
    previewBass(st);
    edited();
    renderPattern();
}

function randomDrums() {
    const r = n => Math.floor(Math.random() * n);
    STUDIO.grid.kick = Math.random() < 0.8 ? stepsOn(0, 4, 8, 12) : euclid(5, 0);
    STUDIO.grid.clap = Math.random() < 0.7 ? stepsOn(4, 12) : euclid(3, 4);
    STUDIO.grid.hat = euclid(6 + r(7), r(4)).map(v => (v && Math.random() < 0.3 ? 2 : v));
    STUDIO.grid.open = Math.random() < 0.6 ? stepsOn(2, 6, 10, 14) : euclid(3, 2);
    STUDIO.grid.rim = euclid(r(5), r(16));
    STUDIO.grid.perc = euclid(r(6), r(16));
}

// an acid line that stays in the scale: mostly root and octave, a few leaps, some accents and slides
function randomAcid() {
    const tones = scaleTones(S.pattern);
    S.pattern.steps = S.pattern.steps.map((st, i) => {
        const roll = Math.random();
        return {
            ...st,
            gate: i === 0 || Math.random() < 0.72,
            note: roll < 0.35 ? 0 : roll < 0.55 ? 12 : tones[Math.floor(Math.random() * Math.min(tones.length, 10))],
            accent: Math.random() < 0.25,
            slide: Math.random() < 0.2
        };
    });
}

function shiftBass(dir) {
    const s = S.pattern.steps;
    S.pattern.steps = dir > 0 ? [s[15], ...s.slice(0, 15)] : [...s.slice(1), s[0]];
}

const atTime = (t, fn) => setTimeout(fn, Math.max(0, (t - ac.currentTime) * 1000));
// freeze an automation at its current value from time t on, even in browsers without cancelAndHoldAtTime
function hold(p, t) {
    if (p.cancelAndHoldAtTime) { p.cancelAndHoldAtTime(t); return; }
    const v = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
}

// ── live effects: pads that bend the whole mix while you hold them ──
const PADS = { active: new Set(), latch: false, repeat: 0, anchor: 0 };
const REPEAT = { r4: 4, r8: 2, r16: 1 };

// hold: the read head of a delay line slows to a halt, like a turntable losing power; release: the beat drops back in on time
function tapeStop(on, t) {
    const d = FX.tape.delayTime, g = FX.tapeGain.gain;
    hold(d, t);
    hold(g, t);
    if (on) {
        const D = Math.min(1.6, stepDur() * 8), n = 48, curve = new Float32Array(n);
        for (let k = 0; k < n; k++) { const x = (k / (n - 1)) * D; curve[k] = (x * x) / (2 * D); }
        d.setValueCurveAtTime(curve, t + 0.005, D);
        g.setTargetAtTime(0, t + D * 0.6, D * 0.15);
    } else {
        g.linearRampToValueAtTime(0, t + 0.015);
        d.setValueAtTime(0, t + 0.02);
        g.linearRampToValueAtTime(1, t + 0.05);
    }
}

// a resonant highpass climbing over two bars (the build) or a lowpass closing down (the breakdown)
function sweep(name, on, t) {
    const f = name === 'up' ? FX.hp : FX.lp;
    hold(f.frequency, t);
    hold(f.Q, t);
    if (on) {
        f.frequency.exponentialRampToValueAtTime(name === 'up' ? 2600 : 180, t + stepDur() * 32);
        f.Q.setTargetAtTime(name === 'up' ? 4 : 5, t, 0.2);
    } else {
        f.frequency.setTargetAtTime(name === 'up' ? 10 : 22000, t, 0.05);
        f.Q.setTargetAtTime(0.7, t, 0.05);
    }
}

function crushFx(on, t) {
    FX.clean.gain.setTargetAtTime(on ? 0 : 1, t, 0.01);
    FX.crushIn.gain.setTargetAtTime(on ? 2.4 : 0, t, 0.01);
    FX.crushOut.gain.setTargetAtTime(on ? 0.45 : 0, t, 0.01);
}

function freeze(on, t) {
    for (const fb of FX.freezeFb) {
        hold(fb.gain, t);
        fb.gain.setTargetAtTime(on ? 0.965 : 0, on ? t : t + 0.9, 0.03);
    }
    const inp = FX.freezeIn.gain;
    hold(inp, t);
    if (on) {
        inp.linearRampToValueAtTime(0.08, t + 0.04);
        inp.setValueAtTime(0.08, t + stepDur() * 4);
        inp.linearRampToValueAtTime(0, t + stepDur() * 4 + 0.15);
    } else inp.linearRampToValueAtTime(0, t + 0.02);
    FX.freezeOut.gain.setTargetAtTime(on ? 0.35 : 0, t, on ? 0.06 : 0.25);
    FX.dry.gain.setTargetAtTime(on ? 0.3 : 1, t, on ? 0.15 : 0.08);
}

// on every beat everything except the kick drops away and breathes back in
function pumpBeat(t) {
    const g = FX.pump.gain;
    g.setTargetAtTime(0.08, t, 0.005);
    g.setTargetAtTime(1, t + 0.035, stepDur() * 0.9);
}

function fxSet(name, on) {
    if (!ac || PADS.active.has(name) === on) return;
    if (on) PADS.active.add(name); else PADS.active.delete(name);
    const t = ac.currentTime;
    if (REPEAT[name]) {
        // the newest held Repeat wins; letting it go falls back to one still held
        const last = [...PADS.active].filter(n => REPEAT[n]).pop();
        PADS.repeat = last ? REPEAT[last] : 0;
        if (PADS.repeat) PADS.anchor = Math.floor(stepIndex / PADS.repeat) * PADS.repeat;
    } else if (name === 'tape') tapeStop(on, t);
    else if (name === 'up' || name === 'down') sweep(name, on, t);
    else if (name === 'crush') crushFx(on, t);
    else if (name === 'freeze') freeze(on, t);
    else if (name === 'pump' && !on) { hold(FX.pump.gain, t); FX.pump.gain.setTargetAtTime(1, t, 0.04); }
    const pad = document.querySelector(`#stu-pads [data-fx="${name}"]`);
    if (pad) pad.setAttribute('aria-pressed', String(on));
}

function releaseFx() {
    for (const name of [...PADS.active]) fxSet(name, false);
}

// ── pattern slots and the song: eight patterns, switched on the bar line ──
const SLOT_NAMES = 'ABCDEFGH';
const cloneGrid = g => Object.fromEntries(TRACKS.map(tr => [tr.id, g[tr.id].slice()]));
const cloneAuto = a => Object.fromEntries(KNOBS.map(key => [key, a[key] ? a[key].slice() : null]));

function snapshot() {
    return { grid: cloneGrid(STUDIO.grid), steps: S.pattern.steps.map(s => ({ ...s })), auto: cloneAuto(STUDIO.auto), euclid: JSON.parse(JSON.stringify(STUDIO.euclid)) };
}

function restore(snap) {
    STUDIO.grid = cloneGrid(snap.grid);
    STUDIO.auto = cloneAuto(snap.auto);
    STUDIO.euclid = JSON.parse(JSON.stringify(snap.euclid));
    S.pattern = { ...S.pattern, steps: snap.steps.map(s => ({ ...s })) };
}

function switchSlot(k) {
    if (k === STUDIO.cur) return;
    STUDIO.slots[STUDIO.cur] = snapshot();
    if (STUDIO.slots[k]) restore(STUDIO.slots[k]);
    // an empty slot starts as a copy of the one that was playing, ready to become a variation
    else STUDIO.slots[k] = snapshot();
    STUDIO.cur = k;
    applyLevels();
}

// runs as each bar is scheduled: the song moves on, a queued slot takes over, Madness rolls a new variation
function studioBar(t) {
    const song = STUDIO.song;
    if (song.on && song.seq.length) {
        if (song.start) { song.start = false; song.pos = 0; song.bar = 0; }
        else if (++song.bar >= song.spb) { song.bar = 0; song.pos++; }
        if (song.pos >= song.seq.length) song.pos = 0;
        STUDIO.queued = song.seq[song.pos];
    }
    const switching = STUDIO.queued !== null && STUDIO.queued !== STUDIO.cur;
    if (STUDIO.queued !== null) { switchSlot(STUDIO.queued); STUDIO.queued = null; }
    const hadMut = !!STUDIO.mut;
    STUDIO.mut = STUDIO.madness > 0 ? mutate(STUDIO.madness) : null;
    if (switching || hadMut || STUDIO.mut) atTime(t, () => { renderStudio(); if (switching) renderPattern(); });
}

const parseSong = text => [...String(text).toUpperCase()].filter(c => SLOT_NAMES.includes(c)).map(c => SLOT_NAMES.indexOf(c));

function setSong(on) {
    const song = STUDIO.song;
    song.seq = parseSong($('#stu-song').value);
    if (on && !song.seq.length) { toast('Type some slot letters first, like AABA.'); on = false; }
    song.on = on;
    song.start = on;
    const b = $('#stu-play-song');
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? '■ Stop song' : '▶ Play song';
}

function renderSlots() {
    document.querySelectorAll('#stu-slots .stu-slot').forEach(b => {
        const k = +b.dataset.slot;
        b.classList.toggle('filled', k === STUDIO.cur || !!STUDIO.slots[k]);
        b.classList.toggle('playing', k === STUDIO.cur);
        b.classList.toggle('queued', k === STUDIO.queued);
        b.setAttribute('aria-pressed', String(k === STUDIO.cur));
    });
}

// ── recorded knob moves: each acid knob can carry one bar of motion ──
const laneOf = key => STUDIO.auto[key] || (STUDIO.auto[key] = new Array(16).fill(null));

// the knob values for one step: a knob you are holding wins, then its recorded move, then where it sits
function stepKnobs(i, t) {
    const k = STUDIO.k;
    for (const key of KNOBS) {
        const lane = STUDIO.auto[key];
        k[key] = STUDIO.touch.has(key) || !lane || lane[i] === null ? STUDIO.bass[key] : lane[i];
    }
    if (STUDIO.mut) k.cutoff = Math.min(1, Math.max(0, k.cutoff + STUDIO.mut.cut));
    if (STUDIO.auto.reso) bass.filt.Q.setValueAtTime(2 + k.reso * 24, t);
    if (STUDIO.auto.drive && Math.abs(k.drive - STUDIO.lastDrive) > 0.02) {
        const v = STUDIO.lastDrive = k.drive;
        atTime(t, () => { bass.drive.curve = makeDrive(1 + v * 5); });
    }
}

function renderLanes(now = -1) {
    for (const key of KNOBS) {
        const el = $(`#stu-lane-${key}`), lane = STUDIO.auto[key];
        el.hidden = !lane;
        if (!lane) continue;
        if (el.children.length !== 16) {
            el.textContent = '';
            for (let s = 0; s < 16; s++) el.appendChild(document.createElement('i'));
        }
        [...el.children].forEach((b, s) => {
            b.style.height = lane[s] === null ? '0' : `${Math.max(8, lane[s] * 100)}%`;
            b.classList.toggle('now', s === now);
        });
    }
}

// ── Madness: every bar a fresh variation of your pattern, never the pattern itself ──
function mutate(m) {
    const rnd = Math.random, changed = new Set(), grid = {};
    for (const tr of TRACKS) {
        const busy = tr.id === 'hat' || tr.id === 'rim' || tr.id === 'perc';
        grid[tr.id] = STUDIO.grid[tr.id].map((v, i) => {
            // four on the floor holds until it gets really mad
            if (tr.id === 'kick' && i % 4 === 0 && m < 0.75) return v;
            let out = v;
            if (rnd() < m * (v ? 0.1 : busy ? 0.16 : 0.05)) out = v ? 0 : 1;
            else if (v && rnd() < m * 0.14) out = 3;
            else if (v === 1 && rnd() < m * 0.12) out = 2;
            if (out !== v) changed.add(`${tr.id}:${i}`);
            return out;
        });
    }
    const tones = scaleTones(S.pattern);
    const steps = S.pattern.steps.map((st, i) => {
        const s = { ...st };
        if (s.gate && rnd() < m * 0.3) {
            let k = tones.findIndex(n => n >= s.note);
            if (k < 0) k = tones.length - 1;
            k = Math.min(tones.length - 1, Math.max(0, k + (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 2))));
            s.note = tones[k];
        }
        if (s.gate && rnd() < m * 0.12) s.note = s.note >= 24 ? s.note - 12 : s.note + 12;
        if (rnd() < m * 0.15) s.accent = !s.accent;
        if (rnd() < m * 0.1) s.slide = !s.slide;
        if (rnd() < m * 0.08) s.gate = !s.gate;
        if (s.gate !== st.gate || (s.gate && (s.note !== st.note || s.accent !== st.accent || s.slide !== st.slide))) changed.add(`b:${i}`);
        return s;
    });
    return { grid, steps, changed, cut: (rnd() - 0.5) * m * 0.5 };
}

// ── track codes: the whole track (eight patterns, the song, the knob moves) in one line of text ──
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

// a pattern packed small: drum digits per track, two characters per bass step (flags, note), one per recorded knob value
function packSlot(s) {
    const out = {
        g: TRACKS.map(tr => s.grid[tr.id].join('')).join('.'),
        b: s.steps.map(st => String((st.gate ? 1 : 0) | (st.accent ? 2 : 0) | (st.slide ? 4 : 0)) + B36[Math.min(35, Math.max(0, Math.round(st.note)))]).join('')
    };
    const a = {};
    for (const key of KNOBS) if (s.auto[key]) a[key] = s.auto[key].map(v => (v === null ? '.' : B36[Math.round(v * 35)])).join('');
    if (Object.keys(a).length) out.a = a;
    // the Euclidean numbers each track shows (hits and rotation), so the fields match the grid after loading
    out.e = TRACKS.map(tr => s.euclid[tr.id].map(n => B36[n]).join('')).join('.');
    return out;
}

function unpackSlot(o) {
    o = o && typeof o === 'object' ? o : {};
    const rows = String(o.g || '').split('.'), grid = {};
    TRACKS.forEach((tr, k) => {
        const row = (rows[k] || '').padEnd(16, '0').slice(0, 16);
        grid[tr.id] = [...row].map(c => Math.min(3, Math.max(0, parseInt(c, 10) || 0)));
    });
    const b = String(o.b || '');
    const steps = Array.from({ length: 16 }, (_, i) => {
        const f = parseInt(b[i * 2], 10) || 0, n = B36.indexOf(b[i * 2 + 1] || '0');
        return { gate: !!(f & 1), accent: !!(f & 2), slide: !!(f & 4), note: Math.max(0, n), deg: 0, oct: 0, byte: 0 };
    });
    const auto = {};
    for (const key of KNOBS) {
        const s = o.a && typeof o.a[key] === 'string' ? o.a[key] : '';
        const lane = Array.from({ length: 16 }, (_, i) => { const n = B36.indexOf(s[i] || '.'); return n < 0 ? null : n / 35; });
        auto[key] = lane.some(v => v !== null) ? lane : null;
    }
    // older codes have no Euclidean numbers: the current ones stay
    const euclid = JSON.parse(JSON.stringify(STUDIO.euclid));
    const pairs = String(o.e || '').split('.');
    TRACKS.forEach((tr, k) => {
        const pair = pairs[k] || '';
        if (pair.length !== 2) return;
        const hits = B36.indexOf(pair[0]), rot = B36.indexOf(pair[1]);
        if (hits >= 0 && hits <= 16 && rot >= 0 && rot <= 15) euclid[tr.id] = [hits, rot];
    });
    return { grid, steps, auto, euclid };
}

function studioCode() {
    const p = S.pattern;
    STUDIO.slots[STUDIO.cur] = snapshot();
    const data = {
        v: 2, bpm: Math.round(S.bpm), sw: Math.round(STUDIO.swing * 100), sc: p.scaleName, r: p.root, scn: S.scene,
        k: KNOBS.map(key => Math.round(STUDIO.bass[key] * 100)),
        vol: Object.keys(STUDIO.vol).map(key => Math.round(STUDIO.vol[key] * 100)),
        mad: Math.round(STUDIO.madness * 100), cur: STUDIO.cur,
        sl: STUDIO.slots.map(s => (s ? packSlot(s) : 0)),
        song: $('#stu-song').value.toUpperCase().replace(/[^A-H ]/g, '').slice(0, 64), spb: STUDIO.song.spb
    };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    return 'SNS1-' + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// a pasted code is untrusted text: every field is checked and clamped before it touches the music
function loadCode(code) {
    let d;
    try {
        const raw = String(code).trim().replace(/^SNS1-/, '').replace(/-/g, '+').replace(/_/g, '/');
        d = JSON.parse(decodeURIComponent(escape(atob(raw))));
    } catch (e) { return false; }
    if (!d || (d.v !== 1 && d.v !== 2) || !SCALES[d.sc]) return false;
    const num = (v, lo, hi, dflt) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
    let slots, cur = 0;
    if (d.v === 2 && Array.isArray(d.sl)) {
        slots = Array.from({ length: 8 }, (_, k) => (d.sl[k] ? unpackSlot(d.sl[k]) : null));
        cur = Math.round(num(d.cur, 0, 7, 0));
    } else {
        // version 1 codes hold a single pattern with the bass written out in full
        const one = unpackSlot({ g: d.g });
        one.steps = Array.from({ length: 16 }, (_, i) => {
            const b = Array.isArray(d.b) ? d.b[i] || [] : [];
            return { gate: !!b[0], note: Math.round(num(b[1], 0, 36, 0)), accent: !!b[2], slide: !!b[3], deg: 0, oct: 0, byte: 0 };
        });
        slots = [one, null, null, null, null, null, null, null];
    }
    if (!slots[cur]) slots[cur] = unpackSlot({});
    KNOBS.forEach((key, k) => { STUDIO.bass[key] = num((d.k || [])[k], 0, 100, STUDIO.bass[key] * 100) / 100; });
    Object.keys(STUDIO.vol).forEach((key, k) => { STUDIO.vol[key] = num((d.vol || [])[k], 0, 100, STUDIO.vol[key] * 100) / 100; });
    STUDIO.swing = num(d.sw, 0, 50, 8) / 100;
    STUDIO.madness = num(d.mad, 0, 100, 0) / 100;
    S.bpm = Math.round(num(d.bpm, 90, 160, S.bpm));
    $('#bpm').value = S.bpm;
    $('#bpm-o').textContent = S.bpm;
    if (ac) delay.delayTime.setTargetAtTime((60 / S.bpm) * 0.75, ac.currentTime, 0.2);
    S.pattern = { ...S.pattern, scaleName: d.sc, scale: SCALES[d.sc], root: Math.round(num(d.r, 24, 48, 33)), label: '🎚 track code' };
    STUDIO.slots = slots;
    STUDIO.cur = cur;
    STUDIO.queued = null;
    STUDIO.mut = null;
    restore(slots[cur]);
    STUDIO.song.spb = [1, 2, 4, 8].includes(d.spb) ? d.spb : 2;
    $('#stu-spb').value = String(STUDIO.song.spb);
    $('#stu-song').value = typeof d.song === 'string' ? d.song.toUpperCase().replace(/[^A-H ]/g, '').slice(0, 64) : '';
    setSong(false);
    const sc = num(d.scn, 0, SCENES.length - 1, S.scene);
    if (Number.isInteger(sc)) setScene(sc);
    renderPattern();
    applyLevels();
    renderStudio();
    return true;
}

// ── the panel ──
function buildStudio() {
    if (STUDIO.built) return;
    STUDIO.built = true;
    STUDIO.cols = Array.from({ length: 16 }, () => []);
    for (let k = 0; k < 8; k++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'stu-slot';
        b.dataset.slot = k;
        b.textContent = SLOT_NAMES[k];
        b.setAttribute('aria-label', `Pattern ${SLOT_NAMES[k]}`);
        $('#stu-slots').appendChild(b);
    }
    const msButton = (label, id, kind, title) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'stu-ms ' + kind;
        b.textContent = label;
        b.dataset.ms = kind;
        b.dataset.track = id;
        b.title = title;
        b.setAttribute('aria-pressed', 'false');
        return b;
    };
    const drums = $('#stu-drums');
    for (const tr of TRACKS) {
        const row = document.createElement('div');
        row.className = 'stu-trow';
        row.dataset.track = tr.id;
        const name = document.createElement('div');
        name.className = 'stu-name';
        const label = document.createElement('span');
        label.textContent = tr.name;
        name.append(msButton('M', tr.id, 'mute', `Mute ${tr.name}`), msButton('S', tr.id, 'solo', `Solo ${tr.name}`), label);
        row.appendChild(name);
        for (let i = 0; i < 16; i++) {
            const c = document.createElement('button');
            c.type = 'button';
            c.className = 'stu-cell' + (i % 4 === 0 ? ' beat' : '');
            c.dataset.step = i;
            c.dataset.track = tr.id;
            c.setAttribute('aria-label', `${tr.name}, step ${i + 1}`);
            row.appendChild(c);
            STUDIO.cols[i].push(c);
        }
        const euc = document.createElement('div');
        euc.className = 'stu-euc';
        for (const [key, max, what] of [['k', 16, 'hits'], ['r', 15, 'rotation']]) {
            const inp = document.createElement('input');
            inp.type = 'number';
            inp.min = 0;
            inp.max = max;
            inp.id = `stu-e-${tr.id}-${key}`;
            inp.dataset.e = key;
            inp.dataset.track = tr.id;
            inp.setAttribute('aria-label', `${tr.name} Euclidean ${what}`);
            euc.appendChild(inp);
        }
        row.appendChild(euc);
        const vol = document.createElement('input');
        vol.type = 'range';
        vol.min = 0;
        vol.max = 1;
        vol.step = 0.01;
        vol.id = `stu-vol-${tr.id}`;
        vol.className = 'stu-vol';
        vol.dataset.track = tr.id;
        vol.setAttribute('aria-label', `${tr.name} volume`);
        row.appendChild(vol);
        drums.appendChild(row);
    }

    // three rows for the bass: notes, accents, slides
    const bassEl = $('#stu-bass');
    const rows = [['note', 'Notes'], ['accent', 'Accent'], ['slide', 'Slide']];
    for (const [kind, title] of rows) {
        const row = document.createElement('div');
        row.className = 'stu-trow stu-brow';
        const name = document.createElement('div');
        name.className = 'stu-name';
        const label = document.createElement('span');
        label.textContent = title;
        if (kind === 'note') name.append(msButton('M', 'bass', 'mute', 'Mute bass'), msButton('S', 'bass', 'solo', 'Solo bass'));
        name.appendChild(label);
        row.appendChild(name);
        for (let i = 0; i < 16; i++) {
            const c = document.createElement('button');
            c.type = 'button';
            c.className = (kind === 'note' ? 'stu-note' : 'stu-flag') + (i % 4 === 0 ? ' beat' : '');
            c.dataset.step = i;
            c.dataset.kind = kind;
            c.setAttribute('aria-label', kind === 'note' ? `Bass note, step ${i + 1}: click to switch on or off, arrows or wheel to change pitch` : `${title}, step ${i + 1}`);
            row.appendChild(c);
            if (kind === 'note') STUDIO.cols[i].push(c);
        }
        row.appendChild(document.createElement('span'));
        row.appendChild(document.createElement('span'));
        bassEl.appendChild(row);
    }
}

function renderStudio() {
    if (!STUDIO.built) return;
    const changed = STUDIO.mut ? STUDIO.mut.changed : null;
    document.querySelectorAll('#stu-drums .stu-cell').forEach(c => {
        c.dataset.v = STUDIO.grid[c.dataset.track][+c.dataset.step];
        c.classList.toggle('mut', !!changed && changed.has(`${c.dataset.track}:${c.dataset.step}`));
    });
    document.querySelectorAll('#stu-bass .stu-note').forEach(c => c.classList.toggle('mut', !!changed && changed.has(`b:${c.dataset.step}`)));
    renderSlots();
    renderLanes(STUDIO.playhead);
    $('#stu-mad').value = STUDIO.madness;
    $('#stu-mad-o').textContent = Math.round(STUDIO.madness * 100);
    $('#stu-rec').setAttribute('aria-pressed', String(STUDIO.rec));
    $('#stu-latch').setAttribute('aria-pressed', String(PADS.latch));
    document.querySelectorAll('#studio .stu-ms').forEach(b => {
        const on = b.dataset.ms === 'mute' ? !!STUDIO.mute[b.dataset.track] : STUDIO.solo === b.dataset.track;
        b.setAttribute('aria-pressed', String(on));
    });
    for (const tr of TRACKS) {
        const [k, r] = STUDIO.euclid[tr.id];
        const ek = $(`#stu-e-${tr.id}-k`), er = $(`#stu-e-${tr.id}-r`);
        if (document.activeElement !== ek) ek.value = k;
        if (document.activeElement !== er) er.value = r;
        $(`#stu-vol-${tr.id}`).value = STUDIO.vol[tr.id];
    }
    const p = S.pattern;
    document.querySelectorAll('#stu-bass button[data-kind]').forEach(c => {
        const st = p.steps[+c.dataset.step];
        if (c.dataset.kind === 'note') {
            c.textContent = st.gate ? noteName(p.root + st.note) : '·';
            c.classList.toggle('off', !st.gate);
        } else {
            c.setAttribute('aria-pressed', String(!!st[c.dataset.kind]));
            c.textContent = st[c.dataset.kind] ? (c.dataset.kind === 'accent' ? 'A' : '⌒') : '';
        }
    });
    for (const key of Object.keys(STUDIO.bass)) {
        $(`#stu-k-${key}`).value = STUDIO.bass[key];
        $(`#stu-k-${key}-o`).textContent = Math.round(STUDIO.bass[key] * 100);
    }
    for (const key of ['bass', 'pad', 'lead']) {
        $(`#stu-v-${key}`).value = STUDIO.vol[key];
        $(`#stu-v-${key}-o`).textContent = Math.round(STUDIO.vol[key] * 100);
    }
    $('#stu-swing').value = STUDIO.swing;
    $('#stu-swing-o').textContent = Math.round(STUDIO.swing * 100);
    for (const band of ['low', 'mid', 'high']) $(`#stu-kill-${band}`).setAttribute('aria-pressed', String(STUDIO.kill[band]));
    // the story's check: the rows it finds right light up, and the squares it wants switched on glow
    const { right, want } = guest ? guest.check(cloneGrid(STUDIO.grid)) : {};
    document.querySelectorAll('#stu-drums .stu-trow').forEach(r => r.classList.toggle('right', !!right?.has(r.dataset.track)));
    document.querySelectorAll('#stu-drums .stu-cell').forEach(c => c.classList.toggle('want', want?.track === c.dataset.track && want.steps.includes(+c.dataset.step)));
}

// called on each step as it is heard: moves the playhead, records held knobs, lets automated knobs follow their move
function studioPlayhead(step) {
    if (!STUDIO.on || !STUDIO.built) return;
    const i = studioIndex(step);
    if (STUDIO.playhead >= 0) STUDIO.cols[STUDIO.playhead].forEach(c => c.classList.remove('now'));
    STUDIO.cols[i].forEach(c => c.classList.add('now'));
    STUDIO.playhead = i;
    if (STUDIO.rec) for (const key of STUDIO.touch) laneOf(key)[i] = STUDIO.bass[key];
    for (const key of KNOBS) {
        const lane = STUDIO.auto[key];
        if (!lane || STUDIO.touch.has(key)) continue;
        const v = lane[i] === null ? STUDIO.bass[key] : lane[i];
        $(`#stu-k-${key}`).value = v;
        $(`#stu-k-${key}-o`).textContent = Math.round(v * 100);
    }
    renderLanes(i);
    const song = STUDIO.song;
    $('#stu-pos').textContent = `pattern ${SLOT_NAMES[STUDIO.cur]} · bar ${S.bar} · step ${i + 1}` + (song.on ? ` · song ${song.pos + 1}/${song.seq.length}` : '');
}

function openStudio() {
    if (!ac) { toast('Press Play first.'); return; }
    stopModes(guest ? 'journey' : 'story', 'journey');
    S.intro = null;
    S.drums = S.hatsOn = S.bassOn = true;
    STUDIO.on = true;
    S.takeover = TAKEOVER;
    studioBuses();
    buildStudio();
    applyLevels();
    // the story's grid starts empty; your own track comes back the next time you open the Studio yourself
    if (!STUDIO.restored && !guest) restoreTrack();
    if (!guest) giveHerRhythm();
    renderStudio();
    $('#studio').hidden = false;
    $('#b-studio').setAttribute('aria-pressed', 'true');
}

// ── the track survives a reload, and travels in a link ──
const TRACK_KEY = 'sinestesia-track';
let savedCode = '';

// the first time the Studio opens: the track in the link if there is one, otherwise the one saved here
function restoreTrack() {
    STUDIO.restored = true;
    const url = new URL(location.href);
    const fromLink = url.searchParams.get('track');
    let saved = '';
    try { saved = localStorage.getItem(TRACK_KEY) || ''; } catch (e) { /* nothing saved */ }
    if (fromLink) {
        // the link has done its job; from now on reloads bring back your own edits
        url.searchParams.delete('track');
        history.replaceState(null, '', url);
        if (loadCode(fromLink)) { toast('Track loaded from the link.'); return; }
        toast('The track in that link could not be read.');
    }
    if (saved && loadCode(saved)) {
        savedCode = saved;
        toast('Your track is back where you left it.');
    }
}

function saveTrack() {
    if (!STUDIO.built || !STUDIO.restored || guest) return;
    const code = studioCode();
    if (code === savedCode) return;
    savedCode = code;
    try { localStorage.setItem(TRACK_KEY, code); } catch (e) { /* storage full or blocked: the link still works */ }
}

function trackLink() {
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set('track', studioCode());
    return url.href;
}

function closeStudio() {
    releaseFx();
    if (STUDIO.song.on) setSong(false);
    STUDIO.rec = false;
    STUDIO.mut = null;
    STUDIO.queued = null;
    STUDIO.touch.clear();
    STUDIO.on = false;
    S.takeover = null;
    STUDIO.kill = { low: false, mid: false, high: false };
    applyLevels();
    applyMouseToAudio();
    $('#studio').hidden = true;
    $('#b-studio').setAttribute('aria-pressed', 'false');
}

$('#b-studio').onclick = () => {
    setDrawer(false);
    if (STUDIO.on) closeStudio(); else openStudio();
};
// after an edit the rest of the bar plays your pattern as it is; Madness picks up again at the next bar
function edited() {
    STUDIO.mut = null;
    renderStudio();
}

$('#stu-close').onclick = closeStudio;
$('#stu-rand').onclick = () => { randomDrums(); edited(); };
$('#stu-clear').onclick = () => { for (const tr of TRACKS) STUDIO.grid[tr.id] = stepsOn(); edited(); };
$('#stu-acid').onclick = () => { randomAcid(); edited(); renderPattern(); };
$('#stu-left').onclick = () => { shiftBass(-1); edited(); renderPattern(); };
$('#stu-right').onclick = () => { shiftBass(1); edited(); renderPattern(); };

// pattern slots: a click queues the slot for the next bar (and stops the song, since you took over)
$('#stu-slots').addEventListener('click', e => {
    const b = e.target.closest('.stu-slot');
    if (!b) return;
    if (STUDIO.song.on) setSong(false);
    const k = +b.dataset.slot;
    STUDIO.queued = k === STUDIO.cur ? null : k;
    renderSlots();
});
$('#stu-song').addEventListener('input', () => {
    STUDIO.song.seq = parseSong($('#stu-song').value);
    if (STUDIO.song.on && !STUDIO.song.seq.length) setSong(false);
});
$('#stu-spb').onchange = e => { STUDIO.song.spb = +e.target.value || 2; };
$('#stu-play-song').onclick = () => setSong(!STUDIO.song.on);

// live effect pads: momentary by default, toggles with Latch on
$('#stu-latch').onclick = () => {
    PADS.latch = !PADS.latch;
    if (!PADS.latch) releaseFx();
    $('#stu-latch').setAttribute('aria-pressed', String(PADS.latch));
};
const padPress = name => fxSet(name, PADS.latch ? !PADS.active.has(name) : true);
$('#stu-pads').addEventListener('pointerdown', e => {
    const pad = e.target.closest('.stu-pad');
    if (!pad) return;
    e.preventDefault();
    padPress(pad.dataset.fx);
    if (!PADS.latch) try { pad.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
});
const padUp = e => {
    const pad = e.target.closest && e.target.closest('.stu-pad');
    if (pad && !PADS.latch) fxSet(pad.dataset.fx, false);
};
$('#stu-pads').addEventListener('pointerup', padUp);
$('#stu-pads').addEventListener('pointercancel', padUp);
$('#stu-pads').addEventListener('contextmenu', e => e.preventDefault());
$('#stu-pads').addEventListener('keydown', e => {
    const pad = e.target.closest('.stu-pad');
    if (!pad || (e.key !== ' ' && e.key !== 'Enter')) return;
    e.preventDefault();
    if (!e.repeat) padPress(pad.dataset.fx);
});
$('#stu-pads').addEventListener('keyup', e => {
    const pad = e.target.closest('.stu-pad');
    if (pad && (e.key === ' ' || e.key === 'Enter') && !PADS.latch) fxSet(pad.dataset.fx, false);
});
// a held pad must not stay stuck when the window loses focus mid-press
window.addEventListener('blur', () => { if (!PADS.latch) releaseFx(); });

$('#stu-mad').oninput = e => {
    STUDIO.madness = +e.target.value;
    $('#stu-mad-o').textContent = Math.round(STUDIO.madness * 100);
    if (!STUDIO.madness && STUDIO.mut) edited();
};
$('#stu-keep').onclick = () => {
    if (!STUDIO.mut) { toast('Turn up Madness first: Keep then saves the bar you are hearing.'); return; }
    STUDIO.grid = cloneGrid(STUDIO.mut.grid);
    S.pattern.steps = STUDIO.mut.steps.map(s => ({ ...s }));
    edited();
    renderPattern();
    toast('Kept: that variation is now your pattern.');
};

// motion recording: while armed, a knob you hold writes its position into every step that passes
$('#stu-rec').onclick = () => {
    STUDIO.rec = !STUDIO.rec;
    $('#stu-rec').setAttribute('aria-pressed', String(STUDIO.rec));
    if (STUDIO.rec) toast('Recording motion: hold a knob and move it while the loop plays.');
};
$('#stu-unrec').onclick = () => {
    for (const key of KNOBS) STUDIO.auto[key] = null;
    STUDIO.rec = false;
    applyLevels();
    renderStudio();
};
for (const key of KNOBS) {
    const el = $(`#stu-k-${key}`);
    // grabbing a knob that is following its move picks it up where it is shown
    el.addEventListener('pointerdown', () => { STUDIO.touch.add(key); STUDIO.bass[key] = +el.value; });
}
window.addEventListener('pointerup', () => STUDIO.touch.clear());
window.addEventListener('pointercancel', () => STUDIO.touch.clear());

$('#stu-swing').oninput = e => { STUDIO.swing = +e.target.value; $('#stu-swing-o').textContent = Math.round(STUDIO.swing * 100); };
for (const key of Object.keys(STUDIO.bass)) {
    $(`#stu-k-${key}`).oninput = e => {
        STUDIO.bass[key] = +e.target.value;
        $(`#stu-k-${key}-o`).textContent = Math.round(STUDIO.bass[key] * 100);
        if (key === 'reso' || key === 'drive') applyLevels();
        if (STUDIO.rec && STUDIO.playhead >= 0) {
            laneOf(key)[STUDIO.playhead] = STUDIO.bass[key];
            renderLanes(STUDIO.playhead);
        }
    };
}
for (const key of ['bass', 'pad', 'lead']) {
    $(`#stu-v-${key}`).oninput = e => {
        STUDIO.vol[key] = +e.target.value;
        $(`#stu-v-${key}-o`).textContent = Math.round(STUDIO.vol[key] * 100);
        applyLevels();
    };
}
for (const band of ['low', 'mid', 'high']) {
    $(`#stu-kill-${band}`).onclick = () => { STUDIO.kill[band] = !STUDIO.kill[band]; applyLevels(); renderStudio(); };
}

// one listener for the whole panel: cells, mute and solo, the bass flags
$('#studio').addEventListener('click', e => {
    const cell = e.target.closest('.stu-cell');
    if (cell) {
        const row = STUDIO.grid[cell.dataset.track], i = +cell.dataset.step;
        row[i] = (row[i] + 1) % 4;
        if (row[i] && ac) playTrack(cell.dataset.track, ac.currentTime + 0.01, row[i] === 2 ? 1 : 0.7);
        edited();
        return;
    }
    const ms = e.target.closest('.stu-ms');
    if (ms) {
        const id = ms.dataset.track;
        if (ms.dataset.ms === 'mute') STUDIO.mute[id] = !STUDIO.mute[id];
        else STUDIO.solo = STUDIO.solo === id ? null : id;
        renderStudio();
        return;
    }
    const flag = e.target.closest('.stu-flag');
    if (flag) {
        const st = S.pattern.steps[+flag.dataset.step];
        st[flag.dataset.kind] = !st[flag.dataset.kind];
        edited();
    }
});

$('#studio').addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.e) {
        const id = t.dataset.track;
        const [k, r] = STUDIO.euclid[id];
        const v = Math.max(0, Math.min(t.dataset.e === 'k' ? 16 : 15, parseInt(t.value, 10) || 0));
        STUDIO.euclid[id] = t.dataset.e === 'k' ? [v, r] : [k, v];
        STUDIO.grid[id] = euclid(...STUDIO.euclid[id]);
        edited();
    } else if (t.classList.contains('stu-vol')) {
        STUDIO.vol[t.dataset.track] = +t.value;
        applyLevels();
    }
});

// bass notes: click switches a step on or off; drag, wheel or arrow keys move it along the scale
let noteDrag = null;
$('#stu-bass').addEventListener('pointerdown', e => {
    const c = e.target.closest('.stu-note');
    if (!c) return;
    noteDrag = { i: +c.dataset.step, y: e.clientY, moved: false };
    try { c.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
});
$('#stu-bass').addEventListener('pointermove', e => {
    if (!noteDrag) return;
    const dy = noteDrag.y - e.clientY;
    if (Math.abs(dy) >= 14) {
        nudgeNote(noteDrag.i, dy > 0 ? 1 : -1);
        noteDrag.y = e.clientY;
        noteDrag.moved = true;
    }
});
$('#stu-bass').addEventListener('pointerup', () => {
    if (noteDrag && !noteDrag.moved) {
        const st = S.pattern.steps[noteDrag.i];
        st.gate = !st.gate;
        if (st.gate) previewBass(st);
        edited();
        renderPattern();
    }
    noteDrag = null;
});
$('#stu-bass').addEventListener('wheel', e => {
    const c = e.target.closest('.stu-note');
    if (!c) return;
    e.preventDefault();
    nudgeNote(+c.dataset.step, e.deltaY < 0 ? 1 : -1);
}, { passive: false });
$('#stu-bass').addEventListener('keydown', e => {
    const c = e.target.closest('.stu-note');
    if (!c || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    nudgeNote(+c.dataset.step, e.key === 'ArrowUp' ? 1 : -1);
});

$('#stu-copy').onclick = () => {
    const code = studioCode();
    const field = $('#stu-code');
    field.value = code;
    navigator.clipboard.writeText(code)
        .then(() => toast('Track code copied: paste it anywhere, and “Load code” brings the whole groove back.'))
        .catch(() => { field.select(); toast('Select the code in the box and copy it.'); });
};
$('#stu-load').onclick = () => {
    if (loadCode($('#stu-code').value)) toast('Track loaded.');
    else toast('That code could not be read. Track codes start with SNS1-.');
};
$('#stu-link').onclick = () => {
    const link = trackLink();
    navigator.clipboard?.writeText(link)
        .then(() => toast('Link copied: whoever opens it hears this track in the Studio.'))
        .catch(() => { const field = $('#stu-code'); field.value = link; field.select(); toast('Select the link in the box and copy it.'); });
};

// ── the story borrows the Studio: its rhythm is rebuilt on an empty grid, then yours comes back ──
let guest = null, gaveRhythm = false;
const rowCode = row => row.map(v => (v ? 1 : 0)).join('');

// the story can open the Studio without stopping, on an empty grid; at every edit it checks the grid and
// the rows it finds right light up. Opening it again while it is borrowed just shows the panel.
actions.studioGuest = check => {
    if (!ac) return;
    if (!guest) {
        guest = { check, grid: cloneGrid(STUDIO.grid), euclid: JSON.parse(JSON.stringify(STUDIO.euclid)), madness: STUDIO.madness };
        if (STUDIO.song.on) setSong(false);
        STUDIO.madness = 0;
        STUDIO.mut = null;
        for (const tr of TRACKS) { STUDIO.grid[tr.id] = stepsOn(); STUDIO.euclid[tr.id] = [0, 0]; }
    }
    guest.check = check;
    $('#studio').classList.add('guest');
    if (!STUDIO.on) openStudio(); else renderStudio();
};

// done (or the story stopped): your grid comes back; a finished rhythm is kept, and waits in slot H
actions.studioGuestEnd = keep => {
    if (!guest) return;
    if (keep) saveMemory({ herRhythm: Object.fromEntries(TRACKS.map(tr => [tr.id, rowCode(STUDIO.grid[tr.id])])) });
    STUDIO.grid = guest.grid;
    STUDIO.euclid = guest.euclid;
    STUDIO.madness = guest.madness;
    guest = null;
    $('#studio').classList.remove('guest');
    if (STUDIO.on) closeStudio();
};

// the rhythm rebuilt in the story fills slot H, when slot H is free
function giveHerRhythm() {
    const her = MEMORY?.herRhythm;
    if (gaveRhythm || !her || STUDIO.slots[7] || STUDIO.cur === 7) return;
    gaveRhythm = true;
    const grid = Object.fromEntries(TRACKS.map(tr => [tr.id, Array.from({ length: 16 }, (_, i) => (String(her[tr.id] || '')[i] === '1' ? 1 : 0))]));
    STUDIO.slots[7] = { ...snapshot(), grid };
    toast('Slot H holds her rhythm, the one you rebuilt in the story.');
}

// while the Studio is open it plays the groove its own way: its drum grid, the bass step it picks
// (Repeat pads, Madness, mute and solo), swing and the acid knobs
const TAKEOVER = {
    drums: studioDrums,
    index: studioIndex,
    steps: () => (STUDIO.mut ? STUDIO.mut.steps : S.pattern.steps),
    bassOn: () => trackAudible('bass'),
    swing: () => STUDIO.swing,
    knobs: () => STUDIO.k,
    resonance: () => 2 + STUDIO.bass.reso * 24,
    step(sk, tb, i, t) {
        stepKnobs(sk, tb);
        if (PADS.active.has('pump') && i % 4 === 0) pumpBeat(t);
    }
};

on('beforeBar', t => { if (STUDIO.on) studioBar(t); });
// every bar the track is saved in this browser, when something changed
on('bar', () => { if (STUDIO.on) saveTrack(); });
addEventListener('pagehide', saveTrack);
// a track link opens the Studio as soon as the music starts
on('started', () => { if (new URLSearchParams(location.search).has('track')) openStudio(); });
on('heard', studioPlayhead);
mode('studio', () => { if (STUDIO.on) closeStudio(); });
feature('studio');
