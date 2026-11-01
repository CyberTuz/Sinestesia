// ═══════════════════════════════════════════════════════════════════════
// TEXT → HASH → GROOVE
// ═══════════════════════════════════════════════════════════════════════

import { SCALES } from './state.js';

export async function sha256Bytes(data) {
    try {
        const buf = await crypto.subtle.digest('SHA-256', data);
        return { bytes: new Uint8Array(buf), real: true };
    } catch (e) {
        // fallback when SubtleCrypto is unavailable: FNV-1a seeded generator
        let h = 2166136261;
        for (let i = 0; i < data.length; i++) { h ^= data[i]; h = Math.imul(h, 16777619); }
        const out = new Uint8Array(32);
        for (let i = 0; i < 32; i++) { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; out[i] = h & 255; }
        return { bytes: out, real: false };
    }
}

export const sha256 = text => sha256Bytes(new TextEncoder().encode(text));

export function buildPattern(bytes, real, text) {
    const names = Object.keys(SCALES);
    const scaleName = names[bytes[16] % names.length];
    const scale = SCALES[scaleName];
    const root = 33 + (bytes[17] % 12);          // A1..G#2: acid bass range
    const steps = [];
    for (let i = 0; i < 16; i++) {
        const b = bytes[i], c = bytes[(i + 18) % 32];
        const deg = (b >> 3) % scale.length;
        steps.push({
            gate: i === 0 || (b % 7) < 5,
            note: scale[deg] + ((b >> 6) & 1 ? 12 : 0),
            deg,
            oct: (b >> 6) & 1 ? 12 : 0,
            accent: (c & 3) === 0,
            slide: ((c >> 2) & 3) === 0,
            byte: b
        });
    }
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return { text, hex, real, scaleName, scale, root, steps, bytes };
}

export async function patternFrom(text) {
    const { bytes, real } = await sha256(text);
    const p = buildPattern(bytes, real, text);
    // the phrase itself becomes a melodic hook: letters and digits sing, everything else rests
    p.chars = [...text].slice(0, 32);
    p.hook = p.chars.map(ch => /[\p{L}\p{N}]/u.test(ch) ? charMidi(ch, p) : null);
    return p;
}

// map a value 0..(2·scale length) onto the lead's register
export function degreeMidi(p, i) {
    const len = p.scale.length;
    i = i % (len * 2);
    return p.root + 36 + 12 * Math.floor(i / len) + p.scale[i % len];
}

// A sigil: a geometric glyph drawn from the hash bytes, unique to each phrase
export function drawSigil(c, p, cx, cy, R, alpha, lw, rotation, progress = 1) {
    const by = p.bytes;
    const n = 5 + (by[18] % 8);
    const hue = (by[19] / 255) * 360;
    const outer = [], inner = [];
    for (let i = 0; i < n; i++) {
        const a = rotation + (i / n) * Math.PI * 2 - Math.PI / 2;
        outer.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
        inner.push([cx + Math.cos(a + Math.PI / n) * R * 0.5, cy + Math.sin(a + Math.PI / n) * R * 0.5]);
    }
    c.save();
    c.lineWidth = lw;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.globalAlpha = alpha;
    c.strokeStyle = `hsl(${hue}, 100%, 70%)`;
    c.beginPath();
    c.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    outer.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
    c.closePath();
    c.stroke();
    const count = Math.ceil(16 * progress);
    for (let i = 0; i < count; i++) {
        const b1 = by[i], b2 = by[i + 16];
        const A = outer[b1 % n];
        const B = (b2 & 1 ? inner : outer)[(b2 >> 1) % n];
        c.strokeStyle = `hsl(${(hue + (b1 & 63) * 2) % 360}, 100%, ${60 + (b2 & 15)}%)`;
        c.beginPath();
        c.moveTo(A[0], A[1]);
        c.lineTo(B[0], B[1]);
        c.stroke();
    }
    c.fillStyle = '#ffffff';
    for (const [x, y] of outer) {
        c.beginPath();
        c.arc(x, y, lw * 1.6, 0, Math.PI * 2);
        c.fill();
    }
    c.restore();
}

// a letter's note: its code point picks a degree over two octaves, capitals sound an octave up
export function charMidi(ch, p) {
    const len = p.scale.length;
    const code = ch.toLowerCase().codePointAt(0);
    const i = code % (len * 2);
    const up = ch !== ch.toLowerCase() ? 12 : 0;
    return p.root + 36 + 12 * Math.floor(i / len) + p.scale[i % len] + up;
}
