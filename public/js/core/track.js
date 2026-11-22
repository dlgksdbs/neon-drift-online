/* =============================================================================
   track.js — 네온 하버 서킷 정의 (순수 JS, Node 테스트와 브라우저가 함께 사용)
   좌표계: XZ 평면. 차량 heading h 일 때 전방 = (sin h, cos h).
   ============================================================================= */

export const TRACK_DEF = {
  name: '네온 하버 서킷',
  halfWidth: 9.0,
  // 폐곡선 컨트롤 포인트 (XZ). 직선 + 완만한 커브 + 드리프트용 헤어핀/시케인 혼합.
  control: [
    [-160, 60],   // 스타트/피니시 라인 (메인 스트레이트 위)
    [-160, -20],
    [-158, -90],  // 긴 메인 스트레이트 끝
    [-140, -160], // 턴1 진입
    [-95, -200],
    [-30, -212],  // 바닥 헤어핀
    [35, -200],
    [90, -170],
    [125, -115],
    [136, -45],
    [122, 15],    // 시케인
    [145, 60],
    [128, 115],   // 탑 헤어핀
    [80, 150],
    [15, 162],
    [-50, 162],
    [-102, 168],  // 마지막 코너 진입
    [-130, 155],
    [-152, 132],
  ],
};

/* ---------- Catmull-Rom (uniform, closed) ---------- */
function crPoint(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

function densify(control, perSeg = 48) {
  const n = control.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = control[(i - 1 + n) % n], p1 = control[i], p2 = control[(i + 1) % n], p3 = control[(i + 2) % n];
    for (let k = 0; k < perSeg; k++) out.push(crPoint(p0, p1, p2, p3, k / perSeg));
  }
  return out;
}

/* ---------- 호장(arc-length) 기준 등간격 재샘플 ---------- */
function resample(points, spacing) {
  const n = points.length;
  const cum = [0];
  for (let i = 1; i <= n; i++) {
    const a = points[i - 1], b = points[i % n];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[n];
  const count = Math.max(64, Math.round(total / spacing));
  const step = total / count;
  const xs = [], zs = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (j < n - 1 && cum[j + 1] < target) j++;
    const segLen = cum[j + 1] - cum[j] || 1e-6;
    const t = (target - cum[j]) / segLen;
    const a = points[j], b = points[(j + 1) % n];
    xs.push(a[0] + (b[0] - a[0]) * t);
    zs.push(a[1] + (b[1] - a[1]) * t);
  }
  return { xs, zs, total };
}

function smoothLoop(arr, passes = 2) {
  let cur = arr.slice();
  for (let p = 0; p < passes; p++) {
    const next = new Array(cur.length);
    for (let i = 0; i < cur.length; i++) {
      const a = cur[(i - 1 + cur.length) % cur.length];
      const b = cur[i];
      const c = cur[(i + 1) % cur.length];
      next[i] = a * 0.25 + b * 0.5 + c * 0.25;
    }
    cur = next;
  }
  return cur;
}

export function buildTrack(def = TRACK_DEF) {
  const dense = densify(def.control, 48);
  const rs = resample(dense, 3.0);
  const xs = smoothLoop(rs.xs, 2);
  const zs = smoothLoop(rs.zs, 2);
  const n = xs.length;

  // 누적 호장
  const s = new Array(n);
  let total = 0;
  for (let i = 1; i <= n; i++) {
    const a = i - 1, b = i % n;
    total += Math.hypot(xs[b] - xs[a], zs[b] - zs[a]);
    if (i < n) s[i] = total;
  }
  s[0] = 0;
  const segLen = total / n;

  // 접선/노멀
  const tx = new Array(n), tz = new Array(n), nx = new Array(n), nz = new Array(n), heading = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    let dx = xs[b] - xs[a], dz = zs[b] - zs[a];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    tx[i] = dx; tz[i] = dz;
    // 오른쪽 노멀 (forward=(dx,dz) 기준): right = (dz, -dx)
    nx[i] = dz; nz[i] = -dx;
    heading[i] = Math.atan2(dx, dz);
  }

  // 곡률(코너 반경)
  const curvature = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    const cross = tx[a] * tz[b] - tz[a] * tx[b];
    const dot = tx[a] * tx[b] + tz[a] * tz[b];
    const dTheta = Math.atan2(cross, dot);
    curvature[i] = Math.abs(dTheta) / (segLen * 2);
  }

  // 체크포인트: 8개 균등 + 시작선(0)
  const cpCount = 8;
  const checkpoints = [];
  for (let k = 0; k < cpCount; k++) {
    const target = (k * total) / cpCount;
    let idx = 0;
    while (idx < n - 1 && s[idx + 1] < target) idx++;
    checkpoints.push({ s: target, index: idx, x: xs[idx], z: zs[idx], heading: heading[idx], k });
  }

  return {
    name: def.name || TRACK_DEF.name,
    halfWidth: def.halfWidth,
    n, total, segLen, xs, zs, tx, tz, nx, nz, heading, curvature, checkpoints,
    start: { x: xs[0], z: zs[0], heading: heading[0] },
    bounds: {
      minX: Math.min(...xs) - 40, maxX: Math.max(...xs) + 40,
      minZ: Math.min(...zs) - 40, maxZ: Math.max(...zs) + 40,
    },
  };
}

/* ---------- 구간 탐색: 힌트 인덱스 주변 우선 ---------- */
export function nearest(track, x, z, hint) {
  const { xs, zs, n } = track;
  let best = -1, bestD2 = Infinity, bestT = 0;
  const scan = (i0, count) => {
    for (let k = 0; k < count; k++) {
      const i = (i0 + k + n) % n;
      const j = (i + 1) % n;
      const ax = xs[i], az = zs[i], bx = xs[j], bz = zs[j];
      const ex = bx - ax, ez = bz - az;
      const len2 = ex * ex + ez * ez || 1e-6;
      let t = ((x - ax) * ex + (z - az) * ez) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + ex * t, pz = az + ez * t;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < bestD2) { bestD2 = d2; best = i; bestT = t; }
    }
  };
  if (typeof hint === 'number' && hint >= 0) scan(hint - 12, 26);
  if (best < 0 || bestD2 > 400) { bestD2 = Infinity; best = -1; scan(0, n); }

  const i = best, j = (i + 1) % n;
  const ax = xs[i], az = zs[i], bx = xs[j], bz = zs[j];
  const px = ax + (bx - ax) * bestT, pz = az + (bz - az) * bestT;
  const tx = track.tx[i], tz = track.tz[i];
  const nx = track.nx[i], nz = track.nz[i];
  const lateral = (x - px) * nx + (z - pz) * nz;
  const s = (i + bestT) * track.segLen;
  return { index: i, t: bestT, x: px, z: pz, s, lateral, dist: Math.sqrt(bestD2), tx, tz, nx, nz, heading: track.heading[i] };
}

/* ---------- 경로 위 위치(s) + 오프셋으로 월드 좌표 ---------- */
export function sample(track, s, lateral = 0) {
  const n = track.n;
  let ss = s % track.total;
  if (ss < 0) ss += track.total;
  const f = ss / track.segLen;
  const i = Math.floor(f) % n, j = (i + 1) % n, t = f - Math.floor(f);
  const x = track.xs[i] + (track.xs[j] - track.xs[i]) * t + track.nx[i] * lateral;
  const z = track.zs[i] + (track.zs[j] - track.zs[i]) * t + track.nz[i] * lateral;
  return { x, z, heading: track.heading[i], tx: track.tx[i], tz: track.tz[i], nx: track.nx[i], nz: track.nz[i], index: i };
}

/* ---------- 부스터 패드 & 램프(시각용) ---------- */
export const BOOST_PADS = [
  { s: 0.055, lateral: 0, len: 12, width: 6.5 },
  { s: 0.24, lateral: -4.5, len: 10, width: 4.6 },
  { s: 0.47, lateral: 4.5, len: 11, width: 4.6 },
  { s: 0.66, lateral: 0, len: 12, width: 6.5 },
  { s: 0.87, lateral: -2.5, len: 10, width: 5.0 },
];

export function buildPads(track) {
  return BOOST_PADS.map((p, i) => {
    const s = p.s * track.total;
    const c = sample(track, s, p.lateral);
    return { ...p, i, s, x: c.x, z: c.z, heading: c.heading, nx: c.nx, nz: c.nz };
  });
}

/* 자주 쓰는 기본 트랙 */
export const TRACK = buildTrack(TRACK_DEF);
