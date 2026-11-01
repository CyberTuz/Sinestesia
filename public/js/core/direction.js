// A set described as data (tempo, scale, bass line, scene, filter, voice, drop), applied to the music at
// once. The radio stations and the spells speak this language.

import { $, NOTE_NAMES, S, SCALES, SCENES } from './state.js';
import { stopModes } from './bus.js';
import { buildPattern, charMidi, sha256 } from './pattern.js';
import { ac, applyMouseToAudio, delay, revWet } from './audio.js';
import { queuePattern } from './sequencer.js';
import { setScene } from './hud.js';

export function rootMidi(name) {
    const s = NOTE_NAMES.indexOf(name);
    if (s < 0) return null;
    const m = 24 + s;
    return m < 33 ? m + 12 : m;
}

export const degNote = (scale, deg) => scale[deg % scale.length] + 12 * Math.min(2, Math.floor(deg / scale.length));

export async function applyDirection(d, req, say) {
    stopModes('journey', 'mining', 'story');
    S.intro = null;
    const num = (v, lo, hi) => typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;
    const changes = [];

    // the groove: Claude's bassline if it wrote one, else one hashed from its words
    const { bytes, real } = await sha256(req + '|' + say);
    const p = buildPattern(bytes, real, say);
    if (SCALES[d.scale]) { p.scaleName = d.scale; p.scale = SCALES[d.scale]; }
    const rm = rootMidi(d.root);
    if (rm !== null) p.root = rm;
    if (Array.isArray(d.steps) && d.steps.some(v => Number.isInteger(v))) {
        p.steps = p.steps.map((st, i) => {
            const v = d.steps[i % d.steps.length];
            const gate = Number.isInteger(v) && v >= 0;
            const deg = gate ? Math.min(13, v) : 0;
            return {
                gate, deg, oct: 0,
                note: degNote(p.scale, deg),
                accent: !!(Array.isArray(d.accents) && d.accents[i]),
                slide: !!(Array.isArray(d.slides) && d.slides[i]),
                byte: st.byte
            };
        });
    } else {
        p.steps.forEach(st => { st.note = p.scale[st.deg % p.scale.length] + st.oct; });
    }
    p.chars = [...say].slice(0, 32);
    p.hook = p.chars.map(ch => /[\p{L}\p{N}]/u.test(ch) ? charMidi(ch, p) : null);
    p.label = d.label || `🎬 “${req}”`;
    queuePattern(p);

    const si = SCENES.indexOf(d.scene);
    if (si >= 0) { setScene(si); changes.push(SCENES[si]); }
    const bpm = num(d.bpm, 90, 160);
    if (bpm) {
        S.bpm = Math.round(bpm);
        $('#bpm').value = S.bpm;
        $('#bpm-o').textContent = S.bpm;
        if (ac) delay.delayTime.setTargetAtTime((60 / S.bpm) * 0.75, ac.currentTime, 0.2);
        changes.push(`${S.bpm} BPM`);
    }
    changes.push(`${p.scaleName} in ${NOTE_NAMES[p.root % 12]}`);
    const hue = num(d.hue, 0, 1);
    if (hue !== null) S.hue = hue;
    // intensity scales the viewer's own Visions setting, never past it by much
    const inten = num(d.intensity, 0, 1);
    if (inten !== null) S.visMul = 0.5 + inten * 0.65;
    const filter = num(d.filter, 0, 1), space = num(d.space, 0, 1);
    if (filter !== null) S.mouse[0] = filter;
    if (space !== null) {
        S.mouse[1] = 1 - space * 0.8;
        if (ac) revWet.gain.setTargetAtTime(0.15 + space * 0.6, ac.currentTime, 0.8);
    }
    applyMouseToAudio();
    if (typeof d.drums === 'boolean') { S.drums = d.drums; changes.push(d.drums ? 'kick' : 'no kick'); }
    if (typeof d.hats === 'boolean') S.hatsOn = d.hats;
    if (typeof d.bass === 'boolean') S.bassOn = d.bass;
    $('#b-drums').setAttribute('aria-pressed', String(S.drums));
    const voice = { robot: 'robot', choir: 'choir', chant: 'chant', whisper: 'whisper' }[d.voice];
    if (voice && S.voices) S.voiceNext = { kind: voice, text: say };
    if (d.drop === true) { S.dropRiser = true; changes.push('drop incoming'); }
    return changes.join(' · ');
}
