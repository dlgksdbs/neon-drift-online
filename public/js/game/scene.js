import * as THREE from 'three';

/* =============================================================================
   scene.js — 렌더러 · 밤하늘 · 네온 스카이라인 · 조명
   ============================================================================= */

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.id = 'gl';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05030e);
  scene.fog = new THREE.FogExp2(0x120a2c, 0.0026);

  const camera = new THREE.PerspectiveCamera(68, container.clientWidth / container.clientHeight, 0.3, 1800);

  // --- 조명 (저비용)
  const hemi = new THREE.HemisphereLight(0x6f7dff, 0x160a24, 1.25);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xa9c6ff, 1.15);
  moon.position.set(-120, 180, -80);
  scene.add(moon);
  const fill = new THREE.DirectionalLight(0xff3bd1, 0.3);
  fill.position.set(140, 60, 160);
  scene.add(fill);

  // --- 하늘 그라디언트
  const skyGeo = new THREE.SphereGeometry(900, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x02000a) },
      mid: { value: new THREE.Color(0x140a3a) },
      bottom: { value: new THREE.Color(0x3a0f52) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
      void main(){
        float h = normalize(vP).y;
        vec3 c = mix(bottom, mid, smoothstep(-0.15, 0.22, h));
        c = mix(c, top, smoothstep(0.15, 0.75, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // --- 별
  const starCount = 420;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 620 + Math.random() * 180;
    const y = 80 + Math.random() * 420;
    starPos[i * 3] = Math.cos(a) * r;
    starPos[i * 3 + 1] = y;
    starPos[i * 3 + 2] = Math.sin(a) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xbfd8ff, size: 2.2, sizeAttenuation: true, transparent: true, opacity: 0.85, fog: false, depthWrite: false,
  }));
  scene.add(stars);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 220));

  return { renderer, scene, camera, resize, moon, hemi };
}

/* ---------- 캔버스 텍스처 헬퍼 ---------- */
export function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  tex.needsUpdate = true;
  return tex;
}
