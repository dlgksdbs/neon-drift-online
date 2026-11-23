import * as THREE from 'three';

/* =============================================================================
   meshUtil.js — 지오메트리 합치기 / 버텍스 컬러 / 단면 스윕(로프트)
   드로우 콜을 줄이려고 재질별로 조각을 하나의 BufferGeometry 로 합친다.
   ============================================================================= */

/* 인덱스 지오메트리(position/normal/uv)를 하나로 합친다. */
export function mergeGeometries(list) {
  const parts = list.filter(Boolean);
  if (!parts.length) return new THREE.BufferGeometry();
  let vCount = 0, iCount = 0;
  for (const g of parts) {
    const p = g.getAttribute('position');
    vCount += p.count;
    const idx = g.getIndex();
    iCount += idx ? idx.count : p.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const col = new Float32Array(vCount * 3);
  const index = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of parts) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    const c = g.getAttribute('color');
    pos.set(p.array.subarray(0, p.count * 3), vo * 3);
    if (n) nor.set(n.array.subarray(0, p.count * 3), vo * 3);
    if (u) uv.set(u.array.subarray(0, p.count * 2), vo * 2);
    if (c) col.set(c.array.subarray(0, p.count * 3), vo * 3);
    else col.fill(1, vo * 3, (vo + p.count) * 3);
    const idx = g.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i++) index[io + i] = idx.getX(i) + vo;
      io += idx.count;
    } else {
      for (let i = 0; i < p.count; i++) index[io + i] = i + vo;
      io += p.count;
    }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/* 조각마다 색을 지정해 합친다: [{geo, color}] — 재질은 vertexColors 사용 */
export function mergeColored(parts) {
  const list = parts.map(({ geo, color }) => {
    const c = new THREE.Color(color === undefined ? 0xffffff : color);
    const n = geo.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  });
  return mergeGeometries(list);
}

/* 지오메트리를 위치/회전/스케일 지정해 복제 변환 */
export function placed(geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  m.compose(new THREE.Vector3(pos[0], pos[1], pos[2]), q, new THREE.Vector3(scale[0], scale[1], scale[2]));
  geo.applyMatrix4(m);
  return geo;
}

/* 2D 점 목록을 Catmull-Rom 으로 부드럽게 이어 샘플 */
export function smooth2D(points, perSeg = 8, closed = false) {
  const out = [];
  const n = points.length;
  const at = (i) => {
    if (closed) return points[(i + n) % n];
    return points[Math.max(0, Math.min(n - 1, i))];
  };
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push(points[n - 1]);
  return out;
}

/* 회전체: 프로파일([r, y] 목록)을 축 주위로 회전. axis 는 'x' | 'y' | 'z' */
export function lathe(profile, segments, axis = 'y') {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  const g = new THREE.LatheGeometry(pts, segments);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

/* 둥근 사각 단면 링을 만들어 z 축으로 이어붙인 셸 — 유선형 캐노피용 */
export function loftRings(stations, radial = 20) {
  const rings = [];
  for (const st of stations) {
    const ring = [];
    for (let j = 0; j < radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const cs = Math.cos(th), sn = Math.sin(th);
      const ex = sn > 0 ? (st.exp || 2.4) : (st.expBot || st.exp || 2.4);
      const sx = Math.sign(cs) * Math.pow(Math.abs(cs), 2 / ex);
      const sy = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / ex);
      ring.push(new THREE.Vector3(
        sx * st.w,
        st.cy + (sy > 0 ? sy * st.hTop : sy * st.hBot),
        st.z
      ));
    }
    rings.push(ring);
  }
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < rings.length; i++) {
    for (let j = 0; j < radial; j++) {
      const v = rings[i][j];
      pos.push(v.x, v.y, v.z);
      uv.push(j / radial, i / (rings.length - 1));
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + (j + 1) % radial;
      const c = a + radial, d = b + radial;
      idx.push(a, b, c, b, d, c);
    }
  }
  // 양 끝 캡
  const capStart = rings.length * radial;
  const first = rings[0], lastRing = rings[rings.length - 1];
  pos.push(0, first[0].y, first[0].z); uv.push(0.5, 0);
  pos.push(0, lastRing[0].y, lastRing[0].z); uv.push(0.5, 1);
  for (let j = 0; j < radial; j++) {
    idx.push(capStart, (j + 1) % radial, j);
    const base = (rings.length - 1) * radial;
    idx.push(capStart + 1, base + j, base + (j + 1) % radial);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* 곡선 튜브(임의 점열) — 네온 라인용 */
export function tubeFrom(points, radius, segs = 60, radial = 5, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  return new THREE.TubeGeometry(curve, segs, radius, radial, closed);
}
