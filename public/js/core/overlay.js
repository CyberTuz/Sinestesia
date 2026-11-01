// The overlay canvas: the sigil, typed letters, sparks and tokens, drawn over the shader every frame.

import { $, S, reduceMotion } from './state.js';
import { emit } from './bus.js';
import { drawSigil } from './pattern.js';
import { ac, timeData } from './audio.js';
import { theremin } from './instruments.js';

// the particles: sparks of the mouse, letters you type, the tokens the voices say
export const fx = $('#fx');
export const fctx = fx.getContext('2d');
export const sparks = [];
export const letters = [];
export const tokens = [];

export function spawnLetter(ch, scale = 1) {
    const w = fx.width, h = fx.height;
    letters.push({
        ch,
        x: w * (0.2 + Math.random() * 0.6),
        y: h * (0.25 + Math.random() * 0.45),
        vx: (Math.random() - 0.5) * 1.2,
        vy: -0.4 - Math.random() * 0.8,
        rot: (Math.random() - 0.5) * 0.5,
        hue: (S.hue * 360 + ch.codePointAt(0) * 17) % 360,
        scale,
        life: 1
    });
    if (letters.length > 60) letters.shift();
}

// ── token rain: the machine's words fall like the units it thinks in ──
export function tokenRain(text) {
    const w = fx.width, h = fx.height;
    String(text).split(/\s+/).filter(Boolean).slice(0, 16).forEach((word, k) => {
        tokens.push({ text: word, x: w * (0.08 + Math.random() * 0.75), y: -k * 30 - Math.random() * h * 0.2, vy: 0.7 + Math.random() * 0.9, life: 1, size: 13 + Math.random() * 7, color: '79,240,255' });
    });
    if (tokens.length > 120) tokens.splice(0, tokens.length - 120);
}

export function spawnToken(text) {
    const w = fx.width, h = fx.height;
    tokens.push({ text, x: w * (0.62 + Math.random() * 0.3), y: h * (0.15 + Math.random() * 0.4), vy: 0.4, life: 0.8, size: 11, color: '150,120,255' });
    if (tokens.length > 120) tokens.shift();
}

export function drawOverlay() {
    const w = fx.width, h = fx.height, dpr = w / innerWidth;
    fctx.clearRect(0, 0, w, h);
    fctx.globalCompositeOperation = 'lighter';

    // the current phrase's sigil: draws itself in, then breathes with the kick
    if (S.pattern) {
        S.sigilAge += 1 / 60;
        const kick = reduceMotion ? 0 : S.kickEnv;
        const fresh = Math.exp(-S.sigilAge * 0.8);
        const R = Math.min(w, h) * 0.26 * (1 + kick * 0.05 * S.intensity);
        const alpha = Math.min(1, 0.1 + 0.25 * kick + 0.7 * fresh) * (0.3 + 0.7 * S.intensity);
        const rotation = reduceMotion ? 0 : performance.now() / 20000;
        drawSigil(fctx, S.pattern, w / 2, h / 2, R, alpha, 1.5 * dpr, rotation, Math.min(1, S.sigilAge / 1.5));
    }

    // typed letters float up and dissolve
    for (let i = letters.length - 1; i >= 0; i--) {
        const L = letters[i];
        L.x += L.vx * dpr; L.y += L.vy * dpr; L.life -= 0.012;
        if (L.life <= 0) { letters.splice(i, 1); continue; }
        const size = (90 + (1 - L.life) * 220) * dpr * (0.6 + S.intensity * 0.6) * L.scale;
        fctx.save();
        fctx.translate(L.x, L.y);
        fctx.rotate(L.rot * (1 - L.life));
        fctx.font = `${size}px 'Major Mono Display', monospace`;
        fctx.textAlign = 'center';
        fctx.textBaseline = 'middle';
        fctx.fillStyle = `hsla(${L.hue}, 100%, 65%, ${L.life * 0.55})`;
        fctx.fillText(L.ch, 0, 0);
        fctx.strokeStyle = `hsla(${(L.hue + 160) % 360}, 100%, 70%, ${L.life * 0.5})`;
        fctx.lineWidth = 1.5 * dpr;
        fctx.strokeText(L.ch, 6 * dpr * L.life, 0);
        fctx.restore();
    }

    // mouse sparks
    for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * dpr; s.y += s.vy * dpr; s.life -= 0.025;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        fctx.fillStyle = `hsla(${s.hue}, 100%, 70%, ${s.life})`;
        fctx.beginPath();
        fctx.arc(s.x, s.y, (1 + s.life * 2.5) * dpr, 0, Math.PI * 2);
        fctx.fill();
    }

    // the machine's tokens
    for (let i = tokens.length - 1; i >= 0; i--) {
        const k = tokens[i];
        k.y += k.vy * dpr;
        k.life -= 0.005;
        if (k.life <= 0 || k.y > h) { tokens.splice(i, 1); continue; }
        const size = k.size * dpr, pad = 5 * dpr;
        fctx.font = `600 ${size}px 'JetBrains Mono', monospace`;
        const tw = fctx.measureText(k.text).width;
        const a = Math.min(1, k.life * 1.6);
        fctx.strokeStyle = `rgba(${k.color},${a * 0.7})`;
        fctx.lineWidth = dpr;
        fctx.strokeRect(k.x - pad, k.y - size * 0.95, tw + pad * 2, size * 1.35);
        fctx.fillStyle = `rgba(${k.color},${a})`;
        fctx.fillText(k.text, k.x, k.y);
    }

    // the features draw their own layers: duet cursors, spell trails, the mining readout
    emit('draw', fctx, w, h, dpr);

    // theremin halo
    if (theremin) {
        const x = S.mouse[0] * w, y = S.mouse[1] * h;
        const r = (30 + S.level * 80) * dpr;
        const g = fctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.5)');
        g.addColorStop(1, 'rgba(255,79,216,0)');
        fctx.fillStyle = g;
        fctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // oscilloscope
    if (ac) {
        fctx.globalCompositeOperation = 'source-over';
        fctx.strokeStyle = `rgba(243,240,255,${0.18 + S.level * 0.5})`;
        fctx.lineWidth = 1.5 * dpr;
        fctx.beginPath();
        const midY = h * 0.5, amp = h * 0.18;
        const n = timeData.length;
        for (let i = 0; i < n; i += 2) {
            const x = (i / (n - 1)) * w;
            const y = midY + timeData[i] * amp;
            i ? fctx.lineTo(x, y) : fctx.moveTo(x, y);
        }
        fctx.stroke();
    }
    fctx.globalCompositeOperation = 'source-over';
}
