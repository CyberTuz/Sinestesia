// The static app: the files in public/, and nothing outside it, with the headers a public site wants.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2'
};

// the page talks only to this server and the two public Bitcoin feeds; the miner runs in a worker made from a blob
// (WOFF2 is already compressed, so the fonts are sent as they are)
function securityHeaders(host) {
    const self = /^[a-z0-9.-]+(:\d+)?$/i.test(host || '') ? ` ws://${host} wss://${host}` : '';
    return {
        'Content-Security-Policy': [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self'",
            "font-src 'self'",
            "img-src 'self' data: blob:",
            'worker-src blob:',
            `connect-src 'self'${self} wss://ws.blockchain.info wss://mempool.space`,
            "base-uri 'none'",
            "form-action 'none'",
            "frame-ancestors 'self'"
        ].join('; '),
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    };
}

// text files travel compressed (brotli when the browser takes it, else gzip): about a quarter of the size.
// Each file is compressed once and kept in memory until it changes on disk.
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.txt', '.svg']);
const packed = new Map();   // file → { etag, br, gzip }

function pickEncoding(req) {
    const accept = String(req.headers['accept-encoding'] || '');
    return /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : '';
}

function compressed(file, etag, encoding, done) {
    let entry = packed.get(file);
    if (entry?.etag !== etag) packed.set(file, entry = { etag });
    if (entry[encoding]) { done(null, entry[encoding]); return; }
    fs.readFile(file, (err, raw) => {
        if (err) { done(err); return; }
        const squeeze = encoding === 'br'
            ? cb => zlib.brotliCompress(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }, cb)
            : cb => zlib.gzip(raw, { level: 9 }, cb);
        squeeze((zerr, buf) => {
            if (zerr) { done(zerr); return; }
            entry[encoding] = buf;
            done(null, buf);
        });
    });
}

function notFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
}

export function serveStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
    }
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { notFound(res); return; }
    if (rel.includes('\0')) { notFound(res); return; }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep)) { notFound(res); return; }

    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { notFound(res); return; }
        // no build step means no hashed file names: browsers revalidate every file, and get a 304 when it is unchanged
        const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
        const ext = path.extname(file).toLowerCase();
        const encoding = COMPRESSIBLE.has(ext) ? pickEncoding(req) : '';
        // each encoding is its own version of the file, with its own tag
        const tag = encoding ? `${etag.slice(0, -1)}-${encoding}"` : etag;
        const headers = { ...securityHeaders(req.headers.host), ETag: tag, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
        if (req.headers['if-none-match'] === tag) {
            res.writeHead(304, headers);
            res.end();
            return;
        }
        const type = TYPES[ext] || 'application/octet-stream';
        if (encoding) {
            compressed(file, etag, encoding, (zerr, buf) => {
                if (zerr) { res.writeHead(500); res.end(); return; }
                res.writeHead(200, { ...headers, 'Content-Type': type, 'Content-Encoding': encoding, 'Content-Length': buf.length });
                res.end(req.method === 'HEAD' ? undefined : buf);
            });
            return;
        }
        res.writeHead(200, { ...headers, 'Content-Type': type, 'Content-Length': st.size });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
}
