// In-headset UI. Nothing is head-locked except the brief damage vignette:
// vitals live on your off-hand wrist, the combo counter lazily follows your gaze,
// and cadence is shown on the sword's blade itself.
import * as THREE from 'three';
import { ELEMENTS, CAD_MAX, PIP } from './config.js';

const V = THREE.Vector3;

function canvasPlane(w, h, worldW, worldH, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, ...opts });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), mat);
  return { c, ctx: c.getContext('2d'), tex, mat, mesh };
}
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';

// ===================================================================== wrist
export class WristDisplay {
  constructor(forearm, hand) {
    const s = hand === 'left' ? -1 : 1;
    this.p = canvasPlane(512, 300, 0.1, 0.0586);
    const m = this.p.mesh;
    // Face out of the back of the wrist, reading left→right with the forearm
    // held across the chest (like checking a watch).
    const x = new V(0, s, 0), z = new V(s, 0, 0), y = new V().crossVectors(z, x);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    m.position.set(s * 0.047, 0.11, 0);
    m.renderOrder = 8;
    forearm.add(m);
    this.key = '';
    this.last = 0;
  }
  draw(st, now) {
    const key = [Math.round(st.hp), Math.round(st.cad), st.el, st.score, st.wave, st.reload ? Math.round(st.reload * 20) : 0].join('|');
    if (key === this.key || now - this.last < 80) return;
    this.key = key; this.last = now;
    const x = this.p.ctx, W = 512, H = 300;
    x.clearRect(0, 0, W, H);
    x.fillStyle = 'rgba(9,11,22,0.9)'; x.strokeStyle = 'rgba(255,210,122,0.8)'; x.lineWidth = 4;
    x.beginPath(); x.roundRect(4, 4, W - 8, H - 8, 26); x.fill(); x.stroke();
    if (st.reload) {
      x.fillStyle = '#ffd27a'; x.font = `800 54px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('RELOADING', W / 2, 110);
      x.fillStyle = 'rgba(255,255,255,.15)'; x.fillRect(60, 170, W - 120, 30);
      x.fillStyle = '#ffd27a'; x.fillRect(60, 170, (W - 120) * Math.min(1, st.reload), 30);
      this.p.tex.needsUpdate = true;
      return;
    }
    // HP
    const hpK = Math.max(0, st.hp / st.hpMax);
    x.fillStyle = 'rgba(255,255,255,0.1)'; x.beginPath(); x.roundRect(30, 28, W - 60, 56, 14); x.fill();
    x.fillStyle = hpK > 0.5 ? '#4ade80' : hpK > 0.25 ? '#facc15' : '#f43f5e';
    x.beginPath(); x.roundRect(30, 28, Math.max(28, (W - 60) * hpK), 56, 14); x.fill();
    x.fillStyle = '#0b0d18'; x.font = `800 38px ${FONT}`; x.textAlign = 'left'; x.textBaseline = 'middle';
    x.fillText(`♥ ${Math.ceil(st.hp)}`, 46, 58);
    // cadence pips
    const el = ELEMENTS[st.el];
    const pips = CAD_MAX / PIP, pw = (W - 60 - (pips - 1) * 12) / pips;
    for (let i = 0; i < pips; i++) {
      const k = Math.min(1, Math.max(0, (st.cad - i * PIP) / PIP)), px = 30 + i * (pw + 12);
      x.fillStyle = 'rgba(255,255,255,0.1)'; x.beginPath(); x.roundRect(px, 108, pw, 46, 10); x.fill();
      if (k > 0) {
        x.fillStyle = k >= 1 ? el.css : 'rgba(255,255,255,0.35)';
        x.beginPath(); x.roundRect(px, 108, pw * k, 46, 10); x.fill();
      }
    }
    // element badges
    ELEMENTS.forEach((e, i) => {
      const cx = 66 + i * 82, cy = 222, on = i === st.el;
      x.beginPath(); x.arc(cx, cy, on ? 34 : 24, 0, Math.PI * 2);
      x.fillStyle = on ? e.css : 'rgba(255,255,255,0.12)'; x.fill();
      x.fillStyle = on ? '#0b0d18' : e.css; x.font = `800 ${on ? 22 : 17}px ${FONT}`; x.textAlign = 'center';
      x.fillText(e.name, cx, cy + 1);
    });
    x.textAlign = 'right'; x.fillStyle = '#fff'; x.font = `800 50px ${FONT}`;
    x.fillText(st.score.toLocaleString(), W - 34, 208);
    x.fillStyle = 'rgba(255,210,122,0.9)'; x.font = `700 26px ${FONT}`;
    x.fillText(st.wave ? `WAVE ${st.wave}` : 'CADENCE', W - 34, 252);
    this.p.tex.needsUpdate = true;
  }
}

// ===================================================================== combo / message HUD (lazy follow)
export class ComboHud {
  constructor(scene) {
    this.group = new THREE.Group();
    this.p = canvasPlane(640, 300, 0.6, 0.281, { depthTest: false });
    this.p.mesh.renderOrder = 30;
    this.group.add(this.p.mesh);
    this.dots = [];
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.011, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, toneMapped: false }));
      d.position.set((i - 1.5) * 0.042, -0.044, 0.001); d.renderOrder = 31;
      this.group.add(d); this.dots.push(d);
    }
    scene.add(this.group);
    this.yaw = 0; this.pos = new V(); this.init = false;
    this.key = ''; this.msg = ''; this.msgColor = '#fff'; this.msgUntil = 0; this.hint = ''; this.hintUntil = 0;
    this.combo = 0; this.label = ''; this.bump = 0;
  }
  message(text, color = '#ffd27a', dur = 2) { this.msg = text; this.msgColor = color; this.msgUntil = performance.now() + dur * 1000; }
  setHint(text, dur = 5) { this.hint = text; this.hintUntil = performance.now() + dur * 1000; }
  update(dt, head, fwd, combo, label, beatInBar, pulse, visible) {
    this.group.visible = visible;
    if (!visible) return;
    const yaw = Math.atan2(fwd.x, fwd.z);
    if (!this.init) { this.yaw = yaw; this.init = true; }
    let d = yaw - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > 0.35) this.yaw += d * Math.min(1, dt * 2.5); // lazy follow outside a dead zone
    this.pos.set(head.x + Math.sin(this.yaw) * 1.45, head.y - 0.5, head.z + Math.cos(this.yaw) * 1.45);
    this.group.position.lerp(this.pos, this.group.position.lengthSq() ? Math.min(1, dt * 6) : 1);
    this.group.lookAt(head);
    if (combo > this.combo) this.bump = 1;
    this.combo = combo;
    this.bump *= Math.exp(-dt * 10);
    this.p.mesh.scale.setScalar(1 + this.bump * 0.08);
    this.dots.forEach((dm, i) => {
      const on = i === beatInBar;
      dm.scale.setScalar(on ? 1 + pulse * 0.9 : 0.75);
      dm.material.color.setHex(on ? (i === 0 ? 0xffd27a : 0xffffff) : 0x55607a);
      dm.material.opacity = on ? 0.5 + pulse * 0.5 : 0.45;
    });
    const now = performance.now();
    const msg = now < this.msgUntil ? this.msg : '';
    const hint = now < this.hintUntil ? this.hint : '';
    const key = `${combo}|${label}|${msg}|${hint}`;
    if (key === this.key) return;
    this.key = key;
    const x = this.p.ctx, W = 640, H = 300;
    x.clearRect(0, 0, W, H);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if (msg) {
      x.font = `900 64px ${FONT}`; x.lineWidth = 10; x.strokeStyle = 'rgba(0,0,0,.7)'; x.lineJoin = 'round';
      x.strokeText(msg, W / 2, 48, W - 20);
      x.fillStyle = this.msgColor; x.fillText(msg, W / 2, 48, W - 20);
    }
    if (combo > 1) {
      x.font = `900 92px ${FONT}`; x.lineWidth = 12; x.strokeStyle = 'rgba(0,0,0,.6)';
      const txt = `${combo}`;
      x.strokeText(txt, W / 2 - (label ? 40 : 0), 136);
      x.fillStyle = '#fff'; x.fillText(txt, W / 2 - (label ? 40 : 0), 136);
      if (label) {
        x.font = `900 56px ${FONT}`; x.fillStyle = '#ffd27a'; x.textAlign = 'left';
        const w = x.measureText(txt).width;
        x.fillText(label, W / 2 - 40 + w / 2 + 14, 140);
        x.textAlign = 'center';
      }
    }
    if (hint) {
      x.font = `700 32px ${FONT}`; x.fillStyle = 'rgba(8,10,20,.72)';
      const w = Math.min(W - 10, x.measureText(hint).width + 40);
      x.beginPath(); x.roundRect((W - w) / 2, 232, w, 52, 14); x.fill();
      x.fillStyle = '#e8ecff'; x.fillText(hint, W / 2, 259, W - 30);
    }
    this.p.tex.needsUpdate = true;
  }
}

// ===================================================================== board (title / game over)
export class Board {
  constructor(scene) {
    this.p = canvasPlane(1024, 700, 2.0, 1.367);
    this.p.mesh.position.set(0, 2.25, -3.7);
    this.p.mesh.renderOrder = 7;
    scene.add(this.p.mesh);
  }
  set visible(v) { this.p.mesh.visible = v; }
  faceToward(head) {
    const m = this.p.mesh;
    m.position.set(head.x + this._fwd.x * 3.7, 2.25, head.z + this._fwd.z * 3.7);
    m.lookAt(head.x, 2.0, head.z);
  }
  place(head, fwd) {
    this._fwd = new V(fwd.x, 0, fwd.z).normalize();
    this.faceToward(head);
  }
  _frame() {
    const x = this.p.ctx, W = 1024, H = 700;
    x.clearRect(0, 0, W, H);
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(14,16,34,0.92)'); g.addColorStop(1, 'rgba(6,7,16,0.92)');
    x.fillStyle = g; x.strokeStyle = 'rgba(255,210,122,0.7)'; x.lineWidth = 4;
    x.beginPath(); x.roundRect(6, 6, W - 12, H - 12, 34); x.fill(); x.stroke();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    return x;
  }
  title(best, vr) {
    const x = this._frame(), W = 1024;
    x.font = `900 120px ${FONT}`; x.fillStyle = '#ffd27a'; x.shadowColor = '#ff9a3c'; x.shadowBlur = 30;
    x.fillText('CADENCE', W / 2, 108); x.shadowBlur = 0;
    x.font = `600 34px ${FONT}`; x.fillStyle = '#c9d2ff';
    x.fillText('Every strike lands on the beat.', W / 2, 190);
    const rows = vr ? [
      ['SWORD', 'Slash on the beat · big swing at range fires a beam'],
      ['A / B', 'Change element — mix two on one enemy for a reaction'],
      ['OFF-HAND', 'Trigger: grab, flick to throw · Grip: force push'],
      ['DEFEND', 'Red = incoming. Block with your blade, or PERFECT hit to interrupt'],
      ['STICKS', 'Left: move · Right: turn · Squeeze both grips 1s: reload'],
    ] : [
      ['MOUSE', 'Move the sword — swing through enemies on the beat'],
      ['1 2 3 / E', 'Change element — mix two on one enemy for a reaction'],
      ['Q / F', 'Q hold: grab, release to throw · F: force push'],
      ['DEFEND', 'Red = incoming. Block with your blade, or PERFECT hit to interrupt'],
      ['WASD', 'Move · ← → or right-drag to turn'],
    ];
    rows.forEach(([k, v], i) => {
      const y = 280 + i * 64;
      x.textAlign = 'right'; x.font = `800 28px ${FONT}`; x.fillStyle = '#ffd27a'; x.fillText(k, 270, y);
      x.textAlign = 'left'; x.font = `500 28px ${FONT}`; x.fillStyle = '#e6e9ff'; x.fillText(v, 300, y, 690);
    });
    x.textAlign = 'center'; x.font = `800 34px ${FONT}`; x.fillStyle = '#fff';
    x.fillText('Slash the crystal on the beat to begin', W / 2, 620);
    if (best) { x.font = `600 24px ${FONT}`; x.fillStyle = 'rgba(255,210,122,.8)'; x.fillText(`best ${best.toLocaleString()}`, W / 2, 664); }
    this.p.tex.needsUpdate = true;
  }
  gameOver(s) {
    const x = this._frame(), W = 1024;
    x.font = `900 104px ${FONT}`; x.fillStyle = '#f43f5e'; x.shadowColor = '#f43f5e'; x.shadowBlur = 26;
    x.fillText('DEFEATED', W / 2, 110); x.shadowBlur = 0;
    x.font = `900 96px ${FONT}`; x.fillStyle = '#fff'; x.fillText(s.score.toLocaleString(), W / 2, 240);
    x.font = `700 30px ${FONT}`; x.fillStyle = s.newBest ? '#ffd27a' : 'rgba(255,255,255,.6)';
    x.fillText(s.newBest ? 'NEW BEST' : `best ${s.best.toLocaleString()}`, W / 2, 310);
    const stats = [['WAVE', s.wave], ['KILLS', s.kills], ['MAX COMBO', s.maxCombo], ['PERFECT', `${s.perfectPct}%`], ['REACTIONS', s.reactions], ['PARRIES', s.parries]];
    stats.forEach(([k, v], i) => {
      const cx = 200 + (i % 3) * 312, cy = 410 + Math.floor(i / 3) * 100;
      x.font = `900 52px ${FONT}`; x.fillStyle = '#fff'; x.fillText(`${v}`, cx, cy);
      x.font = `700 22px ${FONT}`; x.fillStyle = '#ffd27a'; x.fillText(k, cx, cy + 42);
    });
    x.font = `800 32px ${FONT}`; x.fillStyle = '#e6e9ff';
    x.fillText('Slash the crystal to go again', W / 2, 640);
    this.p.tex.needsUpdate = true;
  }
}

// ===================================================================== vignette
export class Vignette {
  constructor(camera) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 }, uColor: { value: new THREE.Color(0xff1030) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform float uA; uniform vec3 uColor; varying vec2 vUv;
        void main(){ float r = length(vUv - 0.5) * 2.0; float a = smoothstep(0.35, 1.05, r) * uA; gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
        }`,
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), this.mat);
    this.mesh.position.z = -0.12; this.mesh.renderOrder = 100; this.mesh.frustumCulled = false;
    camera.add(this.mesh);
    this.hit = 0;
  }
  flash(k = 1) { this.hit = Math.max(this.hit, k); }
  update(dt, hpK) {
    this.hit *= Math.exp(-dt * 4);
    const low = hpK < 0.3 ? (0.3 - hpK) * 1.4 * (0.75 + 0.25 * Math.sin(performance.now() * 0.006)) : 0;
    this.mat.uniforms.uA.value = Math.min(0.85, this.hit * 0.85 + low);
    this.mesh.visible = this.mat.uniforms.uA.value > 0.01;
  }
}

// ===================================================================== desktop DOM HUD
export class DomHud {
  constructor() {
    this.el = document.getElementById('hud');
    this.hp = document.getElementById('hpfill');
    this.pips = document.getElementById('pips');
    this.elem = document.getElementById('elem');
    this.score = document.getElementById('score');
    this.combo = document.getElementById('combo');
    this.key = '';
  }
  update(st) {
    const key = [Math.round(st.hp), Math.round(st.cad), st.el, st.score, st.combo, st.label].join('|');
    if (key === this.key) return;
    this.key = key;
    const hpK = Math.max(0, st.hp / st.hpMax);
    this.hp.style.width = `${hpK * 100}%`;
    this.hp.style.background = hpK > 0.5 ? '#4ade80' : hpK > 0.25 ? '#facc15' : '#f43f5e';
    const el = ELEMENTS[st.el];
    this.pips.innerHTML = Array.from({ length: CAD_MAX / PIP }, (_, i) => {
      const k = Math.min(1, Math.max(0, (st.cad - i * PIP) / PIP));
      return `<i style="background:linear-gradient(90deg,${k >= 1 ? el.css : 'rgba(255,255,255,.4)'} ${k * 100}%,rgba(255,255,255,.1) 0)"></i>`;
    }).join('');
    this.elem.textContent = el.name; this.elem.style.color = el.css;
    this.score.textContent = st.score.toLocaleString();
    this.combo.textContent = st.combo > 1 ? `${st.combo} ${st.label}` : '';
  }
}
