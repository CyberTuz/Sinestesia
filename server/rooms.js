// The duet's rooms, on a WebSocket at /ws?room=<code>.
// Everyone in a room publishes a small "presence" object (cursor, instrument, name, the groove playing,
// the last few actions); the server keeps each one and relays every change to the others.
// The server never interprets the music: each page checks what it receives.
//
// page → server   { t: 'p', d: patch }                  null in a patch removes that key
// server → page   { t: 'hello', id, now, peers: [{ id, p }] }   on joining: your id, the server clock, who is there
//                 { t: 'p', id, d: patch }              someone's change (their whole presence when they join)
//                 { t: 'left', id }
import { WebSocketServer } from 'ws';

const ROOM_ID = /^[a-z0-9]{4,16}$/;
const MAX_ROOMS = 1000;
const MAX_PEERS = 8;
const MAX_MESSAGE = 16 * 1024;     // bytes in one message
const MAX_PRESENCE = 32 * 1024;    // bytes in one player's whole presence
const MAX_KEYS = 24;
const RATE = 60;                   // messages a second one page may send; cursor moves alone are 25

const rooms = new Map();           // room code → Map(peer id → peer)
let lastId = 0;

const send = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function broadcast(room, fromId, msg) {
    const data = JSON.stringify(msg);
    for (const [id, peer] of room) if (id !== fromId && peer.ws.readyState === peer.ws.OPEN) peer.ws.send(data);
}

// a token bucket: a page that floods the room just has its extra messages dropped
function allow(peer) {
    const now = Date.now();
    peer.tokens = Math.min(RATE, peer.tokens + ((now - peer.last) * RATE) / 1000);
    peer.last = now;
    if (peer.tokens < 1) return false;
    peer.tokens -= 1;
    return true;
}

function merge(presence, patch) {
    const next = { ...presence };
    for (const [k, v] of Object.entries(patch)) {
        if (k === '__proto__' || k === 'constructor') continue;
        if (v === null) delete next[k];
        else next[k] = v;
    }
    return next;
}

export function attachRooms(server) {
    const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE });
    wss.on('error', () => {});

    wss.on('connection', (ws, req) => {
        const code = new URL(req.url, 'http://localhost').searchParams.get('room') || '';
        if (!ROOM_ID.test(code)) { ws.close(1008, 'bad room'); return; }
        let room = rooms.get(code);
        if (!room) {
            if (rooms.size >= MAX_ROOMS) { ws.close(1013, 'busy'); return; }
            rooms.set(code, room = new Map());
        }
        if (room.size >= MAX_PEERS) { ws.close(1013, 'room full'); return; }

        const id = (++lastId).toString(36);
        const peer = { ws, presence: {}, tokens: RATE, last: Date.now() };
        room.set(id, peer);
        ws.isAlive = true;
        send(ws, { t: 'hello', id, now: Date.now(), peers: [...room].filter(([pid]) => pid !== id).map(([pid, p]) => ({ id: pid, p: p.presence })) });

        ws.on('pong', () => { ws.isAlive = true; });
        // a broken or oversized frame: ws closes that connection itself; the error must not take the server down
        ws.on('error', () => {});
        ws.on('message', (data, isBinary) => {
            if (isBinary || !allow(peer)) return;
            let msg;
            try { msg = JSON.parse(data); } catch { return; }
            if (!isPlainObject(msg) || msg.t !== 'p' || !isPlainObject(msg.d)) return;
            const next = merge(peer.presence, msg.d);
            if (Object.keys(next).length > MAX_KEYS || JSON.stringify(next).length > MAX_PRESENCE) return;
            peer.presence = next;
            broadcast(room, id, { t: 'p', id, d: msg.d });
        });
        ws.on('close', () => {
            room.delete(id);
            if (room.size) broadcast(room, id, { t: 'left', id });
            else rooms.delete(code);
        });
    });

    // pages that vanish without closing (a laptop asleep, a lost network) are dropped after one missed ping
    const heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
            if (!ws.isAlive) { ws.terminate(); continue; }
            ws.isAlive = false;
            ws.ping();
        }
    }, 30000);
    // the HTTP server keeps the process running, not this timer
    heartbeat.unref();

    return {
        close() {
            clearInterval(heartbeat);
            for (const ws of wss.clients) ws.close(1001, 'server restarting');
            wss.close();
        }
    };
}
