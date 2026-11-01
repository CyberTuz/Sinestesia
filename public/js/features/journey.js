// ═══════════════════════════════════════════════════════════════════════
// JOURNEY: a six-phase arrangement that plays itself
// ═══════════════════════════════════════════════════════════════════════

import { $, S } from '../core/state.js';
import { feature, mode, on, stopModes } from '../core/bus.js';
import { ac, pad, revWet } from '../core/audio.js';
import { chant, choir, whisper } from '../core/voices.js';
import { impact, riser } from '../core/instruments.js';
import { sceneQueue } from '../core/sequencer.js';

const JOURNEY = [
    { name: 'Takeoff',     bars: 8,  drums: false, hats: false, bass: false, cut: [0.1, 0.2],  voices: 'whisper', scenes: [2],          vis: 0.45, rev: 0.55, pad: 0.09 },
    { name: 'Climb',      bars: 16, drums: false, hats: true,  bass: true,  cut: [0.15, 0.6], voices: 'whisper', scenes: [0, 5],       vis: 0.65, rev: 0.35, pad: 0.06, riser: true },
    { name: 'Peak',       bars: 16, drums: true,  hats: true,  bass: true,  cut: [0.6, 0.85], voices: 'choir',   scenes: [4, 5, 6, 0], vis: 1.0,  rev: 0.25, pad: 0.04 },
    { name: 'Space',      bars: 8,  drums: false, hats: false, bass: false, cut: [0.3, 0.3],  voices: 'chant',   scenes: [1],          vis: 0.55, rev: 0.7,  pad: 0.1, riser: true },
    { name: 'Awakening',   bars: 16, drums: true,  hats: true,  bass: true,  cut: [0.45, 0.9], voices: 'chant',   scenes: [3, 6, 2],    vis: 0.95, rev: 0.3,  pad: 0.045 },
    { name: 'Landing', bars: 8,  drums: false, hats: true,  bass: true,  cut: [0.5, 0.08], voices: 'whisper', scenes: [2],          vis: 0.4,  rev: 0.5,  pad: 0.08 }
];
const journeyVisuals = [];

function journeyBar(t) {
    let phase;
    if (S.jPending) {
        S.jPending = false;
        S.jPhase = 0;
        S.jBar = 0;
        phase = JOURNEY[0];
        applyPhase(phase, t, false);
    } else {
        S.jBar++;
        if (S.jBar >= JOURNEY[S.jPhase].bars) {
            S.jPhase = (S.jPhase + 1) % JOURNEY.length;
            S.jBar = 0;
            phase = JOURNEY[S.jPhase];
            applyPhase(phase, t, phase.drums);
        } else {
            phase = JOURNEY[S.jPhase];
        }
    }
    S.autoCut = phase.cut[0] + (phase.cut[1] - phase.cut[0]) * (S.jBar / Math.max(1, phase.bars - 1));
    if (phase.scenes.length > 1 && S.jBar > 0 && S.jBar % 4 === 0) {
        sceneQueue.push({ t, scene: phase.scenes[(S.jBar / 4) % phase.scenes.length] });
    }
    if (phase.riser && S.jBar === phase.bars - 2) riser(t, 2);
    if (S.voices) {
        if (phase.voices === 'whisper' && S.jBar % 2 === 1) whisper(t + Math.random() * 120 / S.bpm);
        if (phase.voices === 'choir' && S.jBar % 4 === 0) choir(t);
        if (phase.voices === 'chant' && S.jBar % 2 === 0) chant(t);
    }
    journeyVisuals.push({ t, phase: S.jPhase, bar: S.jBar });
}

function applyPhase(phase, t, withImpact) {
    S.drums = phase.drums;
    S.hatsOn = phase.hats;
    S.bassOn = phase.bass;
    S.visMul = phase.vis / 0.7;
    revWet.gain.setTargetAtTime(phase.rev, t, 1.5);
    pad.out.gain.setTargetAtTime(phase.pad, t, 2);
    sceneQueue.push({ t, scene: phase.scenes[0] });
    if (withImpact) impact(t);
}

function setJourney(on) {
    S.auto = on;
    const jb = $('#b-journey');
    jb.setAttribute('aria-pressed', String(on));
    jb.textContent = on ? '■ Stop the journey' : '✦ Start the journey';
    $('#journey').hidden = !on;
    if (on) {
        S.intro = null;
        stopModes('story', 'radio', 'studio');
        S.jPending = true;
        $('#j-name').textContent = 'Starting at the next bar';
        $('#j-count').textContent = '';
        return;
    }
    S.drums = S.hatsOn = S.bassOn = true;
    S.visMul = 1;
    $('#b-drums').setAttribute('aria-pressed', 'true');
    if (ac) {
        revWet.gain.setTargetAtTime(0.3, ac.currentTime, 0.5);
        pad.out.gain.setTargetAtTime(0.045, ac.currentTime, 1);
    }
}

// the progress bar: one segment per phase, as wide as the phase is long
const jSegs = JOURNEY.map(ph => {
    const s = document.createElement('div');
    s.className = 'j-seg';
    s.style.flex = ph.bars;
    s.title = ph.name;
    s.appendChild(document.createElement('i'));
    $('#j-track').appendChild(s);
    return s;
});

function renderJourney(v) {
    if (!S.auto) return;
    const ph = JOURNEY[v.phase];
    $('#j-name').textContent = `Journey ${v.phase + 1}/${JOURNEY.length} · ${ph.name}`;
    $('#j-count').textContent = `bar ${v.bar + 1}/${ph.bars}`;
    jSegs.forEach((s, k) => {
        s.classList.toggle('done', k < v.phase);
        s.classList.toggle('now', k === v.phase);
        s.firstChild.style.width = k === v.phase ? ((v.bar + 1) / ph.bars) * 100 + '%' : '';
    });
    $('#b-drums').setAttribute('aria-pressed', String(S.drums));
}

$('#b-journey').onclick = () => setJourney(!S.auto);

on('bar', t => { if (S.auto) journeyBar(t); });
on('frame', () => {
    if (!ac) return;
    const now = ac.currentTime;
    while (journeyVisuals.length && journeyVisuals[0].t <= now) renderJourney(journeyVisuals.shift());
});
mode('journey', () => { if (S.auto) setJourney(false); });
feature('journey');
