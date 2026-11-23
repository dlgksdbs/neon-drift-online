import * as THREE from 'three';
import { sample, nearest } from '../core/track.js';
import {
  asphaltTexture, asphaltNormalTexture, asphaltRoughTexture, chevronTexture, checkerTexture,
  textTexture, windowTexture, glowTexture, softGlowTexture, waterMaterial, makeCanvas, tex,
} from './materials.js';
import { mergeGeometries, mergeColored, placed } from './meshUtil.js';

/* =============================================================================
   trackMesh.js — 네온 하버 서킷: 젖은 노면 · 연석 · 가드레일 · 조명 · 아치 ·
                  네온 링/터널 · 하버 수면 · 스카이라인 · 사인
   ============================================================================= */

const COL = {
  cyan: 0x22e6ff,
  magenta: 0xff2fb0,
  violet: 0x8a5cff,
  gold: 0xffc23d,
  green: 0x39ff9e,
  blue: 0x1b7dff,
};

function ribbonGeometry(track, innerFn, outerFn, y, vScale = 0.06) {
  const n = track.n;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    const a = innerFn(k), b = outerFn(k);
    pos.push(a[0], typeof y === 'function' ? y(k, a) : y, a[1], b[0], typeof y === 'function' ? y(k, b) : y, b[1]);
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

/* 지면: 사각형에 하버 수면 구멍을 낸다 (도형 y = -worldZ) */
function groundWithBasin(size, basin, cx = -10, cz = -20) {
  const s = new THREE.Shape();
  const h2 = size / 2;
  s.moveTo(cx - h2, -(cz - h2));
  s.lineTo(cx + h2, -(cz - h2));
  s.lineTo(cx + h2, -(cz + h2));
  s.lineTo(cx - h2, -(cz + h2));
  s.lineTo(cx - h2, -(cz - h2));
  const h = new THREE.Path();
  h.moveTo(basin.x0, -basin.z0);
  h.lineTo(basin.x0, -basin.z1);
  h.lineTo(basin.x1, -basin.z1);
  h.lineTo(basin.x1, -basin.z0);
  h.lineTo(basin.x0, -basin.z0);
  s.holes.push(h);
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);   // XY -> XZ (법선 +Y)
  return g;
}

export function buildTrackMeshes(scene, track, padsWorld) {
  const group = new THREE.Group();
  scene.add(group);
  const hw = track.halfWidth;

  /* ---------------- 하버 수면 ---------------- */
  const BASIN = { x0: -760, x1: -250, z0: -680, z1: 760 };
  const waterMat = waterMaterial();
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(BASIN.x1 - BASIN.x0, BASIN.z1 - BASIN.z0),
    waterMat
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set((BASIN.x0 + BASIN.x1) / 2, -0.42, (BASIN.z0 + BASIN.z1) / 2);
  group.add(water);

  // 부두 벽 + 네온 엣지
  const quayParts = [];
  const quayNeon = [];
  const quayX = BASIN.x1;
  quayParts.push(placed(new THREE.BoxGeometry(2.4, 1.1, BASIN.z1 - BASIN.z0), {
    pos: [quayX + 1.2, -0.42, (BASIN.z0 + BASIN.z1) / 2],
  }));
  quayNeon.push(placed(new THREE.BoxGeometry(0.16, 0.14, BASIN.z1 - BASIN.z0), {
    pos: [quayX - 0.05, 0.12, (BASIN.z0 + BASIN.z1) / 2],
  }));
  group.add(new THREE.Mesh(mergeGeometries(quayParts), new THREE.MeshStandardMaterial({
    color: 0x1a1d2c, roughness: 0.75, metalness: 0.25,
  })));
  group.add(new THREE.Mesh(mergeGeometries(quayNeon), new THREE.MeshBasicMaterial({ color: COL.cyan })));

  /* ---------------- 지면 ---------------- */
  const groundTex = tex(makeCanvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#080a14';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(70,110,255,0.30)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.strokeStyle = 'rgba(50,190,255,0.14)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo((w / 4) * i, 0); ctx.lineTo((w / 4) * i, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (h / 4) * i); ctx.lineTo(w, (h / 4) * i); ctx.stroke();
    }
    // 미세한 반점
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = `rgba(90,120,200,${0.03 + Math.random() * 0.05})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }), { repeat: [30, 30], srgb: true });
  const ground = new THREE.Mesh(
    groundWithBasin(3000, BASIN),
    new THREE.MeshStandardMaterial({
      map: groundTex, color: 0x9aa4c8, roughness: 0.55, metalness: 0.35,
      envMapIntensity: 0.6,
    })
  );
  ground.position.set(0, -0.14, 0);
  group.add(ground);

  /* ---------------- 노면 ---------------- */
  const asphaltMap = asphaltTexture();
  const normalMap = asphaltNormalTexture();
  const roughMap = asphaltRoughTexture();
  const RX = 2.0, RY = 34;
  for (const m of [asphaltMap, normalMap, roughMap]) {
    m.wrapS = m.wrapT = THREE.RepeatWrapping;
    m.repeat.set(RX, RY);
  }
  const roadMat = new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide,
    map: asphaltMap,
    normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: roughMap,
    roughness: 1.0,
    metalness: 0.26,
    color: 0xffffff,
    envMapIntensity: 0.85,
    emissive: 0x05060f,
    emissiveIntensity: 1,
  });
  const road = new THREE.Mesh(ribbonGeometry(track,
    (k) => [track.xs[k] + track.nx[k] * hw, track.zs[k] + track.nz[k] * hw],
    (k) => [track.xs[k] - track.nx[k] * hw, track.zs[k] - track.nz[k] * hw],
    0, 0.01), roadMat);
  group.add(road);

  // 어깨(노면 밖 그라운드와 경계 정리)
  const shoulderMat = new THREE.MeshStandardMaterial({
    color: 0x14161f, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide, envMapIntensity: 0.5,
  });
  for (const side of [1, -1]) {
    const sh = new THREE.Mesh(ribbonGeometry(track,
      (k) => [track.xs[k] + track.nx[k] * hw * side, track.zs[k] + track.nz[k] * hw * side],
      (k) => [track.xs[k] + track.nx[k] * (hw + 2.6) * side, track.zs[k] + track.nz[k] * (hw + 2.6) * side],
      -0.02, 0.05), shoulderMat);
    group.add(sh);
  }

  /* ---------------- 연석 (코너 레드-네온) ---------------- */
  const curbGeo = new THREE.BoxGeometry(1.15, 0.10, 2.6);
  const curbPositions = [];
  for (let i = 0; i < track.n; i++) {
    const curv = track.curvature[i];
    if (curv < 0.0105) continue;
    for (const side of [1, -1]) {
      const p = sample(track, i * track.segLen, (hw + 0.58) * side);
      curbPositions.push({ p, side, i });
    }
  }
  const curbs = new THREE.InstancedMesh(curbGeo, new THREE.MeshStandardMaterial({
    vertexColors: false, roughness: 0.45, metalness: 0.2, emissive: 0x330011, emissiveIntensity: 0.6,
  }), Math.max(1, curbPositions.length));
  const cm = new THREE.Matrix4(), cq = new THREE.Quaternion(), ce = new THREE.Euler(), cv = new THREE.Vector3(), cs = new THREE.Vector3(1, 1, 1);
  const cc = new THREE.Color();
  curbPositions.forEach((c, i) => {
    ce.set(0, c.p.heading, 0);
    cq.setFromEuler(ce);
    cv.set(c.p.x, 0.045, c.p.z);
    cm.compose(cv, cq, cs);
    curbs.setMatrixAt(i, cm);
    cc.setHex(i % 2 ? 0xe8ecf5 : 0xff2a52);
    curbs.setColorAt(i, cc);
  });
  curbs.count = curbPositions.length;
  curbs.instanceMatrix.needsUpdate = true;
  if (curbs.instanceColor) curbs.instanceColor.needsUpdate = true;
  group.add(curbs);

  /* ---------------- 네온 라인 + 이동 펄스 ---------------- */
  // 좌/우 라인 색이 달라서 재질을 둘로 (각 1 draw)
  const edgeMats = [COL.cyan, COL.magenta];
  [1, -1].forEach((side, si) => {
    const line = new THREE.Mesh(ribbonGeometry(track,
      (k) => [track.xs[k] + track.nx[k] * (hw - 0.55) * side, track.zs[k] + track.nz[k] * (hw - 0.55) * side],
      (k) => [track.xs[k] + track.nx[k] * (hw - 0.10) * side, track.zs[k] + track.nz[k] * (hw - 0.10) * side],
      0.038, 0.05),
      new THREE.MeshBasicMaterial({
        color: edgeMats[si], transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
    group.add(line);
    const glow = new THREE.Mesh(ribbonGeometry(track,
      (k) => [track.xs[k] + track.nx[k] * (hw - 4.2) * side, track.zs[k] + track.nz[k] * (hw - 4.2) * side],
      (k) => [track.xs[k] + track.nx[k] * (hw - 0.10) * side, track.zs[k] + track.nz[k] * (hw - 0.10) * side],
      0.018, 0.05),
      new THREE.MeshBasicMaterial({
        color: edgeMats[si], transparent: true, opacity: 0.11,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
    group.add(glow);
  });
  // 펄스 (양쪽을 한 지오메트리로 합쳐 1 draw)
  const pulseTex = tex(makeCanvas(8, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.36, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.64, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }), { repeat: [1, 1], srgb: true });
  pulseTex.wrapS = pulseTex.wrapT = THREE.RepeatWrapping;
  const pulseParts = [];
  for (const side of [1, -1]) {
    pulseParts.push(ribbonGeometry(track,
      (k) => [track.xs[k] + track.nx[k] * (hw - 1.3) * side, track.zs[k] + track.nz[k] * (hw - 1.3) * side],
      (k) => [track.xs[k] + track.nx[k] * (hw - 0.35) * side, track.zs[k] + track.nz[k] * (hw - 0.35) * side],
      0.042, 0.02));
  }
  const pulse = new THREE.Mesh(mergeGeometries(pulseParts), new THREE.MeshBasicMaterial({
    map: pulseTex, color: 0xa8f4ff, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  group.add(pulse);

  // 중앙 점선
  const dashGeo = new THREE.PlaneGeometry(0.22, 2.4);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  const dashCount = Math.floor(track.total / 9);
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashCount);
  const dm = new THREE.Matrix4(), dq = new THREE.Quaternion(), de = new THREE.Euler(), dv = new THREE.Vector3(), ds = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < dashCount; i++) {
    const p = sample(track, i * 9, 0);
    de.set(-Math.PI / 2, 0, -p.heading);
    dq.setFromEuler(de);
    dv.set(p.x, 0.03, p.z);
    dm.compose(dv, dq, ds);
    dashes.setMatrixAt(i, dm);
  }
  dashes.instanceMatrix.needsUpdate = true;
  group.add(dashes);

  /* ---------------- 가드레일 ---------------- */
  const railPostGeo = new THREE.BoxGeometry(0.16, 1.1, 0.16);
  const railPosts = [];
  for (const side of [1, -1]) {
    const pts = [];
    for (let i = 0; i < track.n; i++) {
      pts.push(new THREE.Vector3(
        track.xs[i] + track.nx[i] * (hw + 1.75) * side, 1.0,
        track.zs[i] + track.nz[i] * (hw + 1.75) * side
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    const rail = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.round(track.n * 0.8), 0.11, 5, true),
      new THREE.MeshStandardMaterial({
        color: 0x2a3350, metalness: 0.9, roughness: 0.45, envMapIntensity: 0.7,
      })
    );
    group.add(rail);
    // 위쪽 발광 레일
    const topPts = pts.map((p) => new THREE.Vector3(p.x, 1.12, p.z));
    const topCurve = new THREE.CatmullRomCurve3(topPts, true, 'centripetal');
    const glowRail = new THREE.Mesh(
      new THREE.TubeGeometry(topCurve, Math.round(track.n * 0.55), 0.055, 4, true),
      new THREE.MeshBasicMaterial({
        color: side > 0 ? COL.cyan : COL.magenta, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    group.add(glowRail);
    for (let i = 0; i < track.n; i += 5) {
      railPosts.push([
        track.xs[i] + track.nx[i] * (hw + 1.75) * side,
        track.zs[i] + track.nz[i] * (hw + 1.75) * side,
      ]);
    }
  }
  const postMesh = new THREE.InstancedMesh(
    railPostGeo,
    new THREE.MeshStandardMaterial({ color: 0x1c2338, metalness: 0.8, roughness: 0.45 }),
    railPosts.length
  );
  const pm = new THREE.Matrix4();
  railPosts.forEach(([x, z], i) => { pm.makeTranslation(x, 0.55, z); postMesh.setMatrixAt(i, pm); });
  postMesh.instanceMatrix.needsUpdate = true;
  group.add(postMesh);

  // 반사판 (레일 아래 작은 네온)
  const reflGeo = new THREE.BoxGeometry(0.10, 0.30, 0.10);
  const reflCount = Math.floor(track.total / 7) * 2 + 4;
  const refl = new THREE.InstancedMesh(reflGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), reflCount);
  const rm = new THREE.Matrix4();
  const rc = new THREE.Color();
  let ri = 0;
  for (let sPos = 0; sPos < track.total && ri < reflCount - 1; sPos += 7) {
    for (const side of [1, -1]) {
      const p = sample(track, sPos, (hw + 1.35) * side);
      rm.makeTranslation(p.x, 0.58, p.z);
      refl.setMatrixAt(ri, rm);
      rc.setHex(side > 0 ? 0x3ce0ff : 0xff4fc0);
      refl.setColorAt(ri, rc);
      ri++;
    }
  }
  refl.count = ri;
  refl.instanceMatrix.needsUpdate = true;
  if (refl.instanceColor) refl.instanceColor.needsUpdate = true;
  group.add(refl);

  /* ---------------- 가로등 ---------------- */
  const lampHeadTex = glowTexture();
  const lampPoleGeo = mergeGeometries([
    placed(new THREE.BoxGeometry(0.16, 7.0, 0.16), { pos: [0, 3.5, 0] }),
    placed(new THREE.BoxGeometry(2.0, 0.10, 0.10), { pos: [-0.9, 6.95, 0] }),
  ]);
  const lampPoleMat = new THREE.MeshStandardMaterial({ color: 0x26304d, metalness: 0.8, roughness: 0.4 });
  const lampCount = Math.floor(track.total / 36) + 2;
  const lampPoles = new THREE.InstancedMesh(lampPoleGeo, lampPoleMat, lampCount);
  const lampPositions = [];
  const lm = new THREE.Matrix4(), lq = new THREE.Quaternion(), le = new THREE.Euler();
  let li = 0;
  for (let sPos = 0; sPos < track.total && li < lampCount; sPos += 36) {
    const side = (Math.floor(sPos / 36) % 2) ? 1 : -1;
    const p = sample(track, sPos, (hw + 3.6) * side);
    le.set(0, p.heading + (side > 0 ? 0 : Math.PI), 0);
    lq.setFromEuler(le);
    lm.compose(new THREE.Vector3(p.x, 0, p.z), lq, new THREE.Vector3(1, 1, 1));
    lampPoles.setMatrixAt(li++, lm);
    const hx = p.x - p.nx * side * 1.6, hz = p.z - p.nz * side * 1.6;
    lampPositions.push(hx, 6.85, hz);
  }
  lampPoles.count = li;
  lampPoles.instanceMatrix.needsUpdate = true;
  group.add(lampPoles);

  // 조명 기둥(도로 양옆 네온 포스트)
  const corridorGeo = new THREE.BoxGeometry(0.10, 2.6, 0.10);
  const corridor = new THREE.InstancedMesh(corridorGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }), Math.floor(track.total / 22) * 2 + 4);
  const corM = new THREE.Matrix4();
  const corC = new THREE.Color();
  let ci = 0;
  for (let sPos = 0; sPos < track.total && ci < corridor.count - 1; sPos += 22) {
    for (const side of [1, -1]) {
      const p = sample(track, sPos, (hw + 2.15) * side);
      corM.makeTranslation(p.x, 1.3, p.z);
      corridor.setMatrixAt(ci, corM);
      const t = (sPos / track.total) * 2;
      corC.setHex(side > 0 ? (t % 1 < 0.5 ? COL.cyan : COL.violet) : (t % 1 < 0.5 ? COL.magenta : COL.gold));
      corridor.setColorAt(ci, corC);
      ci++;
    }
  }
  corridor.count = ci;
  corridor.instanceMatrix.needsUpdate = true;
  if (corridor.instanceColor) corridor.instanceColor.needsUpdate = true;
  group.add(corridor);

  // 글로우 스프라이트 풀 (가로등 불빛)
  const lampGeo = new THREE.BufferGeometry();
  lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPositions, 3));
  const lamps = new THREE.Points(lampGeo, new THREE.PointsMaterial({
    map: lampHeadTex, color: 0xbfe8ff, size: 4.6, sizeAttenuation: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.95,
  }));
  group.add(lamps);

  /* ---------------- 스타트 게이트 ---------------- */
  const p0 = sample(track, 0, 0);
  const startGroup = new THREE.Group();
  startGroup.position.set(p0.x, 0, p0.z);
  startGroup.rotation.y = p0.heading;
  const startStruct = [];
  const startNeon = [];
  const pillarW = hw + 2.4;
  for (const side of [-1, 1]) {
    startStruct.push(placed(new THREE.BoxGeometry(0.9, 10.4, 0.9), { pos: [side * pillarW, 5.2, 0] }));
    startNeon.push(placed(new THREE.BoxGeometry(0.14, 10.0, 0.14), { pos: [side * (pillarW - 0.5), 5.2, 0.48] }));
    startNeon.push(placed(new THREE.BoxGeometry(0.14, 10.0, 0.14), { pos: [side * (pillarW + 0.5), 5.2, -0.48] }));
    // 기둥을 감는 네온 링
    for (let k = 0; k < 5; k++) {
      const ring = new THREE.TorusGeometry(0.72, 0.045, 5, 16);
      ring.rotateX(Math.PI / 2);
      startNeon.push(placed(ring, { pos: [side * pillarW, 1.0 + k * 2.0, 0] }));
    }
  }
  startStruct.push(placed(new THREE.BoxGeometry(pillarW * 2 + 1.4, 1.0, 0.9), { pos: [0, 10.7, 0] }));
  startStruct.push(placed(new THREE.BoxGeometry(pillarW * 2 + 2.0, 0.24, 1.6), { pos: [0, 10.1, 0] }));
  startNeon.push(placed(new THREE.BoxGeometry(pillarW * 2 + 0.2, 0.13, 0.13), { pos: [0, 10.05, 0.52] }));
  startNeon.push(placed(new THREE.BoxGeometry(pillarW * 2 + 0.2, 0.13, 0.13), { pos: [0, 10.05, -0.52] }));
  startNeon.push(placed(new THREE.BoxGeometry(pillarW * 2 + 0.2, 0.06, 0.06), { pos: [0, 9.6, 0.5] }));
  startGroup.add(new THREE.Mesh(mergeGeometries(startStruct), new THREE.MeshStandardMaterial({
    color: 0x141a2e, metalness: 0.85, roughness: 0.33, envMapIntensity: 1.1,
  })));
  startGroup.add(new THREE.Mesh(mergeGeometries(startNeon), new THREE.MeshBasicMaterial({ color: COL.cyan })));

  const checker = new THREE.Mesh(
    new THREE.PlaneGeometry(hw * 2, 3.4),
    new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.55, metalness: 0.1, transparent: true, opacity: 0.95 })
  );
  checker.rotation.x = -Math.PI / 2;
  checker.position.y = 0.045;
  startGroup.add(checker);

  const bannerMat = new THREE.MeshBasicMaterial({
    map: textTexture('NEON DRIFT', '#9ceaff', 'HARBOR CIRCUIT', { w: 1024, h: 256 }),
    transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  for (const [z, ry] of [[0.5, 0], [-0.5, Math.PI]]) {
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(pillarW * 1.6, 2.4), bannerMat);
    banner.position.set(0, 9.05, z);
    banner.rotation.y = ry;
    startGroup.add(banner);
  }
  // 스타트 라인 화살표
  const chev = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 6.0),
    new THREE.MeshBasicMaterial({ map: chevronTexture('#8ef8ff'), transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  chev.rotation.x = -Math.PI / 2;
  chev.rotation.z = Math.PI;
  chev.position.set(0, 0.05, -6);
  startGroup.add(chev);
  group.add(startGroup);

  /* ---------------- 체크포인트 아치 (인스턴싱) ---------------- */
  const archStructGeo = mergeGeometries([
    placed(new THREE.BoxGeometry(0.5, 6.4, 0.5), { pos: [-(hw + 0.7), 3.2, 0] }),
    placed(new THREE.BoxGeometry(0.5, 6.4, 0.5), { pos: [hw + 0.7, 3.2, 0] }),
    placed(new THREE.BoxGeometry((hw + 1.0) * 2, 0.45, 0.45), { pos: [0, 6.3, 0] }),
  ]);
  const archGlowGeo = new THREE.PlaneGeometry((hw + 1.0) * 2, 6.6);
  const cps = track.checkpoints.filter((cp, idx) => idx !== 0);
  const archStruct = new THREE.InstancedMesh(archStructGeo, new THREE.MeshStandardMaterial({
    color: 0x2a1e4a, metalness: 0.8, roughness: 0.35, emissive: 0x1a0b33, emissiveIntensity: 0.8,
  }), cps.length);
  const archGlow = new THREE.InstancedMesh(archGlowGeo, new THREE.MeshBasicMaterial({
    color: COL.green, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  }), cps.length);
  const archLabels = [];
  const arches = [];
  const am = new THREE.Matrix4(), aq = new THREE.Quaternion(), ae = new THREE.Euler();
  cps.forEach((cp, i) => {
    const p = sample(track, cp.s, 0);
    ae.set(0, p.heading, 0);
    aq.setFromEuler(ae);
    am.compose(new THREE.Vector3(p.x, 0, p.z), aq, new THREE.Vector3(1, 1, 1));
    archStruct.setMatrixAt(i, am);
    const gm = new THREE.Matrix4().compose(new THREE.Vector3(p.x, 3.2, p.z), aq, new THREE.Vector3(1, 1, 1));
    archGlow.setMatrixAt(i, gm);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(4.0, 1.3),
      new THREE.MeshBasicMaterial({
        map: textTexture(String(i + 1), '#c9a6ff', null, { w: 256, h: 128 }),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    label.position.set(0, 6.3, 0.32);
    label.rotation.y = p.heading;
    const holder = new THREE.Group();
    holder.position.set(p.x, 0, p.z);
    holder.rotation.y = p.heading;
    label.position.set(0, 6.35, 0.3);
    holder.add(label);
    group.add(holder);
    archLabels.push(label);
    arches.push({ group: holder, glow: null, label, idx: i + 1, s: cp.s });
  });
  archStruct.instanceMatrix.needsUpdate = true;
  archGlow.instanceMatrix.needsUpdate = true;
  group.add(archStruct, archGlow);
  const archColor = new THREE.Color();
  function setActiveCheckpoint(cpIndex) {
    for (let i = 0; i < cps.length; i++) {
      const active = (i + 1) === cpIndex;
      archColor.setHex(active ? COL.green : 0x3a2160);
      archStruct.setColorAt(i, archColor);
      archLabels[i].material.color.setHex(active ? 0xffffff : 0x8f7ab8);
    }
    if (archStruct.instanceColor) archStruct.instanceColor.needsUpdate = true;
    archGlow.material.opacity = 0.10;
  }
  // instanceColor 를 쓰려면 초기 색을 채워야 한다
  for (let i = 0; i < cps.length; i++) archStruct.setColorAt(i, archColor.setHex(0x3a2160));
  if (archStruct.instanceColor) archStruct.instanceColor.needsUpdate = true;

  /* ---------------- 네온 링 (터널感) ---------------- */
  const ringGeo = new THREE.TorusGeometry(hw + 3.0, 0.13, 6, 26);
  const ringCount = 26;
  const rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false,
  }), ringCount);
  const ringM = new THREE.Matrix4();
  const ringColor = new THREE.Color();
  for (let i = 0; i < ringCount; i++) {
    const s = (i / ringCount) * track.total;
    const p = sample(track, s, 0);
    ringM.compose(
      new THREE.Vector3(p.x, 2.2, p.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.heading, 0)),
      new THREE.Vector3(1, 1, 1)
    );
    rings.setMatrixAt(i, ringM);
    const pal = [COL.cyan, COL.magenta, COL.violet, COL.blue];
    ringColor.setHex(pal[i % pal.length]);
    rings.setColorAt(i, ringColor);
  }
  rings.instanceMatrix.needsUpdate = true;
  if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
  group.add(rings);

  /* ---------------- 부스터 패드 ---------------- */
  const pads = [];
  const padTexA = chevronTexture('#7ef9ff');
  const padTexB = chevronTexture('#ffb43d');
  for (const p of padsWorld) {
    const mat = new THREE.MeshBasicMaterial({
      map: (p.i % 2 === 0 ? padTexA : padTexB).clone(),
      transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    mat.map.needsUpdate = true;
    mat.map.wrapT = THREE.RepeatWrapping;
    mat.map.wrapS = THREE.RepeatWrapping;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.width, p.len), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(p.x, 0.055, p.z);
    mesh.rotation.z = -p.heading;
    group.add(mesh);
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(p.width + 1.4, p.len + 1.4),
      new THREE.MeshBasicMaterial({
        map: softGlowTexture(), color: p.i % 2 === 0 ? 0x1a6cff : 0xff9a1a,
        transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    frame.rotation.x = -Math.PI / 2;
    frame.position.set(p.x, 0.04, p.z);
    frame.rotation.z = -p.heading;
    group.add(frame);
    pads.push({ ...p, mesh, mat, frame });
  }

  /* ---------------- 스카이라인 ---------------- */
  const winTex = windowTexture(0);
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildingMat = new THREE.MeshStandardMaterial({
    map: winTex, color: 0x8f88c8, roughness: 0.68, metalness: 0.35,
    emissive: 0x3a2c78, emissiveIntensity: 0.95, envMapIntensity: 0.5,
  });
  const COUNT = 150;
  const buildings = new THREE.InstancedMesh(buildingGeo, buildingMat, COUNT);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const roofStrips = [];
  let placedN = 0, guard = 0;
  const inBasin = (x, z) => x > BASIN.x0 - 30 && x < BASIN.x1 + 30 && z > BASIN.z0 - 30 && z < BASIN.z1 + 30;
  while (placedN < COUNT && guard++ < 6000) {
    const a = Math.random() * Math.PI * 2;
    const r = 120 + Math.random() * 340;
    const x = -10 + Math.cos(a) * r * 1.15;
    const z = -20 + Math.sin(a) * r;
    if (inBasin(x, z)) continue;
    const near = nearest(track, x, z, -1);
    if (Math.abs(near.lateral) < hw + 34) continue;
    const w = 12 + Math.random() * 30;
    const d = 12 + Math.random() * 30;
    const h = 22 + Math.pow(Math.random(), 1.8) * 160;
    dummy.position.set(x, h / 2 - 2, z);
    dummy.scale.set(w, h, d);
    dummy.rotation.y = Math.random() * Math.PI;
    dummy.updateMatrix();
    buildings.setMatrixAt(placedN, dummy.matrix);
    const t = Math.random();
    color.setRGB(0.5 + t * 0.4, 0.46 + t * 0.24, 0.72 + (1 - t) * 0.28);
    buildings.setColorAt(placedN, color);
    if (Math.random() < 0.55) {
      roofStrips.push({ x, z, y: h - 1.4, w, d, ry: dummy.rotation.y, c: [0x22e6ff, 0xff2fb0, 0x8a5cff, 0xffc23d][(Math.random() * 4) | 0] });
    }
    placedN++;
  }
  buildings.count = placedN;
  buildings.instanceMatrix.needsUpdate = true;
  if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
  group.add(buildings);

  // 옥상 네온 테두리
  const stripGeo = new THREE.BoxGeometry(1, 0.7, 1);
  const strips = new THREE.InstancedMesh(stripGeo, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false,
  }), Math.max(1, roofStrips.length));
  const sm = new THREE.Matrix4(), sq = new THREE.Quaternion(), se = new THREE.Euler();
  roofStrips.forEach((b, i) => {
    se.set(0, b.ry, 0);
    sq.setFromEuler(se);
    sm.compose(new THREE.Vector3(b.x, b.y, b.z), sq, new THREE.Vector3(b.w * 1.02, 1, b.d * 1.02));
    strips.setMatrixAt(i, sm);
    strips.setColorAt(i, color.setHex(b.c));
  });
  strips.count = roofStrips.length;
  strips.instanceMatrix.needsUpdate = true;
  if (strips.instanceColor) strips.instanceColor.needsUpdate = true;
  group.add(strips);

  // 먼 스카이라인 (실루엣)
  const FAR = 120;
  const farBuildings = new THREE.InstancedMesh(buildingGeo, new THREE.MeshStandardMaterial({
    color: 0x2a2450, roughness: 0.9, metalness: 0.2, emissive: 0x140c2a, emissiveIntensity: 0.5,
  }), FAR);
  let fp = 0; guard = 0;
  while (fp < FAR && guard++ < 4000) {
    const a = Math.random() * Math.PI * 2;
    const r = 480 + Math.random() * 620;
    const x = -10 + Math.cos(a) * r;
    const z = -20 + Math.sin(a) * r;
    if (inBasin(x, z)) continue;
    const w = 26 + Math.random() * 60;
    const h = 40 + Math.pow(Math.random(), 1.6) * 300;
    const d = 26 + Math.random() * 60;
    dummy.position.set(x, h / 2 - 3, z);
    dummy.scale.set(w, h, d);
    dummy.rotation.y = Math.random() * Math.PI;
    dummy.updateMatrix();
    farBuildings.setMatrixAt(fp++, dummy.matrix);
  }
  farBuildings.count = fp;
  farBuildings.instanceMatrix.needsUpdate = true;
  group.add(farBuildings);

  /* ---------------- 네온 사인 ---------------- */
  const signTexts = [
    ['NEON', '#31f7ff'], ['DRIFT', '#ff36c8'], ['88', '#ffd24a'],
    ['HARBOR', '#7d6bff'], ['TURBO', '#39ff9e'], ['HYPER', '#ff6b6b'],
  ];
  const signs = [];
  const signLights = [];
  for (let i = 0; i < signTexts.length; i++) {
    const angle = (i / signTexts.length) * Math.PI * 2 + 0.5;
    const r = 190 + (i % 3) * 95;
    const x = -10 + Math.cos(angle) * r;
    const z = -20 + Math.sin(angle) * r;
    if (inBasin(x, z)) continue;
    const near = nearest(track, x, z, -1);
    if (Math.abs(near.lateral) < hw + 34) continue;
    const h = 42 + (i % 4) * 28;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 9),
      new THREE.MeshBasicMaterial({
        map: textTexture(signTexts[i][0], signTexts[i][1], null, { w: 512, h: 160 }),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    mesh.position.set(x, h, z);
    mesh.rotation.y = Math.atan2(-x, -z) + (i % 2 ? Math.PI : 0);
    group.add(mesh);
    signs.push(mesh);
    signLights.push(x, h, z);
  }
  if (signLights.length) {
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(signLights, 3));
    const signGlow = new THREE.Points(sg, new THREE.PointsMaterial({
      map: softGlowTexture(), color: 0xff8ae0, size: 34, sizeAttenuation: true,
      transparent: true, opacity: 0.30, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    group.add(signGlow);
  }

  /* ---------------- 업데이트 ---------------- */
  let lastCp = -1;
  function update(dt, t, activeCp) {
    waterMat.uniforms.time.value = t;
    for (const p of pads) {
      p.mat.map.offset.y = -((t * 1.7 + p.i * 0.3) % 1);
      p.frame.material.opacity = 0.22 + 0.16 * (0.5 + 0.5 * Math.sin(t * 4 + p.i));
    }
    pulse.material.map.offset.y = -((t * 0.22) % 1);
    for (let i = 0; i < signs.length; i++) {
      signs[i].material.opacity = 0.78 + 0.22 * Math.sin(t * 3.1 + i * 1.7);
      if (Math.random() < 0.008) signs[i].material.opacity = 0.35;
    }
    rings.material.opacity = 0.24 + 0.12 * Math.sin(t * 1.7);
    if (activeCp !== undefined && activeCp !== lastCp) {
      lastCp = activeCp;
      setActiveCheckpoint(activeCp);
    }
  }

  return { group, arches, pads, setActiveCheckpoint, update, startGroup, COL, water };
}
