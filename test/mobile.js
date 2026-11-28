/* =============================================================================
   test/mobile.js — 모바일(390×844) 실렌더 테스트
   메뉴 → 솔로 주행(원형 핸들 드래그 조향·니트로) → 실시간 순위표 → UI 겹침 0 →
   조작 좌우 반전 · 스크린샷 → 시점 전환 → 결과 화면 → 친구 대결(2 클라이언트)
   실행: node test/mobile.js     (서버 자동 기동, shots → downloads/neon-drift-shots)
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
const SHOTS = process.env.SHOTS_DIR || '/workspace/downloads/neon-drift-shots';
const PORT = Number(process.env.MOBILE_PORT || 3720);
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

/* --- 서버 --- */
const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const stop = () => { try { server.kill('SIGKILL'); } catch (e) { /* noop */ } };
process.on('exit', stop);
await sleep(1600);
const BASE = `http://127.0.0.1:${PORT}`;

const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-features=CalculateNativeWinOcclusion',
  // 메모리가 좁은 CI/원격 환경에서 렌더러 스레드 생성이 실패하지 않도록 GPU를 같은 프로세스에서 돌린다
  '--in-process-gpu', '--single-process', '--no-zygote', '--renderer-process-limit=1', '--js-flags=--max-old-space-size=384'];
const browser = await puppeteer.launch({
  headless: 'new', executablePath: CHROME, protocolTimeout: 300000, args: LAUNCH_ARGS,
});
const errors = [];
async function mkPage(br, viewport = { width: 390, height: 844 }) {
  const page = await br.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  return page;
}
const newPage = (viewport) => mkPage(browser, viewport);
const stateOf = (page) => page.evaluate(() => (window.__neon ? window.__neon.state() : null));
async function waitState(page, pred, ms = 8000, label = 'state') {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await stateOf(page);
    if (last && pred(last)) return last;
    await sleep(80);
  }
  throw new Error('waitState timeout: ' + label + ' last=' + JSON.stringify(last && { phase: last.phase, kmh: last.kmh, lap: last.lap, steer: last.steer, wheel: last.wheelAngle, pos: last.position }));
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) });
/* 조건이 만족될 때까지 기다린다(렌더 부하로 이벤트 처리가 늦어질 수 있음) */
async function waitPage(page, pred, ms = 2500) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await stateOf(page);
    if (last && pred(last)) return last;
    await sleep(60);
  }
  return last;
}
/* 차를 트랙 스타트 직선 위에 올려 놓고 24m/s로 달리는 상태로 만든다(조향 반응 측정용) */
async function resetOnTrack(page, speed = 24) {
  await page.evaluate((v) => {
    const n = window.__neon;
    const me = n.app.racers.find((r) => r.isMe);
    const T = n.TRACK;
    const s = 30;
    const i = Math.floor(s / T.segLen) % T.n;
    me.car.x = T.xs[i]; me.car.z = T.zs[i]; me.car.h = T.heading[i];
    me.car.vx = Math.sin(me.car.h) * v; me.car.vz = Math.cos(me.car.h) * v;
    me.car._hint = i;
    me.prog.reset(s, n.app.simTime);
  }, speed);
  await sleep(120);
}
async function canvasStats(page) {
  return page.evaluate(() => window.__neon.readPixels());
}
/* 핸들 시각 각도(도) + 조향 값 */
async function wheelState(p) {
  return p.evaluate(() => {
    const wr = document.getElementById('wheelRot');
    const m = new DOMMatrix(getComputedStyle(wr).transform);
    const deg = Math.atan2(m.b, m.a) * 180 / Math.PI;
    return { deg, angle: window.__neon.wheel.angle, value: window.__neon.wheel.value, dragging: window.__neon.wheel.dragging };
  });
}
/* 핸들 타원 테두리 위 각도(위=0°, 시계방향 +)로 포인터 이동 */
async function wheelPoint(p, deg) {
  const box = await (await p.$('#wheel')).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const rx = box.width * 0.36, ry = box.height * 0.36;
  return { x: cx + Math.sin((deg * Math.PI) / 180) * rx, y: cy - Math.cos((deg * Math.PI) / 180) * ry };
}
async function dragWheelStart(p, deg) {
  const a = await wheelPoint(p, deg);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
}
async function dragWheelTo(p, fromDeg, toDeg, steps = 10) {
  for (let i = 1; i <= steps; i++) {
    const d = fromDeg + ((toDeg - fromDeg) * i) / steps;
    const pt = await wheelPoint(p, d);
    await p.mouse.move(pt.x, pt.y);
    await sleep(16);
  }
}

/* 조작 배치 측정 */
async function controlLayout(p) {
  return p.evaluate(() => {
    const ids = ['controls', 'steerPad', 'actionPad', 'wheel', 'btnNitro', 'btnBrake', 'btnGas'];
    const r = {};
    for (const id of ids) {
      const b = document.getElementById(id).getBoundingClientRect();
      r[id] = { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom };
    }
    const keys = ['wheel', 'btnNitro', 'btnBrake', 'btnGas'];
    const overlaps = [];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = r[keys[i]], b = r[keys[j]];
        if (!(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y)) overlaps.push([keys[i], keys[j]]);
      }
    }
    const vw = window.innerWidth, vh = window.innerHeight;
    const outside = Object.entries(r).filter(([, v]) => v.x < -1 || v.y < -1 || v.right > vw + 1 || v.bottom > vh + 1).map(([k]) => k);
    return { r, overlaps, outside, vw, vh, flipped: document.getElementById('hud').classList.contains('flip') };
  });
}
const isMirrored = (a, b, vw) => Math.abs(a.x - (vw - b.right)) < 2 && Math.abs(a.y - b.y) < 2;
const fmtRect = (r) => `[${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}x${r.h.toFixed(0)}]`;
/* 두 heading 차이를 -π..π 로 감싼다 (화면 오른쪽 회전 = 음수) */
const wrapPi = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

/* HUD 겹침 측정(순위표 포함) */
async function hudLayout(p) {
  return p.evaluate(() => {
    const ids = ['hud-top', 'board', 'boardList', 'minimapWrap', 'gaugeWrap', 'speedBox', 'wheel', 'btnNitro', 'btnBrake', 'btnGas', 'btnCam', 'btnPause'];
    const rects = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el || el.classList.contains('hidden')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      rects[id] = { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
    }
    const overlaps = [];
    const keys = Object.keys(rects);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = rects[keys[i]], b = rects[keys[j]];
        const contained = (a.x <= b.x && a.y <= b.y && a.right >= b.right && a.bottom >= b.bottom) ||
                          (b.x <= a.x && b.y <= a.y && b.right >= a.right && b.bottom >= a.bottom);
        const inter = !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y);
        if (inter && !contained) overlaps.push([keys[i], keys[j]]);
      }
    }
    const vw = window.innerWidth, vh = window.innerHeight;
    const outside = Object.entries(rects).filter(([, r]) => r.x < -1 || r.y < -1 || r.right > vw + 1 || r.bottom > vh + 1).map(([k]) => k);
    return { rects, overlaps, outside, vw, vh };
  });
}

/* Node 쪽 WebSocket 손님(호스트) — 브라우저 없이 방을 만들고 주행을 보낸다 */
class WsClient {
  constructor() { this.msgs = []; this.history = []; }
  async open(url) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      this.msgs.push(m); this.history.push(m);
    });
    await new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    const w = await this.waitFor('welcome', 4000);
    this.id = w.id;
    return this;
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async waitFor(type, ms = 5000, pred = null) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = this.msgs.findIndex((m) => m.type === type && (!pred || pred(m)));
      if (i >= 0) return this.msgs.splice(i, 1)[0];
      await sleep(30);
    }
    throw new Error(`ws: '${type}' 대기 시간 초과`);
  }
  close() { try { this.ws.close(); } catch (e) { /* noop */ } }
}

/* ------------------------------ 1. 메뉴 ------------------------------ */
section('메뉴 · 렌더');
const page = await newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__neon && window.__neon.state(), { timeout: 120000 });
await sleep(1800);
ok('타이틀 표시', await page.$eval('.logo h1', (e) => /NEON/.test(e.textContent)));
ok('차량 카드 3개', (await page.$$('.carCard')).length === 3);
ok('색상 스와치 6개', (await page.$$('.swatch')).length === 6);
ok('닉네임 입력란', !!(await page.$('#nickInput')));
ok('솔로 시작 버튼', !!(await page.$('#btnSolo')));
ok('친구 대결 버튼', !!(await page.$('#btnMulti')));
ok('원형 핸들 존재', !!(await page.$('#wheel')) && !!(await page.$('#wheelRot svg')));ok('◀ ▶ 버튼 제거됨', (await page.$$('#btnLeft, #btnRight')).length === 0);
ok('DRIFT 버튼/게이지 요소 없음', await page.evaluate(() => !document.getElementById('btnDrift') && !document.getElementById('driftFill') && document.querySelectorAll('.bar.drift').length === 0));
ok('메뉴 안내가 핸들 조작', /핸들/.test(await page.$eval('#footHint', (e) => e.textContent)));
const menuShot = await shot(page, 'm01-menu.png');
ok('메뉴 스크린샷 저장', fs.existsSync(path.join(SHOTS, 'm01-menu.png')));
await page.click('.carCard:nth-child(2)');
ok('차량 선택 반영', await page.evaluate(() => window.__neon.app.carKey === 'gt'));

/* ------------------------------ 2. 솔로 시작 ------------------------------ */
section('솔로 시작 · 카운트다운');
await page.click('#nickInput');
await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
await page.type('#nickInput', '한윤');
await page.click('#btnSolo');
ok('카운트다운 표시', await page.evaluate(() => !document.getElementById('countdown').classList.contains('hidden')));
ok('HUD 표시', await page.evaluate(() => !document.getElementById('hud').classList.contains('hidden')));
const cdText = await page.$eval('#cdText', (e) => e.textContent);
ok('카운트다운 숫자', /^(3|2|1|GO!?)$/.test(cdText.trim()), cdText);
ok('레이서 4명 (나 + AI 3)', (await stateOf(page)).racers === 4);
const cdShot = await shot(page, 'm02-countdown.png');
ok('카운트다운 스크린샷 저장', fs.existsSync(path.join(SHOTS, 'm02-countdown.png')));

const racing = await waitState(page, (s) => s.phase === 'racing', 12000, 'race start');
ok('3-2-1-GO 후 주행 시작', racing.phase === 'racing');
await sleep(1800);
const driving = await waitState(page, (s) => s.kmh > 8, 8000, 'speed');
ok('자동 가속으로 주행', driving.kmh > 8, driving.kmh);

/* ------------------------------ 3. 실시간 순위표 ------------------------------ */
section('실시간 순위표');
const boardVisible = await page.evaluate(() => {
  const b = document.getElementById('board');
  const r = b.getBoundingClientRect();
  const cs = getComputedStyle(b);
  return { shown: r.width > 60 && r.height > 50 && cs.display !== 'none', rows: document.querySelectorAll('#boardList li').length };
});
ok('레이스 중 순위표 표시', boardVisible.shown, boardVisible);
ok('순위표 4행 (1~4위)', boardVisible.rows === 4, boardVisible.rows);
const boardInfo = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#boardList li')].map((li) => ({
    rank: li.querySelector('.rk').textContent.trim(),
    name: li.querySelector('.nm').textContent.trim(),
    lap: li.querySelector('.lp').textContent.trim(),
    me: li.classList.contains('me'),
  }));
  const p1 = document.querySelector('#boardList li.p1 .rk');
  return { rows, meIdx: rows.findIndex((r) => r.me), p1Color: p1 ? getComputedStyle(p1).color : null };
});
ok('순위표 1~4위 순서', boardInfo.rows.map((r) => r.rank).join(',') === '1,2,3,4', boardInfo.rows.map((r) => r.rank));
ok('순위표에 이름 표시', boardInfo.rows.every((r) => r.name.length > 0), boardInfo.rows);
ok('순위표에 내 차량 강조', boardInfo.meIdx >= 0, boardInfo);
ok('내 행이 1위 (폴 포지션)', boardInfo.meIdx === 0, boardInfo.meIdx);
ok('순위표 랩 표기', boardInfo.rows.every((r) => /^[1-3]\/3$|^완주$/.test(r.lap)), boardInfo.rows.map((r) => r.lap));
ok('1위 색상 금색', boardInfo.p1Color === 'rgb(255, 194, 61)', boardInfo.p1Color);
await shot(page, 'm14-leaderboard.png');
ok('레이스 중 순위표 스크린샷 저장', fs.existsSync(path.join(SHOTS, 'm14-leaderboard.png')));

/* ------------------------------ 4. 주행 ------------------------------ */
section('주행 · 니트로 · 시점');
await sleep(900);
await shot(page, 'm03-racing.png');
ok('HUD에 DRIFT 텍스트 없음', await page.evaluate(() => !/DRIFT/.test(document.getElementById('hud').innerText)));

// 니트로 (터큰홀드)
const preNitro = await stateOf(page);
const nbox = await (await page.$('#btnNitro')).boundingBox();
await page.mouse.move(nbox.x + nbox.width / 2, nbox.y + nbox.height / 2);
await page.mouse.down();
const nitro = await waitPage(page, (s) => s.nitroFuel < preNitro.nitroFuel - 8, 6000);
await page.mouse.up();
ok('니트로 버튼으로 연료 소모', nitro.nitroFuel < preNitro.nitroFuel - 4, { before: preNitro.nitroFuel, after: nitro.nitroFuel });
ok('니트로 중 부스트/가속', nitro.nitroActive === true || nitro.boostTime > 0 || nitro.kmh > preNitro.kmh, { active: nitro.nitroActive, boost: nitro.boostTime, before: preNitro.kmh.toFixed(0), after: nitro.kmh.toFixed(0) });
await shot(page, 'm05-nitro.png');

await page.click('#btnCam');
const fpReady = await page.waitForFunction(() => {
  const n = window.__neon;
  return n.app.camMode === 'first' && document.getElementById('hud').classList.contains('fp') && n.camera.near === 0.12;
}, { timeout: 20000 }).then(() => true).catch(() => false);
ok('1인칭 전환', fpReady);
ok('버튼 라벨 1인칭', (await page.$eval('#camMode', (e) => e.textContent)) === '1인칭');
await sleep(400);
const fpGauge = await page.evaluate(() => {
  const gw = document.getElementById('gaugeWrap');
  const g = gw.getBoundingClientRect();
  const fill = document.getElementById('nitroFill').getBoundingClientRect();
  const wheel = document.getElementById('wheel').getBoundingClientRect();
  const nitro = document.getElementById('btnNitro').getBoundingClientRect();
  const brake = document.getElementById('btnBrake').getBoundingClientRect();
  const mini = document.getElementById('minimapWrap').getBoundingClientRect();
  const board = document.getElementById('board').getBoundingClientRect();
  const inter = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
  const st = window.__neon.state();
  return {
    hidden: gw.classList.contains('hidden') || getComputedStyle(gw).display === 'none',
    w: g.width, h: g.height, top: g.top, left: g.left, right: g.right, bottom: g.bottom,
    fillW: fill.width, fuel: st.nitroFuel, speedText: document.getElementById('speedVal').textContent,
    overlaps: { wheel: inter(g, wheel), nitro: inter(g, nitro), brake: inter(g, brake), minimap: inter(g, mini), board: inter(g, board) },
    inView: g.top >= 0 && g.left >= 0 && g.bottom <= innerHeight && g.right <= innerWidth,
  };
});
ok('1인칭에서도 니트로(배터리) 게이지가 보임', !fpGauge.hidden && fpGauge.w > 40 && fpGauge.h > 20, fpGauge);
ok('1인칭 니트로 잔량이 실제 연료와 연결', fpGauge.fillW > 1 && fpGauge.fuel > 0, { fillW: fpGauge.fillW, fuel: fpGauge.fuel });
ok('1인칭 게이지에 실제 속도 표시', Number(fpGauge.speedText) > 10, fpGauge.speedText);
ok('1인칭 게이지가 핸들·버튼·미니맵·순위표와 겹치지 않음', !Object.values(fpGauge.overlaps).some(Boolean), fpGauge.overlaps);
ok('1인칭 게이지가 화면 안', fpGauge.inView, fpGauge);
await shot(page, 'm06-first-person.png');
await page.click('#btnCam');
const thirdReady = await page.waitForFunction(() => {
  const n = window.__neon;
  if (n.app.camMode !== 'third' || n.camera.near !== 0.3) return false;
  const b = n.carScreenBox();
  return !!b && b.w < 320 && b.bottom < innerHeight && b.y > -50;
}, { timeout: 20000 }).then(() => true).catch(() => false);
ok('3인칭 복귀', thirdReady);
// 카메라가 3인칭 자리로 완전히 돌아온 뒤(위치·시선 수렴) 측정한다
await sleep(1400);
/* 3인칭: 내 차가 하단 조작부(핸들·BRAKE·NITRO·게이지)에 가리지 않는다 */
const carClear = await page.evaluate(() => {
  const n = window.__neon;
  const box = n.carScreenBox();
  const ids = { wheel: 'wheel', brake: 'btnBrake', nitro: 'btnNitro', gauge: 'gaugeWrap' };
  const rects = {};
  for (const [k, id] of Object.entries(ids)) {
    const r = document.getElementById(id).getBoundingClientRect();
    rects[k] = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  const car = { left: box.x, top: box.y, right: box.right, bottom: box.bottom };
  const inter = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
  const hits = Object.entries(rects).filter(([, r]) => inter(car, r)).map(([k]) => k);
  // 게이지는 오른쪽 기둥에 있으므로, 하단 조작부(핸들·버튼)와 차 사이 여유를 본다
  const rowTop = Math.min(rects.wheel.top, rects.brake.top, rects.nitro.top);
  return { car, hits, gap: Math.round(rowTop - car.bottom), kmh: n.state().kmh };
});
ok('3인칭: 내 차가 핸들·버튼·게이지에 안 가림', carClear.hits.length === 0, carClear);
ok('3인칭: 차와 하단 조작부 사이 여유 (20px 이상)', carClear.gap >= 20, carClear.gap);
console.log('    · 3인칭 차 화면 위치: y ' + Math.round(carClear.car.top) + '~' + Math.round(carClear.car.bottom) + ', 조작부 여유 ' + carClear.gap + 'px (' + Math.round(carClear.kmh) + 'km/h)');

/* ------------------------------ 5. 핸들 조향 ------------------------------ */
section('와이드 핸들 조향 (드래그 · 회전 · 복원)');
const wheelSize = await page.evaluate(() => {
  const b = document.getElementById('wheel').getBoundingClientRect();
  const svg = document.querySelector('#wheelRot svg');
  const vb = (svg.getAttribute('viewBox') || '0 0 1 1').split(/\s+/).map(Number);
  return { w: b.width, h: b.height, ratio: b.width / b.height, vbRatio: Math.abs(vb[2]) / Math.abs(vb[3]) };
});
ok('핸들이 가로로 긴 타원 (가로가 1.2~1.45배)', wheelSize.ratio > 1.2 && wheelSize.ratio < 1.45, wheelSize);
ok('핸들 크기 확대 (가로 165px 이상)', wheelSize.w >= 165, wheelSize.w.toFixed(1));
ok('핸들 그림 자체도 가로로 긴 형태', wheelSize.vbRatio > 1.2, wheelSize.vbRatio.toFixed(2));
ok('핸들 세로 높이 120px 이상', wheelSize.h >= 120, wheelSize.h.toFixed(1));
{
  const wb = await (await page.$('#wheel')).boundingBox();
  await page.screenshot({
    path: path.join(SHOTS, 'm16-wheel-wide.png'),
    clip: { x: Math.max(0, wb.x - 8), y: Math.max(0, wb.y - 8), width: wb.width + 16, height: wb.height + 16 },
  });
  ok('넓힌 핸들 확대 스크린샷 저장', fs.existsSync(path.join(SHOTS, 'm16-wheel-wide.png')));
}
const wheel0 = await wheelState(page);
ok('출발 시 핸들 정면(0°)', Math.abs(wheel0.deg) < 1 && Math.abs(wheel0.value) < 0.02, wheel0);

// 오른쪽으로 돌리기
await resetOnTrack(page);
const beforeTurn = await stateOf(page);
await dragWheelStart(page, 0);
await dragWheelTo(page, 0, 90);
await sleep(260);
const held = await stateOf(page);
const heldWheel = await wheelState(page);
ok('드래그 중 핸들이 회전(60° 이상)', heldWheel.deg > 55, heldWheel);
ok('핸들 각도와 조향 값 일치(±0.08)', Math.abs(heldWheel.value - held.inputSteer) < 0.09, { wheel: heldWheel.value, steer: held.inputSteer });
ok('핸들 조향이 오른쪽(+)', held.inputSteer > 0.5, held.inputSteer);
const dhRight = wrapPi(held.h - beforeTurn.h);
// 카메라가 차 앞을 보므로 월드 heading 이 줄어드는 쪽이 화면 오른쪽이다
ok('핸들을 시계방향(오른쪽)으로 돌리면 차도 화면 오른쪽으로 회전', dhRight < -0.12, { dh: dhRight.toFixed(3), kmh: held.kmh.toFixed(0) });
ok('핸들 회전과 차의 회전 방향 일치(핸들 +, 차 음)', Math.sign(heldWheel.deg) === 1 && Math.sign(dhRight) === -1, { wheelDeg: heldWheel.deg.toFixed(1), dh: dhRight.toFixed(3) });
ok('핸들 조향 중 슬립 각 거의 없음', held.slip < 0.02, held.slip.toFixed(4));
await shot(page, 'shot-wheel-right.png');

// 끝까지 돌려도 최대 각도 제한
await dragWheelTo(page, 90, 200, 12);
await sleep(160);
const maxed = await wheelState(page);
ok('핸들 최대 회전 제한(≤135°)', maxed.angle <= 135.01 && maxed.value <= 1.001, maxed);
ok('최대 조향 값 1.0', Math.abs(maxed.value - 1) < 0.02, maxed.value);

// 손 떼면 부드럽게 정면 복원 + 조향 0
await page.mouse.up();
const released = await waitPage(page, (s) => Math.abs(s.inputSteer) < 0.03, 2500);
ok('손을 떼면 조향 입력 0', Math.abs(released.inputSteer) < 0.03, released.inputSteer);
await sleep(500);
const recentered = await (async () => {
  const t0 = Date.now();
  let w = await wheelState(page);
  while (Date.now() - t0 < 2500 && Math.abs(w.deg) > 1.5) { await sleep(70); w = await wheelState(page); }
  return w;
})();
ok('손을 떼면 핸들이 정면으로 복원', Math.abs(recentered.deg) < 1.5, recentered);
ok('복원 클래스(부드러운 전환)', await page.evaluate(() => document.getElementById('wheelRot').classList.contains('anim')));

// 왼쪽으로 돌리기
await resetOnTrack(page);
const beforeLeft = await stateOf(page);
await dragWheelStart(page, 0);
await dragWheelTo(page, 0, -90);
await sleep(260);
const heldLeft = await stateOf(page);
ok('핸들 왼쪽 조향(-0.5 이하)', heldLeft.inputSteer < -0.5, heldLeft.inputSteer);
const dhLeft = wrapPi(heldLeft.h - beforeLeft.h);
ok('핸들을 반시계방향(왼쪽)으로 돌리면 차도 화면 왼쪽으로 회전', dhLeft > 0.12, { dh: dhLeft.toFixed(3), kmh: heldLeft.kmh.toFixed(0) });
await page.mouse.up();
const leftReleased = await waitPage(page, (s) => Math.abs(s.inputSteer) < 0.03, 2500);
ok('왼쪽 조향 후에도 복원', Math.abs(leftReleased.inputSteer) < 0.03, leftReleased.inputSteer);

// 실제 터치(손가락) 드래그로도 조향된다 — 안드로이드 폰 입력 경로
await resetOnTrack(page);
const touchBefore = await stateOf(page);
{
  const box = await (await page.$('#wheel')).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const rx = box.width * 0.36, ry = box.height * 0.36;
  const pt = (deg) => ({ x: cx + Math.sin((deg * Math.PI) / 180) * rx, y: cy - Math.cos((deg * Math.PI) / 180) * ry });
  const a = pt(0);
  await page.touchscreen.touchStart(a.x, a.y);
  for (let i = 1; i <= 8; i++) { const q = pt((75 * i) / 8); await page.touchscreen.touchMove(q.x, q.y); await sleep(18); }
  await sleep(240);
  const touchHeld = await stateOf(page);
  ok('터치 드래그로 핸들 조향', touchHeld.inputSteer > 0.35, touchHeld.inputSteer);
  ok('터치 조향 시 즉시 회전(화면 오른쪽)', wrapPi(touchHeld.h - touchBefore.h) < -0.1, { dh: wrapPi(touchHeld.h - touchBefore.h).toFixed(3) });
  await page.touchscreen.touchEnd();
  const touchUp = await waitPage(page, (st) => Math.abs(st.inputSteer) < 0.03, 2500);
  ok('터치를 떼면 조향 0', Math.abs(touchUp.inputSteer) < 0.03, touchUp.inputSteer);
}

// 키보드 조향도 핸들 시각 회전에 반영
await page.keyboard.down('ArrowRight');
await sleep(350);
const keyWheel = await wheelState(page);
ok('키보드 조향 시 핸들도 회전', keyWheel.deg > 20, keyWheel);
await page.keyboard.up('ArrowRight');
await sleep(2200);
ok('키보드 해제 후 핸들 복원', Math.abs((await wheelState(page)).deg) < 2);

/* ------------------------------ 5-2. 차량 충돌 ------------------------------ */
section('차량 충돌 (달리는 AI 차와 부딪힌다)');
{
  const setup = await page.evaluate(() => {
    const n = window.__neon;
    const me = n.app.racers.find((r) => r.isMe);
    const ai = n.app.racers.find((r) => r.isAI);
    const T = n.TRACK;
    const place = (car, s, v) => {
      const i = Math.floor(s / T.segLen) % T.n;
      car.x = T.xs[i]; car.z = T.zs[i]; car.h = T.heading[i];
      car.vx = Math.sin(car.h) * v; car.vz = Math.cos(car.h) * v;
      car._hint = i;
    };
    // 스타트 직선에서 앞차 바로 뒤로 붙여 추돌시킨다
    place(ai.car, 46.5, 8);
    place(me.car, 40, 36);
    ai.prog.reset(46.5, n.app.simTime);
    me.prog.reset(40, n.app.simTime);

    // 차체 캡슐 겹침을 매 프레임 기록 (뚫고 지나가면 큰 음수가 된다)
    window.__minGap = Infinity;
    window.__gapOn = true;
    const R = n.app.racers;
    const OFF = [-1.18, 0, 1.18];
    const gap = (a, b) => {
      let best = Infinity;
      for (const oa of OFF) {
        const ax = a.x + Math.sin(a.h) * oa, az = a.z + Math.cos(a.h) * oa;
        for (const ob of OFF) {
          const bx = b.x + Math.sin(b.h) * ob, bz = b.z + Math.cos(b.h) * ob;
          best = Math.min(best, Math.hypot(bx - ax, bz - az) - 1.94);
        }
      }
      return best;
    };
    const tick = () => {
      if (!window.__gapOn) return;
      for (let i = 0; i < R.length; i++) {
        for (let j = i + 1; j < R.length; j++) window.__minGap = Math.min(window.__minGap, gap(R[i].car, R[j].car));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    // 부딪힌 바로 그 프레임에서 멈춰 세운다 (스파크가 살아 있는 순간을 화면에 남기려고)
    window.__baseline = n.app.collisionCount;
    window.__autoPause = true;
    const watch = () => {
      if (!window.__autoPause) return;
      if (n.app.collisionCount > window.__baseline) { n.app.phase = 'paused'; window.__autoPause = false; return; }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    return { collisionCount: n.app.collisionCount };
  });

  let hitShot = false;
  for (let i = 0; i < 50; i++) {
    await sleep(70);
    const st = await stateOf(page);
    if (st.collisionCount > setup.collisionCount) {
      if (!hitShot) {
        // 멈춘 프레임을 두 번 그려 카메라/스파크가 반영된 화면을 저장한 뒤 다시 달린다
        await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
        await sleep(120);
        await shot(page, 'm15-car-collision.png');
        hitShot = true;
      }
      await page.evaluate(() => { window.__neon.app.phase = 'racing'; });
      if (i > 14) break;
    }
  }
  await page.evaluate(() => { window.__neon.app.phase = 'racing'; });
  const gapRes = await page.evaluate(() => {
    window.__gapOn = false;
    return { minGap: window.__minGap, count: window.__neon.app.collisionCount };
  });
  const afterHit = await stateOf(page);
  ok('달리는 차끼리 부딪힌다 (추돌)', gapRes.count > setup.collisionCount, gapRes);
  ok('부딪히는 순간 스크린샷 저장', hitShot && fs.existsSync(path.join(SHOTS, 'm15-car-collision.png')));
  ok('부딪혀도 서로 뚫고 지나가지 않는다', gapRes.minGap > -0.4, gapRes.minGap);
  ok('충돌 후에도 멈추지 않고 달린다', afterHit.kmh > 3, afterHit.kmh);
  console.log('    · 충돌 ' + (gapRes.count - setup.collisionCount) + '회, 최소 틈 ' + gapRes.minGap.toFixed(2) + 'm');
}

/* ------------------------------ 6. HUD 겹침 ------------------------------ */
section('HUD 레이아웃 · 겹침 0 (390×844)');
const layout = await hudLayout(page);
ok('필수 HUD 요소 모두 존재', Object.keys(layout.rects).length >= 10, Object.keys(layout.rects));
ok('HUD 요소끼리 겹침 없음', layout.overlaps.length === 0, layout.overlaps);
ok('HUD 요소가 화면 밖으로 나가지 않음', layout.outside.length === 0, layout.outside);
ok('핸들 터치 영역 100px 이상', layout.rects.wheel.w >= 100 && layout.rects.wheel.h >= 100, { w: layout.rects.wheel.w.toFixed(0) });
ok('니트로 버튼 터치 영역 60px 이상', layout.rects.btnNitro.w >= 60, layout.rects.btnNitro.w.toFixed(0));
ok('순위표가 중앙 시야/버튼을 가리지 않음', layout.rects.board.x < layout.vw * 0.45 && layout.rects.board.bottom < layout.rects.wheel.y + 1, {
  board: fmtRect(layout.rects.board), wheel: fmtRect(layout.rects.wheel),
});
console.log('    · HUD rects: ' + Object.entries(layout.rects).map(([k, r]) => `${k}[${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}x${r.h.toFixed(0)}]`).join(' '));

/* ------------------------------ 7. 순위 갱신 ------------------------------ */
section('순위표 실시간 갱신');
// 순위를 앞뒤로 옮겨 순위표가 즉시 다시 그려지는지 확인 (랩 수로 진행도 조정)
await page.evaluate(() => {
  const n = window.__neon;
  const me = n.app.racers.find((r) => r.isMe);
  for (const r of n.app.racers) if (!r.isMe) r.prog.lap = 0;
  me.prog.lap = 1;              // 한 랩 앞선 것으로 → 1위
});
await sleep(900);
const firstRank = await stateOf(page);
ok('앞서면 순위표 1위로 갱신', firstRank.position === 1 && firstRank.board[0].me === true, { pos: firstRank.position, board: firstRank.board });
ok('상단 순위 표시도 1위', (await page.$eval('#posVal', (e) => e.textContent)) === '1');
await page.evaluate(() => {
  const n = window.__neon;
  const me = n.app.racers.find((r) => r.isMe);
  me.prog.lap = 0;
  for (const r of n.app.racers) if (!r.isMe) r.prog.lap = 1;   // AI 가 한 랩 앞서게 → 최하위
});
await sleep(900);
const afterRank = await stateOf(page);
ok('뒤처지면 순위 4위로 하락', afterRank.position === 4, { pos: afterRank.position, board: afterRank.board });
ok('순위표 내 행이 최하위로 갱신', afterRank.board[afterRank.board.length - 1].me === true, afterRank.board);
const posPill = await page.$eval('#posVal', (e) => e.textContent);
ok('상단 순위 표시도 갱신', posPill === String(afterRank.position), { pill: posPill, rank: afterRank.position });
ok('순위표 순서 유지(1~4)', afterRank.board.map((r) => r.rank).join(',') === '1,2,3,4', afterRank.board.map((r) => r.rank));
await page.evaluate(() => {
  const n = window.__neon;
  for (const r of n.app.racers) if (!r.isMe) r.prog.lap = 0;   // 원상 복구
});
await sleep(250);

/* ------------------------------ 8. 조작 좌우 반전 ------------------------------ */
section('조작 좌우 반전 토글 (핸들 ↔ 액션)');
const baseCtl = await controlLayout(page);
ok('기본 배치: 핸들이 왼쪽', baseCtl.r.steerPad.right <= baseCtl.r.actionPad.x + 1, { wheel: fmtRect(baseCtl.r.steerPad), action: fmtRect(baseCtl.r.actionPad) });
ok('기본 배치: 버튼 겹침 없음', baseCtl.overlaps.length === 0, baseCtl.overlaps);
ok('핸들·액션 패드 사이 간격 확보', baseCtl.r.steerPad.right <= baseCtl.r.actionPad.x - 4, { wheelRight: baseCtl.r.steerPad.right.toFixed(1), actionX: baseCtl.r.actionPad.x.toFixed(1) });
ok('기본 배치: 토글 OFF', baseCtl.flipped === false && (await stateOf(page)).flipControls === false);

await page.click('#btnPause');
await sleep(450);
ok('일시정지 화면 표시', await page.evaluate(() => !document.getElementById('pause').classList.contains('hidden')));
ok('일시정지 화면에 좌우 반전 토글', !!(await page.$('#handBtnPause')));
await page.click('#handBtnPause');
await sleep(450);
const flipCtl = await controlLayout(page);
ok('반전: 핸들이 오른쪽으로 이동', flipCtl.r.steerPad.x > baseCtl.r.steerPad.x + 100, { before: baseCtl.r.steerPad.x.toFixed(0), after: flipCtl.r.steerPad.x.toFixed(0) });
ok('반전: 액션 패드가 왼쪽으로 이동', flipCtl.r.actionPad.x < baseCtl.r.actionPad.x - 100, { before: baseCtl.r.actionPad.x.toFixed(0), after: flipCtl.r.actionPad.x.toFixed(0) });
ok('반전: x 좌표가 실제로 좌우 교체(거울 대칭)',
  isMirrored(baseCtl.r.steerPad, flipCtl.r.steerPad, baseCtl.vw) && isMirrored(baseCtl.r.actionPad, flipCtl.r.actionPad, baseCtl.vw),
  { wheelBase: fmtRect(baseCtl.r.steerPad), wheelFlip: fmtRect(flipCtl.r.steerPad) });
ok('반전: 버튼끼리 겹침 없음', flipCtl.overlaps.length === 0, flipCtl.overlaps);
ok('반전: 버튼이 화면 밖으로 나가지 않음', flipCtl.outside.length === 0, flipCtl.outside);
ok('반전: 핸들 크기 유지', Math.abs(flipCtl.r.wheel.w - baseCtl.r.wheel.w) < 1);
ok('반전: localStorage 저장', (await page.evaluate(() => localStorage.getItem('neon_ctrl_flip'))) === '1');
console.log('    · 기본: ' + ['steerPad', 'actionPad', 'wheel', 'btnNitro', 'btnBrake'].map((k) => `${k}=${fmtRect(baseCtl.r[k])}`).join(' '));
console.log('    · 반전: ' + ['steerPad', 'actionPad', 'wheel', 'btnNitro', 'btnBrake'].map((k) => `${k}=${fmtRect(flipCtl.r[k])}`).join(' '));

// 반전된 상태에서도 오른쪽 핸들 드래그가 조향으로 들어간다
await page.click('#btnResume');
await sleep(500);
ok('계속하기 후에도 반전 유지', (await stateOf(page)).flipControls === true && (await stateOf(page)).phase === 'racing');
const flipBefore = await stateOf(page);
await resetOnTrack(page);
const flipStart = await stateOf(page);
await dragWheelStart(page, 0);
await dragWheelTo(page, 0, 80);
await sleep(260);
const flipHeld = await stateOf(page);
await page.mouse.up();
ok('반전 후 오른쪽 핸들 드래그 조향', flipHeld.inputSteer > 0.45, flipHeld.inputSteer);
ok('반전 후에도 즉시 회전(화면 오른쪽)', wrapPi(flipHeld.h - flipStart.h) < -0.08, { dh: wrapPi(flipHeld.h - flipStart.h).toFixed(3) });
await waitPage(page, (s) => Math.abs(s.inputSteer) < 0.03, 2000);
await shot(page, 'm13-controls-flip-race.png');

await page.click('#btnPause');
await sleep(400);
await page.click('#handBtnPause');
await sleep(400);
const backCtl = await controlLayout(page);
ok('다시 누르면 기본 배치 복귀', !backCtl.flipped && Math.abs(backCtl.r.steerPad.x - baseCtl.r.steerPad.x) < 1, fmtRect(backCtl.r.steerPad));
ok('기본으로 되돌린 설정 저장', (await page.evaluate(() => localStorage.getItem('neon_ctrl_flip'))) === '0');
await page.click('#btnResume');
await sleep(400);
ok('기본 배치로 레이스 재개', (await stateOf(page)).phase === 'racing');

/* ------------------------------ 9. 3D 렌더 품질 ------------------------------ */
section('3D 렌더 · 픽셀 검사');
const cs = await canvasStats(page);
ok('캔버스가 검은 화면이 아님 (밝기)', cs.mean > 6, cs);
ok('캔버스 색 변화 충분 (std)', cs.std > 6, cs);
ok('네온 색상 다양성', cs.colors > 25, cs.colors);
ok('화면 최대 밝기 (네온 하이라이트)', cs.maxV > 180, cs.maxV);

/* ------------------------------ 10. 결과 화면 ------------------------------ */
section('경기 종료 · 결과 화면');
const finishInfo = await page.evaluate(async () => {
  const n = window.__neon;
  const me = n.app.racers.find((r) => r.isMe);
  const T = n.TRACK;
  let tt = n.app.simTime;
  me.prog.reset(T.total - 5, tt);
  let s = T.total - 5;
  for (let lap = 0; lap < 3; lap++) {
    for (let i = 0; i < 240; i++) {
      s += 6;
      tt += 0.22;                       // 실제 주행처럼 시간이 흐른다
      me.prog.update(s % T.total, tt);
      if (me.prog.finished) break;
    }
    if (me.prog.finished) break;
  }
  return { finished: me.prog.finished, lap: me.prog.lap, times: me.prog.lapTimes };
});
ok('3랩 완주 판정', finishInfo.finished === true, finishInfo);
ok('랩타임 3개 기록', finishInfo.times.length === 3, finishInfo.times);
await page.evaluate(() => { window.__neon.app.phase = 'racing'; });
await sleep(2200);
const resShown = await page.evaluate(() => !document.getElementById('results').classList.contains('hidden'));
ok('결과 화면 표시', resShown);
if (resShown) {
  const rows = await page.$$eval('#resultTable tr', (trs) => trs.length);
  ok('결과 순위표 4행 이상', rows >= 5, rows);
  const sub = await page.$eval('#resultSub', (e) => e.textContent.trim());
  ok('결과 요약(우승/내 순위)', /우승/.test(sub), sub);
  const medals = await page.$$eval('#resultTable .rk', (tds) => tds.map((t) => t.className));
  ok('1위 금색 표시', /gold/.test(medals[0]), medals);
  await shot(page, 'm07-results.png');
}
ok('결과 화면에 순위표 유지', await page.evaluate(() => /순위/.test(document.getElementById('resultTable').innerText)));
await page.close();

/* ------------------------------ 11. 가로 모드 ------------------------------ */
section('가로 모드 (844×390)');
const land = await newPage({ width: 844, height: 390 });
await land.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await land.waitForFunction(() => window.__neon && window.__neon.state(), { timeout: 90000 });
await sleep(1500);
ok('메뉴에 조작 좌우 반전 토글', !!(await land.$('#handBtn')));
ok('메뉴 토글 기본 라벨(왼쪽 핸들)', /왼쪽 핸들/.test(await land.$eval('#handBtn b', (e) => e.textContent)));
await land.click('#handBtn');
await sleep(350);
ok('메뉴 토글로 HUD 반전 적용', await land.evaluate(() => document.getElementById('hud').classList.contains('flip')));
ok('메뉴 토글 라벨 ON(오른쪽 핸들)', /오른쪽 핸들/.test(await land.$eval('#handBtn b', (e) => e.textContent)));
await land.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
await land.waitForFunction(() => window.__neon && window.__neon.state(), { timeout: 90000 });
await sleep(1600);
ok('새로고침 후 반전 유지(클래스)', await land.evaluate(() => document.getElementById('hud').classList.contains('flip')));
ok('새로고침 후 설정 복원', (await stateOf(land)).flipControls === true);
await shot(land, 'm08a-menu-flip.png');

await land.click('#btnSolo');
await waitState(land, (s) => s.phase === 'racing', 14000, 'landscape race');
await sleep(900);
const landFlip = await controlLayout(land);
ok('가로 반전: 핸들이 오른쪽', landFlip.r.steerPad.x > landFlip.r.actionPad.x, { wheel: fmtRect(landFlip.r.steerPad), action: fmtRect(landFlip.r.actionPad) });
ok('가로 반전: 버튼 겹침 없음', landFlip.overlaps.length === 0, landFlip.overlaps);
ok('가로 반전: 버튼이 화면 안', landFlip.outside.length === 0, landFlip.outside);
ok('가로 핸들 크기 90px 이상', landFlip.r.wheel.w >= 90, landFlip.r.wheel.w.toFixed(1));
await shot(land, 'm08b-landscape-flip.png');

await land.evaluate(() => document.getElementById('btnPause').click());
await sleep(400);
await land.evaluate(() => document.getElementById('handBtnPause').click());
await sleep(400);
ok('가로: 기본 배치로 복귀', (await controlLayout(land)).flipped === false);
await land.evaluate(() => document.getElementById('btnResume').click());
await sleep(600);
const landLayout = await hudLayout(land);
ok('가로 순위표 표시', !!landLayout.rects.board && landLayout.rects.board.w > 100, landLayout.rects.board);
ok('가로 HUD 겹침 없음 (순위표 포함)', landLayout.overlaps.length === 0, landLayout.overlaps);
ok('가로 HUD 화면 내', landLayout.outside.length === 0, landLayout.outside);
ok('가로 순위표가 버튼을 가리지 않음', landLayout.rects.board.bottom < landLayout.rects.wheel.y + 1, { board: fmtRect(landLayout.rects.board), wheel: fmtRect(landLayout.rects.wheel) });
// 가로에서도 핸들 드래그 조향
const landBefore = await stateOf(land);
await resetOnTrack(land);
const landStart = await stateOf(land);
await dragWheelStart(land, 0);
await dragWheelTo(land, 0, 85);
await sleep(260);
const landHeld = await stateOf(land);
await land.mouse.up();
ok('가로 핸들 드래그 조향', landHeld.inputSteer > 0.45, landHeld.inputSteer);
ok('가로 핸들 조향 즉시 회전(화면 오른쪽)', wrapPi(landHeld.h - landStart.h) < -0.06, wrapPi(landHeld.h - landStart.h).toFixed(3));
await waitPage(land, (s) => Math.abs(s.inputSteer) < 0.03, 2000);
await sleep(400);
await shot(land, 'm08-landscape.png');
await shot(land, 'shot-landscape-leaderboard.png');

// 가로에서도 자동 가속 OFF → GAS 페달이 겹침 없이 들어간다
await land.evaluate(() => { const n = window.__neon; n.app.autoAccel = false; n.applyAutoAccel(); });
await sleep(350);
const landGas = await controlLayout(land);
const landGasShown = await land.evaluate(() => {
  const g = document.getElementById('btnGas');
  const r = g.getBoundingClientRect();
  return { shown: getComputedStyle(g).display !== 'none', w: r.width, h: r.height };
});
ok('가로: 자동 가속 OFF에 GAS 페달 표시', landGasShown.shown && landGasShown.w >= 40 && landGasShown.h >= 60, landGasShown);
ok('가로: GAS 포함 버튼 겹침 없음', landGas.overlaps.length === 0, landGas.overlaps);
ok('가로: GAS 포함 버튼이 화면 안', landGas.outside.length === 0, landGas.outside);
await shot(land, 'm19-landscape-gas.png');
await land.close();

/* ------------------------------ 12. 자동 가속 OFF · GAS 페달 ------------------------------ */
section('자동 가속 OFF · GAS 가속 페달 (390×844)');
const manual = await newPage();
await manual.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await manual.waitForFunction(() => window.__neon && window.__neon.state(), { timeout: 90000 });
await sleep(1600);
ok('자동 가속 기본 ON', (await stateOf(manual)).autoAccel === true);
ok('자동 가속 ON일 때 GAS 페달 숨김', await manual.evaluate(() => getComputedStyle(document.getElementById('btnGas')).display === 'none'));
await manual.click('#autoAccelBtn');
const autoOff = await manual.waitForFunction(() => window.__neon.app.autoAccel === false, { timeout: 10000 }).then(() => true).catch(() => false);
ok('자동 가속 OFF 토글', autoOff);
ok('메뉴 조작 안내에 GAS 표시', /GAS/.test(await manual.$eval('#footHint', (e) => e.textContent)));
await manual.click('#btnSolo');
await waitState(manual, (s) => s.phase === 'racing', 14000, 'manual race');
await sleep(2500);
const idle = await stateOf(manual);
ok('자동 가속 OFF: GAS 없이는 출발하지 않음', idle.kmh < 3, idle.kmh);
const gasShown = await manual.evaluate(() => {
  const g = document.getElementById('btnGas');
  const r = g.getBoundingClientRect();
  return { shown: getComputedStyle(g).display !== 'none', w: r.width, h: r.height, label: g.textContent.trim() };
});
ok('자동 가속 OFF: GAS 페달 표시', gasShown.shown && gasShown.w >= 44 && gasShown.h >= 60, gasShown);
ok('GAS 버튼 라벨', /GAS/.test(gasShown.label) && /가속/.test(gasShown.label), gasShown.label);
await shot(manual, 'm17-autogas-off-gas.png');

const manualCtl = await controlLayout(manual);
ok('GAS 포함 배치: 버튼끼리 겹침 없음', manualCtl.overlaps.length === 0, manualCtl.overlaps);
ok('GAS 포함 배치: 버튼이 화면 밖으로 나가지 않음', manualCtl.outside.length === 0, manualCtl.outside);
ok('GAS 페달과 핸들 사이 간격 확보', manualCtl.r.wheel.right <= manualCtl.r.btnGas.x - 4, { wheelRight: manualCtl.r.wheel.right.toFixed(1), gasX: manualCtl.r.btnGas.x.toFixed(1) });
console.log('    · GAS 배치: ' + ['wheel', 'btnGas', 'btnBrake', 'btnNitro'].map((k) => `${k}=${fmtRect(manualCtl.r[k])}`).join(' '));

/* 정지 상태(차가 가장 크고 낮게 그려지는 순간)에서도 차가 HUD에 가리지 않는다 */
const stopClear = await manual.evaluate(() => {
  const n = window.__neon;
  const box = n.carScreenBox();
  const ids = { wheel: 'wheel', gas: 'btnGas', brake: 'btnBrake', nitro: 'btnNitro', gauge: 'gaugeWrap' };
  const rects = {};
  for (const [k, id] of Object.entries(ids)) {
    const r = document.getElementById(id).getBoundingClientRect();
    rects[k] = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  const car = { left: box.x, top: box.y, right: box.right, bottom: box.bottom };
  const inter = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
  const rowTop = Math.min(rects.wheel.top, rects.brake.top, rects.nitro.top);
  return { car, hits: Object.entries(rects).filter(([, r]) => inter(car, r)).map(([k]) => k), gap: Math.round(rowTop - car.bottom) };
});
ok('정지 상태에서도 차가 하단 HUD에 안 가림', stopClear.hits.length === 0, stopClear);
ok('정지 상태 차와 하단 조작부 사이 여유 (12px 이상)', stopClear.gap >= 12, stopClear.gap);

/* GAS 페달 홀드 → 실제 가속 */
const gb = await (await manual.$('#btnGas')).boundingBox();
await manual.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
await manual.mouse.down();
const accel = await waitPage(manual, (s) => s.kmh > 15, 14000);
ok('GAS 페달을 누르면 가속', accel.kmh > 15, accel.kmh);
ok('GAS 누르는 동안 스로틀 1', accel.input.throttle === 1 && accel.input.gas === 1, accel.input);
await shot(manual, 'm18-gas-accel.png');
await manual.mouse.up();
await sleep(400);
const coastA = await stateOf(manual);
await sleep(1500);
const coastB = await stateOf(manual);
ok('GAS를 떼면 더 가속하지 않음', coastB.kmh <= coastA.kmh + 2, { a: coastA.kmh, b: coastB.kmh });
ok('GAS를 떼면 눌림 해제', coastB.input.gas === 0, coastB.input);

/* 좌우 반전에서도 GAS가 겹치지 않는다 */
await manual.evaluate(() => document.getElementById('btnPause').click());
await sleep(400);
await manual.evaluate(() => document.getElementById('handBtnPause').click());
await sleep(450);
const mFlip = await controlLayout(manual);
ok('반전+GAS: 버튼 겹침 없음', mFlip.overlaps.length === 0, mFlip.overlaps);
ok('반전+GAS: 버튼이 화면 안', mFlip.outside.length === 0, mFlip.outside);
ok('반전+GAS: GAS가 핸들 반대쪽', mFlip.r.btnGas.right < mFlip.r.wheel.x + 1, { gas: fmtRect(mFlip.r.btnGas), wheel: fmtRect(mFlip.r.wheel) });
await shot(manual, 'm20-flip-gas.png');
await manual.evaluate(() => document.getElementById('handBtnPause').click());
await sleep(350);
await manual.evaluate(() => document.getElementById('btnResume').click());
await sleep(350);

/* 자동 가속을 다시 켜면 GAS는 사라진다 */
const gasHiddenAgain = await manual.evaluate(() => {
  const n = window.__neon;
  n.app.autoAccel = true;
  n.applyAutoAccel();
  return getComputedStyle(document.getElementById('btnGas')).display === 'none' && !document.getElementById('hud').classList.contains('manual');
});
ok('자동 가속 다시 ON → GAS 페달 숨김', gasHiddenAgain);
await manual.close();

/* ------------------------------ 13. 친구 대결 (호스트=Node WS · 게스트=브라우저) ------------------------------
   이 환경에서는 브라우저 두 개를 동시에 띄울 수 없고, 같은 브라우저의 숨은 탭은 rAF 가 멈춘다.
   그래서 호스트는 ws 클라이언트로 방을 만들고 주행을 보내고, 게스트는 실제 브라우저 화면으로 검증한다. */
const hostWs = await new WsClient().open(`ws://127.0.0.1:${PORT}/ws`);
hostWs.send({ type: 'create', name: '한윤', car: 'gt', color: '#37f3ff' });
const room = await hostWs.waitFor('room');
const code = room.code;
ok('방 코드 발급', /^[A-Z0-9]{4}$/.test(code), code);

const guest = await newPage();
await guest.goto(`${BASE}/?room=${code}&name=${encodeURIComponent('정원영')}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await guest.waitForFunction(() => {
  const el = document.getElementById('roomCode');
  return el && /^[A-Z0-9]{4}$/.test(el.textContent.trim());
}, { timeout: 60000 });
await sleep(900);
const guestCode = await guest.evaluate(() => (document.getElementById('roomCode') || {}).textContent);
ok('초대 링크로 게스트 참가 · 같은 방 코드', (guestCode || '').trim() === code, guestCode);
const guestList = await guest.evaluate(() => [...document.querySelectorAll('#playerList li')].map((li) => li.textContent.trim()));
ok('로비 목록에 2명', guestList.length === 2, guestList);
await shot(guest, 'm09-lobby.png');

hostWs.send({ type: 'start' });
await hostWs.waitFor('countdown', 5000);
await guest.waitForFunction(() => !document.getElementById('countdown').classList.contains('hidden'), { timeout: 8000 });
ok('카운트다운 표시', true);
await shot(guest, 'm10-multi-countdown.png');
const gs = await waitState(guest, (s) => s.phase === 'racing' && s.racers >= 2, 16000, 'guest race');
ok('레이스 시작 · 레이서 2명', gs.racers >= 2, gs.racers);
ok('동일 방 코드 유지', gs.roomCode === code, gs.roomCode);
const guestId = gs.netId;
ok('게스트가 2인 순위표 표시', gs.board.length === 2, gs.board);

// 호스트 주행: 트랙을 따라 24m/s 로 달리며 pos 전송
let hostS = TRACK.total - 14;
const drive = (async () => {
  for (let i = 0; i < 90; i++) {
    hostS += 24 * 0.09;
    const p = sample(TRACK, hostS % TRACK.total, 0);
    hostWs.send({ type: 'pos', x: p.x, z: p.z, h: p.heading, speed: 24, boost: false });
    await sleep(90);
  }
})();

await sleep(1600);
const guestBefore = await stateOf(guest);
await sleep(3200);
const guestAfter = await stateOf(guest);
const hostCarB = guestAfter.racerList.find((r) => !r.isMe);
const hostCarA = guestBefore.racerList.find((r) => !r.isMe);
const moved = hostCarA && hostCarB && Math.hypot(hostCarB.x - hostCarA.x, hostCarB.z - hostCarA.z) > 1.0;
ok('게스트 화면에서 상대 차량이 실시간 이동', !!moved, { before: hostCarA, after: hostCarB });
ok('게스트도 자기 차량 주행', guestAfter.kmh > 3, guestAfter.kmh);
ok('멀티 순위표가 내 차량 강조', guestAfter.board.some((r) => r.me), guestAfter.board);

// 호스트(서버)가 받은 게스트 위치도 움직인다
const states = hostWs.history.filter((m) => m.type === 'state');
const guestPos = states.map((m) => m.players.find((p) => p.id === guestId)).filter(Boolean);
const gFirst = guestPos[0], gLast = guestPos[guestPos.length - 1];
ok('서버가 게스트 위치를 수신', guestPos.length > 10, guestPos.length);
ok('게스트 위치가 서버에서 갱신', gFirst && gLast && Math.hypot(gLast.x - gFirst.x, gLast.z - gFirst.z) > 1.0, {
  first: gFirst && { x: gFirst.x, z: gFirst.z }, last: gLast && { x: gLast.x, z: gLast.z },
});
await drive;
await shot(guest, 'm12-multi-racing-guest.png');

hostWs.close();

/* ------------------------------ 14. 콘솔 오류 ------------------------------ */
section('콘솔 · 네트워크 오류');
const realErrors = errors.filter((e) => !/favicon|ERR_ABORTED/.test(e));
ok('콘솔 오류 0', realErrors.length === 0, realErrors.slice(0, 6));
const perf = await guest.evaluate(() => {
  const r = window.__neon.renderer;
  return { calls: r.info.render.calls, tris: r.info.render.triangles, textures: r.info.memory.textures, geos: r.info.memory.geometries };
});
ok('렌더 부하 적정 (draw calls < 260)', perf.calls < 260, perf);
console.log('    · render: ' + JSON.stringify(perf));

await browser.close();
stop();
console.log(`\n=== 결과: ${pass} 통과 / ${fail} 실패 ===`);
if (fail) { console.log('실패: ' + fails.join(', ')); process.exit(1); }
process.exit(0);
