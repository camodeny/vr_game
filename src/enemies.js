// Enemies act on the beat. Grunts wind up for exactly two beats and strike on
// the third; Casters charge for a beat and throw an orb that arrives on a beat.
import * as THREE from 'three';
import { BEAT, ARENA_R, COLORS, ELEMENTS } from './config.js';
import { buildGrunt, buildCaster, buildOrb } from './models.js';

const V = THREE.Vector3;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const ELEM_COLOR = Object.fromEntries(ELEMENTS.map((e) => [e.id, e.color]));
const _v = new V(), _w = new V();
const ARM_IDLE = -0.95, ARM_UP = 2.5, ARM_HIT = 5.05; // radians about the shoulder; 0 = hanging down

export const REACH = 1.95;          // grunt strike reach (horizontal, from body centre to head)
const ENGAGE = 1.25;                 // grunts like to stand this far from you

export class Enemy {
  // cfg (sandbox): post = anchor to hold instead of chasing, passive = never
  // attacks, every/phase = attack on a fixed beat schedule, hp = override.
  constructor(type, game, pos, scale, cfg = {}) {
    this.type = type; this.game = game; this.cfg = cfg;
    this.m = type === 'grunt' ? buildGrunt() : buildCaster();
    this.root = this.m.root;
    this.root.position.copy(pos);
    this.maxHp = cfg.hp || (type === 'grunt' ? 60 : 40) * scale;
    this.hp = this.maxHp;
    this.alive = true;
    this.state = 'spawn';
    this.until = game.beat + 2;      // beat at which the current state ends
    this.cooldown = 1 + Math.floor(Math.random() * 3);
    this.vel = new V();
    this.status = { el: null, until: 0 };
    this.hitCd = 0; this.bladeInside = false;
    this.flash = 0; this.flinch = new V(); this.flinchV = new V();
    this.seed = Math.random() * 10;
    this.arm = 0; this.strikeBeat = 0; this.windT0 = 0;
    this.strafe = Math.random() < 0.5 ? -1 : 1;
    this.held = false; this.airborne = false; this.thrownBy = null; this.throwMult = 1;
    this.spawnT = game.t;
    this.root.scale.setScalar(0.01);
    this._center = new V();
    this.guard = { d: Infinity, speed: 0, at: new V() }; // closest blade approach to this strike's path
  }

  get center() { return this.m.body.getWorldPosition(this._center); }
  get frozen() { return this.status.el === 'ice' && this.status.until > this.game.beat; }
  get windingUp() { return this.state === 'windup' || this.state === 'charge'; }
  get targetable() { return this.alive && this.state !== 'spawn' && this.state !== 'falling'; }

  // Capsule for blade collision: [bottom, top] world points and radius.
  capsule(a, b) {
    const c = this.center;
    a.set(c.x, c.y - (this.type === 'grunt' ? 0.5 : 0.75), c.z);
    b.set(c.x, c.y + (this.type === 'grunt' ? 0.72 : 0.75), c.z);
    return this.m.radius;
  }

  // ------------------------------------------------------------------ beat logic
  onBeat(b) {
    if (!this.alive) return;
    if (this.frozen) {
      if (this.state === 'windup' || this.state === 'charge') { this.strikeBeat++; this.windT0 += BEAT; }
      this.until++;
      return;
    }
    switch (this.state) {
      case 'spawn':
      case 'stagger':
        if (b >= this.until) this.state = this.type === 'grunt' ? (this.cfg.post ? 'ready' : 'chase') : 'drift';
        break;
      case 'ready':
      case 'drift':
        if (this.cfg.passive) break;
        if (this.cfg.every) { if (((b - (this.cfg.phase || 0)) % this.cfg.every + this.cfg.every) % this.cfg.every === 0) this._beginAttack(b); break; }
        if (--this.cooldown <= 0 && this.game.requestAttack(this)) this._beginAttack(b);
        break;
      case 'windup':
        if (b >= this.strikeBeat) { this.game.resolveStrike(this); this.state = 'recover'; this.until = b + 1; }
        break;
      case 'charge':
        if (b >= this.strikeBeat) { this.game.fireOrb(this, b); this.state = 'drift'; this.cooldown = 6 + Math.floor(Math.random() * 4); }
        break;
      case 'recover':
        if (b >= this.until) { this.state = 'ready'; this.cooldown = 2 + Math.floor(Math.random() * 3); }
        break;
    }
  }

  _beginAttack(b) {
    const g = this.game;
    if (this.type === 'grunt') {
      this.state = 'windup';
      this.strikeBeat = b + 2;
      this.guard.d = Infinity; this.guard.speed = 0;
      this.arm = Math.random() < 0.5 ? 0 : 1;
      this.windT0 = g.t;
      g.audio.telegraph(this.center, g.audio.now, g.audio.ctxTimeOf(this.strikeBeat * BEAT));
      g.firstSeen('telegraph');
    } else {
      this.state = 'charge';
      this.strikeBeat = b + 1;
      this.windT0 = g.t;
      g.audio.orbCharge(this.center, g.audio.now, g.audio.ctxTimeOf(this.strikeBeat * BEAT));
    }
  }

  interrupt(beats = 1) {
    if (this.state === 'windup' || this.state === 'charge') {
      this.game.audio.dud(this.center);
    }
    this.stagger(beats);
  }
  stagger(beats) {
    if (!this.alive || this.held || this.airborne || this.state === 'falling') return;
    const end = this.game.beat + beats;
    this.until = this.state === 'stagger' ? Math.max(this.until, end) : end;
    this.state = 'stagger';
    this.cooldown = 2;
  }

  damage(dmg, dir, flinch = 1) {
    this.hp -= dmg;
    this.flash = 1;
    if (dir) {
      _v.set(dir.x, 0, dir.z);
      if (_v.lengthSq() > 1e-6) _v.normalize();
      // tilt away from the blow; local frame after facing the player
      const inv = this.root.quaternion.clone().invert();
      _v.applyQuaternion(inv);
      this.flinchV.x += _v.z * 7 * flinch;
      this.flinchV.z -= _v.x * 7 * flinch;
    }
  }
  knock(v) {
    if (this.held) return;
    this.vel.add(v);
  }

  setHeld(on) {
    this.held = on;
    if (on) { this.state = 'held'; this.airborne = true; this.vel.set(0, 0, 0); }
  }
  throwWith(v, mult = 1) {
    this.root.position.y = Math.max(this.root.position.y, 0.03);
    this.held = false; this.airborne = true; this.state = 'thrown';
    this.vel.copy(v); this.throwMult = mult; this.thrownAt = this.game.t;
  }
  launch(v) { // knocked into the air by a force push
    if (this.held || !this.alive) return;
    this.root.position.y = Math.max(this.root.position.y, 0.03);
    this.airborne = true; this.state = 'thrown';
    this.vel.copy(v); this.throwMult = 0.5; this.thrownAt = this.game.t;
  }
  drop() {
    this.root.position.y = Math.max(this.root.position.y, 0.03);
    this.held = false; this.airborne = true; this.state = 'thrown';
    this.vel.set(0, 0, 0); this.throwMult = 0; this.thrownAt = this.game.t;
  }

  // ------------------------------------------------------------------ frame logic
  update(dt, t, head, enemies) {
    const m = this.m, root = this.root;
    // materialise
    const sp = clamp01((t - this.spawnT) / (BEAT * 2));
    root.scale.setScalar(Math.max(0.01, easeOut(sp)));

    if (this.state === 'falling') {
      this.vel.y -= 9.8 * dt;
      root.position.addScaledVector(this.vel, dt);
      root.rotation.x += dt * 1.5;
      return;
    }

    const frozen = this.frozen;
    // movement
    if (this.held) {
      // position driven by Game (force hold)
    } else if (this.airborne) {
      this.vel.y -= 11 * dt;
      root.position.addScaledVector(this.vel, dt);
      this.m.body.rotation.y += dt * 6;
      if (root.position.y <= 0 && this.vel.y <= 0 && Math.hypot(root.position.x, root.position.z) > ARENA_R + 0.15) {
        this.airborne = false; this.state = 'falling';
        this.game.onRingOut(this);
        return;
      }
      if (root.position.y <= 0 && this.vel.y <= 0) {
        root.position.y = 0;
        const impact = Math.abs(this.vel.y);
        this.airborne = false;
        this.vel.y = 0; this.vel.multiplyScalar(0.4);
        this.game.onLand(this, impact);
        this.m.body.rotation.y = 0;
        if (this.alive && this.state !== 'falling') { this.state = 'stagger'; this.until = this.game.beat + 2; }
      }
    } else {
      _v.set(0, 0, 0);
      const dx = head.x - root.position.x, dz = head.z - root.position.z;
      const dist = Math.hypot(dx, dz) || 1e-3;
      const nx = dx / dist, nz = dz / dist;
      if (!frozen && this.cfg.post) {
        const P = this.cfg.post;
        _v.set(P.x - root.position.x, 0, P.z - root.position.z).multiplyScalar(2.5);
        if (_v.length() > 1.6) _v.setLength(1.6);
      } else if (!frozen) {
        if (this.type === 'grunt') {
          if (this.state === 'chase' || this.state === 'ready' || this.state === 'recover') {
            const want = dist - ENGAGE;
            const spd = this.state === 'chase' ? 1.35 : 0.6;
            const k = Math.max(-1, Math.min(1, want * 2.2));
            _v.set(nx * k * spd, 0, nz * k * spd);
            if (this.state === 'chase' && Math.abs(want) < 0.25) { this.state = 'ready'; }
            if (this.state === 'ready' && want > 0.9) this.state = 'chase';
          }
        } else if (this.state === 'drift' || this.state === 'stagger') {
          const want = dist - 4.2;
          const k = Math.max(-1, Math.min(1, want));
          _v.set(nx * k * 0.9 - nz * this.strafe * 0.45, 0, nz * k * 0.9 + nx * this.strafe * 0.45);
          if (Math.random() < dt * 0.15) this.strafe *= -1;
          // stay on the platform
          const r = Math.hypot(root.position.x, root.position.z);
          if (r > ARENA_R - 1.2) { _v.x -= (root.position.x / r) * 0.8; _v.z -= (root.position.z / r) * 0.8; }
        }
        // separation
        for (const o of enemies) {
          if (o === this || !o.alive || o.held || o.airborne) continue;
          const ox = root.position.x - o.root.position.x, oz = root.position.z - o.root.position.z;
          const d = Math.hypot(ox, oz);
          if (d < 1.05 && d > 1e-4) { const k = (1.05 - d) * 2.5; _v.x += (ox / d) * k; _v.z += (oz / d) * k; }
        }
        // never inside the player
        if (dist < 0.7) { _v.x -= nx * (0.7 - dist) * 6; _v.z -= nz * (0.7 - dist) * 6; }
      }
      root.position.x += (_v.x + this.vel.x) * dt;
      root.position.z += (_v.z + this.vel.z) * dt;
      this.vel.multiplyScalar(Math.exp(-5 * dt));
      // ring out
      if (Math.hypot(root.position.x, root.position.z) > ARENA_R + 0.15) {
        this.state = 'falling'; this.vel.y = 0;
        this.game.onRingOut(this);
        return;
      }
      // face the player
      if (!frozen) {
        const yaw = Math.atan2(dx, dz);
        let d = yaw - root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
        root.rotation.y += d * Math.min(1, dt * (this.state === 'windup' ? 3 : 7));
      }
    }

    this._animate(dt, t, frozen);
  }

  _animate(dt, t, frozen) {
    const m = this.m;
    // flinch spring
    this.flinchV.addScaledVector(this.flinch, -160 * dt).multiplyScalar(Math.exp(-12 * dt));
    this.flinch.addScaledVector(this.flinchV, dt);
    m.body.rotation.x = this.flinch.x;
    m.body.rotation.z = this.flinch.z;
    if (!frozen) m.body.position.y = m.height + Math.sin(t * 2.3 + this.seed) * 0.035;

    const wind = this.state === 'windup' || this.state === 'charge';
    const danger = wind ? clamp01((t - this.windT0) / Math.max(0.1, this.strikeBeat * BEAT - this.windT0)) : 0;
    // colours: rim, eyes, blades, hit flash
    this.flash *= Math.exp(-dt * 18);
    m.mats.armor.emissiveIntensity = this.flash * 0.6;
    const el = this.status.until > this.game.beat ? this.status.el : null;
    const rim = m.mats.armor.userData.rim.value;
    if (el) rim.setHex(ELEM_COLOR[el]).multiplyScalar(1.1);
    else if (wind) rim.setHex(COLORS.danger).multiplyScalar(0.6 + danger * 1.2);
    else rim.setHex(this.type === 'grunt' ? 0x7f8fc0 : 0xb08fd8);
    const eye = m.mats.eyeMat.color;
    if (frozen) eye.setHex(0x8fe6ff);
    else if (wind) eye.setHex(COLORS.danger).multiplyScalar(1 + danger * 1.5 + 0.5 * Math.sin(t * 40) * danger);
    else if (this.state === 'stagger') eye.setHex(0xffd27a).multiplyScalar(0.6 + 0.4 * Math.sin(t * 25));
    else eye.setHex(COLORS.enemyIdle).multiplyScalar(1.3);
    m.ice.visible = frozen;
    if (m.mats.thrust) m.mats.thrust.opacity = this.airborne ? 0 : 0.16;

    if (this.type === 'grunt') {
      m.mats.bladeMat.emissiveIntensity = 0.25 + danger * 3.5;
      m.sector.visible = this.state === 'windup';
      if (m.sector.visible) {
        m.sector.material.uniforms.uProgress.value = danger;
        m.sector.material.uniforms.uAlpha.value = 0.5 + danger * 0.8;
      }
      if (frozen) return;
      for (let i = 0; i < 2; i++) {
        const a = m.arms[i];
        let ang = ARM_IDLE + Math.sin(t * 1.7 + this.seed + i) * 0.1, roll = (i ? 1 : -1) * 0.38;
        if (i === this.arm) {
          const strikeT = this.strikeBeat * BEAT;
          if (this.state === 'windup') {
            const swingAt = strikeT - 0.1;
            if (t < swingAt) { const k = easeInOut(clamp01((t - this.windT0) / (swingAt - this.windT0))); ang = lerp(ARM_IDLE, ARM_UP, k); roll *= 1 + k * 1.2; }
            else { ang = lerp(ARM_UP, ARM_HIT, easeOut(clamp01((t - swingAt) / 0.13))); roll *= 0.4; }
          } else if (this.state === 'recover') {
            ang = lerp(ARM_HIT, ARM_IDLE + Math.PI * 2, easeInOut(clamp01((t - strikeT) / (BEAT * 0.9))));
          }
        }
        a.rotation.x = ang; a.rotation.z = roll;
      }
      m.hover.rotation.z = t * 2;
    } else {
      m.halo.rotation.z = t * (wind ? 6 : 1.2);
      const orbit = t * 1.6 + this.seed;
      m.crystals.forEach((c, i) => {
        const s = i ? 1 : -1, pull = wind ? 1 - danger * 0.75 : 1;
        c.position.set(s * 0.42 * pull * Math.cos(orbit * 0.5), 0.1 + Math.sin(orbit + i * 3) * 0.08, 0.12 + (wind ? 0.22 * danger : 0));
        c.rotation.y = orbit * 2;
      });
    }
  }
}

// =====================================================================
// Orb: launched on a beat, reaches the "strike zone" in front of you exactly
// two beats later (the shrinking ring shows when), then keeps flying at you.
export class Orb {
  constructor(game, caster, from, head, launchBeat) {
    this.game = game; this.caster = caster;
    const m = buildOrb();
    this.m = m; this.obj = m.group;
    this.from = from.clone();
    this.t0 = launchBeat * BEAT; this.t1 = (launchBeat + 2) * BEAT;
    const toward = new V().subVectors(from, head); toward.y = 0; toward.normalize();
    this.zone = new V(head.x + toward.x * 0.75, head.y - 0.28, head.z + toward.z * 0.75);
    this.dir = new V().subVectors(this.zone, this.from).normalize();
    this.pos = this.from.clone();
    this.obj.position.copy(this.pos);
    this.deflected = false; this.vel = new V(); this.alive = true; this.grade = 'good';
    game.scene.add(this.obj);
  }
  deflect(target, grade, speed = 13) {
    this.deflected = true; this.grade = grade;
    this.target = target;
    const aim = target ? target.center : this.pos.clone().addScaledVector(this.dir, -6);
    this.vel.subVectors(aim, this.pos).normalize().multiplyScalar(speed);
    this.m.core.material.color.setHex(0xffd27a);
    this.m.shell.material.color.setHex(0xffd27a);
    this.m.ring.visible = false;
  }
  update(dt, t, eye) {
    if (this.deflected) {
      if (this.target && this.target.alive) {
        const want = _w.subVectors(this.target.center, this.pos).normalize().multiplyScalar(this.vel.length());
        this.vel.lerp(want, Math.min(1, dt * 6));
      }
      this.pos.addScaledVector(this.vel, dt);
    } else {
      const k = (t - this.t0) / (this.t1 - this.t0);
      if (k <= 1) {
        this.pos.lerpVectors(this.from, this.zone, Math.max(0, k));
        this.pos.y += Math.sin(Math.max(0, k) * Math.PI) * 0.35;
      } else {
        // past the strike zone: head for where your chest is now (step away to dodge)
        if (!this.dir2) this.dir2 = new V(eye.x, eye.y - 0.25, eye.z).sub(this.pos).normalize();
        const spd = this.from.distanceTo(this.zone) / (this.t1 - this.t0);
        this.pos.addScaledVector(this.dir2, spd * 1.4 * dt);
      }
      const ringK = Math.max(0, 1 - Math.max(0, k));
      this.m.ring.scale.setScalar(1 + ringK * 3.2);
      this.m.ring.material.opacity = 0.35 + 0.65 * (1 - ringK);
      this.m.ring.visible = k < 1.05;
    }
    this.obj.position.copy(this.pos);
    this.m.ring.lookAt(eye);
    this.m.shell.scale.setScalar(1 + Math.sin(t * 30) * 0.08);
    this.m.core.rotation.y += dt * 4;
  }
  remove() {
    this.alive = false;
    this.game.scene.remove(this.obj);
    this.obj.traverse((o) => o.material && o.material.dispose());
  }
}
