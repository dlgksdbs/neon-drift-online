import * as THREE from 'three';
import { canvasTexture } from './scene.js';
import { sample, nearest } from '../core/track.js';

/* =============================================================================
   trackMesh.js — 네온 하버 서킷 메시: 노면 · 연석 · 네온 라인 · 가드레일 ·
                  체크포인트 아치 · 부스터 패드 · 스타트 게이트 · 스카이라인
   ============================================================================= */

const COL = {
  cyan: 0x22e6ff,
  magenta: 0xff2fb0,
  violet: 0x8a5cff,
  gold: 0xffc23d,
  green: 0x39ff9e,
};

function ribbonGeometry(track, innerFn, outerFn, y, vScale = 0.06) {
  const n = track.n;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    const a = innerFn(k), b = outerFn(k);
    pos.push(a[0], y, a[1], b[0], y, b[1]);
    const v = (i * track.segLen) * vScale;
    uv.push(0, v, 1, v);
  }
  for (let i = 0; i < n; i++) {
    const p = i * 2;
    idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function asphaltTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#33333f';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 40 + Math.random() * 60;
      ctx.fillStyle = `rgba(${v},${v},${v + 10},${0.25 + Math.random() * 0.35})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5);
    }
    for (let i = 0; i < 24; i++) {
      ctx.strokeStyle = `rgba(120,150,230,${0.05 + Math.random() * 0.08})`;
      ctx.lineWidth = 1 + Math.random() * 3;
      ctx.beginPath();
      ctx.moveTo(Math.random() * w, 0);
      ctx.lineTo(Math.random() * w, h);
      ctx.stroke();
    }
  }, { repeat: [1, 1] });
}

function chevronTexture(color) {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, w, h);
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
  }, { repeat: [1, 2] });
}

function windowsTexture() {
  return canvasTexture(64, 128, (ctx, w, h) => {
    ctx.fillStyle = '#05060f';
    ctx.fillRect(0, 0, w, h);
    const pal = ['#59f0ff', '#ff6ad5', '#ffd27a', '#9d8bff', '#8affe0'];
    for (let y = 3; y < h - 3; y += 7) {
      for (let x = 4; x < w - 4; x += 6) {
        if (Math.random() > 0.52) {
          ctx.fillStyle = pal[(Math.random() * pal.length) | 0];
          ctx.globalAlpha = 0.35 + Math.random() * 0.65;
          ctx.fillRect(x, y, 3, 3);
        }
      }
    }
    ctx.globalAlpha = 1;
  }, { repeat: [1, 1] });
}

function gridTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#05030f';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(90,110,255,0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.strokeStyle = 'rgba(60,180,255,0.20)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo((w / 4) * i, 0); ctx.lineTo((w / 4) * i, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (h / 4) * i); ctx.lineTo(w, (h / 4) * i); ctx.stroke();
    }
  }, { repeat: [34, 34] });
}

function checkerTexture() {
  return canvasTexture(128, 64, (ctx, w, h) => {
    const s = 16;
    for (let y = 0; y < h / s; y++) {
      for (let x = 0; x < w / s; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#0b0b12' : '#f2f6ff';
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
  }, { repeat: [1, 1] });
}

function textTexture(text, color = '#7ef9ff', sub = null) {
  return canvasTexture(512, 160, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = 'bold 84px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 26;
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, sub ? h / 2 - 10 : h / 2);
    if (sub) {
      ctx.shadowBlur = 12;
      ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.fillText(sub, w / 2, h / 2 + 52);
    }
  });
}

export function buildTrackMeshes(scene, track, padsWorld) {
  const group = new THREE.Group();
  scene.add(group);
  const hw = track.halfWidth;

  // ---------- 바닥 그리드 ----------
  const groundTex = gridTexture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshBasicMaterial({ map: groundTex, transparent: true, opacity: 0.55, depthWrite: false, fog: true })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-10, -0.12, -20);
  group.add(ground);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    new THREE.MeshBasicMaterial({ color: 0x04030c })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(-10, -0.2, -20);
  group.add(floor);

  // ---------- 노면 ----------
  const roadMat = new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide,
    map: asphaltTexture(),
    color: 0xffffff,
    roughness: 0.52,
    metalness: 0.05,
    emissive: 0x0b0d1c,
    emissiveIntensity: 1,
  });
  roadMat.map.wrapT = THREE.RepeatWrapping;
  roadMat.map.repeat.set(1.6, 150);
  const road = new THREE.Mesh(ribbonGeometry(track,
    (k) => [track.xs[k] + track.nx[k] * hw, track.zs[k] + track.nz[k] * hw],
    (k) => [track.xs[k] - track.nx[k] * hw, track.zs[k] - track.nz[k] * hw],
    0, 0.01), roadMat);
  group.add(road);

  // ---------- 연석(커브) ----------
  const curbMat = new THREE.MeshBasicMaterial({ color: 0x3b3b52, side: THREE.DoubleSide });
  for (const side of [1, -1]) {
    const curb = new THREE.Mesh(ribbonGeometry(track,
      (k) => [track.xs[k] + track.nx[k] * hw * side, track.zs[k] + track.nz[k] * hw * side],
      (k) => [track.xs[k] + track.nx[k] * (hw + 1.1) * side, track.zs[k] + track.nz[k] * (hw + 1.1) * side],
      0.06, 0.05), curbMat);
    group.add(curb);
  }

  // ---------- 네온 라인 ----------
  const neonColors = [COL.cyan, COL.magenta];
  [1, -1].forEach((side, si) => {
    const line = new THREE.Mesh(ribbonGeometry(track,
      (k) => [track.xs[k] + track.nx[k] * (hw - 0.42) * side, track.zs[k] + track.nz[k] * (hw - 0.42) * side],
      (k) => [track.xs[k] + track.nx[k] * (hw - 0.05) * side, track.zs[k] + track.nz[k] * (hw - 0.05) * side],
      0.035, 0.05),
      new THREE.MeshBasicMaterial({ color: neonColors[si], transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    group.add(line);
    // 바닥에 번지는 빛
    const glow = new THREE.Mesh(ribbonGeometry(track,
      (k) => [track.xs[k] + track.nx[k] * (hw - 3.4) * side, track.zs[k] + track.nz[k] * (hw - 3.4) * side],
      (k) => [track.xs[k] + track.nx[k] * (hw - 0.05) * side, track.zs[k] + track.nz[k] * (hw - 0.05) * side],
      0.02, 0.05),
      new THREE.MeshBasicMaterial({ color: neonColors[si], transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    group.add(glow);
  });

  // ---------- 가드레일 (양쪽 튜브) ----------
  for (const side of [1, -1]) {
    const pts = [];
    for (let i = 0; i < track.n; i++) {
      const k = i;
      pts.push(new THREE.Vector3(
        track.xs[k] + track.nx[k] * (hw + 1.6) * side, 0.95,
        track.zs[k] + track.nz[k] * (hw + 1.6) * side
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    const railGeo = new THREE.TubeGeometry(curve, Math.round(track.n * 0.7), 0.13, 4, true);
    const rail = new THREE.Mesh(railGeo, new THREE.MeshBasicMaterial({ color: side > 0 ? 0x1b7dff : 0xff1f8f }));
    group.add(rail);
    // 낮게 흐르는 빛
    const glowPts = pts.map((p) => new THREE.Vector3(p.x, 0.18, p.z));
    const glowCurve = new THREE.CatmullRomCurve3(glowPts, true, 'centripetal');
    const glowRail = new THREE.Mesh(
      new THREE.TubeGeometry(glowCurve, Math.round(track.n * 0.5), 0.22, 4, true),
      new THREE.MeshBasicMaterial({ color: side > 0 ? 0x22e6ff : 0xff2fb0, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    group.add(glowRail);

    // 기둥
    const postGeo = new THREE.BoxGeometry(0.16, 1.0, 0.16);
    const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshBasicMaterial({ color: 0x2a3b6b }), Math.floor(track.n / 3));
    const m = new THREE.Matrix4();
    let pi = 0;
    for (let i = 0; i < track.n && pi < posts.count; i += 3) {
      const k = i;
      m.makeTranslation(
        track.xs[k] + track.nx[k] * (hw + 1.6) * side, 0.48,
        track.zs[k] + track.nz[k] * (hw + 1.6) * side
      );
      posts.setMatrixAt(pi++, m);
    }
    posts.instanceMatrix.needsUpdate = true;
    group.add(posts);
  }

  // ---------- 중앙 점선 ----------
  const dashGeo = new THREE.PlaneGeometry(0.28, 2.6);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xaabbdd, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const dashCount = Math.floor(track.total / 10);
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashCount);
  const dm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < dashCount; i++) {
    const s = i * 10;
    const p = sample(track, s, 0);
    e.set(-Math.PI / 2, 0, -p.heading);
    q.setFromEuler(e);
    v.set(p.x, 0.03, p.z);
    dm.compose(v, q, sc);
    dashes.setMatrixAt(i, dm);
  }
  dashes.instanceMatrix.needsUpdate = true;
  group.add(dashes);

  // ---------- 가로등 + 반사 기둥 (속도감) ----------
  const lampTex = canvasTexture(64, 64, (ctx, w, h) => {
    const grd = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(200,240,255,0.7)');
    grd.addColorStop(1, 'rgba(120,180,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
  });
  const lampPositions = [];
  const lampPoleGeo = new THREE.BoxGeometry(0.18, 6.4, 0.18);
  const lampPoleMat = new THREE.MeshBasicMaterial({ color: 0x26304d });
  const lampPoles = new THREE.InstancedMesh(lampPoleGeo, lampPoleMat, Math.floor(track.total / 42) + 4);
  const lm = new THREE.Matrix4();
  let li = 0;
  for (let sPos = 0; sPos < track.total; sPos += 42) {
    const side = (Math.floor(sPos / 42) % 2) ? 1 : -1;
    const p = sample(track, sPos, (hw + 3.2) * side);
    if (li < lampPoles.count) {
      lm.makeTranslation(p.x, 3.2, p.z);
      lampPoles.setMatrixAt(li++, lm);
    }
    lampPositions.push(p.x, 6.4, p.z);
    // 가로등 머리 (도로 쪽으로 뻗는 암)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.12), lampPoleMat);
    arm.position.set(p.x - p.nx * side * 0.9, 6.35, p.z - p.nz * side * 0.9);
    arm.rotation.y = p.heading;
    group.add(arm);
  }
  lampPoles.count = li;
  lampPoles.instanceMatrix.needsUpdate = true;
  group.add(lampPoles);

  const lampGeo = new THREE.BufferGeometry();
  lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPositions, 3));
  const lamps = new THREE.Points(lampGeo, new THREE.PointsMaterial({
    map: lampTex, color: 0xbfe8ff, size: 5.2, sizeAttenuation: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.95,
  }));
  group.add(lamps);

  // 반사 기둥 (레일 아래 작은 네온)
  const reflGeo = new THREE.BoxGeometry(0.1, 0.34, 0.1);
  const reflCount = Math.floor(track.total / 6) * 2;
  const refl = new THREE.InstancedMesh(reflGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), reflCount);
  const rm = new THREE.Matrix4();
  const rc = new THREE.Color();
  let ri = 0;
  for (let sPos = 0; sPos < track.total && ri < reflCount - 1; sPos += 6) {
    for (const side of [1, -1]) {
      const p = sample(track, sPos, (hw + 1.25) * side);
      rm.makeTranslation(p.x, 0.62, p.z);
      refl.setMatrixAt(ri, rm);
      rc.setHex(side > 0 ? 0x39d7ff : 0xff4fc0);
      refl.setColorAt(ri, rc);
      ri++;
    }
  }
  refl.count = ri;
  refl.instanceMatrix.needsUpdate = true;
  if (refl.instanceColor) refl.instanceColor.needsUpdate = true;
  group.add(refl);

  // ---------- 스타트/피니시 ----------
  const p0 = sample(track, 0, 0);
  const startGroup = new THREE.Group();
  startGroup.position.set(p0.x, 0, p0.z);
  startGroup.rotation.y = p0.heading;
  const checker = new THREE.Mesh(
    new THREE.PlaneGeometry(track.halfWidth * 2, 3.2),
    new THREE.MeshBasicMaterial({ map: checkerTexture(), transparent: true, opacity: 0.92 })
  );
  checker.rotation.x = -Math.PI / 2;
  checker.position.y = 0.04;
  startGroup.add(checker);

  const gantryMat = new THREE.MeshBasicMaterial({ color: 0x1c2b52 });
  const pillarGeo = new THREE.BoxGeometry(0.7, 8.4, 0.7);
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(pillarGeo, gantryMat);
    pillar.position.set(side * (hw + 1.2), 4.2, 0);
    startGroup.add(pillar);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 8.0, 0.16), new THREE.MeshBasicMaterial({ color: COL.cyan }));
    strip.position.set(side * (hw + 1.15), 4.2, 0.42);
    startGroup.add(strip);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry((hw + 1.6) * 2, 1.2, 0.5), gantryMat);
  beam.position.y = 8.6;
  startGroup.add(beam);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 2.0),
    new THREE.MeshBasicMaterial({ map: textTexture('START', '#8ef8ff', 'NEON HARBOR'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  banner.position.set(0, 9.0, 0.35);
  startGroup.add(banner);
  const bannerBack = banner.clone();
  bannerBack.position.set(0, 9.0, -0.35);
  bannerBack.rotation.y = Math.PI;
  startGroup.add(bannerBack);
  group.add(startGroup);

  // ---------- 체크포인트 아치 ----------
  const arches = [];
  track.checkpoints.forEach((cp, idx) => {
    if (idx === 0) return;
    const g = new THREE.Group();
    const p = sample(track, cp.s, 0);
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.heading;
    const pillarGeo2 = new THREE.BoxGeometry(0.55, 6.2, 0.55);
    const mat = new THREE.MeshBasicMaterial({ color: 0x6a3bb0 });
    const parts = [];
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(pillarGeo2, mat.clone());
      pillar.position.set(side * (hw + 0.6), 3.1, 0);
      g.add(pillar);
      parts.push(pillar);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry((hw + 0.9) * 2, 0.5, 0.5), mat.clone());
    top.position.y = 6.1;
    g.add(top);
    parts.push(top);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry((hw + 0.9) * 2, 6.6),
      new THREE.MeshBasicMaterial({ color: COL.green, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    glow.position.y = 3.2;
    g.add(glow);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 1.4),
      new THREE.MeshBasicMaterial({ map: textTexture(String(idx), '#b28bff'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    label.position.set(0, 6.15, 0.3);
    g.add(label);
    group.add(g);
    arches.push({ group: g, parts, glow, mat, idx, s: cp.s });
  });

  function setActiveCheckpoint(cpIndex) {
    for (const a of arches) {
      const active = a.idx === cpIndex;
      const color = active ? 0x39ff9e : 0x5c2f9c;
      for (const part of a.parts) part.material.color.setHex(color);
      a.glow.material.opacity = active ? 0.16 : 0.0;
      a.glow.material.color.setHex(active ? 0x39ff9e : 0x5c2f9c);
    }
  }

  // ---------- 부스터 패드 ----------
  const pads = [];
  const padTex = chevronTexture('#7ef9ff');
  const padTexB = chevronTexture('#ffb43d');
  for (const p of padsWorld) {
    const mat = new THREE.MeshBasicMaterial({
      map: p.i % 2 === 0 ? padTex.clone() : padTexB.clone(),
      transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    mat.map.needsUpdate = true;
    mat.map.wrapT = THREE.RepeatWrapping;
    mat.map.wrapS = THREE.RepeatWrapping;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.width, p.len), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(p.x, 0.05, p.z);
    mesh.rotation.z = -p.heading;
    group.add(mesh);
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(p.width + 1.0, p.len + 1.0),
      new THREE.MeshBasicMaterial({ color: p.i % 2 === 0 ? 0x1a6cff : 0xff9a1a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    frame.rotation.x = -Math.PI / 2;
    frame.position.set(p.x, 0.035, p.z);
    frame.rotation.z = -p.heading;
    group.add(frame);
    pads.push({ ...p, mesh, mat, frame });
  }

  // ---------- 스카이라인 ----------
  const winTex = windowsTexture();
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildingMat = new THREE.MeshBasicMaterial({ map: winTex, color: 0x8a86c8, fog: true });
  const COUNT = 170;
  const buildings = new THREE.InstancedMesh(buildingGeo, buildingMat, COUNT);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let placed = 0, guard = 0;
  while (placed < COUNT && guard++ < 4000) {
    const a = Math.random() * Math.PI * 2;
    const r = 90 + Math.random() * 430;
    const x = -10 + Math.cos(a) * r * 1.15;
    const z = -20 + Math.sin(a) * r;
    const near = nearest(track, x, z, -1);
    if (Math.abs(near.lateral) < hw + 26) continue;
    const w = 10 + Math.random() * 26;
    const d = 10 + Math.random() * 26;
    const h = 18 + Math.pow(Math.random(), 1.7) * 150;
    dummy.position.set(x, h / 2 - 2, z);
    dummy.scale.set(w, h, d);
    dummy.rotation.y = Math.random() * Math.PI;
    dummy.updateMatrix();
    buildings.setMatrixAt(placed, dummy.matrix);
    const t = Math.random();
    color.setRGB(0.55 + t * 0.35, 0.5 + t * 0.2, 0.75 + (1 - t) * 0.25);
    buildings.setColorAt(placed, color);
    placed++;
  }
  buildings.count = placed;
  buildings.instanceMatrix.needsUpdate = true;
  if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
  group.add(buildings);

  // ---------- 네온 사인 ----------
  const signTexts = [
    ['NEON', '#31f7ff'], ['DRIFT', '#ff36c8'], ['88', '#ffd24a'],
    ['HARBOR', '#7d6bff'], ['TURBO', '#39ff9e'],
  ];
  const signs = [];
  for (let i = 0; i < signTexts.length; i++) {
    const angle = (i / signTexts.length) * Math.PI * 2 + 0.4;
    const r = 200 + (i % 3) * 90;
    const x = -10 + Math.cos(angle) * r;
    const z = -20 + Math.sin(angle) * r;
    const near = nearest(track, x, z, -1);
    if (Math.abs(near.lateral) < hw + 30) continue;
    const h = 40 + (i % 4) * 26;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 8),
      new THREE.MeshBasicMaterial({
        map: textTexture(signTexts[i][0], signTexts[i][1]),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    mesh.position.set(x, h, z);
    mesh.rotation.y = Math.atan2(-x + 0.0, -z + 0.0) + Math.PI * (i % 2);
    group.add(mesh);
    signs.push(mesh);
  }

  const padOffset = { a: 0, b: 0 };
  function update(dt, t, activeCp) {
    padOffset.a = (padOffset.a + dt * 2.4) % 1;
    for (const p of pads) {
      p.mat.map.offset.y = -((t * 1.6 + p.i * 0.3) % 1);
      p.frame.material.opacity = 0.16 + 0.12 * (0.5 + 0.5 * Math.sin(t * 4 + p.i));
    }
    for (let i = 0; i < signs.length; i++) {
      signs[i].material.opacity = 0.82 + 0.18 * Math.sin(t * 3.1 + i * 1.7);
    }
    if (activeCp !== undefined) setActiveCheckpoint(activeCp);
  }

  return { group, arches, pads, setActiveCheckpoint, update, startGroup, COL };
}
