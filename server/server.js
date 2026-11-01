// Starts Sinestesia's server (app.js) on $PORT, 3000 by default.
import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 3000;
const { server, rooms } = createApp();

server.listen(PORT, () => console.log(`sinestesia listening on http://localhost:${PORT}`));

// a redeploy stops the container with SIGTERM: close the rooms, let open requests finish, then exit
for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
        rooms.close();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
    });
}
