import * as THREE from 'three';

/* =============================================================================
   effects.js — 스키드마크(네온) · 스파크 파티클 · 부스터 충격파 링
   ============================================================================= */

const MAX_SKID = 1100;
const MAX_SPARK = 480;
const MAX_RING = 6;

export class Effects {
  constructor(scene) {
    this.scene = scene;

    // ---- 스키드마크
    const skidGeo = new THREE.PlaneGeometry(0.55, 1.05);
    const skidMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.skidMesh = new THREE.InstancedMesh(skidGeo, skidMat, MAX_SKID);
    this.skidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.skidMesh.frustumCulled = false;
    const c = new THREE.Color(0, 0, 0);
    for (let i = 0; i < MAX_SKID; i++) this.skidMesh.setColorAt(i, c);
    this.skidLife = new Float32Array(MAX_SKID);
    this.skidBase = [];
    for (let i = 0; i < MAX_SKID; i++) this.skidBase.push(new THREE.Color(0, 0, 0));
    this.skidIdx = 0;
    this.scene.add(this.skidMesh);

    const m = new THREE.Matrix4();
    m.makeTranslation(0, -1000, 0);
    for (let i = 0; i < MAX_SKID; i++) this.skidMesh.setMatrixAt(i, m);
    this.skidMesh.instanceMatrix.needsUpdate = true;

    // ---- 스파크
    this.sparkPos = new Float32Array(MAX_SPARK * 3);
    this.sparkVel = new Float32Array(MAX_SPARK * 3);
    this.sparkLife = new Float32Array(MAX_SPARK);
    this.sparkCol = new Float32Array(MAX_SPARK * 3);
    for (let i = 0; i < MAX_SPARK; i++) {
      this.sparkPos[i * 3 + 1] = -1000;
      this.sparkLife[i] = 0;
    }
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    sparkGeo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparkMat = new THREE.PointsMaterial({
      size: 0.34, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexColors: true, sizeAttenuation: true,
    });
    this.sparkPoints = new THREE.Points(sparkGeo, this.sparkMat);
    this.sparkPoints.frustumCulled = false;
    this.scene.add(this.sparkPoints);
    this.sparkIdx = 0;

    // ---- 부스터 링
    this.rings = [];
    const ringTex = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const ctx = cv.getContext('2d');
      const grd = ctx.createRadialGradient(64, 64, 30, 64, 64, 62);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.72, 'rgba(255,255,255,0.0)');
      grd.addColorStop(0.86, 'rgba(255,255,255,0.95)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    for (let i = 0; i < MAX_RING; i++) {
      const ring = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.userData = { life: 0, max: 0.6 };
      this.scene.add(ring);
      this.rings.push(ring);
    }
    this.ringIdx = 0;
  }

  /* 네온 스키드마크: 월드 위치 + 진행방향 + 색 */
  addSkid(x, z, heading, color = 0x35f0ff, strength = 1) {
    const i = this.skidIdx++ % MAX_SKID;
    const dummy = new THREE.Object3D();
    dummy.position.set(x, 0.045, z);
    dummy.rotation.set(-Math.PI / 2, 0, -heading + Math.PI / 2);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    this.skidMesh.setMatrixAt(i, dummy.matrix);
    this.skidLife[i] = 1.5 * strength;
    const c = new THREE.Color(color);
    this.skidBase[i].copy(c);
    this.skidMesh.setColorAt(i, c);
    this.skidMesh.instanceMatrix.needsUpdate = true;
    if (this.skidMesh.instanceColor) this.skidMesh.instanceColor.needsUpdate = true;
  }

  spawnSpark(x, y, z, count = 6, color = 0xffc46b, spread = 6, up = 4) {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.sparkIdx++ % MAX_SPARK;
      this.sparkPos[i * 3] = x;
      this.sparkPos[i * 3 + 1] = y;
      this.sparkPos[i * 3 + 2] = z;
      this.sparkVel[i * 3] = (Math.random() - 0.5) * spread;
      this.sparkVel[i * 3 + 1] = Math.random() * up + 1;
      this.sparkVel[i * 3 + 2] = (Math.random() - 0.5) * spread;
      this.sparkLife[i] = 0.35 + Math.random() * 0.45;
      this.sparkCol[i * 3] = c.r; this.sparkCol[i * 3 + 1] = c.g; this.sparkCol[i * 3 + 2] = c.b;
    }
    this.sparkPoints.geometry.attributes.position.needsUpdate = true;
    this.sparkPoints.geometry.attributes.color.needsUpdate = true;
  }

  spawnRing(x, z, color = 0x66e8ff) {
    const ring = this.rings[this.ringIdx++ % MAX_RING];
    ring.position.set(x, 0.12, z);
    ring.material.color.setHex(color);
    ring.userData.life = ring.userData.max;
    ring.scale.set(2, 2, 1);
    ring.visible = true;
  }

  update(dt, track) {
    // 스키드 페이드
    let colorDirty = false;
    for (let i = 0; i < MAX_SKID; i++) {
      if (this.skidLife[i] > 0) {
        this.skidLife[i] -= dt;
        const f = Math.max(0, this.skidLife[i] / 1.5);
        const c = this.skidBase[i];
        const tmp = new THREE.Color(c.r * f, c.g * f, c.b * f);
        this.skidMesh.setColorAt(i, tmp);
        colorDirty = true;
        if (this.skidLife[i] <= 0) {
          const m = new THREE.Matrix4();
          m.makeTranslation(0, -1000, 0);
          this.skidMesh.setMatrixAt(i, m);
          this.skidMesh.instanceMatrix.needsUpdate = true;
        }
      }
    }
    if (colorDirty && this.skidMesh.instanceColor) this.skidMesh.instanceColor.needsUpdate = true;

    // 스파크 물리
    let dirty = false;
    for (let i = 0; i < MAX_SPARK; i++) {
      if (this.sparkLife[i] > 0) {
        this.sparkLife[i] -= dt;
        this.sparkVel[i * 3 + 1] -= 16 * dt;
        this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
        this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
        this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
        if (this.sparkPos[i * 3 + 1] < 0.03) {
          this.sparkPos[i * 3 + 1] = 0.03;
          this.sparkVel[i * 3 + 1] *= -0.35;
          this.sparkVel[i * 3] *= 0.7;
          this.sparkVel[i * 3 + 2] *= 0.7;
        }
        if (this.sparkLife[i] <= 0) this.sparkPos[i * 3 + 1] = -1000;
        dirty = true;
      }
    }
    if (dirty) this.sparkPoints.geometry.attributes.position.needsUpdate = true;

    // 링
    for (const ring of this.rings) {
      if (!ring.visible) continue;
      ring.userData.life -= dt;
      const k = 1 - ring.userData.life / ring.userData.max;
      ring.scale.set(2 + k * 16, 2 + k * 16, 1);
      ring.material.opacity = Math.max(0, 0.8 * (1 - k));
      if (ring.userData.life <= 0) ring.visible = false;
    }
  }

  clear() {
    this.skidLife.fill(0);
    const m = new THREE.Matrix4();
    m.makeTranslation(0, -1000, 0);
    for (let i = 0; i < MAX_SKID; i++) this.skidMesh.setMatrixAt(i, m);
    this.skidMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < MAX_SPARK; i++) { this.sparkLife[i] = 0; this.sparkPos[i * 3 + 1] = -1000; }
    this.sparkPoints.geometry.attributes.position.needsUpdate = true;
    for (const r of this.rings) r.visible = false;
  }
}
