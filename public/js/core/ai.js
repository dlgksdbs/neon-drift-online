/* =============================================================================
   ai.js — AI 레이서 (순수 JS): 레이싱 라인 추종 + 코너 속도 계획 + 부스터
   ============================================================================= */

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/* i 지점의 부호 있는 곡률 (좌회전 +, 우회전 -) */
export function signedCurvature(track, i) {
  const n = track.n;
  const a = (i - 1 + n) % n, b = (i + 1) % n;
  const da = wrapAngle(track.heading[b] - track.heading[a]);
  return da / (2 * track.segLen);
}

/* s 위치에서 앞쪽 구간의 최소 코너 반경 */
export function minRadiusAhead(track, s, dist) {
  const n = track.n;
  const from = Math.floor((s % track.total) / track.segLen);
  const steps = Math.max(1, Math.round(dist / track.segLen));
  let minR = Infinity, minIdx = from;
  for (let k = 0; k <= steps; k++) {
    const i = (from + k) % n;
    const c = Math.abs(signedCurvature(track, i)) + 1e-4;
    const r = 1 / c;
    if (r < minR) { minR = r; minIdx = i; }
  }
  return { minR, minIdx };
}

export function indexAtS(track, s) {
  return Math.floor((s % track.total) / track.segLen) % track.n;
}

/* 레이싱 라인 오프셋: 코너 안쪽으로 붙는다 */
export function racingOffset(track, s, strength = 0.55) {
  const n = track.n;
  const i = indexAtS(track, s);
  let sum = 0, w = 0;
  for (let k = 0; k < 14; k++) {
    const j = (i + k) % n;
    const c = signedCurvature(track, j);
    sum += c; w++;
  }
  const c = sum / w;
  // c>0 (좌회전) 이면 안쪽은 왼쪽 → lateral 음수
  const off = -Math.sign(c) * Math.min(1, Math.abs(c) * 60) * track.halfWidth * strength;
  return off;
}

export function createAIProfile(seed = 1) {
  // 씨앗 기반의 결정적 성향 (스킬·라인 성향)
  const r = (k) => {
    const x = Math.sin(seed * 9301.13 + k * 49297.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    seed,
    skill: 0.87 + r(1) * 0.12,          // 코너 속도 계수
    laneBias: (r(3) - 0.5) * 2.2,       // 라인 좌우 편향
    wobble: r(4) * 1.4,
    boostSkill: 0.55 + r(5) * 0.45,
  };
}

/* AI 입력 계산 */
export function aiInput(ai, car, s, t, track) {
  const speed = Math.abs(car.speed);
  const look = 11 + speed * 0.52;
  const targetS = s + look;
  const off = racingOffset(track, targetS) + ai.laneBias + Math.sin(t * 0.7 + ai.seed) * ai.wobble;
  const i = indexAtS(track, targetS);
  const nx = track.nx[i], nz = track.nz[i];
  const px = track.xs[i] + nx * off, pz = track.zs[i] + nz * off;
  const desired = Math.atan2(px - car.x, pz - car.z);
  const err = wrapAngle(desired - car.h);
  let steer = Math.max(-1, Math.min(1, err * 1.7));

  // 코너 속도 계획
  const ahead = minRadiusAhead(track, s, 70);
  const latAccel = 26 * ai.skill;
  const cornerSpeed = Math.sqrt(latAccel * Math.max(8, ahead.minR));
  const targetSpeed = Math.min(car.spec.maxSpeed * 1.02, cornerSpeed);
  const brakeDist = Math.max(0, (speed * speed - targetSpeed * targetSpeed) / (2 * 34));
  let throttle = 1, brake = 0;
  if (speed > targetSpeed * 1.04 && brakeDist < 26) { throttle = 0.05; brake = 1; }
  else if (speed > targetSpeed) { throttle = 0.35; }
  if (Math.abs(err) > 0.55 && speed > 26) { throttle = Math.min(throttle, 0.25); brake = Math.max(brake, 0.4); }

  // 부스터: 직선이 충분히 길 때
  const straight = minRadiusAhead(track, s, 95).minR;
  const boost = !!(car.boostFuel > 35 && straight > 220 && speed > 22 && ai.boostSkill > 0.5);

  return { throttle, brake, steer, boost };
}
