// ═══════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════

export const $ = s => document.querySelector(s);
export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const SCALES = {
    'Phrygian':      [0, 1, 3, 5, 7, 8, 10],
    'Minor':      [0, 2, 3, 5, 7, 8, 10],
    'Dorian':      [0, 2, 3, 5, 7, 9, 10],
    'Pentatonic': [0, 3, 5, 7, 10],
    'Harmonic':    [0, 2, 3, 5, 7, 8, 11]
};
export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const SCENES = ['Tunnel', 'Kaleido', 'Liquid', 'Fractal', 'Triangles', 'Squares', 'Polygons', 'Network', 'City', 'Singularity', 'Cathedral'];

export const S = {
    bpm: 128,
    volume: 0.8,
    intensity: reduceMotion ? 0.3 : 0.6,
    scene: 2,
    drums: true,
    quantize: true,
    auto: false,
    paused: false,
    echo: true,
    hookPos: 0,
    sigilAge: 0,
    voices: true,
    hatsOn: true,
    bassOn: true,
    autoCut: 0.5,
    visMul: 0.5,
    intro: null,
    style: 'techno',
    stutterBar: -1,
    spells: true,
    jPhase: 0,
    jBar: 0,
    jPending: false,
    machine: false,
    machinePending: null,
    machineAt: 0,
    lastPhrase: '',
    voiceNext: null,
    dropRiser: false,
    dropAt: 0,
    dropNow: false,
    dropScene: null,
    mouse: [0.5, 0.5],
    pattern: null,
    pending: null,
    bar: 0,
    hue: 0,
    flash: 0,
    glitch: 0,
    level: 0,
    kickEnv: 0,
    // shared with the features
    takeover: null,   // the Studio while it is open: it plays the groove its own way
    story: false,     // The Signal is running: it decides the voices and takes some keys
    role: 'melody',   // the instrument your keys play (the duet can change it)
    sparkAt: 0        // when a mouse spark last rang a bell
};

export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
export const noteName = m => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

export const fmtInt = n => Math.round(n).toLocaleString('en-US');
