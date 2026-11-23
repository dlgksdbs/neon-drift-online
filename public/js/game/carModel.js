import * as THREE from 'three';
import { CAR_SPECS } from '../core/physics.js';
import { mergeGeometries, mergeColored, placed, smooth2D, lathe, loftRings } from './meshUtil.js';
import { glowTexture, softGlowTexture, makeCanvas, tex } from './materials.js';

/* =============================================================================
   carModel.js — 고디테일 슈퍼카 (쿠페 / GT / 하이퍼)
   로컬 좌표: +Z 전방, +X 오른쪽, +Y 위. 바퀴는 지면(y=0)에 닿는다.
   - 스컬프트 바디(휠 아치 컷 · 펜더 립) + 틴티드 캐노피 + 루프 패널
   - 5스포크 알로이 휠 · 브레이크 디스크/캘리퍼 (인스턴싱)
   - 스플리터 · 스커트 · 디퓨저 · 리어 윙 · 미러 · 인테이크
   - 헤드라이트 빔 · 노면 라이트 · 테일 LED · 니트로 애프터버너
   - 1인칭 콕핏 (대시보드 · 발광 계기판 · A필러 · 보닛 라인)
   ============================================================================= */

const MODELS = {
  coupe: {
    L: 4.24, W: 1.94, wb: 2.56, wheelR: 0.335, wheelW: 0.315,
    sill: 0.215, archR: 0.395, archApron: 0.52,
    top: [[2.12, 0.52], [2.03, 0.62], [1.88, 0.72], [1.62, 0.845], [1.28, 0.925], [1.02, 0.965],
      [0.80, 1.005], [0.40, 1.035], [0.0, 1.05], [-0.50, 1.055], [-0.95, 1.045], [-1.28, 1.02],
      [-1.66, 0.99], [-1.92, 0.935], [-2.12, 0.78]],
    width: [[2.12, 0.56], [2.00, 0.76], [1.84, 0.89], [1.55, 0.965], [1.28, 1.0], [1.02, 0.99],
      [0.60, 0.955], [0.0, 0.95], [-0.60, 0.97], [-1.05, 0.995], [-1.28, 1.0], [-1.64, 0.975],
      [-1.92, 0.91], [-2.12, 0.77]],
    cabin: { z0: 0.84, roofZ0: 0.30, roofZ1: -0.72, z1: -1.46, roofY: 1.335, baseY: 0.99, baseW: 0.79, roofW: 0.62 },
    wing: 'duck', scoop: false, vents: 2, splitter: 1.0,
  },
  gt: {
    L: 4.58, W: 2.02, wb: 2.78, wheelR: 0.35, wheelW: 0.335,
    sill: 0.215, archR: 0.405, archApron: 0.545,
    top: [[2.29, 0.52], [2.19, 0.63], [2.02, 0.735], [1.72, 0.865], [1.39, 0.945], [1.12, 0.99],
      [0.88, 1.03], [0.40, 1.065], [0.0, 1.08], [-0.55, 1.08], [-1.00, 1.07], [-1.39, 1.05],
      [-1.80, 1.02], [-2.08, 0.97], [-2.29, 0.80]],
    width: [[2.29, 0.55], [2.15, 0.77], [1.96, 0.90], [1.66, 0.975], [1.39, 1.0], [1.10, 0.995],
      [0.55, 0.96], [0.0, 0.955], [-0.55, 0.975], [-1.05, 0.998], [-1.39, 1.0], [-1.80, 0.978],
      [-2.08, 0.915], [-2.29, 0.78]],
    cabin: { z0: 0.92, roofZ0: 0.30, roofZ1: -0.80, z1: -1.58, roofY: 1.375, baseY: 1.04, baseW: 0.815, roofW: 0.64 },
    wing: 'swan', scoop: false, vents: 3, splitter: 1.0,
  },
  hyper: {
    L: 4.52, W: 2.06, wb: 2.70, wheelR: 0.345, wheelW: 0.34,
    sill: 0.20, archR: 0.40, archApron: 0.535,
    top: [[2.26, 0.49], [2.16, 0.58], [1.98, 0.67], [1.68, 0.795], [1.35, 0.90], [1.05, 0.955],
      [0.78, 1.005], [0.34, 1.055], [0.0, 1.075], [-0.55, 1.08], [-1.00, 1.08], [-1.35, 1.065],
      [-1.74, 1.035], [-2.02, 0.985], [-2.26, 0.82]],
    width: [[2.26, 0.58], [2.12, 0.80], [1.92, 0.92], [1.62, 0.99], [1.35, 1.0], [1.05, 0.995],
      [0.50, 0.97], [0.0, 0.965], [-0.55, 0.988], [-1.05, 1.0], [-1.35, 1.0], [-1.76, 0.988],
      [-2.02, 0.935], [-2.26, 0.80]],
    cabin: { z0: 0.86, roofZ0: 0.20, roofZ1: -0.64, z1: -1.38, roofY: 1.315, baseY: 1.035, baseW: 0.80, roofW: 0.625 },
    wing: 'twotier', scoop: true, vents: 4, splitter: 1.08,
  },
};

/* ---------- 프로파일 보간 (z 오름차순 보장) ---------- */
function profileFn(ctrl, perSeg = 6) {
  const sorted = ctrl.slice().sort((a, b) => a[0] - b[0]);
  const pts = smooth2D(sorted, perSeg);
  return (z) => {
    if (z <= pts[0][0]) return pts[0][1];
    if (z >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (z >= a[0] && z <= b[0]) {
        const t = (z - a[0]) / (b[0] - a[0] || 1e-6);
        return a[1] + (b[1] - a[1]) * t;
      }
    }
    return pts[pts.length - 1][1];
  };
}

/* 바퀴 위로 파인 아치 하단선 */
function archBottomFn(m) {
  const axles = [m.wb / 2, -m.wb / 2];
  const apron = m.archApron;
  return (z) => {
    let y = m.sill;
    for (const az of axles) {
      const dz = Math.abs(z - az);
      if (dz < apron) {
        const yy = m.wheelR + Math.sqrt(Math.max(0, apron * apron - dz * dz)) * 0.94;
        y = Math.max(y, yy);
      }
    }
    return y;
  };
}

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
};

/* ---------- 바디 셸 ---------- */
function bodyGeometry(m) {
  const topAt = profileFn(m.top, 7);
  const widAt = profileFn(m.width, 7);
  const botAt = archBottomFn(m);
  const stations = [];
  const N = 88;
  const axles = [m.wb / 2, -m.wb / 2];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const z = -m.L / 2 + t * m.L;
    const yt = topAt(z);
    const ybRaw = botAt(z);
    const yb = Math.min(ybRaw, yt - 0.05);
    const cy = (yt + yb) / 2;
    const h = Math.max(0.025, (yt - yb) / 2);
    // 아치 부근은 살짝 좁혀 펜더가 바퀴를 감싸는 느낌을 준다
    let wf = (widAt(z) * m.W) / 2;
    for (const az of axles) {
      const d = Math.abs(z - az);
      if (d < m.archApron * 1.25) wf *= 1 - 0.045 * (1 - smoothstep(0, m.archApron * 1.25, d));
    }
    stations.push({
      z, w: wf, cy,
      hTop: h, hBot: h,
      exp: 3.2, expBot: 4.6,
    });
  }
  return loftRings(stations, 28);
}

/* ---------- 캐노피(글래스 하우스) ---------- */
function cabinGeometry(m) {
  const c = m.cabin;
  const roofCtrl = [
    [c.z0, c.baseY],
    [c.z0 - (c.z0 - c.roofZ0) * 0.42, c.baseY + (c.roofY - c.baseY) * 0.60],
    [c.roofZ0, c.roofY - 0.01],
    [(c.roofZ0 + c.roofZ1) / 2, c.roofY + 0.01],
    [c.roofZ1, c.roofY - 0.015],
    [c.z1 + (c.roofZ1 - c.z1) * 0.42, c.baseY + (c.roofY - c.baseY) * 0.38],
    [c.z1, c.baseY - 0.02],
  ];
  const yAt = profileFn(roofCtrl, 6);
  const stations = [];
  const N = 30;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const z = c.z0 + (c.z1 - c.z0) * t;
    const y = yAt(z);
    const ht = Math.max(0, Math.min(1, (y - c.baseY) / Math.max(0.01, c.roofY - c.baseY)));
    const w = c.baseW + (c.roofW - c.baseW) * (0.30 + 0.70 * Math.sin(Math.min(1, ht) * Math.PI * 0.5));
    stations.push({ z, cy: y - 0.075, w, hTop: 0.085, hBot: 0.085 + 0.11 * (1 - ht), exp: 2.4 });
  }
  return loftRings(stations, 22);
}

/* ---------- 루프 패널 (도장) ---------- */
function roofPanelGeometry(m) {
  const c = m.cabin;
  const ctrl = [
    [c.roofZ0 + 0.14, c.roofY - 0.055],
    [c.roofZ0 - 0.04, c.roofY - 0.002],
    [(c.roofZ0 + c.roofZ1) / 2, c.roofY + 0.012],
    [c.roofZ1 + 0.04, c.roofY - 0.006],
    [c.roofZ1 - 0.14, c.roofY - 0.06],
  ];
  const yAt = profileFn(ctrl, 6);
  const stations = [];
  const N = 16;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const z = (c.roofZ0 + 0.14) + ((c.roofZ1 - 0.14) - (c.roofZ0 + 0.14)) * t;
    const y = yAt(z);
    stations.push({ z, cy: y - 0.004, w: c.roofW * 1.005, hTop: 0.016, hBot: 0.016, exp: 2.3 });
  }
  return loftRings(stations, 20);
}

/* ---------- 휠 ---------- */
function tireGeometry(m) {
  const R = m.wheelR, hw = m.wheelW / 2;
  const prof = [
    [R * 0.60, -hw * 0.94], [R * 0.80, -hw], [R * 0.94, -hw * 0.99],
    [R * 0.99, -hw * 0.84], [R, -hw * 0.62], [R * 0.96, -hw * 0.50],
    [R, -hw * 0.34], [R, -hw * 0.08], [R * 0.965, hw * 0.08], [R, hw * 0.26],
    [R * 0.96, hw * 0.44], [R, hw * 0.62], [R * 0.99, hw * 0.84],
    [R * 0.94, hw * 0.99], [R * 0.80, hw], [R * 0.60, hw * 0.94],
  ];
  const g = lathe(prof, 26, 'x');
  const blocks = [];
  const blockGeo = new THREE.BoxGeometry(m.wheelW * 0.88, 0.026, R * 0.17);
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2;
    blocks.push(placed(blockGeo.clone(), {
      pos: [0, Math.sin(a) * (R - 0.010), Math.cos(a) * (R - 0.010)],
      rot: [-a, 0, 0],
    }));
  }
  return mergeGeometries([g, ...blocks]);
}

function rimGeometry(m, caliperColor) {
  const R = m.wheelR, hw = m.wheelW / 2;
  const alloy = 0xc6d2e6;
  const parts = [];
  parts.push({ geo: new THREE.TorusGeometry(R * 0.70, 0.028, 8, 26), color: alloy });
  parts.push({ geo: new THREE.TorusGeometry(R * 0.62, 0.013, 6, 24), color: 0x70798f });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const len = R * 0.48;
    const sp = new THREE.BoxGeometry(0.046, len, 0.045);
    sp.translate(0, R * 0.21 + len / 2, 0);
    sp.rotateZ(-0.12);
    placed(sp, { rot: [0, 0, a] });
    parts.push({ geo: sp, color: alloy });
    const hole = new THREE.BoxGeometry(0.12, len * 0.95, 0.010);
    hole.translate(0, R * 0.21 + len / 2, -0.020);
    placed(hole, { rot: [0, 0, a + Math.PI / 5] });
    parts.push({ geo: hole, color: 0x14171f });
  }
  const hub = new THREE.CylinderGeometry(R * 0.20, R * 0.22, hw * 0.5, 16);
  hub.rotateX(Math.PI / 2);
  hub.translate(0, 0, hw * 0.28);
  parts.push({ geo: hub, color: 0x93a0b6 });
  const cap = new THREE.CylinderGeometry(R * 0.08, R * 0.08, 0.03, 12);
  cap.rotateX(Math.PI / 2);
  cap.translate(0, 0, hw * 0.55);
  parts.push({ geo: cap, color: caliperColor });
  const disc = new THREE.CylinderGeometry(R * 0.58, R * 0.58, 0.024, 24);
  disc.rotateX(Math.PI / 2);
  disc.translate(0, 0, -hw * 0.18);
  parts.push({ geo: disc, color: 0x2b3040 });
  const discFace = new THREE.TorusGeometry(R * 0.48, 0.011, 6, 22);
  discFace.translate(0, 0, -hw * 0.28);
  parts.push({ geo: discFace, color: 0x525a70 });
  const cal = new THREE.BoxGeometry(0.07, R * 0.28, R * 0.19);
  placed(cal, { pos: [R * 0.38, R * 0.42, -hw * 0.20], rot: [0, 0, -0.5] });
  parts.push({ geo: cal, color: caliperColor });
  const out = mergeColored(parts);
  out.rotateY(Math.PI / 2);
  return out;
}

/* ---------- 헤드램프 빔 ---------- */
function beamGeometry(len = 11, radius = 0.85) {
  const g = new THREE.ConeGeometry(radius, len, 12, 1, true);
  g.translate(0, -len / 2, 0);
  g.rotateX(-Math.PI / 2);
  return g;
}

/* ---------- 계기판 텍스처 ---------- */
function clusterTexture(neon) {
  return tex(makeCanvas(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, w, h);
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(18,36,72,0.95)');
    grd.addColorStop(1, 'rgba(4,6,14,0.98)');
    ctx.fillStyle = grd;
    ctx.fillRect(3, 3, w - 6, h - 6);
    ctx.strokeStyle = neon;
    ctx.shadowColor = neon;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.beginPath();
    ctx.arc(62, 76, 36, Math.PI * 0.92, Math.PI * 2.08);
    ctx.strokeStyle = 'rgba(120,220,255,0.22)';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(62, 76, 36, Math.PI * 0.98, Math.PI * 1.62);
    ctx.strokeStyle = neon;
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const bh = 12 + i * 7;
      ctx.fillStyle = i < 6 ? neon : '#ff4b7d';
      ctx.globalAlpha = 0.85;
      ctx.fillRect(122 + i * 15, 100 - bh, 9, bh);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#eafcff';
    ctx.font = '900 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 10;
    ctx.fillText('NEON', 62, 44);
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(160,220,255,0.8)';
    ctx.fillText('DRIFT · MOTORSPORT', 168, 30);
    ctx.fillStyle = neon;
    ctx.font = '900 26px system-ui, sans-serif';
    ctx.fillText('000', 168, 72);
  }), { srgb: true });
}

export function createCarMesh(specKey, neonColor = '#37f3ff', opts = {}) {
  const spec = CAR_SPECS[specKey] || CAR_SPECS.coupe;
  const m = MODELS[spec.key] || MODELS.coupe;
  const col = new THREE.Color(neonColor);
  const caliperColor = col.clone().lerp(new THREE.Color(0xffffff), 0.18).getHex();

  const g = new THREE.Group();          // 월드 위치 + heading
  const tilt = new THREE.Group();       // 피치/롤 (서스펜션)
  const wheelRoot = new THREE.Group();  // 바퀴는 지면 유지
  g.add(tilt, wheelRoot);

  /* ---------- 재질 ---------- */
  const paintColor = col.clone().multiplyScalar(0.50).add(new THREE.Color(0x0a1220));
  const bodyMat = new THREE.MeshStandardMaterial({
    color: paintColor,
    metalness: 0.78,
    roughness: 0.22,
    envMapIntensity: 1.7,
    emissive: col.clone().multiplyScalar(0.03),
  });
  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x0c0e15, metalness: 0.6, roughness: 0.40,
    envMapIntensity: 1.0,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x9aa6bd, metalness: 1.0, roughness: 0.26, envMapIntensity: 1.4,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0a1828, metalness: 0.55, roughness: 0.035,
    transparent: true, opacity: 0.72, side: THREE.DoubleSide,
    envMapIntensity: 2.2,
  });
  const trimMat = new THREE.MeshBasicMaterial({ color: col });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xe6fbff });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a52 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0b0c12, roughness: 0.9, metalness: 0.05 });
  const rimMat = new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.94, roughness: 0.22, envMapIntensity: 1.6,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x12141c, roughness: 0.72, metalness: 0.3 });

  const topAt = profileFn(m.top, 7);
  const widAt = profileFn(m.width, 7);
  const halfW = (z) => (widAt(z) * m.W) / 2;

  /* ---------- 바디 ---------- */
  const body = new THREE.Mesh(bodyGeometry(m), bodyMat);
  tilt.add(body);

  /* ---------- 캐노피 + 루프 ---------- */
  const cabinMesh = new THREE.Mesh(cabinGeometry(m), glassMat);
  tilt.add(cabinMesh);
  const roofMesh = new THREE.Mesh(roofPanelGeometry(m), bodyMat);
  tilt.add(roofMesh);

  /* ---------- 휠 아치 (휠 하우스 + 펜더 립) ---------- */
  for (const s of [-1, 1]) {
    for (const az of [m.wb / 2, -m.wb / 2]) {
      const xw = halfW(az) * 0.985;
      const well = new THREE.Mesh(
        new THREE.CircleGeometry(m.archR + 0.055, 20),
        new THREE.MeshStandardMaterial({ color: 0x04050a, roughness: 0.95, metalness: 0.1 })
      );
      well.position.set(s * xw, m.wheelR + 0.005, az);
      well.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      tilt.add(well);
    }
  }

  /* ---------- 파트 수집 ---------- */
  const carbonParts = [];
  const paintParts = [];
  const metalParts = [];
  const trimParts = [];
  const headParts = [];
  const tailParts = [];

  // 프론트 스플리터
  carbonParts.push(placed(new THREE.BoxGeometry(m.W * 0.90 * m.splitter, 0.04, 0.36), {
    pos: [0, m.sill - 0.03, m.L / 2 - 0.12], rot: [0.05, 0, 0],
  }));
  for (const s of [-1, 1]) {
    carbonParts.push(placed(new THREE.BoxGeometry(0.05, 0.13, 0.34), {
      pos: [s * m.W * 0.41, m.sill + 0.06, m.L / 2 - 0.18], rot: [0.08, 0, 0],
    }));
  }
  // 프론트 그릴 (어두운 인테이크)
  carbonParts.push(placed(new THREE.BoxGeometry(m.W * 0.44, 0.12, 0.06), {
    pos: [0, m.sill + 0.16, m.L / 2 - 0.05], rot: [0.16, 0, 0],
  }));

  for (const s of [-1, 1]) {
    // 사이드 스커트
    carbonParts.push(placed(new THREE.BoxGeometry(0.05, 0.10, 1.5), {
      pos: [s * (halfW(0.1) - 0.02), m.sill - 0.02, 0.02],
    }));
    // 사이드 인테이크
    carbonParts.push(placed(new THREE.BoxGeometry(0.035, 0.14, 0.44), {
      pos: [s * (halfW(-0.55) - 0.008), topAt(-0.55) - 0.34, -0.62], rot: [0, 0.16 * s, 0],
    }));
    // 프론트 펜더 벤트
    carbonParts.push(placed(new THREE.BoxGeometry(0.03, 0.10, 0.26), {
      pos: [s * (halfW(0.95) - 0.02), topAt(0.95) - 0.30, 0.95], rot: [0, 0.24 * s, 0],
    }));
    // 윈드실드 A 필러
    const from = new THREE.Vector3(s * (m.cabin.baseW - 0.03), m.cabin.baseY + 0.01, m.cabin.z0 - 0.03);
    const to = new THREE.Vector3(s * (m.cabin.roofW - 0.015), m.cabin.roofY - 0.02, m.cabin.roofZ0 + 0.02);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const dir = to.clone().sub(from);
    const pil = new THREE.BoxGeometry(0.055, 0.08, dir.length());
    pil.applyMatrix4(new THREE.Matrix4().compose(
      mid, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize()),
      new THREE.Vector3(1, 1, 1)
    ));
    carbonParts.push(pil);
    // B/C 필러
    const bFrom = new THREE.Vector3(s * (m.cabin.roofW - 0.01), m.cabin.roofY - 0.03, m.cabin.roofZ1 + 0.04);
    const bTo = new THREE.Vector3(s * (m.cabin.baseW - 0.02), m.cabin.baseY + 0.01, m.cabin.z1 + 0.14);
    const bMid = bFrom.clone().add(bTo).multiplyScalar(0.5);
    const bDir = bTo.clone().sub(bFrom);
    const bp = new THREE.BoxGeometry(0.06, 0.07, bDir.length());
    bp.applyMatrix4(new THREE.Matrix4().compose(
      bMid, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), bDir.clone().normalize()),
      new THREE.Vector3(1, 1, 1)
    ));
    carbonParts.push(bp);
    // 사이드 미러
    const mz = m.cabin.z0 - 0.06, my = topAt(mz) + 0.03;
    paintParts.push(placed(new THREE.BoxGeometry(0.17, 0.05, 0.09), {
      pos: [s * (halfW(mz) + 0.06), my, mz], rot: [0, s * 0.20, s * -0.1],
    }));
    carbonParts.push(placed(new THREE.BoxGeometry(0.08, 0.026, 0.03), {
      pos: [s * (halfW(mz) - 0.02), my - 0.02, mz],
    }));
    // 배기
    const ex = new THREE.CylinderGeometry(0.058, 0.066, 0.14, 12, 1, true);
    ex.rotateX(Math.PI / 2);
    placed(ex, { pos: [s * m.W * 0.16, m.sill + 0.24, -m.L / 2 + 0.03] });
    metalParts.push(ex);
  }

  // 디퓨저
  carbonParts.push(placed(new THREE.BoxGeometry(m.W * 0.82, 0.15, 0.32), {
    pos: [0, m.sill + 0.02, -m.L / 2 + 0.20], rot: [-0.08, 0, 0],
  }));
  for (const f of [-0.30, -0.10, 0.10, 0.30]) {
    carbonParts.push(placed(new THREE.BoxGeometry(0.028, 0.16, 0.30), {
      pos: [f * m.W, m.sill + 0.06, -m.L / 2 + 0.20],
    }));
  }
  // 보닛 벤트 (얇은 슬롯)
  for (let i = 0; i < m.vents; i++) {
    const z = m.L * 0.32 - i * 0.14;
    for (const s of [-1, 1]) {
      carbonParts.push(placed(new THREE.BoxGeometry(0.14, 0.018, 0.075), {
        pos: [s * 0.24, topAt(z) - 0.005, z], rot: [0.03, 0, 0],
      }));
    }
  }

  /* ---------- 리어 윙 ---------- */
  const deckZ = -m.L / 2 + 0.30;
  const deckY = topAt(deckZ);
  if (m.wing === 'duck') {
    paintParts.push(placed(new THREE.BoxGeometry(m.W * 0.86, 0.05, 0.30), {
      pos: [0, deckY + 0.06, deckZ - 0.02], rot: [-0.22, 0, 0],
    }));
    carbonParts.push(placed(new THREE.BoxGeometry(m.W * 0.88, 0.02, 0.12), {
      pos: [0, deckY + 0.02, deckZ + 0.14],
    }));
  } else if (m.wing === 'swan') {
    for (const s of [-1, 1]) {
      const base = new THREE.Vector3(s * m.W * 0.29, deckY - 0.02, deckZ + 0.10);
      const top = new THREE.Vector3(s * m.W * 0.29, deckY + 0.27, deckZ - 0.10);
      const mid = base.clone().add(top).multiplyScalar(0.5);
      const dir = top.clone().sub(base);
      const stay = new THREE.BoxGeometry(0.045, 0.06, dir.length());
      stay.applyMatrix4(new THREE.Matrix4().compose(
        mid, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize()),
        new THREE.Vector3(1, 1, 1)
      ));
      carbonParts.push(stay);
    }
    paintParts.push(placed(new THREE.BoxGeometry(m.W * 0.94, 0.045, 0.34), {
      pos: [0, deckY + 0.29, deckZ - 0.04], rot: [-0.10, 0, 0],
    }));
    carbonParts.push(placed(new THREE.BoxGeometry(m.W * 0.96, 0.02, 0.05), {
      pos: [0, deckY + 0.315, deckZ - 0.19], rot: [-0.10, 0, 0],
    }));
    for (const s of [-1, 1]) {
      carbonParts.push(placed(new THREE.BoxGeometry(0.022, 0.13, 0.30), {
        pos: [s * m.W * 0.475, deckY + 0.265, deckZ - 0.06], rot: [-0.10, 0, 0],
      }));
    }
  } else {
    for (const s of [-1, 1]) {
      carbonParts.push(placed(new THREE.BoxGeometry(0.045, 0.19, 0.09), {
        pos: [s * m.W * 0.30, deckY + 0.09, deckZ],
      }));
    }
    carbonParts.push(placed(new THREE.BoxGeometry(m.W * 0.88, 0.045, 0.34), {
      pos: [0, deckY + 0.21, deckZ - 0.03], rot: [-0.09, 0, 0],
    }));
    carbonParts.push(placed(new THREE.BoxGeometry(0.05, 0.13, 0.16), {
      pos: [0, deckY + 0.31, deckZ - 0.05],
    }));
    paintParts.push(placed(new THREE.BoxGeometry(m.W * 0.74, 0.04, 0.26), {
      pos: [0, deckY + 0.40, deckZ - 0.08], rot: [-0.12, 0, 0],
    }));
    for (const s of [-1, 1]) {
      carbonParts.push(placed(new THREE.BoxGeometry(0.022, 0.30, 0.50), {
        pos: [s * m.W * 0.40, deckY + 0.27, deckZ - 0.04], rot: [-0.06, 0, 0],
      }));
    }
  }
  if (m.scoop) {
    carbonParts.push(placed(new THREE.BoxGeometry(0.36, 0.055, 0.40), {
      pos: [0, m.cabin.roofY + 0.005, (m.cabin.roofZ0 + m.cabin.roofZ1) / 2 + 0.10], rot: [-0.05, 0, 0],
    }));
    carbonParts.push(placed(new THREE.BoxGeometry(0.24, 0.035, 0.08), {
      pos: [0, m.cabin.roofY + 0.03, (m.cabin.roofZ0 + m.cabin.roofZ1) / 2 + 0.28],
    }));
  }

  /* ---------- 헤드 / 테일 램프 ---------- */
  const noseZ = m.L / 2 - 0.05;
  const noseY = topAt(noseZ) - 0.14;
  for (const s of [-1, 1]) {
    headParts.push(placed(new THREE.BoxGeometry(0.30, 0.036, 0.05), {
      pos: [s * m.W * 0.29, noseY, noseZ], rot: [0.06, 0, -0.05 * s],
    }));
    headParts.push(placed(new THREE.BoxGeometry(0.09, 0.028, 0.045), {
      pos: [s * m.W * 0.215, noseY - 0.045, noseZ - 0.01], rot: [0.06, 0, 0],
    }));
    const ty = topAt(-m.L / 2 + 0.05) - 0.13;
    tailParts.push(placed(new THREE.BoxGeometry(0.38, 0.05, 0.035), {
      pos: [s * m.W * 0.25, ty, -m.L / 2 + 0.035],
    }));
    tailParts.push(placed(new THREE.BoxGeometry(0.055, 0.11, 0.035), {
      pos: [s * m.W * 0.41, ty - 0.01, -m.L / 2 + 0.035],
    }));
  }
  tailParts.push(placed(new THREE.BoxGeometry(m.W * 0.52, 0.028, 0.035), {
    pos: [0, topAt(-m.L / 2 + 0.05) - 0.13, -m.L / 2 + 0.035],
  }));
  tailParts.push(placed(new THREE.BoxGeometry(m.W * 0.72, 0.012, 0.03), {
    pos: [0, topAt(-m.L / 2 + 0.12) - 0.055, -m.L / 2 + 0.02],
  }));

  /* ---------- 네온 액센트 ---------- */
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const z = m.L / 2 - 0.26 - (i / 14) * (m.L - 0.62);
      pts.push(new THREE.Vector3(s * (halfW(z) + 0.010), topAt(z) - 0.085, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    trimParts.push(new THREE.TubeGeometry(curve, 28, 0.013, 5, false));
    trimParts.push(placed(new THREE.BoxGeometry(0.018, 0.02, m.L * 0.44), {
      pos: [s * (halfW(0.05) - 0.045), m.sill + 0.055, 0.02],
    }));
    // 아치 립 네온
    for (const az of [m.wb / 2, -m.wb / 2]) {
      const tor = new THREE.TorusGeometry(m.archR + 0.028, 0.010, 5, 18, Math.PI * 0.94);
      tor.rotateY(Math.PI / 2);
      tor.rotateX(Math.PI * 0.03);
      placed(tor, { pos: [s * (halfW(az) * 0.982), m.wheelR, az] });
      trimParts.push(tor);
    }
  }
  trimParts.push(placed(new THREE.BoxGeometry(0.04, 0.010, m.L * 0.22), {
    pos: [0, topAt(m.L * 0.30) + 0.004, m.L * 0.30],
  }));
  trimParts.push(placed(new THREE.BoxGeometry(m.W * 0.86 * m.splitter, 0.014, 0.018), {
    pos: [0, m.sill - 0.008, m.L / 2 - 0.01],
  }));
  trimParts.push(placed(new THREE.BoxGeometry(m.W * 0.78, 0.014, 0.018), {
    pos: [0, m.sill + 0.06, -m.L / 2 + 0.07],
  }));

  /* ---------- 합친 메시 ---------- */
  const addMesh = (geo, mat) => {
    const mesh = new THREE.Mesh(geo, mat);
    tilt.add(mesh);
    return mesh;
  };
  paintParts.push(roofMesh.geometry.clone());
  roofMesh.visible = false;
  addMesh(mergeGeometries(paintParts), bodyMat);
  addMesh(mergeGeometries(carbonParts), carbonMat);
  if (metalParts.length) addMesh(mergeGeometries(metalParts), metalMat);
  addMesh(mergeGeometries(trimParts), trimMat);
  addMesh(mergeGeometries(headParts), headMat);
  const tailMesh = addMesh(mergeGeometries(tailParts), tailMat);

  /* ---------- 헤드라이트 볼륨 빔 + 노면 라이트 ---------- */
  const beamGeo = mergeGeometries([
    placed(beamGeometry(11, 0.9), { pos: [-m.W * 0.29, noseY, m.L / 2 - 0.04], rot: [0.055, 0, 0] }),
    placed(beamGeometry(11, 0.9), { pos: [m.W * 0.29, noseY, m.L / 2 - 0.04], rot: [0.055, 0, 0] }),
  ]);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x9fdfff, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  tilt.add(new THREE.Mesh(beamGeo, beamMat));

  const splash = new THREE.Mesh(
    new THREE.PlaneGeometry(m.W * 2.6, 20),
    new THREE.MeshBasicMaterial({
      map: glowTexture(), color: 0xbfe9ff, transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  splash.rotation.x = -Math.PI / 2;
  splash.position.set(0, 0.06, m.L / 2 + 9.0);
  g.add(splash);

  /* ---------- 테일 글로우 ---------- */
  const tailGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(m.W * 1.2, 0.85),
    new THREE.MeshBasicMaterial({
      map: softGlowTexture(), color: 0xff2a52, transparent: true, opacity: 0.24,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  tailGlow.position.set(0, topAt(-m.L / 2 + 0.1) - 0.13, -m.L / 2 - 0.07);
  tailGlow.rotation.y = Math.PI;
  tilt.add(tailGlow);

  /* ---------- 언더글로우 / 그림자 ---------- */
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(m.W * 2.0, m.L * 1.2),
    new THREE.MeshBasicMaterial({
      map: softGlowTexture(), color: col, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.05;
  g.add(glow);

  const shadowTex = tex(makeCanvas(128, 128, (ctx, w, h) => {
    const grd = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.94)');
    grd.addColorStop(0.55, 'rgba(0,0,0,0.6)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
  }), { srgb: false });
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(m.W * 1.55, m.L * 1.12),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.78, depthWrite: false, color: 0x000000 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  g.add(shadow);

  /* ---------- 배기 애프터버너 ---------- */
  const flameParts = [];
  for (const s of [-1, 1]) {
    const f = new THREE.ConeGeometry(0.095, 1.4, 10, 1, true);
    f.translate(0, -0.7, 0);
    f.rotateX(-Math.PI / 2);
    flameParts.push(placed(f, { pos: [s * m.W * 0.16, m.sill + 0.24, -m.L / 2 - 0.03] }));
  }
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x7fefff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const flames = new THREE.Mesh(mergeGeometries(flameParts), flameMat);
  tilt.add(flames);
  const flameGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 2.0),
    new THREE.MeshBasicMaterial({
      map: softGlowTexture(), color: 0x9ffcff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  flameGlow.position.set(0, m.sill + 0.26, -m.L / 2 - 0.5);
  tilt.add(flameGlow);

  /* ---------- 바퀴 (인스턴싱) ---------- */
  const tires = new THREE.InstancedMesh(tireGeometry(m), tireMat, 4);
  const rims = new THREE.InstancedMesh(rimGeometry(m, caliperColor), rimMat, 4);
  tires.frustumCulled = false;
  rims.frustumCulled = false;
  tires.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rims.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  wheelRoot.add(tires, rims);
  const wheelSlots = [
    { x: -(m.W / 2 - 0.02), z: m.wb / 2, front: true },
    { x: m.W / 2 - 0.02, z: m.wb / 2, front: true },
    { x: -(m.W / 2 - 0.02), z: -m.wb / 2, front: false },
    { x: m.W / 2 - 0.02, z: -m.wb / 2, front: false },
  ];
  const wheelMats = wheelSlots.map(() => new THREE.Matrix4());
  const spinArr = new Float32Array(4);
  const camber = [-0.035, -0.035, -0.015, -0.015];

  /* ---------- 콕핏 (1인칭) ---------- */
  const cockpit = new THREE.Group();
  cockpit.visible = false;
  tilt.add(cockpit);
  const COCKPIT_X = -0.33;
  const cockpitParts = [];
  // 대시보드 상판 (앞에서 뒤로 살짝 올라오는 쐐기)
  cockpitParts.push(placed(new THREE.BoxGeometry(1.34, 0.075, 0.24), {
    pos: [0, 1.055, 0.745], rot: [0.20, 0, 0],
  }));
  cockpitParts.push(placed(new THREE.BoxGeometry(1.30, 0.16, 0.10), {
    pos: [0, 0.985, 0.845], rot: [0.10, 0, 0],
  }));
  // 클러스터 후드 (계기판 위 그늘)
  cockpitParts.push(placed(new THREE.BoxGeometry(0.52, 0.055, 0.16), {
    pos: [COCKPIT_X, 1.135, 0.745], rot: [0.22, 0, 0],
  }));
  // 센터 콘솔
  cockpitParts.push(placed(new THREE.BoxGeometry(0.26, 0.12, 0.42), {
    pos: [0.05, 0.95, 0.52],
  }));
  // A필러 안쪽 + 도어 상단
  for (const s of [-1, 1]) {
    const from = new THREE.Vector3(s * (m.cabin.baseW - 0.06), m.cabin.baseY + 0.02, m.cabin.z0 - 0.06);
    const to = new THREE.Vector3(s * (m.cabin.roofW - 0.05), m.cabin.roofY - 0.04, m.cabin.roofZ0 + 0.04);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const dir = to.clone().sub(from);
    const b = new THREE.BoxGeometry(0.085, 0.085, dir.length());
    b.applyMatrix4(new THREE.Matrix4().compose(
      mid, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize()),
      new THREE.Vector3(1, 1, 1)
    ));
    cockpitParts.push(b);
    cockpitParts.push(placed(new THREE.BoxGeometry(0.05, 0.09, 1.0), {
      pos: [s * 0.72, 1.00, -0.20],
    }));
  }
  // 루프 헤더
  cockpitParts.push(placed(new THREE.BoxGeometry(1.12, 0.05, 0.14), {
    pos: [0, m.cabin.roofY - 0.075, m.cabin.roofZ0 + 0.02], rot: [-0.22, 0, 0],
  }));
  cockpit.add(new THREE.Mesh(mergeGeometries(cockpitParts), darkMat));

  // 스티어링 휠 (림 상단이 시야 아래쪽에 걸린다)
  const swGroup = new THREE.Group();
  swGroup.add(new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.019, 8, 24), darkMat));
  swGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.065, 0.028), darkMat));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.095, 0.014), darkMat);
    spoke.position.set(Math.cos(a) * 0.052, Math.sin(a) * 0.052, 0);
    spoke.rotation.z = a - Math.PI / 2;
    swGroup.add(spoke);
  }
  swGroup.position.set(COCKPIT_X, 1.005, 0.615);
  swGroup.rotation.x = 1.05;
  cockpit.add(swGroup);

  // 발광 계기판
  const cluster = new THREE.Mesh(
    new THREE.PlaneGeometry(0.40, 0.18),
    new THREE.MeshBasicMaterial({ map: clusterTexture('#' + col.getHexString()), transparent: true })
  );
  cluster.position.set(COCKPIT_X, 1.075, 0.795);
  cluster.rotation.x = -0.40;
  cockpit.add(cluster);

  // 실내 네온 라인
  cockpit.add(new THREE.Mesh(
    mergeGeometries([
      placed(new THREE.BoxGeometry(1.26, 0.007, 0.010), { pos: [0, 1.093, 0.815], rot: [0.2, 0, 0] }),
      placed(new THREE.BoxGeometry(0.007, 0.007, 0.82), { pos: [-0.705, 1.035, -0.18] }),
      placed(new THREE.BoxGeometry(0.007, 0.007, 0.82), { pos: [0.705, 1.035, -0.18] }),
    ]),
    trimMat
  ));

  /* ---------- 이름표 ---------- */
  let label = null;
  if (opts.label) {
    const canvas = makeCanvas(256, 64, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.font = 'bold 32px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = neonColor;
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(opts.label).slice(0, 10), w / 2, h / 2);
    });
    label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(canvas, { srgb: true }), transparent: true, depthWrite: false, depthTest: false }));
    label.scale.set(3.2, 0.8, 1);
    label.position.set(0, 2.1, 0);
    g.add(label);
  }

  /* ---------- 상태 ---------- */
  const state = { boost: 0, pitch: 0, roll: 0, prevSpeed: 0, firstPerson: false };
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3(1, 1, 1);

  function setCamMode(mode) {
    const first = mode === 'first';
    state.firstPerson = first;
    cockpit.visible = false;   // 1인칭 콕핏은 cockpit.js 오버레이가 담당
    cabinMesh.visible = !first;          // 1인칭에서는 유리 캐노피를 벗겨 시야를 확보
    glassMat.opacity = 0.72;
    if (label) label.visible = !first;
    beamMat.opacity = first ? 0.03 : 0.045;
    splash.material.opacity = first ? 0.14 : 0.12;
  }

  function update(car, dt, t, camMode) {
    if (camMode) {
      const first = camMode === 'first';
      if (first !== state.firstPerson) setCamMode(camMode);
    }
    g.position.set(car.x, 0, car.z);
    g.rotation.y = car.h;

    const speed = Math.abs(car.speed || 0);
    const accel = (car.speed - state.prevSpeed) / Math.max(1e-3, dt);
    state.prevSpeed = car.speed;

    const pitchTarget = THREE.MathUtils.clamp(-accel * 0.0022, -0.05, 0.05);
    state.pitch = THREE.MathUtils.lerp(state.pitch, pitchTarget, Math.min(1, dt * 6));
    // +steer = 화면 오른쪽 → 차체는 코너 바깥쪽으로 기운다(local z 음회전)
    const rollTarget = THREE.MathUtils.clamp(-(car.steer || 0) * 0.09 * Math.min(1, speed / 32), -0.11, 0.11);
    state.roll = THREE.MathUtils.lerp(state.roll, rollTarget, Math.min(1, dt * 7));
    tilt.rotation.x = state.pitch;
    tilt.rotation.z = state.roll;
    const bob = Math.sin((t || 0) * 9 + car.x * 0.1) * 0.004 * Math.min(1, speed / 20);
    tilt.position.y = bob;

    // 앞바퀴도 차가 꺾는 쪽(화면 오른쪽)을 본다
    const steer = -(car.steer || 0) * 0.50;
    for (let i = 0; i < 4; i++) {
      const slot = wheelSlots[i];
      spinArr[i] += (car.speed || 0) * dt / Math.max(0.1, m.wheelR);
      tmpE.set(spinArr[i], slot.front ? steer : 0, camber[i], 'YXZ');
      tmpQ.setFromEuler(tmpE);
      tmpV.set(slot.x, m.wheelR, slot.z);
      wheelMats[i].compose(tmpV, tmpQ, tmpS);
      tires.setMatrixAt(i, wheelMats[i]);
      rims.setMatrixAt(i, wheelMats[i]);
    }
    tires.instanceMatrix.needsUpdate = true;
    rims.instanceMatrix.needsUpdate = true;

    const boosting = (car.boostTime > 0 ? 1 : 0) + (car.nitroActive ? 1 : 0);
    state.boost = THREE.MathUtils.lerp(state.boost, Math.min(1.5, boosting), Math.min(1, dt * 12));
    const hot = state.boost > 1.05;
    flameMat.opacity = state.boost > 0.04 ? Math.min(0.85, 0.30 + state.boost * 0.45) : 0;
    flameMat.color.setHex(hot ? 0xffc46a : 0x7fefff);
    flameGlow.material.opacity = state.boost * 0.42;
    flameGlow.material.color.setHex(hot ? 0xffb347 : 0x9ffcff);
    const flick = 0.72 + Math.abs(Math.sin((t || 0) * 34)) * 0.42 + state.boost * 0.30;
    flames.scale.set(1 + state.boost * 0.18, 1 + state.boost * 0.18, flick);
    glow.material.opacity = 0.36 + state.boost * 0.34;
    tailMat.color.setHex(car.brake ? 0xff5c7a : 0xff2a52);
    tailGlow.material.opacity = (car.brake ? 0.55 : 0.20) + state.boost * 0.10;
    tailGlow.scale.setScalar(car.brake ? 1.2 : 1.0);
    beamMat.color.setHex(hot ? 0xcfe8ff : 0x9fdfff);
    tailMesh.visible = true;
  }

  function setVisible(v) { g.visible = v; }

  return {
    group: g, tilt, update, setVisible, setCamMode, spec, shape: m,
    wheels: [], glow, label, bodyMat, trimMat, col, cockpit,
  };
}
