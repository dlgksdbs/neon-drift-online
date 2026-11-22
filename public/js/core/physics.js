/* =============================================================================
   physics.js — 아케이드 드리프트 차량 물리 (순수 JS)
   - world 좌표: XZ, heading h → 전방 = (sin h, cos h)
   - 속도는 월드 벡터로 유지하고, heading 회전 + 횡방향 그립 감쇠로 미끄러짐을 만든다.
   ============================================================================= */

export const CAR_SPECS = {
  coupe: {
    key: 'coupe', name: '네온 쿠페', tag: '밸런스', desc: '다루기 쉬운 올라운더',
    accel: 17, brakeDecel: 30, maxSpeed: 52, reverseMax: 12,
    grip: 11.5, driftGrip: 3.2, steerRate: 2.35, driftSteerMul: 1.32,
    driftCharge: 1.0, boostMul: 1.0, nitroAccel: 14, topBoostMul: 1.24,
  },
  gt: {
    key: 'gt', name: '드리프트 GT', tag: '드리프트', desc: '미끄러짐이 길고 게이지가 빨리 찬다',
    accel: 16, brakeDecel: 28, maxSpeed: 50, reverseMax: 12,
    grip: 9.6, driftGrip: 2.05, steerRate: 2.55, driftSteerMul: 1.42,
    driftCharge: 1.38, boostMul: 1.15, nitroAccel: 13.5, topBoostMul: 1.22,
  },
  hyper: {
    key: 'hyper', name: '하이퍼카', tag: '최고속', desc: '직선이 강하고 그립이 높다',
    accel: 19, brakeDecel: 32, maxSpeed: 58, reverseMax: 12,
    grip: 12.5, driftGrip: 3.9, steerRate: 2.2, driftSteerMul: 1.26,
    driftCharge: 0.86, boostMul: 1.05, nitroAccel: 16, topBoostMul: 1.28,
  },
};

export const DRIFT_TIERS = [
  { key: 'none', name: '없음', min: 0, color: '#7f8c9b', boost: 0, time: 0 },
  { key: 'blue', name: '블루', min: 30, color: '#39a7ff', boost: 5, time: 1.05 },
  { key: 'purple', name: '퍼플', min: 60, color: '#b45cff', boost: 8, time: 1.65 },
  { key: 'gold', name: '골드', min: 90, color: '#ffcc33', boost: 11, time: 2.35 },
];

export const WALL_LIMIT = 8.35;      // 차량 중심이 갈 수 있는 최대 |lateral|
export const GRAVITY_NONE = 0;

export function driftTier(gauge) {
  if (gauge >= DRIFT_TIERS[3].min) return DRIFT_TIERS[3];
  if (gauge >= DRIFT_TIERS[2].min) return DRIFT_TIERS[2];
  if (gauge >= DRIFT_TIERS[1].min) return DRIFT_TIERS[1];
  return DRIFT_TIERS[0];
}

export function createCar(spec, opts = {}) {
  return {
    spec,
    x: opts.x || 0, z: opts.z || 0, h: opts.h || 0,
    vx: 0, vz: 0,
    speed: 0, slip: 0,
    drifting: false, driftTime: 0, gauge: 0,
    boostTime: 0, boostFuel: 100, nitroActive: false,
    throttle: 0, steer: 0,
    wallHit: 0, padCooldown: 0, lastPad: -1,
    padFlash: 0, driftTierKey: 'none',
    distance: 0, finished: false,
    wheelSpin: 0,
  };
}

/* 한 프레임(서브스텝) 물리. dt 는 고정 1/120 권장. */
export function stepCar(car, input, dt, world = {}) {
  const spec = car.spec;
  const track = world.track || null;
  const fx = Math.sin(car.h), fz = Math.cos(car.h);
  const rx = Math.cos(car.h), rz = -Math.sin(car.h);

  // --- 속도 분해
  let vf = car.vx * fx + car.vz * fz;
  let vl = car.vx * rx + car.vz * rz;

  const throttle = Math.max(0, Math.min(1, input.throttle || 0));
  const brake = Math.max(0, Math.min(1, input.brake || 0));
  const steerIn = Math.max(-1, Math.min(1, input.steer || 0));
  car.throttle = throttle; car.steer = steerIn;

  // --- 니트로 연료
  if (input.boost && car.boostFuel > 2 && !car.finished) {
    car.nitroActive = true;
    car.boostFuel = Math.max(0, car.boostFuel - 40 * dt);
  } else {
    car.nitroActive = false;
    car.boostFuel = Math.min(100, car.boostFuel + 7.5 * dt);
  }

  const boosting = car.boostTime > 0 || car.nitroActive;
  if (car.boostTime > 0) car.boostTime = Math.max(0, car.boostTime - dt);

  // --- 드리프트 상태
  const canDrift = !!input.drift && Math.abs(vf) > 13 && !car.finished;
  const wasDrifting = car.drifting;
  car.drifting = canDrift && (Math.abs(steerIn) > 0.12 || car.driftTime > 0.08) && Math.abs(steerIn) > 0.05;
  if (car.drifting && !wasDrifting) car.driftTime = 0;
  if (car.drifting) car.driftTime += dt;

  // 드리프트 종료 → 충전 단계에 따른 미니 터보
  if (wasDrifting && !car.drifting) {
    const tier = driftTier(car.gauge);
    if (tier.boost > 0) {
      car.boostTime = Math.max(car.boostTime, tier.time * spec.boostMul);
      vf += tier.boost;
      car.driftTierKey = tier.key;
      car.driftReleased = tier.key;
    }
    car.gauge = 0;
    car.driftTime = 0;
  }

  // --- 조향
  const speedFactor = Math.min(1, Math.abs(vf) / 9) * (1 - 0.28 * Math.min(1, Math.abs(vf) / spec.maxSpeed));
  let steerRate = spec.steerRate * (car.drifting ? spec.driftSteerMul : 1);
  const dir = vf < -0.5 ? -1 : 1;
  let yaw = steerIn * steerRate * speedFactor * dir;
  if (brake > 0.5 && Math.abs(vf) > 18 && !car.drifting) yaw *= 1.12; // 브레이크 턴 살짝
  car.h += yaw * dt;

  // --- 추진 / 제동
  const topSpeed = spec.maxSpeed * (boosting ? spec.topBoostMul : 1);
  if (throttle > 0) {
    const accel = spec.accel * (1 - Math.min(1, Math.abs(vf) / topSpeed)) * throttle;
    vf += accel * dt;
    if (boosting) vf += spec.nitroAccel * dt;
  } else if (brake > 0) {
    if (vf > 0.5) vf = Math.max(0, vf - spec.brakeDecel * brake * dt);
    else vf = Math.max(-spec.reverseMax, vf - spec.accel * 0.55 * brake * dt);
  }
  if (car.nitroActive && vf < topSpeed) vf += spec.nitroAccel * 0.55 * dt;

  // 저항
  const drag = boosting ? 0.12 : 0.28;
  vf *= Math.exp(-drag * dt);
  if (car.drifting) vf *= Math.exp(-0.16 * dt);

  // --- 횡방향 그립(미끄러짐 유지)
  const grip = car.drifting ? spec.driftGrip : spec.grip;
  vl *= Math.exp(-grip * dt);
  // 회전 중 원심력 느낌: 조향이 클수록 살짝 밖으로 밀림
  vl += yaw * vf * dt * (car.drifting ? 0.55 : 0.10);

  // --- 드리프트 게이지
  const slipAngle = Math.abs(Math.atan2(vl, Math.max(4, Math.abs(vf))));
  car.slip = slipAngle;
  if (car.drifting) {
    const slideFactor = Math.min(1, slipAngle / 0.28);
    car.gauge = Math.min(100, car.gauge + dt * (16 + 30 * Math.abs(steerIn) + 0.5 * Math.abs(vf)) * spec.driftCharge * (0.35 + 0.65 * slideFactor));
  } else if (car.gauge > 0) {
    car.gauge = Math.max(0, car.gauge - dt * 26);
  }

  // 새 heading 으로 재조립
  const nfx = Math.sin(car.h), nfz = Math.cos(car.h);
  const nrx = Math.cos(car.h), nrz = -Math.sin(car.h);
  car.vx = nfx * vf + nrx * vl;
  car.vz = nfz * vf + nrz * vl;

  car.x += car.vx * dt;
  car.z += car.vz * dt;
  car.speed = Math.hypot(car.vx, car.vz) * (car.vx * nfx + car.vz * nfz < 0 ? -1 : 1);
  car.wheelSpin += dt * (2 + Math.abs(vf) * 0.45);

  // --- 벽/가드레일 충돌
  car.wallHit = 0;
  if (track) {
    const near = world.nearest || null;
    const q = near ? near(car.x, car.z) : null;
    if (q && Math.abs(q.lateral) > WALL_LIMIT) {
      const side = Math.sign(q.lateral);
      const over = Math.abs(q.lateral) - WALL_LIMIT;
      // 안쪽으로 밀어 넣기
      car.x -= q.nx * side * over;
      car.z -= q.nz * side * over;
      const outwardX = q.nx * side, outwardZ = q.nz * side;
      const vn = car.vx * outwardX + car.vz * outwardZ;
      if (vn > 0) {
        car.vx -= outwardX * vn * 1.38;
        car.vz -= outwardZ * vn * 1.38;
        // 진행 방향 성분 감속
        const keep = Math.max(0.62, 1 - Math.min(0.34, vn / 40));
        car.vx *= keep; car.vz *= keep;
        car.wallHit = Math.min(1, vn / 26);
      }
    }
    // 트랙 밖으로 완전히 이탈한 비정상 상태 복구
    const q2 = near ? near(car.x, car.z) : null;
    if (q2 && Math.abs(q2.lateral) > WALL_LIMIT + 3) {
      car.x = q2.x + q2.nx * Math.sign(q2.lateral) * (WALL_LIMIT - 0.5);
      car.z = q2.z + q2.nz * Math.sign(q2.lateral) * (WALL_LIMIT - 0.5);
      car.vx *= 0.4; car.vz *= 0.4;
    }
  }

  // --- 부스터 패드
  if (world.pads && world.pads.length && car.padCooldown <= 0) {
    for (const p of world.pads) {
      const dx = car.x - p.x, dz = car.z - p.z;
      const along = dx * Math.sin(p.heading) + dz * Math.cos(p.heading);
      const side = dx * Math.cos(p.heading) - dz * Math.sin(p.heading);
      if (Math.abs(along) < p.len / 2 + 1.2 && Math.abs(side) < p.width / 2 + 0.4) {
        car.boostTime = Math.max(car.boostTime, 1.15);
        vf = Math.min(Math.max(Math.hypot(car.vx, car.vz) + 7, 13), spec.maxSpeed * spec.topBoostMul * 1.1);
        car.vx = Math.sin(car.h) * vf; car.vz = Math.cos(car.h) * vf;
        car.padCooldown = 0.6; car.lastPad = p.i; car.padFlash = 1;
        car.padEvent = p.i;
        break;
      }
    }
  }
  if (car.padCooldown > 0) car.padCooldown -= dt;
  if (car.padFlash > 0) car.padFlash = Math.max(0, car.padFlash - dt * 2.2);

  car.speed = Math.hypot(car.vx, car.vz);
  return car;
}

/* 실제 속도(km/h) 표시용 */
export function kmh(car) {
  return Math.max(0, car.speed) * 3.6;
}

/* 여러 서브스텝으로 안정적으로 진행 */
export function stepCarFixed(car, input, dtTotal, world, step = 1 / 120) {
  let left = Math.min(dtTotal, 0.1);
  const events = { miniTurbo: null, pad: -1, wall: 0, nitro: false };
  let guard = 0;
  while (left > 1e-6 && guard++ < 24) {
    const dt = Math.min(step, left);
    left -= dt;
    const before = car.boostTime;
    const wasPad = car.lastPad, padFlashBefore = car.padFlash;
    stepCar(car, input, dt, world);
    if (car.boostTime > before + 0.05) events.miniTurbo = car.driftReleased || 'nitro';
    if (car.padFlash > padFlashBefore + 0.5) events.pad = car.lastPad;
    if (car.wallHit > events.wall) events.wall = car.wallHit;
    if (car.nitroActive) events.nitro = true;
  }
  car.driftReleased = null;
  return events;
}
