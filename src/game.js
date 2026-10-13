// Game rules: one clock, four verbs.
//   Rhythm  — every action is judged against the beat (PERFECT / GOOD / OFF).
//   Sword   — on-beat slashes build combo and Cadence ⚡; hold the sword trigger
//             to charge the blade, and a swing spends ⚡ to fire a crescent beam.
//   Force   — off-hand grabs (hold, then flick to throw) and pushes; on-beat = strong.
//   Element — the blade's element marks enemies; a second, different element
//             on the same enemy triggers a reaction.
import * as THREE from 'three';
import {
  BEAT, PERFECT, GOOD, INPUT_OFFSET, CAD_MAX, CAD_START, GAIN, COST, SWING, DMG, GRADE_MULT,
  PLAYER_HP, ARENA_R, ELEMENTS, REACTIONS, COLORS, TIERS, COMBO_TIMEOUT_BEATS,
} from './config.js';
import { Enemy, Orb, REACH } from './enemies.js';
import { makeCrescent, Trail } from './fx.js';

const V = THREE.Vector3;
const clamp = THREE.MathUtils.clamp;
const _a = new V(), _b = new V(), _c = new V(), _d = new V(), _e = new V(), _hitA = new V(), _hitB = new V();
const GRADE_STYLE = { perfect: ['PERFECT', '#ffd27a'], good: ['GOOD', '#dfe6ff'], off: ['OFF BEAT', '#8a90a8'] };
const TIER_NAMES = ['', '', 'IN TIME', 'IN STEP', 'CADENCE'];
const UP = new V(0, 1, 0);

// Closest points between segments p1q1 and p2q2 (Ericson, RTCD 5.1.9).
function segSeg(p1, q1, p2, q2, outA, outB) {
  const d1 = _d.subVectors(q1, p1), d2 = _e.subVectors(q2, p2), r = outA.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a < 1e-9 && e < 1e-9) { s = t = 0; }
  else if (a < 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e < 1e-9) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  outA.copy(p1).addScaledVector(d1, s);
  outB.copy(p2).addScaledVector(d2, t);
  return outA.distanceTo(outB);
}
function pointSeg(p, a, b, out) {
  const ab = _d.subVectors(b, a);
  const t = clamp(_e.subVectors(p, a).dot(ab) / (ab.lengthSq() || 1e-9), 0, 1);
  out.copy(a).addScaledVector(ab, t);
  return out.distanceTo(p);
}

export class Game {
  constructor(ctx) {
    Object.assign(this, ctx); // scene, audio, fx, player, wrist, comboHud, board, vignette, domHud
    this.t = 0; this.beat = -1; this.pulse = 0; this.phase = 0;
    this.state = 'hub';              // hub | play | over | sandbox
    this.sandbox = null;             // set by main; owns the hub and training stations
    this.freeTiming = false;         // sandbox: every action counts as PERFECT
    this.inputOffset = +(localStorage.getItem('cadence.inputOffset') ?? INPUT_OFFSET) || 0;
    this.enemies = []; this.orbs = []; this.falling = [];
    this.best = +(localStorage.getItem('cadence.best') || 0);
    this.el = 0;
    this.seen = new Set();
    this.runeFlash = 0; this.swapFlash = 0;
    this._resetRun();

    this.aimRing = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.52, 48), new THREE.MeshBasicMaterial({ color: COLORS.force, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    this.aimRing.rotation.x = -Math.PI / 2; this.aimRing.visible = false;
    this.scene.add(this.aimRing);

    // beam lock: three arcs under the target, and a dashed lane on the floor
    this.beamRing = new THREE.Group();
    const arcMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 12, 1, (i * 2 * Math.PI) / 3, 1.3), arcMat);
      m.rotation.x = -Math.PI / 2;
      this.beamRing.add(m);
    }
    this.beamRing.visible = false;
    this.lane = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5), new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uT: { value: 0 }, uLen: { value: 6 }, uA: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uColor; uniform float uT, uLen, uA; varying vec2 vUv;
        void main() {
          float d = vUv.y * uLen, dash = step(0.4, fract(d * 2.5 - uT * 4.0));
          float a = uA * smoothstep(0.3, 0.9, d) * (1.0 - vUv.y) * dash * (1.0 - abs(vUv.x - 0.5) * 1.6);
          gl_FragColor = vec4(uColor * 1.5, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.lane.position.y = 0.025; this.lane.visible = false;
    this.scene.add(this.beamRing, this.lane);
    this.chargeK = 0; this.laneDir = new V(0, 0, -1);

    this.aura = new THREE.PointLight(0xff8a2a, 2, 3.5, 2);
    this.player.sword.mid.add(this.aura);
    this.trail = new Trail(this.scene);
  }

  get live() { return this.state === 'play' || this.state === 'sandbox'; }
  emit(type, data = {}) { this.sandbox?.event(type, data); }

  _resetRun() {
    this.chargeSnd?.stop();
    Object.assign(this, {
      hp: PLAYER_HP, cad: CAD_START, combo: 0, comboBeat: 0, tierIdx: 0, score: 0, kills: 0, maxCombo: 0,
      perfects: 0, judged: 0, reactions: 0, parries: 0, wave: 0, wavePhase: 'none', queue: [], maxAlive: 2,
      maxAttackers: 1, waveScale: 1, invuln: 0, held: null, heldBeats: 0, holdSnd: null,
      beamArmed: true, beamCd: 0, lastMeleeT: 0, lastAttackBeat: -1, aimTarget: null,
      charged: false, chargeSnd: null, beamSwing: null, beamLock: null,
    });
  }

  // ------------------------------------------------------------------ timing
  judge() {
    const t = this.t - this.inputOffset, k = Math.round(t / BEAT), off = t - k * BEAT, a = Math.abs(off);
    if (this.freeTiming) return { beat: k, off, grade: 'perfect' };
    return { beat: k, off, grade: a <= PERFECT ? 'perfect' : a <= GOOD ? 'good' : 'off' };
  }
  setInputOffset(v) {
    this.inputOffset = Math.max(-0.2, Math.min(0.2, v));
    localStorage.setItem('cadence.inputOffset', String(this.inputOffset));
  }
  tierInfo() { return TIERS[this.tierIdx]; }
  _action(grade) {
    this.judged++;
    if (grade === 'perfect') this.perfects++;
    if (grade === 'off') { this._breakCombo(); return; }
    this.combo++; this.comboBeat = this.beat;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this._retier();
  }
  _breakCombo() {
    if (this.combo >= 5) this.comboHud.message('COMBO BROKEN', '#f43f5e', 1.3);
    this.combo = 0; this._retier();
  }
  _retier() {
    let i = 0;
    for (let k = 0; k < TIERS.length; k++) if (this.combo >= TIERS[k].at) i = k;
    if (i > this.tierIdx && this.live) this.comboHud.message(`${TIERS[i].label} · ${TIER_NAMES[i + 1] || TIER_NAMES[i]}`, '#ffd27a', 1.6);
    this.tierIdx = i;
  }
  _gain(n) { this.cad = Math.min(CAD_MAX, this.cad + n); }
  _denied() { this.audio.denied(); this.runeFlash = 1; this.player.pulse('sword', 0.2, 30); }
  firstSeen(key) {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const vr = this.player.vr;
    const H = {
      start: 'Slash ON the beat — watch the floor pulse',
      telegraph: 'Red arc = incoming! Hold your blade in the way, or PERFECT-hit to interrupt',
      caster: 'Slash the orb as its gold ring closes',
      grab: vr ? 'Off-hand TRIGGER: grab · flick your hand and release to throw' : 'Hold Q to grab · release to throw',
      push: vr ? 'Off-hand GRIP: force push — knock them off the edge' : 'F: force push — knock them off the edge',
      element: vr ? 'Press A / B to switch element, hit again for a REACTION' : 'Press E or 1–3 to switch element, hit again for a REACTION',
      beam: vr ? 'Hold the sword TRIGGER, then swing at a target on the beat: BEAM (⚡)' : 'Hold the left mouse button, then flick on the beat: BEAM (⚡)',
    };
    if (H[key]) this.comboHud.setHint(H[key], 5.5);
  }

  // ------------------------------------------------------------------ main update
  update(dt, t, now) {
    this.t = t;
    const b = Math.floor(t / BEAT);
    if (this.beat < 0 || b - this.beat > 8) this.beat = b - 1;
    while (this.beat < b) { this.beat++; this._onBeat(this.beat); }
    this.phase = t / BEAT - b;
    this.pulse = Math.exp(-this.phase * 5);
    const P = this.player;

    this._elements(P.input);
    if (this.live) {
      this._melee(now);
      this._beamCheck(now);
      this._force(dt, t);
    } else {
      if (P.input.grabUp && this.held) this._release(true);
      this._setCharged(false);
    }
    for (const e of [...this.enemies]) e.update(dt, t, P.head, this.enemies);
    if (this.live) this._trackGuards();
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const e = this.falling[i]; e.update(dt, t, P.head, this.enemies);
      if (e.root.position.y < -12) { this.scene.remove(e.root); this.falling.splice(i, 1); }
    }
    this._thrownCollisions();
    this._updateOrbs(dt, t);
    this._updateBeams(dt);
    this._statusFx(dt);
    this.sandbox?.update(dt, t, now);
    this._swordFx(dt, t);
    this._hud(dt, now);
  }

  _onBeat(b) {
    if (!this.live) return;
    const down = b % 4 === 0;
    this.player.pulse('force', down ? 0.22 : 0.1, 14);   // a metronome you can feel
    if (this.charged) this.player.pulse('sword', down ? 0.3 : 0.16, 18); // and a charged blade throbs with it
    if (this.state === 'play') this._waveBeat(b);
    else this.sandbox?.onBeat(b);
    for (const e of [...this.enemies]) e.onBeat(b);
    for (const e of [...this.enemies]) {
      if (e.alive && e.status.el === 'fire' && e.status.until > b) {
        const c = e.center;
        e.damage(DMG.burn * this.tierInfo().dmg, null, 0.15);
        this.fx.particles.burst(c, 6, ELEMENTS[0].color, { speed: 1.2, up: 1, size: 0.05, life: 0.5, grav: 1.5, flicker: true });
        this.score += DMG.burn * this.tierInfo().mult;
        if (e.hp <= 0) this._kill(e, UP);
      }
    }
    if (this.held && ++this.heldBeats > 6) this._release(true);
    if (this.combo > 0 && b - this.comboBeat > COMBO_TIMEOUT_BEATS) {
      if (this.combo >= 5) this.comboHud.message('combo faded', '#8a90a8', 1.2);
      this.combo = 0; this._retier();
    }
  }

  // ------------------------------------------------------------------ waves
  _startRun() {
    this._resetRun();
    for (const e of [...this.enemies]) this._kill(e, UP, true);
    this.state = 'play';
    this.board.visible = false;
    this.audio.uiStart(); this.audio.unmuffle();
    this._nextWave(this.beat);
    this.firstSeen('start');
  }
  _nextWave(b) {
    this.wave++;
    const w = this.wave, grunts = 2 + w, casters = w >= 2 ? Math.min(4, w - 1) : 0;
    const q = Array(grunts).fill('grunt');
    for (let i = 0; i < casters; i++) q.splice(1 + Math.floor(Math.random() * q.length), 0, 'caster');
    Object.assign(this, {
      queue: q, maxAlive: Math.min(2 + Math.floor(w / 2), 5), maxAttackers: w === 1 ? 1 : w < 4 ? 2 : 3,
      waveScale: 1 + 0.1 * (w - 1), wavePhase: 'intro', introUntil: b + 4,
    });
    this.comboHud.message(`WAVE ${w}`, '#ffd27a', 2.2);
    if (w === 2) this.firstSeen('push');
  }
  _waveBeat(b) {
    if (this.wavePhase === 'intro') { if (b >= this.introUntil) this.wavePhase = 'fight'; return; }
    if (this.wavePhase === 'fight') {
      if (b % 2 === 0 && this.queue.length && this.enemies.length < this.maxAlive) this._spawn(this.queue.shift(), b);
      if (!this.queue.length && !this.enemies.length && !this.falling.length) {
        this.wavePhase = 'clear'; this.clearUntil = b + 6;
        this.audio.waveClear();
        this.comboHud.message('WAVE CLEAR', '#4ade80', 2.4);
        this.hp = Math.min(PLAYER_HP, this.hp + 25);
        this.score += 500 * this.wave;
      }
    } else if (this.wavePhase === 'clear' && b >= this.clearUntil) this._nextWave(b);
  }
  _spawn(type, b) {
    const P = this.player, fwdYaw = Math.atan2(P.flatFwd.x, P.flatFwd.z);
    const pos = new V();
    for (let i = 0; i < 14; i++) {
      const yaw = fwdYaw + (Math.random() - 0.5) * 2 * 1.9;
      const r = type === 'caster' ? 4.6 : 3.6 + Math.random() * 0.9;
      let x = P.head.x + Math.sin(yaw) * r, z = P.head.z + Math.cos(yaw) * r;
      const rr = Math.hypot(x, z), lim = ARENA_R - 1.1;
      if (rr > lim) { x *= lim / rr; z *= lim / rr; }
      pos.set(x, 0, z);
      if (this.enemies.every((e) => e.root.position.distanceTo(pos) > 1.5) && Math.hypot(x - P.head.x, z - P.head.z) > 2.2) break;
    }
    this.spawnAt(type, pos, b);
    if (type === 'caster') this.firstSeen('caster');
  }
  spawnAt(type, pos, b, cfg = {}) {
    const P = this.player;
    const e = new Enemy(type, this, pos, this.waveScale, cfg);
    e.root.rotation.y = Math.atan2(P.head.x - pos.x, P.head.z - pos.z);
    this.scene.add(e.root);
    this.enemies.push(e);
    this.audio.spawn(_a.copy(pos).setY(1.3), this.audio.now, this.audio.ctxTimeOf((b + 2) * BEAT));
    this.fx.pillar(pos, type === 'grunt' ? COLORS.danger : 0xb08fd8);
    return e;
  }
  // Remove every enemy, orb and held thing without fanfare (mode changes).
  clearField() {
    this._dropHold();
    for (const e of [...this.enemies]) this._kill(e, UP, true);
    for (const o of [...this.orbs]) o.remove();
    this.orbs.length = 0;
    for (const e of this.falling) this.scene.remove(e.root);
    this.falling.length = 0;
    for (const b of [...this.fx.beams]) this.fx.removeBeam(b);
    this.beamSwing = null; this.beamLock = null;
  }
  requestAttack(e) {
    if (this.state !== 'play' || this.lastAttackBeat === this.beat) return false;
    if (this.enemies.filter((o) => o.windingUp).length >= this.maxAttackers) return false;
    if (e.type === 'grunt') {
      const h = this.player.head;
      if (Math.hypot(h.x - e.root.position.x, h.z - e.root.position.z) > REACH) return false;
    }
    this.lastAttackBeat = this.beat;
    return true;
  }

  // ------------------------------------------------------------------ sword
  _sweep(e) {
    const B = this.player.blade, r = e.capsule(_a, _b) + 0.03;
    for (let i = 1; i <= 4; i++) {
      const k = i / 4;
      const p = new V().lerpVectors(B.prevBase, B.base, k), q = new V().lerpVectors(B.prevTip, B.tip, k);
      if (segSeg(p, q, _a, _b, _hitA, _hitB) < r) return _hitA.clone();
    }
    return null;
  }
  _melee(now) {
    const P = this.player, B = P.blade;
    if (!B.init) return;
    const slash = B.speed >= SWING.slashSpeed && P.arc(160) >= SWING.slashArc;
    for (const e of [...this.enemies]) {
      if (!e.targetable) continue;
      const hit = this._sweep(e);
      if (!hit) { e.bladeInside = false; continue; }
      if (e.bladeInside || now < e.hitCd) continue;
      e.bladeInside = true; e.hitCd = now + 140;
      this.lastMeleeT = now;
      if (slash) this._slash(e, hit);
      else {
        this.emit('tap', { speed: B.speed, arc: P.arc(160) });
        e.damage(DMG.tap, null, 0.2);
        this.audio.tap(hit);
        this.fx.particles.burst(hit, 4, 0xaab4cc, { speed: 1.2, size: 0.025, life: 0.25 });
        this.player.pulse('sword', 0.15, 20);
      }
    }
  }
  _slash(e, pos) {
    const B = this.player.blade, j = this.judge(), tier = this.tierInfo(), el = ELEMENTS[this.el];
    const speedK = clamp(B.speed / 5, 0.85, 1.3);
    const dmg = DMG.slash * GRADE_MULT[j.grade] * tier.dmg * speedK * (e.airborne ? 1.25 : 1);
    const dir = new V().copy(B.vel).normalize();
    this._action(j.grade);
    this.emit('slash', { grade: j.grade, off: j.off, dmg, speed: B.speed, enemy: e, windup: e.windingUp });
    if (j.grade !== 'off') this._gain(GAIN[j.grade]);
    if (j.grade === 'perfect' && e.windingUp) {
      this.emit('interrupt');
      e.interrupt(1);
      this.fx.text.spawn('INTERRUPT', _a.copy(pos).add(new V(0, 0.36, 0)), { color: '#4ade80', size: 0.07 });
    }
    e.damage(dmg, dir, j.grade === 'off' ? 0.4 : 1);
    if (!e.held) e.knock(_a.set(dir.x, 0, dir.z).multiplyScalar(j.grade === 'perfect' ? 1.4 : j.grade === 'good' ? 0.8 : 0.3));
    const col = j.grade === 'perfect' ? COLORS.gold : j.grade === 'good' ? el.color : 0x8a90a8;
    const P = this.fx.particles;
    P.burst(pos, j.grade === 'perfect' ? 28 : j.grade === 'good' ? 16 : 6, col, { dir, spread: 0.75, speed: 4.5, size: 0.035, life: 0.42, grav: -6, drag: 3 });
    P.burst(pos, 6, 0xffffff, { dir, spread: 0.35, speed: 7, size: 0.022, life: 0.18 });
    if (j.grade === 'perfect') this.fx.flash(pos, COLORS.gold, 0.32);
    const [label, css] = GRADE_STYLE[j.grade];
    this.fx.text.spawn(`${Math.round(dmg)}`, _a.copy(pos).add(new V(0, 0.1, 0)), { color: css, size: j.grade === 'perfect' ? 0.08 : 0.065 });
    this.fx.text.spawn(label, _a.copy(pos).add(new V(0, 0.22, 0)), { color: css, size: j.grade === 'good' ? 0.045 : 0.055, life: 0.6 });
    this.audio.slash(pos, j.grade, this.audio.hitNote(this.combo), j.grade === 'off' ? null : el.id);
    this.player.pulse('sword', j.grade === 'perfect' ? 1 : j.grade === 'good' ? 0.7 : 0.3, j.grade === 'perfect' ? 70 : 45);
    this.score += Math.round(dmg * tier.mult) + (j.grade === 'perfect' ? 25 : 0);
    if (j.grade !== 'off') this._applyElement(e, el.id, dmg, pos);
    if (e.alive && e.hp <= 0) this._kill(e, dir);
  }

  // ------------------------------------------------------------------ beam
  // Hold the sword trigger to charge the blade, and point it to lock a target.
  // A fast swing then releases a crescent at the swing's peak speed (where a
  // real cut would land). It flies to the lock; with no lock, it flies where
  // the blade pointed at that moment, snapping to an enemy close to that line.
  _beamCheck(now) {
    const P = this.player, B = P.blade, I = P.input;
    if (I.chargeDown && this.cad < COST.beam) {
      this.emit('beam', { kind: 'denied' }); this._denied();
      this.fx.text.spawn('need ⚡', B.tip, { color: '#f43f5e', size: 0.05 });
    }
    this._setCharged(I.charge && this.cad >= COST.beam);
    if (!B.init) return;
    if (B.speed < 3) this.beamArmed = true;
    let S = this.beamSwing;
    if (!S) {
      if (this.charged && B.speed < 2.5) this._updateLock();
      if (!this.charged || !this.beamArmed || B.speed < SWING.beamSpeed || P.arc(200) < SWING.beamArc) return;
      this.beamArmed = false;
      S = this.beamSwing = { start: now, peak: 0, at: now, j: null, dir: new V(), mid: new V(), vel: new V() };
    }
    if (B.speed > S.peak) {
      Object.assign(S, { peak: B.speed, at: now, j: this.judge() });
      this._beamAim(S.dir); S.mid.copy(B.mid); S.vel.copy(B.vel);
    }
    if (this.lastMeleeT >= S.start) { this.beamSwing = null; this.emit('beam', { kind: 'close' }); return; } // it connected: a melee hit
    if (B.speed > S.peak * 0.8 && now - S.at < 90) return; // still accelerating through the cut
    this.beamSwing = null;
    this._releaseBeam(S, now);
  }
  _setCharged(on) {
    if (on === this.charged) return;
    this.charged = on;
    if (on) {
      this.chargeSnd = this.audio.charge(ELEMENTS[this.el].id);
      this.player.pulse('sword', 0.35, 40);
      this.emit('charge');
    } else {
      this.chargeSnd?.stop(); this.chargeSnd = null;
      this.beamLock = null; this.beamSwing = null;
    }
  }
  // Where a beam would fly right now: the blade's heading on the floor plane,
  // handing over to the gaze only as the blade nears vertical. On desktop the
  // mouse cursor aims instead.
  _beamAim(out) {
    const P = this.player, d = P.vr ? P.blade.dir : P.pointer, h = Math.hypot(d.x, d.z);
    const w = THREE.MathUtils.smoothstep(h, 0.15, 0.45);
    out.set(d.x, 0, d.z).multiplyScalar(w / (h || 1)).addScaledVector(P.flatFwd, 1 - w);
    if (out.lengthSq() < 1e-6) out.copy(P.flatFwd);
    return out.normalize();
  }
  _beamPick(origin, dir, minCos) {
    let best = null, bc = minCos;
    for (const e of this.enemies) {
      if (!e.targetable) continue;
      _b.subVectors(e.center, origin).setY(0);
      if (_b.lengthSq() < 0.25) continue;
      const c = _b.normalize().dot(dir);
      if (c > bc) { bc = c; best = e; }
    }
    return best;
  }
  // While charged and between swings, lock onto whatever the blade points at.
  // The lock holds through a wind-up: only a blade clearly pointing at another
  // enemy in view moves it (never the gaze fallback), and looking away drops it.
  _updateLock() {
    const P = this.player, aim = this._beamAim(_c), L = this.beamLock;
    const inView = (e) => _a.subVectors(e.center, P.head).setY(0).normalize().dot(P.flatFwd) > Math.cos(1.2);
    const d = P.vr ? P.blade.dir : P.pointer, pointing = Math.hypot(d.x, d.z) > 0.45;
    const best = L && !pointing ? null : this._beamPick(P.head, aim, Math.cos(0.42));
    if (best && best !== L && inView(best)) {
      this.beamLock = best;
      this.audio.tick(false); P.pulse('sword', 0.12, 12);
    } else if (L && (!L.targetable || !inView(L))) this.beamLock = null;
  }
  _releaseBeam(S, now) {
    const j = S.j, v = S.vel, sp = v.length() || 1;
    if (v.dot(this.player.flatFwd) < -0.3 * sp || v.y > 0.75 * sp) { // raising or drawing back the blade
      this.beamArmed = true; this.emit('beam', { kind: 'windup' });
      return;
    }
    if (j.grade === 'off') {
      this.emit('beam', { kind: 'dud', off: j.off });
      this.audio.dud(S.mid);
      this.fx.particles.burst(S.mid, 8, 0x8a90a8, { speed: 1.5, size: 0.03, life: 0.3 });
      return;
    }
    if (now < this.beamCd) { this.emit('beam', { kind: 'cooldown' }); return; }
    if (this.cad < COST.beam) { this.emit('beam', { kind: 'denied' }); this._denied(); return; }
    this.cad -= COST.beam;
    this.beamCd = now + BEAT * 900;
    this._fireBeam(S, j);
  }
  _fireBeam(S, j) {
    const el = ELEMENTS[this.el], dir = S.dir.clone(), origin = S.mid.clone();
    origin.y = clamp(origin.y, 0.8, 1.7);
    const L = this.beamLock;
    let target = L && L.targetable ? L : null;
    if (!target) {
      if (dir.dot(this.player.flatFwd) < Math.cos(1.3)) dir.copy(this.player.flatFwd); // never behind your gaze
      target = this._beamPick(origin, dir, Math.cos(0.45));
    }
    if (target) dir.subVectors(target.center, origin).setY(0).normalize();
    const sx = new V().copy(S.vel).addScaledVector(dir, -S.vel.dot(dir));
    if (sx.lengthSq() < 1e-4) sx.set(-dir.z, 0, dir.x);
    sx.normalize();
    const sz = new V().crossVectors(sx, dir).normalize();
    sx.crossVectors(dir, sz).normalize();
    const obj = makeCrescent(el.color);
    obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(sx, dir, sz));
    obj.position.copy(origin);
    Object.assign(obj.userData, {
      vel: dir.clone().multiplyScalar(12), life: 1.35, age: 0, hit: new Set(),
      dmg: DMG.beam * GRADE_MULT[j.grade] * this.tierInfo().dmg, el: el.id, grade: j.grade, sx,
    });
    this.fx.addBeam(obj);
    this._action(j.grade);
    this.emit('beam', { kind: 'fired', grade: j.grade, off: j.off, locked: !!target && target === L });
    this.audio.beam(origin, el.id);
    this.player.pulse('sword', 0.9, 90);
    this.fx.particles.burst(origin, 22, el.color, { dir, spread: 0.6, speed: 5, size: 0.04, life: 0.35 });
    this.fx.text.spawn(j.grade === 'perfect' ? 'PERFECT BEAM' : 'BEAM', _a.copy(origin).add(new V(0, 0.2, 0)), { color: el.css, size: 0.055 });
  }
  _updateBeams(dt) {
    for (const obj of [...this.fx.beams]) {
      const u = obj.userData;
      u.age += dt;
      obj.position.addScaledVector(u.vel, dt);
      const s = 1 + u.age * 0.7;
      obj.scale.setScalar(s);
      u.mat.uniforms.uAlpha.value = Math.min(1, (u.life - u.age) / 0.35, u.age / 0.05);
      _a.copy(u.sx).multiplyScalar(0.62 * s);
      _b.copy(obj.position).sub(_a); _c.copy(obj.position).add(_a);
      for (const e of [...this.enemies]) {
        if (!e.targetable || u.hit.has(e)) continue;
        if (pointSeg(e.center, _b, _c, _hitB) < e.m.radius + 0.28) { u.hit.add(e); this._beamHit(e, obj); }
      }
      for (const o of this.orbs) {
        if (o.alive && !o.deflected && pointSeg(o.pos, _b, _c, _hitB) < 0.35) {
          this.fx.particles.burst(o.pos, 14, 0xff4d6d, { speed: 2.5, size: 0.04, life: 0.35 });
          this.audio.deflect(o.pos, 'good');
          o.remove();
        }
      }
      if (u.age >= u.life || Math.hypot(obj.position.x, obj.position.z) > 22) this.fx.removeBeam(obj);
    }
  }
  _beamHit(e, obj) {
    const u = obj.userData, pos = e.center.clone(), dir = u.vel.clone().normalize(), el = ELEMENTS.find((x) => x.id === u.el);
    this.emit('beamHit', { dmg: u.dmg });
    e.damage(u.dmg, dir, 1.3);
    e.knock(_a.copy(dir).setY(0).normalize().multiplyScalar(2.4));
    if (u.grade === 'perfect' && e.windingUp) e.interrupt(1);
    this.fx.particles.burst(pos, 22, el.color, { dir, spread: 0.9, speed: 4, size: 0.04, life: 0.45, grav: -4 });
    this.fx.text.spawn(`${Math.round(u.dmg)}`, _a.copy(pos).add(new V(0, 0.4, 0)), { color: el.css, size: 0.08 });
    this.audio.impact(pos, 0.7);
    this.audio.element(u.el, pos, 0.8);
    this.score += Math.round(u.dmg * this.tierInfo().mult);
    this._gain(3);
    this._applyElement(e, u.el, u.dmg, pos);
    if (e.alive && e.hp <= 0) this._kill(e, dir);
  }

  // ------------------------------------------------------------------ elements
  _elements(I) {
    let n = this.el;
    if (I.elemNext) n = (n + 1) % ELEMENTS.length;
    if (I.elemPrev) n = (n + ELEMENTS.length - 1) % ELEMENTS.length;
    if (I.elemSet >= 0) n = I.elemSet;
    if (n === this.el) return;
    this.el = n;
    const el = ELEMENTS[n], B = this.player.blade;
    this.audio.elementSwitch(el.id);
    if (this.charged) { this.chargeSnd?.stop(); this.chargeSnd = this.audio.charge(el.id); }
    this.swapFlash = 1;
    this.player.pulse('sword', 0.25, 20);
    for (let i = 0; i < 12; i++) {
      _a.lerpVectors(B.base, B.tip, Math.random());
      this.fx.particles.emit(_a, _b.set((Math.random() - 0.5) * 0.6, Math.random() * 0.6, (Math.random() - 0.5) * 0.6), el.color, { size: 0.035, life: 0.4, drag: 3 });
    }
  }
  _applyElement(e, el, dmg, pos) {
    if (!e.alive) return;
    const cur = e.status.until > this.beat ? e.status.el : null;
    if (cur && cur !== el) { this._react(e, cur, el, dmg, pos); return; }
    this.emit('status', { el });
    if (!cur && !this.seen.has('element') && this.kills >= 1) this.firstSeen('element');
    if (el === 'fire') e.status = { el, until: this.beat + 4 };
    else if (el === 'ice') {
      e.status = { el, until: this.beat + 2 };
      this.fx.particles.burst(e.center, 14, ELEMENTS[1].color, { speed: 1.4, size: 0.04, life: 0.6, grav: -1 });
    } else {
      e.status = { el, until: this.beat + 3 };
      let o = null, bd = 3.5;
      for (const x of this.enemies) { if (x === e || !x.targetable) continue; const d = x.center.distanceTo(e.center); if (d < bd) { bd = d; o = x; } }
      if (o) {
        this.fx.lightning(pos, o.center, ELEMENTS[2].color, 0.2, 0.35);
        o.damage(dmg * DMG.chain, null, 0.5);
        this.audio.element('volt', o.center, 0.8);
        this.fx.text.spawn(`${Math.round(dmg * DMG.chain)}`, _a.copy(o.center).add(new V(0, 0.4, 0)), { color: ELEMENTS[2].css, size: 0.06 });
        if (o.hp <= 0) this._kill(o, UP);
      }
    }
  }
  _react(e, a, b, dmg, pos) {
    const R = REACTIONS[[a, b].sort().join('+')];
    const tier = this.tierInfo();
    this.emit('reaction', { name: R.name, css: R.css, from: a, to: b });
    e.status = { el: null, until: 0 };
    this.reactions++;
    this._gain(GAIN.reaction);
    this.score += 150 * tier.mult;
    this.fx.text.spawn(`${R.name}!`, _a.copy(pos).add(new V(0, 0.45, 0)), { color: R.css, size: 0.11, life: 1.1, rise: 0.3 });
    this.audio.reaction(R.name, pos);
    this.player.pulse('sword', 1, 130);
    this.fx.flash(pos, R.color, 0.7, 0.25);
    const P = this.fx.particles;
    if (R.name === 'SHATTER') {
      e.damage(dmg * (DMG.shatter - 1), null, 2);
      P.burst(pos, 40, 0xdff8ff, { speed: 5, size: 0.045, life: 0.7, grav: -7, drag: 1.5 });
      P.burst(pos, 16, ELEMENTS[0].color, { speed: 3, size: 0.05, life: 0.5, flicker: true });
    } else if (R.name === 'SUPERCONDUCT') {
      e.damage(dmg * DMG.superconduct, null, 1);
      for (const o of this.enemies) {
        if (o === e || !o.targetable || o.center.distanceTo(e.center) > 5.5) continue;
        this.fx.lightning(e.center, o.center, 0xc9b8ff, 0.3, 0.45);
        o.damage(dmg * DMG.superconduct, null, 1);
        o.status = { el: 'volt', until: this.beat + 3 };
        o.stagger(1);
      }
      P.burst(pos, 30, ELEMENTS[2].color, { speed: 4, size: 0.035, life: 0.4, flicker: true });
    } else {
      const c = e.center.clone();
      this.fx.ring(new V(c.x, 0.05, c.z), UP, 0xff7ad0, { size: 6, life: 0.5 });
      for (const o of this.enemies) {
        if (!o.targetable) continue;
        const d = Math.hypot(o.root.position.x - c.x, o.root.position.z - c.z);
        if (d > 2.8) continue;
        o.damage(DMG.overload * tier.dmg, null, 2);
        _b.set(o.root.position.x - c.x, 0, o.root.position.z - c.z);
        if (_b.lengthSq() < 1e-4) _b.copy(this.player.flatFwd);
        o.knock(_b.normalize().multiplyScalar(6));
        o.interrupt(2);
      }
      P.burst(pos, 30, ELEMENTS[0].color, { speed: 6, size: 0.06, life: 0.5, flicker: true });
      P.burst(pos, 20, ELEMENTS[2].color, { speed: 5, size: 0.04, life: 0.4 });
    }
    for (const o of [...this.enemies]) if (o.alive && o.hp <= 0) this._kill(o, UP);
  }
  _statusFx(dt) {
    const P = this.fx.particles;
    for (const e of this.enemies) {
      if (!e.alive || e.status.until <= this.beat || !e.status.el) continue;
      const c = e.center;
      if (e.status.el === 'fire' && Math.random() < dt * 30) {
        _a.set(c.x + (Math.random() - 0.5) * 0.5, c.y - 0.4 + Math.random() * 0.9, c.z + (Math.random() - 0.5) * 0.5);
        P.emit(_a, _b.set(0, 0.6 + Math.random() * 0.6, 0), Math.random() < 0.5 ? 0xff8a2a : 0xffd27a, { size: 0.045, life: 0.7, grav: 0.8, drag: 1, flicker: true });
      } else if (e.status.el === 'ice' && Math.random() < dt * 10) {
        _a.set(c.x + (Math.random() - 0.5) * 0.6, c.y + Math.random() * 0.6, c.z + (Math.random() - 0.5) * 0.6);
        P.emit(_a, _b.set(0, -0.2, 0), 0xc8f4ff, { size: 0.03, life: 0.9, drag: 1 });
      } else if (e.status.el === 'volt' && Math.random() < dt * 6) {
        _a.set(c.x + (Math.random() - 0.5) * 0.7, c.y + (Math.random() - 0.5) * 0.9, c.z + (Math.random() - 0.5) * 0.7);
        _b.set(c.x + (Math.random() - 0.5) * 0.7, c.y + (Math.random() - 0.5) * 0.9, c.z + (Math.random() - 0.5) * 0.7);
        this.fx.lightning(_a, _b, ELEMENTS[2].color, 0.08, 0.15);
      }
    }
  }

  // ------------------------------------------------------------------ force
  _findAim() {
    const A = this.player.aim;
    let best = null, bs = -Infinity;
    for (const e of this.enemies) {
      if (!e.targetable || e.held || e.airborne) continue;
      _a.subVectors(e.center, A.origin);
      const d = _a.length();
      if (d > 9 || d < 0.3) continue;
      const c = _a.divideScalar(d).dot(A.dir);
      if (c < Math.cos(THREE.MathUtils.degToRad(13 + 12 * Math.min(1, 1.5 / d)))) continue;
      const s = c - d * 0.015;
      if (s > bs) { bs = s; best = e; }
    }
    return best;
  }
  _force(dt, t) {
    const P = this.player, I = P.input;
    this.aimTarget = this.held ? null : this._findAim();
    if (I.pushDown) this._push();
    if (I.grabDown) this._grab();
    if (I.grabUp && this.held) this._release(false);
    if (this.held) {
      const e = this.held;
      if (!e.alive) { this._dropHold(); return; }
      const A = P.aim;
      _a.copy(A.origin).addScaledVector(A.dir, 1.8);
      _a.y = Math.max(0.12, Math.max(_a.y + 0.2, 1.35) - e.m.height); // lifted off the floor
      const prev = _b.copy(e.root.position);
      e.root.position.lerp(_a, 1 - Math.exp(-dt * 9));
      e.vel.subVectors(e.root.position, prev).divideScalar(Math.max(dt, 1e-3));
      e.m.body.rotation.y += dt * 1.6;
      this.fx.setTether(P.hand.pos, e.center, t, P.head, true);
      if (Math.random() < dt * 20) this.fx.particles.burst(e.center, 1, COLORS.force, { speed: 0.6, size: 0.04, life: 0.5, grav: 0 });
    }
  }
  _grab() {
    const e = this.aimTarget, P = this.player;
    if (!e) { this.audio.dud(P.hand.pos); this.emit('grab', { kind: 'miss' }); return; }
    if (this.cad < COST.grab) { this._denied(); return; }
    this.cad -= COST.grab;
    const j = this.judge();
    this._action(j.grade);
    this.emit('grab', { kind: j.grade === 'off' ? 'yank' : 'hold', grade: j.grade, off: j.off });
    this.audio.pull(e.center);
    P.pulse('force', 0.7, 80);
    this.fx.ring(P.hand.pos, P.aim.dir, COLORS.force, { size: 0.7, life: 0.3 });
    this.fx.lightning(P.hand.pos, e.center, COLORS.force, 0.15, 0.12);
    if (j.grade === 'off') {
      // weak yank: drag them toward you, no hold
      _a.subVectors(P.head, e.root.position).setY(0);
      const d = _a.length();
      e.knock(_a.normalize().multiplyScalar(Math.min(5, d * 1.3)));
      e.interrupt(1);
      this.fx.text.spawn('YANK · OFF BEAT', _a.copy(e.center).add(new V(0, 0.5, 0)), { color: '#8a90a8', size: 0.05 });
      return;
    }
    if (e.windingUp) this.fx.text.spawn('INTERRUPT', _a.copy(e.center).add(new V(0, 0.65, 0)), { color: '#4ade80', size: 0.06 });
    e.setHeld(true);
    this.held = e; this.heldBeats = 0;
    this.holdSnd = this.audio.holdStart();
    this.fx.text.spawn(j.grade === 'perfect' ? 'PERFECT GRAB' : 'GRAB', _a.copy(e.center).add(new V(0, 0.5, 0)), { color: '#ffe2a0', size: 0.055 });
    this.score += 30 * this.tierInfo().mult;
    this.firstSeen('grab');
  }
  _dropHold() {
    this.held = null; this.holdSnd?.stop(); this.holdSnd = null;
    this.fx.setTether(null, null, 0, null, false);
  }
  _release(timeout) {
    const e = this.held, P = this.player;
    this._dropHold();
    if (!e || !e.alive) return;
    const hv = P.hand.vel, sp = hv.length();
    if (!timeout && (sp > 1.4 || !P.vr)) {
      const j = this.judge();
      this._action(j.grade);
      const dir = P.vr ? hv.clone().normalize().lerp(P.aim.dir, 0.3).normalize() : P.aim.dir.clone();
      const spd = P.vr ? clamp(sp * 3.4, 7, 16) : 12;
      e.throwWith(dir.multiplyScalar(spd).add(new V(0, 1.4, 0)), j.grade === 'perfect' ? 1.6 : j.grade === 'good' ? 1.2 : 0.8);
      this.emit('throw', { grade: j.grade, handSpeed: sp, speed: spd, vr: P.vr });
      this.audio.throwWhoosh(e.center);
      P.pulse('force', 0.8, 60);
      this.fx.text.spawn(j.grade === 'off' ? 'THROW · OFF BEAT' : j.grade === 'perfect' ? 'PERFECT THROW' : 'THROW', _a.copy(e.center).add(new V(0, 0.5, 0)), { color: j.grade === 'off' ? '#8a90a8' : '#ffe2a0', size: 0.055 });
    } else { e.drop(); this.emit('drop', { handSpeed: sp, timeout }); }
  }
  _push() {
    const P = this.player, A = P.aim;
    if (this.cad < COST.push) { this._denied(); return; }
    this.cad -= COST.push;
    const j = this.judge(), strong = j.grade !== 'off';
    this._action(j.grade);
    const dir = new V().copy(A.dir); dir.y *= 0.4; dir.normalize();
    this.audio.push(A.origin, strong);
    P.pulse('force', strong ? 1 : 0.5, 110);
    this.fx.ring(_a.copy(A.origin).addScaledVector(dir, 0.3), dir, COLORS.force, { size: strong ? 2.4 : 1.4, life: 0.35 });
    this.fx.ring(_a.copy(A.origin).addScaledVector(dir, 1.3), dir, COLORS.force, { size: strong ? 3.6 : 2, life: 0.5 });
    this.fx.particles.burst(_a.copy(A.origin).addScaledVector(dir, 0.2), strong ? 40 : 18, COLORS.force, { dir, spread: 0.45, speed: strong ? 9 : 5, size: 0.04, life: 0.4, drag: 2.5, grav: 0 });
    if (this.held) {
      const e = this.held;
      this._dropHold();
      e.throwWith(dir.clone().multiplyScalar(16).add(new V(0, 1.5, 0)), strong ? 1.6 : 1);
      this.fx.text.spawn('LAUNCH', _a.copy(e.center).add(new V(0, 0.5, 0)), { color: '#ffe2a0', size: 0.06 });
    }
    let hits = 0;
    for (const e of [...this.enemies]) {
      if (!e.targetable || e.airborne) continue;
      _b.subVectors(e.center, A.origin);
      const d = _b.length();
      if (d > 5.5 || _b.divideScalar(d).dot(dir) < Math.cos(0.7)) continue;
      hits++;
      const fall = 1 - 0.45 * (d / 5.5);
      _c.copy(dir).setY(0).normalize();
      e.damage(DMG.push * (strong ? 1.5 : 1), dir, 1.6);
      if (strong) { e.interrupt(2); e.launch(_c.multiplyScalar(7.5 * fall).add(_d.set(0, 2.6, 0))); }
      else { e.knock(_c.multiplyScalar(4 * fall)); e.stagger(1); }
      if (e.hp <= 0) this._kill(e, dir);
    }
    this.emit('push', { grade: j.grade, hits });
    for (const o of this.orbs) {
      if (!o.alive || o.deflected) continue;
      _b.subVectors(o.pos, A.origin);
      const d = _b.length();
      if (d < 5.5 && _b.divideScalar(d).dot(dir) > Math.cos(0.8)) { o.deflect(o.caster.alive ? o.caster : null, 'good'); this.audio.deflect(o.pos, 'good'); }
    }
    this.fx.text.spawn(strong ? (j.grade === 'perfect' ? 'PERFECT PUSH' : 'PUSH') : 'PUSH · OFF BEAT', _a.copy(A.origin).addScaledVector(dir, 1).add(new V(0, 0.25, 0)), { color: strong ? '#ffe2a0' : '#8a90a8', size: 0.055 });
  }
  _thrownCollisions() {
    for (const e of this.enemies) {
      if (!e.airborne || e.held || !e.alive || e.throwMult === 0) continue;
      const sp = e.vel.length();
      if (sp < 3) continue;
      for (const o of [...this.enemies]) {
        if (o === e || !o.targetable || o.airborne) continue;
        if (o.center.distanceTo(e.center) > e.m.radius + o.m.radius + 0.15) continue;
        const dmg = DMG.throwHit * e.throwMult * clamp(sp / 10, 0.6, 1.5) * this.tierInfo().dmg;
        const pos = _a.lerpVectors(e.center, o.center, 0.5).clone();
        o.damage(dmg, e.vel, 2); e.damage(dmg * 0.6, null, 1);
        o.knock(_b.copy(e.vel).setY(0).multiplyScalar(0.6));
        o.interrupt(2);
        e.vel.multiplyScalar(-0.25);
        this.fx.particles.burst(pos, 24, COLORS.force, { speed: 4, size: 0.045, life: 0.45, grav: -5 });
        this.fx.flash(pos, COLORS.force, 0.5);
        this.emit('impact', { dmg });
        this.fx.text.spawn(`IMPACT ${Math.round(dmg)}`, _c.copy(pos).add(new V(0, 0.4, 0)), { color: '#ffe2a0', size: 0.07 });
        this.audio.impact(pos, 1.2);
        this.player.pulse('force', 0.8, 80);
        this.score += Math.round(dmg * 2 * this.tierInfo().mult);
        if (o.hp <= 0) this._kill(o, e.vel.clone().normalize());
        if (e.alive && e.hp <= 0) this._kill(e, UP);
        break;
      }
    }
  }
  onLand(e, impact) {
    if (impact < 3.2 || e.throwMult === 0 || !e.alive) return;
    const dmg = DMG.slam * e.throwMult * clamp(impact / 6, 0.6, 1.5) * this.tierInfo().dmg;
    const pos = new V(e.root.position.x, 0.05, e.root.position.z);
    e.damage(dmg, null, 2);
    this.emit('slam', { dmg });
    this.fx.ring(pos, UP, COLORS.force, { size: 2.6, life: 0.45 });
    this.fx.particles.burst(_a.copy(pos).setY(0.2), 18, 0xb8b0a0, { speed: 2.5, up: 1, size: 0.05, life: 0.5, grav: -6 });
    this.fx.text.spawn(`SLAM ${Math.round(dmg)}`, _a.copy(pos).setY(1.5), { color: '#ffe2a0', size: 0.07 });
    this.audio.impact(pos, 1);
    this.score += Math.round(dmg * this.tierInfo().mult);
    if (e.hp <= 0) this._kill(e, UP);
  }
  onRingOut(e) {
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
    this.falling.push(e);
    if (this.held === e) this._dropHold();
    e.alive = false;
    if (!this.live) return;
    this.emit('ringout');
    this.kills++;
    this.score += 250 * this.tierInfo().mult;
    this._gain(GAIN.kill + 4);
    this.fx.text.spawn('RING OUT!', _a.copy(e.root.position).setY(1.8), { color: '#ffd27a', size: 0.12, life: 1.2 });
    this.audio.ringOut(e.root.position);
    this.comboHud.message('RING OUT', '#ffd27a', 1.2);
  }

  // ------------------------------------------------------------------ defence
  // The blow travels from the enemy's shoulder to your chest. Blocking means your
  // blade crosses that path; we track the closest approach over the last ~150 ms
  // so a parry swing timed to the beat counts even if it passes between frames.
  _strikePath(e, from, to) {
    const h = this.player.head, c = e.center;
    _a.set(h.x - c.x, 0, h.z - c.z).normalize();
    from.set(c.x + _a.x * 0.3, c.y + 0.28, c.z + _a.z * 0.3);
    to.set(h.x - _a.x * 0.12, h.y - 0.3, h.z - _a.z * 0.12);
    return _a;
  }
  _trackGuards() {
    const B = this.player.blade;
    if (!B.init) return;
    const from = new V(), to = new V(), contact = new V(), onPath = new V();
    for (const e of this.enemies) {
      if (e.state !== 'windup' || this.t < e.strikeBeat * BEAT - 0.16) continue;
      this._strikePath(e, from, to);
      const d = segSeg(B.base, B.tip, from, to, contact, onPath);
      if (d < e.guard.d) { e.guard.d = d; e.guard.at.copy(contact); }
      if (d < 0.2) e.guard.speed = Math.max(e.guard.speed, B.speed);
    }
  }
  resolveStrike(e) {
    if (!this.live) return;
    const P = this.player, h = P.head, c = e.center;
    const dist = Math.hypot(h.x - c.x, h.z - c.z);
    const from = new V(), strikePt = new V();
    const toward = this._strikePath(e, from, strikePt).clone();
    const G = e.guard;
    if (dist < REACH + 0.35 && G.d < 0.2) {
      const active = G.speed > 1.5, contact = G.at.clone();
      const tier = this.tierInfo();
      this.emit('strike', { result: active ? 'parry' : 'block' });
      if (active) {
        this.parries++;
        this._action('perfect');
        this._gain(GAIN.parry);
        this.score += 80 * tier.mult;
        e.stagger(2);
        e.knock(toward.clone().multiplyScalar(-2.6));
        this.fx.text.spawn('PARRY', contact.clone().add(new V(0, 0.25, 0)), { color: '#ffd27a', size: 0.09 });
      } else {
        this._gain(GAIN.block);
        this.score += 20 * tier.mult;
        this.fx.text.spawn('BLOCK', contact.clone().add(new V(0, 0.25, 0)), { color: '#dfe6ff', size: 0.07 });
      }
      this.fx.particles.burst(contact, active ? 34 : 18, active ? COLORS.gold : 0xdfe6ff, { speed: active ? 5 : 3, size: 0.035, life: 0.45, grav: -7 });
      this.fx.flash(contact, active ? COLORS.gold : 0xffffff, active ? 0.4 : 0.25);
      this.audio.parry(contact, active);
      P.pulse('sword', 1, active ? 140 : 90);
      return;
    }
    if (dist > REACH) {
      this.emit('strike', { result: 'dodge' });
      this.fx.text.spawn('DODGED', strikePt.clone().add(new V(0, 0.3, 0)), { color: '#8a90a8', size: 0.05 });
      this.score += 10;
      return;
    }
    this.emit('strike', { result: 'hit' });
    this._hurt(14 * (1 + 0.06 * (this.wave - 1)));
  }
  fireOrb(caster, b) {
    if (!this.live) return;
    _a.subVectors(this.player.head, caster.center).setY(0).normalize();
    const from = caster.center.clone().addScaledVector(_a, 0.4);
    this.orbs.push(new Orb(this, caster, from, this.player.head, b));
    this.audio.orbFire(from);
  }
  _updateOrbs(dt, t) {
    const P = this.player, B = P.blade;
    for (const o of [...this.orbs]) {
      if (!o.alive) { this.orbs.splice(this.orbs.indexOf(o), 1); continue; }
      o.update(dt, t, P.head);
      if (!o.deflected) {
        let near = Infinity;
        if (B.init && B.speed > 1.3) for (let i = 1; i <= 3; i++) {
          const k = i / 3;
          near = Math.min(near, pointSeg(o.pos, _c.lerpVectors(B.prevBase, B.base, k), _d.lerpVectors(B.prevTip, B.tip, k).clone(), _hitB));
        }
        if (near < 0.2) {
          const j = this.judge();
          const target = j.grade === 'off' ? null : o.caster.alive ? o.caster : this.enemies.find((e) => e.targetable) || null;
          o.deflect(target, j.grade, j.grade === 'perfect' ? 16 : 12);
          if (j.grade !== 'off') { this._action(j.grade); this._gain(GAIN.deflect); }
          this.emit('deflect', { grade: j.grade, off: j.off });
          this.audio.deflect(o.pos, j.grade);
          P.pulse('sword', 0.8, 60);
          this.fx.particles.burst(o.pos, 16, j.grade === 'perfect' ? COLORS.gold : 0xffffff, { speed: 3.5, size: 0.035, life: 0.35 });
          const [label, css] = GRADE_STYLE[j.grade];
          this.fx.text.spawn(j.grade === 'off' ? 'DEFLECT · OFF' : `${label} DEFLECT`, _a.copy(o.pos).add(new V(0, 0.2, 0)), { color: css, size: 0.055 });
        } else if (o.pos.distanceTo(_c.set(P.head.x, P.head.y - 0.25, P.head.z)) < 0.35) {
          this.emit('orbHit');
          this._hurt(11 * (1 + 0.06 * (this.wave - 1)));
          this.fx.particles.burst(o.pos, 18, 0xff4d6d, { speed: 2.5, size: 0.04, life: 0.35 });
          o.remove();
        } else if (t > o.t1 + 1.4) o.remove();
      } else {
        for (const e of [...this.enemies]) {
          if (!e.targetable || e.center.distanceTo(o.pos) > e.m.radius + 0.22) continue;
          const dmg = DMG.deflect * (o.grade === 'perfect' ? 1.5 : 1) * this.tierInfo().dmg;
          const pos = o.pos.clone();
          e.damage(dmg, o.vel, 1.6);
          e.stagger(1);
          this.fx.particles.burst(pos, 26, COLORS.gold, { speed: 4, size: 0.045, life: 0.45 });
          this.fx.flash(pos, COLORS.gold, 0.45);
          this.fx.text.spawn(`${Math.round(dmg)}`, _a.copy(pos).add(new V(0, 0.4, 0)), { color: '#ffd27a', size: 0.085 });
          this.audio.impact(pos, 0.9);
          this.score += Math.round(dmg * this.tierInfo().mult);
          if (o.grade === 'perfect') this._applyElement(e, ELEMENTS[this.el].id, dmg, pos);
          if (e.alive && e.hp <= 0) this._kill(e, o.vel.clone().normalize());
          o.remove();
          break;
        }
        if (o.alive && (o.pos.length() > 25 || t > o.t1 + 3)) o.remove();
      }
    }
  }
  _hurt(dmg) {
    const now = performance.now();
    if (now < this.invuln || !this.live) return;
    this.invuln = now + 450;
    if (this.state === 'sandbox') { // training: feel the hit, lose nothing
      this.vignette.flash(0.6); this.audio.playerHit();
      this.player.pulse('sword', 0.8, 120); this.player.pulse('force', 0.8, 120);
      this.fx.text.spawn('HIT', this.player.head.clone().addScaledVector(this.player.flatFwd, 0.9).add(new V(0, -0.25, 0)), { color: '#f43f5e', size: 0.07 });
      return;
    }
    this.hp -= dmg;
    this._breakCombo();
    this.vignette.flash(1);
    this.audio.playerHit();
    this.player.pulse('sword', 1, 180); this.player.pulse('force', 1, 180);
    if (this.hp <= 0) this._gameOver();
  }

  // ------------------------------------------------------------------ death & game over
  _kill(e, dir, silent = false) {
    if (!e.alive && !silent) return;
    e.alive = false;
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
    if (this.held === e) this._dropHold();
    const c = e.center.clone();
    this.fx.shatter(e.m.breakable, c, dir || UP);
    this.scene.remove(e.root);
    const el = ELEMENTS[this.el];
    this.fx.particles.burst(c, 30, 0xff4d6d, { speed: 3.5, size: 0.05, life: 0.6, grav: -4 });
    this.fx.particles.burst(c, 20, silent ? 0x8a90a8 : el.color, { speed: 2.5, size: 0.04, life: 0.8, grav: -2 });
    this.fx.flash(c, 0xffe0e6, 0.6, 0.22);
    setTimeout(() => Object.values(e.m.mats).forEach((m) => m.dispose()), 2500);
    if (silent) return;
    this.audio.enemyDie(c, this.audio.hitNote(this.combo));
    this.emit('kill', { enemy: e });
    const tier = this.tierInfo();
    this.kills++;
    this.score += 100 * tier.mult;
    this._gain(GAIN.kill);
    this.player.pulse('sword', 0.6, 60);
    if (this.kills === 1) setTimeout(() => this.firstSeen('grab'), 1500);
  }
  _gameOver() {
    this.state = 'over';
    this._dropHold();
    for (const e of [...this.enemies]) this._kill(e, UP, true);
    for (const o of [...this.orbs]) o.remove();
    this.orbs.length = 0;
    const newBest = this.score > this.best;
    if (newBest) { this.best = this.score; localStorage.setItem('cadence.best', String(this.best)); }
    this.board.gameOver({
      score: this.score, best: this.best, newBest, wave: this.wave, kills: this.kills, maxCombo: this.maxCombo,
      perfectPct: this.judged ? Math.round((100 * this.perfects) / this.judged) : 0, reactions: this.reactions, parries: this.parries,
    });
    this.board.visible = true;
    this.combo = 0; this._retier();
    this.audio.gameOver();
    this.sandbox?.onGameOver();
  }

  // ------------------------------------------------------------------ presentation
  _swordFx(dt, t) {
    const S = this.player.sword, B = this.player.blade, el = ELEMENTS[this.el];
    const u = S.runeMat.uniforms;
    u.uFill.value += (this.cad / CAD_MAX - u.uFill.value) * Math.min(1, dt * 10);
    u.uColor.value.setHex(el.color);
    this.chargeK += ((this.charged ? 1 : 0) - this.chargeK) * Math.min(1, dt * 14);
    const ck = this.chargeK;
    u.uPulse.value = Math.max(this.pulse, ck * (0.7 + 0.3 * this.pulse));
    this.runeFlash *= Math.exp(-dt * 6); u.uFlash.value = this.runeFlash;
    this.swapFlash *= Math.exp(-dt * 5);
    S.steel.emissive.setHex(el.color).multiplyScalar(0.04 + this.pulse * 0.06 + this.tierIdx * 0.025 + this.swapFlash * 0.5 + ck * (0.3 + this.pulse * 0.4));
    S.gemMat.color.setHex(el.color);
    this.aura.color.setHex(el.color);
    this.aura.intensity = 1.2 + this.pulse * 1.2 + this.tierIdx * 0.5 + this.swapFlash * 3 + ck * (2 + this.pulse * 2);
    this._beamAimFx(dt, t, el);
    if (B.init) {
      const P = this.fx.particles, rate = 6 + this.tierIdx * 6 + ck * 30;
      if (Math.random() < dt * rate) {
        _a.lerpVectors(B.base, B.tip, 0.15 + Math.random() * 0.85);
        if (el.id === 'fire') P.emit(_a, _b.set(0, 0.4 + Math.random() * 0.4, 0), Math.random() < 0.5 ? 0xff8a2a : 0xffc070, { size: 0.03, life: 0.6, grav: 0.5, drag: 1, flicker: true });
        else if (el.id === 'ice') P.emit(_a, _b.set(0, -0.15, 0), 0xc8f4ff, { size: 0.022, life: 0.9, drag: 1 });
        else P.emit(_a, _b.set((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5), 0xd8c8ff, { size: 0.025, life: 0.15, drag: 4, flicker: true });
      }
      _c.lerpVectors(B.base, B.tip, 0.3);
      this.trail.update(_c, B.tip, B.speed, el.color);
    }
    // off-hand gem: brightens when something is in your sights
    const g = this.player.offGlove.gemMat.color.setHex(COLORS.force);
    g.multiplyScalar(this.held ? 2 + Math.sin(t * 30) * 0.5 : this.aimTarget ? 1.4 + this.pulse : this.cad >= COST.grab ? 0.8 : 0.25);
    const tgt = this.aimTarget;
    this.aimRing.visible = !!tgt && this.live;
    if (tgt) {
      this.aimRing.position.set(tgt.root.position.x, 0.03, tgt.root.position.z);
      this.aimRing.scale.setScalar(1 + this.pulse * 0.15);
      this.aimRing.material.opacity = this.cad >= COST.grab ? 0.85 : 0.3;
    }
  }

  // Charged blade: arcs under the locked target, and a lane showing where a beam would go.
  _beamAimFx(dt, t, el) {
    const P = this.player, L = this.charged && this.live && this.beamLock?.targetable ? this.beamLock : null;
    this.beamRing.visible = !!L;
    if (L) {
      this.beamRing.position.set(L.root.position.x, 0.04, L.root.position.z);
      this.beamRing.rotation.y += dt * 2.4;
      this.beamRing.scale.setScalar(1 + this.pulse * 0.12);
      this.beamRing.children[0].material.color.setHex(el.color);
    }
    const u = this.lane.material.uniforms, slow = P.blade.speed < 2.5;
    u.uA.value += ((this.charged && this.live ? (slow ? 0.6 : 0.15) : 0) - u.uA.value) * Math.min(1, dt * 12);
    this.lane.visible = u.uA.value > 0.01;
    if (!this.lane.visible) return;
    let len = 6;
    if (L) { _a.subVectors(L.root.position, P.head).setY(0); len = Math.max(0.5, _a.length() - 0.6); _a.normalize(); }
    else this._beamAim(_a);
    this.laneDir.lerp(_a, Math.min(1, dt * 18)).normalize();
    this.lane.position.set(P.head.x, 0.025, P.head.z);
    this.lane.rotation.y = Math.atan2(-this.laneDir.x, -this.laneDir.z);
    this.lane.scale.z = len;
    u.uLen.value = len; u.uT.value = t; u.uColor.value.setHex(el.color);
  }

  _hud(dt, now) {
    const P = this.player, tier = this.tierInfo();
    if (this.state === 'play' && this.cad >= 60) this.firstSeen('beam');
    const hold = P.reload > 0 ? { label: 'RELOADING', k: P.reload } : this.sandbox?.holdK > 0 ? { label: 'BACK TO HUB', k: this.sandbox.holdK } : null;
    const st = {
      hp: this.hp, hpMax: PLAYER_HP, cad: this.cad, el: this.el, score: this.score, hold, combo: this.combo,
      label: this.state === 'play' ? `WAVE ${this.wave}` : this.sandbox?.modeLabel || 'CADENCE', tierLabel: tier.label,
    };
    this.wrist.draw(st, now);
    this.domHud.update(st);
    const beatInBar = ((this.beat % 4) + 4) % 4;
    this.comboHud.update(dt, P.head, P.flatFwd, this.live ? this.combo : 0, tier.label, beatInBar, this.pulse, true);
    this.vignette.update(dt, this.state === 'play' ? this.hp / PLAYER_HP : 1);
    this.audio.tier = this.live ? this.tierIdx + 1 : 0;
  }

  // For the world shader: where are we in the bar?
  beatInfo() {
    return { phase: this.phase, pulse: this.pulse, down: ((this.beat % 4) + 4) % 4 === 0 ? 1 : 0, step16: (((this.beat % 4) + 4) % 4) * 4 + this.phase * 4 };
  }
}
