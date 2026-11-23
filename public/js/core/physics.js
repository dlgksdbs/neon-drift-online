/* =============================================================================
   physics.js — 아케이드 카트형 차량 물리 (순수 JS)
   - world 좌표: XZ, heading h → 전방 = (sin h, cos h)
   - 조향은 누른 방향으로 바로 꺾인다: heading 이 즉시 돌고, 속도는 항상 차체
     진행 방향으로 정렬된다(횡슬립 최소). 미끄러짐·드리프트 상태는 없다.
   ============================================================================= */

export const CAR_SPECS = {
  coupe: {
    key: 'coupe', name: '네온 쿠페', tag: '밸런스', desc: '다루기 쉬운 올라운더',
    accel: 17, brakeDecel: 30, maxSpeed: 52, reverseMax: 12,
    grip: 26, steerRate: 2.9, nitroAccel: 14, topBoostMul: 1.24,
  },
  gt: {
    key: 'gt', name: '코너 GT', tag: '코너링', desc: '코너에서 민첩하게 붙는다',
    accel: 16, brakeDecel: 28, maxSpeed: 50, reverseMax: 12,
    grip: 28, steerRate: 3.15, nitroAccel: 13.5, topBoostMul: 1.22,
  },
  hyper: {
    key: 'hyper', name: '하이퍼카', tag: '최고속', desc: '직선이 강하고 안정적',
    accel: 19, brakeDecel: 32, maxSpeed: 58, reverseMax: 12,
    grip: 24, steerRate: 2.7, nitroAccel: 16, topBoostMul: 1.28,
  },
};

export const WALL_LIMIT = 8.35;      // 차량 중심이 갈 수 있는 최대 |lateral|
export const GRAVITY_NONE = 0;

export function createCar(spec, opts = {}) {
  return {
    spec,
    x: opts.x || 0, z: opts.z || 0, h: opts.h || 0,
    vx: 0, vz: 0,
    speed: 0, slip: 0,
    boostTime: 0, boostFuel: 100, nitroActive: false,
    throttle: 0, steer: 0, brake: 0,
    wallHit: 0, padCooldown: 0, lastPad: -1,
    padFlash: 0, padEvent: -1,
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
  car.throttle = throttle; car.steer = steerIn; car.brake = brake;

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

  // --- 조향: 누르는 즉시 차체가 그 방향으로 돈다.
  // 3 m/s 부터 완전 조향, 최고속에서도 20%만 줄어 코너를 놓치지 않는다.
  const speedFactor = Math.min(1, Math.abs(vf) / 3);
  const speedNarrow = 1 - 0.2 * Math.min(1, Math.abs(vf) / spec.maxSpeed);
  const steerRate = spec.steerRate * speedNarrow;
  const dir = vf < -0.5 ? -1 : 1;
  // 부호 규약: steer +1 = 운전자(화면) 기준 오른쪽.
  // 전방 = (sin h, cos h) 이고 카메라는 차 뒤에서 전방을 바라보므로 이 좌표계에서
  // 월드 +x 는 화면 왼쪽이다. 그래서 화면 오른쪽으로 꺾으려면 heading 을 "줄여야" 한다.
  // (예전에는 늘려서 핸들을 오른쪽으로 돌리면 차가 왼쪽으로 갔다)
  const yaw = -steerIn * steerRate * speedFactor * dir;
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

  // --- 횡방향 그립: 옆으로 흐르는 속도를 빠르게 잡아 차체 방향으로 정렬한다.
  vl *= Math.exp(-spec.grip * dt);
  car.slip = Math.abs(Math.atan2(vl, Math.max(4, Math.abs(vf))));

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
  const events = { pad: -1, wall: 0, nitro: false };
  let guard = 0;
  while (left > 1e-6 && guard++ < 24) {
    const dt = Math.min(step, left);
    left -= dt;
    const padFlashBefore = car.padFlash;
    stepCar(car, input, dt, world);
    if (car.padFlash > padFlashBefore + 0.5) events.pad = car.lastPad;
    if (car.wallHit > events.wall) events.wall = car.wallHit;
    if (car.nitroActive) events.nitro = true;
  }
  return events;
}
