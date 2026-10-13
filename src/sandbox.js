// Training hall: a hub of crystals (slash one to choose) plus one station per
// mechanic. Stations give infinite ⚡, no damage, respawning dummies, a live
// stats panel, and a toggle to switch beat judging off so a mechanic can be
// felt on its own.
import * as THREE from 'three';
import { PERFECT, GOOD, SWING, CAD_MAX, PLAYER_HP, ELEMENTS } from './config.js';
import { glowTexture } from './fx.js';

const V = THREE.Vector3;
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const ms = (s) => Math.round(s * 1000);
const signedMs = (s) => `${s >= 0 ? '+' : '−'}${Math.abs(ms(s))} ms`;
const GRADE_CSS = { perfect: '#ffd27a', good: '#dfe6ff', off: '#8a90a8' };
const HUB_SPOT = [0, 0];

// Positions are world x/z; every station faces -Z from its spot.
const passive = (hp) => ({ passive: true, hp });
const STATIONS = {
  rhythm: {
    name: 'RHYTHM', sub: 'timing + calibration', color: 0xffd27a, spot: [0, 0],
    slots: [{ type: 'grunt', at: [0, -1.4], cfg: passive(400) }],
  },
  beam: {
    name: 'BEAM', sub: 'heavy swing → crescent', color: 0xb68cff, spot: [0, 0],
    slots: [[-2.2, -4.5], [0, -5.2], [2.2, -4.5]].map((at) => ({ type: 'grunt', at, cfg: passive(160) })),
  },
  force: {
    name: 'FORCE', sub: 'grab · throw · push', color: 0xffe2a0, spot: [0, -2.2],
    slots: [[-1.3, -4.8], [0, -5.1], [1.3, -4.8], [-2.3, -2.9], [2.3, -2.9]].map((at) => ({ type: 'grunt', at, cfg: passive(160) })),
  },
  elements: {
    name: 'ELEMENTS', sub: 'mix two for a reaction', color: 0x56d8ff, spot: [0, 0],
    slots: [[-1.3, -1.45], [0, -1.7], [1.3, -1.45]].map((at) => ({ type: 'grunt', at, cfg: passive(320) })),
  },
  parry: {
    name: 'PARRY', sub: 'block · parry · interrupt', color: 0xff2a48, spot: [0, 0],
    slots: [{ type: 'grunt', at: [0, -1.4], cfg: { every: 4, phase: 0, hp: 400 } }],
  },
  deflect: {
    name: 'DEFLECT', sub: 'slash orbs back', color: 0xff7ad0, spot: [0, 0],
    slots: [{ type: 'caster', at: [0.5, -4.4], cfg: { every: 4, phase: 0, hp: 160 } }],
  },
};
const ORDER = ['rhythm', 'beam', 'force', 'elements', 'parry', 'deflect'];

function labelSprite(name, sub, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const x = c.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '900 70px system-ui, -apple-system, Segoe UI, sans-serif';
  x.lineWidth = 10; x.strokeStyle = 'rgba(0,0,0,.75)'; x.lineJoin = 'round';
  x.strokeText(name, 256, 56, 500); x.fillStyle = color; x.fillText(name, 256, 56, 500);
  x.font = '600 32px system-ui, -apple-system, Segoe UI, sans-serif';
  x.strokeText(sub, 256, 124, 500); x.fillStyle = '#dfe4ff'; x.fillText(sub, 256, 124, 500);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  s.scale.set(0.42, 0.131, 1);
  s.renderOrder = 10; // draw after the (transparent) hub board behind it
  return s;
}

function buildCrystal(id, name, sub, color, size) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, metalness: 0.3, roughness: 0.2, flatShading: true });
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.09 * size, 0), mat);
  gem.scale.set(1, 1.5, 1);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  halo.scale.setScalar(0.42 * size);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13 * size, 0.005, 4, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, toneMapped: false }));
  const label = labelSprite(name, sub, hex(color));
  label.position.y = 0.24 * size;
  group.add(gem, halo, ring, label);
  group.visible = false;
  return { id, group, gem, mat, halo, ring, label, size, base: new V(), inside: false, hover: 0 };
}

export class Sandbox {
  constructor({ game, player, scene, board, fade, comboHud, audio, fx }) {
    Object.assign(this, { game, player, scene, board, fade, comboHud, audio, fx });
    this.mode = 'hub';
    this.slots = [];
    this.stats = null;
    this.holdK = 0; this._hold = 0;
    this.overReadyAt = 0;
    this.reposeAt = 0;
    this.dirty = true; this._lastDraw = 0;
    this.swing = null;
    this.onModeChange = null;
    this.crystals = [buildCrystal('play', 'PLAY', 'the full game', 0xffd27a, 1.3)];
    for (const id of ORDER) { const S = STATIONS[id]; this.crystals.push(buildCrystal(id, S.name, S.sub, S.color, 1)); }
    for (const c of this.crystals) scene.add(c.group);
    this._layoutHub();
    this._showHubBoard();
  }

  get station() { return STATIONS[this.mode] || null; }
  get modeLabel() { return this.station ? this.station.name : this.mode === 'hub' ? 'TRAINING HALL' : 'CADENCE'; }

  // ------------------------------------------------------------------ mode changes
  enter(id) {
    if (this.fade.busy || !(id === 'hub' || id === 'play' || STATIONS[id])) return;
    this.fade.run(() => this._enter(id));
  }
  _enter(id) {
    const g = this.game, P = this.player;
    g.clearField();
    g._resetRun();
    g.freeTiming = false;
    g._retier();
    this.audio.unmuffle();
    this.slots = []; this.swing = null; this.holdK = 0; this._hold = 0;
    this.mode = id;
    this.onModeChange?.(id);
    if (id === 'hub') {
      P.teleport(...HUB_SPOT, 0);
      g.state = 'hub';
      this._layoutHub();
      this._showHubBoard();
      return;
    }
    if (id === 'play') {
      P.teleport(...HUB_SPOT, 0);
      g._startRun();
      return;
    }
    const S = STATIONS[id];
    P.teleport(S.spot[0], S.spot[1], 0);
    g.state = 'sandbox';
    for (const def of S.slots) this.slots.push({ def, enemy: null, respawnAt: g.beat + 1 });
    this.stats = { n: {}, last: null, hits: [], bars: null };
    const a = -0.66, sx = S.spot[0], sz = S.spot[1];
    this.board.setPose(new V(sx + Math.sin(a) * 3, 2.2, sz - Math.cos(a) * 3), new V(sx, 1.7, sz), 0.85);
    this.board.visible = true;
    this.dirty = true;
    this.comboHud.message(S.name, hex(S.color), 1.6);
  }
  onGameOver() {
    this.mode = 'over';
    this.overReadyAt = performance.now() + 2500;
    this._layoutHub();
    this.board.setPose(new V(0, 2.3, -3.6), new V(0, 1.7, 0), 1);
  }
  onSessionStart() {
    this.reposeAt = performance.now() + 500; // wait for a real headset pose
    if (this.mode === 'hub') this._showHubBoard();
  }
  _showHubBoard() {
    this.board.hub(this.game.best, this.player.presenting, this.player.btnNames);
    this.board.setPose(new V(0, 2.3, -3.6), new V(0, 1.7, 0), 1);
    this.board.visible = true;
  }
  _layoutHub() {
    const y = Math.max(1.1, this.player.camera.position.y || 1.6);
    const place = (c, deg, r, h) => {
      const a = (deg * Math.PI) / 180;
      c.base.set(HUB_SPOT[0] + Math.sin(a) * r, h, HUB_SPOT[1] - Math.cos(a) * r);
    };
    place(this.crystals[0], 0, 0.9, y - 0.25);
    [-78, -52, -26, 26, 52, 78].forEach((deg, i) => place(this.crystals[i + 1], deg, 1.05, y - 0.42));
  }

  // ------------------------------------------------------------------ per frame
  update(dt, t, now) {
    const g = this.game, P = this.player, I = P.input;
    if (this.reposeAt && now >= this.reposeAt) {
      this.reposeAt = 0;
      const S = this.station;
      P.teleport(...(S ? S.spot : HUB_SPOT), 0);
      this._layoutHub();
    }
    this._crystals(dt, t, now);

    // back to the hub: hold X (VR) or Esc (desktop)
    if (this.mode !== 'hub') {
      this._hold = I.menu ? this._hold + dt : 0;
      this.holdK = this._hold / 0.6;
      if (I.hubNow || this.holdK >= 1) { this.holdK = 0; this._hold = 0; this.enter('hub'); }
    }
    if (g.state !== 'sandbox') return;

    g.cad = CAD_MAX; g.hp = PLAYER_HP;
    if (I.toggleDown) this._toggle();
    if (this.mode === 'beam') this._trackSwing();
    if (this.dirty && now - this._lastDraw > 120) { this._draw(); this._lastDraw = now; this.dirty = false; }
  }

  onBeat(b) {
    for (const sl of this.slots) {
      if (sl.enemy && sl.enemy.alive) continue;
      if (sl.respawnAt === null) sl.respawnAt = b + 2;
      else if (b >= sl.respawnAt) {
        const pos = new V(sl.def.at[0], 0, sl.def.at[1]);
        sl.enemy = this.game.spawnAt(sl.def.type, pos, b, { ...sl.def.cfg, post: pos.clone() });
        sl.respawnAt = null;
      }
    }
  }

  _crystals(dt, t, now) {
    const g = this.game, B = this.player.blade;
    const show = !this.fade.busy && (g.state === 'hub' || (g.state === 'over' && now > this.overReadyAt));
    for (const c of this.crystals) {
      c.group.visible = show;
      if (!show) { c.inside = false; continue; }
      c.group.position.copy(c.base).add(new V(0, Math.sin(t * 1.6 + c.base.x * 3) * 0.025, 0));
      c.group.lookAt(this.player.head);
      c.gem.rotation.y += dt * 0.9;
      let d = Infinity;
      if (B.init) {
        const ab = new V().subVectors(B.tip, B.base);
        const k = Math.max(0, Math.min(1, new V().subVectors(c.group.position, B.base).dot(ab) / ab.lengthSq()));
        d = c.group.position.distanceTo(new V().copy(B.base).addScaledVector(ab, k));
      }
      c.hover += ((d < 0.35 ? 1 : 0) - c.hover) * Math.min(1, dt * 10);
      const s = 1 + c.hover * 0.18;
      c.gem.scale.set(s, 1.5 * s, s);
      c.mat.emissiveIntensity = 0.4 + g.pulse * 1.2 + c.hover * 1.2;
      c.ring.scale.setScalar(1 + (1 - g.phase) * 0.3 + c.hover * 0.2);
      c.ring.material.opacity = 0.25 + g.phase * 0.5 + c.hover * 0.3;
      const inside = d < 0.16 * c.size;
      if (inside && !c.inside && B.speed > 1.8) this._select(c);
      c.inside = inside;
    }
  }
  _select(c) {
    const pos = c.group.position.clone(), col = c.mat.color.getHex();
    this.fx.particles.burst(pos, 40, col, { speed: 3.5, size: 0.045, life: 0.7, grav: -3 });
    this.fx.flash(pos, col, 0.6, 0.3);
    this.audio.uiStart();
    this.player.pulse('sword', 0.8, 80);
    for (const x of this.crystals) x.group.visible = false;
    this.enter(c.id);
  }

  _toggle() {
    const g = this.game;
    if (this.mode === 'rhythm') {
      const h = this.stats.hits;
      if (h.length < 6) { g.setInputOffset(0); this.comboHud.message('calibration reset to 0 ms', '#ffd27a', 1.8); }
      else {
        const mean = h.reduce((a, b) => a + b, 0) / h.length / 1000;
        g.setInputOffset(g.inputOffset + mean);
        this.comboHud.message(`calibrated: ${signedMs(g.inputOffset)}`, '#4ade80', 1.8);
        h.length = 0;
      }
    } else {
      g.freeTiming = !g.freeTiming;
      this.comboHud.message(g.freeTiming ? 'BEAT JUDGING OFF' : 'BEAT JUDGING ON', g.freeTiming ? '#f59e0b' : '#4ade80', 1.6);
    }
    this.dirty = true;
  }

  // Beam station: segment the blade's motion into swings and explain each one.
  _trackSwing() {
    const B = this.player.blade, sp = B.speed;
    if (!this.swing && sp > 2.6) this.swing = { peak: 0, arc: 0, events: new Set(), grade: null };
    const w = this.swing;
    if (!w) return;
    w.peak = Math.max(w.peak, sp);
    w.arc = Math.max(w.arc, this.player.arc(200));
    if (sp > 1.8) return;
    this.swing = null;
    if (w.peak < 3) return;
    let text, color = '#f59e0b';
    if (w.events.has('fired')) { text = `BEAM · ${w.grade.toUpperCase()}`; color = GRADE_CSS[w.grade]; this._count('beams'); }
    else if (w.events.has('dud')) { text = 'OFF BEAT — fizzled'; color = '#8a90a8'; this._count('duds'); }
    else if (w.events.has('close')) text = 'TOO CLOSE — that was a melee swing';
    else if (w.events.has('cooldown')) text = 'COOLDOWN — one beam per beat';
    else if (w.peak < SWING.beamSpeed) text = 'TOO SLOW';
    else if (w.arc < SWING.beamArc) text = 'TOO SHORT — longer arc';
    else text = 'NO BEAM';
    this._count('swings');
    this.stats.last = { text, color, sub: `peak ${w.peak.toFixed(1)} m/s · arc ${w.arc.toFixed(2)} m` };
    this.stats.bars = [
      { label: 'SPEED', value: w.peak, max: 10, mark: SWING.beamSpeed, unit: 'm/s' },
      { label: 'ARC', value: w.arc, max: 1.2, mark: SWING.beamArc, unit: 'm' },
    ];
    this.dirty = true;
  }

  _count(k, n = 1) { this.stats.n[k] = (this.stats.n[k] || 0) + n; }
  _last(text, color = '#fff', sub = '') { this.stats.last = { text, color, sub }; }

  // Game events → station stats.
  event(type, d) {
    if (this.game.state !== 'sandbox' || !this.stats) return;
    const m = this.mode, free = this.game.freeTiming;
    const timing = (off) => (free ? 'beat judging off' : `${signedMs(off)} ${off >= 0 ? 'late' : 'early'}`);
    if (m === 'rhythm' && type === 'slash') {
      this.stats.hits.push(ms(d.off));
      if (this.stats.hits.length > 24) this.stats.hits.shift();
      this._count(d.grade);
      this._last(d.grade === 'off' ? 'OFF BEAT' : d.grade.toUpperCase(), GRADE_CSS[d.grade], timing(d.off));
    } else if (m === 'beam' && type === 'beam') {
      if (this.swing) { this.swing.events.add(d.kind); if (d.kind === 'fired') this.swing.grade = d.grade; }
    } else if (m === 'beam' && type === 'beamHit') this._count('hits');
    else if (m === 'force') {
      if (type === 'grab' && d.kind !== 'miss') { this._count('grabs'); this._last(d.kind === 'yank' ? 'YANK — off beat, no hold' : 'GRABBED', d.kind === 'yank' ? '#8a90a8' : '#ffe2a0', 'flick your hand and release to throw'); }
      else if (type === 'grab') this._last('NOTHING IN SIGHTS', '#8a90a8', 'point your off-hand until a gold ring appears');
      else if (type === 'throw') { this._count('throws'); this._last(`THROW · ${d.grade.toUpperCase()}`, GRADE_CSS[d.grade], d.vr ? `hand ${d.handSpeed.toFixed(1)} m/s → ${d.speed.toFixed(1)} m/s` : 'desktop throws along your aim'); this.stats.bars = d.vr ? [{ label: 'FLICK', value: d.handSpeed, max: 6, mark: 1.4, unit: 'm/s' }] : null; }
      else if (type === 'drop') { this._last(d.timeout ? 'HELD TOO LONG — dropped' : 'DROPPED — flick harder', '#8a90a8', `hand ${d.handSpeed.toFixed(1)} m/s (need 1.4)`); this.stats.bars = [{ label: 'FLICK', value: d.handSpeed, max: 6, mark: 1.4, unit: 'm/s' }]; }
      else if (type === 'push') { this._count('pushes'); this._last(d.grade === 'off' ? 'PUSH · OFF BEAT (weak)' : `PUSH · ${d.grade.toUpperCase()}`, d.grade === 'off' ? '#8a90a8' : '#ffe2a0', `${d.hits} hit`); }
      else if (type === 'impact') { this._count('impacts'); this._last(`IMPACT ${Math.round(d.dmg)}`, '#ffe2a0'); }
      else if (type === 'ringout') { this._count('ring outs'); this._last('RING OUT!', '#ffd27a'); }
    } else if (m === 'elements') {
      if (type === 'reaction') { this._count(d.name); this._last(`${d.name}!`, d.css, `${d.from.toUpperCase()} → ${d.to.toUpperCase()}`); }
      else if (type === 'status') this._last(`marked ${d.el.toUpperCase()}`, hex(ELEMENTS.find((e) => e.id === d.el).color), 'now switch element and hit it again');
    } else if (m === 'parry') {
      if (type === 'strike') {
        this._count(d.result);
        const L = { parry: ['PARRY', '#ffd27a', 'swung into the blow — staggered it'], block: ['BLOCK', '#dfe6ff', 'blade held across the blow'], dodge: ['DODGED', '#8a90a8', 'out of reach'], hit: ['HIT', '#f43f5e', 'put your blade across the red arc'] }[d.result];
        this._last(...L);
      } else if (type === 'interrupt') { this._count('interrupt'); this._last('INTERRUPT', '#4ade80', 'PERFECT hit during the wind-up'); }
    } else if (m === 'deflect') {
      if (type === 'deflect') { this._count(d.grade); this._last(d.grade === 'off' ? 'DEFLECT · OFF BEAT' : `${d.grade.toUpperCase()} DEFLECT`, GRADE_CSS[d.grade], timing(d.off)); }
      else if (type === 'orbHit') { this._count('hit'); this._last('HIT', '#f43f5e', 'slash the orb as its ring closes'); }
    }
    this.dirty = true;
  }

  // ------------------------------------------------------------------ panel
  _draw() {
    const S = this.station, g = this.game, P = this.player, n = this.stats.n;
    const vr = P.presenting, [X, Y] = P.btnNames;
    const back = vr ? `hold ${X}: hub` : 'Esc: hub';
    const tog = vr ? Y : 'T';
    const judging = g.freeTiming ? 'beat judging OFF' : 'beat judging ON';
    const d = { name: S.name, css: hex(S.color), last: this.stats.last, footer: `${judging} · ${tog}: toggle · ${back}` };
    const cnt = (k) => n[k] || 0;
    switch (this.mode) {
      case 'rhythm': {
        const h = this.stats.hits, mean = h.length ? h.reduce((a, b) => a + b, 0) / h.length : 0;
        const spread = h.length > 1 ? Math.sqrt(h.reduce((a, b) => a + (b - mean) ** 2, 0) / h.length) : 0;
        const total = cnt('perfect') + cnt('good') + cnt('off');
        d.lines = [
          'Slash the dummy on the beat — each hit lands on the chart below.',
          'The green ▲ is your average. Centred = your feel matches the clock.',
          `If it sits off-centre, press ${tog} to calibrate (needs 6+ hits).`,
        ];
        d.timing = { hits: h, mean, perfect: ms(PERFECT), good: ms(GOOD) };
        d.stats = [['HITS', total], ['PERFECT', total ? `${Math.round((100 * cnt('perfect')) / total)}%` : '–'], ['AVERAGE', h.length ? `${mean >= 0 ? '+' : ''}${Math.round(mean)} ms` : '–'],
          ['SPREAD', h.length > 1 ? `±${Math.round(spread)} ms` : '–'], ['CALIBRATION', signedMs(g.inputOffset)]];
        d.footer = `${tog}: apply calibration (fewer than 6 hits resets it) · ${back}`;
        break;
      }
      case 'beam':
        d.lines = [
          'Swing hard through empty air ON the beat to launch a crescent.',
          `Needs ${SWING.beamSpeed} m/s and a ${SWING.beamArc} m arc. Near a target it's a melee swing instead.`,
          'The crescent follows your swing plane: flat swing → flat wave.',
        ];
        d.bars = this.stats.bars;
        d.stats = [['SWINGS', cnt('swings')], ['BEAMS', cnt('beams')], ['TARGET HITS', cnt('hits')], ['FIZZLED', cnt('duds')]];
        if (!d.last) d.last = { text: 'swing big!', color: '#b68cff' };
        break;
      case 'force':
        d.lines = vr ? [
          'Point your off-hand — a gold ring marks what you\'re locked onto.',
          'TRIGGER: grab and hold · flick your hand and release to throw.',
          'GRIP: push. On the beat it launches them — clear the front row off the edge.',
        ] : [
          'Look at a target — a gold ring marks what you\'re locked onto.',
          'Hold Q to grab · release to throw it where you look.',
          'F: push. On the beat it launches them — clear the front row off the edge.',
        ];
        d.bars = this.stats.bars;
        d.stats = [['GRABS', cnt('grabs')], ['THROWS', cnt('throws')], ['IMPACTS', cnt('impacts')], ['PUSHES', cnt('pushes')], ['RING OUTS', cnt('ring outs')]];
        break;
      case 'elements':
        d.lines = [
          `Your blade's element (${vr ? 'A / B' : 'E or 1–3'} to switch) marks what it hits — watch the rim.`,
          'Hit a marked enemy with a DIFFERENT element for a reaction:',
          'FIRE+ICE = SHATTER · ICE+VOLT = SUPERCONDUCT · VOLT+FIRE = OVERLOAD',
        ];
        d.stats = [['SHATTER', cnt('SHATTER')], ['SUPERCONDUCT', cnt('SUPERCONDUCT')], ['OVERLOAD', cnt('OVERLOAD')]];
        if (!d.last) d.last = { text: `blade: ${ELEMENTS[g.el].name}`, color: ELEMENTS[g.el].css };
        break;
      case 'parry':
        d.lines = [
          'This grunt attacks every bar. The red arc gives you two beats of warning.',
          'Hold your blade across the blow to BLOCK — swing into it to PARRY.',
          'Or land a PERFECT hit during the wind-up to INTERRUPT. Step back to dodge.',
        ];
        d.stats = [['PARRY', cnt('parry')], ['BLOCK', cnt('block')], ['INTERRUPT', cnt('interrupt')], ['DODGE', cnt('dodge')], ['HIT', cnt('hit')]];
        break;
      case 'deflect':
        d.lines = [
          'The caster throws an orb every bar.',
          'Slash it as its gold ring closes — that moment is the beat.',
          'PERFECT sends it back hard, carrying your blade\'s element.',
        ];
        d.stats = [['PERFECT', cnt('perfect')], ['GOOD', cnt('good')], ['OFF', cnt('off')], ['HIT', cnt('hit')]];
        break;
    }
    this.board.station(d);
  }
}

export const MODES = [['hub', 'Hub'], ['play', 'Play'], ...ORDER.map((id) => [id, STATIONS[id].name[0] + STATIONS[id].name.slice(1).toLowerCase()])];
