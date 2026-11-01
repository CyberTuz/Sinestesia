// Sinestesia starts here. The core is always loaded; each feature below registers itself with the core,
// so a feature can go by deleting its import line (then its file, and the markup marked
// data-needs="its name" in index.html). README.md lists what depends on what.

import { $, S } from './core/state.js';
import { emit } from './core/bus.js';
import { patternFrom } from './core/pattern.js';
import { ac, applyMouseToAudio, initAudio, master } from './core/audio.js';
import { applyPattern, startIntro, startSequencer } from './core/sequencer.js';
import { addSigil, renderPattern, setScene } from './core/hud.js';
import { typeEl } from './core/input.js';
import { frame } from './core/visuals.js';

import { MEMORY } from './core/memory.js';

// the order matters where two features answer the same event: the Studio picks its slot before the
// machine's reply can take the bar
import './features/studio.js';
import './features/story.js';
import './features/journey.js';
import './features/machine.js';
import './features/mining.js';
import './features/radio.js';
import './features/spells.js';
import './features/duet.js';
import './features/files.js';
import './features/bitcoin.js';
import './features/record.js';
import './features/keys.js';
// last, so it knows which features are there
import './features/tips.js';

// Play: the playground starts with the pad alone and builds up; the story and the Studio are in the dock
function startAudio() {
    initAudio();
    ac.resume();
    // the sound rises out of silence over six seconds
    master.gain.setValueAtTime(0.0001, ac.currentTime);
    master.gain.linearRampToValueAtTime(S.volume, ac.currentTime + 6);
    applyPattern(S.pattern, ac.currentTime);
    applyMouseToAudio();
    startSequencer();
    const st = $('#start');
    st.classList.add('leaving');
    setTimeout(() => { st.hidden = true; }, 2600);
    navigator.wakeLock?.request('screen').catch(() => {});
    startIntro();
    typeEl.focus();
    emit('started');
}

$('#go').addEventListener('click', startAudio);

// after the story's "become the music" ending her name is the groove every visit starts from, a little brighter
const becameMusic = MEMORY?.ending === 'diventa' && MEMORY.name;
if (becameMusic) {
    S.intensity = Math.min(1, S.intensity + 0.2);
    $('#inten').value = S.intensity;
    $('#inten-o').textContent = Math.round(S.intensity * 100);
}

patternFrom(becameMusic ? MEMORY.name : 'sinestesia').then(p => {
    S.pattern = p;
    renderPattern();
    addSigil(p);
    emit('ready', p);
    setScene(S.scene);
    requestAnimationFrame(frame);
});
