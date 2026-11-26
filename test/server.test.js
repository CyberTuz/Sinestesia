// The server on its own: the static files and their headers, the health check, and the duet's rooms.
// Run with `npm test`.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { request } from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server/app.js';

// one server on a free port for the whole file
const app = createApp();
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const { port } = app.server.address();
const base = `http://127.0.0.1:${port}`;
const wsBase = `ws://127.0.0.1:${port}/ws`;
// once the tests are done, the server must not keep the process alive
app.server.unref();

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// a request with the headers as given (fetch sets Host itself, and unpacks bodies): the status, the headers, the raw bytes
const ask = (path, headers = {}) => new Promise((resolve, reject) => {
    request(`${base}${path}`, { headers }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks) }));
    }).on('error', reject).end();
});

describe('static files', () => {
    test('the page is served with its security headers', async () => {
        const res = await fetch(`${base}/`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type'), /^text\/html/);
        const csp = res.headers.get('content-security-policy');
        assert.match(csp, /default-src 'self'/);
        assert.match(csp, /font-src 'self'/);
        assert.doesNotMatch(csp, /google/);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.match(await res.text(), /<title>Sinestesia<\/title>/);
    });

    test('the page loads nothing from other hosts but the Bitcoin feeds', async () => {
        const html = await (await fetch(`${base}/`)).text();
        const css = await (await fetch(`${base}/css/style.css`)).text();
        // what the page loads: scripts, images, stylesheets, fonts, icons (a link to click is not loaded)
        assert.doesNotMatch(html, /src="https?:/);
        assert.doesNotMatch(html, /<link[^>]*href="https?:/);
        assert.doesNotMatch(css, /url\(['"]?https?:/);
    });

    test('text travels compressed, with brotli when the browser takes it', async () => {
        const res = await fetch(`${base}/js/main.js`, { headers: { 'accept-encoding': 'br' } });
        assert.equal(res.headers.get('content-encoding'), 'br');
        assert.equal(res.headers.get('vary'), 'Accept-Encoding');
    });

    test('gzip, when that is all the browser takes', async () => {
        const res = await fetch(`${base}/css/style.css`, { headers: { 'accept-encoding': 'gzip' } });
        assert.equal(res.headers.get('content-encoding'), 'gzip');
    });

    test('a brotli body unpacks to the file', async () => {
        const { raw } = await ask('/js/main.js', { 'accept-encoding': 'br' });
        assert.match(zlib.brotliDecompressSync(raw).toString(), /import/);
    });

    test('the page says what it is, to browsers and to the chats a link is pasted in', async () => {
        const html = await (await fetch(`${base}/`)).text();
        assert.match(html, /^<!doctype html>\s*<html lang="en">/);
        assert.match(html, /<meta name="description" content="[^"]{50,}">/);
        // the preview image is given by its whole address, at the address the page was asked at
        const image = html.match(/<meta property="og:image" content="([^"]+)">/)[1];
        assert.equal(image, `${base}/img/preview.jpg`);
        const picture = await fetch(image);
        assert.equal(picture.headers.get('content-type'), 'image/jpeg');
        assert.deepEqual([...Buffer.from(await picture.arrayBuffer()).subarray(0, 3)], [0xff, 0xd8, 0xff]);
        for (const [file, type] of [['icon.svg', 'image/svg+xml'], ['icon-180.png', 'image/png']]) {
            assert.ok(html.includes(`href="img/${file}"`), file);
            const icon = await fetch(`${base}/img/${file}`);
            assert.equal(icon.status, 200);
            assert.equal(icon.headers.get('content-type'), type);
        }
    });

    test('behind a proxy, the preview image has the public address', async () => {
        const proxied = { host: 'sinestesia.example', 'x-forwarded-proto': 'https' };
        const image = /<meta property="og:image" content="https:\/\/sinestesia\.example\/img\/preview\.jpg">/;
        const page = await ask('/?track=SNS1-abc', proxied);
        assert.match(page.raw.toString(), image);
        const packed = await ask('/', { ...proxied, 'accept-encoding': 'br' });
        assert.match(zlib.brotliDecompressSync(packed.raw).toString(), image);
        // each address is its own version of the page, with its own tag
        const local = await ask('/');
        assert.notEqual(page.headers.etag, local.headers.etag);
        assert.equal((await ask('/', { ...proxied, 'if-none-match': page.headers.etag })).status, 304);
        assert.equal((await ask('/', { 'if-none-match': page.headers.etag })).status, 200);
    });

    test('a host that is not a plain name is never written into the page', async () => {
        const page = await ask('/', { host: 'x"><script>alert(1)</script>' });
        assert.equal(page.status, 200);
        assert.doesNotMatch(page.raw.toString(), /alert\(1\)/);
        assert.match(page.raw.toString(), /<meta property="og:image" content="img\/preview\.jpg">/);
        assert.doesNotMatch(page.headers['content-security-policy'], /alert/);
    });

    test('the fonts are served from here, as they are', async () => {
        const res = await fetch(`${base}/fonts/jetbrains-mono-400.woff2`, { headers: { 'accept-encoding': 'br, gzip' } });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'font/woff2');
        assert.equal(res.headers.get('content-encoding'), null);
        const bytes = Buffer.from(await res.arrayBuffer());
        assert.equal(bytes.subarray(0, 4).toString(), 'wOF2');
    });

    test('an unchanged file answers 304 to its tag', async () => {
        const first = await fetch(`${base}/css/style.css`, { headers: { 'accept-encoding': 'gzip' } });
        const tag = first.headers.get('etag');
        assert.ok(tag);
        const again = await fetch(`${base}/css/style.css`, { headers: { 'accept-encoding': 'gzip', 'if-none-match': tag } });
        assert.equal(again.status, 304);
    });

    test('nothing outside public/ is reachable', async () => {
        for (const path of ['/../package.json', '/%2e%2e/package.json', '/..%2fserver%2fapp.js', '/%00', '/nope.js']) {
            const res = await fetch(`${base}${path}`);
            assert.equal(res.status, 404, path);
        }
    });

    test('only GET and HEAD', async () => {
        const res = await fetch(`${base}/`, { method: 'POST' });
        assert.equal(res.status, 405);
    });

    test('the health check', async () => {
        const res = await fetch(`${base}/healthz`);
        assert.equal(res.status, 200);
        assert.equal(await res.text(), 'ok');
    });
});

// a page in a room: its socket and everything it has received
function join(room) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsBase}?room=${room}`);
        const inbox = [];
        ws.on('message', d => inbox.push(JSON.parse(d)));
        ws.on('close', code => { ws.closedWith = code; });
        ws.on('error', reject);
        ws.on('open', async () => { await wait(60); resolve({ ws, inbox, send: d => ws.send(JSON.stringify({ t: 'p', d })) }); });
    });
}

const closeCode = ws => new Promise(resolve => ws.on('close', resolve));

describe('the duet rooms', () => {
    test('a newcomer sees who is there, and changes are relayed', async () => {
        const a = await join('roomone');
        assert.equal(a.inbox[0].t, 'hello');
        assert.deepEqual(a.inbox[0].peers, []);
        assert.equal(typeof a.inbox[0].now, 'number');
        a.send({ name: 'ann', x: 0.5 });
        await wait(60);

        const b = await join('roomone');
        assert.deepEqual(b.inbox[0].peers.map(p => p.p), [{ name: 'ann', x: 0.5 }]);
        a.send({ x: 0.7, name: null });
        await wait(60);
        assert.deepEqual(b.inbox.at(-1).d, { x: 0.7, name: null });

        a.ws.close();
        await wait(100);
        assert.equal(b.inbox.at(-1).t, 'left');
        b.ws.close();
    });

    test('junk is ignored and the connection stays open', async () => {
        const a = await join('roomjunk');
        const b = await join('roomjunk');
        a.ws.send('not json');
        a.ws.send(JSON.stringify({ t: 'p', d: [1, 2] }));
        a.ws.send(JSON.stringify({ t: 'x' }));
        await wait(100);
        assert.equal(b.inbox.length, 1);
        assert.equal(a.ws.readyState, WebSocket.OPEN);
        a.ws.close();
        b.ws.close();
    });

    test('a flood is cut to about sixty messages a second', async () => {
        const a = await join('roomflood');
        const b = await join('roomflood');
        for (let i = 0; i < 200; i++) a.send({ x: i / 200 });
        await wait(200);
        const relayed = b.inbox.filter(m => m.t === 'p').length;
        assert.ok(relayed > 40 && relayed < 90, `relayed ${relayed}`);
        assert.equal(a.ws.readyState, WebSocket.OPEN);
        a.ws.close();
        b.ws.close();
    });

    test('a message over 16 KB closes only its sender', async () => {
        const a = await join('roombig');
        const b = await join('roombig');
        a.send({ huge: 'z'.repeat(20000) });
        await closeCode(a.ws);
        assert.equal(b.ws.readyState, WebSocket.OPEN);
        b.ws.close();
    });

    test('a bad room code and a ninth player are turned away', async () => {
        assert.equal(await closeCode(new WebSocket(`${wsBase}?room=NO!`)), 1008);
        const full = [];
        for (let i = 0; i < 8; i++) full.push(await join('roomfull'));
        assert.equal(await closeCode(new WebSocket(`${wsBase}?room=roomfull`)), 1013);
        full.forEach(p => p.ws.close());
    });
});
