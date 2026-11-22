/* =============================================================================
   net.js — WebSocket 클라이언트 (방 · 동기화)
   ============================================================================= */

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.connected = false;
    this.id = null;
    this.url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    this.queue = [];
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return this;
  }

  emit(type, data) {
    const list = this.handlers.get(type);
    if (list) for (const fn of list) fn(data);
    const any = this.handlers.get('*');
    if (any) for (const fn of any) fn(data);
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      return Promise.resolve(this);
    }
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('서버 연결 시간 초과')), 8000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.connected = true;
        this.emit('open');
        for (const msg of this.queue) ws.send(JSON.stringify(msg));
        this.queue = [];
        resolve(this);
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.type === 'welcome') this.id = msg.id;
        this.emit(msg.type, msg);
      };
      ws.onclose = () => {
        this.connected = false;
        this.emit('close');
      };
      ws.onerror = () => {
        this.emit('error', new Error('WebSocket 오류'));
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
    else this.queue.push(obj);
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* noop */ }
    }
    this.ws = null;
    this.connected = false;
    this.queue = [];
    this.id = null;
  }
}
