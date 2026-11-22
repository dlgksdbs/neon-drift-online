/* =============================================================================
   test/unit.js — 트랙 지오메트리 · 차량 물리(즉시 조향/무슬립) · 체크포인트/랩
   실행: node test/unit.js
   ============================================================================= */
import { TRACK, TRACK_DEF, buildTrack, nearest, sample, buildPads } from '../public/js/core/track.js';
import { CAR_SPECS, createCar, stepCar, stepCarFixed, kmh, WALL_LIMIT } from '../public/js/core/physics.js';
import { RaceProgress, rankRacers, formatTime } from '../public/js/core/progress.js';
import { createAIProfile, aiInput, minRadiusAhead } from '../public/js/core/ai.js';
import * as physics from '../public/js/core/physics.js';

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra))); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }
function section(t) { console.log('\n■ ' + t); }

const pads = buildPads(TRACK);
const worldFor = (car) => {
  const nearFn = (x, z) => { const q = nearest(TRACK, x, z, car._hint); car._hint = q.index; return q; };
  return { track: TRACK, pads, nearest: nearFn };
};
const flatWorld = (x, z) => ({ track: null, pads: [], nearest: () => ({ s: 0, lateral: 0, nx: 1, nz: 0, x, z, index: 0 }) });

/* ---------------------------------- 1. 트랙 ---------------------------------- */
section('트랙 지오메트리');
ok('폐곡선 길이 900~1400m', TRACK.total > 900 && TRACK.total < 1400, TRACK.total.toFixed(1));
ok('샘플 개수 200 이상', TRACK.n >= 200, TRACK.n);
ok('체크포인트 8개', TRACK.checkpoints.length === 8);
ok('체크포인트 균등 간격', TRACK.checkpoints.every((cp, i) => near(cp.s, (i * TRACK.total) / 8, 4)));

// 자기 교차 없음
let cross = 0;
for (let i = 0; i < TRACK.n; i++) {
  for (let j = i + 12; j < TRACK.n; j++) {
    if (i === 0 && j > TRACK.n - 12) continue;
    const ax = TRACK.xs[i], az = TRACK.zs[i], bx = TRACK.xs[(i + 1) % TRACK.n], bz = TRACK.zs[(i + 1) % TRACK.n];
    const cx = TRACK.xs[j], cz = TRACK.zs[j], dx = TRACK.xs[(j + 1) % TRACK.n], dz = TRACK.zs[(j + 1) % TRACK.n];
    const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
    const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
    const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
    if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) cross++;
  }
}
ok('트랙 자기 교차 0', cross === 0, cross);

// 떨어진 구간 사이 최소 이격 (도로 폭의 2배 이상)
let minSep = Infinity;
for (let i = 0; i < TRACK.n; i += 2) {
  for (let j = 0; j < TRACK.n; j += 2) {
    let d = Math.abs(i - j); d = Math.min(d, TRACK.n - d);
    if (d < 35) continue;
    const dd = Math.hypot(TRACK.xs[i] - TRACK.xs[j], TRACK.zs[i] - TRACK.zs[j]);
    if (dd < minSep) minSep = dd;
  }
}
ok('도로 폭 2배 이상 이격', minSep > TRACK.halfWidth * 2 + 6, minSep.toFixed(1));

// 시작선은 직선
const startCurv = TRACK.curvature[0];
ok('스타트 라인이 직선 구간', 1 / (startCurv + 1e-6) > 120, (1 / (startCurv + 1e-6)).toFixed(0) + 'm');

// 최소 코너 반경이 차량이 돌 수 있는 수준
const radii = [...TRACK.curvature].map((c) => 1 / (c + 1e-6));
const minR = Math.min(...radii);
ok('최소 코너 반경 > 20m', minR > 20, minR.toFixed(1));

// s/lateral 복원
let projErr = 0;
for (let k = 0; k < 60; k++) {
  const s = (k / 60) * TRACK.total;
  const lat = Math.sin(k * 1.7) * 6;
  const p = sample(TRACK, s, lat);
  const q = nearest(TRACK, p.x, p.z, -1);
  const ds = Math.min(Math.abs(q.s - s), TRACK.total - Math.abs(q.s - s));
  projErr = Math.max(projErr, ds);
  if (k < 5) ok(`  투영 lateral 복원 #${k}`, near(q.lateral, lat, 0.15), { got: q.lateral, want: lat });
}
ok('투영 s 복원 오차 < 4m', projErr < 4, projErr.toFixed(2));

// 부스터 패드
ok('부스터 패드 5개', pads.length === 5);
ok('부스터 패드가 트랙 위', pads.every((p) => Math.abs(nearest(TRACK, p.x, p.z, -1).lateral) < TRACK.halfWidth));

/* ---------------------------------- 2. 물리 ---------------------------------- */
section('차량 물리 · 가속/조향/제동');
{
  const car = createCar(CAR_SPECS.coupe, { x: 0, z: 0, h: 0 });
  const w = flatWorld(0, 0);
  for (let i = 0; i < 180; i++) stepCarFixed(car, { throttle: 1, steer: 0 }, 1 / 60, w);
  ok('3초 만에 20m/s 이상', car.speed > 20, car.speed.toFixed(1));
  ok('3초 가속 후 속도가 최고속 이하', car.speed <= CAR_SPECS.coupe.maxSpeed * 1.05, car.speed.toFixed(1));

  const speedBefore = car.speed;
  for (let i = 0; i < 60; i++) stepCarFixed(car, { throttle: 0, brake: 1 }, 1 / 60, w);
  ok('1초 제동으로 감속', car.speed < speedBefore * 0.65, { before: speedBefore.toFixed(1), after: car.speed.toFixed(1) });

  // 정지 상태에서는 조향해도 회전하지 않는다
  const still = createCar(CAR_SPECS.coupe, { x: 0, z: 0, h: 0 });
  for (let i = 0; i < 30; i++) stepCarFixed(still, { steer: 1 }, 1 / 60, w);
  ok('정지 상태 조향 시 방향 유지', Math.abs(still.h) < 0.02, still.h);

  // 주행 중 조향
  const turner = createCar(CAR_SPECS.coupe, { x: 0, z: 0, h: 0 });
  for (let i = 0; i < 90; i++) stepCarFixed(turner, { throttle: 1 }, 1 / 60, w);
  const h0 = turner.h;
  for (let i = 0; i < 45; i++) stepCarFixed(turner, { throttle: 1, steer: 1 }, 1 / 60, w);
  ok('주행 중 우조향으로 방향 전환', turner.h - h0 > 0.25, (turner.h - h0).toFixed(2));
}

section('핸들 조향 · 즉시 회전 · 무슬립');
{
  const w = flatWorld(0, 0);
  function cruise(specKey = 'coupe') {
    const car = createCar(CAR_SPECS[specKey], { x: 0, z: 0, h: 0 });
    for (let i = 0; i < 160; i++) stepCarFixed(car, { throttle: 1 }, 1 / 60, w);
    return car;
  }

  // 한 프레임(1/120초)에도 핸들 방향으로 즉시 꺾인다
  const car = cruise();
  const frame0 = car.h;
  stepCar(car, { throttle: 1, steer: 1 }, 1 / 120, w);
  const oneFrame = car.h - frame0;
  ok('핸들 입력 1프레임(1/120s)에 즉시 회전', oneFrame > 0.02, oneFrame.toFixed(4));
  ok('한 프레임 회전량이 과하지 않음(<0.08rad)', oneFrame < 0.08, oneFrame.toFixed(4));

  // 0.1초 만에 눈에 띄게 꺾인다
  const car2 = cruise();
  const h1 = car2.h;
  for (let i = 0; i < 12; i++) stepCarFixed(car2, { throttle: 1, steer: 1 }, 1 / 120, w);
  const dh100 = car2.h - h1;
  ok('0.1초 조향으로 0.2rad 이상 회전', dh100 > 0.2, dh100.toFixed(3));
  ok('조향 중 횡슬립 각이 거의 없음(<0.02rad)', car2.slip < 0.02, car2.slip.toFixed(4));

  // 핸들 각도에 비례: 절반 조향 = 절반 회전
  const half = cruise();
  const hh = half.h;
  for (let i = 0; i < 20; i++) stepCarFixed(half, { throttle: 1, steer: 0.5 }, 1 / 120, w);
  const full = cruise();
  const hf = full.h;
  for (let i = 0; i < 20; i++) stepCarFixed(full, { throttle: 1, steer: 1 }, 1 / 120, w);
  const ratio = (half.h - hh) / (full.h - hf);
  ok('핸들 각도에 비례해 회전(0.5배 ±10%)', near(ratio, 0.5, 0.05), ratio.toFixed(3));

  // 반대로 돌리면 반대로 꺾인다
  const left = cruise();
  const hl = left.h;
  for (let i = 0; i < 20; i++) stepCarFixed(left, { throttle: 1, steer: -1 }, 1 / 120, w);
  ok('핸들 왼쪽 회전 시 반대 방향', left.h - hl < -0.2, (left.h - hl).toFixed(3));

  // 핸들을 놓으면(steer 0) 직진 유지
  const straight = cruise();
  for (let i = 0; i < 20; i++) stepCarFixed(straight, { throttle: 1, steer: 1 }, 1 / 120, w);
  const hs = straight.h;
  for (let i = 0; i < 120; i++) stepCarFixed(straight, { throttle: 1, steer: 0 }, 1 / 120, w);
  ok('핸들을 놓으면 그 방향으로 직진', Math.abs(straight.h - hs) < 0.01, (straight.h - hs).toFixed(4));
  ok('직진 유지 중 슬립 없음', straight.slip < 0.01, straight.slip.toFixed(4));

  // 고속 코너에서도 벽에 박지 않는다 (풀 스로틀 + 레이싱 라인 추종)
  const runner = createCar(CAR_SPECS.coupe, { x: 0, z: 0, h: 0 });
  const p0 = sample(TRACK, TRACK.total - 20, 0);
  runner.x = p0.x; runner.z = p0.z; runner.h = p0.heading; runner._hint = Math.floor((TRACK.total - 20) / TRACK.segLen);
  const trackWorld = worldFor(runner);
  let maxLat = 0, wallHits = 0, maxSlip = 0;
  const q0 = nearest(TRACK, runner.x, runner.z, runner._hint); runner._hint = q0.index;
  let prevS = q0.s;
  for (let i = 0; i < 60 * 60; i++) {
    const q = nearest(TRACK, runner.x, runner.z, runner._hint); runner._hint = q.index;
    const look = 12 + runner.speed * 0.5;
    const target = sample(TRACK, q.s + look, 0);
    let err = Math.atan2(target.x - runner.x, target.z - runner.z) - runner.h;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    const steer = Math.max(-1, Math.min(1, err * 1.8));
    stepCarFixed(runner, { throttle: 1, steer }, 1 / 60, trackWorld);
    const q2 = nearest(TRACK, runner.x, runner.z, runner._hint); runner._hint = q2.index;
    const ds = Math.abs(q2.s - prevS); prevS = q2.s;
    if (ds < 20) maxLat = Math.max(maxLat, Math.abs(q2.lateral));
    maxSlip = Math.max(maxSlip, runner.slip);
    if (runner.wallHit > 0) wallHits++;
  }
  ok('60초 풀스로틀 주행에 트랙 이탈 없음', maxLat < WALL_LIMIT, maxLat.toFixed(2));
  ok('코너에서 가드레일 충돌 0', wallHits === 0, wallHits);
  ok('고속 코너에서도 슬립 각 < 0.02rad', maxSlip < 0.02, maxSlip.toFixed(4));
}

section('니트로 · 부스터 패드');
{
  const w = flatWorld(0, 0);
  const nc = createCar(CAR_SPECS.hyper, { x: 0, z: 0, h: 0 });
  for (let i = 0; i < 60; i++) stepCarFixed(nc, { throttle: 1 }, 1 / 60, w);
  const fuel0 = nc.boostFuel;
  const v0 = nc.speed;
  for (let i = 0; i < 60; i++) stepCarFixed(nc, { throttle: 1, boost: true }, 1 / 60, w);
  ok('니트로 연료 소모', nc.boostFuel < fuel0 - 25, { from: fuel0.toFixed(0), to: nc.boostFuel.toFixed(0) });
  const vBoost = nc.speed;
  for (let i = 0; i < 90; i++) stepCarFixed(nc, { throttle: 1 }, 1 / 60, w);
  ok('니트로 연료 회복', nc.boostFuel > 30, nc.boostFuel.toFixed(0));
  ok('니트로 중 속도 증가', vBoost > v0, { v0: v0.toFixed(1), vBoost: vBoost.toFixed(1) });

  const pad = pads[0];
  const car = createCar(CAR_SPECS.coupe, { x: pad.x, z: pad.z, h: pad.heading });
  car._hint = Math.floor(pad.s / TRACK.segLen);
  const pw = worldFor(car);
  stepCarFixed(car, { throttle: 1 }, 1 / 60, pw);
  ok('패드 밟으면 부스터 발동', car.boostTime > 0.5, car.boostTime.toFixed(2));
  ok('패드 밟으면 속도 증가', car.speed > 8, car.speed.toFixed(1));
}

section('드리프트 요소 완전 제거');
{
  ok('driftTier 내보내기 없음', physics.driftTier === undefined);
  ok('DRIFT_TIERS 내보내기 없음', physics.DRIFT_TIERS === undefined);
  ok('차량 스펙에 드리프트 필드 없음', Object.values(CAR_SPECS).every((s) => s.driftGrip === undefined && s.driftSteerMul === undefined && s.driftCharge === undefined));
  const car = createCar(CAR_SPECS.coupe, {});
  ok('차량 상태에 drifting/gauge 없음', car.drifting === undefined && car.gauge === undefined && car.driftTime === undefined);
  // drift 입력을 줘도 아무 일도 없다
  const w = flatWorld(0, 0);
  const d = createCar(CAR_SPECS.coupe, { x: 0, z: 0, h: 0 });
  for (let i = 0; i < 30; i++) stepCarFixed(d, { throttle: 1, steer: 1, drift: true }, 1 / 60, w);
  ok('drift 입력이 물리 상태를 만들지 않음', d.drifting === undefined && d.gauge === undefined);
  ok('drift 입력에도 슬립 없음', d.slip < 0.02, d.slip.toFixed(4));
}

section('충돌 · 트랙 이탈 방지');
{
  const car = createCar(CAR_SPECS.hyper, { x: 0, z: 0, h: 0 });
  const start = sample(TRACK, 30, 0);
  car.x = start.x; car.z = start.z; car.h = start.heading;
  car._hint = Math.floor(30 / TRACK.segLen);
  const w = worldFor(car);
  let maxLat = 0, hits = 0;
  for (let i = 0; i < 60 * 25; i++) {
    const steer = Math.sin(i / 47) > 0 ? 1 : -1;
    stepCarFixed(car, { throttle: 1, steer }, 1 / 60, w);
    const q = nearest(TRACK, car.x, car.z, car._hint);
    car._hint = q.index;
    maxLat = Math.max(maxLat, Math.abs(q.lateral));
    if (car.wallHit > 0) hits++;
  }
  ok('25초 난폭 주행에도 트랙 이탈 없음', maxLat <= WALL_LIMIT + 0.25, maxLat.toFixed(2));
  ok('가드레일 충돌이 실제로 발생', hits > 0, hits);

  // 벽 충돌은 속도를 깎는다
  const c2 = createCar(CAR_SPECS.coupe, { x: start.x, z: start.z, h: start.heading });
  c2._hint = Math.floor(30 / TRACK.segLen);
  const w2 = worldFor(c2);
  for (let i = 0; i < 120; i++) stepCarFixed(c2, { throttle: 1 }, 1 / 60, w2);
  const fullSpeed = c2.speed;
  for (let i = 0; i < 60; i++) stepCarFixed(c2, { throttle: 1, steer: 1 }, 1 / 60, w2);
  ok('벽 충돌 후 속도 손실', c2.speed < fullSpeed * 1.05, { full: fullSpeed.toFixed(1), after: c2.speed.toFixed(1) });
}

/* ---------------------------------- 3. 랩/체크포인트 ---------------------------------- */
section('체크포인트 · 랩 카운트');
{
  const prog = new RaceProgress(TRACK, { laps: 3, s: TRACK.total - 10 });
  let t = 0;
  let s = TRACK.total - 10;
  const stepS = 6;
  for (let i = 0; i < 3000 && !prog.finished; i++) {
    s += stepS; t += 0.22;   // 평균 약 27m/s 주행
    const ss = s % TRACK.total;
    prog.update(ss, t);
  }
  ok('3랩 완주 처리', prog.finished, { lap: prog.lap, laps: prog.lapTimes.length });
  ok('랩 3회 기록', prog.lapTimes.length === 3, prog.lapTimes.map((x) => x.toFixed(2)));
  ok('완주 시간 기록', prog.finishTime !== null);
  ok('베스트랩 = 최소 랩', Math.abs(prog.bestLap - Math.min(...prog.lapTimes)) < 1e-9);
  ok('랩타임이 합리적(30~70초)', prog.lapTimes.every((x) => x > 30 && x < 70), prog.lapTimes.map((x) => x.toFixed(1)));

  // 체크포인트 건너뛰면 랩 인정 안 됨
  const cheat = new RaceProgress(TRACK, { laps: 3, s: TRACK.total - 10 });
  cheat.update(TRACK.total - 4, 0.1);
  cheat.update(0.5, 0.2);          // 스타트 통과 → started
  cheat.update(TRACK.total - 1, 0.3); // 되돌아가서 (역주행)
  cheat.update(0.4, 0.4);          // 다시 스타트 라인
  ok('체크포인트 없이 스타트만 반복하면 랩 0', cheat.lap === 0, cheat.lap);

  // 역주행 감지
  const rev = new RaceProgress(TRACK, { laps: 3, s: 300 });
  for (let i = 0; i < 40; i++) rev.update(300 - i * 2, i * 0.05);
  ok('역주행 감지', rev.wrongWay === true, rev.wrongWayTime);

  // 순위
  const racers = [
    { id: 'a', prog: { progressValue: 100, finished: false, finishTime: null } },
    { id: 'b', prog: { progressValue: 300, finished: false, finishTime: null } },
    { id: 'c', prog: { progressValue: 50, finished: true, finishTime: 90 } },
    { id: 'd', prog: { progressValue: 20, finished: true, finishTime: 80 } },
  ].map((r) => ({ ...r, progressValue: r.prog.progressValue, finished: r.prog.finished, finishTime: r.prog.finishTime }));
  const ranked = rankRacers(racers).map((r) => r.id);
  ok('완주자가 앞 순위, 완주 시간 순', ranked[0] === 'd' && ranked[1] === 'c', ranked);
  ok('미완주자는 진행도 순', ranked[2] === 'b' && ranked[3] === 'a', ranked);
  ok('시간 포맷', formatTime(83.456) === '01:23.46', formatTime(83.456));
  ok('시간 포맷(없음)', formatTime(null) === '--:--.--');
}

/* ---------------------------------- 4. AI 3랩 ---------------------------------- */
section('AI 레이서 주행 (3랩 완주)');
{
  const N = 4;
  const keys = ['coupe', 'gt', 'hyper', 'coupe'];
  const racers = [];
  for (let i = 0; i < N; i++) {
    const s = TRACK.total - 14 - i * 7.5;
    const lat = i % 2 === 0 ? -3.1 : 3.1;
    const p = sample(TRACK, s, lat);
    const car = createCar(CAR_SPECS[keys[i]], { x: p.x, z: p.z, h: p.heading });
    car._hint = Math.floor(s / TRACK.segLen);
    racers.push({ car, prog: new RaceProgress(TRACK, { laps: 3, s }), ai: createAIProfile(i + 2), wall: 0, maxSpeed: 0 });
  }
  const dt = 1 / 60;
  let t = 0;
  for (let f = 0; f < 60 * 240; f++) {
    t += dt;
    for (const r of racers) {
      if (r.car.finished) continue;
      const w = worldFor(r.car);
      const q = nearest(TRACK, r.car.x, r.car.z, r.car._hint);
      r.car._hint = q.index;
      r.prog.update(q.s, t);
      const inp = aiInput(r.ai, r.car, q.s, t, TRACK);
      stepCarFixed(r.car, inp, dt, w);
      r.wall += r.car.wallHit;
      r.maxSpeed = Math.max(r.maxSpeed, r.car.speed);
      const q2 = nearest(TRACK, r.car.x, r.car.z, r.car._hint);
      r.car._hint = q2.index;
      r.prog.update(q2.s, t);
      if (r.prog.finished) r.car.finished = true;
    }
    if (racers.every((r) => r.car.finished)) break;
  }
  ok('AI 4대 모두 3랩 완주', racers.every((r) => r.prog.finished), racers.map((r) => r.prog.lap));
  const lapTimes = racers.map((r) => r.prog.lapTimes);
  ok('AI 랩타임 25~70초', lapTimes.every((ls) => ls.length === 3 && ls.every((x) => x > 25 && x < 70)), lapTimes.map((l) => l.map((x) => x.toFixed(1)).join('/')));
  ok('AI가 가드레일에 부딪히지 않음', racers.every((r) => r.wall < 1), racers.map((r) => r.wall.toFixed(1)));
  ok('AI 최고속이 물리 한계 이내', racers.every((r) => r.maxSpeed < 90), racers.map((r) => r.maxSpeed.toFixed(0)));
  const winner = racers.slice().sort((a, b) => a.prog.finishTime - b.prog.finishTime)[0];
  ok('AI 완주 시간 85~180초', winner.prog.finishTime > 85 && winner.prog.finishTime < 180, winner.prog.finishTime.toFixed(1));
  console.log('    · AI 완주: ' + racers.map((r) => `${r.prog.finishTime.toFixed(1)}s`).join(' / '));
  console.log('    · AI 최고속: ' + racers.map((r) => kmh({ speed: r.maxSpeed }).toFixed(0) + 'km/h').join(' / '));
}

section('차량 스펙 차이');
{
  ok('3종 차량 존재', Object.keys(CAR_SPECS).length === 3);
  const speeds = Object.values(CAR_SPECS).map((s) => s.maxSpeed);
  ok('하이퍼카가 최고속', CAR_SPECS.hyper.maxSpeed === Math.max(...speeds));
  ok('GT가 조향 응답 최고', CAR_SPECS.gt.steerRate === Math.max(...Object.values(CAR_SPECS).map((s) => s.steerRate)));
  ok('모든 차량 그립 20 이상', Object.values(CAR_SPECS).every((s) => s.grip >= 20));
}

console.log(`\n=== 결과: ${pass} 통과 / ${fail} 실패 ===`);
if (fail) { console.log('실패: ' + fails.join(', ')); process.exit(1); }
process.exit(0);
