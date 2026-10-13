// Movement lab: eight ways to get around, each with a course of glowing motes
// to collect against the clock. While the lab runs it owns the rig's
// translation (Player.labMove); right-stick turning stays on everywhere.
//
// The body is the rig: feet at rig.position.y, standing under the head. It has
// a velocity, gravity, and lands on the arena floor or on floating platforms
// (one-way: you can rise through them and land on top).
import * as THREE from 'three';
import { ARENA_R } from './config.js';
import { BTN } from './player.js';
import { glowTexture, Ribbon } from './fx.js';

const V = THREE.Vector3;
const _a = new V(), _b = new V(), _c = new V(), _d = new V(), _h = new V(), _q = new THREE.Quaternion();
const G = 11;                 // gravity: a touch heavier than Earth for snappier arcs
const ROLES = ['sword', 'force'];
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const GRADE_CSS = { perfect: '#ffd27a', good: '#dfe6ff', off: '#8a90a8' };

// Floating stepping stones.
const PLATFORMS = [
  { x: 3.9, z: -2.6, r: 1.1, y: 1.1 },
  { x: 4.6, z: 1.4, r: 1.0, y: 2.2 },
  { x: -3.8, z: -3.0, r: 1.2, y: 1.6 },
  { x: -4.7, z: 2.4, r: 1.0, y: 3.0 },
  { x: -2.8, z: -8.6, r: 1.5, y: 0.6 },   // out past the edge
  { x: 7.3, z: 5.3, r: 1.3, y: 2.6 },     // out past the edge
];
// Grapple anchors: one above each monolith (see world.js), plus a few over the arena.
const ANCHORS = [];
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2 + Math.PI / 10;
  ANCHORS.push(new V(Math.cos(a) * 10.5, 1.2 + (i % 3) * 0.6 + 3.5 + 1.1, Math.sin(a) * 10.5));
}
ANCHORS.push(new V(0, 6.6, -3.6), new V(4.4, 6.2, 0.4), new V(-4.4, 6.2, 0.4), new V(2.4, 7, 4.6), new V(-2.4, 7, 4.6));

const pts = (list, y) => list.map(([x, z, yy]) => new V(x, yy ?? y, z));

export const LAB_MODES = [
  {
    id: 'stick', name: 'STICK+', sub: 'sprint · crouch to slide', color: 0x8ad8ff, ground: true,
    vr: ['Left stick moves. CLICK the stick to sprint.', 'While sprinting, really crouch down to SLIDE — stay low to keep it going.', 'Steer the slide with the stick.'],
    desk: ['WASD moves. Hold Shift to sprint.', 'While sprinting, hold C to crouch into a SLIDE.', 'Steer the slide with WASD.'],
    course: pts([[0, -3.2], [3.4, -4.4], [5.3, -1.2], [4.2, 3.2], [0.6, 5.3], [-3.6, 4.1], [-5.3, 0.2], [-3.4, -4.2]], 1.3),
  },
  {
    id: 'dash', name: 'BEAT DASH', sub: 'flick the stick on the beat', color: 0xffd27a, ground: true,
    vr: ['FLICK the left stick in any direction to dash that way.', 'On the beat: a long dash that builds combo. Off it: short, with a cooldown.', 'Hold the stick to walk slowly.'],
    desk: ['Shift + a WASD direction dashes (Shift alone: forward).', 'On the beat: a long dash that builds combo. Off it: short, with a cooldown.', 'WASD walks slowly.'],
    course: pts([[0, -2.6], [2.6, -3.6], [0.4, -5.3], [-2.6, -3.8], [-4.8, -1.2], [-2.4, 1.6], [1.8, 2.6], [4.6, 0.4]], 1.3),
  },
  {
    id: 'lunge', name: 'LUNGE', sub: 'stab the air to lunge', color: 0xff8a2a, ground: true, walk: true,
    vr: ['STAB: thrust the sword fast along the blade to lunge that way.', 'On the beat: a longer lunge that builds combo.', 'Left stick walks.'],
    desk: ['Space lunges toward the cursor.', 'On the beat: a longer lunge that builds combo.', 'WASD walks.'],
    course: pts([[0, -2.4], [2.2, -4], [4.6, -3], [5.2, -0.4], [3.2, 2.2], [0.4, 3.4], [-2.6, 2.6], [-4.6, 0]], 1.25),
  },
  {
    id: 'arms', name: 'ARM SWING', sub: 'pump your arms to run', color: 0x4ade80, ground: true,
    vr: ['Hold BOTH triggers and pump your arms like you\'re running.', 'Pump harder to run faster. You run where you look.', 'No stick here: just arms.'],
    desk: ['VR mechanic. On desktop, hold Space to run where you look.', '', ''],
    course: pts([[0, -5.2], [4.6, -2.4], [4.2, 3], [0, 5.4], [-4.4, 2.6], [-4.6, -2.6]], 1.3),
  },
  {
    id: 'climb', name: 'AIR GRAB', sub: 'grab the air · pull · fling', color: 0x56d8ff,
    vr: ['GRIP anywhere to grab the air itself, then pull yourself along.', 'Let go mid-pull to FLING yourself. Gravity is on: climb up, drop down.', 'Grip-reload is off here (hold X to leave first).'],
    desk: ['VR mechanic: grip to grab the air, pull, let go to fling.', '', ''],
    course: pts([[0, -1.8, 2.5], [1.6, -2.2, 3.6], [0.2, -2.6, 4.9], [-1.8, -1.4, 4.1], [-2.8, 0.6, 2.7], [2.6, 1.2, 3.0]]),
  },
  {
    id: 'grapple', name: 'GRAPPLE', sub: 'tether to crystals · swing', color: 0xb68cff, walk: true, air: true,
    vr: ['Point a hand (or the blade) at a crystal anchor until it rings, then pull that TRIGGER.', 'Hold to reel in, let go to FLING. Use both hands to swing hand to hand.', 'Fire on the beat to reel faster. Left stick walks.'],
    desk: ['Put the cursor on an anchor: hold Q (off-hand) or left mouse (sword hand).', 'Hold to reel in, let go to fling.', 'WASD walks.'],
    course: pts([[0, -5.2, 4.6], [5.6, -5.8, 5.6], [9.2, -1.8, 4.8], [6.8, 5, 4.4], [0, 8.2, 5.2], [-6.8, 5, 4.4], [-9.2, -1.8, 4.8], [-5.6, -5.8, 5.6]]),
  },
  {
    id: 'leap', name: 'LEAP + GLIDE', sub: 'force jump · spread arms', color: 0xffe2a0, walk: true, air: true,
    vr: ['Off-hand GRIP pushes: you fly AWAY from your palm. Aim down to jump, down-back to leap.', 'One more push in mid-air. Spread both arms wide to GLIDE where you look.', 'Chop the sword down hard in mid-air to GROUND-POUND. Stick walks.'],
    desk: ['Space leaps where you look. F pushes away from where you look (once in mid-air).', 'Hold G to glide. C in mid-air to ground-pound.', 'WASD walks.'],
    course: pts([[0, -3, 2.6], [3.9, -2.6, 2.9], [4.6, 1.4, 3.9], [0, 2.2, 3.4], [-3.8, -3, 3.3], [-4.7, 2.4, 4.6], [-2.8, -8.6, 2.3], [0, -5.5, 4.4]]),
  },
  {
    id: 'warp', name: 'SWORD WARP', sub: 'throw the sword · warp to it', color: 0xff7ad0, walk: true, air: true,
    vr: ['Hold the sword TRIGGER, swing, and let go to THROW the sword.', 'Pull the trigger again to WARP to it: mid-flight, or wherever it stuck.', 'Throw it onto a platform to get up there. Warp on the beat to hover.'],
    desk: ['Hold left mouse, flick, release: throw the sword.', 'Click again to warp to it.', 'WASD walks.'],
    course: pts([[3.9, -2.6, 2.5], [4.6, 1.4, 3.6], [-3.8, -3, 3.0], [-4.7, 2.4, 4.4], [-2.8, -8.6, 2.0], [7.3, 5.3, 4.0], [0, 5, 1.4], [0, -5, 1.4]]),
  },
];

// Black tunnel vision that closes in with speed (comfort), plus a blink for warps.
class Tunnel {
  constructor(camera) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 }, uR: { value: 0.5 }, uBlink: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uA, uR, uBlink; varying vec2 vUv;
        void main() { float r = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(0.0, 0.0, 0.0, max(smoothstep(uR, uR + 0.2, r) * uA, uBlink)); }`,
      transparent: true, depthTest: false, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), this.mat);
    this.mesh.position.z = -0.115; this.mesh.renderOrder = 99; this.mesh.frustumCulled = false; this.mesh.visible = false;
    camera.add(this.mesh);
    this.on = true; this.k = 0; this.blinkK = 0;
  }
  blink() { this.blinkK = 1; }
  update(dt, speed, active) {
    const target = active && this.on ? clamp((speed - 2.5) / 8, 0, 1) : 0;
    this.k += (target - this.k) * Math.min(1, dt * 6);
    this.blinkK = active ? this.blinkK * Math.exp(-dt * 12) : 0;
    const u = this.mat.uniforms;
    u.uA.value = this.k * 0.85; u.uR.value = 0.55 - 0.2 * this.k; u.uBlink.value = this.blinkK;
    this.mesh.visible = this.k > 0.01 || this.blinkK > 0.01;
  }
}

function ringTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.strokeStyle = '#fff'; x.lineWidth = 7;
  for (let i = 0; i < 4; i++) { x.beginPath(); x.arc(64, 64, 52, i * Math.PI / 2 + 0.25, i * Math.PI / 2 + Math.PI / 2 - 0.25); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class MovementLab {
  constructor({ game, player, scene, board, fade, comboHud, audio, fx }) {
    Object.assign(this, { game, player, scene, board, fade, comboHud, audio, fx });
    this.group = new THREE.Group(); this.group.visible = false;
    scene.add(this.group);
    this._buildPlatforms(); this._buildAnchors(); this._buildMotes();
    this.tunnel = new Tunnel(player.camera);
    this.tunnel.on = localStorage.getItem('cadence.tunnel') !== '0';
    this.tethers = { sword: new Ribbon(scene, 16), force: new Ribbon(scene, 16) };
    this.best = JSON.parse(localStorage.getItem('cadence.labBest') || '{}');
    this.active = false; this.idx = 0;
    this.vel = new V(); this.grounded = true;
    this.onModeChange = null;
    this._kp = {};
    this.dirty = true; this._lastDraw = 0;
  }
  get def() { return LAB_MODES[this.idx]; }
  get label() { return `MOVE · ${this.def.name}`; }

  // ------------------------------------------------------------------ build
  _buildPlatforms() {
    const stone = new THREE.MeshStandardMaterial({ color: 0x2c3148, roughness: 0.85, metalness: 0.1, flatShading: true });
    const gold = new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false });
    const tex = glowTexture();
    for (const p of PLATFORMS) {
      const g = new THREE.Group();
      const top = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 0.8, 0.3, 28).translate(0, -0.15, 0), stone);
      const keel = new THREE.Mesh(new THREE.ConeGeometry(p.r * 0.78, p.r * 1.4, 9).rotateX(Math.PI).translate(0, -0.3 - p.r * 0.7, 0), stone);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(p.r, 0.025, 5, 48), gold);
      rim.rotation.x = Math.PI / 2; rim.position.y = 0.01;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x6b8cff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      glow.scale.setScalar(p.r * 2.6); glow.position.y = -0.9 - p.r * 0.4;
      g.add(top, keel, rim, glow);
      g.position.set(p.x, p.y, p.z);
      this.group.add(g);
    }
  }
  _buildAnchors() {
    this.anchorGroup = new THREE.Group();
    this.group.add(this.anchorGroup);
    const geo = new THREE.OctahedronGeometry(0.24, 0), tex = glowTexture();
    this.anchors = ANCHORS.map((pos) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0xb68cff, emissive: 0xb68cff, emissiveIntensity: 0.8, flatShading: true, roughness: 0.3 });
      const gem = new THREE.Mesh(geo, mat); gem.scale.y = 1.5;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xb68cff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      halo.scale.setScalar(1.4);
      const g = new THREE.Group(); g.add(gem, halo); g.position.copy(pos);
      this.anchorGroup.add(g);
      return { pos, g, gem, mat, flash: 0 };
    });
    const rt = ringTexture();
    this.reticles = {};
    for (const role of ROLES) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: rt, color: role === 'force' ? 0xffd27a : 0xffffff, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
      s.scale.setScalar(1.1); s.visible = false; s.renderOrder = 8;
      this.group.add(s);
      this.reticles[role] = s;
    }
  }
  _buildMotes() {
    const tex = glowTexture(), core = new THREE.OctahedronGeometry(0.07, 0);
    this.motes = [];
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group();
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      halo.scale.setScalar(0.55);
      const gem = new THREE.Mesh(core, new THREE.MeshBasicMaterial({ toneMapped: false }));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V(0, 0, 0), new V(0, -1, 0)]),
        new THREE.LineBasicMaterial({ transparent: true, opacity: 0.22, toneMapped: false }));
      g.add(halo, gem, line);
      this.group.add(g);
      this.motes.push({ g, halo, gem, line, base: new V(), on: false });
    }
  }

  // ------------------------------------------------------------------ lifecycle
  start() {
    const P = this.player;
    this.active = true;
    this.group.visible = true;
    P.labMove = true;
    this.wind = this.audio.wind();
    this.standH = P.vr ? Math.max(1.2, P.camera.position.y) : 1.6;
    this.setMode(this.idx);
  }
  stop() {
    if (!this.active) return;
    const P = this.player;
    this._cleanupMode();
    this.active = false;
    this.group.visible = false;
    P.labMove = false; P.noReload = false;
    if (!P.vr) P.camera.position.y = 1.6;
    this.wind?.stop(); this.wind = null;
    this.tunnel.k = 0; this.tunnel.update(0, 0, false);
    P.rig.position.y = 0;
  }
  setMode(i) {
    const P = this.player;
    this._cleanupMode();
    this.idx = ((i % LAB_MODES.length) + LAB_MODES.length) % LAB_MODES.length;
    const d = this.def;
    P.noReload = d.id === 'climb';
    this.anchorGroup.visible = d.id === 'grapple';
    Object.assign(this, {
      burst: null, sliding: false, sprint: false, crouched: false, pounding: false, gliding: false, holding: false,
      airPushes: 1, airT: 0, runSpeed: 0, dashReady: 0, lungeArmed: true, hoverUntil: 0, flickReady: true, flickLowT: 0,
      ropes: { sword: null, force: null }, trig: { sword: false, force: false }, warpTrig: false, warpRelease: false, thrown: null,
      grabs: { sword: { on: false, anchor: new V() }, force: { on: false, anchor: new V() } }, dragVel: new V(),
      stats: { top: 0, air: 0, n: {} }, last: null, speed: 0,
    });
    this.hands = {};
    for (const role of ROLES) this.hands[role] = { y: P.handLocal(role, _a).y, vy: 0, sign: 0 };
    this._resetCourse();
    this.comboHud.message(d.name, hex(d.color), 1.6);
    this.board.setPose(new V(1.5, 2.35, -3.1), new V(0, 1.7, 0), 0.85);
    this.board.visible = true;
    this.dirty = true;
    this.onModeChange?.(this.idx);
  }
  _cleanupMode() {
    if (this.thrown) this._returnSword();
    for (const role of ROLES) { this.tethers[role].mesh.visible = false; this.reticles[role].visible = false; }
    this.ropes = { sword: null, force: null };
  }
  respawn() {
    this.fade.run(() => {
      this._cleanupMode();
      this.player.teleport(0, 0, 0);
      this.vel.set(0, 0, 0); this.grounded = true; this.burst = null; this.pounding = false;
      this._msg('FELL — back to the centre', '#8a90a8');
    });
  }

  // ------------------------------------------------------------------ per frame
  update(dt, t, now) {
    if (!this.active) return;
    const P = this.player, I = P.input, N = LAB_MODES.length;
    if (I.elemNext) this.setMode(this.idx + 1);
    if (I.elemPrev) this.setMode(this.idx - 1);
    if (I.num >= 1 && I.num <= N) this.setMode(I.num - 1);
    if (I.toggleDown) {
      this.tunnel.on = !this.tunnel.on;
      localStorage.setItem('cadence.tunnel', this.tunnel.on ? '1' : '0');
      this.comboHud.message(this.tunnel.on ? 'COMFORT TUNNEL ON' : 'COMFORT TUNNEL OFF', '#4ade80', 1.4);
      this.dirty = true;
    }
    if (this.fade.busy) { this.vel.set(0, 0, 0); this._keys(); return; }

    this.supported = false; this.ctl = false; this.friction = 9; this.glide = false;
    switch (this.def.id) {
      case 'stick': this._stick(dt); break;
      case 'dash': this._dash(dt, now); break;
      case 'lunge': this._lunge(dt, now); break;
      case 'arms': this._arms(dt); break;
      case 'climb': this._climb(dt); break;
      case 'grapple': this._grapple(dt); break;
      case 'leap': this._leap(dt, now); break;
      case 'warp': this._warp(dt, now); break;
    }
    if (this.def.walk && !this.burst) this._walk(dt, 2.2);
    if (now < this.hoverUntil) { this.supported = true; this.vel.y = Math.max(0, this.vel.y); }
    this._integrate(dt);
    if (this.def.id === 'grapple') this._ropes(dt, t);
    this._bursts(dt);
    this._ground(dt);
    if (this.def.ground) this._clampToArena();
    P.camera.getWorldPosition(P.head);   // later systems see where we are now

    this._collect(now);
    this._track(dt, now);
    this._animate(dt, t);
    if (P.rig.position.y < -7) this.respawn();
    this._keys();
    if (this.course.t0 && !this.course.done && now - this._lastDraw > 250) this.dirty = true;
    if (this.dirty && now - this._lastDraw > 120) { this._draw(now); this._lastDraw = now; this.dirty = false; }
  }
  onBeat(b) {
    if (!this.active) return;
    this.player.pulse('force', b % 4 === 0 ? 0.2 : 0.08, 14);   // metronome for the beat-timed moves
  }

  // ------------------------------------------------------------------ body physics
  _floorAt(x, z, feetY) {
    let best = -Infinity;
    if (x * x + z * z < (ARENA_R - 0.1) ** 2 && feetY >= -0.35) best = 0;
    for (const p of PLATFORMS) {
      if ((x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r && feetY >= p.y - 0.35 && p.y > best) best = p.y;
    }
    return best;
  }
  _integrate(dt) {
    const v = this.vel, rig = this.player.rig;
    if (!this.supported) v.y -= G * (this.glide && v.y < 0 ? 0.3 : 1) * dt; // gliding slows the fall, not the climb
    if (this.glide && v.y < -1.4) v.y += (-1.4 - v.y) * Math.min(1, dt * 8); // sink gently (~1.8 m/s)
    if (this.grounded && !this.ctl) { const f = Math.exp(-this.friction * dt); v.x *= f; v.z *= f; }
    else if (!this.grounded) { const f = Math.exp(-0.05 * dt); v.x *= f; v.z *= f; }
    if (v.length() > 30) v.setLength(30);
    this.prevFeet = rig.position.y;
    rig.position.addScaledVector(v, dt);
  }
  _ground(dt) {
    const P = this.player, rig = P.rig, v = this.vel;
    rig.updateMatrixWorld(true);
    P.camera.getWorldPosition(_h);
    const floor = this._floorAt(_h.x, _h.z, Math.max(rig.position.y, this.prevFeet ?? rig.position.y));
    if (floor > -Infinity && rig.position.y <= floor + 0.001 && v.y <= 0.001) {
      if (!this.grounded) this._land(-v.y);
      rig.position.y = floor; v.y = 0; this.grounded = true;
    } else if (rig.position.y > floor + 0.05) this.grounded = false;
    if (!this.grounded) this.airT += dt;
  }
  _land(impact) {
    const P = this.player;
    if (this.airT > this.stats.air) { this.stats.air = this.airT; this.dirty = true; }
    this.airT = 0; this.airPushes = 1; this.gliding = false;
    P.camera.getWorldPosition(_h); _h.y = P.rig.position.y + 0.03;
    if (this.pounding) {
      this.pounding = false;
      this.fx.ring(_h, _a.set(0, 1, 0), 0xffe2a0, { size: 5, life: 0.6 });
      this.fx.particles.burst(_h, 40, 0xffe2a0, { speed: 5, up: 2, size: 0.05, life: 0.6, grav: -6 });
      this.fx.flash(_h, 0xffe2a0, 1.2, 0.25);
      this.audio.land(1); this.audio.push(_h, true);
      P.pulse('sword', 1, 120); P.pulse('force', 1, 120);
      this._count('pounds'); this._msg('GROUND POUND', '#ffe2a0');
      return;
    }
    if (impact < 2.5) return;
    const k = clamp((impact - 2) / 12, 0, 1);
    this.audio.land(k);
    P.pulse('sword', 0.2 + 0.6 * k, 40); P.pulse('force', 0.2 + 0.6 * k, 40);
    this.fx.ring(_h, _a.set(0, 1, 0), 0x9fb4ff, { size: 1 + 2 * k, life: 0.4 });
    this.fx.particles.burst(_h, Math.round(6 + 18 * k), 0x9fb4ff, { speed: 1.5 + 3 * k, up: 0.6, size: 0.035, life: 0.4 });
  }
  _clampToArena() {
    const P = this.player;
    P.camera.getWorldPosition(_h);
    const r = Math.hypot(_h.x, _h.z), lim = ARENA_R - 0.45;
    if (r > lim) {
      const k = (r - lim) / r, out = (this.vel.x * _h.x + this.vel.z * _h.z) / r;
      P.rig.position.x -= _h.x * k; P.rig.position.z -= _h.z * k;
      if (out > 0) { this.vel.x -= (_h.x / r) * out; this.vel.z -= (_h.z / r) * out; } // slide along the edge
    }
  }
  // Scripted displacement (dash, lunge): exact distance, ease-out, gravity paused.
  _burstStart(dir, dist, dur) {
    this.burst = { dir: dir.clone().setY(0).normalize(), dist, dur, t: 0, moved: 0 };
    this.vel.x = 0; this.vel.z = 0;
  }
  _bursts(dt) {
    const B = this.burst;
    if (!B) return;
    B.t += dt;
    const k = Math.min(1, B.t / B.dur), s = B.dist * (1 - (1 - k) ** 3);
    this.player.rig.position.addScaledVector(B.dir, s - B.moved);
    B.moved = s;
    this.vel.y = Math.max(this.vel.y, 0);
    const P = this.player;
    P.camera.getWorldPosition(_h);
    if (Math.random() < 0.8) this.fx.particles.emit(_a.copy(_h).add(_b.set(0, -0.6 - Math.random() * 0.6, 0)), _b.copy(B.dir).multiplyScalar(-1.5), this.def.color, { size: 0.04, life: 0.3, drag: 3 });
    if (k >= 1) this.burst = null;
  }
  _walk(dt, maxSpeed) {
    const P = this.player, [sx, sy] = P.stick, m = Math.hypot(sx, sy), f = P.flatFwd, v = this.vel;
    if (m > 0.18) {
      const k = (Math.min(1, m) * maxSpeed) / m;
      _a.set((f.x * -sy - f.z * sx) * k, 0, (f.z * -sy + f.x * sx) * k);
    } else _a.set(0, 0, 0);
    if (this.grounded) {
      const r = Math.min(1, dt * 12);
      v.x += (_a.x - v.x) * r; v.z += (_a.z - v.z) * r;
      this.ctl = true;
    } else if (m > 0.18) { v.x += _a.x * dt * 1.5; v.z += _a.z * dt * 1.5; }
  }
  _stickDir(sx, sy) {
    const f = this.player.flatFwd;
    return new V(f.x * -sy - f.z * sx, 0, f.z * -sy + f.x * sx).normalize();
  }

  // ------------------------------------------------------------------ 1. stick+
  _stick(dt) {
    const P = this.player, [sx, sy] = P.stick, m = Math.hypot(sx, sy), v = this.vel;
    if (P.vr) { if (this._padDown('force', BTN.stick)) this.sprint = !this.sprint; if (m < 0.3) this.sprint = false; }
    else {
      this.sprint = !!P.keys['shift'];
      const want = P.keys['c'] ? 1.0 : 1.6;
      P.camera.position.y += (want - P.camera.position.y) * Math.min(1, dt * 12);
    }
    const hy = P.camera.position.y;
    if (P.vr) this.standH = Math.max(this.standH - dt * 0.01, hy);
    else this.standH = 1.6;
    const crouched = hy < this.standH - (this.crouched ? 0.25 : 0.33);
    const hs = Math.hypot(v.x, v.z);
    if (crouched && !this.crouched && this.grounded && hs > 2.8) {
      const boost = Math.min(1.35, 7 / hs);
      v.x *= boost; v.z *= boost;
      this.sliding = true;
      this.audio.dash(false);
      this._count('slides'); this._msg('SLIDE', hex(this.def.color), `${(hs * boost).toFixed(1)} m/s`);
    }
    this.crouched = crouched;
    if (this.sliding && (!crouched || hs < 1.3 || !this.grounded)) this.sliding = false;
    if (this.sliding) {
      this.friction = 0.9;
      if (m > 0.3) { // steer: turn the slide toward the stick
        const want = this._stickDir(sx, sy), cur = Math.atan2(v.x, v.z), tgt = Math.atan2(want.x, want.z);
        let d = tgt - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
        const a = cur + clamp(d, -1.6 * dt, 1.6 * dt);
        v.x = Math.sin(a) * hs; v.z = Math.cos(a) * hs;
      }
      P.camera.getWorldPosition(_h);
      if (Math.random() < 0.7) this.fx.particles.emit(_a.set(_h.x, P.rig.position.y + 0.03, _h.z), _b.set(-v.x * 0.2, 0.6, -v.z * 0.2), 0xffc070, { size: 0.03, life: 0.35, grav: -4, flicker: true });
    } else this._walk(dt, this.sprint ? 4.6 : 2.4);
  }

  // ------------------------------------------------------------------ 2. beat dash
  _dash(dt, now) {
    const P = this.player, [sx, sy] = P.stick, m = Math.hypot(sx, sy);
    let dir = null;
    if (P.vr) {
      if (m < 0.35) { this.flickLowT = now; this.flickReady = true; }
      else if (m > 0.85 && this.flickReady) { this.flickReady = false; if (now - this.flickLowT < 150) dir = this._stickDir(sx, sy); }
    } else if (this._keyDown('shift')) dir = m > 0.1 ? this._stickDir(sx, sy) : P.flatFwd.clone();
    if (dir) {
      if (now < this.dashReady) { this.audio.tick(false); this._msg('COOLDOWN', '#8a90a8', 'off-beat dashes need a moment'); }
      else {
        const j = this.game.judge(), dist = { perfect: 2.8, good: 2.4, off: 1.3 }[j.grade];
        this._burstStart(dir, dist, j.grade === 'off' ? 0.16 : 0.13);
        this.dashReady = now + (j.grade === 'off' ? 450 : 120);
        this._beatMove('DASH', j, `${dist.toFixed(1)} m`);
        this.audio.dash(j.grade !== 'off');
        this.tunnel.k = Math.max(this.tunnel.k, this.tunnel.on ? 0.4 : 0);
        this._count('dashes');
      }
    }
    if (!this.burst) this._walk(dt, 1.4);
  }

  // ------------------------------------------------------------------ 3. lunge
  _lunge(dt, now) {
    const P = this.player, B = P.blade;
    let dir = null;
    if (P.vr) {
      P.tipVelocity(_a, 60);
      const sp = _a.length(), along = _a.dot(B.dir);
      if (sp < 1.2) this.lungeArmed = true;
      if (this.lungeArmed && along > 2.6 && along > 0.72 * sp) {
        this.lungeArmed = false;
        dir = new V(B.dir.x, 0, B.dir.z);
        if (dir.lengthSq() < 0.09) dir.copy(P.flatFwd);
      }
    } else if (this._keyDown(' ')) dir = new V(P.pointer.x, 0, P.pointer.z);
    if (!dir || now < this.dashReady) return;
    dir.normalize();
    const j = this.game.judge(), dist = { perfect: 3.0, good: 2.5, off: 1.5 }[j.grade];
    this._burstStart(dir, dist, 0.17);
    this.dashReady = now + 300;
    this._beatMove('LUNGE', j, `${dist.toFixed(1)} m`);
    this.audio.dash(j.grade !== 'off');
    this.fx.flash(B.tip, this.def.color, 0.4);
    this._count('lunges');
  }

  // ------------------------------------------------------------------ 4. arm swing
  _arms(dt) {
    const P = this.player;
    const hold = P.vr ? !!(P.pad.sword[BTN.trigger] && P.pad.force[BTN.trigger]) : !!P.keys[' '];
    let pump = 0;
    for (const role of ROLES) {
      const st = this.hands[role], y = P.handLocal(role, _a).y, vy = (y - st.y) / Math.max(dt, 1e-3);
      st.y = y;
      st.vy += (Math.min(6, Math.abs(vy)) - st.vy) * Math.min(1, dt * 8);
      if (vy < -0.5 && st.sign > 0) { st.sign = -1; if (hold && this.runSpeed > 1 && role === 'sword') this.audio.step(_h.set(P.head.x, P.rig.position.y, P.head.z)); }
      else if (vy > 0.5) st.sign = 1;
      pump += st.vy / 2;
    }
    const target = hold ? (P.vr ? clamp((pump - 0.25) * 2, 0, 6.5) : 4) : 0;
    this.runSpeed += (target - this.runSpeed) * Math.min(1, dt * (target > this.runSpeed ? 4 : 6));
    if (this.grounded) {
      const f = P.flatFwd;
      this.vel.x = f.x * this.runSpeed; this.vel.z = f.z * this.runSpeed;
      this.ctl = true;
    }
    this.stats.n.run = Math.max(this.stats.n.run || 0, this.runSpeed);
  }

  // ------------------------------------------------------------------ 5. air grab
  _climb(dt) {
    const P = this.player;
    let n = 0;
    _c.set(0, 0, 0);
    for (const role of ROLES) {
      const held = P.vr && !!P.pad[role][BTN.squeeze], g = this.grabs[role];
      P.handWorld(role, _a);
      if (held && !g.on) {
        g.on = true; g.anchor.copy(_a);
        this.audio.grabAir(_a); P.pulse(role, 0.45, 25);
        this.fx.ring(_a, _b.subVectors(P.head, _a).normalize(), this.def.color, { size: 0.35, life: 0.3 });
        this._count('grabs');
      } else if (!held) g.on = false;
      if (g.on) { _c.add(_b.subVectors(g.anchor, _a)); n++; }
    }
    if (n) {
      _c.divideScalar(n);
      P.rig.position.add(_c);
      this.supported = true; this.ctl = true;
      this.dragVel.lerp(_a.copy(_c).divideScalar(Math.max(dt, 1e-3)), Math.min(1, dt * 20));
      this.vel.set(0, 0, 0);
      this.holding = true;
    } else if (this.holding) {
      this.holding = false;
      this.vel.copy(this.dragVel).multiplyScalar(1.25);
      if (this.vel.length() > 13) this.vel.setLength(13);
      if (this.vel.length() > 3) { this.audio.throwWhoosh(P.head); this._msg('FLING', hex(this.def.color), `${this.vel.length().toFixed(1)} m/s`); }
      this.dragVel.set(0, 0, 0);
    }
  }

  // ------------------------------------------------------------------ 6. grapple
  _aimOf(role, o, dir) {
    const P = this.player;
    if (!P.vr) { P.camera.getWorldPosition(o); return dir.copy(P.pointer); }
    if (role === 'force') { o.copy(P.aim.origin); return dir.copy(P.aim.dir); }
    o.copy(P.blade.base); return dir.copy(P.blade.dir);
  }
  _pickAnchor(o, dir) {
    let best = null, bc = Math.cos(0.2);
    for (const A of this.anchors) {
      _d.subVectors(A.pos, o);
      const L = _d.length();
      if (L > 30 || L < 1) continue;
      const c = _d.divideScalar(L).dot(dir);
      if (c > bc) { bc = c; best = A; }
    }
    return best;
  }
  _grapple(dt) {
    const P = this.player;
    for (const role of ROLES) {
      const pressed = P.vr ? !!P.pad[role][BTN.trigger] : role === 'sword' ? !!P._deskCharge : !!P.keys['q'];
      const prev = this.trig[role]; this.trig[role] = pressed;
      const R = this.ropes[role], ret = this.reticles[role];
      this._aimOf(role, _a, _b);
      const cand = R ? null : this._pickAnchor(_a, _b);
      ret.visible = !!cand;
      if (cand) { ret.position.copy(cand.pos); ret.material.rotation += dt * 2; }
      if (pressed && !prev && !R) this._fire(role, cand);
      else if (!pressed && R) {
        this.ropes[role] = null;
        if (this.vel.length() > 4) this._msg('FLING', hex(this.def.color), `${this.vel.length().toFixed(1)} m/s`);
      }
    }
  }
  _fire(role, A) {
    const P = this.player;
    P.handWorld(role, _c);
    if (!A) {
      this._aimOf(role, _a, _b);
      this.fx.lightning(_c, _d.copy(_c).addScaledVector(_b, 5), 0x8a90a8, 0.12, 0.05);
      this.audio.zip(_c, false);
      this._msg('MISS', '#8a90a8', 'point at a crystal until a ring appears');
      return;
    }
    const j = this.game.judge(), reel = { perfect: 11, good: 9, off: 7 }[j.grade];
    this.ropes[role] = { A, len: _c.distanceTo(A.pos), reel };
    A.flash = 1;
    this.audio.zip(A.pos, true); P.pulse(role, 0.6, 40);
    this.fx.flash(A.pos, this.def.color, 0.7);
    this._beatMove('GRAPPLE', j, `${_c.distanceTo(A.pos).toFixed(1)} m`);
    this._count('grapples');
  }
  // Rope constraints after integration: never further than the (shrinking) rope
  // length, and always closing on the anchor at least at reel speed.
  _ropes(dt, t) {
    const P = this.player, v = this.vel;
    for (const role of ROLES) {
      const R = this.ropes[role], T = this.tethers[role];
      if (!R) { T.mesh.visible = false; continue; }
      P.rig.updateMatrixWorld(true);
      P.handWorld(role, _a);
      const d = _b.subVectors(_a, R.A.pos), dist = d.length() || 1e-3;
      d.divideScalar(dist);
      R.len = Math.max(0.9, Math.min(R.len, dist) - R.reel * dt);
      if (dist > R.len) {
        P.rig.position.addScaledVector(d, -(dist - R.len));
        const out = v.dot(d);
        if (out > 0) v.addScaledVector(d, -out);
      }
      const closing = -v.dot(d);
      if (dist > 1.3 && closing < R.reel) v.addScaledVector(d, -(R.reel - closing) * Math.min(1, dt * 5));
      if (dist <= 1.3) { v.multiplyScalar(Math.exp(-5 * dt)); v.y = Math.max(v.y, -0.2); }
      // tether: hand → anchor with a little live wobble
      for (let i = 0; i < T.n; i++) {
        const k = i / (T.n - 1);
        T.pts[i].lerpVectors(_a, R.A.pos, k);
        const w = Math.sin(k * Math.PI) * 0.05;
        T.pts[i].x += Math.sin(t * 21 + k * 9) * w; T.pts[i].y += Math.cos(t * 17 + k * 7) * w;
      }
      T.mat.uniforms.uColor.value.setHex(role === 'force' ? 0xffd27a : this.def.color);
      T.mat.uniforms.uAlpha.value = 0.9;
      T.build(P.head, 0.035);
      T.mesh.visible = true;
    }
  }

  // ------------------------------------------------------------------ 7. leap + glide
  _leap(dt, now) {
    const P = this.player, I = P.input, v = this.vel;
    let push = null;
    if (P.vr) { if (I.pushDown) push = _a.copy(P.aim.dir).negate(); }
    else if (this._keyDown(' ')) push = _a.set(P.flatFwd.x * 0.5, 0.85, P.flatFwd.z * 0.5).normalize();
    else if (I.pushDown) push = _a.copy(P.headFwd).negate();
    if (push) this._push(push);
    // glide: arms spread wide at about shoulder height (desktop: hold G)
    let spread = false;
    if (P.vr) {
      P.handWorld('sword', _b); P.handWorld('force', _c);
      spread = _b.distanceTo(_c) > 1.0 && Math.min(_b.y, _c.y) > P.head.y - 0.7;
    } else spread = !!P.keys['g'];
    this.glide = !this.grounded && spread && !this.pounding;
    if (this.glide) {
      if (!this.gliding) { this.gliding = true; this._msg('GLIDE', hex(this.def.color)); }
      const r = Math.min(1, dt * 1.2), f = P.flatFwd;
      v.x += (f.x * 7.5 - v.x) * r; v.z += (f.z * 7.5 - v.z) * r;
      if (P.vr && Math.random() < 0.5) for (const p of [_b, _c]) this.fx.particles.emit(p, _d.set(0, 0, 0), 0xffffff, { size: 0.02, life: 0.5, drag: 1 });
    } else if (this.grounded) this.gliding = false;
    // ground pound: a hard downward chop in mid-air (desktop: C)
    if (!this.grounded && !this.pounding) {
      P.camera.getWorldPosition(_h);
      const floor = this._floorAt(_h.x, _h.z, P.rig.position.y), height = floor === -Infinity ? 9 : P.rig.position.y - floor;
      const chop = P.vr ? P.tipVelocity(_d, 50).y < -6 : this._keyDown('c');
      if (chop && height > 0.6) {
        this.pounding = true;
        v.set(v.x * 0.2, -18, v.z * 0.2);
        this.audio.dash(true);
      }
    }
  }
  _push(dir) {
    const P = this.player, v = this.vel;
    if (!this.grounded && this.airPushes <= 0) { this.audio.denied(); this._msg('NO PUSH LEFT', '#8a90a8', 'one push in mid-air: land to recharge'); return; }
    const j = this.game.judge(), k = { perfect: 1.35, good: 1.2, off: 1 }[j.grade];
    const wasGrounded = this.grounded;
    if (wasGrounded) {
      v.x += dir.x * 7.5 * k; v.z += dir.z * 7.5 * k;
      v.y = Math.max(dir.y * 7.5, 4.5) * k;
    } else {
      this.airPushes--;
      v.y = Math.max(v.y, 0);
      v.addScaledVector(dir, 6.5 * k);
    }
    this.grounded = false;
    P.rig.position.y += 0.02;
    this.pounding = false;
    P.camera.getWorldPosition(_h);
    _b.set(_h.x, P.rig.position.y + 0.05, _h.z);
    this.fx.ring(_b, _c.set(0, 1, 0), 0xffe2a0, { size: 1.6, life: 0.35 });
    this.fx.particles.burst(_b, 18, 0xffe2a0, { speed: 3, up: 0.5, size: 0.04, life: 0.4 });
    this.audio.push(_b, j.grade !== 'off');
    P.pulse('force', 0.8, 60);
    this._beatMove(wasGrounded ? 'LEAP' : 'AIR PUSH', j);
    this._count('pushes');
  }

  // ------------------------------------------------------------------ 8. sword warp
  _warp(dt, now) {
    const P = this.player;
    const trig = P.vr ? !!P.pad.sword[BTN.trigger] : !!P._deskCharge;
    const prev = this.warpTrig; this.warpTrig = trig;
    if (!this.thrown) {
      if (!trig && prev && this.warpRelease) this.warpRelease = false; // that press was a warp, not a throw
      else if (!trig && prev) {
        P.tipVelocity(_a, 70);
        if (_a.length() > 2.2) this._throw(_a);
        else this._msg('SWING TO THROW', '#8a90a8', 'hold the trigger, swing, let go mid-swing');
      }
      return;
    }
    if (trig && !prev && !this.thrown.returning) { this._warpTo(now); this.warpRelease = true; return; }
    this._fly(dt);
  }
  _throw(tipVel) {
    const P = this.player, S = P.sword, root = S.root;
    this.swordLocal = { p: root.position.clone(), q: root.quaternion.clone() };
    this.scene.attach(root);
    const vel = tipVel.clone().multiplyScalar(1.4);
    vel.y += 1;
    vel.setLength(clamp(vel.length(), 6, 22));
    S.tip.getWorldPosition(_a); S.base.getWorldPosition(_b);
    this.thrown = { vel, t: 0, stuck: false, q0: root.quaternion.clone(), blade0: _a.sub(_b).normalize().clone(), idle: 0, returning: false };
    this.audio.throwWhoosh(root.position);
    P.pulse('sword', 0.5, 40);
    this._msg('THROWN', hex(this.def.color), 'pull the trigger to warp to it');
    this._count('throws');
  }
  _fly(dt) {
    const P = this.player, S = P.sword, root = S.root, T = this.thrown;
    if (T.returning) {
      T.rt += dt;
      const k = Math.min(1, T.rt / 0.25);
      P.handWorld('sword', _a);
      root.position.lerpVectors(T.from, _a, k * k);
      if (k >= 1) { this._returnSword(); P.pulse('sword', 0.4, 30); }
      return;
    }
    T.t += dt;
    if (!T.stuck) {
      T.vel.y -= G * 0.55 * dt;
      root.position.addScaledVector(T.vel, dt);
      _q.setFromUnitVectors(T.blade0, _a.copy(T.vel).normalize());
      root.quaternion.copy(_q).multiply(T.q0);   // point-first along the flight path
      root.updateMatrixWorld(true);
      S.tip.getWorldPosition(_b);
      const floor = this._floorAt(_b.x, _b.z, _b.y + 0.3);
      if (_b.y <= floor + 0.02 && T.vel.y < 0) {
        root.position.addScaledVector(_a, (floor - 0.12 - _b.y) / Math.min(-0.2, _a.y)); // bury the tip a little
        T.stuck = true; T.vel.set(0, 0, 0);
        this.audio.impact(_b, 0.5);
        this.fx.particles.burst(_b.setY(floor + 0.02), 14, 0xffc070, { speed: 2, up: 1, size: 0.03, life: 0.4, grav: -6, flicker: true });
      }
      if (root.position.y < -10 || T.t > 5) this._recall();
    } else if ((T.idle += dt) > 4) this._recall();
  }
  _recall() {
    const T = this.thrown;
    if (!T || T.returning) return;
    T.returning = true; T.rt = 0; T.from = this.player.sword.root.position.clone();
    this.audio.pull(T.from);
  }
  _warpTo(now) {
    const P = this.player, T = this.thrown, rig = P.rig;
    P.sword.mid.getWorldPosition(_a);
    P.camera.getWorldPosition(_h);
    const j = this.game.judge();
    if (T.stuck) {
      const floor = this._floorAt(_a.x, _a.z, _a.y + 0.5);
      rig.position.x += _a.x - _h.x; rig.position.z += _a.z - _h.z;
      rig.position.y = floor > -Infinity ? floor : _a.y - P.camera.position.y;
      this.vel.set(0, 0, 0);
    } else {
      rig.position.add(_b.subVectors(_a, _h));
      this.vel.copy(T.vel).multiplyScalar(0.45);
      this.grounded = false;
    }
    rig.updateMatrixWorld(true);
    this.prevFeet = rig.position.y;
    if (j.grade !== 'off') this.hoverUntil = now + 380;
    this._returnSword();
    this.tunnel.blink();
    this.audio.warp(j.grade !== 'off');
    P.pulse('sword', 0.7, 50); P.pulse('force', 0.7, 50);
    P.camera.getWorldPosition(_h);
    this.fx.particles.burst(_h.addScaledVector(P.flatFwd, 0.8), 24, this.def.color, { speed: 2.5, size: 0.04, life: 0.45 });
    this._beatMove('WARP', j);
    this._count('warps');
  }
  _returnSword() {
    const P = this.player, root = P.sword.root;
    if (this.swordLocal) {
      P.swordMount.add(root);
      root.position.copy(this.swordLocal.p); root.quaternion.copy(this.swordLocal.q);
    }
    this.thrown = null;
    P.blade.init = false;
  }

  // ------------------------------------------------------------------ course + feedback
  _resetCourse() {
    const d = this.def, pts = d.course;
    this.course = { n: pts.length, got: 0, t0: 0, done: false, resetAt: 0 };
    this.motes.forEach((m, i) => {
      m.on = i < pts.length;
      m.g.visible = m.on;
      if (!m.on) return;
      m.base.copy(pts[i]);
      m.g.position.copy(m.base);
      m.halo.material.color.setHex(d.color); m.gem.material.color.setHex(d.color); m.line.material.color.setHex(d.color);
      m.line.scale.y = Math.max(0.01, m.base.y - (this._floorAt(m.base.x, m.base.z, m.base.y) > -Infinity ? this._floorAt(m.base.x, m.base.z, m.base.y) : m.base.y - 2));
    });
  }
  _collect(now) {
    const P = this.player, C = this.course;
    if (C.done) { if (now > C.resetAt) { this._resetCourse(); this.dirty = true; } return; }
    P.handWorld('sword', _b); P.handWorld('force', _c);
    for (const m of this.motes) {
      if (!m.on) continue;
      const p = m.g.position;
      if (p.distanceTo(P.head) > 0.6 && p.distanceTo(_b) > 0.45 && p.distanceTo(_c) > 0.45) continue;
      m.on = false; m.g.visible = false;
      if (!C.t0) C.t0 = now;
      this.audio.collect(C.got);
      C.got++;
      this.fx.particles.burst(p, 24, this.def.color, { speed: 2.5, size: 0.04, life: 0.5 });
      this.fx.flash(p, this.def.color, 0.5);
      P.pulse('sword', 0.3, 25); P.pulse('force', 0.3, 25);
      this.dirty = true;
      if (C.got >= C.n) {
        const time = (now - C.t0) / 1000, id = this.def.id, prev = this.best[id];
        C.done = true; C.time = time; C.resetAt = now + 2500;
        const best = !prev || time < prev;
        if (best) { this.best[id] = time; localStorage.setItem('cadence.labBest', JSON.stringify(this.best)); }
        this.audio.courseClear();
        this.comboHud.message(`COURSE CLEAR · ${time.toFixed(1)} s${best ? ' · BEST' : ''}`, '#4ade80', 2.4);
        this._msg(`CLEAR · ${time.toFixed(1)} s`, '#4ade80', best ? 'new best!' : `best ${prev.toFixed(1)} s`);
      }
    }
  }
  _track(dt, now) {
    const P = this.player;
    const d = this._prevHead ? P.head.distanceTo(this._prevHead) : 0;
    this._prevHead = (this._prevHead || new V()).copy(P.head);
    if (d < 3) this.speed += (d / Math.max(dt, 1e-3) - this.speed) * Math.min(1, dt * 8);
    if (this.speed > this.stats.top + 0.2) { this.stats.top = this.speed; this.dirty = true; }
    this.tunnel.update(dt, this.speed, true);
    this.wind?.set(clamp((this.speed - 1.5) / 10, 0, 1));
  }
  _animate(dt, t) {
    const pulse = this.game.pulse;
    for (const m of this.motes) {
      if (!m.on) continue;
      m.g.position.y = m.base.y + Math.sin(t * 2 + m.base.x) * 0.06;
      m.gem.rotation.y += dt * 2;
      m.halo.scale.setScalar(0.5 + pulse * 0.18);
    }
    if (this.def.id === 'grapple') for (const A of this.anchors) {
      A.gem.rotation.y += dt * 0.8;
      A.flash *= Math.exp(-dt * 4);
      A.mat.emissiveIntensity = 0.7 + pulse * 0.6 + A.flash * 3;
    }
  }
  // An action judged on the beat: combo, floating grade, panel line.
  _beatMove(label, j, detail = '') {
    const g = this.game, P = this.player;
    g._action(j.grade);
    const text = j.grade === 'off' ? `${label} · OFF BEAT` : `${label} · ${j.grade.toUpperCase()}`;
    const timing = g.freeTiming ? '' : `${j.off >= 0 ? '+' : '−'}${Math.abs(Math.round(j.off * 1000))} ms`;
    this._msg(text, GRADE_CSS[j.grade], [detail, timing].filter(Boolean).join(' · '));
    this.fx.text.spawn(text, _d.copy(P.head).addScaledVector(P.flatFwd, 1.1).add(_c.set(0, -0.25, 0)), { color: GRADE_CSS[j.grade], size: 0.05, life: 0.7 });
    if (j.grade !== 'off') this._count('onbeat');
  }
  _msg(text, color = '#fff', sub = '') { this.last = { text, color, sub }; this.dirty = true; }
  _count(k) { this.stats.n[k] = (this.stats.n[k] || 0) + 1; this.dirty = true; }
  _padDown(role, i) { const P = this.player; return !!P.pad[role][i] && !P.padPrev[role][i]; }
  _keyDown(k) { return !!this.player.keys[k] && !this._kp[k]; }
  _keys() { for (const k of ['shift', ' ', 'c', 'g', 'q']) this._kp[k] = !!this.player.keys[k]; }

  _draw(now) {
    const d = this.def, P = this.player, vr = P.presenting, [X, Y] = P.btnNames, C = this.course, n = this.stats.n;
    const best = this.best[d.id];
    const time = C.done ? C.time : C.t0 ? (now - C.t0) / 1000 : 0;
    const extra = {
      stick: ['SLIDES', n.slides || 0], dash: ['ON-BEAT DASHES', `${n.onbeat || 0}/${n.dashes || 0}`], lunge: ['ON-BEAT LUNGES', `${n.onbeat || 0}/${n.lunges || 0}`],
      arms: ['TOP RUN', `${(n.run || 0).toFixed(1)} m/s`], climb: ['GRABS', n.grabs || 0], grapple: ['GRAPPLES', n.grapples || 0],
      leap: ['PUSHES · POUNDS', `${n.pushes || 0} · ${n.pounds || 0}`], warp: ['WARPS', n.warps || 0],
    }[d.id];
    const tun = this.tunnel.on ? 'ON' : 'OFF';
    this.board.station({
      name: d.name, css: hex(d.color), lines: vr ? d.vr : d.desk,
      last: this.last || { text: d.sub, color: hex(d.color), sub: 'collect the glowing motes against the clock' },
      stats: [['MOTES', `${C.got}/${C.n}`], ['TIME', C.t0 ? `${time.toFixed(1)} s` : '–'], ['BEST', best ? `${best.toFixed(1)} s` : '–'],
        ['TOP SPEED', `${this.stats.top.toFixed(1)} m/s`], ['BEST AIR', `${this.stats.air.toFixed(2)} s`], extra],
      footer: vr ? `A / B: switch move (${this.idx + 1}/${LAB_MODES.length}) · ${Y}: comfort tunnel ${tun} · hold ${X}: hub`
        : `1–8: switch move (${this.idx + 1}/${LAB_MODES.length}) · T: comfort tunnel ${tun} · Esc: hub`,
    });
  }
}
