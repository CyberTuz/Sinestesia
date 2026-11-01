// ── session recording ─────────────────────────────────────────────────

import { $ } from '../core/state.js';
import { feature, on } from '../core/bus.js';
import { download } from '../core/download.js';
import { ac, analyser } from '../core/audio.js';

let recorder = null, recDest = null, recStart = 0;
const recBtn = $('#b-rec');

recBtn.onclick = () => {
    if (!ac) return;
    if (recorder) { recorder.stop(); return; }
    if (!window.MediaRecorder) { recBtn.textContent = 'Not available'; return; }
    if (!recDest) { recDest = ac.createMediaStreamDestination(); analyser.connect(recDest); }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported?.(m)) || '';
    let r;
    try { r = new MediaRecorder(recDest.stream, mime ? { mimeType: mime } : undefined); }
    catch (e) { recBtn.textContent = 'Not available'; return; }
    const chunks = [];
    r.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    r.onstop = () => {
        recorder = null;
        recBtn.setAttribute('aria-pressed', 'false');
        recBtn.textContent = '● Record';
        const type = r.mimeType || mime || 'audio/webm';
        saveRecording(new Blob(chunks, { type }), type);
    };
    r.start(1000);
    recorder = r;
    recStart = performance.now();
    recBtn.setAttribute('aria-pressed', 'true');
};

function saveRecording(blob, type) {
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    download(blob, `sinestesia-${stamp}.${ext}`);
    recBtn.textContent = 'Saved ✓';
    setTimeout(() => { if (!recorder) recBtn.textContent = '● Record'; }, 2500);
}

// the button shows how long the recording has been running
on('frame', () => {
    if (!recorder) return;
    const s = Math.floor((performance.now() - recStart) / 1000);
    recBtn.textContent = `■ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
});
feature('record');
