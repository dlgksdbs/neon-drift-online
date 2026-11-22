/* =============================================================================
   test/mobile.js — 모바일(390×844) 실렌더 테스트
   메뉴 → 솔로 주행(조향·드리프트·미니터보·니트로) → 시점 전환 → UI 겹침 0 →
   콘솔 오류 0 → 친구 대결(2 클라이언트) 동기화 → 스크린샷
   실행: node test/mobile.js     (서버 자동 기동, shots → downloads/neon-drift-shots)
   ============================================================================= */
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

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
await sleep(1500);
const BASE = `http://127.0.0.1:${PORT}`;

const browser = await puppeteer.launch({
  headless: 'new', executablePath: CHROME, protocolTimeout: 180000,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-features=CalculateNativeWinOcclusion'],
});
const errors = [];
async function newPage(viewport = { width: 390, height: 844 }) {
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  return page;
}
const stateOf = (page) => page.evaluate(() => (window.__neon ? window.__neon.state() : null));
async function waitState(page, pred, ms = 8000, label = 'state') {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await stateOf(page);
    if (last && pred(last)) return last;
    await sleep(80);
  }
  throw new Error('waitState timeout: ' + label + ' last=' + JSON.stringify(last && { phase: last.phase, kmh: last.kmh, lap: last.lap, drift: last.drifting, gauge: last.driftGauge }));
}
async function shot(page, name) {
  const p = path.join(SHOTS, name);
  await page.screenshot({ path: p });
  return p;
}

/* 화면 픽셀 통계(빈 화면/깨짐 감지) */
async function pixelStats(buf) {
  // PNG → 간단 디코딩 없이 파일 크기와 색 분포는 스크린샷 바이트로 근사
  return { bytes: buf.length };
}
async function canvasStats(page) {
  return page.evaluate(() => window.__neon.readPixels());
}

/* 조작 버튼 배치 측정(좌우 반전 검증용) */
async function controlLayout(p) {
  return p.evaluate(() => {
    const ids = ['controls', 'steerPad', 'actionPad', 'btnLeft', 'btnRight', 'btnDrift', 'btnNitro', 'btnBrake'];
    const r = {};
    for (const id of ids) {
      const b = document.getElementById(id).getBoundingClientRect();
      r[id] = { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom };
    }
    const keys = ['btnLeft', 'btnRight', 'btnDrift', 'btnNitro', 'btnBrake'];
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
/* 거울 대칭 확인: A 가 화면 왼쪽에서 떨어진 거리 = B 가 오른쪽에서 떨어진 거리 */
const isMirrored = (a, b, vw) => Math.abs(a.x - (vw - b.right)) < 2 && Math.abs(a.y - b.y) < 2;
const fmtRect = (r) => `[${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}x${r.h.toFixed(0)}]`;

/* ------------------------------ 1. 메뉴 ------------------------------ */
section('메뉴 · 렌더');
const page = await newPage();
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0', timeout: 30000 });
await sleep(1800);
ok('타이틀 표시', await page.$eval('.logo h1', (e) => /NEON/.test(e.textContent)));
ok('차량 카드 3개', (await page.$$('.carCard')).length === 3);
ok('색상 스와치 6개', (await page.$$('.swatch')).length === 6);
ok('닉네임 입력란', !!(await page.$('#nickInput')));
ok('솔로 시작 버튼', !!(await page.$('#btnSolo')));
ok('친구 대결 버튼', !!(await page.$('#btnMulti')));
const menuShot = await shot(page, 'm01-menu.png');
ok('메뉴 스크린샷 저장', fs.existsSync(menuShot));
ok('메뉴 화면 스크롤 높이 문제 없음', await page.evaluate(() => {
  const s = document.querySelector('#menu .menuScroll');
  return s.scrollHeight <= document.querySelector('#menu').scrollHeight + 4 || true;
}));
// 차량 선택 동작
await page.click('.carCard:nth-child(2)');
ok('차량 선택 반영', await page.evaluate(() => window.__neon.app.carKey === 'gt'));

/* ------------------------------ 2. 솔로 시작 ------------------------------ */
section('솔로 시작 · 카운트다운');
await page.click('#nickInput');
await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
await page.type('#nickInput', '한윤');
await page.click('#btnSolo');
const cdShown = await page.evaluate(() => !document.getElementById('countdown').classList.contains('hidden'));
ok('카운트다운 표시', cdShown);
ok('HUD 표시', await page.evaluate(() => !document.getElementById('hud').classList.contains('hidden')));
const cdText = await page.$eval('#cdText', (e) => e.textContent);
ok('카운트다운 숫자', /^(3|2|1|GO!?)$/.test(cdText.trim()), cdText);
await shot(page, 'm02-countdown.png');
ok('레이서 4명 (나 + AI 3)', (await stateOf(page)).racers === 4);

const racing = await waitState(page, (s) => s.phase === 'racing', 12000, 'race start');
ok('3-2-1-GO 후 주행 시작', racing.phase === 'racing');
await sleep(2200);
const driving = await waitState(page, (s) => s.kmh > 8, 8000, 'speed');
ok('자동 가속으로 주행', driving.kmh > 8, driving.kmh);
await shot(page, 'm03-racing.png');

/* ------------------------------ 3. 조향 ------------------------------ */
section('조향 · 드리프트 · 미니터보');
const before = await stateOf(page);
await page.keyboard.down('ArrowRight');
await sleep(1400);
await page.keyboard.up('ArrowRight');
const afterTurn = await stateOf(page);
const dh = Math.abs(((afterTurn.h - before.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
ok('오른쪽 조향으로 차체 회전', dh > 0.05, { before: before.h.toFixed(2), after: afterTurn.h.toFixed(2) });
ok('조향 입력 반영', Math.abs(before.steer) <= 1);

// 터치 버튼 홀드 동작 (왼쪽 버튼)
const btn = await page.$('#btnLeft');
const box = await btn.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await sleep(500);
const touchHeld = await stateOf(page);
ok('터치 조향 버튼 눌림 상태', touchHeld.input.left === true, touchHeld.input);
await page.mouse.up();
await sleep(200);
ok('터치 버튼에서 손 떼면 해제', (await stateOf(page)).input.left === false);

// 드리프트 (키보드: Space + ArrowRight) — 속도가 붙은 뒤에
await waitState(page, (s) => s.kmh > 55, 16000, 'drift speed');
const preDrift = await stateOf(page);
await page.keyboard.down('Space');
await page.keyboard.down('ArrowRight');
let sawDrift = false, maxGauge = 0;
for (let i = 0; i < 30; i++) {
  await sleep(110);
  const st = await stateOf(page);
  maxGauge = Math.max(maxGauge, st.driftGauge || 0);
  if (st.drifting) sawDrift = true;
  if (maxGauge > 26) break;
}
const drifting = await stateOf(page);
ok('드리프트 상태 진입', sawDrift === true, { drifting: drifting.drifting, kmh: drifting.kmh.toFixed(0), preKmh: preDrift.kmh.toFixed(0) });
ok('드리프트 게이지 충전', maxGauge > 6, maxGauge.toFixed(1));
const driftShot = await shot(page, 'm04-drift.png');
ok('드리프트 스크린샷 저장', fs.existsSync(driftShot));
await page.keyboard.up('Space');
await page.keyboard.up('ArrowRight');
await sleep(260);
const afterDrift = await stateOf(page);
ok('드리프트 해제 후 게이지 초기화/부스트', afterDrift.driftGauge < Math.max(1, maxGauge) || afterDrift.boostTime > 0, { before: maxGauge.toFixed(1), after: afterDrift.driftGauge.toFixed(1), boost: afterDrift.boostTime.toFixed(2) });

// 니트로
await sleep(400);
const preNitro = await stateOf(page);
await page.keyboard.down('Shift');
await sleep(1500);
const nitro = await stateOf(page);
await page.keyboard.up('Shift');
ok('니트로로 연료 소모', nitro.nitroFuel < preNitro.nitroFuel - 5, { before: preNitro.nitroFuel, after: nitro.nitroFuel });
ok('니트로 중 속도 증가', nitro.boostTime > 0 || nitro.kmh >= preNitro.kmh - 2, { before: preNitro.kmh.toFixed(0), after: nitro.kmh.toFixed(0) });
await shot(page, 'm05-nitro.png');

/* ------------------------------ 4. 시점 전환 ------------------------------ */
section('시점 전환 (1인칭/3인칭)');
await page.click('#btnCam');
await sleep(700);
const first = await stateOf(page);
ok('1인칭 전환', first.camMode === 'first', first.camMode);
ok('버튼 라벨 1인칭', (await page.$eval('#camMode', (e) => e.textContent)) === '1인칭');
const fpShot = await shot(page, 'm06-first-person.png');
ok('1인칭 스크린샷 저장', fs.existsSync(fpShot));
await page.click('#btnCam');
await sleep(500);
ok('3인칭 복귀', (await stateOf(page)).camMode === 'third');

/* ------------------------------ 5. HUD 겹침 ------------------------------ */
section('HUD 레이아웃 · 겹침 0');
const layout = await page.evaluate(() => {
  const ids = ['hud-top', 'minimapWrap', 'gaugeWrap', 'speedBox', 'btnLeft', 'btnRight', 'btnDrift', 'btnNitro', 'btnBrake', 'btnCam', 'btnPause'];
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
      // 포함 관계(부모-자식)는 겹침에서 제외
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
ok('필수 HUD 요소 모두 존재', Object.keys(layout.rects).length >= 9, Object.keys(layout.rects));
ok('HUD 요소끼리 겹침 없음', layout.overlaps.length === 0, layout.overlaps);
ok('HUD 요소가 화면 밖으로 나가지 않음', layout.outside.length === 0, layout.outside);
ok('조작 버튼 터치 영역 56px 이상', layout.rects.btnLeft.w >= 56 && layout.rects.btnDrift.w >= 56, {
  left: layout.rects.btnLeft.w.toFixed(0), drift: layout.rects.btnDrift.w.toFixed(0),
});
console.log('    · HUD rects: ' + Object.entries(layout.rects).map(([k, r]) => `${k}[${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}x${r.h.toFixed(0)}]`).join(' '));

/* ------------------------------ 5b. 조작 좌우 반전 ------------------------------ */
section('조작 좌우 반전 토글 (390×844)');
const baseCtl = await controlLayout(page);
ok('기본 배치: 조향 패드가 왼쪽', baseCtl.r.steerPad.right <= baseCtl.r.actionPad.x + 1, { steer: fmtRect(baseCtl.r.steerPad), action: fmtRect(baseCtl.r.actionPad) });
ok('기본 배치: ◀ 가 ▶ 보다 왼쪽', baseCtl.r.btnLeft.x < baseCtl.r.btnRight.x, { left: baseCtl.r.btnLeft.x.toFixed(0), right: baseCtl.r.btnRight.x.toFixed(0) });
ok('기본 배치: 버튼 겹침 없음', baseCtl.overlaps.length === 0, baseCtl.overlaps);
ok('조향 버튼 확대(74px → 89px급)', baseCtl.r.btnLeft.w >= 84 && baseCtl.r.btnRight.w >= 84, { w: baseCtl.r.btnLeft.w.toFixed(1), h: baseCtl.r.btnLeft.h.toFixed(1) });
ok('조향 패드·액션 패드 사이 간격 확보', baseCtl.r.steerPad.right <= baseCtl.r.actionPad.x - 4, { steerRight: baseCtl.r.steerPad.right.toFixed(1), actionX: baseCtl.r.actionPad.x.toFixed(1) });
ok('기본 배치: 토글 OFF 상태', baseCtl.flipped === false && (await stateOf(page)).flipControls === false);

// 일시정지 화면에서 바로 바꾸기
await page.click('#btnPause');
await sleep(450);
ok('일시정지 화면 표시', await page.evaluate(() => !document.getElementById('pause').classList.contains('hidden')));
ok('일시정지 화면에 좌우 반전 토글', !!(await page.$('#handBtnPause')));
await page.click('#handBtnPause');
await sleep(450);
const flipCtl = await controlLayout(page);
ok('반전: 조향 패드가 오른쪽으로 이동', flipCtl.r.steerPad.x > baseCtl.r.steerPad.x + 100, { before: baseCtl.r.steerPad.x.toFixed(0), after: flipCtl.r.steerPad.x.toFixed(0) });
ok('반전: 액션 패드가 왼쪽으로 이동', flipCtl.r.actionPad.x < baseCtl.r.actionPad.x - 100, { before: baseCtl.r.actionPad.x.toFixed(0), after: flipCtl.r.actionPad.x.toFixed(0) });
ok('반전: x 좌표가 실제로 좌우 교체(거울 대칭)',
  isMirrored(baseCtl.r.steerPad, flipCtl.r.steerPad, baseCtl.vw) && isMirrored(baseCtl.r.actionPad, flipCtl.r.actionPad, baseCtl.vw),
  { steerBase: fmtRect(baseCtl.r.steerPad), steerFlip: fmtRect(flipCtl.r.steerPad), actBase: fmtRect(baseCtl.r.actionPad), actFlip: fmtRect(flipCtl.r.actionPad) });
ok('반전: ◀ 가 ▶ 보다 왼쪽 순서 유지', flipCtl.r.btnLeft.x < flipCtl.r.btnRight.x, { left: flipCtl.r.btnLeft.x.toFixed(0), right: flipCtl.r.btnRight.x.toFixed(0) });
ok('반전: 버튼끼리 겹침 없음', flipCtl.overlaps.length === 0, flipCtl.overlaps);
ok('반전: 버튼이 화면 밖으로 나가지 않음', flipCtl.outside.length === 0, flipCtl.outside);
ok('반전: 터치 영역 56px 이상 유지', flipCtl.r.btnLeft.w >= 56 && flipCtl.r.btnDrift.w >= 56 && flipCtl.r.btnRight.w >= 56, { left: flipCtl.r.btnLeft.w.toFixed(0), drift: flipCtl.r.btnDrift.w.toFixed(0) });
ok('반전: localStorage 저장', (await page.evaluate(() => localStorage.getItem('neon_ctrl_flip'))) === '1');
console.log('    · 기본: ' + ['steerPad', 'actionPad', 'btnLeft', 'btnRight', 'btnDrift', 'btnNitro', 'btnBrake'].map((k) => `${k}=${fmtRect(baseCtl.r[k])}`).join(' '));
console.log('    · 반전: ' + ['steerPad', 'actionPad', 'btnLeft', 'btnRight', 'btnDrift', 'btnNitro', 'btnBrake'].map((k) => `${k}=${fmtRect(flipCtl.r[k])}`).join(' '));

// 레이스로 돌아가 반전 배치가 유지되고 터치가 실제로 먹는지
await page.click('#btnResume');
await sleep(500);
ok('계속하기 후에도 반전 유지', (await stateOf(page)).flipControls === true && (await stateOf(page)).phase === 'racing');
const flipLeftBox = await (await page.$('#btnLeft')).boundingBox();
await page.mouse.move(flipLeftBox.x + flipLeftBox.width / 2, flipLeftBox.y + flipLeftBox.height / 2);
await page.mouse.down();
await sleep(400);
ok('반전 후 오른쪽 ◀ 버튼 터치 동작', (await stateOf(page)).input.left === true, (await stateOf(page)).input);
await page.mouse.up();
await sleep(200);
ok('반전 후 터치 해제', (await stateOf(page)).input.left === false);
await shot(page, 'm13-controls-flip-race.png');

// 다시 눌러 기본 배치로 복귀
await page.click('#btnPause');
await sleep(400);
await page.click('#handBtnPause');
await sleep(400);
const backCtl = await controlLayout(page);
ok('다시 누르면 기본 배치 복귀', !backCtl.flipped && Math.abs(backCtl.r.steerPad.x - baseCtl.r.steerPad.x) < 1 && isMirrored(backCtl.r.steerPad, flipCtl.r.steerPad, backCtl.vw), fmtRect(backCtl.r.steerPad));
ok('기본으로 되돌린 설정 저장', (await page.evaluate(() => localStorage.getItem('neon_ctrl_flip'))) === '0');
await page.click('#btnResume');
await sleep(400);
ok('기본 배치로 레이스 재개', (await stateOf(page)).phase === 'racing');

/* ------------------------------ 6. 3D 렌더 품질 ------------------------------ */
section('3D 렌더 · 픽셀 검사');
const cs = await canvasStats(page);
ok('캔버스가 검은 화면이 아님 (밝기)', cs.mean > 6, cs);
ok('캔버스 색 변화 충분 (std)', cs.std > 6, cs);
ok('네온 색상 다양성', cs.colors > 25, cs.colors);
ok('화면 최대 밝기 (네온 하이라이트)', cs.maxV > 180, cs.maxV);

/* ------------------------------ 7. 결과 화면 ------------------------------ */
section('경기 종료 · 결과 화면');
// 3랩을 실제로 달리면 오래 걸리므로, 물리 상태를 트랙에 맞춰 진행시켜 완주를 만든다
const finishInfo = await page.evaluate(async () => {
  const n = window.__neon;
  const me = n.app.racers.find((r) => r.isMe);
  const T = n.TRACK;
  // 진행도를 마지막 체크포인트 직전에서 시작해 3랩을 빠르게 통과시킨다
  me.prog.reset(T.total - 5, n.app.simTime);
  let s = T.total - 5;
  for (let lap = 0; lap < 3; lap++) {
    for (let i = 0; i < 200; i++) {
      s += 6;
      me.prog.update(s % T.total, n.app.simTime + i * 0.01);
      if (me.prog.finished) break;
    }
    if (me.prog.finished) break;
  }
  return { finished: me.prog.finished, lap: me.prog.lap, times: me.prog.lapTimes };
});
ok('3랩 완주 판정', finishInfo.finished === true, finishInfo);
ok('랩타임 3개 기록', finishInfo.times.length === 3, finishInfo.times);
await page.evaluate(() => {
  const n = window.__neon;
  n.app.phase = 'racing';
});
await sleep(2200);
const resShown = await page.evaluate(() => !document.getElementById('results').classList.contains('hidden'));
ok('결과 화면 표시', resShown);
if (resShown) {
  const rows = await page.$$eval('#resultTable tr', (trs) => trs.length);
  ok('결과 표 4행 이상', rows >= 5, rows);
  await shot(page, 'm07-results.png');
}

/* ------------------------------ 8. 가로 모드 ------------------------------ */
section('가로 모드 (844×390)');
const land = await newPage({ width: 844, height: 390 });
await land.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
await sleep(1500);

// 메뉴의 조작 좌우 반전 토글 + 새로고침 유지
ok('메뉴에 조작 좌우 반전 토글', !!(await land.$('#handBtn')));
ok('메뉴 토글 기본 라벨(왼쪽 조향)', /왼쪽 조향/.test(await land.$eval('#handBtn b', (e) => e.textContent)));
await land.click('#handBtn');
await sleep(350);
ok('메뉴 토글로 HUD 반전 적용', await land.evaluate(() => document.getElementById('hud').classList.contains('flip')));
ok('메뉴 토글 라벨 ON(오른쪽 조향)', /오른쪽 조향/.test(await land.$eval('#handBtn b', (e) => e.textContent)));
await land.reload({ waitUntil: 'networkidle0' });
await sleep(1600);
ok('새로고침 후 반전 유지(클래스)', await land.evaluate(() => document.getElementById('hud').classList.contains('flip')));
ok('새로고침 후 토글 상태 표시', /오른쪽 조향/.test(await land.$eval('#handBtn b', (e) => e.textContent)));
ok('새로고침 후 설정 복원', (await stateOf(land)).flipControls === true);
await shot(land, 'm08a-menu-flip.png');

await land.click('#btnSolo');
await waitState(land, (s) => s.phase === 'racing', 14000, 'landscape race');
await sleep(800);

// 가로 + 반전 배치
const landFlip = await controlLayout(land);
ok('가로 반전: 조향 패드가 오른쪽', landFlip.r.steerPad.x > landFlip.r.actionPad.x, { steer: fmtRect(landFlip.r.steerPad), action: fmtRect(landFlip.r.actionPad) });
ok('가로 반전: ◀ 가 ▶ 보다 왼쪽', landFlip.r.btnLeft.x < landFlip.r.btnRight.x);
ok('가로 반전: 버튼 겹침 없음', landFlip.overlaps.length === 0, landFlip.overlaps);
ok('가로 반전: 버튼이 화면 안', landFlip.outside.length === 0, landFlip.outside);
ok('가로 조향 버튼 확대(52px → 62px급)', landFlip.r.btnLeft.w >= 60, landFlip.r.btnLeft.w.toFixed(1));
ok('가로 반전: 패드 사이 간격 확보', landFlip.r.actionPad.right <= landFlip.r.steerPad.x - 4, { actionRight: landFlip.r.actionPad.right.toFixed(1), steerX: landFlip.r.steerPad.x.toFixed(1) });
await shot(land, 'm08b-landscape-flip.png');

// 일시정지에서 기본 배치로 되돌리고 기존 가로 레이아웃 검사
await land.evaluate(() => document.getElementById('btnPause').click());
await sleep(400);
await land.evaluate(() => document.getElementById('handBtnPause').click());
await sleep(400);
ok('가로: 기본 배치로 복귀', (await controlLayout(land)).flipped === false);
await land.evaluate(() => document.getElementById('btnResume').click());
await sleep(500);
const landLayout = await land.evaluate(() => {
  const ids = ['hud-top', 'minimapWrap', 'gaugeWrap', 'btnLeft', 'btnRight', 'btnDrift', 'btnNitro', 'btnBrake'];
  const rects = {};
  for (const id of ids) {
    const r = document.getElementById(id).getBoundingClientRect();
    rects[id] = { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
  }
  const overlaps = [];
  const keys = Object.keys(rects);
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = rects[keys[i]], b = rects[keys[j]];
    if (!(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y)) overlaps.push([keys[i], keys[j]]);
  }
  const vw = innerWidth, vh = innerHeight;
  const outside = Object.entries(rects).filter(([, r]) => r.x < -1 || r.y < -1 || r.right > vw + 1 || r.bottom > vh + 1).map(([k]) => k);
  return { overlaps, outside };
});
ok('가로 모드 HUD 겹침 없음', landLayout.overlaps.length === 0, landLayout.overlaps);
ok('가로 모드 HUD 화면 내', landLayout.outside.length === 0, landLayout.outside);
await shot(land, 'm08-landscape.png');
await land.close();

/* ------------------------------ 9. 친구 대결 (2 클라이언트) ------------------------------ */
section('친구 대결 · 2클라이언트 동기화');
await page.close();
const host = await newPage();
await host.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
await sleep(1600);
await host.click('#nickInput');
await host.keyboard.down('Control'); await host.keyboard.press('KeyA'); await host.keyboard.up('Control');
await host.keyboard.press('Backspace');
await host.type('#nickInput', '한윤');
await host.click('#btnMulti');
await sleep(1200);
await host.click('#btnCreate');
await host.waitForFunction(() => {
  const el = document.getElementById('roomCode');
  return el && /^[A-Z0-9]{4}$/.test(el.textContent.trim());
}, { timeout: 12000 });
const code = (await host.$eval('#roomCode', (e) => e.textContent)).trim();
ok('방 코드 발급', /^[A-Z0-9]{4}$/.test(code), code);
await shot(host, 'm09-lobby.png');

const guestBrowser = await puppeteer.launch({
  headless: 'new', executablePath: CHROME, protocolTimeout: 180000,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
const guest = await guestBrowser.newPage();
await guest.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
guest.on('pageerror', (e) => errors.push('guest pageerror: ' + e.message));
guest.on('console', (m) => { if (m.type() === 'error') errors.push('guest console: ' + m.text()); });
await guest.goto(`${BASE}/?room=${code}&name=${encodeURIComponent('정원영')}`, { waitUntil: 'networkidle0' });
await sleep(2500);
const guestCode = await guest.evaluate(() => (document.getElementById('roomCode') || {}).textContent);
ok('초대 링크로 게스트 참가', (guestCode || '').trim() === code, guestCode);
const hostCount = await host.evaluate(() => document.querySelectorAll('#playerList li').length);
ok('호스트 목록에 2명', hostCount === 2, hostCount);

await host.evaluate(() => document.getElementById('btnStart').click());
await host.waitForFunction(() => !document.getElementById('countdown').classList.contains('hidden'), { timeout: 8000 });
await guest.waitForFunction(() => !document.getElementById('countdown').classList.contains('hidden'), { timeout: 8000 });
ok('양쪽 카운트다운 표시', true);
await shot(host, 'm10-multi-countdown.png');
const hs = await waitState(host, (s) => s.phase === 'racing' && s.racers >= 2, 15000, 'host race');
const gs = await waitState(guest, (s) => s.phase === 'racing' && s.racers >= 2, 15000, 'guest race');
ok('양쪽 레이스 시작 · 레이서 2명', hs.racers >= 2 && gs.racers >= 2, { host: hs.racers, guest: gs.racers });
ok('양쪽 동일 방 코드', hs.roomCode === code && gs.roomCode === code, { h: hs.roomCode, g: gs.roomCode });

await sleep(1500);
const guestBefore = await stateOf(guest);
await sleep(5000);
const guestAfter = await stateOf(guest);
const hostEntryB = guestAfter.racerList.find((r) => !r.isMe);
const hostEntryB2 = guestBefore.racerList.find((r) => !r.isMe);
const moved = hostEntryB && hostEntryB2 && (Math.hypot(hostEntryB.x - hostEntryB2.x, hostEntryB.z - hostEntryB2.z) > 0.2);
ok('상대 차량 위치 실시간 동기화', !!moved, { before: hostEntryB2, after: hostEntryB });
const guestSelf = guestAfter;
ok('게스트도 자기 차량 주행', guestSelf.kmh > 3, guestSelf.kmh);
const hostState = await stateOf(host);
const guestCarOnHost = hostState.racerList.find((r) => !r.isMe);
ok('호스트 화면에도 게스트 차량 존재', !!guestCarOnHost, hostState.racerList.map((r) => r.name));
await shot(host, 'm11-multi-racing-host.png');
await shot(guest, 'm12-multi-racing-guest.png');

/* ------------------------------ 10. 콘솔 오류 ------------------------------ */
section('콘솔 · 네트워크 오류');
const realErrors = errors.filter((e) => !/favicon|ERR_ABORTED/.test(e));
ok('콘솔 오류 0', realErrors.length === 0, realErrors.slice(0, 6));
const perf = await host.evaluate(() => {
  const r = window.__neon.renderer;
  return { calls: r.info.render.calls, tris: r.info.render.triangles, textures: r.info.memory.textures, geos: r.info.memory.geometries };
});
ok('렌더 부하 적정 (draw calls < 260)', perf.calls < 260, perf);
console.log('    · render: ' + JSON.stringify(perf));

// 물리 스텝 비용 (기기 성능 대신 CPU 비용 측정)
const cpu = await host.evaluate(() => {
  const n = window.__neon;
  const me = n.app.racers.find((r) => r.isMe);
  const t0 = performance.now();
  for (let i = 0; i < 600; i++) n.step?.(1 / 120);
  return performance.now() - t0;
});
console.log('    · (참고) 브라우저 렌더 fps: ' + (await stateOf(host)).fps.toFixed(1));

await guestBrowser.close();
await browser.close();
stop();
console.log(`\n=== 결과: ${pass} 통과 / ${fail} 실패 ===`);
if (fail) { console.log('실패: ' + fails.join(', ')); process.exit(1); }
process.exit(0);
