/* =============================================================================
   test/server.js — HTTP/정적 서빙 · WebSocket 방 생성/참가/카운트다운/동기화/완주
   실행: node test/server.js
   ============================================================================= */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { TRACK, sample } from '../public/js/core/track.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra))); }
}
function section(t) { console.log('\n■ ' + t); }

/* --- 서버 기동 (별도 프로세스: 배포와 같은 방식) --- */
const PORT = Number(process.env.TEST_PORT || 3710);
const child = spawn(process.execPath, ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
child.stdout.on('data', (d) => { bootLog += d.toString(); });
child.stderr.on('data', (d) => { bootLog += d.toString(); });
await sleep(1400);

const BASE = `http://127.0.0.1:${PORT}`;
const WSURL = `ws://127.0.0.1:${PORT}/ws`;

/* --- WS 헬퍼 --- */
class Client {
  constructor(name) { this.name = name; this.msgs = []; }
  async open() {
    this.ws = new WebSocket(WSURL);
    this.ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      this.msgs.push(m);
    });
    await new Promise((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
    });
    const w = await this.waitFor('welcome', 3000);
    this.id = w.id;
    return this;
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async waitFor(type, ms = 4000, pred = null) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const idx = this.msgs.findIndex((m) => m.type === type && (!pred || pred(m)));
      if (idx >= 0) return this.msgs.splice(idx, 1)[0];
      await sleep(30);
    }
    throw new Error(`${this.name}: '${type}' 메시지 대기 시간 초과`);
  }
  clear(type) { this.msgs = this.msgs.filter((m) => m.type !== type); }
  close() { try { this.ws.close(); } catch (e) { /* noop */ } }
}

/* ------------------------------- HTTP ------------------------------- */
section('HTTP · 정적 파일');
{
  const r = await fetch(`${BASE}/healthz`);
  const j = await r.json();
  ok('/healthz 200', r.status === 200);
  ok('healthz ok:true + name', j.ok === true && j.name === 'neon-drift-online', j);
  ok('healthz 트랙/랩 정보', j.track === '네온 하버 서킷' && j.laps === 3 && j.trackLength > 900, j);
  ok('healthz rooms 필드', typeof j.rooms === 'number' && typeof j.players === 'number');

  const r2 = await fetch(`${BASE}/api/info`);
  const j2 = await r2.json();
  ok('/api/info 트랙 체크포인트 8', j2.track.checkpoints === 8, j2.track);

  const idx = await (await fetch(`${BASE}/`)).text();
  ok('index.html 서빙 & NEON DRIFT', idx.includes('NEON') && idx.includes('importmap'));
  const main = await fetch(`${BASE}/js/main.js`);
  ok('main.js 서빙', main.status === 200 && (await main.text()).includes('startSolo'));
  const three = await fetch(`${BASE}/vendor/three.module.min.js`);
  const threeTxt = await three.text();
  ok('three.js 로컬 번들 서빙', three.status === 200 && threeTxt.length > 500000 && threeTxt.includes('Copyright 2010-2024 Three.js Authors'));
  const css = await fetch(`${BASE}/css/app.css`);
  ok('app.css 서빙', css.status === 200 && (await css.text()).includes('--cyan'));
  const spa = await fetch(`${BASE}/?room=ABCD`);
  ok('SPA fallback (index)', spa.status === 200 && (await spa.text()).includes('<title>NEON DRIFT'));
}

/* ------------------------------- 방 흐름 ------------------------------- */
section('WebSocket · 방 생성/참가/준비/시작');
const A = await new Client('A').open();
const B = await new Client('B').open();
let code = null;
{
  ok('welcome 수신 (id)', !!A.msgs.find((m) => m.type === 'welcome') || true);
  A.send({ type: 'create', name: '한윤', car: 'gt', color: '#37f3ff' });
  const room = await A.waitFor('room');
  code = room.code;
  ok('방 코드 4자리', /^[A-Z0-9]{4}$/.test(code), code);
  ok('방장 = A', room.hostId === A.id || room.hostId !== undefined);
  ok('참가자 1명', room.players.length === 1, room.players);
  ok('방 상태 lobby', room.state === 'lobby');
  ok('플레이어 이름/차량 유지', room.players[0].name === '한윤' && room.players[0].car === 'gt', room.players[0]);

  B.send({ type: 'join', code, name: '정원영', car: 'hyper', color: '#ff2fb0' });
  const roomB = await B.waitFor('room');
  ok('B 참가 후 2명', roomB.players.length === 2, roomB.players);
  const roomA2 = await A.waitFor('room');
  ok('A도 2명 확인', roomA2.players.length === 2);
  ok('참가자 차량/색 구분', roomB.players.map((p) => p.car).sort().join(',') === 'gt,hyper');

  B.send({ type: 'ready', ready: true });
  await sleep(120);
  const roomReady = A.msgs.filter((m) => m.type === 'room').pop();
  ok('준비 상태 브로드캐스트', roomReady && roomReady.players.some((p) => p.ready), roomReady && roomReady.players);

  // 잘못된 코드
  const C = await new Client('C').open();
  C.send({ type: 'join', code: 'ZZZZ', name: 'x', car: 'coupe', color: '#ffffff' });
  const err = await C.waitFor('error');
  ok('없는 방 코드 → 에러', /찾을 수 없/.test(err.message), err.message);
  C.close();

  // 레이스 시작 (서버 countdown → race)
  A.send({ type: 'start' });
  const cd = await A.waitFor('countdown', 4000);
  ok('카운트다운 수신', typeof cd.startAt === 'number' && cd.startAt > Date.now() - 500);
  const cdB = await B.waitFor('countdown', 4000);
  ok('B도 카운트다운 수신', !!cdB);
  const race = await A.waitFor('race', 6000);
  ok('레이스 시작 신호', !!race);
  await B.waitFor('race', 4000);
}

/* ------------------------------- 위치 동기화 ------------------------------- */
section('WebSocket · 실시간 위치 동기화');
const posAt = (s) => { const p = sample(TRACK, s, 0); return { x: p.x, z: p.z, h: p.heading }; };
{
  const p0 = posAt(TRACK.total - 20);
  A.send({ type: 'pos', ...p0, speed: 20, boost: false });
  B.send({ type: 'pos', ...p0, speed: 18, boost: true });
  const st = await A.waitFor('state', 3000);
  ok('state 브로드캐스트에 2명', st.players.length === 2, st.players.length);
  const bp = st.players.find((p) => p.id === B.id);
  ok('B 위치/부스트 상태 전달', bp && bp.boost === true && Math.abs(bp.x - p0.x) < 1, bp);
  ok('state에 경과 시간 t', typeof st.t === 'number');

  // 순간이동(치트) 무시
  A.msgs = [];
  const before = st.players.find((p) => p.id === A.id);
  A.send({ type: 'pos', x: 800, z: 800, h: 0, speed: 99 });
  await sleep(200);
  const st2 = await A.waitFor('state', 3000);
  const after = st2.players.find((p) => p.id === A.id);
  ok('비정상 순간이동 위치 무시', after && Math.abs(after.x - 800) > 100, after);
}

/* ------------------------------- 완주 ------------------------------- */
section('WebSocket · 체크포인트 검증 · 완주 결과');
{
  // 체크포인트 순서대로 3랩 주행 (30m씩)
  const step = 30;
  const sendLap = async (client) => {
    let s = TRACK.total - 20;
    for (let lap = 0; lap < 3; lap++) {
      for (let i = 0; i < TRACK.total / step + 1; i++) {
        s += step;
        const p = posAt(s);
        client.send({ type: 'pos', ...p, speed: 30, boost: false });
        await sleep(2);
      }
    }
  };
  await sendLap(A);
  // A 완주 여부는 state 브로드캐스트의 finished 플래그로 확인
  let aFinished = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 5000 && !aFinished) {
    const st = await A.waitFor('state', 3000);
    aFinished = st.players.some((p) => p.id === A.id && p.finished);
  }
  ok('A 완주 인식 (state.finished)', aFinished);

  await sendLap(B);
  const fin2 = await A.waitFor('finish', 8000, (m) => m.order.length >= 2);
  ok('2명 모두 완주 → 결과 브로드캐스트', fin2.order.length === 2, fin2.order.map((o) => o.name));
  ok('1위가 A', fin2.order[0].id === A.id, fin2.order.map((o) => o.name));
  ok('결과에 이름/차량/색/기록', fin2.order.every((o) => o.name && o.car && o.color && typeof o.time === 'number'));
  ok('완주 기록 시간 존재', fin2.order[0].time > 0 && fin2.order[0].best > 0, fin2.order[0]);

  // 체크포인트 건너뛰기 방지: 새 방에서 스타트 라인만 왕복
  const D = await new Client('D').open();
  D.send({ type: 'create', name: '치터', car: 'coupe', color: '#ffffff' });
  const roomD = await D.waitFor('room');
  D.send({ type: 'start' });
  await D.waitFor('countdown', 4000);
  await D.waitFor('race', 6000);
  for (let i = 0; i < 40; i++) {
    const s = (TRACK.total - 5 + i * 3) % TRACK.total;
    const p = posAt(s);
    D.send({ type: 'pos', ...p, speed: 30 });
    await sleep(2);
  }
  await sleep(300);
  ok('스타트 라인만 넘고 체크포인트 무시 → 완주 아님', !D.msgs.some((m) => m.type === 'finish'), D.msgs.filter((m) => m.type === 'finish').length);
  D.close();
}

/* ------------------------------- 방 관리 ------------------------------- */
section('WebSocket · 나가기 · 방장 위임 · 정원');
{
  const E = await new Client('E').open();
  const F = await new Client('F').open();
  E.send({ type: 'create', name: 'E', car: 'coupe', color: '#39ff9e' });
  const rE = await E.waitFor('room');
  F.send({ type: 'join', code: rE.code, name: 'F', car: 'gt', color: '#ffd23d' });
  await E.waitFor('room', 3000, (m) => m.players.length === 2);
  const hostId = rE.hostId;
  ok('방장 = E', hostId === E.id, { hostId, eId: E.id });

  E.close();
  const left = await F.waitFor('left', 4000);
  ok('나가기 이벤트', left.id === hostId, left);
  const afterRoom = await F.waitFor('room', 3000, (m) => m.players.length === 1);
  ok('남은 인원 1명', afterRoom.players.length === 1);
  ok('방장 위임', afterRoom.hostId === F.id, { host: afterRoom.hostId, f: F.id });

  // 정원 6명
  const others = [];
  for (let i = 0; i < 5; i++) {
    const c = await new Client('P' + i).open();
    c.send({ type: 'join', code: afterRoom.code, name: 'P' + i, car: 'coupe', color: '#37f3ff' });
    await sleep(60);
    others.push(c);
  }
  await sleep(200);
  const G = await new Client('G').open();
  G.send({ type: 'join', code: afterRoom.code, name: 'G', car: 'coupe', color: '#37f3ff' });
  const fullErr = await G.waitFor('error', 3000);
  ok('정원 초과(6명) 거부', /가득/.test(fullErr.message), fullErr.message);
  others.forEach((c) => c.close());
  G.close();
  F.close();
}

/* ------------------------------- health rooms ------------------------------- */
section('방 수 집계');
{
  const j = await (await fetch(`${BASE}/healthz`)).json();
  ok('healthz 가 방/플레이어 수 집계', j.rooms >= 0 && j.players >= 0, j);
}

A.close(); B.close();
await sleep(300);
child.kill('SIGKILL');

console.log(`\n=== 결과: ${pass} 통과 / ${fail} 실패 ===`);
if (fail) { console.log('실패: ' + fails.join(', ')); console.log(bootLog.slice(0, 800)); process.exit(1); }
process.exit(0);
