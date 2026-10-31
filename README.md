# Sinestesia

A techno machine in a single web page. What you type and how you move the mouse become music and visions: acid bass lines, drums and psychedelic shader scenes, all synthesized live in the browser with no samples.

## Run it

Open `index.html` in a recent browser (Chrome, Edge or Firefox), or serve the folder with any static server:

```bash
python -m http.server 8765
```

Then visit `http://localhost:8765`. Turn the volume down before you press start.

## What is inside

- **Studio**: a groovebox with a six-track drum grid (on, accent, roll), an editable acid bass line, a mixer with kill switches and swing.
  - Eight pattern slots (A–H) switched on the bar line, chained into a song.
  - Live FX pads: beat repeat, filter sweeps, tape stop, freeze, bitcrush, sidechain pump.
  - Motion recording for the acid knobs, and a Madness knob that varies every bar.
  - The whole track fits in one shareable code (`SNS1-…`).
- **Free play**: every key is a note, Enter turns the phrase you typed into a groove through its SHA-256 hash, the mouse drives the filter and the echo.
- **Bitcoin mode**: live transactions and blocks become notes. It connects to the public feeds of blockchain.info and mempool.space, and falls back to a simulation when they are unreachable.
- **Pirate radio**, spells drawn with the mouse, a machine improviser, and **The Signal**, a short story mode.

Everything is plain HTML, CSS and JavaScript in one file: the Web Audio API for sound, WebGL for the visuals.

## Made for claude.ai

Sinestesia was built as a claude.ai artifact. A few features use its runtime: talking with Claude, the duet with a friend, names and saving files. Outside claude.ai these are switched off or fall back to simpler offline behaviour; the music, the Studio and the visuals work everywhere.
