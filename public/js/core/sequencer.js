// ═══════════════════════════════════════════════════════════════════════
// SEQUENCER (lookahead scheduler)
// ═══════════════════════════════════════════════════════════════════════

import { $, S } from './state.js';
import { emit } from './bus.js';
import { ac, bass, setChord } from './audio.js';
import { randomVoice, speakAs } from './voices.js';
import { clap, hat, impact, kick, lead, playBass, rim, riser } from './instruments.js';
import { addSigil, renderPattern } from './hud.js';

export const LOOKAHEAD = 0.12;
export let nextStepTime = 0, stepIndex = 0, timer = null;
export const visualSteps = [];
export const sceneQueue = [];
export const hookVisuals = [];

export const stepDur = () => 60 / S.bpm / 4;

export function scheduler() {
    if (nextStepTime < ac.currentTime - 0.2) nextStepTime = ac.currentTime + 0.05; // tab was asleep
    while (nextStepTime < ac.currentTime + LOOKAHEAD) {
        scheduleStep(stepIndex, nextStepTime);
        nextStepTime += stepDur();
        stepIndex = (stepIndex + 1) % 16;
    }
}

export function scheduleStep(i, t) {
    if (i === 0) {
        S.bar++;
        // features that pick what plays this bar: the Studio's slots, the machine's reply
        emit('beforeBar', t);
        if (S.pending) { applyPattern(S.pending, t); S.pending = null; }
        // drops: a riser for two bars, then the kick comes back with an impact
        if (S.dropRiser) { S.dropRiser = false; riser(t, 2); S.drums = false; S.dropAt = S.bar + 2; }
        if (S.dropAt && S.bar >= S.dropAt) { S.dropAt = 0; S.dropNow = true; }
        if (S.dropNow) {
            S.dropNow = false;
            impact(t);
            S.drums = true;
            $('#b-drums').setAttribute('aria-pressed', 'true');
            if (S.dropScene !== null && S.dropScene >= 0) sceneQueue.push({ t, scene: S.dropScene });
            S.dropScene = null;
        }
        if (S.voiceNext) { const v = S.voiceNext; S.voiceNext = null; speakAs(v.kind, v.text, t); }
        if (S.intro !== null) introBar(t);
        // features that play along with the bar: the journey, the radio, the machine
        emit('bar', t);
        if (!S.auto && S.voices && !S.story && S.bar % 4 === 1 && Math.random() < 0.7) randomVoice(t);
    }
    drumStep(i, t);
    emit('step', i, t);
    // a feature can take over the groove (the Studio does): its own steps, swing, bass mute and knobs
    const tk = S.takeover;
    const steps = tk ? tk.steps() : S.pattern.steps;
    // the Tempo spell repeats the first beat for a bar; dub plays the bass on the beat only
    const sk = S.stutterBar === S.bar ? i % 4 : tk ? tk.index(i) : i;
    const dubRest = S.style === 'dub' && i % 2 === 1;
    const tb = tk && i % 2 ? t + tk.swing() * stepDur() : t;
    if (tk) tk.step(sk, tb, i, t);
    if (S.bassOn && (!tk || tk.bassOn()) && steps[sk].gate && !dubRest) playBass(tb, steps[sk], steps[(sk + 1) % 16]);
    else if (!bass.open || !S.bassOn) { bass.vca.gain.setTargetAtTime(0, t, 0.01); bass.open = false; }

    const hook = S.pattern.hook;
    if (S.echo && hook.length && i % 2 === 0) {
        const k = S.hookPos++ % hook.length;
        if (hook[k] !== null) {
            lead(hook[k], t, 0.45);
            hookVisuals.push({ t, ch: S.pattern.chars[k] });
        }
    }
    visualSteps.push({ i, t, bar: S.bar });
}

export function nextGridTime() {
    if (!S.quantize) return ac.currentTime;
    const sd = stepDur();
    let t = nextStepTime;
    while (t - sd > ac.currentTime + 0.005) t -= sd;
    return t;
}

export function applyPattern(p, t) {
    S.pattern = p;
    S.hookPos = 0;
    S.sigilAge = 0;
    addSigil(p);
    emit('pattern', p);
    if (ac) {
        setChord(p, t ?? ac.currentTime);
        setTimeout(renderPattern, Math.max(0, ((t ?? ac.currentTime) - ac.currentTime) * 1000));
    } else {
        renderPattern();
    }
}

// a new groove waits for the next bar once the music runs; before that it shows at once
export function queuePattern(p) {
    if (ac) S.pending = p;
    else { S.pattern = p; renderPattern(); addSigil(p); S.sigilAge = 0; }
}

// free play starts with the pad alone; hats, bass and kick join a few bars apart
export function startIntro() {
    S.intro = 0;
    S.drums = S.hatsOn = S.bassOn = false;
    S.visMul = 0.45;
    $('#b-drums').setAttribute('aria-pressed', 'false');
}

export function introBar(t) {
    const b = S.intro++;
    S.visMul = Math.min(1, 0.45 + b * 0.04);
    if (b === 4) S.hatsOn = true;
    if (b === 8) S.bassOn = true;
    if (b === 12) riser(t, 2);
    if (b === 14) {
        S.drums = true;
        $('#b-drums').setAttribute('aria-pressed', 'true');
        S.intro = null;
        S.visMul = 1;
    }
}

// ── the drums: the Studio's grid while it is open, otherwise the genre on air ──
export function drumStep(i, t) {
    if (S.takeover) { S.takeover.drums(i, t); return; }
    const st = S.style;
    if (S.stutterBar === S.bar) hat(t + stepDur() / 2, false, 0.5);
    if (st === 'dub') {
        // one drop: kick and rim together on the third beat, hats skanking on the offbeats
        if (S.drums && i === 8) { kick(t); rim(t); }
        if (S.drums && i === 14 && Math.random() < 0.3) rim(t);
        if (S.hatsOn && i % 4 === 2) hat(t, false, 0.5);
        return;
    }
    if (st === 'break') {
        if (S.drums) {
            if (i === 0 || i === 6 || i === 10) kick(t);
            if (i === 4 || i === 12) clap(t);
            if (i === 15 && Math.random() < 0.5) clap(t);
        }
        if (S.hatsOn) hat(t, i === 14, i % 2 ? 0.45 : 0.85);
        return;
    }
    if (st === 'ambient' || st === 'numbers' || st === 'silence') return;
    if (S.drums) {
        if (i % 4 === 0) kick(t);
        if (i === 4 || i === 12) clap(t);
    }
    if (S.hatsOn) {
        if (!S.drums) { if (i % 2 === 1) hat(t, false, 0.4); }
        else if (i % 4 === 2) hat(t, true);
        else hat(t, false, i % 2 ? 0.6 : 0.9);
    }
}

// both pages lock their bars to the wall clock, so at the same tempo the bars coincide
export function alignToClock(offset = 0) {
    if (!ac) return;
    const sdMs = stepDur() * 1000, now = Date.now() + offset;
    const k = Math.ceil(now / sdMs) + 2;
    nextStepTime = ac.currentTime + (k * sdMs - now) / 1000;
    stepIndex = k % 16;
}

// the clock starts a moment from now; the scheduler then keeps its short lookahead filled
export function startSequencer() {
    nextStepTime = ac.currentTime + 0.08;
    timer = setInterval(scheduler, 25);
}
