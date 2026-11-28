/* =============================================================================
   server.js — NEON DRIFT 온라인: Express 정적 서버 + WebSocket 방/레이스 동기화
   ============================================================================= */
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';

import { TRACK, nearest, sample } from './public/js/core/track.js';
import { RaceProgress } from './public/js/core/progress.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const VERSION = '1.0.0';
const LAPS = 3;
const MAX_PLAYERS = 6;
const TICK_MS = 66;          // 위치 브로드캐스트 주기 (~15Hz)
const COUNTDOWN_MS = 3200;
const ROOM_TTL_MS = 45 * 60 * 1000;
const RESUME_GRACE_MS = 20000;   // 레이스 중 연결이 끊긴 플레이어를 기다려 주는 시간

const app = express();
app.use(express.json());

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    name: 'neon-drift-online',
    version: VERSION,
    uptime: Math.round(process.uptime()),
    rooms: rooms.size,
    players: [...rooms.values()].reduce((a, r) => a + r.players.size, 0),
    track: TRACK.name,
    trackLength: Math.round(TRACK.total),
    laps: LAPS,
  });
});

app.get('/api/info', (req, res) => {
  res.json({
    name: 'neon-drift-online',
    version: VERSION,
    track: { name: TRACK.name, length: Math.round(TRACK.total), checkpoints: TRACK.checkpoints.length, halfWidth: TRACK.halfWidth },
    laps: LAPS,
    maxPlayers: MAX_PLAYERS,
    rooms: [...rooms.values()].map((r) => ({ code: r.code, state: r.state, players: r.players.size })),
  });
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: '1h',
  setHeaders: (res, p) => {
    if (/\.(html|js|css)$/.test(p)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/healthz') return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/* ---------------------------------- 방 ---------------------------------- */
const rooms = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (let attempt = 0; attempt < 200; attempt++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return 'X' + Date.now().toString(36).slice(-3).toUpperCase();
}

function createRoom(ws, msg) {
  const code = newCode();
  const room = {
    code,
    hostId: ws.pid,
    state: 'lobby',
    laps: LAPS,
    players: new Map(),
    createdAt: Date.now(),
    startAt: 0,
    tickTimer: null,
    finishOrder: [],
    timer: null,
  };
  rooms.set(code, room);
  return room;
}

function playerInfo(p) {
  return { id: p.id, name: p.name, car: p.car, color: p.color, ready: p.ready, host: p.host };
}

function roomPayload(room) {
  return {
    type: 'room',
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    laps: room.laps,
    players: [...room.players.values()].map(playerInfo),
  };
}

function broadcast(room, msg, exceptId = null) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.id === exceptId) continue;
    if (p.ws && p.ws.readyState === 1) p.ws.send(data);
  }
}

/* 레이스 시작 그리드(서버가 정한 순서) — 클라이언트가 이걸로 차량을 세운다 */
function gridPayload(room) {
  return [...room.players.values()].map((p, i) => ({
    id: p.id, name: p.name, car: p.car, color: p.color,
    gridIndex: p.gridIndex === undefined ? i : p.gridIndex,
    host: !!p.host, ready: !!p.ready, connected: !!p.ws,
  }));
}

function sysSend(ws, type, payload = {}) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type, ...payload }));
}

function cleanupRoom(room) {
  if (room.tickTimer) clearInterval(room.tickTimer);
  if (room.timer) clearTimeout(room.timer);
  room.tickTimer = null;
  room.timer = null;
  if (room.players.size === 0) rooms.delete(room.code);
}

function sanitizeName(name) {
  const s = String(name || '').trim().replace(/[<>&"'`\\]/g, '').slice(0, 10);
  return s || '드라이버';
}

function sanitizeColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(String(color || '')) ? String(color) : '#37f3ff';
}

function sanitizeCar(car) {
  return ['coupe', 'gt', 'hyper'].includes(car) ? car : 'coupe';
}

function leaveRoom(ws) {
  const room = rooms.get(ws.roomCode);
  ws.roomCode = null;
  if (!room) return;
  const p = room.players.get(ws.pid);
  // 이 소켓이 그 플레이어의 소켓이 아니면(재접속으로 교체됐으면) 아무것도 하지 않는다
  if (!p || p.ws !== ws) return;
  // 레이스 중 일시 끊김: 바로 내보내지 않고 자리를 잡아 둔다(재접속하면 이어서 달린다)
  if (room.state === 'countdown' || room.state === 'racing') {
    p.ws = null;
    p.disconnectedAt = Date.now();
    return;
  }
  room.players.delete(ws.pid);
  if (room.players.size === 0) {
    cleanupRoom(room);
    return;
  }
  if (room.hostId === ws.pid) {
    room.hostId = [...room.players.keys()][0];
    const nh = room.players.get(room.hostId);
    if (nh) nh.host = true;
  }
  broadcast(room, { type: 'left', id: ws.pid, name: p ? p.name : '' });
  broadcast(room, roomPayload(room));
}

function startRace(room) {
  if (room.state !== 'lobby') return;
  const players = [...room.players.values()].filter((p) => p.ws && p.ws.readyState === 1);
  if (players.length < 1) return;
  room.state = 'countdown';
  room.startAt = Date.now() + COUNTDOWN_MS;
  room.finishOrder = [];
  // 그리드 순서 (호스트부터)
  players.forEach((p, i) => {
    p.ready = true;
    p.finishTime = null;
    p.finished = false;
    p.gridIndex = i;
    p.hint = -1;
    const gridS = TRACK.total - 14 - i * 7.5;
    const pose = sample(TRACK, gridS, i % 2 === 0 ? -3.1 : 3.1);
    p.x = pose.x; p.z = pose.z; p.h = pose.heading;
    p.prog = new RaceProgress(TRACK, { laps: room.laps, s: gridS });
    p.elapsed = 0;
  });
  broadcast(room, { type: 'countdown', startAt: room.startAt, laps: room.laps, players: gridPayload(room) });
  broadcast(room, roomPayload(room));
  room.timer = setTimeout(() => {
    room.state = 'racing';
    broadcast(room, { type: 'race', startAt: room.startAt, laps: room.laps });
    room.tickTimer = setInterval(() => tickRoom(room), TICK_MS);
  }, COUNTDOWN_MS);
}

function tickRoom(room) {
  if (room.state !== 'racing') return;
  const now = Date.now();
  const elapsed = (now - room.startAt) / 1000;
  const players = [];
  for (const p of room.players.values()) {
    players.push({
      id: p.id, name: p.name, car: p.car, color: p.color,
      x: round2(p.x), z: round2(p.z), h: round3(p.h), speed: round2(p.speed || 0),
      boost: !!p.boost, lap: p.prog ? p.prog.lap : 0,
      cp: p.prog ? p.prog.nextCp : 0, finished: !!p.finished,
    });
  }
  players.sort((a, b) => {
    const A = room.players.get(a.id), B = room.players.get(b.id);
    const pa = A.prog ? A.prog.progressValue : 0, pb = B.prog ? B.prog.progressValue : 0;
    return pb - pa;
  });
  broadcast(room, { type: 'state', t: Math.round(elapsed * 100) / 100, players });

  // 남아서 달리는 사람이 없으면(전원 완주 또는 연결 종료) 경기를 끝낸다
  const pending = [...room.players.values()].filter((p) => !p.finished && p.ws && p.ws.readyState === 1);
  if (room.finishOrder.length >= room.players.size || pending.length === 0) {
    room.state = 'done';
    if (room.tickTimer) clearInterval(room.tickTimer);
    room.tickTimer = null;
    broadcast(room, {
      type: 'finish',
      order: room.finishOrder.map((f) => ({ id: f.id, name: f.name, time: f.time, best: f.best, car: f.car, color: f.color })),
    });
    broadcast(room, roomPayload(room));
  }
}

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const round3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

/* ---------------------------------- WS ---------------------------------- */
let nextPid = 1;

wss.on('connection', (ws) => {
  ws.pid = 'p' + nextPid++;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  sysSend(ws, 'welcome', { id: ws.pid, track: { name: TRACK.name, length: TRACK.total }, laps: LAPS, maxPlayers: MAX_PLAYERS });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!msg || typeof msg.type !== 'string') return;
    const room = rooms.get(ws.roomCode);

    switch (msg.type) {
      case 'ping':
        sysSend(ws, 'pong', { t: Date.now() });
        break;

      case 'create': {
        if (ws.roomCode) leaveRoom(ws);
        const r = createRoom(ws, msg);
        const p = {
          id: ws.pid, ws, name: sanitizeName(msg.name), car: sanitizeCar(msg.car), color: sanitizeColor(msg.color),
          ready: false, host: true, prog: null, finished: false, finishTime: null,
        };
        r.players.set(ws.pid, p);
        ws.roomCode = r.code;
        sysSend(ws, 'room', roomPayload(r));
        break;
      }

      case 'join': {
        const code = String(msg.code || '').toUpperCase().trim();
        const r = rooms.get(code);
        if (!r) { sysSend(ws, 'error', { message: '방을 찾을 수 없어. 코드를 확인해줘.' }); break; }
        if (r.players.size >= MAX_PLAYERS) { sysSend(ws, 'error', { message: '방이 가득 찼어.' }); break; }
        if (r.state === 'racing' || r.state === 'countdown') { sysSend(ws, 'error', { message: '이미 레이스가 시작됐어.' }); break; }
        if (ws.roomCode) leaveRoom(ws);
        const p = {
          id: ws.pid, ws, name: sanitizeName(msg.name), car: sanitizeCar(msg.car), color: sanitizeColor(msg.color),
          ready: false, host: false, prog: null, finished: false, finishTime: null,
        };
        r.players.set(ws.pid, p);
        ws.roomCode = r.code;
        broadcast(r, roomPayload(r));
        break;
      }

      case 'ready': {
        if (!room) break;
        const p = room.players.get(ws.pid);
        if (p) p.ready = !!msg.ready;
        broadcast(room, roomPayload(room));
        break;
      }

      case 'car': {
        if (!room) break;
        const p = room.players.get(ws.pid);
        if (p && room.state === 'lobby') {
          p.car = sanitizeCar(msg.car);
          p.color = sanitizeColor(msg.color);
          if (msg.name) p.name = sanitizeName(msg.name);
        }
        broadcast(room, roomPayload(room));
        break;
      }

      case 'start': {
        if (!room) break;
        if (room.hostId !== ws.pid) { sysSend(ws, 'error', { message: '방장만 시작할 수 있어.' }); break; }
        startRace(room);
        break;
      }

      case 'pos': {
        if (!room || room.state !== 'racing') break;
        const p = room.players.get(ws.pid);
        if (!p || p.finished) break;
        const x = Number(msg.x), z = Number(msg.z);
        if (!isFinite(x) || !isFinite(z)) break;
        if (Math.abs(x) > 1500 || Math.abs(z) > 1500) break;
        const now = Date.now();
        const elapsed = (now - room.startAt) / 1000;
        // 위치 순간이동(치트/글리치) 방지: 한 틱에 40m 이상 점프하면 무시.
        // 다만 1초 넘게 새 위치가 없었으면(재접속·백그라운드·렉) 한 번은 받아 준다.
        const stale = now - (p.lastPosAt || 0) > 1000;
        if (!stale && p.x !== undefined && Math.hypot(x - p.x, z - p.z) > 40) break;
        p.lastPosAt = now;
        p.x = x; p.z = z;
        p.h = Number.isFinite(Number(msg.h)) ? Number(msg.h) : 0;
        p.speed = Number(msg.speed) || 0;
        p.boost = !!msg.boost;
        const near = nearest(TRACK, x, z, p.hint);
        p.hint = near.index;
        p.lastS = near.s;
        if (p.prog) {
          const res = p.prog.update(near.s, elapsed);
          if (p.prog.finished && !p.finished) {
            p.finished = true;
            p.finishTime = elapsed;
            room.finishOrder.push({
              id: p.id, name: p.name, time: Math.round(elapsed * 100) / 100,
              best: p.prog.bestLap ? Math.round(p.prog.bestLap * 100) / 100 : null,
              car: p.car, color: p.color,
            });
          }
        }
        break;
      }

      case 'finished': {
        // 클라이언트가 완주를 알리면 서버 진행도 기준으로도 확인
        if (!room || room.state !== 'racing') break;
        const p = room.players.get(ws.pid);
        if (p && p.prog && p.prog.finished) break;
        break;
      }

      case 'resume': {
        // 끊겼다가 돌아온 소켓을 원래 플레이어 자리에 다시 붙인다
        const code = String(msg.code || '').toUpperCase().trim();
        const oldId = String(msg.id || '');
        const r = rooms.get(code);
        if (!r) { sysSend(ws, 'resume-failed', { message: '방이 닫혔어. 새 방을 만들어줘.' }); break; }
        const p = r.players.get(oldId);
        if (!p) { sysSend(ws, 'resume-failed', { message: '방에서 나갔어. 다시 입장해줘.' }); break; }
        if (p.ws && p.ws !== ws && p.ws.readyState === 1) { sysSend(ws, 'resume-failed', { message: '이미 접속 중이야.' }); break; }
        if (ws.roomCode && ws.roomCode !== r.code) leaveRoom(ws);
        p.ws = ws;
        p.disconnectedAt = 0;
        p.lastPosAt = 0;          // 다음 위치는 거리 검사 없이 받는다
        p.hint = -1;
        ws.pid = p.id;
        ws.roomCode = r.code;
        sysSend(ws, 'resumed', {
          id: p.id, code: r.code, state: r.state, startAt: r.startAt,
          laps: r.laps, hostId: r.hostId, players: gridPayload(r),
        });
        if (r.state === 'lobby') broadcast(r, roomPayload(r));
        break;
      }

      case 'rematch': {
        // 끝난 방을 다시 대기 상태로 되돌린다(방장만)
        if (!room) break;
        if (room.hostId !== ws.pid) { sysSend(ws, 'error', { message: '방장만 다시 시작할 수 있어.' }); break; }
        if (room.state !== 'done') break;
        if (room.tickTimer) clearInterval(room.tickTimer);
        room.tickTimer = null;
        if (room.timer) clearTimeout(room.timer);
        room.timer = null;
        room.state = 'lobby';
        room.startAt = 0;
        room.finishOrder = [];
        for (const p of room.players.values()) {
          p.finished = false; p.finishTime = null; p.ready = false; p.prog = null; p.elapsed = 0;
        }
        broadcast(room, { type: 'rematch', code: room.code });
        broadcast(room, roomPayload(room));
        break;
      }

      case 'leave':
        leaveRoom(ws);
        break;

      default:
        break;
    }
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => leaveRoom(ws));
});

/* 오래된 방 정리 + 연결 상태 확인 */
const sweep = setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    // 재접속을 기다리던 시간이 지나면 자리를 비운다
    for (const p of [...room.players.values()]) {
      if (!p.ws && p.disconnectedAt && now - p.disconnectedAt > RESUME_GRACE_MS) {
        room.players.delete(p.id);
        broadcast(room, { type: 'left', id: p.id, name: p.name });
        broadcast(room, roomPayload(room));
      }
    }
    if (room.players.size === 0 && now - room.createdAt > 60000) {
      cleanupRoom(room);
    } else if (now - room.createdAt > ROOM_TTL_MS) {
      broadcast(room, { type: 'error', message: '방 시간이 만료됐어.' });
      for (const p of room.players.values()) { try { if (p.ws) p.ws.close(); } catch (e) { /* noop */ } }
      room.players.clear();
      cleanupRoom(room);
    }
  }
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { try { ws.terminate(); } catch (e) { /* noop */ } continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* noop */ }
  }
}, 30000);
sweep.unref?.();

/* 테스트에서 직접 쓰기 위해 export */
export { app, server, wss, rooms };
export const start = (port = PORT) => new Promise((resolve) => {
  server.listen(port, () => resolve(server.address().port));
});

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  server.listen(PORT, () => {
    console.log(`🏎️  NEON DRIFT 서버 시작 :: http://localhost:${PORT}  (트랙 ${TRACK.name} · ${Math.round(TRACK.total)}m)`);
  });
}
