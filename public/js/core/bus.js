// How the core and the features talk. The core never imports a feature: each feature listens to
// the core's events and registers what it offers, so taking one away is deleting its import in main.js.
//
// events the core sends
//   beforeBar (t)          each bar, before a queued groove takes over
//   bar (t)                each bar, once the groove is set
//   step (i, t)            each sixteenth as it is scheduled
//   heard (i)              each sixteenth as it sounds
//   frame ()               every animation frame
//   draw (ctx, w, h, dpr)  every frame, on the overlay canvas
//   pattern (p)            a new groove started
//   note (midi, t, ch)     you played a letter
//   phrase (text)          you pressed Enter on a phrase
//   ready (p)              the first groove is ready
//   started ()             the music started (the Play button)
// questions the core asks
//   key (e), press (e), submit (text)   a feature that answers true takes the input
//   term ()                             true while a feature needs the terminal
//   status ()                           some text for the status line
// between features
//   spell (name), drop (), mined (block), storyEnded ({ name, freq }), memory ()

export const handlers = {};

export function on(name, fn) {
    (handlers[name] ||= []).push(fn);
}

export function emit(name, ...args) {
    for (const fn of handlers[name] || []) fn(...args);
}

// the first handler that answers true takes the event
export function claim(name, ...args) {
    return (handlers[name] || []).some(fn => fn(...args));
}

// every answer that is not empty, in the order the features loaded
export function collect(name, ...args) {
    return (handlers[name] || []).map(fn => fn(...args)).filter(v => v);
}

// modes that cannot run together: starting one stops the others by name; a mode that is not loaded is skipped
export const stops = {};
export function mode(name, stop) {
    stops[name] = stop;
}
export function stopModes(...names) {
    for (const n of names) stops[n]?.();
}

// what a feature offers the others, when it is loaded: actions.mine?.()
export const actions = {};

// the features that loaded, for the few places that adapt to them (the tips skip what is missing)
export const loaded = new Set();

// markup marked data-needs="name" stays hidden until the feature with that name loads
export function feature(name) {
    loaded.add(name);
    for (const el of document.querySelectorAll(`[data-needs="${name}"]`)) el.removeAttribute('data-needs');
}
