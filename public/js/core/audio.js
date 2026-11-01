// ═══════════════════════════════════════════════════════════════════════
// AUDIO ENGINE (Web Audio, no samples: everything is synthesized)
// ═══════════════════════════════════════════════════════════════════════

import { S, mtof } from './state.js';

export let ac, master, analyser, fxSend, delay, delayFb, duck, noiseBuf, bass, pad, revWet, radioHP, radioLP, radioGain, busOut, eqLow, eqMid, eqHigh, leadBus;
export let timeData;

export function makeNoise() {
    const len = ac.sampleRate * 1.5;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
}

export function makeImpulse(seconds, decay) {
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
}

export function makeDrive(amount) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    return curve;
}

export function initAudio() {
    ac = new (window.AudioContext || window.webkitAudioContext)();

    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    master = ac.createGain();
    master.gain.value = S.volume;
    analyser = ac.createAnalyser();
    analyser.fftSize = 1024;
    timeData = new Float32Array(analyser.fftSize);
    // the pirate radio colors everything through these filters; wide open when it is off
    radioHP = ac.createBiquadFilter(); radioHP.type = 'highpass'; radioHP.frequency.value = 10;
    radioLP = ac.createBiquadFilter(); radioLP.type = 'lowpass'; radioLP.frequency.value = 20000;
    radioGain = ac.createGain();
    // DJ-style kill EQ: each band can drop by 40 dB from the Studio mixer
    eqLow = ac.createBiquadFilter(); eqLow.type = 'lowshelf'; eqLow.frequency.value = 220;
    eqMid = ac.createBiquadFilter(); eqMid.type = 'peaking'; eqMid.frequency.value = 1000; eqMid.Q.value = 0.7;
    eqHigh = ac.createBiquadFilter(); eqHigh.type = 'highshelf'; eqHigh.frequency.value = 3500;
    // the Studio's live effects sit between the master fader and the kill EQ
    buildPerfFx();
    FX.out.connect(eqLow); eqLow.connect(eqMid); eqMid.connect(eqHigh); eqHigh.connect(radioHP);
    radioHP.connect(radioLP); radioLP.connect(radioGain); radioGain.connect(comp);
    comp.connect(analyser); analyser.connect(ac.destination);
    busOut = comp;

    // dotted-eighth delay with a darkening feedback loop
    delay = ac.createDelay(2);
    delay.delayTime.value = (60 / S.bpm) * 0.75;
    delayFb = ac.createGain(); delayFb.gain.value = 0.35;
    const dTone = ac.createBiquadFilter(); dTone.type = 'lowpass'; dTone.frequency.value = 3200;
    delay.connect(dTone); dTone.connect(delayFb); delayFb.connect(delay);
    const dWet = ac.createGain(); dWet.gain.value = 0.4;
    dTone.connect(dWet); dWet.connect(FX.pump);

    const reverb = ac.createConvolver();
    reverb.buffer = makeImpulse(3.2, 2.6);
    const rWet = ac.createGain(); rWet.gain.value = 0.3;
    reverb.connect(rWet); rWet.connect(FX.pump);
    revWet = rWet;

    fxSend = ac.createGain();
    fxSend.connect(delay); fxSend.connect(reverb);

    // sidechain bus: bass and pad duck under the kick
    duck = ac.createGain();
    duck.connect(FX.pump);
    leadBus = ac.createGain();
    leadBus.connect(FX.pump);

    noiseBuf = makeNoise();
    buildBass();
    buildPad();
}

export function buildBass() {
    const osc = ac.createOscillator(); osc.type = 'sawtooth';
    const filt = ac.createBiquadFilter(); filt.type = 'lowpass'; filt.Q.value = 12; filt.frequency.value = 300;
    const drive = ac.createWaveShaper(); drive.curve = makeDrive(2.4); drive.oversample = '2x';
    const vca = ac.createGain(); vca.gain.value = 0;
    const vol = ac.createGain();
    osc.connect(filt); filt.connect(drive); drive.connect(vca); vca.connect(vol); vol.connect(duck);
    const send = ac.createGain(); send.gain.value = 0.12;
    vca.connect(send); send.connect(fxSend);
    osc.start();
    bass = { osc, filt, vca, drive, vol, open: false };
}

export function buildPad() {
    const out = ac.createGain(); out.gain.value = 0.045;
    const filt = ac.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 900; filt.Q.value = 2;
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.06;
    const lfoAmt = ac.createGain(); lfoAmt.gain.value = 600;
    lfo.connect(lfoAmt); lfoAmt.connect(filt.frequency); lfo.start();
    const vol = ac.createGain();
    filt.connect(out); out.connect(vol); vol.connect(duck);
    const send = ac.createGain(); send.gain.value = 0.6; out.connect(send); send.connect(fxSend);
    const voices = [];
    for (let v = 0; v < 4; v++) {
        for (const det of [-9, 9]) {
            const o = ac.createOscillator(); o.type = 'sawtooth'; o.detune.value = det;
            o.connect(filt); o.start();
            voices.push({ o, v });
        }
    }
    pad = { voices, out, filt, vol };
}

export function setChord(p, t) {
    const third = p.scale.includes(3) ? 3 : 4;
    const top = p.scale[p.scale.length - 1];
    const chord = [0, third, 7, top].map(x => p.root + 24 + x);
    for (const { o, v } of pad.voices) o.frequency.setTargetAtTime(mtof(chord[v]), t, 0.6);
}

// Mouse → sound mapping
// during the journey the filter follows the phase, and the mouse still nudges it
export const cutoff = () => {
    const x = S.auto ? Math.min(1, Math.max(0, S.autoCut + (S.mouse[0] - 0.5) * 0.35)) : S.mouse[0];
    return 90 * Math.pow(2, x * 5.6);
};
export const resonance = () => (S.takeover ? S.takeover.resonance() : 4 + (1 - S.mouse[1]) * 20);

export function applyMouseToAudio() {
    if (!ac) return;
    const now = ac.currentTime;
    bass.filt.Q.setTargetAtTime(resonance(), now, 0.05);
    delayFb.gain.setTargetAtTime(0.18 + (1 - S.mouse[1]) * 0.5, now, 0.1);
}

// the live-effect chain, built by buildPerfFx: everything passes through it, the Studio's pads bend it
export const FX = {};

// four steps of level for the Crush pad
export const CRUSH4 = (() => {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.round(x * 4) / 4; }
    return c;
})();

// master → tape stop → freeze ducking → sweep filters → clean or crushed → kill EQ; the freeze ring joins before the filters
export function buildPerfFx() {
    const gain = v => { const g = ac.createGain(); g.gain.value = v; return g; };
    const filter = (type, f, q) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    FX.pump = gain(1);
    FX.pump.connect(master);
    FX.tape = ac.createDelay(4);
    FX.tape.delayTime.value = 0;
    FX.tapeGain = gain(1);
    FX.dry = gain(1);
    FX.hp = filter('highpass', 10, 0.7);
    FX.lp = filter('lowpass', 22000, 0.7);
    FX.clean = gain(1);
    FX.crushIn = gain(0);
    FX.crushOut = gain(0);
    FX.out = gain(1);
    const shaper = ac.createWaveShaper();
    shaper.curve = CRUSH4;
    master.connect(FX.tape); FX.tape.connect(FX.tapeGain); FX.tapeGain.connect(FX.dry); FX.dry.connect(FX.hp);
    FX.hp.connect(FX.lp); FX.lp.connect(FX.clean); FX.clean.connect(FX.out);
    FX.lp.connect(FX.crushIn); FX.crushIn.connect(shaper); shaper.connect(FX.crushOut); FX.crushOut.connect(FX.out);
    // freeze: four long combs, fed for one beat and then left ringing
    FX.freezeIn = gain(0);
    FX.freezeOut = gain(0);
    FX.freezeFb = [];
    master.connect(FX.freezeIn);
    const sum = gain(0.25);
    for (const d of [0.0797, 0.0911, 0.1013, 0.1129]) {
        const dl = ac.createDelay(1);
        dl.delayTime.value = d;
        const damp = filter('lowpass', 3800, 0.5), fb = gain(0);
        FX.freezeIn.connect(dl); dl.connect(damp); damp.connect(fb); fb.connect(dl); damp.connect(sum);
        FX.freezeFb.push(fb);
    }
    const ap1 = filter('allpass', 640, 0.6), ap2 = filter('allpass', 2300, 0.6);
    // combs can ring very loud on a tonal bass line, so the ring has its own limiter
    const lim = ac.createDynamicsCompressor();
    lim.threshold.value = -18; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.005; lim.release.value = 0.25;
    sum.connect(ap1); ap1.connect(ap2); ap2.connect(lim); lim.connect(FX.freezeOut); FX.freezeOut.connect(FX.hp);
}
