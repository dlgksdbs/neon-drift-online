import * as THREE from 'three';
import { makeEnvironment, skyTexture } from './materials.js';

/* =============================================================================
   scene.js — 렌더러 · 환경맵 · 밤하늘 · 네온 조명
   ============================================================================= */

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.id = 'gl';

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.backgroundIntensity = 0.92;
  scene.fog = new THREE.FogExp2(0x0d0922, 0.0021);
  const env = makeEnvironment(renderer);
  if (env) {
    scene.environment = env;
    scene.environmentIntensity = 0.70;
  }

  const camera = new THREE.PerspectiveCamera(68, container.clientWidth / container.clientHeight, 0.3, 2600);

  // --- 조명 (환경맵 + 방향광 3개로 네온 야경의 색 분리)
  const hemi = new THREE.HemisphereLight(0x6f7dff, 0x1a0a28, 0.70);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0xbfd4ff, 1.30);
  moon.position.set(-140, 190, -110);
  scene.add(moon);

  const magenta = new THREE.DirectionalLight(0xff3bd1, 0.30);
  magenta.position.set(150, 55, 190);
  scene.add(magenta);

  // (조명 수를 줄여 셰이더 비용을 낮춘다 — 환경맵이 나머지를 채운다)

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 220));

  return { renderer, scene, camera, resize, moon, hemi, env, magenta };
}

/* ---------- 캔버스 텍스처 헬퍼 (기존 호출부 호환) ---------- */
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
