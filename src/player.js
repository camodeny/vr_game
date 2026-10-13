// The player: head, sword hand, force hand, input, locomotion, haptics.
// Works in WebXR (Quest etc.) and on desktop (mouse = sword) for testing.
import * as THREE from 'three';
import { MOVE_SPEED, TURN_SPEED, PLAY_R } from './config.js';
import { buildSword, buildGauntlet } from './models.js';

const V = THREE.Vector3, Q = THREE.Quaternion;
const _a = new V(), _b = new V(), _m = new THREE.Matrix4(), _q = new Q();
export const BTN = { trigger: 0, squeeze: 1, stick: 3, a: 4, b: 5 };

export class Player {
  constructor({ renderer, scene, camera, rig }) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.rig = rig;
    this.lefty = new URLSearchParams(location.search).has('lefty');
    this.swordHand = this.lefty ? 'left' : 'right';
    this.forceHand = this.lefty ? 'right' : 'left';

    this.grips = [0, 1].map((i) => renderer.xr.getControllerGrip(i));
    this.rays = [0, 1].map((i) => renderer.xr.getController(i));
    for (let i = 0; i < 2; i++) {
      for (const o of [this.grips[i], this.rays[i]]) {
        o.userData.hand = '';
        o.addEventListener('connected', (e) => { o.userData.hand = e.data.handedness; });
        o.addEventListener('disconnected', () => { o.userData.hand = ''; });
        rig.add(o);
      }
    }

    // models
    this.sword = buildSword();
    this.swordMount = new THREE.Group();
    this.swordMount.add(this.sword.root);
    this.swordGlove = buildGauntlet(this.swordHand);
    this.swordMount.add(this.swordGlove.group);
    this.offMount = new THREE.Group();
    this.offGlove = buildGauntlet(this.forceHand);
    this.offMount.add(this.offGlove.group);

    // desktop stand-ins (children of the camera)
    this.deskSword = new THREE.Group();
    this.deskOff = new THREE.Group();
    this.deskOff.position.set(this.lefty ? 0.24 : -0.24, -0.28, -0.36);
    this.deskOff.rotation.set(Math.PI / 4, this.lefty ? -0.25 : 0.25, 0); // like a controller pointed forward
    camera.add(this.deskSword, this.deskOff);
    this.deskSword.add(this.swordMount);
    this.deskOff.add(this.offMount);
    this.mouse = { x: 0, y: -0.15, has: false };
    this.deskHand = new V(0, -0.3, -0.45);
    this.deskQ = new Q();
    this.keys = {};
    this._bindDesktop();

    // kinematics
    this.head = new V(); this.headFwd = new V(0, 0, -1); this.flatFwd = new V(0, 0, -1);
    this.blade = {
      base: new V(), tip: new V(), mid: new V(), prevBase: new V(), prevTip: new V(),
      vel: new V(), speed: 0, dir: new V(0, 0, -1), hist: [], init: false,
    };
    this.hand = { pos: new V(), vel: new V(), hist: [] };
    this.aim = { origin: new V(), dir: new V(0, 0, -1) };
    this.pointer = new V(0, 0, -1); // desktop: world ray through the mouse cursor

    this.input = {
      grab: false, grabDown: false, grabUp: false, pushDown: false, elemNext: false, elemPrev: false, elemSet: -1,
      charge: false, chargeDown: false,                    // sword trigger / desktop left mouse: charge the beam
      menu: false, hubNow: false, toggleDown: false, // off-hand X (hold) / Y; desktop Esc / T
    };
    this._prev = { sword: [], force: [] };
    this._deskPrev = { grab: false };
    this.reload = 0; this._sq = { sword: 0, force: 0 }; this._reloadArmed = false;
    this.vr = false;
    // movement lab hooks: raw controller state, and a switch that hands translation over
    this.pad = { sword: [], force: [] }; this.padPrev = { sword: [], force: [] };
    this.stick = [0, 0];       // move stick (or WASD), before any deadzone
    this.labMove = false;      // when set, the lab moves the rig; sticks only turn
    this.noReload = false;     // the lab's two-handed grabs would otherwise trip the reload
  }

  get presenting() { return this.renderer.xr.isPresenting; }

  _bindDesktop() {
    const k = this.keys;
    addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      k[key] = true;
      if (e.repeat) return;
      if (e.key >= '1' && e.key <= '3') this._deskElem = +e.key - 1;
      if (key === 'e') this._deskNext = true;
      if (key === 'f') this._deskPush = true;
      if (key === 't') this._deskToggle = true;
      if (key === 'escape') this._deskHub = true;
      if (e.key >= '1' && e.key <= '9') this._deskNum = +e.key;
    });
    addEventListener('keyup', (e) => { k[e.key.toLowerCase()] = false; });
    addEventListener('pointermove', (e) => {
      this.mouse.x = (e.clientX / innerWidth) * 2 - 1;
      this.mouse.y = -((e.clientY / innerHeight) * 2 - 1);
      this.mouse.has = true;
      if (this._look) {
        this.rig.rotation.y -= e.movementX * 0.004;
        this.camera.rotation.x = THREE.MathUtils.clamp(this.camera.rotation.x - e.movementY * 0.003, -1.1, 1.1);
      }
    });
    addEventListener('pointerdown', (e) => { if (e.button === 2) this._look = true; if (e.button === 0) this._deskCharge = true; });
    addEventListener('pointerup', (e) => { if (e.button === 2) this._look = false; if (e.button === 0) this._deskCharge = false; });
    addEventListener('blur', () => { this._deskCharge = false; this._look = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Put the head at (x, z) facing `yaw` (0 = -Z), whatever the room-scale offset.
  teleport(x, z, yaw = 0) {
    const cl = this.camera.position;
    const f = new V(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const camYaw = Math.atan2(-f.x, -f.z);
    const ry = yaw - camYaw, c = Math.cos(ry), s = Math.sin(ry);
    this.rig.rotation.y = ry;
    this.rig.position.set(x - (cl.x * c + cl.z * s), 0, z - (-cl.x * s + cl.z * c));
    this.rig.updateMatrixWorld(true);
    this.blade.init = false; this.blade.hist.length = 0; this.hand.hist.length = 0;
  }
  // Button names for the force hand (left: X/Y, right when ?lefty: A/B).
  get btnNames() { return this.lefty ? ['A', 'B'] : ['X', 'Y']; }

  _src(hand) {
    const s = this.renderer.xr.getSession();
    if (!s) return null;
    for (const src of s.inputSources) if (src.handedness === hand) return src;
    return null;
  }
  _space(list, hand, fallbackIndex) {
    return list.find((g) => g.userData.hand === hand) || list[fallbackIndex];
  }

  pulse(role, intensity, ms) {
    const src = this._src(role === 'sword' ? this.swordHand : this.forceHand);
    const gp = src && src.gamepad;
    if (!gp) return;
    try {
      const h = gp.hapticActuators && gp.hapticActuators[0];
      if (h && h.pulse) h.pulse(Math.min(1, intensity), ms);
      else if (gp.vibrationActuator) gp.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity });
    } catch (_) { /* haptics are best-effort */ }
  }

  // ------------------------------------------------------------------ per frame
  update(dt, now) {
    const vr = this.presenting;
    if (vr !== this.vr) { this.vr = vr; this.blade.init = false; this.blade.hist.length = 0; this.hand.hist.length = 0; }
    if (vr) this.renderer.xr.updateCamera(this.camera);

    this._mount(vr);
    this._readInput(vr, now);
    this._locomotion(dt, vr);
    this.rig.updateMatrixWorld(true);
    if (!vr) this._deskPose(dt);

    this.camera.getWorldPosition(this.head);
    this.camera.getWorldDirection(this.headFwd);
    this.flatFwd.set(this.headFwd.x, 0, this.headFwd.z);
    if (this.flatFwd.lengthSq() < 1e-6) this.flatFwd.set(0, 0, -1); else this.flatFwd.normalize();

    this._trackBlade(dt, now);
    this._trackHand(dt, now, vr);
  }

  _mount(vr) {
    if (vr) {
      const sg = this._space(this.grips, this.swordHand, this.lefty ? 1 : 0);
      const fg = this._space(this.grips, this.forceHand, this.lefty ? 0 : 1);
      if (sg && this.swordMount.parent !== sg) { sg.add(this.swordMount); this.blade.init = false; }
      if (fg && fg !== sg && this.offMount.parent !== fg) fg.add(this.offMount);
    } else {
      if (this.swordMount.parent !== this.deskSword) { this.deskSword.add(this.swordMount); this.blade.init = false; }
      if (this.offMount.parent !== this.deskOff) this.deskOff.add(this.offMount);
    }
  }

  _readInput(vr, now) {
    const I = this.input;
    I.grabDown = I.grabUp = I.pushDown = I.elemNext = I.elemPrev = I.hubNow = I.toggleDown = I.chargeDown = false; I.elemSet = -1; I.num = -1;
    let charge;
    if (vr) {
      const read = (hand) => {
        const gp = this._src(hand)?.gamepad;
        return { b: gp ? gp.buttons.map((x) => x.pressed) : [], ax: gp ? gp.axes : [] };
      };
      const sw = read(this.swordHand), fo = read(this.forceHand);
      const edge = (role, cur, i) => cur.b[i] && !this._prev[role][i];
      if (edge('sword', sw, BTN.a)) I.elemNext = true;
      if (edge('sword', sw, BTN.b)) I.elemPrev = true;
      if (edge('force', fo, BTN.squeeze)) I.pushDown = true;
      if (edge('force', fo, BTN.b)) I.toggleDown = true;   // Y on the left controller
      I.menu = !!fo.b[BTN.a];                              // X on the left controller (hold)
      const g = !!fo.b[BTN.trigger];
      I.grabDown = g && !I.grab; I.grabUp = !g && I.grab; I.grab = g;
      charge = !!sw.b[BTN.trigger];
      // reload: squeeze both grips together and hold
      const sq = { sword: !!sw.b[BTN.squeeze], force: !!fo.b[BTN.squeeze] };
      for (const r of ['sword', 'force']) if (sq[r] && !this._prev[r][BTN.squeeze]) this._sq[r] = now;
      if (sq.sword && sq.force && !this.noReload) {
        if (!this._reloadArmed && Math.abs(this._sq.sword - this._sq.force) < 400) this._reloadArmed = now;
        if (this._reloadArmed) { this.reload = (now - this._reloadArmed) / 1200; if (this.reload >= 1) location.reload(); }
      } else { this._reloadArmed = false; this.reload = 0; }
      this.padPrev = this._prev; this.pad = { sword: sw.b, force: fo.b };
      this._prev = { sword: sw.b, force: fo.b };
      this._axes = { sword: sw.ax, force: fo.ax };
    } else {
      const k = this.keys;
      const g = !!k['q'];
      I.grabDown = g && !I.grab; I.grabUp = !g && I.grab; I.grab = g;
      if (this._deskPush) { I.pushDown = true; this._deskPush = false; }
      if (this._deskNext) { I.elemNext = true; this._deskNext = false; }
      if (this._deskElem !== undefined) { I.elemSet = this._deskElem; this._deskElem = undefined; }
      if (this._deskToggle) { I.toggleDown = true; this._deskToggle = false; }
      if (this._deskHub) { I.hubNow = true; this._deskHub = false; }
      if (this._deskNum) { I.num = this._deskNum; this._deskNum = 0; }
      I.menu = false;
      charge = !!this._deskCharge;
    }
    I.chargeDown = charge && !I.charge; I.charge = charge;
  }

  _stick(ax) { // xr-standard: thumbstick is axes[2,3]; some runtimes only expose [0,1]
    if (!ax || ax.length < 2) return [0, 0];
    return ax.length >= 4 ? [ax[2], ax[3]] : [ax[0], ax[1]];
  }

  _locomotion(dt, vr) {
    let mx = 0, my = 0, turn = 0;
    if (vr) {
      [mx, my] = this._stick(this._axes?.force);
      const [tx] = this._stick(this._axes?.sword);
      if (Math.abs(tx) > 0.2) turn = -tx * TURN_SPEED * dt;
      this.stick = [mx, my];
      if (Math.hypot(mx, my) < 0.18) mx = my = 0;
    } else {
      const k = this.keys;
      my = (k['w'] ? -1 : 0) + (k['s'] ? 1 : 0);
      mx = (k['d'] ? 1 : 0) + (k['a'] ? -1 : 0);
      turn = ((k['arrowleft'] ? 1 : 0) - (k['arrowright'] ? 1 : 0)) * TURN_SPEED * dt;
      this.stick = [mx, my];
    }
    if (turn) {
      this.rig.updateMatrixWorld(true);
      this.camera.getWorldPosition(_a);
      this.rig.rotation.y += turn;
      this.rig.updateMatrixWorld(true);
      this.camera.getWorldPosition(_b);
      this.rig.position.x += _a.x - _b.x; this.rig.position.z += _a.z - _b.z;
    }
    if (this.labMove) return;
    if (mx || my) {
      this.camera.getWorldDirection(_a); _a.y = 0;
      if (_a.lengthSq() < 1e-6) _a.set(0, 0, -1); else _a.normalize();
      _b.set(-_a.z, 0, _a.x);
      const mag = Math.min(1, Math.hypot(mx, my));
      const mv = new V().addScaledVector(_a, -my).addScaledVector(_b, mx);
      if (mv.lengthSq() > 0) mv.normalize().multiplyScalar(MOVE_SPEED * mag * dt);
      this.rig.position.add(mv);
    }
    // keep the head on the platform
    this.rig.updateMatrixWorld(true);
    this.camera.getWorldPosition(_a);
    const r = Math.hypot(_a.x, _a.z);
    if (r > PLAY_R) { const k = (r - PLAY_R) / r; this.rig.position.x -= _a.x * k; this.rig.position.z -= _a.z * k; }
  }

  // Desktop: the mouse places the sword hand; the blade pivots from a virtual
  // shoulder and its edge turns to lead the swing.
  _deskPose(dt) {
    const tx = this.mouse.x * 0.5, ty = -0.28 + this.mouse.y * 0.36;
    const target = _a.set(tx, ty, -0.46);
    const prev = this.deskHand.clone();
    this.deskHand.lerp(target, 1 - Math.exp(-dt * 30));
    const vel = _b.subVectors(this.deskHand, prev).divideScalar(Math.max(dt, 1e-3));
    const pivot = new V(0.3, -0.8, 0.3);
    const dir = this.deskHand.clone().sub(pivot).normalize();
    dir.lerp(new V(0, 0.1, -1).normalize(), 0.25).normalize();
    // grip +Y runs up the forearm, so point it back toward the virtual shoulder
    const up = pivot.clone().sub(this.deskHand).normalize();
    if (Math.abs(up.dot(dir)) > 0.95) up.set(0, -1, 0);
    _m.lookAt(new V(), dir, up);
    _q.setFromRotationMatrix(_m);
    this.deskQ.slerp(_q, 1 - Math.exp(-dt * 25));
    this.deskSword.position.copy(this.deskHand);
    this.deskSword.quaternion.copy(this.deskQ);
    this.camera.getWorldPosition(_b);
    this.pointer.set(this.mouse.x, this.mouse.y, 0.5).unproject(this.camera).sub(_b).normalize();
  }

  _trackBlade(dt, now) {
    const B = this.blade, s = this.sword;
    B.prevBase.copy(B.base); B.prevTip.copy(B.tip);
    s.base.getWorldPosition(B.base); s.tip.getWorldPosition(B.tip); s.mid.getWorldPosition(B.mid);
    B.dir.subVectors(B.tip, B.base).normalize();
    // velocity in rig space so locomotion/turning doesn't count as swinging
    const local = this.rig.worldToLocal(B.tip.clone());
    if (!B.init) { B.prevBase.copy(B.base); B.prevTip.copy(B.tip); B.lastLocal = local; B.init = true; B.hist.length = 0; }
    if (local.distanceTo(B.lastLocal) > 0.6) { B.lastLocal = local; B.prevBase.copy(B.base); B.prevTip.copy(B.tip); B.hist.length = 0; B.speed = 0; return; } // tracking glitch
    const v = local.clone().sub(B.lastLocal).divideScalar(Math.max(dt, 1e-3));
    B.lastLocal = local;
    B.vel.copy(v).applyQuaternion(this.rig.quaternion);
    const sp = v.length();
    B.speed = sp > B.speed ? sp : B.speed * 0.6 + sp * 0.4;
    B.hist.push({ p: local, t: now });
    while (B.hist.length && now - B.hist[0].t > 320) B.hist.shift();
  }
  // Hand position in world space / rig (tracking) space.
  handWorld(role, out) { return (role === 'sword' ? this.swordMount : this.offMount).getWorldPosition(out); }
  handLocal(role, out) { return this.rig.worldToLocal(this.handWorld(role, out)); }
  // Velocity of the blade tip over the last ~`ms` milliseconds (world space).
  tipVelocity(out, ms = 70) {
    const h = this.blade.hist;
    out.set(0, 0, 0);
    if (h.length < 2) return out;
    const b = h[h.length - 1];
    let a = h[h.length - 2];
    for (let i = h.length - 2; i >= 0 && b.t - h[i].t <= ms; i--) a = h[i];
    return out.subVectors(b.p, a.p).divideScalar(Math.max(1e-3, (b.t - a.t) / 1000)).applyQuaternion(this.rig.quaternion);
  }
  // Tip path length over the last `ms` milliseconds.
  arc(ms = 160) {
    const h = this.blade.hist, end = h.length ? h[h.length - 1].t : 0;
    let d = 0;
    for (let i = h.length - 1; i > 0 && end - h[i - 1].t <= ms; i--) d += h[i].p.distanceTo(h[i - 1].p);
    return d;
  }

  _trackHand(dt, now, vr) {
    const H = this.hand;
    this.offMount.getWorldPosition(H.pos);
    const local = this.rig.worldToLocal(H.pos.clone());
    H.hist.push({ p: local, t: now });
    while (H.hist.length && now - H.hist[0].t > 90) H.hist.shift();
    if (H.hist.length > 1) {
      const a = H.hist[0], b = H.hist[H.hist.length - 1];
      H.vel.subVectors(b.p, a.p).divideScalar(Math.max(1e-3, (b.t - a.t) / 1000)).applyQuaternion(this.rig.quaternion);
    }
    if (vr) {
      const ray = this._space(this.rays, this.forceHand, this.lefty ? 0 : 1);
      if (ray && ray.visible) {
        ray.getWorldPosition(this.aim.origin);
        this.aim.dir.set(0, 0, -1).applyQuaternion(ray.getWorldQuaternion(_q)).normalize();
        return;
      }
    }
    this.aim.origin.copy(H.pos);
    this.aim.dir.copy(this.headFwd);
  }
}
