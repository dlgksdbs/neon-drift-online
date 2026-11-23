import * as THREE from 'three';

/* =============================================================================
   materials.js — 프로시저럴 텍스처/환경맵 (노면 노멀·러프니스, 네온 글로우, 하늘)
   ============================================================================= */

const cache = new Map();
function memo(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

/* ---------- 캔버스 헬퍼 ---------- */
export function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

export function tex(canvas, { repeat = null, srgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.needsUpdate = true;
  return t;
}

/* ---------- 값 노이즈 ---------- */
function hash(x, y, s) {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s);
  const c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}
function fbm(x, y, s, oct = 4) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * f, y * f, s + i * 13) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

/* ---------- 노면 ---------- */
/* 알베도: 젖은 밤 아스팔트 (보랏빛/푸른 기운, 타이어 자국, 패인 자리) */
export function asphaltTexture() {
  return memo('asphalt', () => {
    const S = 512;
    return tex(makeCanvas(S, S, (ctx, w, h) => {
      ctx.fillStyle = '#24242f';
      ctx.fillRect(0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const grain = fbm(x * 0.09, y * 0.09, 3.1, 3);
          const coarse = fbm(x * 0.012, y * 0.012, 8.4, 3);
          const speck = hash(x * 1.7, y * 2.3, 5.5);
          const v = 26 + grain * 26 + coarse * 16 + (speck > 0.965 ? 40 : 0);
          d[i] = Math.min(255, v * 0.95);
          d[i + 1] = Math.min(255, v * 0.98);
          d[i + 2] = Math.min(255, v * 1.22 + 4);
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      // 젖은 자리(살짝 밝게 번지는 반사)
      for (let i = 0; i < 26; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        const r = 18 + Math.random() * 70;
        const grd = ctx.createRadialGradient(x, y, 1, x, y, r);
        grd.addColorStop(0, 'rgba(120,150,220,0.10)');
        grd.addColorStop(1, 'rgba(120,150,220,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      // 타이어 흔적
      for (let i = 0; i < 5; i++) {
        ctx.strokeStyle = `rgba(12,12,18,${0.12 + Math.random() * 0.16})`;
        ctx.lineWidth = 6 + Math.random() * 14;
        ctx.beginPath();
        const x = Math.random() * w;
        ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x + 30, h * 0.35, x - 30, h * 0.7, x + 8, h);
        ctx.stroke();
      }
      // 크랙
      for (let i = 0; i < 9; i++) {
        ctx.strokeStyle = 'rgba(10,10,16,0.5)';
        ctx.lineWidth = 1 + Math.random();
        let x = Math.random() * w, y = Math.random() * h;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    }), { repeat: [1, 1], srgb: true, aniso: 8 });
  });
}

/* 노멀맵: 거친 결 + 물웅덩이 */
export function asphaltNormalTexture() {
  return memo('asphaltNormal', () => {
    const S = 256;
    const c = makeCanvas(S, S, (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      const d = img.data;
      const hAt = (x, y) => {
        const grain = fbm(x * 0.14, y * 0.14, 2.2, 4);
        const bump = fbm(x * 0.035, y * 0.035, 9.7, 3);
        const stone = Math.max(0, vnoise(x * 0.5, y * 0.5, 4.4) - 0.72) * 2.2;
        return grain * 0.55 + bump * 0.7 + stone;
      };
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const l = hAt(x - 1, y), r = hAt(x + 1, y);
          const u = hAt(x, y - 1), dn = hAt(x, y + 1);
          const nx = (l - r) * 1.6, ny = (u - dn) * 1.6;
          const len = Math.hypot(nx, ny, 1);
          const i = (y * w + x) * 4;
          d[i] = ((nx / len) * 0.5 + 0.5) * 255;
          d[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
          d[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    });
    return tex(c, { repeat: [1, 1], srgb: false, aniso: 8 });
  });
}

/* 러프니스: 물웅덩이는 매끈(어둡게) — 푸른 네온이 길게 비친다 */
export function asphaltRoughTexture() {
  return memo('asphaltRough', () => {
    const S = 256;
    const c = makeCanvas(S, S, (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      const d = img.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const puddle = fbm(x * 0.014, y * 0.02, 17.3, 3);
          const grain = fbm(x * 0.16, y * 0.16, 6.1, 2);
          let r = 0.52 + grain * 0.28;
          if (puddle > 0.58) r = 0.12 + (1 - (puddle - 0.58) / 0.42) * 0.16;
          const i = (y * w + x) * 4;
          const v = Math.max(0, Math.min(1, r)) * 255;
          d[i] = d[i + 1] = d[i + 2] = v;
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    });
    return tex(c, { repeat: [1, 1], srgb: false, aniso: 8 });
  });
}

/* ---------- 글로우 스프라이트 ---------- */
export function glowTexture() {
  return memo('glow', () => tex(makeCanvas(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.16, 'rgba(255,255,255,0.86)');
    g.addColorStop(0.38, 'rgba(255,255,255,0.28)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.06)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }), { srgb: true }));
}

export function softGlowTexture() {
  return memo('softGlow', () => tex(makeCanvas(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }), { srgb: true }));
}

/* ---------- 도시 창문 ---------- */
export function windowTexture(variant = 0) {
  return memo('windows' + variant, () => tex(makeCanvas(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#04050d';
    ctx.fillRect(0, 0, w, h);
    const pal = ['#5ff3ff', '#ff7ad9', '#ffd58a', '#a48cff', '#9dffe6', '#6f9dff'];
    const cellW = 7, cellH = 9;
    for (let y = 4; y < h - 4; y += cellH) {
      const rowLit = Math.random();
      for (let x = 4; x < w - 4; x += cellW) {
        const on = Math.random() < (rowLit > 0.7 ? 0.55 : 0.18);
        if (!on) continue;
        const col = pal[(Math.random() * pal.length) | 0];
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.35 + Math.random() * 0.6;
        ctx.fillRect(x, y, cellW - 3, cellH - 4);
        if (Math.random() > 0.86) {
          ctx.globalAlpha = 0.18;
          ctx.fillRect(x - 1, y - 1, cellW - 1, cellH - 2);
        }
      }
    }
    ctx.globalAlpha = 1;
  }), { repeat: [1, 1], srgb: true }));
}

/* ---------- 셰브런(부스터 패드) ---------- */
export function chevronTexture(color) {
  return memo('chev' + color, () => tex(makeCanvas(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let k = 0; k < 2; k++) {
      const off = k * 64;
      ctx.beginPath();
      ctx.moveTo(10, off + 54);
      ctx.lineTo(64, off + 16);
      ctx.lineTo(118, off + 54);
      ctx.lineTo(118, off + 78);
      ctx.lineTo(64, off + 40);
      ctx.lineTo(10, off + 78);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(0, 0, w, h);
  }), { repeat: [1, 2], srgb: true, aniso: 2 }));
}

/* ---------- 체커 ---------- */
export function checkerTexture() {
  return memo('checker', () => tex(makeCanvas(256, 64, (ctx, w, h) => {
    const s = 16;
    for (let y = 0; y < h / s; y++) {
      for (let x = 0; x < w / s; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#0b0b12' : '#eef6ff';
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
  }), { repeat: [1, 1], srgb: true }));
}

/* ---------- 네온 텍스트/사인 ---------- */
export function textTexture(text, color = '#7ef9ff', sub = null, opts = {}) {
  const key = `txt:${text}:${color}:${sub}:${opts.w || 512}`;
  return memo(key, () => tex(makeCanvas(opts.w || 512, opts.h || 160, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = `900 ${Math.round(h * 0.5)}px system-ui, "Apple SD Gothic Neo", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 34;
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, sub ? h * 0.42 : h / 2);
    ctx.shadowBlur = 14;
    ctx.fillText(text, w / 2, sub ? h * 0.42 : h / 2);
    if (sub) {
      ctx.shadowBlur = 12;
      ctx.font = `800 ${Math.round(h * 0.17)}px system-ui, sans-serif`;
      ctx.fillStyle = opts.subColor || '#ffffff';
      ctx.fillText(sub, w / 2, h * 0.78);
    }
  }), { srgb: true }));
}

/* ---------- 환경맵 (금속 도장 반사용) ---------- */
function skyCanvas() {
  return makeCanvas(1024, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0.0, '#01000a');
    g.addColorStop(0.20, '#070522');
    g.addColorStop(0.38, '#150a3e');
    g.addColorStop(0.48, '#2b1057');
    g.addColorStop(0.52, '#57146f');
    g.addColorStop(0.55, '#8b1c74');
    g.addColorStop(0.585, '#3a1358');
    g.addColorStop(0.66, '#100b28');
    g.addColorStop(1.0, '#040410');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 성운
    const neb = [['#ff2fb0', 0.14], ['#2b6bff', 0.12], ['#8a5cff', 0.12], ['#22e6ff', 0.08]];
    for (let i = 0; i < 16; i++) {
      const c = neb[i % neb.length];
      const x = Math.random() * w;
      const y = h * (0.06 + Math.random() * 0.42);
      const r = 60 + Math.random() * 230;
      const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, c[0] + '55');
      grd.addColorStop(0.45, c[0] + '1e');
      grd.addColorStop(1, c[0] + '00');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }

    // 별
    for (let i = 0; i < 1400; i++) {
      const x = Math.random() * w;
      const y = Math.pow(Math.random(), 1.4) * h * 0.62;
      const s = Math.random();
      const r = s > 0.985 ? 2.2 : s > 0.93 ? 1.4 : 0.8;
      ctx.globalAlpha = 0.25 + Math.random() * 0.75;
      ctx.fillStyle = ['#ffffff', '#cfe4ff', '#ffe9c9', '#b9d2ff'][(Math.random() * 4) | 0];
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 달 + 달무리
    const mx = w * 0.70, my = h * 0.20, mr = 22;
    const halo = ctx.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 7);
    halo.addColorStop(0, 'rgba(200,225,255,0.55)');
    halo.addColorStop(0.25, 'rgba(150,190,255,0.16)');
    halo.addColorStop(1, 'rgba(120,160,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(mx, my, mr * 7, 0, Math.PI * 2); ctx.fill();
    const moon = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.35, 1, mx, my, mr);
    moon.addColorStop(0, '#ffffff');
    moon.addColorStop(0.65, '#e6f2ff');
    moon.addColorStop(1, '#b9d4f5');
    ctx.fillStyle = moon;
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    // 달 표면 음영
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#6f88b8';
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * mr * 0.62;
      ctx.beginPath();
      ctx.arc(mx + Math.cos(a) * d, my + Math.sin(a) * d, 2 + Math.random() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 지평선 네온 헤이즈(도시 빛)
    const hz = ctx.createLinearGradient(0, h * 0.44, 0, h * 0.60);
    hz.addColorStop(0, 'rgba(255,60,190,0)');
    hz.addColorStop(0.42, 'rgba(255,60,190,0.30)');
    hz.addColorStop(0.62, 'rgba(120,80,255,0.26)');
    hz.addColorStop(1, 'rgba(0,200,255,0)');
    ctx.fillStyle = hz;
    ctx.fillRect(0, h * 0.44, w, h * 0.16);
    // 수평선 아래는 지면/수면
    ctx.fillStyle = '#04030c';
    ctx.fillRect(0, h * 0.585, w, h * 0.415);
    const refl = ctx.createLinearGradient(0, h * 0.585, 0, h * 0.72);
    refl.addColorStop(0, 'rgba(160,70,255,0.18)');
    refl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = refl;
    ctx.fillRect(0, h * 0.585, w, h * 0.14);
  });
}

export function makeEnvironment(renderer) {
  if (!renderer) return null;
  if (cache.has('env')) return cache.get('env');
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const t = new THREE.CanvasTexture(skyCanvas());
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  const rt = pmrem.fromEquirectangular(t);
  t.dispose();
  pmrem.dispose();
  cache.set('env', rt.texture);
  return rt.texture;
}

/* 하늘(등배경 + 환경 반사 공용) */
export function skyTexture() {
  return memo('skyTex', () => {
    const t = new THREE.CanvasTexture(skyCanvas());
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  });
}

/* ---------- 수면 셰이더 ---------- */
export function waterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      time: { value: 0 },
      deep: { value: new THREE.Color(0x050a1e) },
      glowA: { value: new THREE.Color(0x2b6bff) },
      glowB: { value: new THREE.Color(0xff3fb4) },
    },
    vertexShader: `
      varying vec3 vW;
      void main(){
        vec4 wp = modelMatrix * vec4(position,1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform float time; uniform vec3 deep; uniform vec3 glowA; uniform vec3 glowB;
      varying vec3 vW;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){
        vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y);
      }
      void main(){
        vec2 p = vW.xz * 0.02;
        float w1 = sin(p.x*1.7 + time*0.55) * 0.5 + 0.5;
        float w2 = sin(p.y*2.3 - time*0.42) * 0.5 + 0.5;
        float ripple = noise(vW.xz * 0.09 + vec2(time*0.12, -time*0.09));
        float lines = smoothstep(0.55, 1.0, sin(p.y * 9.0 + ripple * 3.0 + time * 1.1) * 0.5 + 0.5);
        float streak = smoothstep(0.72, 1.0, noise(vec2(vW.x * 0.06, vW.z * 0.006 + time * 0.05)));
        float d = length(vW.xz - vec2(-10.0, -20.0));
        float fade = smoothstep(150.0, 900.0, d);
        vec3 c = deep;
        c += glowA * (0.10 + lines * 0.16) * (0.35 + w1 * 0.5) * fade;
        c += glowB * (0.06 + streak * 0.22) * (0.4 + w2 * 0.4) * fade;
        gl_FragColor = vec4(c, 0.92);
      }`,
  });
}
