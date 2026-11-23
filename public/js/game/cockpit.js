import * as THREE from 'three';
import { mergeGeometries, placed } from './meshUtil.js';
import { softGlowTexture, makeCanvas, tex } from './materials.js';

/* =============================================================================
   cockpit.js — 1인칭 운전석 오버레이 (카메라 고정)
   카메라 로컬 좌표(-Z 전방)로 만든다: 대시보드 · 발광 계기판 · 스티어링 휠 ·
   A필러 프레임 · 보닛 라인.  시점이 흔들려도 화면에 고정되어 자연스럽다.
   ============================================================================= */

function clusterTexture(neonHex) {
  return tex(makeCanvas(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#03050c';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(16,34,70,0.98)');
    g.addColorStop(1, 'rgba(3,5,12,0.99)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = neonHex;
    ctx.shadowColor = neonHex;
    ctx.shadowBlur = 16;
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    // 좌: 타코/속도 게이지
    const cx = 118, cy = 150, r = 78;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 0.86, Math.PI * 2.14);
    ctx.strokeStyle = 'rgba(90,190,255,0.22)';
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 1.02, Math.PI * 1.74);
    ctx.strokeStyle = neonHex;
    ctx.lineWidth = 12;
    ctx.stroke();
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.86 + (i / 10) * Math.PI * 1.28;
      const r1 = r - 16, r2 = r - (i % 5 === 0 ? 30 : 22);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.strokeStyle = i > 7 ? '#ff4b7d' : 'rgba(180,230,255,0.75)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.fillStyle = neonHex;
    ctx.shadowBlur = 22;
    ctx.font = '900 54px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NEON', cx, cy + 6);
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(150,205,255,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillText('MOTORSPORT', cx, cy + 30);

    // 우: 부스트/연료 바
    for (let i = 0; i < 10; i++) {
      const bh = 26 + i * 12;
      ctx.fillStyle = i < 7 ? neonHex : '#ff4b7d';
      ctx.globalAlpha = 0.9;
      ctx.fillRect(268 + i * 22, 190 - bh, 14, bh);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(160,220,255,0.85)';
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.fillText('NITRO', 372, 214);
    ctx.fillStyle = neonHex;
    ctx.font = '900 44px system-ui, sans-serif';
    ctx.fillText('000', 330, 60);
    ctx.fillStyle = 'rgba(140,190,240,0.8)';
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.fillText('km/h', 414, 60);
  }), { srgb: true });
}

export class Cockpit {
  constructor(scene, neonColor = '#37f3ff') {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    const col = new THREE.Color(neonColor);
    this.neon = col;
    const dark = new THREE.MeshStandardMaterial({ color: 0x232b40, roughness: 0.5, metalness: 0.5, envMapIntensity: 1.2, emissive: 0x0a1020, emissiveIntensity: 0.9 });
    const soft = new THREE.MeshStandardMaterial({ color: 0x232a3e, roughness: 0.8, metalness: 0.25 });
    const paint = new THREE.MeshStandardMaterial({
      color: col.clone().multiplyScalar(0.5).add(new THREE.Color(0x0a1220)),
      metalness: 0.78, roughness: 0.22, envMapIntensity: 1.7,
    });
    this.paint = paint;

    /* ---------- 대시보드 ---------- */
    const parts = [];
    // 상판 (완만한 곡선: 3조각)
    parts.push(placed(new THREE.BoxGeometry(1.80, 0.07, 0.32), { pos: [0, -0.335, -0.94], rot: [0.24, 0, 0] }));
    parts.push(placed(new THREE.BoxGeometry(1.66, 0.16, 0.22), { pos: [0, -0.42, -0.62], rot: [0.14, 0, 0] }));
    // 전면 페시아
    parts.push(placed(new THREE.BoxGeometry(1.72, 0.30, 0.10), { pos: [0, -0.50, -1.05], rot: [0.05, 0, 0] }));
    // 계기판 후드
    parts.push(placed(new THREE.BoxGeometry(0.64, 0.06, 0.26), { pos: [-0.20, -0.175, -0.82], rot: [0.30, 0, 0] }));
    // 센터 콘솔 + 터널
    parts.push(placed(new THREE.BoxGeometry(0.36, 0.24, 0.62), { pos: [0.06, -0.56, -0.50] }));
    // A필러 프레임
    for (const s of [-1, 1]) {
      const from = new THREE.Vector3(s * 0.74, -0.50, -1.05);
      const to = new THREE.Vector3(s * 0.38, 0.50, -0.40);
      const mid = from.clone().add(to).multiplyScalar(0.5);
      const dir = to.clone().sub(from);
      const b = new THREE.BoxGeometry(0.075, 0.10, dir.length());
      b.applyMatrix4(new THREE.Matrix4().compose(
        mid, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize()),
        new THREE.Vector3(1, 1, 1)
      ));
      parts.push(b);
      // 루프 레일
      parts.push(placed(new THREE.BoxGeometry(0.12, 0.09, 1.3), { pos: [s * 0.56, 0.46, -0.95], rot: [0, s * 0.10, 0] }));
      // 도어 상단
      parts.push(placed(new THREE.BoxGeometry(0.10, 0.15, 1.3), { pos: [s * 0.86, -0.48, -0.70], rot: [0, s * 0.06, 0] }));
    }
    // 루프 헤더
    parts.push(placed(new THREE.BoxGeometry(1.34, 0.10, 0.22), { pos: [0, 0.46, -0.55], rot: [0.18, 0, 0] }));
    this.dash = new THREE.Mesh(mergeGeometries(parts), dark);
    this.group.add(this.dash);

    /* ---------- 대시 하단 소프트 패드 ---------- */
    this.soft = new THREE.Mesh(
      mergeGeometries([
        placed(new THREE.BoxGeometry(1.76, 0.24, 0.32), { pos: [0, -0.62, -0.44], rot: [0.12, 0, 0] }),
        placed(new THREE.BoxGeometry(0.40, 0.22, 0.52), { pos: [0.06, -0.64, -0.38] }),
      ]),
      soft
    );
    this.group.add(this.soft);

    /* ---------- 계기판 ---------- */
    this.cluster = new THREE.Mesh(
      new THREE.PlaneGeometry(0.27, 0.140),
      new THREE.MeshBasicMaterial({ map: clusterTexture('#' + col.getHexString()), transparent: true })
    );
    this.cluster.position.set(-0.045, -0.250, -0.660);
    this.cluster.rotation.x = -0.36;
    this.group.add(this.cluster);

    /* ---------- 스티어링 휠 ---------- */
    const wheelParts = [];
    wheelParts.push(placed(new THREE.TorusGeometry(0.155, 0.024, 8, 26), { pos: [0, 0, 0] }));
    wheelParts.push(placed(new THREE.BoxGeometry(0.13, 0.085, 0.03), { pos: [0, 0, -0.01] }));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2 + (i === 0 ? 0 : 0);
      wheelParts.push(placed(new THREE.BoxGeometry(0.03, 0.13, 0.02), {
        pos: [Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0], rot: [0, 0, a - Math.PI / 2],
      }));
    }
    this.wheel = new THREE.Mesh(mergeGeometries(wheelParts), dark);
    this.wheel.position.set(-0.22, -0.405, -0.620);
    this.wheel.rotation.x = -0.45;
    this.group.add(this.wheel);

    /* ---------- 네온 트림 ---------- */
    this.trim = new THREE.Mesh(
      mergeGeometries([
        placed(new THREE.BoxGeometry(1.72, 0.010, 0.012), { pos: [0, -0.352, -1.07], rot: [0.24, 0, 0] }),
        placed(new THREE.BoxGeometry(0.010, 0.010, 1.1), { pos: [-0.88, -0.42, -0.62] }),
        placed(new THREE.BoxGeometry(0.010, 0.010, 1.1), { pos: [0.88, -0.42, -0.62] }),
        placed(new THREE.BoxGeometry(0.34, 0.008, 0.010), { pos: [0.06, -0.50, -0.42] }),
      ]),
      new THREE.MeshBasicMaterial({ color: col })
    );
    this.group.add(this.trim);

    /* ---------- 보닛 라인 (카메라 고정) ---------- */
    const hoodParts = [];
    hoodParts.push(placed(new THREE.BoxGeometry(1.96, 0.05, 1.30), { pos: [0, -0.545, -2.25], rot: [0.05, 0, 0] }));
    hoodParts.push(placed(new THREE.BoxGeometry(1.90, 0.05, 1.00), { pos: [0, -0.585, -3.40], rot: [0.03, 0, 0] }));
    for (const sgn of [-1, 1]) {
      hoodParts.push(placed(new THREE.BoxGeometry(0.15, 0.09, 2.9), { pos: [sgn * 0.93, -0.515, -2.7], rot: [0.05, 0, 0] }));
    }
    this.hood = new THREE.Mesh(mergeGeometries(hoodParts), paint);
    this.group.add(this.hood);
    this.hoodNeon = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.012, 2.4),
      new THREE.MeshBasicMaterial({ color: col })
    );
    this.hoodNeon.position.set(0, -0.518, -2.7);
    this.hoodNeon.rotation.x = 0.05;
    this.group.add(this.hoodNeon);

    // 헤드라이트가 만들어내는 노면 빛 웅덩이
    this.lightPool = new THREE.Mesh(
      new THREE.PlaneGeometry(7.5, 16),
      new THREE.MeshBasicMaterial({
        map: softGlowTexture(), color: 0xbfe9ff, transparent: true, opacity: 0.32,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    this.lightPool.rotation.x = -Math.PI / 2;
    this.lightPool.position.set(0, -1.20, -10.5);
    this.group.add(this.lightPool);
    this.hoodGlow = this.lightPool;
    // 보닛 위를 스치는 하이라이트 (보닛 라인을 읽게)
    this.hoodSheen = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 3.4),
      new THREE.MeshBasicMaterial({
        map: softGlowTexture(), color: 0x6f8cff, transparent: true, opacity: 0.20,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    this.hoodSheen.rotation.x = -Math.PI / 2 + 0.06;
    this.hoodSheen.position.set(0, -0.50, -2.5);
    this.group.add(this.hoodSheen);

    this._steer = 0;
    this._boost = 0;
  }

  setColor(neonColor) {
    const col = new THREE.Color(neonColor);
    this.trim.material.color.copy(col);
    this.hoodNeon.material.color.copy(col);
    this.paint.color.copy(col.clone().multiplyScalar(0.5).add(new THREE.Color(0x0a1220)));
    this.cluster.material.map.dispose();
    this.cluster.material.map = clusterTexture('#' + col.getHexString());
    this.cluster.material.needsUpdate = true;
  }

  update(camera, dt, opts = {}) {
    const on = !!opts.on;
    this.group.visible = on;
    if (!on) return;
    this.group.position.copy(camera.position);
    this.group.quaternion.copy(camera.quaternion);
    const steer = THREE.MathUtils.clamp(opts.steer || 0, -1, 1);
    this._steer = THREE.MathUtils.lerp(this._steer, steer, Math.min(1, dt * 10));
    this.wheel.rotation.z = -this._steer * 1.9;
    const boost = Math.max(0, Math.min(1.5, opts.boost || 0));
    this._boost = THREE.MathUtils.lerp(this._boost, boost, Math.min(1, dt * 8));
    if (this.hoodGlow) this.hoodGlow.material.opacity = 0.06 + this._boost * 0.16;
    if (this.hoodSheen) this.hoodSheen.material.opacity = 0.14 + this._boost * 0.12;
    const v = 0.85 + this._boost * 0.35;
    this.trim.scale.setScalar(1);
    this.cluster.material.opacity = 0.9 + this._boost * 0.1;
    this.cluster.material.color.setScalar(v);
  }
}
