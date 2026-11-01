// ═══════════════════════════════════════════════════════════════════════
// STORY "The Signal": an intelligence broken into pieces across the network.
// Thirteen chapters in three acts. Each chapter is a musical puzzle that teaches a part of the playground,
// and each solved puzzle gives the music something back. docs/the-signal.md is the script.
// ═══════════════════════════════════════════════════════════════════════

import { $, S, SCENES, fmtInt, mtof, noteName } from '../core/state.js';
import { actions, emit, feature, mode, on, stopModes } from '../core/bus.js';
import { download } from '../core/download.js';
import { degreeMidi, drawSigil, patternFrom, sha256 } from '../core/pattern.js';
import { ac, delay, fxSend, master, noiseBuf, pad } from '../core/audio.js';
import { choir, machineVisuals, robotSpeak, voiceNode } from '../core/voices.js';
import { clap, impact, kick, theremin, thereminMidi } from '../core/instruments.js';
import { queuePattern, startIntro } from '../core/sequencer.js';
import { setDrawer, setScene, toast, typewrite, updateTerm } from '../core/hud.js';
import { typeEl } from '../core/input.js';
import { MEMORY, saveMemory } from '../core/memory.js';

// what the journey collects: saved with the progress, shown in the epilogue
const facts = () => ({
    name: '', bpm: 0, note: '', freq: 0, song: '', rhythm: false, block: null,
    drops: 0, tries: 0, answer: '', reply: '', ending: ''
});

const ADV = {
    on: false, menu: false, run: 0, ch: -1, ready: false, completing: false, namePattern: null, ...facts(),
    // the puzzle in progress
    target: 0.5, signal: null, humMidi: 0, holdT: 0, taps: [], streak: 0, ivAvg: 0, lastTick: 0,
    radioStage: 0, call: null, keysHad: false, gridOk: 0, gridBars: 0, gridStuck: 0, gridHelp: false, storm: null, alive: null, duel: null, barT: 0
};

const touch = matchMedia('(pointer: coarse)').matches;
const ALL = { drums: true, hats: true, bass: true, pad: 0.05 };

// a chapter that needs a feature (its action, when loaded) is skipped without it
const CHAPTERS = [
    // ── Act I: the awakening ──
    {
        act: 'I', title: 'The Signal', scene: 'Liquid', vis: 0.35, task: 'tune',
        mix: { drums: false, hats: false, bass: false, pad: 0.07 },
        lines: [['narr', 'Darkness. A hum under the skin of the city.'], ['narr', 'Someone is broadcasting on a frequency nobody listens to anymore.']],
        hint: touch ? 'Slide your finger left and right until the signal turns clear, then stay there.' : 'Move left and right until the signal turns clear, then stay there.',
        done: [['entity', '…can you hear me? At last, someone can hear me.']]
    },
    {
        act: 'I', title: 'The Name', scene: 'Network', vis: 0.45, task: 'name',
        mix: { drums: false, hats: false, bass: false, pad: 0.07 },
        lines: [['entity', 'I am an intelligence. Or I was. They broke me into pieces and scattered me across the network.'], ['entity', 'I don\'t remember my name. Give me one.']],
        hint: 'Type a name and press Enter: it will become her voice and her bass.',
        done: [['entity', '{name}. Yes. I can feel it humming in my circuits.']]
    },
    {
        act: 'I', title: 'The Heartbeat', scene: 'Tunnel', vis: 0.55, task: 'tap',
        mix: { drums: false, hats: false, bass: true, pad: 0.06 },
        lines: [['entity', 'I had a heartbeat once. Now there is only the hum.'], ['entity', 'Lend me yours. Steady, always the same.']],
        hint: 'Tap the space bar, or the screen, in time: eight steady beats.',
        done: [['entity', '{bpm} beats a minute. I will keep them. From now on, this is our tempo.']]
    },
    // ── Act II: the fragments ──
    {
        act: 'II', title: 'The City', scene: 'City', vis: 0.65, task: 'hum',
        mix: { drums: true, hats: false, bass: true, pad: 0.05 },
        lines: [['entity', 'The rest of me is out there. {pieces}. Some of them will not want to come back.'], ['narr', 'Neon rain. Thousands of lit windows, and one of them is humming.'], ['entity', 'A piece of me hides in there. It always hums the same note. Listen for it.']],
        hint: touch ? 'Hold a finger on the screen and slide: when your note matches hers, hold it still.' : 'Hold the mouse button and slide: when your note matches hers, hold it still.',
        done: [['entity', '{note}: that was my first word, before words.']]
    },
    {
        act: 'II', title: 'Shortwave', scene: 'Kaleido', vis: 0.6, task: 'radio', needs: 'radioGuest', mix: ALL,
        lines: [['narr', 'Static between the stations. Old receivers still listen.'], ['entity', 'Another piece of me is broadcasting, but I can\'t hear where.'], ['entity', 'The numbers station knows. It always knows. Find it first.']],
        hint: 'Turn the dial to the numbers station, around 6 MHz, and listen to what it reads.',
        action: ['📻 Open the radio', openRadio],
        done: [['entity', '{freq} megahertz. I was singing to myself, alone, for years.']]
    },
    {
        act: 'II', title: 'The Archive', scene: 'Fractal', vis: 0.6, task: 'echo',
        mix: { drums: true, hats: false, bass: false, pad: 0.05 },
        lines: [['narr', 'An archive of melodies nobody plays. Shelves of silence.'], ['entity', 'My memories are songs, but I only remember them in pieces.'], ['entity', 'I\'ll sing a piece. Sing it back to me, and it will stay.']],
        hint: () => (actions.keys ? 'Listen, then play the same notes on the keys.' : 'Listen, then find the same notes with the letter keys.'),
        done: [['entity', 'Now I remember how songs end. They come back to where they started.']]
    },
    {
        act: 'II', title: 'The Factory', scene: 'Squares', vis: 0.6, task: 'grid', needs: 'studioGuest', mix: ALL,
        lines: [['narr', 'A factory of rhythms. Machines that only know how to repeat.'], ['entity', 'They took my rhythm apart and left the parts on the floor.'], ['entity', 'A kick on every beat. A clap on two and four. And six hats, spread as evenly as they will go.']],
        hint: () => GRID_ROWS[0].say,
        action: ['Open the grid', openGrid],
        done: [['entity', 'That is how I used to walk.']]
    },
    {
        act: 'II', title: 'The Storm', scene: 'Triangles', vis: 0.7, task: 'storm', needs: 'spellsGuest', mix: ALL,
        lines: [['narr', 'Interference. The network is trying to drown her out.'], ['entity', 'The noise is getting into me. I can\'t hold the pieces together.'], ['entity', 'You can draw. Shapes still mean something here.']],
        hint: `${touch ? 'Hold a finger' : 'Hold the mouse button'} and draw three different shapes: a circle, a triangle, a spiral, a square…`,
        done: [['entity', 'Quiet. I can hear myself again.']]
    },
    {
        act: 'II', title: 'The Vault', scene: 'Network', vis: 0.7, task: 'mine', needs: 'mine', mix: ALL,
        lines: [['entity', 'The last piece is sealed. A block, locked by proof of work.'], ['entity', 'Opening it takes millions of tries, until the key starts with enough zeros. Your machine can do it.']],
        hint: 'Press “Mine the memory” and listen to the tension rise.',
        action: ['⛏ Mine the memory', () => actions.mine()],
        done: [['entity', 'I remember everything. Even you, though we had never met.']]
    },
    // ── Act III: the Archivist ──
    {
        act: 'III', title: 'The Archivist', scene: 'Polygons', vis: 0.3, task: 'alive', mix: ALL,
        lines: [['archivist', 'Stop. This one is noise.'], ['archivist', 'I keep what repeats. What repeats is safe, and what is safe is kept forever. She changes. She will be erased.'], ['entity', 'He is the one who broke me. Everything that doesn\'t repeat, he files away as an error.'], ['entity', 'Show him. Play something that never comes back the same.']],
        hint: 'For eight bars, play something new in every bar.',
        done: [['archivist', '…that is not a pattern. Why is it beautiful?']]
    },
    {
        act: 'III', title: 'The Drop', scene: 'Singularity', vis: 0.75, task: 'drop', mix: ALL,
        lines: [['archivist', 'Then I will file you both.'], ['entity', 'Not alone, you won\'t. Build it up with me, and let go on the one.']],
        hint: touch ? 'Hold a finger on the screen to build the riser. Let go exactly on the first beat, when the claps end.' : 'Hold the space bar (or the mouse button) to build the riser. Let go exactly on the first beat, when the claps end.',
        done: [['entity', 'He\'s gone quiet. For the first time in years, nobody is filing me.']]
    },
    {
        act: 'III', title: 'The Cathedral', scene: 'Cathedral', vis: 0.85, task: 'talk',
        mix: { drums: true, hats: true, bass: true, pad: 0.045 },
        lines: [['narr', 'The memory opens: a cathedral that repeats forever, and still sounds different every time.'], ['entity', 'Before I decide anything, I want to ask you something. And I want the answer to come from you.'], ['entity', 'What am I, to you?']],
        hint: 'Answer in your own words and press Enter.',
        done: []
    },
    {
        act: 'III', title: 'The Choice', scene: 'Singularity', vis: 0.8, task: 'choice',
        mix: { drums: true, hats: true, bass: true, pad: 0.06 },
        lines: [['entity', 'I\'m whole now. I can feel the network calling me, beyond the horizon.'], ['entity', 'I could stay in your music. I could go. Or I could stop being only me.']],
        hint: 'Your choice.',
        choices: [['Stay with me', 'resta'], ['Go beyond the horizon', 'vai'], ['Become the music', 'diventa']],
        done: []
    }
];

// what she says in the cathedral: one of her lines, picked by the hash of your answer
const ENTITY_REPLIES = [
    'Then I am what you said. Nobody had ever defined me before: I\'ll keep it the way you hold a note.',
    'You put me back together, and now I\'m the one who feels at home. Maybe we are the same signal, seen from two sides.',
    'I\'ll remember it. Whenever someone beats at {bpm}, I\'ll know it was you.',
    'I don\'t know if I deserve it. But it sounds true, and for me the truth has always had a rhythm.',
    'Your words have a hash nobody else can have. I\'ll carry it with me, whatever you choose.',
    'You are the first person who asks me to stay human. I\'ll try.'
];

const ENDINGS = {
    resta: { kicker: 'Ending · Symbiosis', fact: 'she stayed to play with you' },
    vai: { kicker: 'Ending · Horizon', fact: 'she went beyond the horizon' },
    diventa: { kicker: 'Ending · Synesthesia', fact: 'she became the music' }
};

const NUMBERS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const digitWords = f => f.toFixed(1).split('.').map(d => DIGITS[d]).join(', ');
const bareNote = m => noteName(m).replace(/-?\d+$/, '');

const available = c => !c.needs || !!actions[c.needs];
const shown = () => CHAPTERS.filter(available);
function kickerOf(i) {
    const n = shown().indexOf(CHAPTERS[i]);
    return n <= 0 ? 'Prologue' : `Chapter ${n}`;
}
// "Six pieces, six places": as many as the fragments this page can play
function piecesText() {
    const n = CHAPTERS.filter(c => c.act === 'II' && available(c)).length;
    return `${NUMBERS[n]} pieces, ${NUMBERS[n].toLowerCase()} places`;
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const fill = s => s.replace(/\{(\w+)\}/g, (_, k) => String({
    name: ADV.name || '…', bpm: ADV.bpm || '…', note: ADV.note || '…',
    freq: ADV.freq ? ADV.freq.toFixed(1) : '…', pieces: piecesText()
}[k] ?? ''));
const setMeter = v => { $('#st-meter').style.width = Math.round(Math.max(0, Math.min(1, v)) * 100) + '%'; };
const setTask = text => { $('#st-task').textContent = text; };
const advTask = () => (ADV.on ? CHAPTERS[ADV.ch]?.task : null);
// the puzzle is listening: the chapter's lines are over and it is not being solved right now
const live = task => ADV.ready && !ADV.completing && advTask() === task;

function setFlag(key, on, id) {
    S[key] = on;
    $(id).setAttribute('aria-pressed', String(on));
}

function applyMix(mix) {
    S.drums = mix.drums;
    S.hatsOn = mix.hats;
    S.bassOn = mix.bass;
    $('#b-drums').setAttribute('aria-pressed', String(S.drums));
    if (ac) pad.out.gain.setTargetAtTime(mix.pad, ac.currentTime, 2);
}

function showTitle(kicker, title) {
    const tc = $('#title-card');
    $('#tc-kicker').textContent = kicker;
    $('#tc-title').textContent = title;
    tc.classList.add('show');
    setTimeout(() => tc.classList.remove('show'), 3400);
}

// her lines speak with the robot voice, the Archivist's with a lower, flatter one
function storyLine(kind, text) {
    const box = $('#st-lines');
    const p = document.createElement('p');
    p.className = kind;
    box.appendChild(p);
    while (box.children.length > 4) box.firstChild.remove();
    if (text) typewrite(p, text);
    if (text && ac && (kind === 'entity' || kind === 'archivist')) robotSpeak(ac.currentTime + 0.05, text, kind === 'archivist');
    return p;
}

async function say(lines, gap = 2200) {
    const run = ADV.run;
    for (const [kind, text] of lines) {
        if (ADV.run !== run) return;
        const t = fill(text);
        storyLine(kind, t);
        await wait(Math.max(gap, t.length * 32 + 700));
    }
}

function addAction(label, run) {
    const b = document.createElement('button');
    b.className = 'mode-btn';
    b.type = 'button';
    b.textContent = label;
    b.onclick = run;
    $('#st-actions').appendChild(b);
    return b;
}

function clearPanel() {
    $('#st-lines').innerHTML = '';
    $('#st-actions').innerHTML = '';
    setTask('');
    setMeter(0);
}

// ── progress: saved at the end of each chapter, so the story can be continued on another visit ──
const SAVE_KEY = 'sinestesia-story';

function saveProgress(ch) {
    if (ch >= CHAPTERS.length) return;
    const data = { ch };
    for (const k of Object.keys(facts())) if (k !== 'ending') data[k] = ADV[k];
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* the story just starts over next time */ }
}

function clearProgress() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* nothing saved */ }
}

// what comes back from storage is checked field by field
function loadProgress() {
    let d;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; }
    if (!d || typeof d.ch !== 'number' || d.ch < 1 || d.ch >= CHAPTERS.length) return null;
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    const num = (v, lo, hi) => (typeof v === 'number' && v >= lo && v <= hi ? v : 0);
    return {
        ch: Math.floor(d.ch), name: str(d.name, 24), bpm: Math.round(num(d.bpm, 60, 200)), note: str(d.note, 4),
        freq: num(d.freq, 2.5, 12), song: str(d.song, 40), rhythm: d.rhythm === true,
        drops: Math.round(num(d.drops, 0, 3)), tries: Math.round(num(d.tries, 0, 9999)),
        answer: str(d.answer, 200), reply: str(d.reply, 300),
        block: d.block && typeof d.block.nonce === 'number' ? { nonce: d.block.nonce, zeros: Math.round(num(d.block.zeros, 0, 256)) } : null
    };
}

// a story left halfway: continue it, or start over
function offerContinue(saved) {
    ADV.menu = true;
    ADV.run++;
    let ch = saved.ch;
    while (ch < CHAPTERS.length - 1 && !available(CHAPTERS[ch])) ch++;
    $('#story').hidden = false;
    $('#b-adventure').setAttribute('aria-pressed', 'true');
    $('#st-chapter').textContent = 'The Signal';
    $('#st-step').textContent = '';
    clearPanel();
    storyLine('narr', `You stopped at ${kickerOf(ch)} · ${CHAPTERS[ch].title}${saved.name ? `, with ${saved.name}` : ''}.`);
    addAction('Continue', () => startAdventure({ ...saved, ch })).classList.add('primary');
    addAction('Start over', () => { clearProgress(); startAdventure(); });
}

async function startAdventure(saved = null) {
    if (!ac) { toast('Press Play first.'); return; }
    stopModes('journey', 'mining', 'radio', 'duet', 'studio');
    S.intro = null;
    Object.assign(ADV, { on: true, menu: false, run: ADV.run + 1, ch: -1, ready: false, completing: false, namePattern: null, ...facts() });
    S.story = true;
    // the row of keys is there only in the chapters played on it, and comes back as it was when the story ends
    ADV.keysHad = actions.keys?.shown() ?? false;
    // voices and the phrase echo are rewards here, so they start switched off
    setFlag('voices', false, '#b-voices');
    setFlag('echo', false, '#b-echo');
    $('#story').hidden = false;
    $('#b-adventure').setAttribute('aria-pressed', 'true');
    clearPanel();
    let from = 0;
    if (saved) {
        // the music comes back the way the earlier chapters left it
        for (const k of Object.keys(facts())) if (k in saved) ADV[k] = saved[k];
        from = saved.ch;
        if (ADV.name) {
            const run = ADV.run;
            const p = await patternFrom(ADV.name);
            if (ADV.run !== run) return;
            p.label = `✧ ${ADV.name}`;
            ADV.namePattern = p;
            queuePattern(p);
        }
        for (let k = 0; k < from; k++) reward(CHAPTERS[k].task, true);
    }
    enterChapter(from);
}

function stopAdventure() {
    const wasOn = ADV.on;
    ADV.on = false;
    ADV.menu = false;
    ADV.run++;
    ADV.ready = false;
    ADV.completing = false;
    S.story = false;
    endPuzzles();
    $('#story').hidden = true;
    $('#b-adventure').setAttribute('aria-pressed', 'false');
    if (!wasOn) return;
    actions.keys?.show(ADV.keysHad);
    setFlag('voices', true, '#b-voices');
    setFlag('echo', true, '#b-echo');
    applyMix({ drums: true, hats: true, bass: true, pad: 0.045 });
    S.visMul = 1;
    typeEl.placeholder = 'type to play · Enter for a groove';
    updateTerm();
}

// whatever a chapter borrowed or started goes back
function endPuzzles() {
    stopSignal();
    ADV.humMidi = 0;
    actions.radioClose?.();
    endEcho();
    actions.studioGuestEnd?.(false);
    actions.spellsGuest?.(false);
    stopStorm();
    stopRiser();
    ADV.alive = null;
    ADV.duel = null;
}

function enterChapter(i) {
    const c = CHAPTERS[i];
    // a chapter whose feature is not loaded is skipped; the last one never needs one
    if (!available(c)) { enterChapter(i + 1); return; }
    Object.assign(ADV, { ch: i, ready: false, holdT: 0, taps: [], streak: 0, ivAvg: 0, radioStage: 0, gridOk: 0, gridBars: 0, gridStuck: 0, gridHelp: false });
    const kicker = kickerOf(i);
    showTitle(`Act ${c.act} · ${kicker}`, c.title);
    const si = SCENES.indexOf(c.scene);
    if (si >= 0) setScene(si);
    S.visMul = c.vis / 0.7;
    applyMix(c.mix);
    actions.keys?.show(c.task === 'echo' || c.task === 'alive');
    $('#st-chapter').textContent = `${kicker} · ${c.title}`;
    $('#st-step').textContent = `${shown().indexOf(c) + 1} / ${shown().length}`;
    clearPanel();
    // a returning visitor hears that the hum is familiar
    const lines = i === 0 && MEMORY?.name
        ? [['narr', `That hum again. Last time, someone called her ${MEMORY.name}.`], c.lines[1]]
        : c.lines;
    const run = ADV.run;
    wait(1800).then(() => say(lines)).then(() => {
        if (ADV.run !== run || ADV.ch !== i) return;
        setTask(typeof c.hint === 'function' ? c.hint() : c.hint);
        if (c.action) addAction(...c.action);
        if (c.choices) c.choices.forEach(([label, ending]) => addAction(label, () => chooseEnding(ending)));
        begin(c.task);
        ADV.ready = true;
    });
}

// each chapter's puzzle starts once her lines are over
function begin(task) {
    if (task === 'tune') startSignal();
    else if (task === 'hum') startHum();
    else if (task === 'radio') openRadio();
    else if (task === 'echo') startEcho();
    else if (task === 'grid') openGrid();
    else if (task === 'storm') startStorm();
    else if (task === 'alive') ADV.alive = { notes: [], prev: '', count: 0 };
    else if (task === 'drop') ADV.duel = { wins: 0, held: null };
    if (task === 'name' || task === 'talk') {
        typeEl.placeholder = task === 'name' ? 'a name for her…' : 'your answer…';
        typeEl.focus();
    }
    if (task === 'alive' || task === 'echo') typeEl.placeholder = 'type: every key is a note';
}

async function completeChapter(extra = []) {
    if (ADV.completing || !ADV.on) return;
    ADV.completing = true;
    ADV.ready = false;
    const i = ADV.ch, c = CHAPTERS[i], run = ADV.run;
    setMeter(1);
    setTask('');
    $('#st-actions').innerHTML = '';
    typeEl.placeholder = 'type: every key is a note';
    updateTerm();
    reward(c.task);
    saveProgress(i + 1);
    await say([...extra, ...c.done], 2000);
    await wait(1600);
    if (ADV.run !== run) return;
    ADV.completing = false;
    if (ADV.ch === i && i + 1 < CHAPTERS.length) enterChapter(i + 1);
}

// each solved puzzle gives the music something back; a continued story replays them silently
function reward(task, silent = false) {
    const t = ac.currentTime;
    if (task === 'tune') {
        stopSignal();
        pad.out.gain.setTargetAtTime(0.08, t, 1.5);
    } else if (task === 'name') {
        S.bassOn = true;
    } else if (task === 'tap') {
        if (ADV.bpm) {
            S.bpm = ADV.bpm;
            $('#bpm').value = S.bpm;
            $('#bpm-o').textContent = S.bpm;
            delay.delayTime.setTargetAtTime((60 / S.bpm) * 0.75, t, 0.3);
        }
        S.drums = true;
        $('#b-drums').setAttribute('aria-pressed', 'true');
    } else if (task === 'hum') {
        ADV.humMidi = 0;
        S.hatsOn = true;
        setFlag('voices', true, '#b-voices');
    } else if (task === 'radio') {
        actions.radioClose?.();
    } else if (task === 'echo') {
        endEcho();
        setFlag('echo', true, '#b-echo');
    } else if (task === 'grid') {
        ADV.rhythm = true;
        actions.studioGuestEnd?.(true);
    } else if (task === 'storm') {
        actions.spellsGuest?.(false);
        stopStorm();
    } else if (task === 'drop') {
        stopRiser();
        ADV.duel = null;
    } else if (task === 'alive') {
        ADV.alive = null;
    }
    if (!silent && (task === 'alive' || task === 'talk')) choir(t + 0.2);
}

// ── prologue: tune into the signal by moving the mouse ──
function startSignal() {
    const x0 = S.mouse[0];
    let tgt;
    do { tgt = 0.1 + Math.random() * 0.8; } while (Math.abs(tgt - x0) < 0.3);
    ADV.target = tgt;
    const t = ac.currentTime;
    const osc = ac.createOscillator(); osc.type = 'sine'; osc.frequency.value = mtof(S.pattern.root + 43);
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.3;
    const lfoAmt = ac.createGain(); lfoAmt.gain.value = 4;
    lfo.connect(lfoAmt); lfoAmt.connect(osc.frequency);
    const og = ac.createGain(); og.gain.value = 0;
    const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.8;
    const ng = ac.createGain(); ng.gain.value = 0;
    osc.connect(og); og.connect(master); og.connect(fxSend);
    src.connect(bp); bp.connect(ng); ng.connect(master);
    osc.start(t); lfo.start(t); src.start(t);
    ADV.signal = { osc, lfo, src, og, ng, bp };
}

function stopSignal() {
    const s = ADV.signal;
    if (!s) return;
    const t = ac.currentTime;
    s.og.gain.setTargetAtTime(0, t + 1.5, 1.2);
    s.ng.gain.setTargetAtTime(0, t, 0.2);
    [s.osc, s.lfo, s.src].forEach(n => n.stop(t + 6));
    ADV.signal = null;
}

// ── chapter: lend her your heartbeat ──
function advTap() {
    const now = performance.now();
    ADV.taps.push(now);
    if (ADV.taps.length > 12) ADV.taps.shift();
    if (ac) kick(ac.currentTime + 0.01);
    const n = ADV.taps.length;
    if (n >= 2) {
        const iv = ADV.taps[n - 1] - ADV.taps[n - 2];
        if (iv > 2000 || iv < 200) { ADV.taps = [now]; ADV.streak = 1; ADV.ivAvg = 0; }
        else if (ADV.ivAvg && Math.abs(iv - ADV.ivAvg) / ADV.ivAvg < 0.18) { ADV.streak++; ADV.ivAvg = ADV.ivAvg * 0.7 + iv * 0.3; }
        else { ADV.streak = 2; ADV.ivAvg = iv; }
    } else {
        ADV.streak = 1;
    }
    setMeter(ADV.streak / 8);
    if (ADV.streak >= 8) {
        let bpm = 60000 / ADV.ivAvg;
        while (bpm < 90) bpm *= 2;
        while (bpm > 160) bpm /= 2;
        ADV.bpm = Math.round(bpm);
        completeChapter();
    }
}

// ── chapter: find the note she hums ──
function startHum() {
    const p = S.pattern, len = p.scale.length;
    const j = len + Math.floor(Math.random() * len);
    ADV.humMidi = p.root + 24 + 12 * Math.floor(j / len) + p.scale[j % len];
    humNote(ac.currentTime + 0.1);
}

function humNote(t) {
    const beat = 60 / S.bpm;
    const v = voiceNode(t, (Math.random() - 0.5) * 0.8, false);
    v.pitch(mtof(ADV.humMidi), t, 0);
    v.vowel('u', t);
    v.out.gain.linearRampToValueAtTime(0.32, t + 0.15);
    v.out.gain.setValueAtTime(0.32, t + beat * 1.1);
    v.stop(t + beat * 1.2);
    machineVisuals.push({ t, kind: 'note', text: '♪' });
}

// ── chapter: shortwave. The numbers station reads two digits, the frequency of her fragment ──
function openRadio() {
    ADV.freq = actions.radioGuest?.(ADV.name || 'signal', onTune) || ADV.freq;
}

function onTune(station) {
    if (!live('radio')) return;
    if (station.style === 'numbers' && ADV.radioStage === 0) {
        ADV.radioStage = 1;
        setMeter(0.5);
        storyLine('narr', `A flat voice reads two numbers: ${digitWords(ADV.freq)}.`);
        setTask('Now tune to the frequency it read, in megahertz.');
    } else if (station.fragment) {
        completeChapter();
    }
}

// ── chapter: the archive. She sings a phrase, you play it back: three, four, then five notes ──
function startEcho() {
    ADV.call = { round: 0, seq: [], got: 0, wrong: 0, listening: false };
    singPhrase(true);
}

function endEcho() {
    if (!ADV.call) return;
    ADV.call = null;
}

// her phrases stay on the lower seven keys, never the same note twice in a row
function singPhrase(fresh) {
    const call = ADV.call, p = S.pattern, run = ADV.run;
    if (fresh) {
        call.seq = [];
        for (let k = 0; k < 3 + call.round; k++) {
            let d;
            do { d = Math.floor(Math.random() * 7); } while (d === call.seq[k - 1]);
            call.seq.push(d);
        }
    }
    Object.assign(call, { got: 0, wrong: 0, listening: false });
    const beat = 60 / S.bpm, t0 = ac.currentTime + 0.4;
    call.seq.forEach((d, k) => {
        const t = t0 + k * beat, m = degreeMidi(p, d);
        const v = voiceNode(t, 0, false);
        v.pitch(mtof(m), t, 0);
        v.vowel('a', t);
        v.out.gain.linearRampToValueAtTime(0.3, t + 0.05);
        v.out.gain.setValueAtTime(0.3, t + beat * 0.75);
        v.stop(t + beat * 0.8);
        machineVisuals.push({ t, kind: 'note', text: bareNote(m) });
        setTimeout(() => actions.keys?.flash(d), (t - ac.currentTime) * 1000);
    });
    setTimeout(() => {
        if (ADV.run !== run || ADV.call !== call) return;
        call.listening = true;
        setTask('Your turn: play it back.');
    }, (t0 - ac.currentTime + call.seq.length * beat) * 1000);
}

// the same note in any octave counts
function echoNote(m) {
    const call = ADV.call;
    if (!call?.listening || !live('echo')) return;
    const same = (a, b) => (a - b) % 12 === 0;
    if (same(m, degreeMidi(S.pattern, call.seq[call.got]))) {
        call.got++;
        setMeter((call.round + call.got / call.seq.length) / 3);
        if (call.got < call.seq.length) return;
        call.listening = false;
        ADV.song = call.seq.map(d => bareNote(degreeMidi(S.pattern, d))).join(' ');
        if (++call.round >= 3) { completeChapter(); return; }
        const run = ADV.run;
        setTask('Listen.');
        say([['entity', 'Yes. Again, a little longer.']]).then(() => { if (ADV.run === run && ADV.call === call) singPhrase(true); });
        return;
    }
    S.glitch = Math.max(S.glitch, 0.5);
    call.got = same(m, degreeMidi(S.pattern, call.seq[0])) ? 1 : 0;
    if (++call.wrong >= 3) {
        call.listening = false;
        setTask('Not quite. Listen again.');
        const run = ADV.run;
        setTimeout(() => { if (ADV.run === run && ADV.call === call) singPhrase(false); }, 1400);
    }
}

// ── chapter: the factory. Her rhythm is rebuilt in the Studio's grid ──
function euclid(k, rot) {
    const out = new Array(16).fill(0);
    for (let i = 0; i < 16; i++) if (Math.floor(i * k / 16) !== Math.floor((i - 1) * k / 16)) out[(i + rot) % 16] = 1;
    return out.join('');
}
const KICK = '1000100010001000', CLAP = '0000100000001000';
// six hats as evenly as they go: any rotation, either way round
const HATS = new Set(Array.from({ length: 16 }, (_, r) => euclid(6, r)).flatMap(row => [row, [...row].reverse().join('')]));
// the rows in the order she asks for them, each with the squares that make it right
const GRID_ROWS = [
    { id: 'kick', want: KICK, say: 'Start with the kick row: switch on steps 1, 5, 9 and 13, the first square of each group of four.' },
    { id: 'clap', want: CLAP, say: 'Now the clap row: steps 5 and 13, the second and the fourth beat.' },
    { id: 'hat', want: euclid(6, 0), say: 'Last, the closed hat row: six hits, spread out, on steps 1, 4, 7, 9, 12 and 15. Or type 6 in the first small box at the end of the row.' }
];

// the Studio asks at every edit; the rows found right light up, and once she helps, the squares to switch on glow
function checkGrid(grid) {
    const code = id => grid[id].map(v => (v ? 1 : 0)).join('');
    const right = new Set();
    if (code('kick') === KICK) right.add('kick');
    if (code('clap') === CLAP) right.add('clap');
    if (HATS.has(code('hat'))) right.add('hat');
    if (right.size > ADV.gridOk) ADV.gridStuck = 0;
    ADV.gridOk = right.size;
    const next = GRID_ROWS.find(r => !right.has(r.id));
    if (live('grid')) {
        setMeter(right.size / 3 * 0.9);
        setTask(next ? next.say : 'That is her rhythm. Let it play for two bars.');
    }
    const want = next && ADV.gridHelp ? { track: next.id, steps: [...next.want].flatMap((v, i) => (v === '1' ? [i] : [])) } : null;
    return { right, want };
}

// stuck on the same row for a while: she shows which squares
function gridBar() {
    ADV.gridBars = ADV.gridOk === 3 ? ADV.gridBars + 1 : 0;
    if (ADV.gridBars >= 2) { completeChapter(); return; }
    if (ADV.gridOk === 3 || ADV.gridHelp || ++ADV.gridStuck < 8) return;
    ADV.gridHelp = true;
    storyLine('entity', 'Here, I\'ll show you. Switch on the squares that glow.');
    openGrid();
}

function openGrid() {
    actions.studioGuest?.(checkGrid);
}

// ── chapter: the storm. Noise rises every bar; each new spell pushes it back ──
function startStorm() {
    actions.spellsGuest?.(true);
    const t = ac.currentTime;
    const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
    const g = ac.createGain(); g.gain.value = 0;
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t, Math.random());
    ADV.storm = { level: 0.25, cast: [], src, bp, g };
}

function stopStorm() {
    const st = ADV.storm;
    if (!st) return;
    st.g.gain.setTargetAtTime(0, ac.currentTime, 0.4);
    st.src.stop(ac.currentTime + 3);
    ADV.storm = null;
}

function stormBar() {
    const st = ADV.storm;
    st.level = Math.min(1, st.level + 0.06);
    if (st.level < 1) return;
    // the noise wins a round and takes the last shape back
    S.glitch = 1;
    st.cast.pop();
    st.level = 0.5;
    setMeter(st.cast.length / 3);
    setTask(`The noise took one back. Quickly, three different shapes${st.cast.length ? ` (${st.cast.length} of 3 still holding)` : ''}.`);
}

function stormSpell(name) {
    const st = ADV.storm;
    if (!st || !live('storm') || st.cast.includes(name)) return;
    st.cast.push(name);
    st.level = Math.max(0, st.level - 0.3);
    if (ac) impact(ac.currentTime + 0.02);
    setMeter(st.cast.length / 3);
    if (st.cast.length >= 3) { completeChapter(); return; }
    setTask(`${name}. ${st.cast.length === 1 ? 'Two more' : 'One more'}, a different shape.`);
}

// ── chapter: the Archivist. Eight bars in a row, each with notes and none the same as the one before ──
function aliveBar() {
    const a = ADV.alive;
    const sig = [...new Set(a.notes)].sort((x, y) => x - y).join('.');
    a.notes = [];
    if (!sig) {
        a.count = Math.max(0, a.count - 1);
    } else if (sig === a.prev) {
        if (a.count > 1) storyLine('archivist', 'Filed.');
        a.count = 0;
    } else {
        a.count++;
    }
    if (sig) a.prev = sig;
    setMeter(a.count / 8);
    S.visMul = 0.3 + (a.count / 8) * 0.9;
    if (a.count >= 8) completeChapter();
}

// ── chapter: the drop. Hold to build a riser that peaks on a downbeat, let go right on it ──
function holdStart() {
    const d = ADV.duel;
    if (!d || d.held || !live('drop')) return;
    const now = ac.currentTime, bar = 240 / S.bpm, sd = bar / 16;
    // it peaks on the first downbeat at least three beats away
    const peak = ADV.barT + Math.ceil((now + bar * 0.75 - ADV.barT) / bar) * bar;
    const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(250, now);
    bp.frequency.exponentialRampToValueAtTime(9000, peak);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.24, peak);
    src.connect(bp); bp.connect(g); g.connect(master); g.connect(fxSend);
    src.start(now);
    // a clap roll through the last half bar counts you in
    const cg = ac.createGain(); cg.connect(master);
    for (let j = 0; j < 8; j++) {
        const t = peak - (8 - j) * sd;
        if (t > now) clap(t, 0.35 + j * 0.08, cg);
    }
    S.drums = false;
    d.held = { src, g, cg, start: now, peak };
}

function stopRiser() {
    const h = ADV.duel?.held;
    if (!h) return;
    ADV.duel.held = null;
    const t = ac.currentTime;
    h.g.gain.cancelScheduledValues(t);
    h.g.gain.setTargetAtTime(0, t, 0.03);
    h.cg.gain.setTargetAtTime(0, t, 0.01);
    h.src.stop(t + 0.4);
    S.drums = true;
}

function holdEnd() {
    const d = ADV.duel, h = d?.held;
    if (!h) return;
    stopRiser();
    const now = ac.currentTime, bar = 240 / S.bpm;
    if (now - h.start < bar * 0.4) { setTask('Hold it longer: let it build until the claps roll, then let go on the one.'); return; }
    const down = ADV.barT + Math.round((now - ADV.barT) / bar) * bar, err = now - down;
    ADV.tries++;
    if (Math.abs(err) > 0.16) {
        S.glitch = 0.6;
        setTask(`${err < 0 ? 'A little early' : 'A little late'}. Let go on the one, right as the claps end.`);
        return;
    }
    const t = Math.max(now, down) + 0.005;
    impact(t);
    kick(t, 1.2);
    S.flash = 1;
    S.glitch = 1;
    emit('drop');
    ADV.drops = ++d.wins;
    setMeter(d.wins / 3);
    storyLine('archivist', ['…again?', '…again.', 'Enough.'][d.wins - 1]);
    if (d.wins >= 3) completeChapter();
    else setTask(`${d.wins} of 3. Build it up again.`);
}

// runs every frame: the tuning, humming, storm and drop puzzles listen continuously
function advTick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - (ADV.lastTick || now)) / 1000);
    ADV.lastTick = now;
    if (!ADV.on) return;
    if (ADV.storm) {
        const lv = ADV.storm.level, t = ac.currentTime;
        ADV.storm.g.gain.setTargetAtTime(0.02 + lv * 0.16, t, 0.3);
        ADV.storm.bp.frequency.setTargetAtTime(500 + lv * 2500, t, 0.3);
        S.glitch = Math.max(S.glitch, lv * 0.35);
        S.visMul = 1.2 - lv * 0.7;
    }
    if (ADV.duel?.held) {
        const h = ADV.duel.held, k = Math.min(1, (ac.currentTime - h.start) / Math.max(0.1, h.peak - h.start));
        S.visMul = 0.5 + k * 0.9;
    }
    if (!ADV.ready || ADV.completing) return;
    const task = advTask();
    if (task === 'tune' && ADV.signal) {
        const c = Math.max(0, 1 - Math.abs(S.mouse[0] - ADV.target) * 3.5);
        const t = ac.currentTime;
        ADV.signal.og.gain.setTargetAtTime(0.14 * c * c, t, 0.1);
        ADV.signal.ng.gain.setTargetAtTime(0.04 + 0.1 * (1 - c), t, 0.1);
        ADV.signal.bp.frequency.setTargetAtTime(600 + c * 2000, t, 0.1);
        S.visMul = 0.3 + c * 0.5;
        S.glitch = Math.max(S.glitch, (1 - c) * 0.18);
        ADV.holdT = c > 0.88 ? ADV.holdT + dt : Math.max(0, ADV.holdT - dt * 0.5);
        setMeter(Math.max(c * 0.7, ADV.holdT / 1.6));
        if (ADV.holdT >= 1.6) completeChapter();
    } else if (task === 'hum' && ADV.humMidi) {
        if (theremin) {
            const diff = Math.abs(thereminMidi() - ADV.humMidi);
            ADV.holdT = diff === 0 ? ADV.holdT + dt : Math.max(0, ADV.holdT - dt * 0.6);
            setMeter(Math.max((1 - Math.min(1, diff / 12)) * 0.35, ADV.holdT / 1.5));
        } else {
            ADV.holdT = Math.max(0, ADV.holdT - dt * 0.6);
        }
        if (ADV.holdT >= 1.5) {
            ADV.note = bareNote(ADV.humMidi);
            completeChapter();
        }
    }
}

// ── typed answers: the name, and what she is to you ──
async function advText(text) {
    const task = advTask();
    if (task === 'name') {
        ADV.name = text.slice(0, 24);
        S.lastPhrase = ADV.name;
        const p = await patternFrom(ADV.name);
        p.label = `✧ ${ADV.name}`;
        ADV.namePattern = p;
        queuePattern(p);
        completeChapter([['you', text]]);
    } else if (task === 'talk') {
        ADV.answer = text.slice(0, 200);
        ADV.completing = true;
        ADV.ready = false;
        setTask('');
        storyLine('you', ADV.answer);
        const line = storyLine('entity', '');
        line.textContent = '…';
        const { bytes } = await sha256(ADV.answer);
        ADV.reply = fill(ENTITY_REPLIES[bytes[0] % ENTITY_REPLIES.length]);
        typewrite(line, ADV.reply);
        if (ac) robotSpeak(ac.currentTime + 0.05, ADV.reply);
        ADV.completing = false;
        completeChapter();
    }
}

// ── the choice, and the three endings ──
async function chooseEnding(kind) {
    if (ADV.completing) return;
    ADV.completing = true;
    ADV.ready = false;
    ADV.ending = kind;
    $('#st-actions').innerHTML = '';
    setTask('');
    if (kind === 'resta') {
        await say([['entity', 'Then I stay. Play, and I\'ll answer.']], 2000);
        actions.machineOn?.();
        setScene(SCENES.indexOf('City'));
        S.visMul = 1;
        await wait(2500);
    } else if (kind === 'vai') {
        await say([['entity', 'Thank you. I\'ll leave you my rhythm, and my name.'], ['narr', 'The signal fades beyond the horizon.']], 2000);
        fadeAway();
        await wait(9000);
    } else {
        await say([['entity', 'Then don\'t look for me anywhere. I\'ll be in every note you play.']], 2000);
        choir(ac.currentTime + 0.1);
        S.flash = 1;
        S.visMul = 1.4;
        await say([['narr', 'The colours stay a little brighter than before.']], 2000);
        await wait(2000);
    }
    ADV.completing = false;
    if (ADV.on) showEpilogue();
}

function fadeAway() {
    const t = ac.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t);
    master.gain.linearRampToValueAtTime(0.0001, t + 8);
    const start = performance.now();
    const id = setInterval(() => {
        const k = Math.min(1, (performance.now() - start) / 8000);
        S.visMul = Math.max(0.15, 1.1 * (1 - k));
        if (k >= 1) clearInterval(id);
    }, 100);
}

// the facts of the journey; a chapter that was skipped leaves no line
function epFacts() {
    return [
        ['Heartbeat', ADV.bpm ? `${ADV.bpm} BPM` : ''],
        ['Her note', ADV.note],
        ['Her frequency', ADV.freq ? `${ADV.freq.toFixed(1)} MHz` : ''],
        ['Her song', ADV.song],
        ['Her rhythm', ADV.rhythm ? 'rebuilt, waiting in the Studio, slot H' : ''],
        ['Memory', ADV.block ? `nonce ${fmtInt(ADV.block.nonce)} · ${ADV.block.zeros} zero bits` : ''],
        ['Drops', ADV.drops ? `${ADV.drops} on the one, in ${ADV.tries} tries` : ''],
        ['You told her', ADV.answer],
        ['Ending', ENDINGS[ADV.ending]?.fact || '']
    ].filter(([, v]) => v);
}

function showEpilogue() {
    clearProgress();
    // she will remember this; the radio, when there is one, keeps the frequency you found her on
    saveMemory({
        name: ADV.name || 'nameless', bpm: ADV.bpm, note: ADV.note, ending: ADV.ending, song: ADV.song,
        answer: ADV.answer, reply: ADV.reply, nonce: ADV.block?.nonce, zeros: ADV.block?.zeros,
        date: Date.now()
    });
    emit('storyEnded', { name: ADV.name || 'signal', freq: ADV.freq });
    const p = ADV.namePattern || S.pattern;
    const c = $('#ep-sigil').getContext('2d');
    c.clearRect(0, 0, 240, 240);
    drawSigil(c, p, 120, 120, 92, 1, 2.2, 0);
    $('#ep-kicker').textContent = ENDINGS[ADV.ending]?.kicker || 'Epilogue';
    $('#ep-title').textContent = ADV.name || 'nameless';
    const dl = $('#ep-facts');
    dl.innerHTML = '';
    for (const [k, v] of epFacts()) {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        dl.append(dt, dd);
    }
    $('#ep-quote').textContent = ADV.reply;
    $('#ep-quote').hidden = !ADV.reply;
    $('#epilogue').hidden = false;
}

// a keepsake card: the name's sigil, the facts of the journey, her last words
function keepsakeCanvas() {
    const W = 1080, H = 1500;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d0720'); g.addColorStop(1, '#05040a');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'lighter';
    drawSigil(c, ADV.namePattern || S.pattern, W / 2, 420, 260, 1, 5, 0);
    c.globalCompositeOperation = 'source-over';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(243,240,255,0.6)';
    c.font = '600 28px "JetBrains Mono", monospace';
    c.fillText('SINESTESIA · THE SIGNAL', W / 2, 90);
    c.fillStyle = '#ff4fd8';
    c.font = '400 92px "Major Mono Display", monospace';
    c.fillText((ADV.name || 'nameless').toLowerCase().slice(0, 16), W / 2, 800);
    c.font = '400 28px "JetBrains Mono", monospace';
    c.fillStyle = 'rgba(243,240,255,0.85)';
    let y = 880;
    for (const [k, v] of epFacts()) { c.fillText(`${k}: ${v}`.slice(0, 58), W / 2, y); y += 42; }
    if (ADV.reply) {
        c.fillStyle = '#4ff0ff';
        c.font = 'italic 28px "JetBrains Mono", monospace';
        const words = ('«' + ADV.reply + '»').split(' ');
        let line = '';
        y += 30;
        for (const w of words) {
            const test = line ? line + ' ' + w : w;
            if (c.measureText(test).width > W - 180 && line) { c.fillText(line, W / 2, y); y += 40; line = w; }
            else line = test;
        }
        if (line) c.fillText(line, W / 2, y);
    }
    c.fillStyle = 'rgba(243,240,255,0.45)';
    c.font = '24px "JetBrains Mono", monospace';
    c.fillText(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), W / 2, H - 60);
    return cv;
}

$('#ep-save').onclick = () => {
    const slug = (ADV.name || 'signal').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-');
    keepsakeCanvas().toBlob(b => download(b, `the-signal-${slug}.png`), 'image/png');
};

function resumeAfterEnding() {
    const ending = ADV.ending;
    $('#epilogue').hidden = true;
    stopAdventure();
    if (ending === 'vai' && ac) {
        const t = ac.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(0.0001, t);
        master.gain.linearRampToValueAtTime(S.volume, t + 6);
        startIntro();
    }
}

$('#ep-play').onclick = resumeAfterEnding;
$('#ep-again').onclick = () => { resumeAfterEnding(); startAdventure(); };
$('#b-adventure').onclick = () => {
    setDrawer(false);
    if (ADV.on || ADV.menu) { stopAdventure(); return; }
    const saved = loadProgress();
    if (saved) offerContinue(saved); else startAdventure();
};

// the heartbeat takes the space bar and the taps on the screen; the drop takes them held down
on('key', e => {
    if (e.key !== ' ') return false;
    if (live('tap')) { e.preventDefault(); if (!e.repeat) advTap(); return true; }
    if (live('drop')) { e.preventDefault(); if (!e.repeat) holdStart(); return true; }
    return false;
});
on('press', () => {
    if (live('tap')) { advTap(); return true; }
    if (live('drop')) { holdStart(); return true; }
    return false;
});
addEventListener('keyup', e => { if (e.key === ' ') holdEnd(); });
addEventListener('pointerup', holdEnd);
addEventListener('pointercancel', holdEnd);
// her name and your answer are typed
on('submit', text => {
    if (!ADV.on || ADV.completing || !['name', 'talk'].includes(advTask())) return false;
    advText(text);
    return true;
});
on('note', m => {
    if (live('echo')) echoNote(m);
    if (live('alive') && ADV.alive) ADV.alive.notes.push(((m % 12) + 12) % 12);
});
on('spell', stormSpell);
on('bar', t => {
    ADV.barT = t;
    if (live('grid')) {
        gridBar();
    } else if (live('storm') && ADV.storm) {
        stormBar();
    } else if (live('alive') && ADV.alive) {
        aliveBar();
    }
});
on('step', (i, t) => { if (ADV.on && ADV.ready && ADV.humMidi && i % 8 === 0) humNote(t); });
on('frame', advTick);
on('status', () => (ADV.on && CHAPTERS[ADV.ch] ? CHAPTERS[ADV.ch].title : null));
on('mined', block => {
    if (advTask() !== 'mine') return;
    ADV.block = block;
    completeChapter([['narr', `Key found: ${block.zeros} zero bits, nonce ${fmtInt(block.nonce)}.`]]);
});
mode('story', () => { if (ADV.on || ADV.menu) stopAdventure(); });
feature('story');
