// ═══════════════════════════════════════════════════════════════════════
// PIRATE RADIO: a shortwave dial between 2.5 and 12 MHz
// ═══════════════════════════════════════════════════════════════════════

import { $, S } from '../core/state.js';
import { actions, feature, mode, on, stopModes } from '../core/bus.js';
import { ac, busOut, noiseBuf, pad, radioGain, radioHP, radioLP } from '../core/audio.js';
import { robotSpeak, whisper } from '../core/voices.js';
import { bell } from '../core/instruments.js';
import { setDrawer, termLine, toast, typewrite, updateTerm } from '../core/hud.js';
import { applyDirection } from '../core/direction.js';
import { MEMORY, daysSince, saveMemory } from '../core/memory.js';

const DIAL_MIN = 2.5, DIAL_MAX = 12, BAND = 0.3;
const fmtF = f => f.toFixed(2);
const onFreq = f => `on ${fmtF(f)}`;
const daysText = n => (n === 1 ? 'one day' : `${n} days`);

const STATIONS = [
    { f: 3.35, name: 'Seabed Radio', style: 'ambient', say: 'this is seabed radio, broadcasting from the bottom of the sea',
      d: { scene: 'Liquid', scale: 'Dorian', bpm: 96, filter: 0.25, space: 0.9, hue: 0.55 } },
    { f: 4.8, name: 'Drowned Dub', style: 'dub', say: 'drowned dub, the bass breathes slowly',
      d: { scene: 'Kaleido', scale: 'Minor', bpm: 140, filter: 0.32, space: 0.8, hue: 0.32 } },
    { f: 6.1, name: 'Numbers Station', style: 'numbers', say: '',
      d: { scene: 'Network', scale: 'Phrygian', bpm: 100, filter: 0.15, space: 0.6, hue: 0.7 } },
    { f: 7.45, name: 'Night Acid', style: 'techno', say: 'night acid, on air as long as someone listens',
      d: { scene: 'Tunnel', scale: 'Phrygian', bpm: 132, filter: 0.7, space: 0.3, hue: 0.9 } },
    { f: 9.2, name: 'Last Stop Breaks', style: 'break', say: 'last stop breaks, from the end of the line',
      d: { scene: 'City', scale: 'Pentatonic', bpm: 136, filter: 0.6, space: 0.35, hue: 0.12 } },
    { f: 11.05, name: 'Silence', style: 'silence', say: '',
      d: { scene: 'Singularity', scale: 'Dorian', bpm: 90, filter: 0.1, space: 1, hue: 0.6 } }
];

// her frequency comes from her name, kept clear of the other stations
function herFreq(name) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.codePointAt(0)) >>> 0;
    let f = 2.8 + (h % 900) / 100;
    const crowded = x => STATIONS.some(s => Math.abs(s.f - x) < 0.5) || x > DIAL_MAX - 0.3;
    for (let k = 0; k < 60 && crowded(f); k++) f = DIAL_MIN + 0.3 + ((f - DIAL_MIN + 0.37) % (DIAL_MAX - DIAL_MIN - 0.6));
    if (crowded(f)) f = 8.3;
    return Math.round(f * 100) / 100;
}

// after the "become the music" ending she is in your notes, not on the air
const herOnAir = () => MEMORY?.name && MEMORY.ending !== 'diventa';

function stationList() {
    const list = STATIONS.slice();
    if (RADIO.guest) list.push(RADIO.guest.station);
    if (herOnAir()) {
        list.push({
            f: MEMORY.freq || herFreq(MEMORY.name), name: `${MEMORY.name}'s frequency`, her: true, say: '',
            style: MEMORY.ending === 'resta' ? 'techno' : 'ambient',
            d: { scene: 'Cathedral', scale: 'Dorian', bpm: MEMORY.bpm || 120, filter: 0.4, space: 0.85, hue: 0.85 }
        });
    }
    return list;
}

const RADIO = { on: false, f: 6, locked: null, strength: 0, nodes: null, numIdx: 0, heard: false, guest: null };

// a free spot on the dial for the story's fragment, picked by her name: one decimal, so the numbers
// station can read it as two digits
function fragmentFreq(seed) {
    let h = 0;
    for (const c of seed) h = (h * 31 + c.codePointAt(0)) >>> 0;
    const free = [];
    for (let k = 30; k < 100; k++) if (stationList().every(s => Math.abs(s.f - k / 10) >= 0.5)) free.push(k / 10);
    return free[h % free.length];
}

function startRadio() {
    if (!ac) { toast('Press Play first.'); return; }
    if (S.story && !RADIO.guest) { toast('Finish the story first, or stop it from the controls.'); return; }
    stopModes('journey', 'mining');
    S.intro = null;
    const t = ac.currentTime;
    const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.5;
    const sg = ac.createGain(); sg.gain.value = 0.0001;
    src.connect(bp); bp.connect(sg); sg.connect(busOut);
    // the heterodyne whistle of an old receiver: it drops in pitch as you near a station
    const wh = ac.createOscillator(); wh.type = 'sine'; wh.frequency.value = 1500;
    const wg = ac.createGain(); wg.gain.value = 0;
    wh.connect(wg); wg.connect(busOut);
    src.start(t, Math.random()); wh.start(t);
    RADIO.nodes = { src, sg, wh, wg };
    RADIO.on = true;
    RADIO.locked = null;
    RADIO.strength = 0;
    // start in the static, away from every station
    let f;
    do { f = DIAL_MIN + 0.2 + Math.random() * (DIAL_MAX - DIAL_MIN - 0.4); } while (stationList().some(s => Math.abs(s.f - f) < 0.6));
    RADIO.f = f;
    $('#radio').hidden = false;
    $('#b-radio').setAttribute('aria-pressed', 'true');
    renderDial();
    $('#rd-dial').focus();
}

function stopRadio() {
    if (!RADIO.on) return;
    const guest = RADIO.guest;
    RADIO.guest = null;
    RADIO.on = false;
    RADIO.locked = null;
    if (ac && RADIO.nodes) {
        const t = ac.currentTime;
        RADIO.nodes.sg.gain.setTargetAtTime(0, t, 0.05);
        RADIO.nodes.wg.gain.setTargetAtTime(0, t, 0.05);
        RADIO.nodes.src.stop(t + 0.4);
        RADIO.nodes.wh.stop(t + 0.4);
    }
    RADIO.nodes = null;
    if (ac) {
        const t = ac.currentTime;
        radioLP.frequency.setTargetAtTime(20000, t, 0.2);
        radioHP.frequency.setTargetAtTime(10, t, 0.2);
        radioGain.gain.setTargetAtTime(1, t, 0.2);
    }
    $('#radio').hidden = true;
    $('#b-radio').setAttribute('aria-pressed', 'false');
    // the story keeps its own music
    if (guest) return;
    if (ac) pad.out.gain.setTargetAtTime(0.045, ac.currentTime, 1);
    S.style = 'techno';
    S.visMul = 1;
    S.drums = S.hatsOn = S.bassOn = true;
    $('#b-drums').setAttribute('aria-pressed', 'true');
}

async function lockStation(s) {
    RADIO.locked = s;
    // the story only wants to know where you are; its music plays on through the static
    if (RADIO.guest) {
        if (s.style === 'numbers') $('#rd-name').textContent = 'Numbers Station · listen…';
        RADIO.guest.onTune(s);
        return;
    }
    saveMemory({ stations: [...new Set([...(MEMORY?.stations || []), s.name])] });
    renderDial();
    S.style = s.style;
    const quiet = ['ambient', 'numbers', 'silence'].includes(s.style);
    const d = {
        ...s.d,
        label: `📻 ${s.name} · ${fmtF(s.f)} MHz`,
        drums: !quiet,
        hats: !quiet,
        bass: s.style !== 'numbers' && s.style !== 'silence',
        voice: s.say ? 'robot' : 'none'
    };
    await applyDirection(d, s.name, s.say || s.name);
    const padLevel = { ambient: 0.09, numbers: 0.05, silence: 0.03, dub: 0.05, break: 0.04 }[s.style] ?? 0.045;
    if (ac) pad.out.gain.setTargetAtTime(padLevel, ac.currentTime, 1);
    if (s.her) herTransmission();
}

// runs every frame: distance from the nearest station sets clarity, static and whistle
function radioTick() {
    if (!RADIO.on || !ac || !RADIO.nodes) return;
    let near = null, dist = Infinity;
    for (const s of stationList()) {
        const d = Math.abs(s.f - RADIO.f);
        if (d < dist) { dist = d; near = s; }
    }
    const raw = Math.max(0, 1 - dist / BAND);
    RADIO.strength += (raw - RADIO.strength) * 0.15;
    const s = RADIO.strength, t = ac.currentTime;
    radioLP.frequency.setTargetAtTime(700 + s * s * 19000, t, 0.05);
    radioHP.frequency.setTargetAtTime(10 + (1 - s) * 500, t, 0.05);
    radioGain.gain.setTargetAtTime(0.08 + 0.92 * s, t, 0.05);
    RADIO.nodes.sg.gain.setTargetAtTime((0.015 + 0.13 * (1 - s)) * (0.6 + Math.random() * 0.8), t, 0.02);
    RADIO.nodes.wh.frequency.setTargetAtTime(300 + dist * 2600, t, 0.05);
    RADIO.nodes.wg.gain.setTargetAtTime(dist < 0.6 ? 0.025 * (1 - s) : 0.004, t, 0.08);
    S.visMul = 0.35 + s * 0.65;
    S.glitch = Math.max(S.glitch, (1 - s) * 0.3);
    if (raw > 0.55 && RADIO.locked !== near) lockStation(near);
    if (raw < 0.2) RADIO.locked = null;
    if (!(RADIO.guest && RADIO.locked?.style === 'numbers')) $('#rd-name').textContent = s > 0.45 && near ? near.name : s > 0.12 ? 'weak signal…' : 'static';
    $('#rd-signal').style.width = Math.round(s * 100) + '%';
}

function setFreq(f) {
    RADIO.f = Math.min(DIAL_MAX, Math.max(DIAL_MIN, f));
    renderNeedle();
}

function renderNeedle() {
    const k = (RADIO.f - DIAL_MIN) / (DIAL_MAX - DIAL_MIN);
    $('#rd-needle').style.left = (k * 100) + '%';
    $('#rd-dial').setAttribute('aria-valuenow', RADIO.f.toFixed(2));
    $('#rd-dial').setAttribute('aria-valuetext', `${fmtF(RADIO.f)} megahertz`);
    $('#rd-freq').textContent = fmtF(RADIO.f) + ' MHz';
}

// the scale, plus a mark for every station already found
function renderDial() {
    const sc = $('#rd-scale');
    sc.innerHTML = '';
    const pos = f => ((f - DIAL_MIN) / (DIAL_MAX - DIAL_MIN) * 100) + '%';
    for (let f = 3; f <= 12; f++) {
        const n = document.createElement('span');
        n.className = 'rd-num';
        n.style.left = pos(f);
        n.textContent = f;
        sc.appendChild(n);
    }
    const found = new Set(MEMORY?.stations || []);
    for (const st of stationList()) {
        if (!found.has(st.name)) continue;
        const m = document.createElement('i');
        m.className = 'rd-mark' + (st.her ? ' her' : '');
        m.style.left = pos(st.f);
        m.title = `${st.name} · ${fmtF(st.f)} MHz`;
        sc.appendChild(m);
    }
    renderNeedle();
}

const dial = $('#rd-dial');
let dialDrag = false;
const dialAt = e => {
    const r = dial.getBoundingClientRect();
    return DIAL_MIN + (DIAL_MAX - DIAL_MIN) * Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
};
dial.addEventListener('pointerdown', e => {
    dialDrag = true;
    try { dial.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
    setFreq(dialAt(e));
});
dial.addEventListener('pointermove', e => { if (dialDrag) setFreq(dialAt(e)); });
dial.addEventListener('pointerup', () => { dialDrag = false; });
dial.addEventListener('pointercancel', () => { dialDrag = false; });
dial.addEventListener('wheel', e => { e.preventDefault(); setFreq(RADIO.f - Math.sign(e.deltaY) * 0.02); }, { passive: false });
dial.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setFreq(RADIO.f + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 0.25 : 0.02));
});

$('#b-radio').onclick = () => {
    setDrawer(false);
    if (RADIO.on) stopRadio(); else startRadio();
};

// a numbers station reads letters as their place in the alphabet: listen closely and you can decode a name
const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
function numbersCall(t) {
    if (RADIO.guest) {
        // for the story it reads where her fragment broadcasts
        const said = RADIO.guest.digits;
        bell(S.pattern.root + 60, t);
        bell(S.pattern.root + 55, t + 0.25);
        robotSpeak(t + 0.8, said);
        $('#rd-name').textContent = `Numbers Station · “${said}”`;
        return;
    }
    const word = (MEMORY?.name || 'sinestesia').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '') || 'sinestesia';
    const group = [];
    for (let j = 0; j < 3; j++) group.push(String(word.charCodeAt((RADIO.numIdx * 3 + j) % word.length) - 96).padStart(2, '0'));
    RADIO.numIdx++;
    bell(S.pattern.root + 60, t);
    bell(S.pattern.root + 55, t + 0.25);
    robotSpeak(t + 0.8, group.map(g => g.split('').map(d => DIGITS[d]).join(' ')).join(', '));
}

// her voice through the static, once per visit
function herTransmission() {
    if (RADIO.heard || !herOnAir()) return;
    RADIO.heard = true;
    const m = MEMORY;
    const line = termLine('lei', '', `${m.name.toUpperCase()} ›`);
    const text = m.ending === 'resta'
        ? `You found me. I stayed here, at ${m.bpm || 120} beats per minute, waiting for you to come back and play.`
        : `I receive you from beyond the horizon. Time has no beat here, but I still keep yours: ${m.bpm || 120}.`;
    typewrite(line, text);
    if (ac) robotSpeak(ac.currentTime + 0.1, text);
    setTimeout(updateTerm, 25000);
}

// a returning visitor is greeted at the start screen and, in free play, by her
function greetReturning() {
    if (!MEMORY?.name) return;
    setTimeout(() => {
        if (S.story || !ac) return;
        const m = MEMORY, days = daysSince(m.date);
        const back = `You came back${days ? ` after ${daysText(days)}` : ''}.`;
        const text = m.ending === 'diventa'
            ? `${back} You won't find me on the radio. Listen to your own notes.`
            : m.ending === 'resta'
                ? `${back} I'm still here, playing. Leave me a bar of silence and I'll answer. Or look for me on the radio, ${onFreq(m.freq || herFreq(m.name))} MHz.`
                : `${back} I receive you from beyond the horizon. Time has no beat here, but I still keep yours: ${m.bpm || 120}. Look for me on the radio, ${onFreq(m.freq || herFreq(m.name))} MHz.`;
        typewrite(termLine('lei', '', `${m.name.toUpperCase()} ›`), text);
        robotSpeak(ac.currentTime + 0.1, text);
        setTimeout(updateTerm, 22000);
    }, 9000);
}

if (MEMORY?.name) {
    const days = daysSince(MEMORY.date);
    const el = $('#start-memory');
    const where = herOnAir() ? `Her voice is still on the radio, ${onFreq(MEMORY.freq || herFreq(MEMORY.name))} MHz.` : 'She is in every note you play.';
    el.textContent = `Welcome back. ${MEMORY.name} remembers you${days ? `: it has been ${daysText(days)}` : ''}. ${where}`;
    el.hidden = false;
}

// the numbers station reads its groups every other bar; on Silence someone whispers now and then
on('bar', t => {
    if (!RADIO.on) return;
    const style = RADIO.locked?.style;
    if (style === 'numbers' && S.bar % 2 === 0) numbersCall(t);
    if (style === 'silence' && S.bar % 4 === 0) whisper(t + Math.random());
});
on('frame', radioTick);
on('status', () => (RADIO.on ? `📻 ${fmtF(RADIO.f)} MHz` : null));
// when the story ends she keeps the frequency you found her on (or gets one from her name), and her voice
// can be heard again; after the "become the music" ending she is not on the air at all
on('storyEnded', ({ name, freq }) => {
    RADIO.heard = false;
    if (!herOnAir()) { renderDial(); return; }
    const f = freq || herFreq(name);
    saveMemory({ freq: f });
    renderDial();
    setTimeout(() => toast(`From now on her voice is on the pirate radio, ${onFreq(f)} MHz.`, 8000), 1500);
});

// the story can borrow the dial: it opens without stopping the story, the stations leave the story's music
// alone, the numbers station reads where her fragment broadcasts, and every station you lock is reported
const DIGIT_WORDS = f => f.toFixed(1).split('.').map(d => DIGITS[d]).join(', ');
actions.radioGuest = (seed, onTune) => {
    if (RADIO.on && RADIO.guest) { RADIO.guest.onTune = onTune; $('#rd-dial').focus(); return RADIO.guest.station.f; }
    stopRadio();
    const f = fragmentFreq(seed);
    RADIO.guest = { onTune, digits: DIGIT_WORDS(f), station: { f, name: 'a voice', style: 'ambient', fragment: true, say: '' } };
    startRadio();
    return f;
};
actions.radioClose = () => { if (RADIO.guest) stopRadio(); };
on('memory', renderDial);
// a returning visitor is greeted once the music runs
on('started', greetReturning);
mode('radio', stopRadio);
feature('radio');
