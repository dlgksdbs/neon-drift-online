import * as THREE from 'three';
import { CAR_SPECS } from '../core/physics.js';
import { canvasTexture } from './scene.js';

/* =============================================================================
   carModel.js — 차량 3D 모델 (3종 실루엣) + 네온 언더글로우 / 배기 불꽃
   로컬 좌표: +Z 가 전방
   ============================================================================= */

const SHAPES = {
  coupe: { len: 4.15, wid: 1.88, bodyH: 0.46, bodyY: 0.56, cabinLen: 1.9, cabinH: 0.42, cabinZ: -0.1, nose: 0.3, spoiler: 0.5, wheelR: 0.39 },
  gt: { len: 4.45, wid: 2.0, bodyH: 0.5, bodyY: 0.58, cabinLen: 2.0, cabinH: 0.44, cabinZ: -0.16, nose: 0.24, spoiler: 0.9, wheelR: 0.41 },
  hyper: { len: 4.55, wid: 1.94, bodyH: 0.36, bodyY: 0.48, cabinLen: 1.62, cabinH: 0.4, cabinZ: 0.0, nose: 0.44, spoiler: 0.26, wheelR: 0.4 },
};

/* 옆모습 프로파일을 X축으로 압출해 자동차 실루엣을 만든다 */
function bodyGeometry(shape) {
  const L = shape.len, BH = shape.bodyH, Y = 0.16;
  const pts = [
    [-L * 0.49, Y + 0.10],
    [-L * 0.505, Y + BH * 0.7],
    [-L * 0.455, Y + BH * 1.25],
    [-L * 0.16, Y + BH * 1.55],
    [L * 0.22, Y + BH * 1.42],
    [L * 0.44, Y + BH * 1.12],
    [L * 0.505, Y + BH * 0.55],
    [L * 0.5, Y + 0.08],
  ];
  const shp = new THREE.Shape();
  shp.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shp.lineTo(pts[i][0], pts[i][1]);
  shp.lineTo(pts[0][0], pts[0][1]);
  const depth = shape.wid * 0.9;
  const geo = new THREE.ExtrudeGeometry(shp, {
    depth, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 1, curveSegments: 2,
  });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

export function createCarMesh(specKey, neonColor = '#37f3ff', opts = {}) {
  const spec = CAR_SPECS[specKey] || CAR_SPECS.coupe;
  const shape = SHAPES[spec.key];
  const g = new THREE.Group();
  const col = new THREE.Color(neonColor);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x232a3c, roughness: 0.38, metalness: 0.42, emissive: col.clone().multiplyScalar(0.05),
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: col.clone().multiplyScalar(0.55).offsetHSL(0, 0, -0.1), roughness: 0.3, metalness: 0.6,
    emissive: col.clone().multiplyScalar(0.35),
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x081024, roughness: 0.08, metalness: 0.95, emissive: 0x0b2a55, transparent: true, opacity: 0.85,
  });
  const trimMat = new THREE.MeshBasicMaterial({ color: col });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x08090f, roughness: 0.9, metalness: 0.25 });

  const W = shape.wid, L = shape.len, BH = shape.bodyH;

  // --- 메인 바디 (압출 실루엣)
  const body = new THREE.Mesh(bodyGeometry(shape), bodyMat);
  body.position.y = shape.bodyY - BH * 0.9;
  g.add(body);

  const splitter = new THREE.Mesh(new THREE.BoxGeometry(W * 0.95, 0.06, 0.34), accentMat);
  splitter.position.set(0, shape.bodyY - BH * 0.46, L * 0.46);
  g.add(splitter);

  // --- 리어 해치/디퓨저
  const rear = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, BH * 0.75, L * 0.12), bodyMat);
  rear.position.set(0, shape.bodyY + 0.02, -L * 0.44);
  g.add(rear);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(W * 0.88, 0.14, 0.4), darkMat);
  diffuser.position.set(0, shape.bodyY - BH * 0.45, -L * 0.47);
  g.add(diffuser);

  // --- 캐빈 + 루프
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.74, shape.cabinH, shape.cabinLen), glassMat);
  cabin.position.set(0, shape.bodyY + BH / 2 + shape.cabinH / 2 - 0.02, shape.cabinZ);
  g.add(cabin);
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(W * 0.76, 0.05, 1.0), glassMat);
  windshield.position.set(0, shape.bodyY + BH * 0.95, shape.cabinZ + shape.cabinLen / 2 + 0.28);
  windshield.rotation.x = 0.62;
  g.add(windshield);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W * 0.6, 0.06, shape.cabinLen * 0.72), bodyMat);
  roof.position.set(0, cabin.position.y + shape.cabinH / 2 + 0.02, shape.cabinZ - 0.05);
  g.add(roof);
  const roofNeon = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, shape.cabinLen * 0.6), trimMat);
  roofNeon.position.set(0, roof.position.y + 0.04, shape.cabinZ - 0.05);
  g.add(roofNeon);

  // --- 펜더 (바퀴 위 굴곡)
  for (const side of [-1, 1]) {
    for (const zs of [1, -1]) {
      const fender = new THREE.Mesh(new THREE.BoxGeometry(0.16, BH * 0.9, 1.24), bodyMat);
      fender.position.set(side * (W / 2 - 0.02), shape.bodyY + 0.1, zs * (L / 2 - 1.12));
      g.add(fender);
    }
  }

  // --- 사이드 네온 라인
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.055, L * 0.62), trimMat);
    stripe.position.set(side * (W / 2 + 0.005), shape.bodyY + BH * 0.18, 0);
    g.add(stripe);
    const under = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, L * 0.5), trimMat);
    under.position.set(side * (W / 2 - 0.06), shape.bodyY - BH * 0.48, 0);
    g.add(under);
  }

  // --- 리어 스포일러
  if (shape.spoiler > 0.3) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(W * 0.96, 0.05, 0.4), darkMat);
    wing.position.set(0, shape.bodyY + BH * 0.55 + shape.spoiler * 0.42, -L / 2 + 0.3);
    wing.rotation.x = 0.1;
    g.add(wing);
    for (const side of [-1, 1]) {
      const stay = new THREE.Mesh(new THREE.BoxGeometry(0.06, shape.spoiler * 0.6, 0.12), darkMat);
      stay.position.set(side * W * 0.34, shape.bodyY + BH * 0.4 + shape.spoiler * 0.2, -L / 2 + 0.3);
      g.add(stay);
    }
    const wingNeon = new THREE.Mesh(new THREE.BoxGeometry(W * 0.94, 0.028, 0.06), trimMat);
    wingNeon.position.set(0, shape.bodyY + BH * 0.58 + shape.spoiler * 0.42, -L / 2 + 0.3);
    g.add(wingNeon);
  }

  // --- 테일 라이트
  const tail = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 0.08, 0.05), new THREE.MeshBasicMaterial({ color: 0xff2456 }));
  tail.position.set(0, shape.bodyY + BH * 0.28, -L / 2 + 0.02);
  g.add(tail);
  const tailGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.9, 0.6),
    new THREE.MeshBasicMaterial({ color: 0xff2456, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  tailGlow.position.set(0, shape.bodyY + BH * 0.28, -L / 2 - 0.02);
  tailGlow.rotation.y = Math.PI;
  g.add(tailGlow);

  // --- 헤드 라이트
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 0.05), new THREE.MeshBasicMaterial({ color: 0xd8f4ff }));
    lamp.position.set(side * W * 0.28, shape.bodyY + 0.02, L * 0.485);
    g.add(lamp);
  }

  // --- 바퀴
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(shape.wheelR, shape.wheelR, 0.34, 14);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 0.9, metalness: 0.1 });
  const rimMat = new THREE.MeshBasicMaterial({ color: col });
  const wx = W / 2 - 0.03;
  const wz = L / 2 - 1.12;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const wg = new THREE.Group();
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wg.add(wheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(shape.wheelR * 0.62, 0.04, 6, 14), rimMat);
    rim.rotation.y = Math.PI / 2;
    rim.position.x = sx * 0.175;
    wg.add(rim);
    wg.position.set(sx * wx, shape.wheelR, sz * wz);
    g.add(wg);
    wheels.push({ group: wg, front: sz > 0, spin: wheel });
  }

  // --- 언더글로우
  const glowTex = canvasTexture(128, 128, (ctx, w, h) => {
    const grd = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.3)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
  });
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 2.1, L * 1.4),
    new THREE.MeshBasicMaterial({ map: glowTex, color: col, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.07;
  g.add(glow);

  // --- 배기 불꽃
  const flames = [];
  for (const side of [-1, 1]) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 1.6, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x74ecff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(side * 0.4, shape.bodyY - 0.12, -L / 2 - 0.62);
    g.add(flame);
    flames.push(flame);
  }

  // --- 이름 라벨
  let label = null;
  if (opts.label) {
    const tex = canvasTexture(256, 64, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = neonColor;
      ctx.shadowBlur = 14;
      ctx.fillText(String(opts.label).slice(0, 10), w / 2, h / 2);
    });
    label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    label.scale.set(4.4, 1.1, 1);
    label.position.set(0, 3.0, 0);
    g.add(label);
  }

  const state = { boosting: 0 };

  function update(car, dt, t) {
    g.position.set(car.x, 0, car.z);
    g.rotation.y = car.h;
    const speed = Math.abs(car.speed || 0);

    for (const w of wheels) {
      w.spin.rotation.x -= speed * dt * 2.6;
      if (w.front) w.group.rotation.y = (car.steer || 0) * 0.4;
    }
    const targetRoll = -(car.steer || 0) * 0.045 + (car.drifting ? Math.max(-0.12, Math.min(0.12, (car.slip || 0) * 0.32)) : 0);
    g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, targetRoll, Math.min(1, dt * 8));
    g.position.y = THREE.MathUtils.lerp(g.position.y, 0, Math.min(1, dt * 4));

    const boosting = (car.boostTime > 0 ? 1 : 0) + (car.nitroActive ? 0.8 : 0);
    state.boosting = THREE.MathUtils.lerp(state.boosting, Math.min(1.6, boosting), Math.min(1, dt * 10));
    for (const f of flames) {
      f.material.opacity = state.boosting > 0.05 ? 0.6 * Math.min(1, state.boosting) : 0;
      const sc = 0.75 + Math.abs(Math.sin(t * 30)) * 0.45 + state.boosting * 0.35;
      f.scale.set(1, sc, 1);
      f.material.color.setHex(state.boosting > 1.1 ? 0xffd27a : 0x74ecff);
    }
    glow.material.opacity = 0.4 + state.boosting * 0.3;
    tailGlow.material.opacity = 0.22 + (car.brake ? 0.3 : 0);
  }

  function setVisible(v) { g.visible = v; }

  return { group: g, update, setVisible, spec, shape, wheels, glow, label, bodyMat, trimMat, col };
}
