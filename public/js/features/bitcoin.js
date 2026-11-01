// ── Bitcoin: every new block becomes the groove, every transaction a note ──

import { $, S } from '../core/state.js';
import { feature, on } from '../core/bus.js';
import { buildPattern, degreeMidi, sha256 } from '../core/pattern.js';
import { ac, pad } from '../core/audio.js';
import { choir } from '../core/voices.js';
import { bell, impact, lead } from '../core/instruments.js';
import { hookVisuals, nextGridTime, queuePattern } from '../core/sequencer.js';
import { toast } from '../core/hud.js';
import { fx, sparks } from '../core/overlay.js';

const BTC = { on: false, live: false, sockets: [], sim: null, height: null, lastBlock: Date.now(), txTimes: [], lastNote: 0, mempool: null, fee: null, uiAt: 0, failTimer: null };

function setBlockchain(on) {
    BTC.on = on;
    $('#b-btc').setAttribute('aria-pressed', String(on));
    $('#btc').hidden = !on;
    if (on) {
        BTC.height = null;
        BTC.lastBlock = Date.now();
        connectLive();
        return;
    }
    BTC.sockets.forEach(s => { s.onclose = s.onerror = null; try { s.close(); } catch (e) {} });
    BTC.sockets = [];
    clearInterval(BTC.sim);
    clearTimeout(BTC.failTimer);
    BTC.sim = null;
    BTC.live = false;
    if (ac) pad.filt.frequency.setTargetAtTime(900, ac.currentTime, 1);
}

function connectLive() {
    let opened = false;
    try {
        const ws = new WebSocket('wss://ws.blockchain.info/inv');
        BTC.sockets.push(ws);
        ws.onopen = () => {
            opened = true;
            BTC.live = true;
            ws.send(JSON.stringify({ op: 'unconfirmed_sub' }));
            ws.send(JSON.stringify({ op: 'blocks_sub' }));
            toast('Connected to the Bitcoin network: you are hearing real transactions.');
        };
        ws.onmessage = e => {
            let m;
            try { m = JSON.parse(e.data); } catch (err) { return; }
            if (m.op === 'utx') onTx(parseUtx(m.x));
            else if (m.op === 'block') onBlock({ hash: m.x.hash, height: m.x.height, nTx: m.x.nTx, time: m.x.time });
        };
        ws.onclose = ws.onerror = () => {
            if (!BTC.on) return;
            BTC.live = false;
            if (opened) toast('Connection lost: switching to the simulation.');
            startSim();
        };
    } catch (e) {
        startSim();
    }
    // mempool.space adds fees, mempool size and the current chain tip
    try {
        const mp = new WebSocket('wss://mempool.space/api/v1/ws');
        BTC.sockets.push(mp);
        mp.onopen = () => {
            mp.send(JSON.stringify({ action: 'init' }));
            mp.send(JSON.stringify({ action: 'want', data: ['blocks', 'stats'] }));
        };
        mp.onmessage = e => {
            let m;
            try { m = JSON.parse(e.data); } catch (err) { return; }
            if (m.fees) BTC.fee = m.fees.fastestFee;
            if (m.mempoolInfo) BTC.mempool = m.mempoolInfo.size;
            if (Array.isArray(m.blocks) && m.blocks.length && BTC.height === null) {
                const tip = m.blocks.reduce((a, b) => (b.height > a.height ? b : a));
                onBlock({ hash: tip.id, height: tip.height, nTx: tip.tx_count, time: tip.timestamp }, true);
            }
            if (m.block) onBlock({ hash: m.block.id, height: m.block.height, nTx: m.block.tx_count, time: m.block.timestamp });
        };
        mp.onerror = () => {};
    } catch (e) { /* fees are optional */ }
    BTC.failTimer = setTimeout(() => { if (BTC.on && !BTC.live) startSim(); }, 4000);
}

function parseUtx(x) {
    const out = (x.out || []).reduce((s, o) => s + (o.value || 0), 0);
    const inp = (x.inputs || []).reduce((s, i) => s + ((i.prev_out && i.prev_out.value) || 0), 0);
    const fee = Math.max(0, inp - out);
    return { value: out / 1e8, feeRate: x.size ? fee / x.size : 0 };
}

function onTx(tx) {
    const now = performance.now();
    BTC.txTimes.push(now);
    while (BTC.txTimes.length && now - BTC.txTimes[0] > 60000) BTC.txTimes.shift();

    const dpr = fx.width / innerWidth;
    const hue = Math.min(300, tx.feeRate * 6);
    sparks.push({ x: Math.random() * fx.width, y: Math.random() * fx.height * 0.8, vx: 0, vy: -1.5 * dpr * 0.5, life: 1, hue });
    if (sparks.length > 200) sparks.shift();

    // at most ~8 notes a second, so a busy mempool stays musical
    if (!ac || S.paused || now - BTC.lastNote < 120) return;
    BTC.lastNote = now;
    const p = S.pattern, len = p.scale.length;
    // small amounts sing high, big ones low
    const lv = Math.log10(Math.max(1e-5, tx.value));
    const deg = Math.max(0, Math.min(len * 3 - 1, Math.round(((2 - lv) / 7) * len * 3)));
    const midi = p.root + 24 + 12 * Math.floor(deg / len) + p.scale[deg % len];
    const t = nextGridTime();
    if (tx.value >= 10) {
        lead(midi, t, 1);
        hookVisuals.push({ t, ch: '₿' });
        S.flash = 1;
    } else if (tx.feeRate > 60) {
        lead(midi + 12, t, 0.5);
    } else {
        bell(midi + 12, t);
    }
}

async function onBlock(b, initial = false, simulated = false) {
    if (!b.hash || (BTC.height !== null && b.height <= BTC.height)) return;
    BTC.height = b.height;
    BTC.lastBlock = b.time ? b.time * 1000 : Date.now();
    const { bytes, real } = await sha256(b.hash);
    const p = buildPattern(bytes, real, `block ${b.height}`);
    const body = b.hash.replace(/^0+/, '');
    const zeros = b.hash.length - body.length;
    // the hash itself sings: its hex digits after the leading zeros are the hook
    p.chars = body.slice(0, 32).split('');
    p.hook = p.chars.map(c => parseInt(c, 16) === 0 ? null : degreeMidi(p, parseInt(c, 16)));
    p.vowelChars = ['a', 'o'];
    p.hex = b.hash;
    p.label = `₿ block ${b.height.toLocaleString('en-US')} · ${b.nTx ?? '?'} tx · ${zeros} leading zeros${simulated ? ' · simulated' : ''}`;
    queuePattern(p);
    if (!initial && ac) {
        impact(ac.currentTime + 0.05);
        if (S.voices) choir(ac.currentTime + 0.1);
        toast(`New block ${b.height.toLocaleString('en-US')}: the groove is now its hash.`);
    }
}

function gauss() {
    return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

function randomHex(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
}

// stand-in when the page cannot reach the network: realistic statistics, blocks sped up
function startSim() {
    if (BTC.sim || !BTC.on) return;
    BTC.live = false;
    toast('Simulation mode: the published page cannot reach the internet. Open the HTML file from your computer to hear Bitcoin live.', 8000);
    let height = 960000 + Math.floor(Math.random() * 5000);
    const block = () => ({ hash: '0000000000000000000' + randomHex(45), height: height++, nTx: 2500 + Math.floor(Math.random() * 2000), time: Date.now() / 1000 });
    BTC.height = null;
    onBlock(block(), true, true);
    BTC.mempool = 30000 + Math.floor(Math.random() * 40000);
    BTC.fee = 4 + Math.floor(Math.random() * 12);
    let nextBlockAt = performance.now() + 45000;
    BTC.sim = setInterval(() => {
        // Poisson arrivals, about 6 transactions a second
        let k = 0, prod = Math.random();
        const limit = Math.exp(-0.6);
        while (prod > limit) { k++; prod *= Math.random(); }
        for (let i = 0; i < k; i++) {
            const value = Math.random() < 0.004 ? 10 + Math.random() * 200 : Math.exp(gauss() * 2.2 - 2.5);
            onTx({ value, feeRate: Math.exp(gauss() * 0.8 + 1.8) });
        }
        BTC.mempool = Math.max(2000, BTC.mempool + Math.round(gauss() * 40));
        if (performance.now() > nextBlockAt) {
            onBlock(block(), false, true);
            BTC.mempool = Math.max(2000, BTC.mempool - 3000);
            nextBlockAt = performance.now() + (60 + Math.random() * 120) * 1000;
        }
    }, 100);
}

function btcTick() {
    if (!BTC.on) return;
    const now = performance.now();
    if (now - BTC.uiAt < 1000) return;
    BTC.uiAt = now;
    const age = Math.max(0, (Date.now() - BTC.lastBlock) / 1000);
    // tension builds while the network searches for the next block
    const tension = Math.min(1, age / (BTC.live ? 600 : 150));
    if (ac) pad.filt.frequency.setTargetAtTime(700 + tension * 2600, ac.currentTime, 0.8);
    $('#btc-source').textContent = BTC.live ? 'Live' : BTC.sim ? 'Simulation' : 'Connecting…';
    $('#btc-height').textContent = BTC.height === null ? '…' : BTC.height.toLocaleString('en-US');
    $('#btc-age').textContent = `${Math.floor(age / 60)}:${String(Math.floor(age % 60)).padStart(2, '0')}`;
    $('#btc-tx').textContent = BTC.txTimes.length;
    $('#btc-mempool').textContent = BTC.mempool ? BTC.mempool.toLocaleString('en-US') : '–';
    $('#btc-fee').textContent = BTC.fee ? BTC.fee + ' sat/vB' : '–';
    $('#btc-tension').style.width = tension * 100 + '%';
}

$('#b-btc').onclick = () => setBlockchain(!BTC.on);

on('frame', btcTick);
feature('bitcoin');
