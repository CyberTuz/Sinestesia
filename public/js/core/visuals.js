// ═══════════════════════════════════════════════════════════════════════
// VISIONS (WebGL fragment shader)
// ═══════════════════════════════════════════════════════════════════════

import { $, S, reduceMotion } from './state.js';
import { emit } from './bus.js';
import { ac, analyser, timeData } from './audio.js';
import { machineVisuals, phraseVowels, voiceVisuals } from './voices.js';
import { kickQueue } from './instruments.js';
import { hookVisuals, sceneQueue, visualSteps } from './sequencer.js';
import { setActiveStep, setScene, statusTick } from './hud.js';
import { drawOverlay, fx, spawnLetter, spawnToken, tokenRain } from './overlay.js';
import { FRAG, VERT } from './shader.js';

export const glc = $('#gl');
export const gl = glc.getContext('webgl', { antialias: false, preserveDrawingBuffer: false });

export let prog = null, U = {};
if (gl) {
    const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
        return s;
    };
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (vs && fs) {
        prog = gl.createProgram();
        gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
        gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        for (const n of ['uRes', 'uMouse', 'uTime', 'uKick', 'uLevel', 'uHue', 'uFlash', 'uInt', 'uGlitch', 'uScene']) U[n] = gl.getUniformLocation(prog, n);
    }
}

export function resize() {
    const scale = Math.min(0.7, 1100 / Math.max(innerWidth, innerHeight));
    glc.width = Math.max(1, Math.floor(innerWidth * scale));
    glc.height = Math.max(1, Math.floor(innerHeight * scale));
    if (gl) gl.viewport(0, 0, glc.width, glc.height);
    const dpr = Math.min(2, devicePixelRatio || 1);
    fx.width = Math.floor(innerWidth * dpr);
    fx.height = Math.floor(innerHeight * dpr);
}
window.addEventListener('resize', resize);
resize();

// ═══════════════════════════════════════════════════════════════════════
// FRAME LOOP
// ═══════════════════════════════════════════════════════════════════════

export const t0 = performance.now();
export let lastKick = -10;
export let glOpacity = 0.65, glOpacityShown = 1;

export function frame() {
    const now = ac ? ac.currentTime : 0;

    if (ac) {
        while (kickQueue.length && kickQueue[0] <= now) lastKick = kickQueue.shift();
        S.kickEnv = Math.exp(-(now - lastKick) * 7);
        while (visualSteps.length && visualSteps[0].t <= now) {
            const v = visualSteps.shift();
            setActiveStep(v.i);
            if (v.i === 0) $('#r-bpm').textContent = `${S.bpm} BPM · bar ${v.bar}`;
        }
        while (sceneQueue.length && sceneQueue[0].t <= now) setScene(sceneQueue.shift().scene);
        while (hookVisuals.length && hookVisuals[0].t <= now) spawnLetter(hookVisuals.shift().ch, 0.55);
        while (machineVisuals.length && machineVisuals[0].t <= now) {
            const v = machineVisuals.shift();
            if (v.kind === 'tokens') tokenRain(v.text);
            else spawnToken(v.text);
        }
        while (voiceVisuals.length && voiceVisuals[0].t <= now) {
            const v = voiceVisuals.shift();
            if (v.kind === 'impact') { S.flash = 1; S.glitch = 0.6; }
            else if (v.kind === 'choir') S.sigilAge = Math.min(S.sigilAge, 0.3);
            else if (v.kind === 'whisper') S.glitch = Math.max(S.glitch, 0.25);
            else spawnLetter(phraseVowels(S.pattern)[0], 1.3);
        }
        analyser.getFloatTimeDomainData(timeData);
        let sum = 0;
        for (let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i];
        const rms = Math.sqrt(sum / timeData.length);
        S.level += (Math.min(1, rms * 3) - S.level) * 0.2;
    }

    // the features that run every frame: the radio dial, the story's puzzles, the duet…
    emit('frame');
    statusTick();
    // light follows the music: the visions brighten as the arrangement fills in
    const op = 0.3 + 0.7 * Math.min(1, S.visMul);
    glOpacity += (op - glOpacity) * 0.03;
    if (Math.abs(glOpacity - glOpacityShown) > 0.01) { glOpacityShown = glOpacity; glc.style.opacity = glOpacity.toFixed(2); }
    S.flash *= 0.9;
    S.glitch *= 0.88;
    const kickVis = reduceMotion ? 0 : S.kickEnv;

    if (prog) {
        const time = (performance.now() - t0) / 1000;
        gl.uniform2f(U.uRes, glc.width, glc.height);
        gl.uniform2f(U.uMouse, S.mouse[0], 1 - S.mouse[1]);
        gl.uniform1f(U.uTime, reduceMotion ? time * 0.4 : time);
        gl.uniform1f(U.uKick, kickVis);
        gl.uniform1f(U.uLevel, S.level);
        gl.uniform1f(U.uHue, S.hue);
        gl.uniform1f(U.uFlash, reduceMotion ? 0 : S.flash);
        gl.uniform1f(U.uInt, Math.min(1, S.intensity * Math.min(1.15, Math.max(0.4, S.visMul))));
        gl.uniform1f(U.uGlitch, S.glitch);
        gl.uniform1i(U.uScene, S.scene);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    drawOverlay();
    requestAnimationFrame(frame);
}
