// Sinestesia's server: the static app from public/ (static.js) and the rooms the duet plays in (rooms.js).
// One process and no database: a room lives in memory and goes away when its last player leaves.
// server.js starts it; the tests start their own on a free port.
import http from 'node:http';
import { serveStatic } from './static.js';
import { attachRooms } from './rooms.js';

export function createApp() {
    const server = http.createServer((req, res) => {
        // for Coolify's health check
        if (req.url === '/healthz') {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end('ok');
            return;
        }
        serveStatic(req, res);
    });
    const rooms = attachRooms(server);
    return { server, rooms };
}
