// ═══════════════════════════════════════════════════════════════════════
// DUET: play with whoever opens the same link. Each page synthesizes all the sound itself;
// what travels is small: cursors, instruments, names, the groove playing and the last few actions.
// The room is a WebSocket to this site's own server (server/rooms.js).
// ═══════════════════════════════════════════════════════════════════════

import { $, S, SCALES, SCENES } from '../core/state.js';
import { feature, mode, on, stopModes } from '../core/bus.js';
import { ac, delay } from '../core/audio.js';
import { playAs, theremin } from '../core/instruments.js';
import { alignToClock, nextGridTime } from '../core/sequencer.js';
import { setDrawer, setScene, termLine, toast, typewrite, updateTerm } from '../core/hud.js';
import { fctx, fx, letters } from '../core/overlay.js';

const ROLES = ['melody', 'bells', 'voice', 'machine'];
const COLORS = ['#4ff0ff', '#ff4fd8', '#9a7bff', '#ffbe78', '#7dffb0', '#ff6b6b', '#ffe066', '#6bb7ff'];
const NAME_KEY = 'sinestesia-name';
const DUET = {
    on: false, connected: false, role: 'melody', color: '',
    seq: 0, acts: [], seen: new Map(), cursors: new Map(), bursts: [],
    grooveAt: 0, mixAt: 0, lastMix: null, moveAt: 0, tickAt: 0
};

// ── the room ──
// mine: everything this page has published, sent again whole after a reconnection
// offset: the server's clock minus ours, so both pages count bars and timestamps on the same clock
const ROOM = { code: '', ws: null, me: '', peers: new Map(), mine: {}, offset: 0, retry: 0, timer: null };

const clamp01 = v => Math.min(1, Math.max(0, Number(v) || 0));
const cleanName = s => String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
const now = () => Date.now() + ROOM.offset;
// ids are small numbers in base 36: the golden angle keeps neighbours far apart on the colour wheel
const hueOf = id => Math.round((parseInt(id, 36) || 0) * 137.508) % 360;

function loadName() {
    try { return cleanName(localStorage.getItem(NAME_KEY)); } catch (e) { return ''; }
}

// the room's code lives in the link (?duet=…), so the link is all a friend needs
function roomCode() {
    const url = new URL(location.href);
    const code = url.searchParams.get('duet');
    if (code && /^[a-z0-9]{4,16}$/.test(code)) return code;
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    const fresh = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => alphabet[b % alphabet.length]).join('');
    url.searchParams.set('duet', fresh);
    history.replaceState(null, '', url);
    return fresh;
}

function send(msg) {
    if (ROOM.ws?.readyState === WebSocket.OPEN) ROOM.ws.send(JSON.stringify(msg));
}

function publish(patch) {
    if (!DUET.on) return;
    for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete ROOM.mine[k];
        else ROOM.mine[k] = v;
    }
    send({ t: 'p', d: patch });
}

function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?room=${ROOM.code}`);
    ROOM.ws = ws;
    ws.onmessage = e => {
        let m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.t === 'hello') {
            ROOM.retry = 0;
            ROOM.me = String(m.id);
            ROOM.offset = Number(m.now) ? Number(m.now) - Date.now() : 0;
            ROOM.peers = new Map((Array.isArray(m.peers) ? m.peers : []).map(p => [String(p.id), p.p || {}]));
            DUET.connected = true;
            send({ t: 'p', d: ROOM.mine });
            alignToClock(ROOM.offset);
            peersChanged([]);
        } else if (m.t === 'p') {
            const pr = { ...(ROOM.peers.get(String(m.id)) || {}) };
            for (const [k, v] of Object.entries(m.d || {})) {
                if (v === null) delete pr[k];
                else pr[k] = v;
            }
            ROOM.peers.set(String(m.id), pr);
            peersChanged([]);
        } else if (m.t === 'left') {
            ROOM.peers.delete(String(m.id));
            peersChanged([String(m.id)]);
        }
    };
    ws.onclose = e => {
        if (ROOM.ws !== ws) return;
        ROOM.ws = null;
        DUET.connected = false;
        ROOM.peers.clear();
        peersChanged([...DUET.cursors.keys()]);
        if (!DUET.on) return;
        if (e.code === 1013) { toast('This duet is full: eight players at most.'); stopDuet(); return; }
        // the server restarted or the network dropped: try again, waiting a little longer each time
        if (++ROOM.retry === 3) toast('The duet cannot reach its server. It needs the Sinestesia server (npm start), not a plain file server.', 8000);
        ROOM.timer = setTimeout(connect, Math.min(10000, 1000 * 2 ** ROOM.retry));
    };
}

// ── what travels ──
function act(k, data = {}) {
    if (!DUET.on) return;
    DUET.acts.push({ s: ++DUET.seq, k, ...data });
    if (DUET.acts.length > 12) DUET.acts.shift();
    publish({ acts: DUET.acts });
}

// a groove travels compactly: steps as numbers, the hook as offsets from the root
const encSteps = steps => steps.map(s => (s.gate ? s.note + 1 : 0) + (s.gate && s.accent ? 100 : 0) + (s.gate && s.slide ? 200 : 0));
function decSteps(arr) {
    return Array.from({ length: 16 }, (_, i) => {
        const v = Math.max(0, Math.min(399, Math.round(Number(arr?.[i]) || 0)));
        const base = v % 100;
        return { gate: base > 0, note: Math.max(0, base - 1), accent: v % 200 >= 100, slide: v >= 200, deg: 0, oct: 0, byte: 0 };
    });
}

function publishGroove(p, at = now()) {
    if (at) DUET.grooveAt = at;
    publish({
        groove: {
            at,
            label: String(p.label || p.text).slice(0, 80),
            text: String(p.text).slice(0, 80),
            hex: String(p.hex).slice(0, 64),
            scale: p.scaleName,
            root: p.root,
            steps: encSteps(p.steps),
            hook: (p.hook || []).slice(0, 32).map(m => (m === null ? -1 : m - p.root)),
            chars: (p.chars || []).slice(0, 32).map(c => String(c).slice(0, 4))
        }
    });
}

// what arrives from another page is untrusted: everything is checked and bounded
function applyRemoteGroove(g) {
    const scale = SCALES[g.scale];
    if (!scale || !Array.isArray(g.steps)) return;
    const hex = /^[0-9a-f]{64}$/.test(g.hex) ? g.hex : '0'.repeat(64);
    const root = Math.min(48, Math.max(24, Math.round(Number(g.root)) || 33));
    const chars = (Array.isArray(g.chars) ? g.chars : []).slice(0, 32).map(c => String(c).slice(0, 4) || '·');
    const hook = (Array.isArray(g.hook) ? g.hook : []).slice(0, 32)
        .map(v => (typeof v === 'number' && v >= 0 && v < 72 ? root + Math.round(v) : null));
    while (chars.length < hook.length) chars.push('·');
    S.pending = {
        text: String(g.text || '').slice(0, 80), hex, real: true, scaleName: g.scale, scale, root,
        bytes: new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16))),
        steps: decSteps(g.steps), chars, hook,
        label: `👥 ${String(g.label || g.text || '').slice(0, 80)}`,
        remote: true
    };
}

function adoptMix(m) {
    const bpm = Math.min(160, Math.max(90, Math.round(Number(m.bpm)) || Math.round(S.bpm)));
    if (bpm !== Math.round(S.bpm)) {
        S.bpm = bpm;
        $('#bpm').value = bpm;
        $('#bpm-o').textContent = bpm;
        if (ac) delay.delayTime.setTargetAtTime((60 / bpm) * 0.75, ac.currentTime, 0.2);
        alignToClock(ROOM.offset);
    }
    const sc = Number(m.scene);
    if (Number.isInteger(sc) && sc >= 0 && sc < SCENES.length && sc !== S.scene) setScene(sc);
    if (['techno', 'dub', 'break', 'ambient', 'numbers', 'silence'].includes(m.style)) S.style = m.style;
    DUET.lastMix = { bpm: Math.round(S.bpm), scene: S.scene, style: S.style };
}

function remoteAct(c, a) {
    if (!ac || S.paused || !a) return;
    if (a.k === 'n' && typeof a.m === 'number') {
        const m = Math.min(110, Math.max(24, Math.round(a.m)));
        const ch = String(a.c || '♪').slice(0, 2);
        playAs(c.role, m, nextGridTime(), ch);
        letters.push({ ch, x: (c.x ?? 0.5) * fx.width, y: (c.y ?? 0.5) * fx.height, vx: (Math.random() - 0.5) * 1.2, vy: -0.6 - Math.random() * 0.6, rot: (Math.random() - 0.5) * 0.5, hue: c.hue, scale: 0.7, life: 1 });
        if (letters.length > 60) letters.shift();
    } else if (a.k === 's') {
        DUET.bursts.push({ x: c.x ?? 0.5, y: c.y ?? 0.5, name: String(a.name || '').slice(0, 16), color: c.color, life: 1 });
        S.flash = Math.max(S.flash, 0.6);
    } else if (a.k === 'd') {
        S.dropNow = true;
    } else if (a.k === 'p') {
        typewrite(termLine('lei', '', `${(c.name || 'guest').toUpperCase()} ›`), String(a.text || '').slice(0, 80));
        setTimeout(updateTerm, 12000);
    }
}

// someone joined, changed or left: update their cursor, play their new actions, take the newest groove and mix
function peersChanged(left) {
    for (const id of left) { DUET.cursors.delete(id); DUET.seen.delete(id); }
    for (const [id, pr] of ROOM.peers) {
        if (!pr.duet) { DUET.cursors.delete(id); DUET.seen.delete(id); continue; }
        let c = DUET.cursors.get(id);
        if (!c) {
            c = { trail: [], role: 'melody', hue: hueOf(id), color: `hsl(${hueOf(id)}, 100%, 65%)`, name: '' };
            DUET.cursors.set(id, c);
        }
        if (typeof pr.x === 'number' && typeof pr.y === 'number') { c.x = clamp01(pr.x); c.y = clamp01(pr.y); }
        c.th = !!pr.th;
        c.role = ROLES.includes(pr.role) ? pr.role : 'melody';
        if (/^#[0-9a-f]{6}$/i.test(pr.color || '')) c.color = pr.color;
        c.name = cleanName(pr.name);
        // their actions since we last looked; on first sight, history is skipped
        const acts = Array.isArray(pr.acts) ? pr.acts : [];
        const top = acts.reduce((mx, a) => Math.max(mx, Number(a?.s) || 0), 0);
        if (!DUET.seen.has(id)) {
            DUET.seen.set(id, top);
        } else {
            const last = DUET.seen.get(id);
            for (const a of acts) if ((Number(a?.s) || 0) > last) remoteAct(c, a);
            DUET.seen.set(id, Math.max(last, top));
        }
        // shared groove and mix: the most recent change wins
        if (pr.groove && Number(pr.groove.at) > DUET.grooveAt) {
            DUET.grooveAt = Number(pr.groove.at);
            applyRemoteGroove(pr.groove);
        }
        if (pr.mix && Number(pr.mix.at) > DUET.mixAt) {
            DUET.mixAt = Number(pr.mix.at);
            adoptMix(pr.mix);
        }
    }
    renderDuet();
}

function renderDuet() {
    const box = $('#du-people');
    box.innerHTML = '';
    const person = (name, role, color, me) => {
        const el = document.createElement('span');
        el.className = 'du-person' + (me ? ' me' : '');
        const dot = document.createElement('i');
        dot.style.background = color;
        const tx = document.createElement('span');
        tx.textContent = `${name} · ${role}`;
        el.append(dot, tx);
        box.appendChild(el);
    };
    person(cleanName($('#du-name').value) || 'you', DUET.role, DUET.color || 'var(--cool)', true);
    for (const c of DUET.cursors.values()) person(c.name || 'guest', c.role, c.color, false);
    const n = DUET.cursors.size;
    $('#du-state').textContent = !DUET.connected ? 'connecting…' : n ? `${n + 1} in the duet` : 'just you, for now';
    $('#du-hint').hidden = n > 0;
    document.querySelectorAll('#du-roles .chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.role === DUET.role)));
}

function startDuet() {
    if (!ac) { toast('Press Play first.'); return; }
    stopModes('story', 'journey');
    S.intro = null;
    DUET.on = true;
    S.role = DUET.role;
    DUET.seen.clear();
    DUET.cursors.clear();
    DUET.grooveAt = 0;
    DUET.mixAt = 0;
    DUET.lastMix = { bpm: Math.round(S.bpm), scene: S.scene, style: S.style };
    DUET.color ||= COLORS[Math.floor(Math.random() * COLORS.length)];
    ROOM.code = roomCode();
    ROOM.mine = {};
    ROOM.retry = 0;
    $('#du-link').value = location.href;
    // a newcomer joins with old timestamps, so it takes on the groove already playing
    publish({
        duet: true, role: DUET.role, color: DUET.color, name: cleanName($('#du-name').value),
        x: S.mouse[0], y: S.mouse[1], th: 0, acts: DUET.acts,
        mix: { ...DUET.lastMix, at: 0 }
    });
    publishGroove(S.pattern, 0);
    connect();
    $('#duet').hidden = false;
    $('#b-duet').setAttribute('aria-pressed', 'true');
    renderDuet();
}

function stopDuet() {
    DUET.on = false;
    clearTimeout(ROOM.timer);
    const ws = ROOM.ws;
    ROOM.ws = null;
    ws?.close();
    ROOM.peers.clear();
    DUET.connected = false;
    S.role = 'melody';
    DUET.cursors.clear();
    DUET.bursts = [];
    $('#duet').hidden = true;
    $('#b-duet').setAttribute('aria-pressed', 'false');
}

// local changes of tempo, scene or genre are shared a couple of times a second
function duetTick() {
    if (!DUET.on) return;
    const t = performance.now();
    if (t - DUET.tickAt < 400) return;
    DUET.tickAt = t;
    const cur = { bpm: Math.round(S.bpm), scene: S.scene, style: S.style };
    const last = DUET.lastMix;
    if (!last || last.bpm !== cur.bpm || last.scene !== cur.scene || last.style !== cur.style) {
        if (last && last.bpm !== cur.bpm) alignToClock(ROOM.offset);
        DUET.lastMix = cur;
        DUET.mixAt = now();
        publish({ mix: { ...cur, at: DUET.mixAt } });
    }
}

window.addEventListener('pointermove', e => {
    if (!DUET.on) return;
    const t = performance.now();
    if (t - DUET.moveAt < 40) return;
    DUET.moveAt = t;
    publish({ x: +(e.clientX / innerWidth).toFixed(3), y: +(e.clientY / innerHeight).toFixed(3), th: theremin ? 1 : 0 });
}, { passive: true });

$('#b-duet').onclick = () => {
    setDrawer(false);
    if (DUET.on) stopDuet(); else startDuet();
};

document.querySelectorAll('#du-roles .chip').forEach(b => {
    b.onclick = () => {
        DUET.role = b.dataset.role;
        if (DUET.on) S.role = DUET.role;
        publish({ role: DUET.role });
        renderDuet();
    };
});

// your name is kept in this browser and shown to the others as you type it
$('#du-name').value = loadName();
$('#du-name').addEventListener('input', e => {
    const name = cleanName(e.target.value);
    try { localStorage.setItem(NAME_KEY, name); } catch (err) { /* the name is a nicety */ }
    publish({ name });
    renderDuet();
});

$('#du-copy').onclick = () => {
    const field = $('#du-link');
    navigator.clipboard?.writeText(field.value)
        .then(() => toast('Link copied: send it to a friend.'))
        .catch(() => { field.select(); toast('Select the link and copy it.'); });
};

// the other players: comets that leave a trail, their name and instrument beside them
function drawDuet(w, h, dpr) {
    if (!DUET.on) return;
    for (const c of DUET.cursors.values()) {
        if (typeof c.x !== 'number') continue;
        const x = c.x * w, y = c.y * h;
        c.trail.push({ x, y });
        if (c.trail.length > 18) c.trail.shift();
        fctx.strokeStyle = c.color;
        fctx.lineCap = 'round';
        for (let k = 1; k < c.trail.length; k++) {
            const a = k / c.trail.length;
            fctx.globalAlpha = a * 0.7;
            fctx.lineWidth = (1 + a * 5) * dpr;
            fctx.beginPath();
            fctx.moveTo(c.trail[k - 1].x, c.trail[k - 1].y);
            fctx.lineTo(c.trail[k].x, c.trail[k].y);
            fctx.stroke();
        }
        const r = (c.th ? 14 + Math.sin(performance.now() / 120) * 4 : 7) * dpr;
        fctx.globalAlpha = 0.35;
        fctx.fillStyle = c.color;
        fctx.beginPath();
        fctx.arc(x, y, r * 2, 0, Math.PI * 2);
        fctx.fill();
        fctx.globalAlpha = 0.95;
        fctx.beginPath();
        fctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
        fctx.fill();
        fctx.font = `600 ${11 * dpr}px 'JetBrains Mono', monospace`;
        fctx.fillText(`${c.name || 'guest'} · ${c.role}`, x + 14 * dpr, y - 10 * dpr);
        fctx.globalAlpha = 1;
    }
    for (let i = DUET.bursts.length - 1; i >= 0; i--) {
        const b = DUET.bursts[i];
        b.life -= 0.012;
        if (b.life <= 0) { DUET.bursts.splice(i, 1); continue; }
        fctx.globalAlpha = b.life;
        fctx.fillStyle = b.color;
        fctx.font = `400 ${46 * dpr}px 'Major Mono Display', monospace`;
        fctx.textAlign = 'center';
        fctx.fillText(b.name.toLowerCase(), b.x * w, b.y * h);
        fctx.textAlign = 'left';
        fctx.globalAlpha = 1;
    }
}

// what you do travels to the others: your notes, your phrases, your spells and drops, each new groove
on('note', (m, t, ch) => act('n', { m, c: ch }));
on('phrase', text => act('p', { text: text.slice(0, 80) }));
on('spell', name => act('s', { name }));
on('drop', () => act('d'));
on('pattern', p => { if (DUET.on && !p.remote) publishGroove(p); });
on('frame', duetTick);
on('draw', (fctx, w, h, dpr) => drawDuet(w, h, dpr));
on('status', () => (DUET.on ? `👥 ${DUET.cursors.size + 1}` : null));
// opening a duet link joins that duet as soon as you press Play
on('started', () => { if (new URLSearchParams(location.search).has('duet')) startDuet(); });
mode('duet', () => { if (DUET.on) stopDuet(); });
feature('duet');
