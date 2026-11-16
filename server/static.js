// The static app: the files in public/, and nothing outside it, with the headers a public site wants.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
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
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2'
};

// a host name as browsers send it, and nothing that could carry markup into a header or a page
const HOST = /^[a-z0-9.-]+(:\d+)?$/i;

// the page talks only to this server and the two public Bitcoin feeds; the miner runs in a worker made from a blob
// (WOFF2 is already compressed, so the fonts are sent as they are)
function securityHeaders(host) {
    const self = HOST.test(host || '') ? ` ws://${host} wss://${host}` : '';
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

// where the page is being asked for, as the visitor's browser sees it: a proxy in front passes the scheme on
function originOf(req) {
    const host = req.headers.host || '';
    if (!HOST.test(host)) return '';
    const passed = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const scheme = passed === 'http' || passed === 'https' ? passed : req.socket.encrypted ? 'https' : 'http';
    return `${scheme}://${host}`;
}

// A link pasted in a chat shows the page's preview image only when the page gives the image's whole address,
// and the page cannot know it: the server writes it in, from the address the page is asked at.
function withAddress(html, base) {
    return html.replace(/(<meta property="og:image" content=")([^"]+)"/, (tag, head, ref) => {
        try { return `${head}${new URL(ref, base).href}"`; } catch { return tag; }
    });
}

// Text files travel compressed (brotli when the browser takes it, else gzip): about a quarter of the size.
// Each file is prepared once and kept in memory until it changes on disk. A page has one version for each
// address it is asked at: only the last one is kept, and it is squeezed lightly, since making it must stay cheap.
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.txt', '.svg']);
const packed = new Map();   // file → { etag, plain, br, gzip }

function pickEncoding(req) {
    const accept = String(req.headers['accept-encoding'] || '');
    return /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : '';
}

function prepared(file, etag, encoding, edit, done) {
    let entry = packed.get(file);
    if (entry?.etag !== etag) packed.set(file, entry = { etag });
    const kind = encoding || 'plain';
    if (entry[kind]) { done(null, entry[kind]); return; }
    fs.readFile(file, (err, raw) => {
        if (err) { done(err); return; }
        if (edit) raw = Buffer.from(edit(raw.toString()));
        const keep = (zerr, buf) => {
            if (zerr) { done(zerr); return; }
            entry[kind] = buf;
            done(null, buf);
        };
        if (!encoding) keep(null, raw);
        else if (encoding === 'br') zlib.brotliCompress(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: edit ? 5 : 11 } }, keep);
        else zlib.gzip(raw, { level: edit ? 6 : 9 }, keep);
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
        const ext = path.extname(file).toLowerCase();
        const encoding = COMPRESSIBLE.has(ext) ? pickEncoding(req) : '';
        const origin = ext === '.html' ? originOf(req) : '';
        // no build step means no hashed file names: browsers revalidate every file, and get a 304 when it is unchanged.
        // A page's tag also names the address written into it.
        const where = origin ? '-' + createHash('sha1').update(origin).digest('hex').slice(0, 8) : '';
        const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}${where}"`;
        // each encoding is its own version of the file, with its own tag
        const tag = encoding ? `${etag.slice(0, -1)}-${encoding}"` : etag;
        const headers = { ...securityHeaders(req.headers.host), ETag: tag, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
        if (req.headers['if-none-match'] === tag) {
            res.writeHead(304, headers);
            res.end();
            return;
        }
        const type = TYPES[ext] || 'application/octet-stream';
        if (encoding || origin) {
            const edit = origin ? html => withAddress(html, origin + rel) : null;
            prepared(file, etag, encoding, edit, (zerr, buf) => {
                if (zerr) { res.writeHead(500); res.end(); return; }
                const how = encoding ? { 'Content-Encoding': encoding } : {};
                res.writeHead(200, { ...headers, 'Content-Type': type, ...how, 'Content-Length': buf.length });
                res.end(req.method === 'HEAD' ? undefined : buf);
            });
            return;
        }
        res.writeHead(200, { ...headers, 'Content-Type': type, 'Content-Length': st.size });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
}
