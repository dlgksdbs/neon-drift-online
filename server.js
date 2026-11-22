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
    if (p.ws.readyState === 1) p.ws.send(data);
  }
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
  if (!room) return;
  const p = room.players.get(ws.pid);
  if (p) room.players.delete(ws.pid);
  ws.roomCode = null;
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
  const players = [...room.players.values()];
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
  broadcast(room, { type: 'countdown', startAt: room.startAt, laps: room.laps });
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

  if (room.finishOrder.length >= room.players.size) {
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
        const elapsed = (Date.now() - room.startAt) / 1000;
        // 위치 순간이동(치트/글리치) 방지: 한 틱에 40m 이상 점프하면 무시
        if (p.x !== undefined && Math.hypot(x - p.x, z - p.z) > 40) break;
        p.x = x; p.z = z;
        p.h = Number(msg.h) || 0;
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
    if (room.players.size === 0 && now - room.createdAt > 60000) {
      cleanupRoom(room);
    } else if (now - room.createdAt > ROOM_TTL_MS) {
      broadcast(room, { type: 'error', message: '방 시간이 만료됐어.' });
      for (const p of room.players.values()) { try { p.ws.close(); } catch (e) { /* noop */ } }
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
