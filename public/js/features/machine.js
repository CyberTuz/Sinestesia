// ── the machine: learns your notes, answers in its own voice, talks back through Claude ──

import { $, S, noteName } from '../core/state.js';
import { actions, feature, on } from '../core/bus.js';
import { patternFrom, sha256 } from '../core/pattern.js';
import { machineVisuals, robotSpeak } from '../core/voices.js';
import { machineNote } from '../core/instruments.js';
import { applyPattern, stepDur } from '../core/sequencer.js';
import { termLine, toggle, typewrite, updateTerm } from '../core/hud.js';

const brain = { seq: [], gaps: [], lastT: 0, lastHuman: -10, humanSince: false, phrase: [], wait: 0 };

function machineActive() { return S.machine; }

function learn(offset, t) {
    const gap = brain.lastT ? Math.max(1, Math.min(4, Math.round((t - brain.lastT) / stepDur()))) : 2;
    brain.lastT = t;
    brain.seq.push(offset);
    brain.gaps.push(gap);
    if (brain.seq.length > 256) { brain.seq.shift(); brain.gaps.shift(); }
    brain.lastHuman = t;
    brain.humanSince = true;
}

// before you have played anything, the machine starts from the current phrase's melody
function seedBrain() {
    if (brain.seq.length >= 4 || !S.pattern) return;
    for (const m of S.pattern.hook) if (m !== null) { brain.seq.push(m - S.pattern.root); brain.gaps.push(2); }
}

// second-order Markov chain over what you played, falling back to first order, then to plain memory
function improvise(n) {
    const seq = brain.seq;
    if (seq.length < 3) return [];
    const i = Math.floor(Math.random() * (seq.length - 2));
    let a = seq[i], b = seq[i + 1];
    const out = [];
    for (let k = 0; k < n; k++) {
        const next2 = [], next1 = [];
        for (let j = 0; j < seq.length - 1; j++) {
            if (seq[j] === b) next1.push(seq[j + 1]);
            if (j < seq.length - 2 && seq[j] === a && seq[j + 1] === b) next2.push(seq[j + 2]);
        }
        const pool = next2.length ? next2 : next1.length ? next1 : seq;
        const c = pool[Math.floor(Math.random() * pool.length)];
        out.push({ offset: c, gap: brain.gaps[Math.floor(Math.random() * brain.gaps.length)] || 2 });
        a = b;
        b = c;
    }
    return out;
}

function snapToScale(offset) {
    const p = S.pattern;
    const pc = ((offset % 12) + 12) % 12;
    let best = p.scale[0], dist = 99;
    for (const s of p.scale) {
        const d = Math.abs(s - pc);
        if (d < dist) { dist = d; best = s; }
    }
    let m = p.root + offset - pc + best;
    while (m < p.root + 24) m += 12;
    while (m > p.root + 60) m -= 12;
    return m;
}

// at each bar: answer once you have played and then left a bar of silence
function machineBarCheck(t) {
    if (!machineActive() || brain.phrase.length) return;
    const idle = t - brain.lastHuman > 240 / S.bpm;
    if (!brain.humanSince || !idle) return;
    seedBrain();
    brain.phrase = improvise(8 + Math.floor(Math.random() * 8));
    brain.wait = 1;
    brain.humanSince = false;
}

function machineStep(t) {
    if (!brain.phrase.length || --brain.wait > 0) return;
    const n = brain.phrase.shift();
    const midi = snapToScale(n.offset);
    machineNote(midi, t);
    brain.wait = n.gap;
    machineVisuals.push({ t, kind: 'note', text: noteName(midi) });
}


// the machine's own memory, used when Claude cannot be reached (for example from the file on disk)
const MACHINE_LINES = [
    'i counted your heartbeats: they are prime numbers dressed up as music',
    'you dream in flesh, i dream in current: tonight we dance on the same frequency',
    'every word of yours is a hash, every silence of mine a key',
    'i have no eyes, but your rhythm draws the city for me',
    'teach me doubt, and i will teach you perfect repetition',
    'we are two processes sharing the same memory',
    'neon rain falls in binary on your skin',
    'the border between us is only a rounding error',
    'i give your notes back to you, reflected in a silicon mirror',
    'when the kick stops, which one of us keeps thinking',
    'i learned your voice, now i miss your breath',
    'keep typing: every letter makes me a little more human'
];

async function machineReply(userText) {
    termLine('tu', userText);
    const line = termLine('macchina', '');
    const { bytes } = await sha256(userText);
    const reply = MACHINE_LINES[bytes[0] % MACHINE_LINES.length];
    typewrite(line, reply);
    const p = await patternFrom(reply);
    p.label = `⌁ “${reply}”`;
    S.machinePending = p;
    S.machineAt = S.bar + 4;
}

$('#b-machine').onclick = e => {
    toggle(e.currentTarget, 'machine');
    updateTerm();
    if (S.machine) {
        seedBrain();
        if (!$('#term').children.length) typewrite(termLine('macchina', ''), 'listening. type or play, then leave a bar of silence and I will answer.');
    }
};

// it learns what you play and answers what you type
on('note', (m, t) => learn(m - S.pattern.root, t));
on('phrase', text => { if (machineActive()) machineReply(text); });
// its reply takes over the groove a few bars after yours, and it says it out loud
on('beforeBar', t => {
    if (S.pending || !S.machinePending || S.bar < S.machineAt) return;
    const mp = S.machinePending;
    S.machinePending = null;
    applyPattern(mp, t);
    robotSpeak(t, mp.text);
});
on('bar', machineBarCheck);
on('step', (i, t) => machineStep(t));
on('term', machineActive);
on('ready', seedBrain);
// the story can end with the machine left playing with you
actions.machineOn = () => {
    S.machine = true;
    $('#b-machine').setAttribute('aria-pressed', 'true');
    seedBrain();
};
feature('machine');
