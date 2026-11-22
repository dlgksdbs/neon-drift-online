/* =============================================================================
   wheel.js — 3D 운전교실 스타일 원형 핸들 UI
   - 손가락으로 핸들을 돌리면 각도(최대 ±135°)에 비례해 -1.0 ~ +1.0 조향
   - 손을 떼면 부드럽게 정면(0°)으로 복원
   - 키보드 조향은 setVisual() 로 핸들만 따라 움직인다
   ============================================================================= */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapDeg = (a) => {
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
};

export class SteeringWheel {
  constructor(el, opts = {}) {
    this.el = el;
    this.rot = el.querySelector('.wheelRot');
    this.maxDeg = opts.maxDeg || 135;
    this.angle = 0;              // 현재 시각 회전 각도(도)
    this.value = 0;              // -1 .. +1
    this.dragging = false;
    this.onChange = () => {};
    this._pointerId = null;
    this._lastAngle = 0;
    this._lastX = 0;
    this._bind();
  }

  _bind() {
    const el = this.el;
    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('pointerup', (e) => this._up(e));
    el.addEventListener('pointercancel', (e) => this._up(e));
    el.addEventListener('lostpointercapture', (e) => this._up(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _center() {
    const r = this.el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, r: r.width / 2 };
  }

  /* 화면 위쪽 = 0°, 시계방향 = + */
  _angleAt(x, y, c) {
    return Math.atan2(x - c.x, -(y - c.y)) * 180 / Math.PI;
  }

  _down(e) {
    e.preventDefault();
    const c = this._center();
    this.dragging = true;
    this._pointerId = e.pointerId;
    this._lastAngle = this._angleAt(e.clientX, e.clientY, c);
    this._lastX = e.clientX;
    this._nearCenter = Math.hypot(e.clientX - c.x, e.clientY - c.y) < c.r * 0.24;
    this.rot.classList.remove('anim');
    this.el.classList.add('on');
    try { this.el.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
  }

  _move(e) {
    if (!this.dragging || (this._pointerId !== null && e.pointerId !== this._pointerId)) return;
    e.preventDefault();
    const c = this._center();
    let delta;
    if (this._nearCenter) {
      // 중심을 잡았으면 좌우 드래그로 돌린다
      delta = (e.clientX - this._lastX) * 1.8;
      this._lastX = e.clientX;
    } else {
      const a = this._angleAt(e.clientX, e.clientY, c);
      delta = wrapDeg(a - this._lastAngle);
      this._lastAngle = a;
    }
    this.angle = clamp(this.angle + delta, -this.maxDeg, this.maxDeg);
    this._apply();
    this.value = this.angle / this.maxDeg;
    this.onChange(this.value);
  }

  _up(e) {
    if (!this.dragging) return;
    if (this._pointerId !== null && e && e.pointerId !== undefined && e.pointerId !== this._pointerId) return;
    this.dragging = false;
    this._pointerId = null;
    this.el.classList.remove('on');
    try { this.el.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
    this.release();
  }

  /* 손을 뗀 뒤 부드럽게 정면으로 복원 (조향 입력은 즉시 0) */
  release() {
    this.dragging = false;
    this._pointerId = null;
    this.el.classList.remove('on');
    this.rot.classList.add('anim');
    this.angle = 0;
    this.value = 0;
    this._apply();
    this.onChange(0);
  }

  /* 키보드/외부 입력에 맞춰 핸들만 회전 (콜백 없음) */
  setVisual(steer) {
    if (this.dragging) return;
    const target = clamp(steer, -1, 1) * this.maxDeg;
    if (Math.abs(target - this.angle) < 0.4) return;
    this.angle = target;
    this.value = target / this.maxDeg;
    this.rot.classList.remove('anim');
    this._apply();
  }

  _apply() {
    this.rot.style.transform = `rotate(${this.angle.toFixed(2)}deg)`;
    this.el.setAttribute('aria-valuenow', (this.angle / this.maxDeg).toFixed(2));
  }
}
