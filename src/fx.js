// Visual effects: particles, blade trail, beams, shockwaves, lightning, text.
import * as THREE from 'three';

const V = THREE.Vector3;
const _v = new V(), _w = new V(), _u = new V();

// ===================================================================== particles
const P_VERT = `
  attribute float aSize; attribute vec4 aColor; varying vec4 vColor; uniform float uScale;
  void main(){
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uScale * projectionMatrix[1][1] / -mv.z, 1.0, 96.0);
  }`;
const P_FRAG = `
  varying vec4 vColor;
  void main(){
    vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0;
    float a = exp(-d * 3.2) * (1.0 - d);
    if (a <= 0.0) discard;
    gl_FragColor = vec4(vColor.rgb * a * vColor.a, 1.0);
    #include <colorspace_fragment>
  }`;

export class Particles {
  constructor(scene, max = 1600) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.base = new Float32Array(max * 3); this.flick = new Uint8Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } }, vertexShader: P_VERT, fragmentShader: P_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this._c = new THREE.Color();
  }
  emit(p, v, color, { size = 0.05, life = 0.6, grav = 0, drag = 1.5, flicker = false } = {}) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    this._c.set(color);
    this.base.set([this._c.r, this._c.g, this._c.b], i * 3);
    this.life[i] = this.maxLife[i] = life * (0.7 + Math.random() * 0.6);
    this.size0[i] = size * (0.7 + Math.random() * 0.6);
    this.grav[i] = grav; this.drag[i] = drag; this.flick[i] = flicker ? 1 : 0;
  }
  // Spray: n particles from p, around direction `dir` (or all directions).
  burst(p, n, color, { speed = 2, dir = null, spread = 1, size, life, grav = -2, drag = 2, up = 0, flicker } = {}) {
    for (let k = 0; k < n; k++) {
      _v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (_v.lengthSq() > 1) _v.normalize();
      if (dir) _v.multiplyScalar(spread).add(dir).normalize();
      _v.multiplyScalar(speed * (0.35 + Math.random() * 0.75));
      _v.y += up;
      this.emit(p, _v, color, { size, life, grav, drag, flicker });
    }
  }
  update(dt, viewportH) {
    this.mat.uniforms.uScale.value = viewportH * 0.5;
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this._kill(i); continue; }
      const i3 = i * 3, d = Math.exp(-this.drag[i] * dt);
      this.vel[i3 + 1] += this.grav[i] * dt;
      this.vel[i3] *= d; this.vel[i3 + 1] *= d; this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.01 && this.vel[i3 + 1] < 0) { this.pos[i3 + 1] = 0.01; this.vel[i3 + 1] *= -0.35; }
      const k = this.life[i] / this.maxLife[i];
      let a = Math.min(1, k * 2.2);
      if (this.flick[i]) a *= 0.5 + 0.5 * Math.random();
      this.col[i * 4] = this.base[i3]; this.col[i * 4 + 1] = this.base[i3 + 1]; this.col[i * 4 + 2] = this.base[i3 + 2];
      this.col[i * 4 + 3] = a;
      this.size[i] = this.size0[i] * (0.4 + 0.6 * k);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const a of ['position', 'aColor', 'aSize']) this.geo.attributes[a].needsUpdate = true;
  }
  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (const [arr, w] of [[this.pos, 3], [this.vel, 3], [this.base, 3], [this.col, 4]]) arr.copyWithin(i * w, j * w, j * w + w);
    for (const arr of [this.life, this.maxLife, this.size0, this.grav, this.drag, this.flick, this.size]) arr[i] = arr[j];
  }
}

// ===================================================================== blade trail
const T_FRAG = `
  uniform vec3 uColor; uniform float uAlpha; varying float vAge; varying float vSide;
  void main(){
    float a = pow(1.0 - vAge, 1.8) * smoothstep(0.0, 0.7, vSide) * uAlpha;
    vec3 c = mix(uColor, vec3(1.0), pow(vSide, 6.0) * (1.0 - vAge) * 0.7);
    gl_FragColor = vec4(c * a, 1.0);
    #include <colorspace_fragment>
  }`;
// Recent blade samples are smoothed with Catmull-Rom so fast swings sweep a
// curved ribbon instead of a few flat panels.
const RAW = 8, SUB = 4, TN = (RAW - 1) * SUB + 1;
function catmull(out, p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  for (const k of ['x', 'y', 'z']) {
    out[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
  }
  return out;
}
export class Trail {
  constructor(scene) {
    this.raw = Array.from({ length: RAW }, () => [new V(), new V()]);
    const pos = new Float32Array(TN * 2 * 3), age = new Float32Array(TN * 2), side = new Float32Array(TN * 2), idx = [];
    for (let i = 0; i < TN; i++) { age[i * 2] = age[i * 2 + 1] = i / (TN - 1); side[i * 2] = 0; side[i * 2 + 1] = 1; }
    for (let i = 0; i < TN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAge', new THREE.BufferAttribute(age, 1));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xffffff) }, uAlpha: { value: 0 } },
      vertexShader: `attribute float aAge, aSide; varying float vAge, vSide; void main(){ vAge = aAge; vSide = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: T_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this.primed = false;
    this._p = new V(); this._q = new V();
  }
  update(base, tip, speed, color) {
    const R = this.raw;
    if (!this.primed) { for (const p of R) { p[0].copy(base); p[1].copy(tip); } this.primed = true; }
    const last = R.pop(); last[0].copy(base); last[1].copy(tip); R.unshift(last);
    const a = this.mesh.geometry.attributes.position;
    let n = 0;
    for (let i = 0; i < RAW - 1; i++) {
      const i0 = Math.max(0, i - 1), i3 = Math.min(RAW - 1, i + 2);
      for (let s = 0; s < SUB || (i === RAW - 2 && s === SUB); s++) {
        const t = s / SUB;
        catmull(this._p, R[i0][0], R[i][0], R[i + 1][0], R[i3][0], t);
        catmull(this._q, R[i0][1], R[i][1], R[i + 1][1], R[i3][1], t);
        a.setXYZ(n * 2, this._p.x, this._p.y, this._p.z);
        a.setXYZ(n * 2 + 1, this._q.x, this._q.y, this._q.z);
        n++;
      }
    }
    a.needsUpdate = true;
    const target = Math.min(1, Math.max(0, (speed - 1.8) / 5));
    this.mat.uniforms.uAlpha.value += (target - this.mat.uniforms.uAlpha.value) * 0.35;
    this.mat.uniforms.uColor.value.set(color);
  }
}

// ===================================================================== beam crescent
// Curved glowing band. Local frame: +Y = travel, X = spread across the swing,
// Z = band thickness. Ends trail back so the crescent bulges forward.
let crescentGeo = null;
function getCrescentGeo() {
  if (crescentGeo) return crescentGeo;
  const R = 0.75, A = 1.05, H = 0.13, N = 28;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, th = (u * 2 - 1) * A;
    const taper = Math.pow(Math.cos((u * 2 - 1) * Math.PI / 2), 0.8);
    const x = Math.sin(th) * R, y = (Math.cos(th) - 1) * R;
    for (let j = 0; j < 3; j++) {
      const v = j / 2, z = (v * 2 - 1) * H * taper + 0.0001;
      pos.push(x, y, z); uv.push(u, v);
    }
    if (i < N) for (let j = 0; j < 2; j++) { const a = i * 3 + j, b = a + 3; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return (crescentGeo = g);
}
const BEAM_FRAG = `
  uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
  void main(){
    float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
    float along = sin(vUv.x * 3.14159);
    float core = pow(across, 6.0) * along;
    float a = (pow(across, 1.5) * 0.8 + core * 1.4) * along * uAlpha;
    vec3 c = mix(uColor, vec3(1.0), core * 0.85);
    gl_FragColor = vec4(c * a, 1.0);
    #include <colorspace_fragment>
  }`;
export function makeCrescent(color) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(getCrescentGeo(), mat));
  g.userData.mat = mat;
  return g;
}

// ===================================================================== shockwave ring
const RING_FRAG = `
  uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
  void main(){
    float r = length(vUv - 0.5) * 2.0;
    float a = smoothstep(0.62, 0.92, r) * smoothstep(1.0, 0.92, r) * uAlpha;
    a += smoothstep(1.0, 0.0, r) * 0.08 * uAlpha;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;
const ringGeo = new THREE.PlaneGeometry(1, 1);

// ===================================================================== lightning / tether ribbon
export class Ribbon {
  constructor(scene, n = 24) {
    this.n = n;
    this.pts = Array.from({ length: n }, () => new V());
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const t = new Float32Array(n * 2), idx = [];
    for (let i = 0; i < n; i++) { t[i * 2] = 0; t[i * 2 + 1] = 1; }
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } },
      vertexShader: `attribute float aT; varying float vT; void main(){ vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying float vT;
        void main(){ float c = 1.0 - abs(vT * 2.0 - 1.0); vec3 col = mix(uColor, vec3(1.0), pow(c, 4.0)); gl_FragColor = vec4(col * pow(c, 1.4) * uAlpha, 1.0);
        #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.life = 0; this.max = 1;
  }
  // Build a camera-facing strip through this.pts.
  build(eye, width) {
    const a = this.mesh.geometry.attributes.position, n = this.n;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i], q = this.pts[Math.min(n - 1, i + 1)], o = this.pts[Math.max(0, i - 1)];
      _v.subVectors(q, o).normalize();
      _w.subVectors(eye, p).normalize();
      _u.crossVectors(_v, _w).normalize().multiplyScalar(width * 0.5);
      a.setXYZ(i * 2, p.x - _u.x, p.y - _u.y, p.z - _u.z);
      a.setXYZ(i * 2 + 1, p.x + _u.x, p.y + _u.y, p.z + _u.z);
    }
    a.needsUpdate = true;
  }
}

// ===================================================================== floating text
class FloatText {
  constructor(scene, n = 16) {
    this.pool = [];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas'); c.width = 512; c.height = 128;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
      s.renderOrder = 20; s.visible = false;
      scene.add(s);
      this.pool.push({ s, c, ctx: c.getContext('2d'), tex, life: 0, max: 1, vel: new V(), w: 0.4 });
    }
    this.i = 0;
  }
  spawn(text, pos, { color = '#ffffff', size = 0.09, life = 0.85, rise = 0.45, weight = 800 } = {}) {
    const it = this.pool[this.i++ % this.pool.length];
    const x = it.ctx;
    x.clearRect(0, 0, 512, 128);
    x.font = `${weight} 84px system-ui, -apple-system, Segoe UI, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 12; x.strokeStyle = 'rgba(0,0,0,0.75)'; x.lineJoin = 'round';
    x.strokeText(text, 256, 66, 500);
    x.shadowColor = color; x.shadowBlur = 18;
    x.fillStyle = color; x.fillText(text, 256, 66, 500);
    x.shadowBlur = 0;
    it.tex.needsUpdate = true;
    it.s.position.copy(pos);
    it.w = size * 4;
    it.s.scale.set(it.w, size, 1);
    it.vel.set((Math.random() - 0.5) * 0.15, rise, (Math.random() - 0.5) * 0.15);
    it.life = it.max = life;
    it.s.visible = true;
  }
  update(dt) {
    for (const it of this.pool) {
      if (!it.s.visible) continue;
      it.life -= dt;
      if (it.life <= 0) { it.s.visible = false; continue; }
      const k = it.life / it.max, age = 1 - k;
      it.s.position.addScaledVector(it.vel, dt);
      it.vel.multiplyScalar(Math.exp(-3 * dt));
      const pop = age < 0.12 ? 0.6 + (age / 0.12) * 0.55 : 1.15 - Math.min(0.15, (age - 0.12) * 0.6);
      it.s.scale.set(it.w * pop, (it.w / 4) * pop, 1);
      it.s.material.opacity = Math.min(1, k * 3);
    }
  }
}

// ===================================================================== FX hub
export class FX {
  constructor(scene) {
    this.scene = scene;
    this.particles = new Particles(scene);
    this.text = new FloatText(scene);
    this.rings = [];
    this.flashes = [];
    this.beams = [];
    this.arcs = Array.from({ length: 10 }, () => new Ribbon(scene, 20));
    this.tether = new Ribbon(scene, 24);
    this.shards = [];
    this.columns = [];
  }

  ring(pos, normal, color, { size = 1.5, life = 0.45, from = 0.2 } = {}) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    });
    const m = new THREE.Mesh(ringGeo, mat);
    m.position.copy(pos);
    m.lookAt(_v.copy(pos).add(normal));
    m.renderOrder = 5;
    this.scene.add(m);
    this.rings.push({ m, t: 0, life, size, from });
  }

  // Soft additive bloom sprite (reads as a burst of light, not a solid ball).
  flash(pos, color, size = 0.5, life = 0.18) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.position.copy(pos); m.renderOrder = 6; this.scene.add(m);
    this.flashes.push({ m, t: 0, life, size: size * 2.6 });
  }

  // Jagged lightning between two points.
  lightning(a, b, color, life = 0.16, jag = 0.18) {
    const r = this.arcs.find((x) => x.life <= 0) || this.arcs[0];
    const n = r.n;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      r.pts[i].lerpVectors(a, b, k);
      if (i > 0 && i < n - 1) {
        const amp = jag * Math.sin(k * Math.PI);
        r.pts[i].x += (Math.random() - 0.5) * amp; r.pts[i].y += (Math.random() - 0.5) * amp; r.pts[i].z += (Math.random() - 0.5) * amp;
      }
    }
    r.mat.uniforms.uColor.value.set(color);
    r.life = r.max = life; r.width = 0.035; r.mesh.visible = true; r.dirty = true;
  }

  // Force tether from hand to held enemy (call every frame while held).
  setTether(a, b, t, eye, on) {
    const r = this.tether;
    r.mesh.visible = on;
    if (!on) return;
    for (let i = 0; i < r.n; i++) {
      const k = i / (r.n - 1);
      r.pts[i].lerpVectors(a, b, k);
      const w = Math.sin(k * Math.PI) * 0.06;
      r.pts[i].x += Math.sin(t * 19 + k * 11) * w; r.pts[i].y += Math.cos(t * 23 + k * 9) * w;
    }
    r.mat.uniforms.uColor.value.set(0xffd27a);
    r.mat.uniforms.uAlpha.value = 0.75 + 0.25 * Math.sin(t * 30);
    r.build(eye, 0.03);
  }

  // Column of light where an enemy warps in.
  pillar(pos, color, life = BEAT_PILLAR) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
        void main(){ float a = pow(1.0 - vUv.y, 2.0) * (0.5 + 0.5 * sin(vUv.x * 6.2831 * 6.0 + vUv.y * 20.0)) * uAlpha;
        gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.3) * a, 1.0);
        #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    });
    const m = new THREE.Mesh(pillarGeo, mat);
    m.position.set(pos.x, 0, pos.z);
    this.scene.add(m);
    this.columns.push({ m, t: 0, life });
    this.ring(new V(pos.x, 0.03, pos.z), new V(0, 1, 0), color, { size: 2.2, life: life * 0.8, from: 0.4 });
  }

  addBeam(obj) { this.scene.add(obj); this.beams.push(obj); }
  removeBeam(obj) { this.scene.remove(obj); obj.userData.mat.dispose(); this.beams.splice(this.beams.indexOf(obj), 1); }

  // Break an enemy apart: each mesh flies off with spin, then shrinks away.
  shatter(meshes, origin, dir) {
    for (const m of meshes) {
      this.scene.attach(m);
      m.getWorldPosition(_v);
      const out = _w.subVectors(_v, origin); out.y = 0; out.normalize();
      const vel = out.multiplyScalar(1.2 + Math.random() * 2).add(dir.clone().multiplyScalar(2)).add(new V(0, 1.5 + Math.random() * 2.5, 0));
      this.shards.push({ m, vel: vel.clone(), spin: new V(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5), t: 0, s0: m.scale.clone() });
    }
  }

  update(dt, eye, viewportH) {
    this.particles.update(dt, viewportH);
    this.text.update(dt);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt;
      const k = r.t / r.life, e = 1 - Math.pow(1 - Math.min(1, k), 3);
      r.m.scale.setScalar(r.from + (r.size - r.from) * e);
      r.m.material.uniforms.uAlpha.value = 1 - k;
      if (k >= 1) { this.scene.remove(r.m); r.m.material.dispose(); this.rings.splice(i, 1); }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]; f.t += dt;
      const k = f.t / f.life;
      f.m.scale.setScalar(f.size * (0.5 + 0.7 * Math.sqrt(k)));
      f.m.material.opacity = Math.pow(1 - k, 1.5);
      if (k >= 1) { this.scene.remove(f.m); f.m.material.dispose(); this.flashes.splice(i, 1); }
    }
    for (let i = this.columns.length - 1; i >= 0; i--) {
      const c = this.columns[i]; c.t += dt;
      const k = c.t / c.life;
      c.m.scale.set(1 - k * 0.8, 1 + k * 0.3, 1 - k * 0.8);
      c.m.material.uniforms.uAlpha.value = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      if (k >= 1) { this.scene.remove(c.m); c.m.material.dispose(); this.columns.splice(i, 1); }
    }
    for (const r of this.arcs) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      r.mat.uniforms.uAlpha.value = (r.life / r.max) * (0.6 + Math.random() * 0.4);
      r.build(eye, r.width);
    }
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i]; s.t += dt;
      s.vel.y -= 9.8 * dt;
      s.m.position.addScaledVector(s.vel, dt);
      if (s.m.position.y < 0.05 && s.vel.y < 0 && s.m.position.length() < 7.2) { s.m.position.y = 0.05; s.vel.y *= -0.3; s.vel.x *= 0.6; s.vel.z *= 0.6; s.spin.multiplyScalar(0.6); }
      s.m.rotation.x += s.spin.x * dt; s.m.rotation.y += s.spin.y * dt; s.m.rotation.z += s.spin.z * dt;
      const k = Math.max(0, 1 - Math.max(0, s.t - 0.9) / 0.6);
      s.m.scale.copy(s.s0).multiplyScalar(k);
      if (s.t > 1.5) { this.scene.remove(s.m); this.shards.splice(i, 1); }
    }
  }
}
let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c); _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}
const pillarGeo = new THREE.CylinderGeometry(0.5, 0.5, 7, 24, 1, true).translate(0, 3.5, 0);
const BEAT_PILLAR = 1.2;
