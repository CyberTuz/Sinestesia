// ── pseudo-human voices: a sawtooth "throat" (or breath noise) through vowel formants ──

import { S, mtof } from './state.js';
import { ac, fxSend, master, noiseBuf } from './audio.js';

export const FORMANTS = {
    a: [[800, 80, 1], [1150, 90, 0.5], [2900, 120, 0.25]],
    e: [[480, 70, 1], [1720, 100, 0.4], [2520, 120, 0.2]],
    i: [[270, 60, 1], [2290, 100, 0.3], [3010, 120, 0.2]],
    o: [[450, 70, 1], [800, 80, 0.45], [2830, 100, 0.15]],
    u: [[325, 50, 1], [700, 60, 0.3], [2530, 170, 0.1]]
};
export const VOWEL_OF = { 'à': 'a', 'á': 'a', 'è': 'e', 'é': 'e', 'ì': 'i', 'í': 'i', 'ò': 'o', 'ó': 'o', 'ù': 'u', 'ú': 'u', 'y': 'i' };
export const voiceVisuals = [];

export function phraseVowels(p) {
    const v = (p.vowelChars || p.chars).map(c => c.toLowerCase()).map(c => VOWEL_OF[c] || c).filter(c => c.length === 1 && 'aeiou'.includes(c));
    return v.length ? v : ['a', 'o', 'u'];
}

export function voiceNode(t, pan, breath, robot = false) {
    const out = ac.createGain();
    out.gain.setValueAtTime(0, t);
    let dest = out, ringOsc = null;
    if (robot) {
        // ring modulation and bit crushing turn the throat into a machine
        const ring = ac.createGain(); ring.gain.value = 0;
        ringOsc = ac.createOscillator(); ringOsc.frequency.value = 90;
        ringOsc.connect(ring.gain);
        ringOsc.start(t);
        const crush = ac.createWaveShaper(); crush.curve = CRUSH;
        const dry = ac.createGain(); dry.gain.value = 0.45;
        const mix = ac.createGain();
        out.connect(ring); ring.connect(crush); crush.connect(mix);
        out.connect(dry); dry.connect(mix);
        dest = mix;
    }
    if (ac.createStereoPanner) {
        const pn = ac.createStereoPanner();
        pn.pan.value = pan;
        dest.connect(pn);
        dest = pn;
    }
    dest.connect(master);
    const send = ac.createGain(); send.gain.value = 0.9;
    dest.connect(send); send.connect(fxSend);

    const bands = [0, 1, 2].map(() => {
        const f = ac.createBiquadFilter(); f.type = 'bandpass';
        const g = ac.createGain();
        f.connect(g); g.connect(out);
        return { f, g };
    });

    let src, lfo = null;
    if (breath) {
        src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        src.start(t, Math.random());
    } else {
        src = ac.createOscillator(); src.type = robot ? 'square' : 'sawtooth';
        lfo = ac.createOscillator(); lfo.frequency.value = 4.6 + Math.random() * 1.2;
        const depth = ac.createGain(); depth.gain.value = robot ? 0 : 18;
        lfo.connect(depth); depth.connect(src.detune);
        src.start(t); lfo.start(t);
    }
    bands.forEach(b => src.connect(b.f));

    let first = true;
    return {
        out,
        vowel(v, time, glide = 0.05) {
            FORMANTS[v].forEach(([F, BW, G], k) => {
                const { f, g } = bands[k];
                const gain = G * (breath ? 3 : 1);
                if (first) {
                    f.frequency.setValueAtTime(F, time); f.Q.setValueAtTime(F / BW, time); g.gain.setValueAtTime(gain, time);
                } else {
                    f.frequency.setTargetAtTime(F, time, glide); f.Q.setTargetAtTime(F / BW, time, glide); g.gain.setTargetAtTime(gain, time, glide);
                }
            });
            first = false;
        },
        pitch(freq, time, glide = 0.04) {
            if (breath) return;
            if (glide === 0) src.frequency.setValueAtTime(freq, time);
            else src.frequency.setTargetAtTime(freq, time, glide);
        },
        stop(time) {
            out.gain.setTargetAtTime(0, time, 0.15);
            src.stop(time + 1.2);
            if (lfo) lfo.stop(time + 1.2);
            if (ringOsc) ringOsc.stop(time + 1.2);
        }
    };
}

// a solo voice sings the phrase's vowels on the hook's notes, one per beat
export function chant(t) {
    const p = S.pattern;
    const vowels = phraseVowels(p);
    const notes = p.hook.filter(n => n !== null);
    const beat = 60 / S.bpm;
    const n = 8;
    const v = voiceNode(t, (Math.random() - 0.5) * 0.6, false);
    for (let k = 0; k < n; k++) {
        const time = t + k * beat;
        const midi = notes.length ? notes[k % notes.length] - 12 : p.root + 24 + p.scale[k % p.scale.length];
        v.pitch(mtof(midi), time, k ? 0.04 : 0);
        v.vowel(vowels[k % vowels.length], time, 0.05);
    }
    v.out.gain.linearRampToValueAtTime(0.5, t + 0.2);
    v.out.gain.setValueAtTime(0.5, t + n * beat - 0.3);
    v.stop(t + n * beat - 0.2);
    voiceVisuals.push({ t, kind: 'chant' });
}

// three voices hold the chord and morph aah → ooh → uuh over two bars
export function choir(t) {
    const p = S.pattern;
    const third = p.scale.includes(3) ? 3 : 4;
    const bar = 240 / S.bpm;
    const seq = ['a', 'o', 'u', 'o'];
    [36, 24 + third, 24 + 7].forEach((iv, k) => {
        const v = voiceNode(t, [0, -0.6, 0.6][k], false);
        v.pitch(mtof(p.root + iv) * (1 + (Math.random() - 0.5) * 0.004), t, 0);
        seq.forEach((vw, j) => v.vowel(vw, t + j * bar * 0.5, 0.4));
        v.out.gain.linearRampToValueAtTime(0.28, t + 1.2);
        v.out.gain.setValueAtTime(0.28, t + bar * 2 - 0.8);
        v.stop(t + bar * 2 - 0.6);
    });
    voiceVisuals.push({ t, kind: 'choir' });
}

// breathy syllables that drift around the stereo field
export function whisper(t) {
    const vowels = phraseVowels(S.pattern);
    const start = Math.floor(Math.random() * vowels.length);
    const syl = 2 + Math.floor(Math.random() * 3);
    const d = 0.16;
    const v = voiceNode(t, (Math.random() * 2 - 1) * 0.85, true);
    for (let k = 0; k < syl; k++) v.vowel(vowels[(start + k) % vowels.length], t + k * d, 0.03);
    v.out.gain.linearRampToValueAtTime(0.35, t + 0.04);
    v.out.gain.setValueAtTime(0.35, t + syl * d - 0.05);
    v.stop(t + syl * d);
    voiceVisuals.push({ t, kind: 'whisper' });
}

export function randomVoice(t) {
    const r = Math.random();
    if (r < 0.4) whisper(t + Math.random() * 120 / S.bpm);
    else if (r < 0.75) chant(t);
    else choir(t);
}

// a coarse staircase: the bit crushing of the robot voice and of the machine's notes
export const CRUSH = (() => {
    const n = 512, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.round(x * 6) / 6; }
    return c;
})();

// what the voices say, shown as tokens on screen
export const machineVisuals = [];

// the machine reads a line aloud: its vowels, on a flat robotic contour, one per eighth note;
// the low voice (the story's Archivist) speaks an octave down, slower, on a single note
export function robotSpeak(t, text, low = false) {
    const vowels = [...String(text).toLowerCase()].map(c => VOWEL_OF[c] || c).filter(c => c.length === 1 && 'aeiou'.includes(c)).slice(0, 14);
    if (!vowels.length) return;
    const p = S.pattern;
    const d = 60 / S.bpm / (low ? 1.5 : 2);
    const contour = low ? [0] : [0, 0, 3, 0, -2, 0, 5, 0];
    const v = voiceNode(t, -0.3, false, true);
    vowels.forEach((vw, k) => {
        const time = t + k * d;
        v.pitch(mtof(p.root + (low ? 19 : 31) + contour[k % contour.length]), time, 0);
        v.vowel(vw, time, 0.01);
    });
    v.out.gain.linearRampToValueAtTime(0.6, t + 0.03);
    v.out.gain.setValueAtTime(0.6, t + vowels.length * d - 0.05);
    v.stop(t + vowels.length * d);
    machineVisuals.push({ t, kind: 'tokens', text });
}

// the voice the spells and the radio speak with
export function speakAs(kind, text, t) {
    if (kind === 'robot') robotSpeak(t, text);
    else if (kind === 'choir') choir(t);
    else if (kind === 'chant') chant(t);
    else whisper(t);
}
