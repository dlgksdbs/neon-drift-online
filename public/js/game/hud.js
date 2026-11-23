import { formatTime } from '../core/progress.js';

/* =============================================================================
   hud.js — DOM HUD · 실시간 순위표 · 미니맵 · 메시지
   ============================================================================= */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Hud {
  constructor(track) {
    this.track = track;
    this.el = {
      hud: $('hud'), pos: $('posVal'), posTotal: $('posTotal'), lap: $('lapVal'),
      lapTime: $('lapTime'), best: $('bestLap'), speed: $('speedVal'),
      nitroFill: $('nitroFill'), camMode: $('camMode'), msg: $('msgBox'),
      minimap: $('minimap'), speedlines: $('speedlines'), flash: $('flash'),
      boardList: $('boardList'), boardLap: $('boardLap'),
    };
    this.map = this.el.minimap.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = 220;
    this._buildMinimapBase();
    this.msgTimer = 0;
    this.lastMsg = '';
    this._boardSig = '';
  }

  _buildMinimapBase() {
    const t = this.track, S = 220, pad = 16;
    const w = t.bounds.maxX - t.bounds.minX;
    const h = t.bounds.maxZ - t.bounds.minZ;
    const sc = Math.min((S - pad * 2) / w, (S - pad * 2) / h);
    const ox = (S - w * sc) / 2, oy = (S - h * sc) / 2;
    this.project = (x, z) => [ox + (x - t.bounds.minX) * sc, oy + (z - t.bounds.minZ) * sc];
    const ctx = this.base.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    // 트랙
    ctx.beginPath();
    for (let i = 0; i <= t.n; i += 2) {
      const k = i % t.n;
      const [x, y] = this.project(t.xs[k], t.zs[k]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(30, 60, 110, .85)';
    ctx.lineWidth = 9; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.strokeStyle = 'rgba(80, 230, 255, .85)';
    ctx.lineWidth = 2.4; ctx.stroke();
    // 스타트 라인
    const [sx, sy] = this.project(t.start.x, t.start.z);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(sx, sy, 3.2, 0, Math.PI * 2); ctx.fill();
    // 체크포인트
    ctx.fillStyle = 'rgba(180, 140, 255, .8)';
    for (let i = 1; i < t.checkpoints.length; i++) {
      const [x, y] = this.project(t.checkpoints[i].x, t.checkpoints[i].z);
      ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
    }
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  setPos(p, total) {
    this.el.pos.textContent = String(p);
    if (total) this.el.posTotal.textContent = `/${total}`;
  }
  setLap(lap, laps) {
    this.el.lap.textContent = `${Math.min(lap, laps)}/${laps}`;
    this.el.boardLap.textContent = `LAP ${Math.min(lap, laps)}/${laps}`;
  }
  setTime(t, best) {
    this.el.lapTime.textContent = formatTime(t);
    this.el.best.textContent = 'BEST ' + formatTime(best);
  }
  setSpeed(k) {
    this.el.speed.textContent = String(Math.round(k));
    const t = Math.max(0, Math.min(1, k / 230));
    this.el.speed.style.textShadow = `0 0 ${16 + t * 26}px rgba(${34 + t * 140}, ${230 - t * 40}, 255, ${0.7 + t * 0.3}), 0 2px 6px rgba(0,0,0,.8)`;
    this.el.speed.style.transform = `scale(${1 + t * 0.07})`;
  }
  setNitro(fuel) {
    this.el.nitroFill.style.width = `${Math.max(0, Math.min(100, fuel))}%`;
    this.el.nitroFill.classList.toggle('low', fuel < 22);
  }
  setCam(mode) { this.el.camMode.textContent = mode === 'first' ? '1인칭' : '3인칭'; }

  /* 실시간 순위표: rows = [{rank, name, color, me, lapText, done}] (위가 1위) */
  setBoard(rows) {
    const sig = rows.map((r) => `${r.rank}:${r.name}:${r.lapText}:${r.me ? 1 : 0}:${r.done ? 1 : 0}`).join('|');
    this.el.boardList.dataset.sig = sig;
    if (sig === this._boardSig) return;
    this._boardSig = sig;
    let html = '';
    for (const r of rows) {
      const cls = ['p' + r.rank, r.me ? 'me' : '', r.done ? 'done' : ''].filter(Boolean).join(' ');
      html += `<li class="${cls}"><span class="rk">${r.rank}</span>`
        + `<span class="dot" style="color:${r.color};background:${r.color}"></span>`
        + `<span class="nm">${esc(r.name)}</span>`
        + `<span class="lp">${esc(r.lapText)}</span></li>`;
    }
    this.el.boardList.innerHTML = html;
  }

  message(text, ms = 1200) {
    this.el.msg.textContent = text;
    this.el.msg.classList.remove('hidden');
    this.el.msg.style.animation = 'none';
    void this.el.msg.offsetWidth;
    this.el.msg.style.animation = '';
    this.msgTimer = ms / 1000;
  }

  setBoostVisual(level) {
    const o = Math.max(0, Math.min(1, level));
    this.el.speedlines.style.opacity = String(o * 0.62);
    this.el.hud.classList.toggle('boost', o > 0.45);
  }

  flash(color = 'rgba(120,220,255,.55)') {
    const f = this.el.flash;
    f.style.background = `radial-gradient(circle at 50% 62%, ${color}, rgba(0,0,0,0) 62%)`;
    f.style.opacity = '1';
    setTimeout(() => { f.style.opacity = '0'; }, 90);
  }

  drawMinimap(racers) {
    const ctx = this.map;
    ctx.clearRect(0, 0, 220, 220);
    ctx.drawImage(this.base, 0, 0);
    for (const r of racers) {
      const [x, y] = this.project(r.x, r.z);
      ctx.beginPath();
      ctx.arc(x, y, r.me ? 5.2 : 4, 0, Math.PI * 2);
      ctx.fillStyle = r.color;
      ctx.shadowColor = r.color;
      ctx.shadowBlur = r.me ? 14 : 8;
      ctx.fill();
      if (r.me) {
        ctx.lineWidth = 2; ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
  }

  tick(dt) {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.el.msg.classList.add('hidden');
    }
  }
}
