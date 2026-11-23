/* =============================================================================
   main.js — NEON DRIFT 실행부: 메뉴 · 솔로(AI 3) · 친구 대결(WebSocket) · HUD · 카메라
   - 원형 핸들 조향 (3D 운전교실 스타일)
   - 니트로 / 브레이크 / 실시간 순위표
   ============================================================================= */
import * as THREE from 'three';
import { TRACK, buildPads, nearest, sample } from './core/track.js';
import { CAR_SPECS, createCar, stepCarFixed, kmh } from './core/physics.js';
import { RaceProgress, rankRacers, formatTime } from './core/progress.js';
import { createAIProfile, aiInput } from './core/ai.js';
import { createScene } from './game/scene.js';
import { buildTrackMeshes } from './game/trackMesh.js';
import { createCarMesh } from './game/carModel.js';
import { Effects } from './game/effects.js';
import { Hud } from './game/hud.js';
import { SteeringWheel } from './game/wheel.js';
import { Cockpit } from './game/cockpit.js';
import { Net } from './net.js';

const $ = (id) => document.getElementById(id);
const PADS = buildPads(TRACK);
const LAPS = 3;
const COLORS = ['#37f3ff', '#ff2fb0', '#a06bff', '#39ff9e', '#ffd23d', '#ff6b3d'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const app = {
  mode: 'menu',          // menu | solo | multi
  phase: 'idle',         // idle | countdown | racing | finished | paused
  camMode: 'third',
  autoAccel: true,
  quality: 'high',
  flipControls: localStorage.getItem('neon_ctrl_flip') === '1',
  nick: localStorage.getItem('neon_nick') || '',
  carKey: localStorage.getItem('neon_car') || 'coupe',
  color: localStorage.getItem('neon_color') || COLORS[0],
  simTime: 0,
  racers: [],
  playerId: 'me',
  errors: [],
  fps: 60,
  lastFrame: 0,
  net: null,
  room: null,
  isHost: false,
  countdownStart: 0,
  countdownStep: -1,
  posRate: 0,
  netSendAt: 0,
  paused: false,
  finishAt: 0,
  resultsShown: false,
  ranked: [],
};

/* ----------------------------- 3D 기반 ----------------------------- */
const stage = $('stage');
const view = createScene(stage);
const trackMeshes = buildTrackMeshes(view.scene, TRACK, PADS);
const effects = new Effects(view.scene);
const cockpit = new Cockpit(view.scene, app.color);
const hud = new Hud(TRACK);
view.renderer.setAnimationLoop(null);

const camState = {
  pos: new THREE.Vector3(0, 8, 20),
  look: new THREE.Vector3(),
  fov: 68,
  shake: 0,
};

/* ----------------------------- 입력 ----------------------------- */
const input = { steer: 0, wheel: 0, throttle: 0, brake: 0, boost: false, left: false, right: false };
const keys = new Set();

const wheel = new SteeringWheel($('wheel'), { maxDeg: 135 });
wheel.onChange = (v) => { input.wheel = v; };

function bindHold(el, onDown, onUp) {
  if (!el) return;
  const down = (e) => {
    e.preventDefault();
    el._pid = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    el.classList.add('on');
    onDown();
  };
  const up = (e) => {
    if (e && el._pid !== null && el._pid !== undefined && e.pointerId !== el._pid) return;
    if (e) e.preventDefault();
    el._pid = null;
    el.classList.remove('on');
    onUp();
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'touch' && !el._pid) up(e); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

bindHold($('btnNitro'), () => { input.boost = true; }, () => { input.boost = false; });
bindHold($('btnBrake'), () => { input.brake = 1; }, () => { input.brake = 0; });

// 터치가 버튼 밖에서 끝나도 눌림 상태가 남지 않게: 마지막 손가락이 떨어질 때만 전체 해제한다.
// (한 손으로 핸들을 돌린 채 다른 손으로 NITRO를 누르는 두 손 조작을 끊지 않는다)
const activePointers = new Set();
function releaseAll() {
  input.left = input.right = false;
  input.boost = false;
  input.brake = 0;
  document.querySelectorAll('.touchBtn.on').forEach((b) => b.classList.remove('on'));
  wheel.release();
}
window.addEventListener('pointerdown', (e) => activePointers.add(e.pointerId), true);
window.addEventListener('pointerup', (e) => {
  activePointers.delete(e.pointerId);
  if (activePointers.size === 0) releaseAll();
}, true);
window.addEventListener('pointercancel', (e) => {
  activePointers.delete(e.pointerId);
  if (activePointers.size === 0) releaseAll();
}, true);
window.addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
  keys.add(k);
  if (k === 'c') toggleCamera();
  if (k === 'escape') { if (app.phase === 'racing') pauseRace(); else if (app.phase === 'paused') resumeRace(); }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
  if (['a', 'd', 'arrowleft', 'arrowright'].includes(k)) {
    const still = keys.has('a') || keys.has('d') || keys.has('arrowleft') || keys.has('arrowright');
    if (!still) wheel.setVisual(0);
  }
});

function readInput() {
  const left = input.left || keys.has('a') || keys.has('arrowleft');
  const right = input.right || keys.has('d') || keys.has('arrowright');
  const up = keys.has('w') || keys.has('arrowup');
  const down = keys.has('s') || keys.has('arrowdown');
  const keySteer = (right ? 1 : 0) - (left ? 1 : 0);
  // 키보드가 눌리면 키보드 우선, 아니면 핸들 각도
  input.steer = keySteer !== 0 ? keySteer : clamp(input.wheel, -1, 1);
  const braking = input.brake > 0 || down;
  input.throttle = braking ? 0 : (app.autoAccel ? 1 : (up ? 1 : 0));
  if (!app.autoAccel && !up) input.throttle = 0;
  return {
    steer: input.steer,
    throttle: input.throttle,
    brake: braking ? 1 : 0,
    boost: input.boost || keys.has('shift'),
  };
}

/* ----------------------------- 차량/레이서 생성 ----------------------------- */
function gridPose(i, total) {
  const s = TRACK.total - 14 - i * 7.5;
  const lat = i % 2 === 0 ? -3.1 : 3.1;
  const p = sample(TRACK, s, lat);
  return { s, x: p.x, z: p.z, h: p.heading };
}

function makeRacer(opts) {
  const pose = gridPose(opts.gridIndex || 0);
  const spec = CAR_SPECS[opts.car] || CAR_SPECS.coupe;
  const car = createCar(spec, { x: pose.x, z: pose.z, h: pose.h });
  const mesh = createCarMesh(spec.key, opts.color, { label: opts.label });
  view.scene.add(mesh.group);
  const racer = {
    id: opts.id,
    name: opts.name || '드라이버',
    isMe: !!opts.isMe,
    isAI: !!opts.isAI,
    color: opts.color,
    carKey: spec.key,
    car,
    mesh,
    prog: new RaceProgress(TRACK, { laps: LAPS, s: pose.s }),
    hint: Math.floor(pose.s / TRACK.segLen) % TRACK.n,
    ai: opts.isAI ? createAIProfile(opts.seed || 1) : null,
    netBuffer: [],
    lastState: null,
    sparkAcc: 0,
  };
  racer.car._hint = racer.hint;
  app.racers.push(racer);
  return racer;
}

function nearestFor(racer) {
  return (x, z) => {
    const q = nearest(TRACK, x, z, racer.car._hint);
    racer.car._hint = q.index;
    racer.hint = q.index;
    return q;
  };
}

function clearRacers() {
  for (const r of app.racers) {
    view.scene.remove(r.mesh.group);
    r.mesh.group.traverse?.((o) => {
      if (o.geometry) o.geometry.dispose?.();
      // 텍스처는 materials.js 캐시에서 공유하므로 지우지 않는다
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
        else o.material.dispose?.();
      }
    });
  }
  app.racers = [];
  app.ranked = [];
  effects.clear();
}

/* ----------------------------- 조작 좌우 반전 ----------------------------- */
function applyControlFlip(persist = true) {
  const on = app.flipControls;
  $('hud').classList.toggle('flip', on);
  if (persist) localStorage.setItem('neon_ctrl_flip', on ? '1' : '0');
  const side = on ? '오른쪽 핸들' : '왼쪽 핸들';
  for (const id of ['handBtn', 'handBtnPause']) {
    const b = $(id);
    if (!b) continue;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    const v = b.querySelector('b');
    if (v) v.textContent = side;
  }
  const foot = $('footHint');
  if (foot) {
    foot.innerHTML = on
      ? '조작: 오른쪽 핸들을 돌려 조향 · 왼쪽 NITRO·BRAKE<br>PC: WASD/화살표 조향 · Shift 부스터'
      : '조작: 왼쪽 핸들을 돌려 조향 · 오른쪽 NITRO·BRAKE<br>PC: WASD/화살표 조향 · Shift 부스터';
  }
}

function toggleControlFlip() {
  app.flipControls = !app.flipControls;
  releaseAll();
  applyControlFlip();
  toast(app.flipControls ? '조작 반전 · 오른쪽 핸들' : '조작 기본 · 왼쪽 핸들', 1500);
}

/* ----------------------------- 화면 전환 ----------------------------- */
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }

function toast(msg, ms = 2000) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

function hideAllScreens() {
  ['menu', 'lobby', 'results', 'pause'].forEach(hide);
}

/* ----------------------------- 카메라 ----------------------------- */
function toggleCamera() {
  app.camMode = app.camMode === 'third' ? 'first' : 'third';
  hud.setCam(app.camMode);
  const me = app.racers.find((r) => r.isMe);
  if (me) me.mesh.setCamMode(app.camMode);
  const gw = $('gaugeWrap');
  if (gw) gw.classList.toggle('hidden', app.camMode === 'first');   // 1인칭은 계기판이 속도를 보여준다
  app.camSnap = true;   // 시점 전환은 즉시 (러프 없이)
}

function updateCamera(dt) {
  const me = app.racers.find((r) => r.isMe);
  if (!me) return;
  if (app.debugCam) {
    const c = view.camera;
    c.position.set(app.debugCam[0], app.debugCam[1], app.debugCam[2]);
    c.lookAt(app.debugCam[3], app.debugCam[4], app.debugCam[5]);
    if (app.debugCam[6]) { c.fov = app.debugCam[6]; c.updateProjectionMatrix(); }
    return;
  }
  const car = me.car;
  const speed = Math.abs(car.speed);
  const boost = Math.min(1.4, (car.boostTime > 0 ? 1 : 0) + (car.nitroActive ? 1 : 0));
  const yaw = car.h;
  const cam = view.camera;
  const wantNear = camModeIsThird() ? 0.3 : 0.12;
  if (cam.near !== wantNear) { cam.near = wantNear; cam.updateProjectionMatrix(); }

  if (camModeIsThird()) {
    const back = 8.2 + speed * 0.055 + boost * 2.1;
    const height = 3.25 + speed * 0.014 + boost * 0.32;
    const drift = -(car.steer || 0) * 0.55;
    const target = new THREE.Vector3(
      car.x - Math.sin(yaw + drift * 0.12) * back,
      height,
      car.z - Math.cos(yaw + drift * 0.12) * back
    );
    const k = app.camSnap ? 1 : 1 - Math.exp(-dt * 8.0);
    camState.pos.lerp(target, k);
    const lookTarget = new THREE.Vector3(car.x + Math.sin(car.h) * 11, 1.75, car.z + Math.cos(car.h) * 11);
    camState.look.lerp(lookTarget, 1 - Math.exp(-dt * 10));
    cam.position.copy(camState.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(camState.look);
    camState.fov = THREE.MathUtils.lerp(camState.fov, 68 + speed * 0.28 + boost * 8.5, 1 - Math.exp(-dt * 4));
    // 코너링 시 살짝 기울이기
    cam.rotateZ((car.steer || 0) * 0.035 * Math.min(1, speed / 30));
  } else {
    const fx = Math.sin(car.h), fz = Math.cos(car.h);
    const rx = Math.cos(car.h), rz = -Math.sin(car.h);
    const head = new THREE.Vector3(
      car.x + fx * 0.62 + rx * -0.33,
      1.195 + Math.sin(app.simTime * 13) * 0.0035 * Math.min(1, speed / 25),
      car.z + fz * 0.62 + rz * -0.33
    );
    camState.pos.lerp(head, app.camSnap ? 1 : 1 - Math.exp(-dt * 34));
    const lookTarget = new THREE.Vector3(
      car.x + fx * 40 + rx * -0.10,
      1.40 - (car.brake ? 0.06 : 0),
      car.z + fz * 40 + rz * -0.10
    );
    camState.look.lerp(lookTarget, 1 - Math.exp(-dt * 20));
    cam.position.copy(camState.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(camState.look);
    cam.rotateZ((car.steer || 0) * 0.055 * Math.min(1, speed / 28));
    camState.fov = THREE.MathUtils.lerp(camState.fov, 68 + speed * 0.20 + boost * 6, 1 - Math.exp(-dt * 4));
  }

  // 충격/부스트 흔들림
  const rumble = boost > 0.2 ? 0.014 * boost * Math.min(1, speed / 30) : 0;
  const sh = camState.shake + rumble;
  if (sh > 0.001) {
    cam.position.x += (Math.random() - 0.5) * sh;
    cam.position.y += (Math.random() - 0.5) * sh * 0.7;
    camState.shake *= Math.exp(-dt * 6);
  }
  if (app.camSnap) { camState.fov = camModeIsThird() ? 68 : 68; app.camSnap = false; }
  if (cam.fov !== camState.fov) {
    cam.fov = camState.fov;
    cam.updateProjectionMatrix();
  }
}

const camModeIsThird = () => app.camMode === 'third';

/* ----------------------------- 솔로 시작 ----------------------------- */
function startSolo() {
  if (!app.nick) app.nick = ($('nickInput').value || '').trim() || '드라이버';
  localStorage.setItem('neon_nick', app.nick);
  app.mode = 'solo';
  app.playerId = 'me';
  clearRacers();
  hideAllScreens();
  hide('lobby');
  hud.show();
  app.phase = 'countdown';
  app.simTime = 0;
  app.finishAt = 0;
  app.resultsShown = false;

  makeRacer({ id: 'me', name: app.nick, car: app.carKey, color: app.color, isMe: true, gridIndex: 0 });
  const aiNames = ['네온VIPER', '하버고스트', '미드나잇M', '퀀텀R'];
  const aiCars = ['gt', 'hyper', 'coupe', 'gt'];
  const aiColors = ['#ff2fb0', '#a06bff', '#39ff9e', '#ffd23d'];
  for (let i = 0; i < 3; i++) {
    makeRacer({
      id: 'ai' + i, name: aiNames[i], car: aiCars[i], color: aiColors[i], isAI: true,
      gridIndex: i + 1, seed: i + 3, label: aiNames[i],
    });
  }
  beginCountdown();
}

function beginCountdown() {
  hideAllScreens();
  hud.show();
  app.phase = 'countdown';
  app.countdownStart = performance.now();
  app.countdownStep = -1;
  const cd = $('countdown');
  cd.classList.remove('hidden');
  $('cdText').textContent = '3';
  hud.setPos(1, app.racers.length);
  hud.setLap(1, LAPS);
  hud.setTime(0, null);
  camState.pos.set(0, 12, 0);
  const me = app.racers.find((r) => r.isMe);
  if (me) {
    camState.pos.set(me.car.x - Math.sin(me.car.h) * 9, 4, me.car.z - Math.cos(me.car.h) * 9);
    camState.look.set(me.car.x, 1.2, me.car.z);
  }
  // 첫 카메라 세팅
  const cam = view.camera;
  cam.position.copy(camState.pos);
  cam.lookAt(camState.look);
  cam.fov = 66; cam.updateProjectionMatrix();
  camState.fov = 66;
}

/* ----------------------------- 물리/게임 루프 ----------------------------- */
const FIXED = 1 / 120;
let acc = 0;

function raceElapsed() { return app.simTime; }

function updateRacers(dt) {
  const me = app.racers.find((r) => r.isMe);
  const frozen = app.phase !== 'racing';

  for (const r of app.racers) {
    if (frozen && !r.isRemote) {
      // 카운트다운: 제자리 대기 (살짝 떨림만)
      r.mesh.update(r.car, dt, app.simTime, r.isMe ? app.camMode : 'third');
      continue;
    }
    if (r.isRemote) { updateRemote(r, dt); continue; }

    const nearFn = nearestFor(r);
    const q = nearFn(r.car.x, r.car.z);
    let inp;
    if (r.isMe) {
      inp = readInput();
      wheel.setVisual(inp.steer);
    } else {
      inp = aiInput(r.ai, r.car, q.s, app.simTime, TRACK);
    }
    const ev = stepCarFixed(r.car, inp, dt, { track: TRACK, pads: PADS, nearest: nearFn });
    const q2 = nearFn(r.car.x, r.car.z);

    if (app.phase === 'racing') {
      const res = r.prog.update(q2.s, app.simTime);
      if (res.lapDone && r.isMe) {
        hud.message(`LAP ${Math.min(r.prog.lap + 1, LAPS)}`, 900);
      }
    }

    // ---- 이펙트
    if (r.car.wallHit > 0.15) {
      effects.spawnSpark(r.car.x, 0.8, r.car.z, 4 + Math.round(r.car.wallHit * 8), 0xffb347, 8, 4);
      if (r.isMe) camState.shake = Math.min(0.55, camState.shake + r.car.wallHit * 0.5);
    }
    if (ev.pad >= 0) {
      effects.spawnRing(r.car.x, r.car.z, 0x7ef9ff);
      effects.spawnSpark(r.car.x, 0.4, r.car.z, 8, 0x7ef9ff, 9, 5);
      if (r.isMe) hud.message('부스터 패드!', 600);
    }
    if (r.car.padFlash > 0.5 && r.isMe) camState.shake = Math.min(0.25, camState.shake + 0.03);
    if (r.car.nitroActive && r.isMe && Math.random() < dt * 30) {
      effects.spawnSpark(r.car.x - Math.sin(r.car.h) * 1.6, 0.4, r.car.z - Math.cos(r.car.h) * 1.6, 1, 0x7ef9ff, 7, 3);
    }

    // ---- 배기 애프터버너 파티클 (니트로/부스터)
    const boosting = r.car.boostTime > 0 || r.car.nitroActive;
    if (boosting) {
      const sh = r.mesh.shape;
      const fx = Math.sin(r.car.h), fz = Math.cos(r.car.h);
      const rx = Math.cos(r.car.h), rz = -Math.sin(r.car.h);
      const bx = r.car.x - fx * (sh.L / 2 + 0.25);
      const bz = r.car.z - fz * (sh.L / 2 + 0.25);
      r.sparkAcc += dt * (r.car.nitroActive ? 60 : 34);
      while (r.sparkAcc > 1) {
        r.sparkAcc -= 1;
        const side = Math.random() < 0.5 ? -1 : 1;
        effects.spawnExhaust(
          bx + rx * side * sh.W * 0.17,
          sh.sill + 0.22,
          bz + rz * side * sh.W * 0.17,
          -fx, -fz,
          r.car.nitroActive ? 0x8ff6ff : 0xffc46a,
          r.car.nitroActive ? 1.0 : 0.7
        );
      }
    } else {
      r.sparkAcc = 0;
    }
    // 니트로 진입 순간 타격감
    if (r.car.nitroActive && !r.wasNitro) {
      if (r.isMe) {
        camState.shake = Math.min(0.4, camState.shake + 0.16);
        hud.flash('rgba(120,240,255,.5)');
      }
    }
    r.wasNitro = r.car.nitroActive;

    r.mesh.update(r.car, dt, app.simTime, r.isMe ? app.camMode : 'third');
  }

  // ---- 순위
  const ranked = recomputeRanks();

  if (me) {
    if (me.prog.finished && !app.resultsShown && app.phase === 'racing') {
      app.phase = 'finished';
      app.finishAt = performance.now();
      hud.message('FINISH!', 1500);
      if (app.mode === 'solo') setTimeout(() => showResults(ranked), 1200);
    }
  }
}

let hudTick = 0;
function recomputeRanks() {
  const list = app.racers.map((r) => ({
    ref: r, id: r.id, progressValue: r.prog.progressValue,
    finished: r.prog.finished, finishTime: r.prog.finishTime,
  }));
  const ranked = rankRacers(list);
  ranked.forEach((r, i) => { r.position = i + 1; });
  app.ranked = ranked;
  return ranked;
}

function boardRows() {
  const ranked = app.racers.length ? recomputeRanks() : [];
  // 순위가 바뀌면 상단 표시도 즉시 맞춘다
  const myRow = ranked.find((r) => r.ref && r.ref.isMe);
  const rows = ranked.map((r, i) => {
    const racer = r.ref || r;
    const prog = racer.prog;
    const done = prog && prog.finished;
    return {
      rank: r.position || i + 1,
      name: racer.name,
      color: racer.color,
      me: !!racer.isMe,
      done,
      lapText: done ? '완주' : `${Math.min(LAPS, prog.lap + 1)}/${LAPS}`,
    };
  });
  if (myRow) hud.setPos(myRow.position || 1, app.racers.length);
  return rows;
}

function updateHud(dt) {
  const me = app.racers.find((r) => r.isMe);
  if (!me) return;
  const rows = boardRows();
  const meRow = rows.find((r) => r.me);
  hud.setPos(meRow ? meRow.rank : 1, app.racers.length);
  hud.setLap(me.prog.lapDisplay, LAPS);
  hud.setTime(me.prog.lapTime(raceElapsed()), me.prog.bestLap);
  hud.setSpeed(kmh(me.car));
  hud.setNitro(me.car.boostFuel);
  hud.setBoostVisual(Math.min(1, (me.car.boostTime > 0 ? 0.8 : 0) + (me.car.nitroActive ? 1 : 0)));
  hud.setBoard(rows);
  hudTick += dt;
  if (hudTick > 0.09) {
    hudTick = 0;
    hud.drawMinimap(app.racers.map((r) => ({ x: r.car.x, z: r.car.z, color: r.color, me: r.isMe })));
  }
}

function updateRemote(r, dt) {
  const buf = r.netBuffer;
  if (!buf.length) return;
  const renderTime = performance.now() - 110;
  while (buf.length > 2 && buf[1].at <= renderTime) buf.shift();
  const a = buf[0];
  const b = buf[1] || buf[0];
  const span = Math.max(1, b.at - a.at);
  const k = Math.max(0, Math.min(1, (renderTime - a.at) / span));
  const x = a.x + (b.x - a.x) * k;
  const z = a.z + (b.z - a.z) * k;
  let dh = b.h - a.h;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  const h = a.h + dh * k;
  const speed = a.speed + (b.speed - a.speed) * k;
  const fake = {
    x, z, h, speed, steer: 0, slip: 0,
    boostTime: a.boost ? 0.4 : 0, nitroActive: false,
  };
  r.car.x = x; r.car.z = z; r.car.h = h; r.car.speed = speed;
  r.mesh.update(fake, dt, app.simTime, 'third');
}

/* ----------------------------- 네트워크 ----------------------------- */
function sendPos() {
  const me = app.racers.find((r) => r.isMe);
  if (!me || !app.net || !app.net.connected) return;
  app.net.send({
    type: 'pos',
    x: Math.round(me.car.x * 100) / 100,
    z: Math.round(me.car.z * 100) / 100,
    h: Math.round(me.car.h * 1000) / 1000,
    speed: Math.round(me.car.speed * 100) / 100,
    boost: me.car.boostTime > 0 || me.car.nitroActive,
    lap: me.prog.lap,
    cp: me.prog.nextCp,
  });
}

function setupNetHandlers() {
  const net = app.net;
  net.on('error', (msg) => toast(msg.message || '오류가 발생했어', 2600));
  net.on('close', () => {
    if (app.mode === 'multi') {
      toast('서버 연결이 끊어졌어', 2600);
      app.mode = 'menu';
      app.phase = 'idle';
      hud.hide();
      clearRacers();
      hideAllScreens();
      show('menu');
    }
  });
  net.on('room', (msg) => {
    app.room = msg;
    app.isHost = msg.hostId === net.id;
    renderLobby(msg);
  });
  net.on('countdown', (msg) => {
    // 참가자(비방장)도 같은 그리드로 차량을 만든다
    if (app.mode === 'multi' && app.racers.length === 0 && app.room) startMultiRace(app.room);
    app.countdownStart = performance.now() + Math.max(0, msg.startAt - Date.now());
    hideAllScreens();
    hud.show();
    $('countdown').classList.remove('hidden');
    app.phase = 'countdown';
    app.simTime = 0;
    app.resultsShown = false;
  });
  net.on('race', () => {
    $('countdown').classList.add('hidden');
    app.phase = 'racing';
    app.simTime = 0;
    hud.message('GO!', 700);
  });
  net.on('state', (msg) => {
    const now = performance.now();
    for (const ps of msg.players) {
      if (ps.id === net.id) continue;
      const r = app.racers.find((x) => x.id === ps.id);
      if (!r) continue;
      r.netBuffer.push({ at: now, x: ps.x, z: ps.z, h: ps.h, speed: ps.speed, boost: ps.boost });
      if (r.netBuffer.length > 30) r.netBuffer.shift();
      r.prog.lap = ps.lap;
      const q = nearest(TRACK, ps.x, ps.z, r.car._hint);
      r.car._hint = q.index;
      r.prog.s = q.s;
      r.prog.sPrev = q.s;
    }
  });
  net.on('left', (msg) => {
    const r = app.racers.find((x) => x.id === msg.id);
    if (r) {
      view.scene.remove(r.mesh.group);
      app.racers = app.racers.filter((x) => x.id !== msg.id);
    }
    toast(`${msg.name || '플레이어'} 님이 나갔어`, 1600);
  });
  net.on('finish', (msg) => showMultiResults(msg.order));
}

function renderLobby(room) {
  show('lobby');
  hide('menu');
  $('roomCard').classList.remove('hidden');
  $('roomCode').textContent = room.code;
  $('codeInput').value = room.code;
  const list = $('playerList');
  list.innerHTML = '';
  for (const p of room.players) {
    const li = document.createElement('li');
    const meCls = p.id === app.net.id ? ' (나)' : '';
    li.innerHTML = `<span class="dot" style="color:${p.color};background:${p.color}"></span>
      <span>${escapeHtml(p.name)}${meCls}</span>
      ${p.host ? '<span class="host">방장</span>' : ''}
      <span class="rdy ${p.ready ? '' : 'no'}">${p.ready ? '준비✓' : '대기'}</span>`;
    list.appendChild(li);
  }
  const imHost = room.hostId === app.net.id;
  const meP = room.players.find((p) => p.id === app.net.id);
  $('btnStart').style.display = imHost ? 'flex' : 'none';
  $('btnReady').style.display = imHost ? 'none' : 'flex';
  if (meP) $('btnReady').textContent = meP.ready ? '준비 취소' : '준비 완료';
  if (imHost) {
    $('btnStart').disabled = room.players.length < 1;
    $('btnStart').textContent = `레이스 시작 (${room.players.length}명)`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function enterMulti() {
  hide('menu');
  show('lobby');
  app.mode = 'multi';
  try {
    if (!app.net) {
      app.net = new Net();
      setupNetHandlers();
    }
    await app.net.connect();
  } catch (e) {
    toast('서버에 연결할 수 없어. 잠시 후 다시 시도해줘.', 2800);
  }
}

async function createRoom() {
  app.nick = ($('nickInput').value || '').trim() || '드라이버';
  localStorage.setItem('neon_nick', app.nick);
  await enterMulti();
  app.net.send({ type: 'create', name: app.nick, car: app.carKey, color: app.color });
}

async function joinRoom() {
  const code = ($('codeInput').value || '').trim().toUpperCase();
  if (code.length < 4) { toast('방 코드 4자리를 입력해줘', 1800); return; }
  app.nick = ($('nickInput').value || '').trim() || '드라이버';
  await enterMulti();
  app.net.send({ type: 'join', code, name: app.nick, car: app.carKey, color: app.color });
}

function startMultiRace(room) {
  clearRacers();
  app.playerId = app.net.id;
  const players = room.players;
  players.forEach((p, i) => {
    makeRacer({
      id: p.id, name: p.name, car: p.car, color: p.color, isMe: p.id === app.net.id,
      gridIndex: i, label: p.name,
    });
  });
  // 원격 레이서 플래그
  for (const r of app.racers) r.isRemote = !r.isMe;
  beginCountdown();
}

/* ----------------------------- 결과 화면 ----------------------------- */
function resultRows(list) {
  return list.slice().sort((a, b) => {
    const pa = a.prog, pb = b.prog;
    if (pa.finished && pb.finished) return pa.finishTime - pb.finishTime;
    if (pa.finished) return -1;
    if (pb.finished) return 1;
    return pb.progressValue - pa.progressValue;
  });
}

function renderResultTable(rows) {
  const table = $('resultTable');
  table.innerHTML = '<tr><th>순위</th><th>드라이버</th><th>기록</th><th>베스트랩</th></tr>';
  const medal = ['gold', 'silver', 'bronze'];
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (r.isMe) tr.className = 'me';
    const prog = r.prog;
    const time = prog.finished ? formatTime(prog.finishTime) : `${Math.min(LAPS, prog.lap + 1)}랩 진행`;
    tr.innerHTML = `<td class="rk ${medal[i] || ''}">${i + 1}</td>
      <td><span class="dots" style="color:${r.color};background:${r.color}"></span>${escapeHtml(r.name)}</td>
      <td>${time}</td>
      <td>${formatTime(prog.bestLap)}</td>`;
    table.appendChild(tr);
  });
  const winner = rows[0];
  const me = rows.find((r) => r.isMe);
  $('resultSub').innerHTML = winner
    ? `🏆 우승 <b>${escapeHtml(winner.name)}</b>${me && me !== winner ? ` · 내 순위 <b>${rows.indexOf(me) + 1}위</b>` : ''}`
    : '';
}

function showResults(ranked) {
  if (app.resultsShown) return;
  app.resultsShown = true;
  app.phase = 'finished';
  hud.hide();
  $('countdown').classList.add('hidden');
  show('results');
  $('resultTitle').textContent = '경기 결과';
  const list = resultRows(ranked.map((r) => r.ref || app.racers.find((x) => x.id === r.id)).filter(Boolean));
  renderResultTable(list);
}

function showMultiResults(order) {
  app.phase = 'finished';
  app.resultsShown = true;
  hud.hide();
  $('countdown').classList.add('hidden');
  show('results');
  $('resultTitle').textContent = '경기 결과';
  const table = $('resultTable');
  table.innerHTML = '<tr><th>순위</th><th>드라이버</th><th>기록</th><th>베스트랩</th></tr>';
  const medal = ['gold', 'silver', 'bronze'];
  order.forEach((o, i) => {
    const tr = document.createElement('tr');
    if (o.id === app.net.id) tr.className = 'me';
    tr.innerHTML = `<td class="rk ${medal[i] || ''}">${i + 1}</td>
      <td><span class="dots" style="color:${o.color};background:${o.color}"></span>${escapeHtml(o.name)}</td>
      <td>${formatTime(o.time)}</td><td>${formatTime(o.best)}</td>`;
    table.appendChild(tr);
  });
  const me = order.find((o) => o.id === app.net.id);
  const winner = order[0];
  $('resultSub').innerHTML = winner
    ? `🏆 우승 <b>${escapeHtml(winner.name)}</b>${me && me !== winner ? ` · 내 순위 <b>${order.indexOf(me) + 1}위</b>` : ''}`
    : '';
}

/* ----------------------------- 일시정지/재시작 ----------------------------- */
function pauseRace() {
  if (app.phase !== 'racing') return;
  app.phase = 'paused';
  releaseAll();
  show('pause');
}
function resumeRace() {
  if (app.phase !== 'paused') return;
  app.phase = 'racing';
  hide('pause');
}
function restartRace() {
  hide('pause');
  if (app.mode === 'solo') startSolo();
  else if (app.mode === 'multi') {
    toast('친구 대결은 방에서 다시 시작해야 해', 2200);
    backToMenu();
  }
}
function backToMenu() {
  app.phase = 'idle';
  app.mode = 'menu';
  app.resultsShown = false;
  hud.hide();
  hide('countdown');
  releaseAll();
  clearRacers();
  if (app.net) { try { app.net.send({ type: 'leave' }); } catch (e) { /* noop */ } }
  hideAllScreens();
  show('menu');
}

/* ----------------------------- 메뉴 UI ----------------------------- */
function buildMenu() {
  const list = $('carList');
  list.innerHTML = '';
  const stats = {
    coupe: { accel: 3.4, speed: 3.2, corner: 3.3 },
    gt: { accel: 3.0, speed: 2.9, corner: 4.6 },
    hyper: { accel: 4.0, speed: 4.6, corner: 2.8 },
  };
  for (const key of Object.keys(CAR_SPECS)) {
    const spec = CAR_SPECS[key];
    const card = document.createElement('div');
    card.className = 'carCard' + (key === app.carKey ? ' sel' : '');
    card.dataset.car = key;
    const st = stats[key];
    card.innerHTML = `<div class="cIcon">🏎️</div><div class="cName">${spec.name}</div><div class="cTag">${spec.tag}</div>
      <div class="stats">
        <i><b style="width:${(st.accel / 5) * 100}%"></b></i>
        <i><b style="width:${(st.speed / 5) * 100}%"></b></i>
        <i><b style="width:${(st.corner / 5) * 100}%"></b></i>
      </div>`;
    card.addEventListener('click', () => {
      app.carKey = key;
      localStorage.setItem('neon_car', key);
      list.querySelectorAll('.carCard').forEach((c) => c.classList.toggle('sel', c.dataset.car === key));
      updateMenuPreview();
    });
    list.appendChild(card);
  }

  const colors = $('colorList');
  colors.innerHTML = '';
  for (const c of COLORS) {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (c === app.color ? ' sel' : '');
    sw.style.background = c;
    sw.style.color = c;
    sw.dataset.color = c;
    sw.addEventListener('click', () => {
      app.color = c;
      cockpit.setColor(c);
      localStorage.setItem('neon_color', c);
      colors.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('sel', s.dataset.color === c));
      updateMenuPreview();
    });
    colors.appendChild(sw);
  }

  $('nickInput').value = app.nick;
  $('nickInput').addEventListener('input', () => { app.nick = $('nickInput').value.trim(); });

  $('autoAccelBtn').addEventListener('click', () => {
    app.autoAccel = !app.autoAccel;
    $('autoAccelBtn').classList.toggle('on', app.autoAccel);
    $('autoAccelBtn').querySelector('b').textContent = app.autoAccel ? 'ON' : 'OFF';
  });
  $('qualityBtn').addEventListener('click', () => {
    app.quality = app.quality === 'high' ? 'low' : 'high';
    view.renderer.setPixelRatio(app.quality === 'high' ? Math.min(window.devicePixelRatio || 1, 1.75) : 1);
    $('qualityBtn').classList.toggle('on', app.quality === 'high');
    $('qualityBtn').querySelector('b').textContent = app.quality === 'high' ? '높음' : '낮음';
  });

  $('btnSolo').addEventListener('click', () => startSolo());
  $('handBtn').addEventListener('click', () => toggleControlFlip());
  $('handBtnPause').addEventListener('click', () => toggleControlFlip());
  applyControlFlip(false);
  $('btnMulti').addEventListener('click', () => enterMulti());
  $('btnCreate').addEventListener('click', () => createRoom());
  $('btnJoin').addEventListener('click', () => joinRoom());
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  $('btnCopy').addEventListener('click', async () => {
    const code = $('roomCode').textContent;
    try {
      await navigator.clipboard.writeText(code);
      toast('방 코드 복사됨: ' + code, 1600);
    } catch (e) {
      toast('코드: ' + code, 2000);
    }
  });
  $('btnInvite').addEventListener('click', async () => {
    const code = $('roomCode').textContent;
    const url = location.origin + '/?room=' + code;
    if (navigator.share) {
      try { await navigator.share({ title: 'NEON DRIFT 대결', text: `${code} 방에서 달리자!`, url }); return; } catch (e) { /* cancel */ }
    }
    try { await navigator.clipboard.writeText(`${code} 방에서 달리자! ${url}`); toast('초대 링크 복사됨', 1800); } catch (e) { toast(url, 2400); }
  });
  $('btnReady').addEventListener('click', () => {
    const meP = app.room?.players.find((p) => p.id === app.net.id);
    app.net.send({ type: 'ready', ready: !(meP && meP.ready) });
  });
  $('btnStart').addEventListener('click', () => {
    if (app.room && app.room.players.length >= 1) {
      app.net.send({ type: 'start' });
      startMultiRace(app.room);
    }
  });
  $('btnLobbyBack').addEventListener('click', () => backToMenu());
  $('btnCam').addEventListener('click', () => toggleCamera());
  $('btnPause').addEventListener('click', () => { if (app.phase === 'racing') pauseRace(); else if (app.phase === 'paused') resumeRace(); });
  $('btnResume').addEventListener('click', () => resumeRace());
  $('btnRestart').addEventListener('click', () => restartRace());
  $('btnQuit').addEventListener('click', () => backToMenu());
  $('btnAgain').addEventListener('click', () => {
    if (app.mode === 'solo') startSolo();
    else { app.resultsShown = false; backToMenu(); }
  });
  $('btnToMenu').addEventListener('click', () => backToMenu());
}

/* 메뉴 미리보기용 카메라 (차고 느낌) */
function updateMenuPreview() {
  if (app.mode !== 'menu' || !view) return;
  const cam = view.camera;
  const t = performance.now() / 1000;
  const r = 16;
  cam.position.set(TRACK.start.x + Math.cos(t * 0.18) * r, 6.2, TRACK.start.z + Math.sin(t * 0.18) * r);
  cam.lookAt(TRACK.start.x, 1.2, TRACK.start.z);
  cam.fov = 62; cam.updateProjectionMatrix();
}

/* ----------------------------- 카운트다운/루프 ----------------------------- */
function updateCountdown(now) {
  const el = $('cdText');
  const elapsed = (now - app.countdownStart) / 1000;
  const step = Math.floor(elapsed);
  if (step !== app.countdownStep) {
    app.countdownStep = step;
    if (step <= 2) { el.textContent = String(3 - step); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
    else { el.textContent = 'GO!'; }
  }
  if (elapsed >= 3.2) {
    $('countdown').classList.add('hidden');
    app.phase = 'racing';
    app.simTime = 0;
  }
}

function frame(now) {
  const raw = (now - (app.lastFrame || now)) / 1000;
  app.lastFrame = now;
  const dt = Math.min(0.05, raw);
  app.fps = app.fps * 0.9 + (1 / Math.max(1e-3, raw)) * 0.1;

  if (app.phase === 'countdown') updateCountdown(now);

  if (app.phase === 'racing' || app.phase === 'countdown') {
    if (app.phase === 'racing') app.simTime += dt;
    acc += dt;
    let steps = 0;
    while (acc >= FIXED && steps < 8) {
      acc -= FIXED;
      steps++;
      updateRacers(FIXED);
      if (app.phase === 'racing') {
        app.netSendAt += FIXED;
      }
    }
    updateCamera(dt);
    {
      const me = app.racers.find((r) => r.isMe);
      if (me) {
        cockpit.update(view.camera, dt, {
          on: app.camMode === 'first' && app.phase === 'racing',
          steer: input.steer,
          boost: me.car.nitroActive ? 1.2 : (me.car.boostTime > 0 ? 0.7 : 0),
        });
        me.mesh.setVisible(app.camMode !== 'first' && app.phase !== 'menu');
      }
    }
    trackMeshes.update(dt, now / 1000, app.racers.find((r) => r.isMe)?.prog.nextCp ?? 0);
    effects.update(dt, TRACK);
    updateHud(dt);
    hud.tick(dt);
    if (app.mode === 'multi' && app.net && app.net.connected) {
      app.posRate += dt;
      if (app.posRate > 0.05) { app.posRate = 0; if (app.phase === 'racing') sendPos(); }
    }
  } else if (app.phase === 'menu' || app.phase === 'idle') {
    app.idleT = (app.idleT || 0) + dt;
    const me = app.racers.find((r) => r.isMe);
    if (me) me.mesh.update(me.car, dt, app.idleT);
    updateMenuPreview();
    trackMeshes.update(dt, now / 1000, 1);
    effects.update(dt, TRACK);
  } else if (app.phase === 'paused') {
    // 화면 정지
  }

  view.renderer.render(view.scene, view.camera);
  requestAnimationFrame(frame);
}

/* ----------------------------- 부팅 ----------------------------- */
function boot() {
  buildMenu();
  $('loading').classList.add('hidden');
  app.phase = 'idle';
  updateMenuPreview();
  // URL ?room=CODE 자동 참가
  const params = new URLSearchParams(location.search);
  const roomCode = params.get('room');
  const urlName = params.get('name');
  if (urlName) { app.nick = urlName.slice(0, 10); $('nickInput').value = app.nick; }
  if (roomCode) {
    app.mode = 'multi';
    hide('menu');
    show('lobby');
    $('codeInput').value = roomCode.toUpperCase();
    enterMulti().then(() => {
      app.net.send({ type: 'join', code: roomCode.toUpperCase(), name: app.nick || '드라이버', car: app.carKey, color: app.color });
    }).catch(() => {});
  }
  requestAnimationFrame(frame);

  // 테스트/디버그용 핸들
  window.__neon = {
    app,
    TRACK,
    wheel,
    state: () => {
      const me = app.racers.find((r) => r.isMe);
      const rows = boardRows();
      return {
        phase: app.phase,
        mode: app.mode,
        fps: app.fps,
        simTime: app.simTime,
        speed: me ? Math.abs(me.car.speed) : 0,
        kmh: me ? kmh(me.car) : 0,
        lap: me ? me.prog.lap : 0,
        lapDisplay: me ? me.prog.lapDisplay : 0,
        nextCp: me ? me.prog.nextCp : 0,
        slip: me ? me.car.slip : 0,
        boostTime: me ? me.car.boostTime : 0,
        nitroFuel: me ? me.car.boostFuel : 0,
        nitroActive: me ? me.car.nitroActive : false,
        x: me ? me.car.x : 0,
        z: me ? me.car.z : 0,
        h: me ? me.car.h : 0,
        steer: me ? me.car.steer : 0,
        inputSteer: input.steer,
        wheelAngle: wheel.angle,
        wheelValue: wheel.value,
        camMode: app.camMode,
        flipControls: app.flipControls,
        input: { ...input },
        autoAccel: app.autoAccel,
        position: rows.find((r) => r.me) ? rows.find((r) => r.me).rank : 0,
        board: rows,
        boardVisible: !document.getElementById('board').closest('.hidden') && !document.getElementById('hud').classList.contains('hidden'),
        racers: app.racers.length,
        finished: me ? me.prog.finished : false,
        resultsShown: app.resultsShown,
        roomCode: app.room ? app.room.code : null,
        netId: app.net ? app.net.id : null,
        racerList: app.racers.map((r) => ({ id: r.id, name: r.name, isMe: r.isMe, x: r.car.x, z: r.car.z, lap: r.prog.lap })),
      };
    },
    setInput: (patch) => Object.assign(input, patch),
    readPixels: () => {
      const gl = view.renderer.getContext();
      view.renderer.render(view.scene, view.camera);
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let sum = 0, sum2 = 0, n = 0, maxV = 0;
      const colors = new Set();
      for (let y = 0; y < h; y += 4) {
        for (let x = 0; x < w; x += 4) {
          const i = (y * w + x) * 4;
          const v = (px[i] + px[i + 1] + px[i + 2]) / 3;
          sum += v; sum2 += v * v; n++;
          if (v > maxV) maxV = v;
          colors.add(`${px[i] >> 4},${px[i + 1] >> 4},${px[i + 2] >> 4}`);
        }
      }
      const mean = sum / n;
      return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), maxV, colors: colors.size, w, h };
    },
    toggleCamera,
    toggleControlFlip,
    applyControlFlip,
    startSolo,
    errors: app.errors,
    renderer: view.renderer,
    camera: view.camera,
  };
}

window.addEventListener('error', (e) => app.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => app.errors.push('rejection: ' + String(e.reason)));

boot();
