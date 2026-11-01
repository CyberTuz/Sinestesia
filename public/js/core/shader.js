// The visions: one fragment shader over the whole screen, eleven scenes chosen by uScene.

export const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
export const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform vec2 uMouse;
uniform float uTime, uKick, uLevel, uHue, uFlash, uInt, uGlitch;
uniform int uScene;

vec3 pal(float t){ return 0.5 + 0.5*cos(6.28318*(t + vec3(0.0, 0.33, 0.67) + uHue)); }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f*f*(3.0 - 2.0*f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    mat2 m = rot(0.5);
    for (int i = 0; i < 5; i++){ v += a*noise(p); p = m*p*2.02; a *= 0.5; }
    return v;
}

// signed distances for the geometric scenes
float sdTri(vec2 p, float r){
    const float k = 1.7320508;
    p.x = abs(p.x) - r;
    p.y = p.y + r/k;
    if (p.x + k*p.y > 0.0) p = vec2(p.x - k*p.y, -k*p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0*r, 0.0);
    return -length(p) * sign(p.y);
}
float sdBox(vec2 p, float r){
    vec2 d = abs(p) - vec2(r);
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdPoly(vec2 p, float r, float n){
    float a = atan(p.x, p.y) + 3.14159;
    float seg = 6.28318 / n;
    return cos(floor(0.5 + a/seg)*seg - a) * length(p) - r;
}
float outline(float d, float w){ return 1.0 - smoothstep(0.0, w, abs(d)); }

float sdBox3(vec3 p, vec3 b){
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// the cathedral: a kaleidoscopic folded fractal repeated along z, with a corridor carved through it
float mapC(vec3 q){
    vec3 p = q;
    p.z = mod(p.z, 3.0) - 1.5;
    float s = 1.0;
    for (int i = 0; i < 4; i++){
        p = abs(p) - vec3(1.1, 1.3, 0.7);
        p.xy = rot(0.45 + 0.15*sin(uTime*0.13)) * p.xy;
        p.yz = rot(0.25) * p.yz;
        p *= 1.5;
        s *= 1.5;
    }
    float d = sdBox3(p, vec3(0.9, 0.5, 0.4)) / s;
    return max(d, -(length(q.xy) - 0.7));
}

void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / min(uRes.x, uRes.y);
    float t = uTime;
    uv.x += (hash(vec2(floor(uv.y*38.0), floor(t*24.0))) - 0.5) * 0.25 * uGlitch * uInt;
    uv *= 1.0 - 0.07*uKick*uInt;
    vec3 col;

    if (uScene == 0) {
        float r = length(uv) + 1e-3;
        float a = atan(uv.y, uv.x);
        float z = 0.4/r + t*1.4;
        float s1 = sin(z*5.0 + sin(a*3.0 + t)*1.5);
        float s2 = sin(a*8.0 + z*0.7 + uMouse.x*4.0);
        float v = s1*s2;
        col = pal(z*0.05 + v*0.2) * (0.5 + 0.5*v);
        col *= smoothstep(0.0, 0.3, r) * 1.4;
        col += pal(z*0.1 + 0.3) * 0.12 / (r*8.0 + 0.4);
    } else if (uScene == 1) {
        float r = length(uv);
        float a = atan(uv.y, uv.x);
        float n = 6.0 + floor(uMouse.x*6.0);
        a = mod(a, 6.28318/n);
        a = abs(a - 3.14159/n);
        vec2 p = vec2(cos(a), sin(a)) * r;
        p = rot(t*0.1) * p;
        float f = fbm(p*3.0 + vec2(t*0.2, -t*0.15) + fbm(p*2.0 - t*0.1));
        col = pal(f*1.6 + r*0.5 - t*0.05) * (0.3 + f*1.3);
        col += pal(r - t*0.2) * 0.25 * smoothstep(0.46, 0.5, abs(fract(r*4.0 - t*0.5) - 0.5));
    } else if (uScene == 2) {
        vec2 p = uv*1.8;
        vec2 q = vec2(fbm(p + t*0.1), fbm(p + vec2(5.2, 1.3) - t*0.08));
        vec2 r2 = vec2(fbm(p + 4.0*q + vec2(1.7, 9.2) + uMouse*2.0), fbm(p + 4.0*q + vec2(8.3, 2.8) + t*0.12));
        float f = fbm(p + 4.0*r2);
        col = pal(f*2.0 + length(q)*0.6 + t*0.03) * (0.3 + f*f*1.8);
        col += pal(f + 0.5) * length(r2) * 0.22;
    } else if (uScene == 3) {
        vec2 z = uv*1.7;
        vec2 c = vec2(-0.8 + uMouse.x*0.45, 0.156 + (uMouse.y - 0.5)*0.35) + 0.025*vec2(sin(t*0.3), cos(t*0.21));
        float it = 0.0;
        for (int i = 0; i < 90; i++){
            z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
            if (dot(z, z) > 16.0) break;
            it += 1.0;
        }
        if (it < 89.0) {
            float sm = it - log2(log2(dot(z, z))) + 4.0;
            col = pal(sm*0.035 + t*0.05) * (0.6 + 0.4*sin(sm*0.5 - t*3.0));
        } else {
            col = pal(t*0.05) * 0.06;
        }
    } else if (uScene == 4) {
        // triangular tiling that flickers on the kick
        vec2 g = rot(t*0.03) * uv * 5.0;
        g.y *= 1.1547;
        g.x += 0.5*g.y;
        vec2 f = fract(g);
        float up = step(f.x + f.y, 1.0);
        vec2 id = floor(g) + vec2(up*0.5);
        float h = hash(id);
        float edge = min(min(f.x, f.y), abs(1.0 - f.x - f.y));
        float glow = sin(t*1.5 + h*6.28);
        col = pal(h*0.4 + t*0.04) * (0.06 + 0.12*glow*glow);
        col *= 1.0 + 4.0*uKick*step(0.85, hash(id + floor(t*2.0)));
        col += pal(h + 0.5) * 0.22 * (1.0 - smoothstep(0.0, 0.03, edge));
        // nested triangles rushing toward the viewer
        for (int i = 0; i < 9; i++){
            float k = float(i);
            float z = fract(k/9.0 + t*0.08);
            float size = 0.03*pow(40.0, z);
            float dir = mod(k, 2.0)*2.0 - 1.0;
            vec2 q = rot(dir*(t*0.25 + z*2.0) + k*0.7) * uv;
            float d = sdTri(q, size);
            float fade = sin(z*3.14159);
            col += pal(k*0.11 + z*0.3 + t*0.05) * outline(d, 0.006 + size*0.02) * fade * 1.5;
            col += pal(k*0.11 + 0.5) * 0.06 * fade * step(d, 0.0) * mod(k, 2.0);
        }
    } else if (uScene == 5) {
        // square tunnel with checkered walls
        vec2 p = rot(t*0.1 + uMouse.x*1.5) * uv;
        float r = max(abs(p.x), abs(p.y)) + 1e-3;
        float z = 0.25/r + t*1.2;
        float u = abs(p.x) > abs(p.y) ? p.y/p.x : p.x/p.y;
        float checker = mod(floor(z*2.0) + floor(u*4.0 + z*0.25), 2.0);
        col = pal(floor(z*2.0)*0.07 + t*0.03) * (0.12 + 0.75*checker);
        col *= smoothstep(0.0, 0.25, r);
        col += pal(z*0.1) * 0.08 / (r*10.0 + 0.3);
        // counter-rotating square frames
        for (int i = 0; i < 7; i++){
            float k = float(i);
            float s = 0.12 + k*0.11 + 0.02*sin(t*2.0 + k);
            float dir = mod(k, 2.0)*2.0 - 1.0;
            vec2 q = rot(dir*t*0.2*(1.0 + k*0.15) + 0.7854*mod(k, 2.0)) * uv;
            col += pal(k*0.14 + 0.2) * outline(sdBox(q, s), 0.004) * (0.6 + 1.2*uLevel);
        }
    } else if (uScene == 6) {
        // polygon mandala: mouse X picks the number of sides (3 to 8)
        float n = 3.0 + floor(uMouse.x*5.99);
        vec2 hp = uv*6.0;
        vec2 s = vec2(1.0, 1.7320508);
        vec2 a = mod(hp, s) - s*0.5;
        vec2 b = mod(hp - s*0.5, s) - s*0.5;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        float hexd = max(dot(abs(gv), vec2(0.5, 0.8660254)), abs(gv.x));
        col = pal(length(uv)*0.5 - t*0.05) * 0.18 * (1.0 - smoothstep(0.0, 0.04, 0.5 - hexd));
        for (int i = 0; i < 10; i++){
            float k = float(i);
            float rr = 0.06 + k*0.075 + 0.015*sin(t*1.7 + k*0.9) + uKick*0.02;
            float dir = mod(k, 2.0)*2.0 - 1.0;
            vec2 q = rot(dir*t*(0.1 + k*0.03)) * uv;
            col += pal(k*0.09 + t*0.04) * outline(sdPoly(q, rr, n), 0.005) * 1.3;
        }
        float ang = atan(uv.y, uv.x) + t*0.1;
        float spoke = abs(fract(ang/6.28318*n) - 0.5) * length(uv);
        col += pal(0.6) * 0.15 * (1.0 - smoothstep(0.0, 0.006, spoke)) * smoothstep(0.05, 0.2, length(uv));
    } else if (uScene == 7) {
        // neural network: drifting nodes, synapses to their neighbours, pulses travelling along them
        vec2 p = uv*3.2 + vec2(t*0.05, 0.0);
        vec2 cell = floor(p);
        col = vec3(0.0, 0.015, 0.03);
        for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
                vec2 c = cell + vec2(float(i), float(j));
                vec2 a = c + 0.5 + 0.35*vec2(sin(hash(c)*6.28 + t*0.3), cos(hash(c + 3.1)*6.28 + t*0.27));
                float dn = length(p - a);
                float fire = step(0.7, hash(c + floor(t*2.0)));
                col += pal(hash(c)*0.4 + 0.5) * (0.004/(dn*dn + 0.0015)) * (0.35 + fire*(0.6 + 2.0*uKick));
                for (int k = 0; k < 2; k++) {
                    vec2 c2 = c + (k == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
                    vec2 b = c2 + 0.5 + 0.35*vec2(sin(hash(c2)*6.28 + t*0.3), cos(hash(c2 + 3.1)*6.28 + t*0.27));
                    vec2 pa = p - a;
                    vec2 ba = b - a;
                    float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0);
                    float d = length(pa - ba*h);
                    float pulse = 1.0 - smoothstep(0.0, 0.06, abs(fract(t*0.5 + hash(c + c2*7.0)) - h));
                    col += pal(0.55 + h*0.25) * (1.0 - smoothstep(0.0, 0.012, d)) * (0.12 + pulse*(0.9 + uLevel));
                }
            }
        }
    } else if (uScene == 8) {
        // rainy neon city: three layers of towers, lit windows, signs, a wet street
        col = mix(vec3(0.02, 0.0, 0.07), vec3(0.32, 0.03, 0.24), smoothstep(-0.2, 0.75, uv.y));
        col += pal(0.62) * 0.08 * (1.0 - smoothstep(0.0, 0.5, abs(uv.y - 0.05)));
        for (int L = 0; L < 3; L++) {
            float fl = float(L);
            float dens = 9.0 - fl*2.5;
            float x = uv.x*dens + t*(0.04 + fl*0.07) + fl*17.0;
            float id = floor(x);
            float fx = fract(x);
            float top = -0.3 + hash(vec2(id, fl))*0.55 + fl*0.06;
            float inside = step(uv.y, top) * step(0.08, fx) * step(fx, 0.92) * step(-0.55, uv.y);
            vec3 bcol = mix(col*0.35, vec3(0.01, 0.0, 0.03), 0.4 + fl*0.2);
            vec2 w = vec2(fx*6.0, uv.y*(36.0 - fl*8.0));
            float lit = step(0.72 - 0.15*uKick, hash(floor(w) + vec2(id*3.7, fl)));
            float win = step(0.25, fract(w.x)) * step(fract(w.x), 0.75) * step(0.3, fract(w.y)) * step(fract(w.y), 0.7);
            bcol += pal(hash(floor(w) + id)*0.3 + 0.5 + fl*0.1) * lit * win * (0.5 + 0.3*fl);
            float neon = step(0.65, hash(vec2(id, 9.0 + fl))) * (1.0 - smoothstep(0.0, 0.012, abs(uv.y - (top - 0.06)))) * step(0.2, fx) * step(fx, 0.8);
            bcol += pal(hash(vec2(id, 2.0))) * neon * (1.5 + uKick);
            col = mix(col, bcol, inside);
        }
        if (uv.y < -0.55) {
            float depth = -0.55 - uv.y;
            col = vec3(0.01, 0.0, 0.03) + pal(uv.x*0.4 + t*0.03) * 0.25 * exp(-depth*6.0) * (0.5 + 0.5*sin(uv.y*120.0 + t*4.0));
        }
        float rx = floor(uv.x*90.0);
        float drop = fract(uv.y*1.5 + t*1.8 + hash(vec2(rx, 1.0))*10.0);
        col += vec3(0.5, 0.7, 1.0) * 0.18 * step(0.93, hash(vec2(rx, 2.0))) * (1.0 - smoothstep(0.0, 0.08, drop));
    } else if (uScene == 9) {
        // singularity: an accretion disk swirling into a black hole
        float r = length(uv) + 1e-4;
        float a = atan(uv.y, uv.x);
        float swirl = a + 1.1/(r + 0.08) - t*0.8;
        float dd = (r - 0.42 - 0.04*sin(swirl*3.0)) * 5.0;
        float disk = exp(-dd*dd);
        float bands = 0.5 + 0.5*sin(swirl*10.0 + fbm(vec2(swirl*0.5, r*8.0))*5.0);
        col = pal(r*0.8 - t*0.1 + bands*0.2) * disk * (0.5 + bands) * 1.7;
        col += vec3(1.0, 0.92, 0.85) * (1.0 - smoothstep(0.0, 0.012, abs(r - 0.19))) * (1.2 + uKick);
        vec2 s = vec2(swirl*2.0, log(r)*6.0 + t*2.5);
        col += vec3(0.8, 0.9, 1.0) * step(0.985, hash(floor(s*vec2(4.0, 1.0)))) * smoothstep(0.2, 0.5, r) * 0.8;
        col *= smoothstep(0.165, 0.19, r);
    } else {
        // cathedral: raymarching forward through an endless folded fractal
        vec3 ro = vec3(0.0, 0.0, t*1.6);
        vec3 rd = normalize(vec3(uv, 1.1));
        rd.xy = rot(t*0.07 + (uMouse.x - 0.5)*1.5) * rd.xy;
        float tt = 0.0, glow = 0.0, hit = 0.0;
        vec3 p = ro;
        for (int i = 0; i < 72; i++){
            p = ro + rd*tt;
            float d = mapC(p);
            glow += exp(-abs(d)*24.0);
            if (d < 0.002) { hit = 1.0; break; }
            tt += d*0.8;
            if (tt > 18.0) break;
        }
        col = vec3(0.0);
        if (hit > 0.5){
            vec2 e = vec2(0.002, 0.0);
            vec3 n = normalize(vec3(mapC(p + e.xyy) - mapC(p - e.xyy), mapC(p + e.yxy) - mapC(p - e.yxy), mapC(p + e.yyx) - mapC(p - e.yyx)));
            float dif = clamp(dot(n, normalize(vec3(0.3, 0.6, -0.7))), 0.0, 1.0);
            float rim = pow(1.0 - abs(dot(n, -rd)), 3.0);
            col = pal(p.z*0.05 + t*0.02)*(0.12 + 0.6*dif) + pal(p.z*0.05 + 0.4)*rim*1.2;
            col *= exp(-tt*0.12);
        }
        col += pal(tt*0.04 + t*0.05) * glow * 0.018 * (1.0 + uKick*2.0);
    }

    col *= 0.8 + 0.7*uLevel*uInt;
    col += uFlash*uInt*0.22*pal(t*0.3);
    col = mix(vec3(dot(col, vec3(0.3, 0.59, 0.11)))*0.35, col, 0.35 + 0.65*uInt);
    col *= 1.0 - 0.5*dot(uv, uv);
    col += (hash(gl_FragCoord.xy + t) - 0.5) * 0.04;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;
