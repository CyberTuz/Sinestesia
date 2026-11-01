// ═══════════════════════════════════════════════════════════════════════
// MEMORY: she remembers you between visits (kept only in this browser)
// ═══════════════════════════════════════════════════════════════════════

import { $ } from './state.js';
import { emit } from './bus.js';
import { toast } from './hud.js';

export const MEM_KEY = 'sinestesia-memoria';
export function loadMemory() {
    try { return JSON.parse(localStorage.getItem(MEM_KEY)) || null; } catch (e) { return null; }
}
export function saveMemory(patch) {
    const m = { ...(MEMORY || {}), ...patch };
    MEMORY = m;
    try { localStorage.setItem(MEM_KEY, JSON.stringify(m)); } catch (e) { /* memory is a nicety */ }
}
export let MEMORY = loadMemory();

export const daysSince = ms => Math.max(0, Math.round((Date.now() - (ms || Date.now())) / 86400000));

export let forgetArmed = 0;
$('#b-forget').onclick = e => {
    const b = e.currentTarget;
    if (Date.now() - forgetArmed > 4000) {
        forgetArmed = Date.now();
        b.textContent = 'Sure? Click again';
        setTimeout(() => { if (Date.now() - forgetArmed >= 4000) b.textContent = 'Forget the memory'; }, 4100);
        return;
    }
    try { localStorage.removeItem(MEM_KEY); } catch (err) { /* nothing stored */ }
    MEMORY = null;
    forgetArmed = 0;
    emit('memory');
    b.textContent = 'Forget the memory';
    toast('Done: she will not remember you anymore.');
};
