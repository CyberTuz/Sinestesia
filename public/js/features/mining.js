// ── Proof-of-Drop: a drop that has to be mined, like a Bitcoin block (the story uses it to open her memory) ──
// The miner runs in a worker with its own SHA-256, so the music never stutters.

import { $, S, SCENES, fmtInt } from '../core/state.js';
import { actions, emit, feature, mode, on, stopModes } from '../core/bus.js';
import { buildPattern, degreeMidi, sha256 } from '../core/pattern.js';
import { ac, fxSend, master, noiseBuf } from '../core/audio.js';
import { bell, hat } from '../core/instruments.js';
import { nextGridTime, stepDur } from '../core/sequencer.js';
import { setScene, termLine, toast, typewrite, updateTerm } from '../core/hud.js';
import { fx, tokens } from '../core/overlay.js';

const MINER_SRC = `
const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const W = new Int32Array(64);
const H = new Int32Array(8);
const buf = new Uint8Array(320);
const dv = new DataView(buf.buffer);

function sha256(len) {
  const padded = ((len + 9 + 63) >> 6) << 6;
  buf[len] = 0x80;
  buf.fill(0, len + 1, padded);
  dv.setUint32(padded - 4, len * 8);
  let h0 = 0x6a09e667 | 0, h1 = 0xbb67ae85 | 0, h2 = 0x3c6ef372 | 0, h3 = 0xa54ff53a | 0;
  let h4 = 0x510e527f | 0, h5 = 0x9b05688c | 0, h6 = 0x1f83d9ab | 0, h7 = 0x5be0cd19 | 0;
  for (let off = 0; off < padded; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getInt32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15], y = W[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  H[0] = h0; H[1] = h1; H[2] = h2; H[3] = h3; H[4] = h4; H[5] = h5; H[6] = h6; H[7] = h7;
}

function zeros() {
  for (let i = 0; i < 8; i++) if (H[i] !== 0) return i * 32 + Math.clz32(H[i]);
  return 256;
}

function hex() {
  let s = '';
  for (let i = 0; i < 8; i++) s += (H[i] >>> 0).toString(16).padStart(8, '0');
  return s;
}

onmessage = e => {
  const prefix = new TextEncoder().encode(e.data.prefix).slice(0, 200);
  const plen = prefix.length;
  buf.set(prefix);
  const T = e.data.seconds;
  let bits = 0, nonce = 0, hashes = 0, best = -1, bestHex = '', bestNonce = 0;
  const t0 = performance.now();
  const loop = () => {
    const until = performance.now() + 60;
    while (performance.now() < until) {
      for (let k = 0; k < 1000; k++) {
        const s = String(nonce);
        for (let i = 0; i < s.length; i++) buf[plen + i] = s.charCodeAt(i);
        sha256(plen + s.length);
        hashes++;
        const z = zeros();
        if (z > best) { best = z; bestHex = hex(); bestNonce = nonce; postMessage({ type: 'record', best: z, hex: bestHex, nonce }); }
        nonce++;
      }
    }
    const el = (performance.now() - t0) / 1000;
    const rate = hashes / el;
    if (!bits && el > 0.4) {
      bits = Math.max(12, Math.min(30, Math.round(Math.log2(rate * T))));
      postMessage({ type: 'bits', bits, rate });
    }
    // like Bitcoin's difficulty adjustment, the target eases off when luck runs late
    if (bits && el > 2 * T) {
      const eased = Math.max(8, bits - 1 - Math.floor((el - 2 * T) / (T / 2)));
      if (eased < bits) { bits = eased; postMessage({ type: 'bits', bits, rate, eased: true }); }
    }
    if (bits && best >= bits) {
      postMessage({ type: 'found', nonce: bestNonce, hex: bestHex, zeros: best, hashes, seconds: el });
      return;
    }
    postMessage({ type: 'progress', hashes, rate, sample: hex() });
    setTimeout(loop, 0);
  };
  loop();
};
`;

const MINE = { on: false, bits: 0, best: 0, bestHex: '', hashes: 0, rate: 0, phrase: '', prefix: '' };
let miner = null, mineNoise = null;

const mineProgress = () => MINE.bits ? Math.min(1, MINE.best / MINE.bits) : 0;

function startMineNoise() {
    const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 4; bp.frequency.value = 300;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.setTargetAtTime(0.03, ac.currentTime, 0.5);
    src.connect(bp); bp.connect(g); g.connect(master); g.connect(fxSend);
    src.start();
    mineNoise = { src, bp, g };
}

function startMining() {
    if (miner) { stopMining(true); return; }
    if (!ac) { toast('Press Play first.'); return; }
    const phrase = String(S.lastPhrase || S.pattern.text || 'sinestesia').slice(0, 60);
    let w, url;
    try {
        url = URL.createObjectURL(new Blob([MINER_SRC], { type: 'text/javascript' }));
        w = new Worker(url);
    } catch (e) {
        toast('This browser does not allow mining in the background.');
        return;
    }
    miner = w;
    stopModes('journey');
    S.intro = null;
    Object.assign(MINE, { on: true, bits: 0, best: 0, bestHex: '', hashes: 0, rate: 0, phrase, prefix: phrase + ' #' });
    w.onmessage = e => { if (url) { URL.revokeObjectURL(url); url = null; } onMiner(e.data); };
    w.onerror = () => { toast('Mining stopped unexpectedly.'); stopMining(true); };
    w.postMessage({ prefix: MINE.prefix, seconds: 16 });
    // tension: the kick goes quiet and a riser follows the best hash so far
    S.drums = false;
    $('#b-drums').setAttribute('aria-pressed', 'false');
    startMineNoise();
    setScene(SCENES.indexOf('Network'));
    typewrite(termLine('macchina', ''), `mining: looking for a nonce so that SHA-256("${MINE.prefix}" + nonce) starts with enough zeros`);
}

function stopMining(cancelled) {
    if (miner) { miner.terminate(); miner = null; }
    MINE.on = false;
    if (mineNoise) {
        const t = ac.currentTime;
        mineNoise.g.gain.cancelScheduledValues(t);
        mineNoise.g.gain.setTargetAtTime(0.0001, t, 0.05);
        mineNoise.src.stop(t + 0.4);
        mineNoise = null;
    }
    if (cancelled) {
        S.drums = true;
        $('#b-drums').setAttribute('aria-pressed', 'true');
    }
    updateTerm();
}

async function onMiner(m) {
    if (!MINE.on) return;
    if (m.type === 'bits') {
        MINE.bits = m.bits;
        typewrite(termLine('macchina', ''), m.eased
            ? `luck is running late: lowering the difficulty to ${m.bits} bits`
            : `difficulty: ${m.bits} zero bits, about ${fmtInt(2 ** m.bits)} tries at ${fmtInt(m.rate / 1000)} thousand hashes a second`);
    } else if (m.type === 'record') {
        MINE.best = m.best;
        MINE.bestHex = m.hex;
        // every new record climbs one step of the scale
        if (m.best >= 10 && ac) {
            bell(degreeMidi(S.pattern, m.best - 6) + 12, nextGridTime());
            S.flash = Math.max(S.flash, 0.4);
        }
    } else if (m.type === 'progress') {
        MINE.hashes = m.hashes;
        MINE.rate = m.rate;
        if (mineNoise) {
            const p = mineProgress();
            mineNoise.bp.frequency.setTargetAtTime(300 * Math.pow(2, p * 4.5), ac.currentTime, 0.3);
            mineNoise.g.gain.setTargetAtTime(0.03 + p * 0.17, ac.currentTime, 0.3);
        }
        const dpr = fx.width / innerWidth;
        tokens.push({ text: m.sample.slice(0, 16), x: Math.random() * fx.width * 0.9, y: -20 * dpr, vy: 1.4 + Math.random(), life: 1, size: 11 + Math.random() * 4, color: '120,255,170' });
        if (tokens.length > 160) tokens.shift();
    } else if (m.type === 'found') {
        const phrase = MINE.phrase, prefix = MINE.prefix;
        stopMining(false);
        // check the worker's hash against the browser's own SHA-256
        const { bytes: check } = await sha256(prefix + m.nonce);
        const verified = Array.from(check, b => b.toString(16).padStart(2, '0')).join('') === m.hex;
        const bytes = new Uint8Array(m.hex.match(/../g).map(h => parseInt(h, 16)));
        const p = buildPattern(bytes, true, `${phrase} #${m.nonce}`);
        p.chars = m.hex.replace(/^0+/, '').slice(0, 32).split('');
        p.hook = p.chars.map(c => parseInt(c, 16) === 0 ? null : degreeMidi(p, parseInt(c, 16)));
        p.vowelChars = [...phrase];
        p.hex = m.hex;
        p.label = `⛏ “${phrase}” · nonce ${fmtInt(m.nonce)} · ${m.zeros} zero bits${verified ? ' · verified' : ''}`;
        S.pending = p;
        S.dropNow = true;
        S.dropScene = SCENES.indexOf('Cathedral');
        emit('drop');
        typewrite(termLine('macchina', ''), `found: nonce ${fmtInt(m.nonce)} → ${m.hex.slice(0, 20)}… after ${fmtInt(m.hashes)} hashes in ${m.seconds.toFixed(1)} s`);
        toast(`Drop mined: ${m.zeros} zero bits after ${fmtInt(m.hashes)} tries.`);
        emit('mined', { nonce: m.nonce, zeros: m.zeros, hex: m.hex });
    }
}

// while mining, the hats roll faster as the best hash gets closer to the target
on('step', (i, t) => {
    if (!MINE.on) return;
    const pr = mineProgress();
    hat(t, false, 0.2 + pr * 0.8);
    if (pr > 0.6) hat(t + stepDur() / 2, false, pr * 0.5);
});
on('term', () => MINE.on);
on('draw', (fctx, w, h, dpr) => {
    // mining readout: the best hash so far, its leading zeros in pink
    if (MINE.on) {
        const size = Math.min(38 * dpr, w / 18);
        const best = (MINE.bestHex || '').slice(0, 24);
        const zc = (best.match(/^0*/) || [''])[0].length;
        const y = h * 0.4;
        fctx.font = `600 ${size}px 'JetBrains Mono', monospace`;
        const full = fctx.measureText(best + '…').width;
        let x = w / 2 - full / 2;
        fctx.fillStyle = 'rgba(255,79,216,0.95)';
        fctx.fillText(best.slice(0, zc), x, y);
        x += fctx.measureText(best.slice(0, zc)).width;
        fctx.fillStyle = 'rgba(243,240,255,0.85)';
        fctx.fillText(best.slice(zc) + '…', x, y);
        fctx.font = `500 ${size * 0.38}px 'JetBrains Mono', monospace`;
        fctx.fillStyle = 'rgba(120,255,170,0.9)';
        const stats = `${fmtInt(MINE.hashes)} hashes · best ${MINE.best} of ${MINE.bits || '…'} zero bits`;
        fctx.fillText(stats, w / 2 - fctx.measureText(stats).width / 2, y + size * 0.9);
        const bw = Math.max(full, w * 0.3), bx = w / 2 - bw / 2;
        fctx.fillStyle = 'rgba(243,240,255,0.15)';
        fctx.fillRect(bx, y + size * 1.25, bw, 3 * dpr);
        fctx.fillStyle = 'rgba(255,79,216,0.9)';
        fctx.fillRect(bx, y + size * 1.25, bw * mineProgress(), 3 * dpr);
    }
});
mode('mining', () => { if (MINE.on) stopMining(true); });
actions.mine = startMining;
feature('mining');
