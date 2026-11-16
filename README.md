# Sinestesia

A techno playground in a web page. What you type and how you move the mouse become music and visions: acid bass lines, drums and psychedelic shader scenes, all synthesized live in the browser with no samples.

## Run it

You need Node 18 or newer.

```bash
npm install
npm start
```

Then visit `http://localhost:3000` in a recent browser (Chrome, Edge or Firefox). Turn the volume down before you press Play. The port comes from the `PORT` environment variable when it is set.

Any static server pointed at `public/` also runs the app (`python -m http.server -d public 8765`); only the duet needs the Node server, because the server holds the rooms.

## What is inside

Sinestesia is a playground: **Play** starts it, and everything else is reached from the dock at the bottom, around the typing line. The dock keeps pause, the scene and the volume at hand, and opens the story, the Studio (the advanced console) and the full controls.

- **Studio**: a groovebox with a six-track drum grid (on, accent, roll), an editable acid bass line, a mixer with kill switches and swing.
  - Eight pattern slots (A–H) switched on the bar line, chained into a song.
  - Live FX pads: beat repeat, filter sweeps, tape stop, freeze, bitcrush, sidechain pump.
  - Motion recording for the acid knobs, and a Madness knob that varies every bar.
  - The track is saved in the browser as you go, and travels in a link (`?track=…`) or as a code (`SNS1-…`).
  - A track that arrives in a link or a code never erases yours: the one you had is kept aside (up to four of them), and **Swap tracks** brings it back.
- **Free play**: every key is a note, Enter turns the phrase you typed into a groove through its SHA-256 hash, the mouse drives the filter and the echo. On a touch screen a row of keys plays the groove's scale, and on a first visit a few short tips show the way.
- **Duet**: everyone who opens the same link (`?duet=…`) plays together, each with their own instrument.
- **Bitcoin mode**: live transactions and blocks become notes. It connects to the public feeds of blockchain.info and mempool.space, and falls back to a simulation when they are unreachable.
- **Pirate radio**, spells drawn with the mouse, and a machine improviser.
- **The Signal**: a story in thirteen chapters (about twenty minutes) that is also a tour of the playground. Each chapter is a musical puzzle, from tuning a signal to rebuilding a rhythm in the Studio, and the story ends one of three ways. Progress is saved after each chapter, so it can be continued on another visit. The script is in `docs/the-signal.md`.

The browser side is plain HTML, CSS and JavaScript with no build step: the Web Audio API for sound, WebGL for the visuals.

## How the code is laid out

```
server/             one Node process, one dependency (ws)
  server.js         starts the server on $PORT, clean shutdown on SIGTERM
  app.js            the HTTP server and /healthz
  static.js         serves public/ with security headers, ETags and brotli/gzip compression,
                    and writes the preview image's whole address into the page
  rooms.js          the duet's rooms, a WebSocket at /ws?room=<code>
public/
  index.html        the markup; a feature's elements carry data-needs="<feature>"
  css/style.css
  fonts/            JetBrains Mono and Major Mono Display (OFL), served from here
  img/              the icon (the sigil of the word "sinestesia") and the picture a pasted link shows
  js/main.js        starts the music, and imports every feature
  js/core/          always loaded
    state.js        S (the shared state), scales, scenes, small helpers
    bus.js          events between the core and the features (on, emit, claim, modes, actions)
    pattern.js      text → SHA-256 → groove, and the sigils
    audio.js        the audio graph, the bass and pad synths, the live-effect chain
    instruments.js  drums, lead, bells, the machine's notes, risers, the theremin
    voices.js       formant voices: chant, choir, whisper, the robot voice
    sequencer.js    the lookahead scheduler, the drums per genre, the free-play intro
    direction.js    applies a set described as data (used by the radio and the spells)
    download.js     hands the viewer a file (the recording, the story's keepsake)
    hud.js, input.js, overlay.js, visuals.js, shader.js, memory.js
  js/features/      studio, story, journey, machine, mining, radio,
                    spells, duet, files, bitcoin, record, keys, tips
```

The core never imports a feature, and a feature never imports another one. Each feature registers itself when it loads: it listens to the core's events (each bar, each step, each frame, the notes and phrases you play), answers the core's questions (who takes a key, what goes on the status line), and offers actions to the others. `public/js/core/bus.js` lists every event.

### The duet's server

A room is just a code in the link. Each page publishes a small presence object (cursor, instrument, name, the groove playing, its last few actions) and the server relays every change to the others in the room; it never interprets the music, and each page checks what it receives. The server also sends its clock, so both pages count bars on the same time. Everything lives in memory: a room disappears with its last player, and a restart only makes the pages reconnect.

Limits, in `server/rooms.js`: 8 players a room, 1000 rooms, 16 KB a message, 60 messages a second a page.

### Removing a feature

1. Delete its line in `public/js/main.js`. Its buttons and panels hide themselves, because the markup marked `data-needs="<feature>"` only shows once that feature loads.
2. Optionally delete its file in `public/js/features/` and its `data-needs` markup in `public/index.html`.

Features that use another one only when it is there:

| Feature | Uses, if present | Without it |
|---|---|---|
| story | radio, studio, spells, mining | the story skips the chapter played with it (Shortwave, The Factory, The Storm, The Vault) |
| story | keys | the Archive chapter is played with the letter keys |
| story | machine (the "stay" ending) | the ending does not switch the machine on |
| radio, studio | story | her station, her greeting and her rhythm in slot H never appear |

The story borrows the radio, the Studio, the spells and the keys through `actions` (`radioGuest`, `studioGuest`, `spellsGuest`, `keys`): they open inside the story without stopping it and leave its music alone, and the Studio gives your own track back when the chapter ends.

## Tests

```bash
npm test
```

runs the server's tests (`test/server.test.js`): the static files and their headers, compression, the link-preview tags, the health check and the duet's rooms. It takes a few seconds and needs nothing else.

```bash
npx playwright install chromium
npm run test:e2e
```

runs the browser tests (`test/e2e/`) in a headless Chromium, against a server of their own on port 3123. `story.spec.js` plays each chapter of the story the way a player would and checks that the next one begins, and the three endings; `studio.spec.js` opens track links and codes and checks that your own track is never lost; `phone.spec.js` opens the page as a Pixel 7 with touch. They take a few minutes, because each chapter waits for her lines and for whole bars of music. The first command downloads the browser, once.

The page loads nothing from other hosts, fonts included; the only outside connections are the Bitcoin mode's two public feeds.

## Deploying with Coolify

The repository has a `Dockerfile`, so Coolify can build it as it is.

1. In Coolify, create a resource from this Git repository and pick the **Dockerfile** build pack.
2. Set the exposed port to `3000`, and the health check path to `/healthz`.
3. Add your domain. Coolify's proxy serves it over HTTPS, and WebSockets (the duet) pass through it with no extra setting.

There is nothing else to configure: no database, no secrets, no volumes. One instance is enough; if you ever run more than one, the players of a duet must reach the same instance, since the rooms live in its memory.
