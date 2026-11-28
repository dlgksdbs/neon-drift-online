/* =============================================================================
   test/friends.js — 친구 대결(멀티) 통합 테스트
   ① 서버 계약: 방 생성 → 참가 → 시작(그리드 전달) → 완주 → 재경기(rematch)
   ② 실브라우저 2대(390×844): 방 만들기 → 초대 링크 참가 → 레이스 시작
      - 시작해도 로비가 게임 화면을 덮지 않는다(예전 '시작하고 튕김' 버그)
      - 카운트다운 숫자가 3·2·1·GO 로만 표시된다
      - 양쪽 주행 · 상대 차량 이동 · 콘솔/pageerror 0
   ③ 레이스 중 소켓이 끊겨도 메뉴로 튕기지 않고 재접속(resume)해 이어 달린다
   ④ 3인칭에서 문구(메시지·카운트다운·속도 게이지·토스트)가 내 차를 가리지 않는다
   실행: node test/friends.js     (스크린샷 → downloads/neon-drift-friends)
   ============================================================================= */
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import WebSocket from 'ws';
import { TRACK, sample } from '../public/js/core/track.js';

process.env.LD_LIBRARY_PATH = '/workspace/.cache/chromelibs/root/usr/lib/x86_64-linux-gnu:/workspace/.cache/chromelibs/root/lib/x86_64-linux-gnu:' + (process.env.LD_LIBRARY_PATH || '');
const require = createRequire('/workspace/.cache/uitest/');
const puppeteer = require('puppeteer');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || '/workspace/downloads/neon-drift-friends';
const PORT = Number(process.env.FRIENDS_PORT || 3740);
const CHROME = '/workspace/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra))); }
}
function section(t) { console.log('\n■ ' + t); }

const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore','pipe','pipe'] });
server.stdout.on('data',d=>process.stdout.write('[srv] '+d));
server.stderr.on('data',d=>process.stdout.write('[srv!] '+d));
const stop = () => { try { server.kill('SIGKILL'); } catch (e) { /* noop */ } };
process.on('exit', stop);
await sleep(1500);
const BASE = `http://127.0.0.1:${PORT}`;
const posAt = (s) => { const p = sample(TRACK, s % TRACK.total, 0); return { x: p.x, z: p.z, h: p.heading }; };

/* ------------------------- ① 서버 계약 ------------------------- */
class Client {
  constructor(name) { this.name = name; this.msgs = []; }
  async open() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      this.msgs.push(m);
      if (m.type === 'welcome' || m.type === 'resumed') this.id = m.id;
    });
    await new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    await this.waitFor('welcome', 4000);
    return this;
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async waitFor(type, ms = 5000, pred = null) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = this.msgs.findIndex((m) => m.type === type && (!pred || pred(m)));
      if (i >= 0) return this.msgs.splice(i, 1)[0];
      await sleep(25);
    }
    throw new Error(`ws '${type}' 대기 시간 초과 (${this.name})`);
  }
  close() { try { this.ws.close(); } catch (e) { /* noop */ } }
}
async function runLaps(client, laps = 3, step = 30) {
  let s = TRACK.total - 20;
  for (let lap = 0; lap < laps; lap++) {
    for (let i = 0; i < Math.ceil(TRACK.total / step) + 1; i++) {
      s += step;
      client.send({ type: 'pos', ...posAt(s), speed: 30, boost: false });
      await sleep(2);
    }
  }
}

section('서버 · 시작 그리드 · 완주 · 재경기');
{
  const A = await new Client('A').open();
  const B = await new Client('B').open();
  A.send({ type: 'create', name: '한윤', car: 'gt', color: '#37f3ff' });
  const room = await A.waitFor('room');
  const code = room.code;
  B.send({ type: 'join', code, name: '정원영', car: 'hyper', color: '#ff2fb0' });
  await A.waitFor('room', 4000, (m) => m.players.length === 2);

  A.send({ type: 'start' });
  const cd = await A.waitFor('countdown', 4000);
  ok('countdown에 참가자 그리드가 실려 온다', Array.isArray(cd.players) && cd.players.length === 2, cd.players);
  ok('그리드 순서(gridIndex)가 서로 다르다', new Set((cd.players || []).map((p) => p.gridIndex)).size === 2, (cd.players || []).map((p) => p.gridIndex));
  // 시작 직후 오는 room 메시지는 "레이스 중" 상태여야 한다(화면을 덮지 않기 위한 근거)
  const roomAtStart = await A.waitFor('room', 3000, (m) => m.state !== 'lobby');
  ok('시작 직후 방 상태가 lobby가 아니다', roomAtStart.state === 'countdown' || roomAtStart.state === 'racing', roomAtStart.state);
  await A.waitFor('race', 6000);
  await B.waitFor('race', 6000);

  await runLaps(A);
  await runLaps(B);
  const fin = await A.waitFor('finish', 9000, (m) => m.order.length >= 2);
  ok('두 명 완주 → 결과 브로드캐스트', fin.order.length === 2, fin.order.map((o) => o.name));
  const done = await A.waitFor('room', 3000, (m) => m.state === 'done');
  ok('경기 종료 상태 done', done.state === 'done');

  A.send({ type: 'rematch' });
  const back = await A.waitFor('room', 4000, (m) => m.state === 'lobby');
  ok('재경기 → 방이 다시 lobby', back.state === 'lobby', back.state);
  ok('재경기 후 준비 상태 초기화', back.players.every((p) => !p.ready), back.players);
  A.send({ type: 'start' });
  const cd2 = await A.waitFor('countdown', 4000);
  ok('재경기에서 다시 레이스 시작', typeof cd2.startAt === 'number');

  // 레이스 중 이탈 → grace 동안 자리 유지 → 재접속(resume)으로 복귀
  await A.waitFor('race', 6000);
  A.send({ type: 'pos', ...posAt(TRACK.total - 30), speed: 20 });
  await sleep(150);
  const bId = B.id;
  B.close();
  await sleep(400);
  const still = await A.waitFor('state', 3000);
  ok('레이스 중 끊긴 플레이어가 결과에서 바로 빠지지 않는다', still.players.some((p) => p.id === bId), still.players.map((p) => p.id));
  const B2 = await new Client('B2').open();
  B2.send({ type: 'resume', code, id: bId });
  const resumed = await B2.waitFor('resumed', 4000);
  ok('resume 성공 · 같은 플레이어 id 유지', resumed.id === bId, { resumed: resumed.id, bId });
  ok('resume 응답에 레이스 상태/그리드', resumed.state === 'racing' && Array.isArray(resumed.players) && resumed.players.length === 2, { state: resumed.state, n: (resumed.players || []).length });
  B2.send({ type: 'pos', ...posAt(TRACK.total - 60), speed: 24 });
  await sleep(250);
  const st3 = await A.waitFor('state', 3000, (m) => m.players.some((p) => p.id === bId && Math.abs(p.speed - 24) < 0.5));
  ok('재접속한 플레이어 위치가 다시 반영된다', !!st3, st3 && st3.players.map((p) => [p.id, p.speed]));
  A.close(); B2.close();
  await sleep(300);
}

/* ------------------------- ② 실브라우저 2대 ------------------------- */
const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=swiftshader', '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion', '--autoplay-policy=no-user-gesture-required',
  '--in-process-gpu', '--single-process', '--no-zygote', '--js-flags=--max-old-space-size=384'];
const errors = [];
async function mkBrowser(tag) {
  const b = await puppeteer.launch({ headless: 'new', executablePath: CHROME, protocolTimeout: 180000, args: LAUNCH_ARGS });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  p.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
  return { b, p };
}
/* 두 브라우저가 한 CPU를 나눠 쓰느라 첫 로드가 느릴 때가 있다 — 몇 번 다시 시도한다 */
async function gotoGame(p, url, tag) {
  for (let i = 0; i < 3; i++) {
    try {
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForFunction(() => window.__neon && window.__neon.state(), { timeout: 90000 });
      await sleep(400);
      return;
    } catch (e) {
      console.log('    · ' + tag + ' 로드 재시도 ' + (i + 1) + ' — ' + String(e.message).split('\n')[0]);
      await sleep(1500);
    }
  }
  throw new Error(tag + ' 페이지를 불러오지 못했습니다');
}
const stateOf = (p) => p.evaluate(() => (window.__neon ? window.__neon.state() : null));
const screens = (p) => p.evaluate(() => ['menu', 'lobby', 'results', 'pause'].filter((id) => !document.getElementById(id).classList.contains('hidden')));
const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, n) });
/* 차를 트랙 스타트 직선에 올려 놓고 달리는 상태로 만든다(조향 없이도 계속 이동) */
async function resetOnTrack(p, speed = 24) {
  await p.evaluate((v) => {
    const n = window.__neon;
    const me = n.app.racers.find((r) => r.isMe);
    if (!me) return;
    const T = n.TRACK;
    const s = 30;
    const i = Math.floor(s / T.segLen) % T.n;
    me.car.x = T.xs[i]; me.car.z = T.zs[i]; me.car.h = T.heading[i];
    me.car.vx = Math.sin(me.car.h) * v; me.car.vz = Math.cos(me.car.h) * v;
    me.car._hint = i;
    me.prog.reset(s, n.app.simTime);
  }, speed);
  await sleep(150);
}

section('실브라우저 2대 (390×844) · 방 만들기 → 초대 참가 → 시작');
const host = await mkBrowser('host');
const guest = await mkBrowser('guest');
await gotoGame(host.p, `${BASE}/`, '호스트');
await host.p.click('#nickInput');
await host.p.type('#nickInput', '한윤');
await host.p.click('#btnMulti');
await sleep(400);
await host.p.click('#btnCreate');
await host.p.waitForFunction(() => /^[A-Z0-9]{4}$/.test(document.getElementById('roomCode').textContent.trim()), { timeout: 25000 });
const code = (await host.p.$eval('#roomCode', (e) => e.textContent)).trim();
ok('방 코드 발급', /^[A-Z0-9]{4}$/.test(code), code);

await gotoGame(guest.p, `${BASE}/?room=${code}&name=${encodeURIComponent('정원영')}`, '게스트');
await guest.p.waitForFunction(() => document.querySelectorAll('#playerList li').length === 2, { timeout: 30000 }).catch(() => {});
await sleep(1200);
const guestList = await guest.p.evaluate(() => [...document.querySelectorAll('#playerList li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
ok('로비 목록에 서로의 닉네임이 보인다', guestList.length === 2 && guestList[0].includes('한윤') && guestList.some((t) => t.includes('정원영')), guestList);

// 카운트다운 숫자를 계속 관찰한다
await guest.p.evaluate(() => {
  window.__cdSeen = new Set();
  const el = document.getElementById('cdText');
  window.__cdTimer = setInterval(() => {
    if (!document.getElementById('countdown').classList.contains('hidden')) window.__cdSeen.add(el.textContent.trim());
  }, 40);
});

await host.p.click('#btnStart');
const t0 = Date.now();
let lobbyGoneMs = -1;
while (Date.now() - t0 < 6000) {
  const hs = await screens(host.p), gs = await screens(guest.p);
  if (!hs.includes('lobby') && !gs.includes('lobby')) { lobbyGoneMs = Date.now() - t0; break; }
  await sleep(60);
}
ok('시작하면 로비 화면이 사라진다 (양쪽)', lobbyGoneMs >= 0, { lobbyGoneMs, host: await screens(host.p), guest: await screens(guest.p) });
ok('시작 후에도 로비가 다시 덮지 않는다', !(await screens(host.p)).includes('lobby') && !(await screens(guest.p)).includes('lobby'));

await sleep(1200);
const hs1 = await stateOf(host.p); const gs1 = await stateOf(guest.p);
ok('호스트 화면이 카운트다운/레이스로 넘어간다', ['countdown', 'racing'].includes(hs1.phase), hs1.phase);
ok('게스트도 같은 상태', ['countdown', 'racing'].includes(gs1.phase), gs1.phase);
ok('양쪽 모두 차량 2대 스폰', hs1.racers === 2 && gs1.racers === 2, { host: hs1.racers, guest: gs1.racers });
await shot(host.p, 'f01-countdown-host.png');
await shot(guest.p, 'f02-countdown-guest.png');

const racing = await (async () => {
  const t = Date.now();
  while (Date.now() - t < 15000) {
    const a = await stateOf(host.p), b = await stateOf(guest.p);
    if (a.phase === 'racing' && b.phase === 'racing') return { a, b };
    await sleep(100);
  }
  return null;
})();
ok('카운트다운 후 양쪽 레이스 시작', !!racing, racing && { host: racing.a.phase, guest: racing.b.phase });
const cdSeen = await guest.p.evaluate(() => { clearInterval(window.__cdTimer); return [...window.__cdSeen]; });
ok('카운트다운 표시가 3·2·1·GO 뿐', cdSeen.every((t) => ['3', '2', '1', 'GO!', 'GO'].includes(t)), cdSeen);
ok('시작 후에도 HUD가 보인다', await host.p.evaluate(() => !document.getElementById('hud').classList.contains('hidden')));

await sleep(3000);
const hs2 = await stateOf(host.p); const gs2 = await stateOf(guest.p);
ok('호스트 차가 실제로 달린다', hs2.kmh > 8, hs2.kmh);
ok('게스트 차도 달린다', gs2.kmh > 8, gs2.kmh);
// 조향 없이 달리면 코너에서 벽에 붙어 멈추므로, 직선에 올려 두고 상대 화면에서 움직이는지 본다
await resetOnTrack(host.p, 24);
await sleep(900);
const hostCarOnGuestA = (await stateOf(guest.p)).racerList.find((r) => !r.isMe);
await sleep(1500);
const gs3 = await stateOf(guest.p);
const hostCarOnGuestB = gs3.racerList.find((r) => !r.isMe);
ok('게스트 화면에서 상대 차가 실시간으로 움직인다', !!hostCarOnGuestA && !!hostCarOnGuestB && Math.hypot(hostCarOnGuestB.x - hostCarOnGuestA.x, hostCarOnGuestB.z - hostCarOnGuestA.z) > 1, { a: hostCarOnGuestA, b: hostCarOnGuestB });
ok('순위표에 2명', gs3.board.length === 2, gs3.board);
await shot(guest.p, 'f03-racing-guest.png');

/* ------------------------- ④ 3인칭 차 가림 검사 ------------------------- */
section('3인칭 · 문구가 내 차를 가리지 않는가');
const coverCheck = async (page) => page.evaluate(() => {
  const n = window.__neon;
  const car = n.carScreenBox();
  const ids = ['msgBox', 'gaugeWrap', 'speedBox', 'countdown', 'cdText', 'toast', 'board', 'minimapWrap', 'hud-top'];
  const rects = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el || el.classList.contains('hidden')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    rects[id] = { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
  }
  const carBox = { x: car.x, y: car.y, right: car.right, bottom: car.bottom, w: car.w, h: car.h };
  const inter = (a, b) => !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y);
  return { car: carBox, hits: Object.keys(rects).filter((k) => inter(carBox, rects[k])), rects };
});
// 메시지(LAP)·카운트다운·토스트를 실제로 띄운 상태에서 측정
await host.p.evaluate(() => {
  const n = window.__neon;
  document.getElementById('msgBox').classList.remove('hidden');
  document.getElementById('msgBox').textContent = 'LAP 2';
  document.getElementById('toast').classList.remove('hidden');
  document.getElementById('toast').textContent = '초대 링크 복사됨';
});
await sleep(250);
const cover = await coverCheck(host.p);
ok('메시지·토스트가 떠 있어도 내 차를 가리지 않는다', cover.hits.length === 0, cover.hits);
ok('3인칭 차가 화면 안에 있다', cover.car.y > 0 && cover.car.bottom <= 844 && cover.car.w > 30, cover.car);
console.log('    · 차 화면 사각형 ' + JSON.stringify(cover.car));
await shot(host.p, 'f04-third-person-msg.png');
await host.p.evaluate(() => {
  document.getElementById('msgBox').classList.add('hidden');
  document.getElementById('toast').classList.add('hidden');
  document.getElementById('countdown').classList.remove('hidden');
  document.getElementById('cdText').textContent = 'GO!';
});
await sleep(250);
const cover2 = await coverCheck(host.p);
const cdHit = cover2.hits.filter((h) => h !== 'countdown');
ok('카운트다운 문구도 내 차를 가리지 않는다', !['cdText'].some((k) => cover2.hits.includes(k)) && Math.abs(cover2.rects.cdText.y - cover2.car.y) > 0, cover2.rects.cdText);
ok('카운트다운 글자는 차 위쪽에 있다', cover2.rects.cdText.bottom <= cover2.car.y + 1, { cdText: cover2.rects.cdText, car: cover2.car });
await shot(host.p, 'f05-third-person-countdown.png');
await host.p.evaluate(() => document.getElementById('countdown').classList.add('hidden'));
await sleep(200);

/* ------------------------- ③ 레이스 중 소켓 끊김 ------------------------- */
section('레이스 중 소켓 끊김 → 메뉴로 튕기지 않고 재접속');
const beforeDrop = await stateOf(guest.p);
const oldId = beforeDrop.netId;
await guest.p.evaluate(() => { window.__neon.app.net.ws.close(); });
let afterDrop = null; let netInfo = null;
const t1 = Date.now();
while (Date.now() - t1 < 25000) {
  const s = await stateOf(guest.p);
  const n = await guest.p.evaluate(() => ({
    connected: window.__neon.app.net.connected, id: window.__neon.app.net.id,
    rs: window.__neon.app.net.ws ? window.__neon.app.net.ws.readyState : -1,
  }));
  if (s.phase === 'racing' && n.connected && n.rs === 1 && n.id === oldId) { afterDrop = s; netInfo = n; break; }
  await sleep(200);
}
const scr = await screens(guest.p);
ok('끊겨도 메뉴로 튕기지 않는다', !scr.includes('menu') && !scr.includes('lobby'), scr);
ok('자동 재접속 후 레이스 계속', !!netInfo && afterDrop.phase === 'racing', { netInfo, phase: afterDrop && afterDrop.phase });
ok('재접속 후에도 내 차/상대 차 유지', afterDrop.racers === 2, afterDrop.racers);
ok('소켓이 다시 열리고 같은 플레이어 id 로 복귀', netInfo.connected === true && netInfo.rs === 1 && netInfo.id === oldId, { netInfo, oldId });
const resumeToast = await guest.p.evaluate(() => document.getElementById('toast').textContent);
// 재접속 뒤에도 주행이 이어지는지: 직선에 올려 두고 실제로 움직이는지 본다
await resetOnTrack(guest.p, 24);
const posA = await stateOf(guest.p);
await sleep(900);
const posB = await stateOf(guest.p);
ok('재접속 후에도 차가 계속 움직인다', Math.hypot(posB.x - posA.x, posB.z - posA.z) > 1, { a: [posA.x, posA.z], b: [posB.x, posB.z] });
const simAdvance = posB.simTime > posA.simTime;
ok('재접속 후 게임 시간이 흘러간다', simAdvance, { a: posA.simTime, b: posB.simTime });
await sleep(900);
const afterDrop2 = await stateOf(guest.p);
ok('재접속 뒤 서버 동기화(상대 차 이동) 정상', !!afterDrop2.racerList.find((r) => !r.isMe), afterDrop2.racerList);
ok('재접속 알림 표시', /다시 연결됐/.test(resumeToast), resumeToast);
await shot(guest.p, 'f06-after-resume.png');

/* ------------------------- 오류 · 부하 ------------------------- */
section('콘솔 · 네트워크 오류');
const realErrors = errors.filter((e) => !/favicon|ERR_ABORTED|net::ERR/.test(e));
ok('pageerror · 콘솔 오류 0', realErrors.length === 0, realErrors.slice(0, 8));
const health = await (await fetch(BASE + '/healthz')).json();
ok('서버 정상 · 방/플레이어 집계', health.ok === true && health.players >= 2, health);
await host.b.close(); await guest.b.close();
stop();
console.log(`\n=== 결과: ${pass} 통과 / ${fail} 실패 ===`);
if (fail) { console.log('실패: ' + fails.join(', ')); process.exit(1); }
process.exit(0);
