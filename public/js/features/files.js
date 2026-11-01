// ═══════════════════════════════════════════════════════════════════════
// SOURCES: files and the Bitcoin blockchain
// ═══════════════════════════════════════════════════════════════════════

import { $ } from '../core/state.js';
import { feature } from '../core/bus.js';
import { buildPattern, degreeMidi, sha256Bytes } from '../core/pattern.js';
import { queuePattern } from '../core/sequencer.js';
import { setScene, toast } from '../core/hud.js';

// ── files: the file's real SHA-256 is the groove, its own bytes are the melody ──
const MAGIC = [
    ['PNG', [0x89, 0x50, 0x4e, 0x47]], ['JPEG', [0xff, 0xd8, 0xff]], ['GIF', [0x47, 0x49, 0x46, 0x38]],
    ['PDF', [0x25, 0x50, 0x44, 0x46]], ['ZIP/Office', [0x50, 0x4b, 0x03, 0x04]], ['ELF', [0x7f, 0x45, 0x4c, 0x46]],
    ['SQLite', [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65]], ['7z', [0x37, 0x7a, 0xbc, 0xaf]], ['RIFF (WAV/WEBP)', [0x52, 0x49, 0x46, 0x46]],
    ['MP3', [0x49, 0x44, 0x33]], ['gzip', [0x1f, 0x8b]], ['EXE (PE)', [0x4d, 0x5a]]
];

function fileKind(u8) {
    for (const [name, sig] of MAGIC) if (sig.every((b, i) => u8[i] === b)) return name;
    const n = Math.min(u8.length, 4096);
    let printable = 0;
    for (let i = 0; i < n; i++) {
        const b = u8[i];
        if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 0xc0) printable++;
    }
    return n && printable / n > 0.92 ? 'text' : 'binary';
}

function entropy(u8) {
    const counts = new Uint32Array(256);
    for (let i = 0; i < u8.length; i++) counts[u8[i]]++;
    let h = 0;
    for (const c of counts) if (c) { const q = c / u8.length; h -= q * Math.log2(q); }
    return h;
}

const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

async function listenToFile(file) {
    if (file.size > 300 * 1048576) { toast('File too large: the maximum is 300 MB.'); return; }
    toast(`Listening to ${file.name}…`, 2000);
    const u8 = new Uint8Array(await file.arrayBuffer());
    const { bytes, real } = await sha256Bytes(u8);
    const p = buildPattern(bytes, real, file.name);
    const kind = fileKind(u8);
    const h = entropy(u8);
    // 32 bytes sampled evenly from start to end: the melody is the file's shape
    const samples = [];
    for (let k = 0; k < 32; k++) samples.push(u8.length ? u8[Math.floor((k / 32) * u8.length)] : 0);
    p.chars = samples.map(b => b.toString(16).padStart(2, '0'));
    p.hook = samples.map(b => b === 0 ? null : degreeMidi(p, b));
    p.vowelChars = [...file.name];
    p.label = `📄 ${file.name} · ${fmtSize(file.size)} · ${kind} · entropy ${h.toFixed(2)} bits/byte`;
    queuePattern(p);
    // ordered data flows like liquid; compressed or encrypted data turns geometric
    setScene(h > 7.5 ? 5 : h > 6 ? 4 : kind === 'text' ? 2 : 6);
}

const fileIn = $('#file-in');
$('#b-file').onclick = () => fileIn.click();
fileIn.addEventListener('change', () => { if (fileIn.files[0]) listenToFile(fileIn.files[0]); fileIn.value = ''; });
window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dropping'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
window.addEventListener('drop', e => {
    e.preventDefault();
    document.body.classList.remove('dropping');
    const f = e.dataTransfer?.files?.[0];
    if (f) listenToFile(f);
});

feature('files');
