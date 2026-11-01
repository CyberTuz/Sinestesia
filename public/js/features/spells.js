// ═══════════════════════════════════════════════════════════════════════
// SPELLS: draw a shape while holding the mouse and it changes the world
// ═══════════════════════════════════════════════════════════════════════

import { $, S } from '../core/state.js';
import { actions, emit, feature, loaded, on } from '../core/bus.js';
import { ac } from '../core/audio.js';
import { impact } from '../core/instruments.js';
import { termLine, toast, toggle, typewrite, updateTerm } from '../core/hud.js';
import { fx } from '../core/overlay.js';
import { applyDirection } from '../core/direction.js';

// <spell-recognizer> a $1-style unistroke recognizer: resample, rotate, scale, compare
const SQ = 250, N1 = 48, PHI = 0.5 * (-1 + Math.sqrt(5));

function pathLen(p) {
    let d = 0;
    for (let i = 1; i < p.length; i++) d += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    return d;
}

function resample(pts, n) {
    const step = pathLen(pts) / (n - 1);
    const p = pts.map(q => ({ x: q.x, y: q.y }));
    const out = [p[0]];
    let acc = 0;
    for (let i = 1; i < p.length; i++) {
        const d = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
        if (d > 0 && acc + d >= step) {
            const k = (step - acc) / d;
            const q = { x: p[i - 1].x + k * (p[i].x - p[i - 1].x), y: p[i - 1].y + k * (p[i].y - p[i - 1].y) };
            out.push(q);
            p.splice(i, 0, q);
            acc = 0;
        } else {
            acc += d;
        }
    }
    while (out.length < n) out.push(p[p.length - 1]);
    return out.slice(0, n);
}

function centroid(p) {
    let x = 0, y = 0;
    for (const q of p) { x += q.x; y += q.y; }
    return { x: x / p.length, y: y / p.length };
}

function rotateBy(p, a) {
    const c = centroid(p), cos = Math.cos(a), sin = Math.sin(a);
    return p.map(q => ({ x: (q.x - c.x) * cos - (q.y - c.y) * sin + c.x, y: (q.x - c.x) * sin + (q.y - c.y) * cos + c.y }));
}

function normalizeStroke(pts) {
    let p = resample(pts, N1);
    const c = centroid(p);
    p = rotateBy(p, -Math.atan2(c.y - p[0].y, c.x - p[0].x));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const q of p) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
    const w = Math.max(1e-6, maxX - minX), h = Math.max(1e-6, maxY - minY);
    p = p.map(q => ({ x: q.x * SQ / w, y: q.y * SQ / h }));
    const c2 = centroid(p);
    return p.map(q => ({ x: q.x - c2.x, y: q.y - c2.y }));
}

function pathDist(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
    return d / a.length;
}

// golden-section search for the rotation that fits best, within ±45°
function bestDist(p, T) {
    let a = -Math.PI / 4, b = Math.PI / 4;
    const th = Math.PI / 90;
    let x1 = PHI * a + (1 - PHI) * b, f1 = pathDist(rotateBy(p, x1), T);
    let x2 = (1 - PHI) * a + PHI * b, f2 = pathDist(rotateBy(p, x2), T);
    while (Math.abs(b - a) > th) {
        if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = PHI * a + (1 - PHI) * b; f1 = pathDist(rotateBy(p, x1), T); }
        else { a = x1; x1 = x2; f1 = f2; x2 = (1 - PHI) * a + PHI * b; f2 = pathDist(rotateBy(p, x2), T); }
    }
    return Math.min(f1, f2);
}

function shapePts(kind) {
    const pts = [];
    const poly = vs => {
        for (let i = 0; i < vs.length - 1; i++) {
            for (let j = 0; j < 16; j++) {
                const u = j / 16;
                pts.push({ x: vs[i][0] + (vs[i + 1][0] - vs[i][0]) * u, y: vs[i][1] + (vs[i + 1][1] - vs[i][1]) * u });
            }
        }
        const last = vs[vs.length - 1];
        pts.push({ x: last[0], y: last[1] });
    };
    if (kind === 'cerchio') for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push({ x: Math.cos(a) * 100, y: Math.sin(a) * 100 }); }
    if (kind === 'triangolo') poly([[0, -100], [87, 50], [-87, 50], [0, -100]]);
    if (kind === 'quadrato') poly([[-100, -100], [100, -100], [100, 100], [-100, 100], [-100, -100]]);
    if (kind === 'spirale') for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 5, r = 10 + (i / 96) * 90; pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r }); }
    if (kind === 'zigzag') poly([[0, 0], [40, 80], [80, 0], [120, 80], [160, 0]]);
    return pts;
}

// every shape in both directions and mirrored, and closed shapes from eight starting points,
// so it does not matter where or which way you start drawing
const TEMPLATES = [];
for (const kind of ['cerchio', 'triangolo', 'quadrato', 'spirale', 'zigzag']) {
    const base = shapePts(kind);
    const closed = kind === 'cerchio' || kind === 'triangolo' || kind === 'quadrato';
    for (let s = 0; s < (closed ? 8 : 1); s++) {
        const off = Math.floor(s * (base.length - 1) / 8);
        const p = closed ? base.slice(off).concat(base.slice(1, off + 1)) : base;
        const mirror = p.map(q => ({ x: -q.x, y: q.y }));
        for (const v of [p, p.slice().reverse(), mirror, mirror.slice().reverse()]) TEMPLATES.push({ kind, pts: normalizeStroke(v) });
    }
}

// sharp turns along a closed stroke: none for a circle, three for a triangle, four for a square
function corners(pts) {
    const p = resample(pts, 48), n = p.length;
    const turn = p.map((b, i) => {
        const a = p[(i - 2 + n) % n], c = p[(i + 2) % n];
        let d = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
        return d > Math.PI ? 2 * Math.PI - d : d;
    });
    let count = 0;
    for (let i = 0; i < n; i++) {
        if (turn[i] > 1.05 && turn[i] >= turn[(i - 1 + n) % n] && turn[i] > turn[(i + 1) % n]) count++;
    }
    return count;
}

function recognize(pts) {
    const p = normalizeStroke(pts);
    const best = {};
    for (const T of TEMPLATES) {
        const d = bestDist(p, T.pts);
        if (!(T.kind in best) || d < best[T.kind]) best[T.kind] = d;
    }
    const score = k => 1 - best[k] / (0.5 * Math.sqrt(2 * SQ * SQ));
    let kind = Object.keys(best).reduce((a, b) => (best[a] <= best[b] ? a : b));
    // template matching confuses circles and squares; when two shapes are close, counting corners settles it
    if (kind === 'cerchio' || kind === 'quadrato' || kind === 'triangolo') {
        const c = corners(pts);
        const byCorners = c <= 1 ? 'cerchio' : c === 3 ? 'triangolo' : c >= 4 ? 'quadrato' : null;
        if (byCorners && best[byCorners] <= best[kind] * 1.6) kind = byCorners;
    }
    return { kind, score: score(kind) };
}
// </spell-recognizer>

// random scribbles tend to look like a zigzag, so that one needs a cleaner stroke
const SPELL_MIN_SCORE = { zigzag: 0.86, spirale: 0.74 };

const SPELLS = {
    triangolo: { name: 'Fire', say: 'fire', d: { scene: 'Triangles', scale: 'Harmonic', filter: 0.88, space: 0.3, hue: 0.02, intensity: 1, bpm: 138, voice: 'chant' } },
    cerchio: { name: 'Water', say: 'water', d: { scene: 'Liquid', scale: 'Dorian', filter: 0.28, space: 0.9, hue: 0.55, bpm: 118, voice: 'choir' } },
    quadrato: { name: 'Time', say: 'time', stutter: true, d: { scene: 'Squares', scale: 'Minor', filter: 0.5, space: 0.4, hue: 0.8, voice: 'robot' } },
    spirale: { name: 'Vortex', say: 'vortex', d: { scene: 'Singularity', filter: 0.7, space: 0.7, drop: true, voice: 'robot' } },
    zigzag: { name: 'Lightning', say: 'lightning', strike: true, d: { scene: 'Network', filter: 0.95, intensity: 1, hue: 0.15, voice: 'robot' } }
};

const spell = { active: false, pts: [], t0: 0, fx: null, guest: false };

// the story can borrow the spells: they work while it runs, and only flare, leaving its music alone
actions.spellsGuest = on => { spell.guest = on; };

async function castSpell(kind, pts) {
    const sp = SPELLS[kind];
    // read before telling the story: the spell that ends its chapter also ends the borrowing
    const guest = spell.guest;
    emit('spell', sp.name);
    spell.fx = { pts, name: sp.name, life: 1 };
    S.flash = 1;
    if (guest) return;
    if (sp.strike && ac) { impact(ac.currentTime + 0.02); S.glitch = 1; }
    if (sp.stutter) S.stutterBar = S.bar + 1;
    const summary = await applyDirection({ ...sp.d, label: `✶ ${sp.name}` }, sp.name, sp.say);
    typewrite(termLine('regia', '', '✶ SPELL ›'), `${sp.name} → ${summary}`);
    setTimeout(updateTerm, 7000);
}

function spellsAllowed() {
    return ac && (spell.guest || (S.spells && !S.story));
}

fx.addEventListener('pointerdown', e => {
    if (!spellsAllowed()) return;
    spell.active = true;
    spell.t0 = performance.now();
    spell.pts = [{ x: e.clientX, y: e.clientY }];
});
fx.addEventListener('pointermove', e => {
    if (spell.active) spell.pts.push({ x: e.clientX, y: e.clientY });
});
const endStroke = () => {
    if (!spell.active) return;
    spell.active = false;
    const pts = spell.pts;
    spell.pts = [];
    if (pts.length < 10 || pathLen(pts) < 120 || performance.now() - spell.t0 > 4000) return;
    const r = recognize(pts);
    if (SPELLS[r.kind] && r.score >= (SPELL_MIN_SCORE[r.kind] ?? 0.78)) castSpell(r.kind, pts);
};
fx.addEventListener('pointerup', endStroke);
fx.addEventListener('pointercancel', () => { spell.active = false; spell.pts = []; });

$('#b-spells').onclick = e => toggle(e.currentTarget, 'spells');

on('draw', (fctx, w, h, dpr) => {
    // a spell being drawn leaves a golden trail; a cast spell flares and names itself
    if (spell.active && spell.pts.length > 1) {
        fctx.strokeStyle = 'rgba(255,214,120,0.7)';
        fctx.lineWidth = 3 * dpr;
        fctx.lineJoin = fctx.lineCap = 'round';
        fctx.beginPath();
        spell.pts.forEach((q, k) => k ? fctx.lineTo(q.x * dpr, q.y * dpr) : fctx.moveTo(q.x * dpr, q.y * dpr));
        fctx.stroke();
    }
    if (spell.fx) {
        const f = spell.fx;
        f.life -= 0.012;
        if (f.life <= 0) {
            spell.fx = null;
        } else {
            fctx.strokeStyle = `rgba(255,214,120,${f.life})`;
            fctx.lineWidth = (3 + (1 - f.life) * 12) * dpr;
            fctx.beginPath();
            f.pts.forEach((q, k) => k ? fctx.lineTo(q.x * dpr, q.y * dpr) : fctx.moveTo(q.x * dpr, q.y * dpr));
            fctx.stroke();
            const c = centroid(f.pts);
            fctx.font = `400 ${46 * dpr}px 'Major Mono Display', monospace`;
            fctx.fillStyle = `rgba(255,214,120,${f.life})`;
            fctx.textAlign = 'center';
            fctx.fillText(f.name.toLowerCase(), c.x * dpr, c.y * dpr);
            fctx.textAlign = 'left';
        }
    }
});

on('started', () => {
    if (loaded.has('tips')) return;
    setTimeout(() => {
        if (spellsAllowed()) toast('Try drawing a triangle while holding the mouse button.', 6000);
    }, 30000);
});
feature('spells');
