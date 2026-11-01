// ── drums ─────────────────────────────────────────────────────────────

import { S, mtof } from './state.js';
import { ac, bass, cutoff, duck, fxSend, leadBus, master, noiseBuf } from './audio.js';
import { CRUSH, VOWEL_OF, voiceNode, voiceVisuals } from './voices.js';

export const kickQueue = [];

// every drum takes a velocity and an output, so the Studio can route each track through its own fader
export function kick(t, vel = 1, out = master) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.5);
    duck.gain.setValueAtTime(0.3, t);
    duck.gain.setTargetAtTime(1, t + 0.03, 0.09);
    kickQueue.push(t);
}

export function hat(t, open, vel = 1, out = master) {
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = open ? 7000 : 9500;
    const g = ac.createGain();
    const len = open ? 0.2 : 0.035;
    g.gain.setValueAtTime((open ? 0.16 : 0.1) * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(hp); hp.connect(g); g.connect(out);
    src.start(t, Math.random()); src.stop(t + len + 0.02);
}

export function clap(t, vel = 1, out = master) {
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1.1;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    for (const off of [0, 0.011, 0.022]) {
        g.gain.setValueAtTime(0.5 * vel, t + off);
        g.gain.exponentialRampToValueAtTime(0.05 * vel, t + off + 0.01);
    }
    g.gain.setValueAtTime(0.35 * vel, t + 0.033);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(bp); bp.connect(g); g.connect(out);
    const s = ac.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(fxSend);
    src.start(t, Math.random()); src.stop(t + 0.3);
}

// ── acid bass step ────────────────────────────────────────────────────
export function playBass(t, st, next) {
    const dur = 60 / S.bpm / 4;
    const p = S.pattern;
    const f = mtof(p.root + st.note);
    if (st.slide && bass.open) bass.osc.frequency.setTargetAtTime(f, t, 0.035);
    else bass.osc.frequency.setValueAtTime(f, t);

    // a feature that takes over the groove (the Studio) shapes the filter with its knobs; elsewhere the mouse does
    const sb = S.takeover ? S.takeover.knobs() : null;
    const base = sb ? 90 * Math.pow(2, sb.cutoff * 5.6) : cutoff();
    const env = sb ? 1.5 + sb.env * 7 : 3.4;
    const decay = sb ? 0.02 + sb.decay * 0.25 : 0.05;
    const peak = Math.min(12000, base * (st.accent ? env * 1.8 : env));
    bass.filt.frequency.cancelScheduledValues(t);
    bass.filt.frequency.setValueAtTime(peak, t);
    bass.filt.frequency.setTargetAtTime(base, t, st.accent ? decay * 2 : decay);

    bass.vca.gain.cancelScheduledValues(t);
    bass.vca.gain.setValueAtTime(st.accent ? 0.42 : 0.28, t);
    const tied = next.gate && next.slide;
    if (!tied) bass.vca.gain.setTargetAtTime(0, t + dur * 0.72, 0.012);
    bass.open = tied;
}

// ── lead voices from the keyboard ─────────────────────────────────────
export function lead(midi, t, vel = 1) {
    const f = mtof(midi);
    const filt = ac.createBiquadFilter(); filt.type = 'lowpass'; filt.Q.value = 5;
    filt.frequency.setValueAtTime(Math.min(16000, f * 9), t);
    filt.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.4);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13 * vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    for (const det of [-8, 8]) {
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        o.connect(filt); o.start(t); o.stop(t + 0.95);
    }
    const sq = ac.createOscillator(); sq.type = 'square'; sq.frequency.value = f * 2;
    const sqg = ac.createGain(); sqg.gain.value = 0.25;
    sq.connect(sqg); sqg.connect(filt); sq.start(t); sq.stop(t + 0.95);
    filt.connect(g); g.connect(leadBus);
    const s = ac.createGain(); s.gain.value = 0.55; g.connect(s); s.connect(fxSend);
}

export function bell(midi, t) {
    const f = mtof(midi);
    const car = ac.createOscillator(), mod = ac.createOscillator(), mg = ac.createGain(), g = ac.createGain();
    car.frequency.value = f; mod.frequency.value = f * 3.5;
    mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(1, t + 0.6);
    mod.connect(mg); mg.connect(car.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    car.connect(g); g.connect(master); g.connect(fxSend);
    car.start(t); mod.start(t); car.stop(t + 0.85); mod.stop(t + 0.85);
}

export function whoosh(t) {
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 4;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(5000, t + 0.45);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(bp); bp.connect(g); g.connect(master); g.connect(fxSend);
    src.start(t, Math.random()); src.stop(t + 0.55);
}

export function rim(t, vel = 1, out = master) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.value = 1750;
    g.gain.setValueAtTime(0.18 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g); g.connect(out); g.connect(fxSend);
    o.start(t); o.stop(t + 0.06);
}

export function glitchSound(t) {
    const o = ac.createOscillator(), g = ac.createGain(), bp = ac.createBiquadFilter();
    o.type = 'square';
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.14);
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2;
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(bp); bp.connect(g); g.connect(master); g.connect(fxSend);
    o.start(t); o.stop(t + 0.18);
}

// ── the machine's sound: ring modulation and bit crushing ─────────────
export function machineNote(midi, t) {
    const f = mtof(midi);
    const o = ac.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(f, t);
    const mod = ac.createOscillator(); mod.frequency.setValueAtTime(f * 2.76, t);
    const ring = ac.createGain(); ring.gain.value = 0;
    mod.connect(ring.gain);
    o.connect(ring);
    const crush = ac.createWaveShaper(); crush.curve = CRUSH;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(9000, f * 3); bp.Q.value = 1.4;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    ring.connect(crush); crush.connect(bp); bp.connect(g);
    let outNode = g;
    if (ac.createStereoPanner) { const pn = ac.createStereoPanner(); pn.pan.value = 0.45; g.connect(pn); outNode = pn; }
    outNode.connect(master);
    const s = ac.createGain(); s.gain.value = 0.45;
    outNode.connect(s); s.connect(fxSend);
    o.start(t); mod.start(t);
    o.stop(t + 0.27); mod.stop(t + 0.27);
}

// ── transitions ───────────────────────────────────────────────────────
export function riser(t, bars) {
    const dur = bars * 240 / S.bpm;
    const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(250, t);
    bp.frequency.exponentialRampToValueAtTime(9000, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + dur);
    src.connect(bp); bp.connect(g); g.connect(master); g.connect(fxSend);
    src.start(t); src.stop(t + dur);
    const sd = 60 / S.bpm / 4, lastBar = t + dur - 16 * sd;
    for (let k = 0; k < 16; k++) if (k >= 8 || k % 2 === 0) clap(lastBar + k * sd);
}

export function impact(t) {
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    src.connect(hp); hp.connect(g); g.connect(master); g.connect(fxSend);
    src.start(t); src.stop(t + 1.45);
    const o = ac.createOscillator(), og = ac.createGain();
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
    og.gain.setValueAtTime(0.7, t); og.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    o.connect(og); og.connect(master);
    o.start(t); o.stop(t + 1.35);
    voiceVisuals.push({ t, kind: 'impact' });
}

// ── theremin on press ─────────────────────────────────────────────────
export let theremin = null;
export function thereminMidi() {
    const p = S.pattern, len = p.scale.length;
    const deg = Math.floor(S.mouse[0] * len * 3);
    return p.root + 24 + 12 * Math.floor(deg / len) + p.scale[deg % len];
}

export function thereminStart() {
    if (!ac || S.paused || theremin) return;
    const t = ac.currentTime;
    const o = ac.createOscillator(); o.type = 'triangle';
    const o2 = ac.createOscillator(); o2.type = 'sine';
    const vib = ac.createOscillator(); vib.frequency.value = 5.5;
    const vibAmt = ac.createGain(); vibAmt.gain.value = 6;
    vib.connect(vibAmt); vibAmt.connect(o.frequency); vibAmt.connect(o2.frequency);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
    o.connect(g); o2.connect(g); g.connect(master);
    const s = ac.createGain(); s.gain.value = 0.7; g.connect(s); s.connect(fxSend);
    const f = mtof(thereminMidi());
    o.frequency.value = f; o2.frequency.value = f * 2;
    o.start(t); o2.start(t); vib.start(t);
    theremin = { o, o2, vib, g };
    thereminMove();
}

export function thereminMove() {
    if (!theremin) return;
    const t = ac.currentTime;
    const f = mtof(thereminMidi());
    theremin.o.frequency.setTargetAtTime(f, t, 0.05);
    theremin.o2.frequency.setTargetAtTime(f * 2, t, 0.05);
    theremin.g.gain.setTargetAtTime(0.04 + (1 - S.mouse[1]) * 0.14, t, 0.05);
}

export function thereminStop() {
    if (!theremin) return;
    const { o, o2, vib, g } = theremin;
    const t = ac.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0.0001, t, 0.12);
    [o, o2, vib].forEach(n => n.stop(t + 0.8));
    theremin = null;
}

// a short tom for the Studio's Perc track
export function perc(t, vel = 1, out = master) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(130, t + 0.18);
    g.gain.setValueAtTime(0.5 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g); g.connect(out);
    const s = ac.createGain(); s.gain.value = 0.25;
    g.connect(s); s.connect(fxSend);
    o.start(t); o.stop(t + 0.3);
}

// each instrument sounds the same note its own way
export function playAs(role, m, t, ch = '') {
    if (role === 'bells') bell(m + 12, t);
    else if (role === 'machine') machineNote(m, t);
    else if (role === 'voice') {
        const l = ch.toLowerCase();
        const vw = VOWEL_OF[l] || (l.length === 1 && 'aeiou'.includes(l) ? l : 'aeiou'[(l.codePointAt(0) || 0) % 5]);
        const v = voiceNode(t, (Math.random() - 0.5) * 0.6, false);
        v.pitch(mtof(m - 12), t, 0);
        v.vowel(vw, t);
        v.out.gain.linearRampToValueAtTime(0.4, t + 0.03);
        v.out.gain.setValueAtTime(0.4, t + 0.22);
        v.stop(t + 0.25);
    } else lead(m, t);
}
