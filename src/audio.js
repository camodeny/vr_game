// Audio: the music *is* the clock. Everything rhythmic in the game reads
// `audio.t` — song time in seconds, measured at the moment a sample is heard —
// so visuals, judgement and enemy attacks all line up with what you hear.
import { BEAT, STEP } from './config.js';

const LOOKAHEAD = 0.2;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const R = () => Math.random() * 2 - 1;

// D minor, i – VI – III – VII. One chord per bar.
const CHORDS = [
  { root: 38, pad: [57, 62, 65, 69] }, // Dm
  { root: 34, pad: [58, 62, 65, 70] }, // Bb
  { root: 41, pad: [57, 60, 65, 69] }, // F
  { root: 36, pad: [55, 60, 64, 67] }, // C
];
const ARP = [0, 1, 2, 3, 1, 2, 3, 2];
// Lead hook, eighth notes per bar. 0 = rest, -1 = hold previous.
const LEAD = [
  [69, -1, 74, -1, 76, 77, -1, 76],
  [74, -1, -1, -1, 77, -1, 76, 74],
  [72, -1, 69, -1, 72, 74, -1, 72],
  [67, -1, -1, -1, 76, -1, 74, 72],
];

// Offline biquad (RBJ cookbook) for baking drum samples.
function biquad(d, sr, type, f, q = 0.707) {
  const w = (2 * Math.PI * f) / sr, cs = Math.cos(w), a = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
  else { b0 = a; b1 = 0; b2 = -a; }
  const a0 = 1 + a, a1 = -2 * cs, a2 = 1 - a;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i], y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y;
  }
  return d;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.t = 0;              // song time (s), as heard
    this.seqOn = false;
    this.startCtx = 0;       // ctx time of song t = 0
    this.nextStep = 0;
    this.tier = 0;           // 0 = title, 1..4 = combo tiers
    this.muted = false;
    this._pb = undefined;
    this._off = null;
  }

  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        this._build();
      } catch (e) { console.warn('audio unavailable', e); this.ctx = null; return; }
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }
  get running() { return !!this.ctx && this.ctx.state === 'running'; }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }
  ctxTimeOf(songT) { return Math.max(this.now, this.startCtx + songT); }

  // ---------------------------------------------------------------- clock
  _heard(perf) {
    const ac = this.ctx;
    let est;
    if (ac.getOutputTimestamp) {
      const ts = ac.getOutputTimestamp();
      if (ts.contextTime > 0 && ts.performanceTime > 0) est = ts.contextTime + (perf * 1000 - ts.performanceTime) / 1000;
    }
    if (est === undefined) est = ac.currentTime - (ac.outputLatency || ac.baseLatency || 0);
    const off = est - perf;
    if (this._off === null || Math.abs(off - this._off) > 0.08) this._off = off;
    else this._off += (off - this._off) * 0.04;
    return perf + this._off;
  }

  update() {
    const perf = performance.now() / 1000;
    if (this.running) {
      const heard = this._heard(perf);
      if (!this.seqOn) {
        this.startCtx = heard - this.t;
        this.seqOn = true;
        this.nextStep = Math.ceil((this.t + 0.06) / STEP);
      }
      this.t = Math.max(this.t, heard - this.startCtx);
      this._schedule();
    } else if (!this.seqOn) {
      if (this._pb === undefined) this._pb = perf;
      this.t = perf - this._pb;
    }
    return this.t;
  }

  _schedule() {
    const ac = this.ctx;
    for (;;) {
      const ts = this.startCtx + this.nextStep * STEP;
      if (ts > ac.currentTime + LOOKAHEAD) break;
      if (ts >= ac.currentTime - 0.005) this._step(this.nextStep, ts);
      this.nextStep++;
    }
  }

  chordAt(songT) {
    const bar = Math.floor(songT / (BEAT * 4));
    return CHORDS[((bar % 4) + 4) % 4];
  }
  // A melodic note for the n-th hit of a combo: climbs the current chord.
  hitNote(combo) {
    const ch = this.chordAt(this.t);
    return ch.pad[combo % 4] + 12 + 12 * (Math.floor(combo / 4) % 2);
  }

  // ---------------------------------------------------------------- graph
  _build() {
    const ac = this.ctx;
    this.master = ac.createGain();
    this.master.gain.value = 0.9;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.18;
    const limiter = ac.createDynamicsCompressor(); // brickwall-ish safety for big SFX pile-ups
    limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.001; limiter.release.value = 0.08;
    this.master.connect(comp).connect(limiter).connect(ac.destination);

    this.musicFilter = ac.createBiquadFilter();
    this.musicFilter.type = 'lowpass'; this.musicFilter.frequency.value = 20000; this.musicFilter.Q.value = 0.8;
    this.music = ac.createGain(); this.music.gain.value = 0.5;
    this.music.connect(this.musicFilter).connect(this.master);

    this.sfx = ac.createGain(); this.sfx.gain.value = 0.7;
    this.sfx.connect(this.master);

    this.reverb = ac.createConvolver();
    this.reverb.buffer = this._impulse(2.6);
    this.reverbSend = ac.createGain(); this.reverbSend.gain.value = 0.32;
    this.reverbSend.connect(this.reverb).connect(this.master);

    this.delay = ac.createDelay(2); this.delay.delayTime.value = BEAT * 0.75;
    const fb = ac.createGain(); fb.gain.value = 0.32;
    const dlp = ac.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2600;
    this.delay.connect(dlp); dlp.connect(fb).connect(this.delay); dlp.connect(this.musicFilter);
    this.delaySend = ac.createGain(); this.delaySend.gain.value = 0.28;
    this.delaySend.connect(this.delay);

    this.smp = this._bake();
    this._swingInit();
  }

  _buf(dur, fn, ch = 1) {
    const ac = this.ctx, n = Math.max(1, Math.floor(dur * ac.sampleRate));
    const b = ac.createBuffer(ch, n, ac.sampleRate);
    for (let c = 0; c < ch; c++) fn(b.getChannelData(c), ac.sampleRate, c);
    return b;
  }

  _impulse(len) {
    return this._buf(len, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = R() * Math.pow(1 - t / len, 2.6) * (t < 0.012 ? t / 0.012 : 1);
      }
      biquad(d, sr, 'lp', 5200);
    }, 2);
  }

  _bake() {
    const noise = (d) => { for (let i = 0; i < d.length; i++) d[i] = R(); return d; };
    const S = {};
    S.noise = this._buf(2, (d) => noise(d));
    S.kick = this._buf(0.5, (d, sr) => {
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, f = 44 + 130 * Math.exp(-t * 26);
        ph += (2 * Math.PI * f) / sr;
        const env = t < 0.002 ? t / 0.002 : Math.exp(-t * 5.2);
        const x = Math.sin(ph) * env + R() * Math.exp(-t * 380) * 0.22;
        d[i] = Math.tanh(x * 1.5) * 0.92;
      }
    });
    S.snare = this._buf(0.32, (d, sr) => {
      noise(d); biquad(d, sr, 'hp', 1600);
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr; ph += (2 * Math.PI * (178 + 60 * Math.exp(-t * 45))) / sr;
        d[i] = d[i] * Math.exp(-t * 15) * 0.6 + Math.sin(ph) * Math.exp(-t * 22) * 0.5;
      }
    });
    S.clap = this._buf(0.38, (d, sr) => {
      noise(d); biquad(d, sr, 'bp', 1250, 1.1);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr; let e = 0;
        for (let k = 0; k < 3; k++) { const tk = t - k * 0.011; if (tk >= 0) e = Math.max(e, Math.exp(-tk * (k < 2 ? 170 : 15))); }
        d[i] *= e * 2.2;
      }
    });
    const hat = (len, decay) => this._buf(len, (d, sr) => {
      noise(d); biquad(d, sr, 'hp', 7200); biquad(d, sr, 'hp', 7200);
      for (let i = 0; i < d.length; i++) d[i] *= Math.exp((-i / sr) * decay) * 0.9;
    });
    S.hat = hat(0.07, 62);
    S.ohat = hat(0.42, 8);
    S.shaker = this._buf(0.12, (d, sr) => {
      noise(d); biquad(d, sr, 'bp', 6200, 0.8);
      for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] *= (t < 0.014 ? t / 0.014 : Math.exp(-(t - 0.014) * 38)) * 1.4; }
    });
    S.crash = this._buf(2.2, (d, sr) => {
      noise(d); biquad(d, sr, 'hp', 3800);
      for (let i = 0; i < d.length; i++) d[i] *= Math.exp((-i / sr) * 1.8) * 0.8;
    }, 2);
    S.crackle = this._buf(0.7, (d, sr) => {
      let v = 0;
      for (let i = 0; i < d.length; i++) {
        if (Math.random() < 0.0035) v = R() * (0.5 + Math.random() * 0.5);
        v *= 0.93; d[i] = v;
      }
      biquad(d, sr, 'hp', 1400);
    });
    return S;
  }

  // ---------------------------------------------------------------- music
  _play(buf, t, { gain = 1, rate = 1, dest = this.music, rev = 0, offset = 0, dur } = {}) {
    const ac = this.ctx, s = ac.createBufferSource(), g = ac.createGain();
    s.buffer = buf; s.playbackRate.value = rate; g.gain.value = gain;
    s.connect(g).connect(dest);
    if (rev) { const r = ac.createGain(); r.gain.value = rev; g.connect(r).connect(this.reverbSend); }
    s.start(t, offset, dur);
    return s;
  }

  _step(n, t) {
    const tier = this.tier, s16 = ((n % 16) + 16) % 16, bar = Math.floor(n / 16);
    const ch = CHORDS[((bar % 4) + 4) % 4];
    const onBeat = s16 % 4 === 0, offEighth = s16 % 4 === 2;
    if (s16 === 0) this._pad(t, ch.pad, BEAT * 4, tier);
    if (tier === 0) {
      if (s16 === 0 || s16 === 8) this._play(this.smp.kick, t, { gain: 0.45 });
      if (offEighth) this._play(this.smp.hat, t, { gain: 0.06 });
      return;
    }
    if (onBeat) this._play(this.smp.kick, t, { gain: 0.95 });
    if (offEighth) this._play(tier >= 4 ? this.smp.ohat : this.smp.hat, t, { gain: tier >= 4 ? 0.13 : 0.2 });
    if (tier >= 2) {
      if (s16 === 4 || s16 === 12) this._play(this.smp.clap, t, { gain: 0.42, rev: 0.3 });
      if (offEighth) this._bass(t, ch.root + 12 + (s16 === 14 ? 12 : 0), STEP * 1.7);
      if (bar % 4 === 3 && s16 >= 12) this._play(this.smp.snare, t, { gain: 0.14 + (s16 - 12) * 0.07 });
    }
    if (tier >= 3) {
      this._play(this.smp.shaker, t, { gain: s16 % 2 ? 0.05 : 0.08 });
      this._arp(t, ch.pad[ARP[s16 % 8]] + 12);
    }
    if (tier >= 4) {
      if (s16 % 2 === 0) {
        const line = LEAD[((bar % 4) + 4) % 4], i = s16 / 2, m = line[i];
        if (m > 0) { let len = 1; while (i + len < 8 && line[i + len] === -1) len++; this._lead(t, m, STEP * 2 * len); }
      }
      if (s16 === 0 && bar % 4 === 0) this._play(this.smp.crash, t, { gain: 0.2, rev: 0.2 });
    }
  }

  _pad(t, notes, dur, tier) {
    const ac = this.ctx, f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = 'lowpass'; f.frequency.value = [650, 850, 1200, 1800, 2600][tier]; f.Q.value = 0.9;
    const peak = tier === 0 ? 0.075 : 0.05;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.4);
    g.gain.setValueAtTime(peak, t + dur - 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5);
    f.connect(g).connect(this.music);
    const r = ac.createGain(); r.gain.value = 0.7; g.connect(r).connect(this.reverbSend);
    for (const m of notes) for (const det of [-9, 9]) {
      const o = ac.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.6);
    }
  }

  _bass(t, m, dur) {
    const ac = this.ctx, o = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.value = hz(m);
    o2.type = 'square'; o2.frequency.value = hz(m); o2.detune.value = -6;
    f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(1700, t); f.frequency.exponentialRampToValueAtTime(240, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.26, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); o2.connect(f); f.connect(g).connect(this.music);
    o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }

  _arp(t, m) {
    const ac = this.ctx, o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'square'; o.frequency.value = hz(m);
    f.type = 'lowpass'; f.frequency.value = 3000;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.065, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(f).connect(g); g.connect(this.music); g.connect(this.delaySend);
    o.start(t); o.stop(t + 0.2);
  }

  _lead(t, m, dur) {
    const ac = this.ctx, f = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
    f.type = 'lowpass'; f.frequency.value = 2400; f.Q.value = 1.5;
    lfo.frequency.value = 5.5; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(7, t + 0.25);
    lfo.connect(lg);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
    g.gain.setValueAtTime(0.075, t + Math.max(0.03, dur - 0.05)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
    for (const [type, det] of [['sawtooth', 0], ['triangle', 7]]) {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = hz(m); o.detune.value = det;
      lg.connect(o.detune); o.connect(f); o.start(t); o.stop(t + dur + 0.2);
    }
    f.connect(g); g.connect(this.music); g.connect(this.delaySend);
    const r = ac.createGain(); r.gain.value = 0.5; g.connect(r).connect(this.reverbSend);
    lfo.start(t); lfo.stop(t + dur + 0.2);
  }

  // Muffle the music briefly (getting hit) or for a while (game over).
  muffle(freq = 500, hold = 0.1, recover = 0.7) {
    if (!this.running) return;
    const p = this.musicFilter.frequency, t = this.now;
    p.cancelScheduledValues(t); p.setValueAtTime(p.value, t);
    p.exponentialRampToValueAtTime(freq, t + 0.03);
    if (recover > 0) { p.setValueAtTime(freq, t + hold); p.exponentialRampToValueAtTime(20000, t + hold + recover); }
  }

  // ---------------------------------------------------------------- listener
  setListener(pos, fwd, up) {
    if (!this.running) return;
    const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z;
      L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z;
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  // ---------------------------------------------------------------- sfx building blocks
  // Output node for a one-shot: optionally spatialised at `pos`, optional reverb send.
  _out(pos, gain = 1, rev = 0) {
    const ac = this.ctx, g = ac.createGain();
    g.gain.value = gain;
    if (pos) {
      const p = ac.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.2; p.rolloffFactor = 0.8;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p).connect(this.sfx);
    } else g.connect(this.sfx);
    if (rev) { const r = ac.createGain(); r.gain.value = rev; g.connect(r).connect(this.reverbSend); }
    return g;
  }
  _osc(type, f0, f1, t, dur, peak, dest, attack = 0.003) {
    const ac = this.ctx, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.03);
    return o;
  }
  _noise(t, dur, peak, dest, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, attack = 0.002 } = {}) {
    const ac = this.ctx, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = this.smp.noise;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }
  _bell(f, t, dest, peak = 0.12, decay = 0.6, partials = [[1, 1, 1], [2.76, 0.5, 0.6], [5.4, 0.28, 0.35], [8.93, 0.14, 0.2]]) {
    for (const [k, a, d] of partials) if (f * k < 15000) this._osc('sine', f * k, f * k * 0.997, t, decay * d, peak * a, dest, 0.002);
  }

  // ---------------------------------------------------------------- continuous: sword whoosh
  _swingInit() {
    const ac = this.ctx;
    const s = ac.createBufferSource(); s.buffer = this.smp.noise; s.loop = true;
    this.swF = ac.createBiquadFilter(); this.swF.type = 'bandpass'; this.swF.Q.value = 1.3; this.swF.frequency.value = 600;
    this.swG = ac.createGain(); this.swG.gain.value = 0;
    this.swP = ac.createPanner(); this.swP.panningModel = 'equalpower'; this.swP.refDistance = 1;
    s.connect(this.swF).connect(this.swG).connect(this.swP).connect(this.sfx);
    s.start();
  }
  setSwing(speed, pos) {
    if (!this.running) return;
    const t = this.now, k = Math.min(1, Math.max(0, (speed - 1.6) / 9));
    this.swG.gain.setTargetAtTime(Math.pow(k, 1.5) * 0.55, t, 0.025);
    this.swF.frequency.setTargetAtTime(280 + speed * 150, t, 0.03);
    if (this.swP.positionX) { this.swP.positionX.value = pos.x; this.swP.positionY.value = pos.y; this.swP.positionZ.value = pos.z; }
  }

  // ---------------------------------------------------------------- sfx
  slash(pos, grade, note, el) {
    if (!this.running) return;
    const t = this.now, o = this._out(pos, 1, grade === 'perfect' ? 0.45 : 0.25);
    this._noise(t, 0.07, grade === 'off' ? 0.25 : 0.55, o, { f0: 3400, f1: 1100, q: 0.9 });
    if (grade === 'off') {
      this._osc('square', hz(note) * 1.06, hz(note) * 0.85, t, 0.13, 0.045, o);
      this._osc('sine', 140, 60, t, 0.1, 0.22, o);
      return;
    }
    this._osc('sine', 160, 46, t, 0.16, 0.6, o);
    this._bell(hz(note), t, o, grade === 'perfect' ? 0.16 : 0.11, 0.55);
    if (grade === 'perfect') this._osc('triangle', hz(note) * 4, hz(note) * 4, t + 0.012, 0.2, 0.05, o);
    this.element(el, pos, 0.55);
  }
  tap(pos) {
    if (!this.running) return;
    const t = this.now, o = this._out(pos, 0.6);
    this._bell(1900, t, o, 0.05, 0.12);
    this._noise(t, 0.03, 0.15, o, { f0: 4000, q: 1.5 });
  }
  element(el, pos, k = 1) {
    if (!this.running || !el) return;
    const t = this.now, o = this._out(pos, k, 0.2);
    if (el === 'fire') {
      this._play(this.smp.crackle, t, { gain: 0.8, dest: o });
      this._noise(t, 0.35, 0.22, o, { type: 'lowpass', f0: 2400, f1: 300, q: 0.5, attack: 0.01 });
    } else if (el === 'ice') {
      for (let i = 0; i < 4; i++) this._osc('sine', 2600 + Math.random() * 2400, 2400, t + i * 0.018, 0.22, 0.045, o);
      this._noise(t, 0.25, 0.08, o, { type: 'highpass', f0: 6000, q: 0.7 });
    } else {
      const z = this._osc('sawtooth', 90, 60, t, 0.18, 0.09, o);
      const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
      lfo.frequency.value = 37; lg.gain.value = 40; lfo.connect(lg).connect(z.frequency); lfo.start(t); lfo.stop(t + 0.2);
      this._noise(t, 0.12, 0.2, o, { type: 'highpass', f0: 3500, q: 0.7 });
    }
  }
  elementSwitch(el) {
    if (!this.running) return;
    const t = this.now, o = this._out(null, 0.7, 0.3);
    const base = { fire: 74, ice: 81, volt: 77 }[el] || 76;
    const type = { fire: 'triangle', ice: 'sine', volt: 'square' }[el] || 'sine';
    this._osc(type, hz(base), hz(base), t, 0.12, el === 'volt' ? 0.04 : 0.08, o);
    this._osc(type, hz(base + 7), hz(base + 7), t + 0.06, 0.18, el === 'volt' ? 0.035 : 0.07, o);
  }
  beam(pos, el) {
    if (!this.running) return;
    const t = this.now, o = this._out(pos, 1, 0.4);
    this._noise(t, 0.32, 0.5, o, { f0: 300, f1: 3200, q: 2.5, attack: 0.02 });
    this._osc('sawtooth', 220, 880, t, 0.22, 0.06, o, 0.01);
    this._osc('sine', 200, 55, t, 0.3, 0.45, o);
    this.element(el, pos, 0.8);
  }
  // Blade ignition, then a low filtered hum for as long as the beam stays charged.
  charge(el) {
    if (!this.running) return null;
    const ac = this.ctx, t = this.now, o = this._out(null, 0.8, 0.3);
    const base = { fire: 50, ice: 57, volt: 53 }[el] || 52;
    this._noise(t, 0.28, 0.16, o, { f0: 1200, f1: 7000, q: 4, attack: 0.012 });
    this._osc('triangle', hz(base + 24), hz(base + 31), t, 0.22, 0.05, o, 0.006);
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
    const lfo = ac.createOscillator(), lg = ac.createGain();
    o1.type = 'sawtooth'; o1.frequency.value = hz(base); o2.type = 'sawtooth'; o2.frequency.value = hz(base) * 1.006;
    lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 3;
    lfo.frequency.value = 5.5; lg.gain.value = 140; lfo.connect(lg).connect(lp.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 0.12);
    o1.connect(lp); o2.connect(lp); lp.connect(g).connect(this._out(null, 1));
    [o1, o2, lfo].forEach((x) => x.start(t));
    return {
      stop: () => {
        const n = this.now;
        g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.exponentialRampToValueAtTime(0.0001, n + 0.1);
        [o1, o2, lfo].forEach((x) => x.stop(n + 0.12));
      },
    };
  }
  dud(pos) {
    if (!this.running) return;
    const t = this.now, o = this._out(pos, 0.6);
    this._noise(t, 0.18, 0.12, o, { type: 'lowpass', f0: 900, f1: 200, q: 0.6 });
    this._osc('sine', 300, 160, t, 0.12, 0.05, o);
  }
  denied() {
    if (!this.running) return;
    const t = this.now, o = this._out(null, 0.6);
    this._osc('square', 140, 120, t, 0.09, 0.05, o);
    this._osc('square', 140, 110, t + 0.1, 0.1, 0.05, o);
  }
  push(pos, strong) {
    if (!this.running) return;
    const t = this.now, o = this._out(pos, 1, 0.35);
    this._osc('sine', 110, 34, t, 0.35, strong ? 0.75 : 0.45, o);
    this._noise(t, 0.4, strong ? 0.55 : 0.35, o, { type: 'lowpass', f0: 3000, f1: 180, q: 0.8, attack: 0.005 });
  }
  pull(pos) {
    if (!this.running) return;
    const t = this.now, o = this._out(pos, 1, 0.3);
    this._noise(t, 0.28, 0.4, o, { f0: 220, f1: 2000, q: 3, attack: 0.22 });
    this._osc('sine', 110, 330, t, 0.3, 0.2, o, 0.2);
  }
  holdStart() {
    if (!this.running) return null;
    const ac = this.ctx, t = this.now;
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), trem = ac.createOscillator(), tg = ac.createGain();
    o1.type = 'sine'; o1.frequency.value = 73; o2.type = 'triangle'; o2.frequency.value = 146.5;
    trem.frequency.value = 7; tg.gain.value = 0.04; trem.connect(tg).connect(g.gain);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.15);
    const out = this._out(null, 1);
    o1.connect(g); o2.connect(g); g.connect(out);
    [o1, o2, trem].forEach((o) => o.start(t));
    return {
      stop: () => {
        const n = this.now;
        g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.exponentialRampToValueAtTime(0.0001, n + 0.12);
        [o1, o2, trem].forEach((o) => o.stop(n + 0.15));
      },
    };
  }
  throwWhoosh(pos) {
    if (!this.running) return;
    const t = this.now, o = this._out(pos, 1);
    this._noise(t, 0.35, 0.45, o, { f0: 1800, f1: 400, q: 1.5, attack: 0.02 });
  }
  impact(pos, heavy = 1) {
    if (!this.running) return;
    const t = this.now, o = this._out(pos, 1, 0.3);
    this._osc('sine', 120, 38, t, 0.3, 0.7 * heavy, o);
    this._noise(t, 0.22, 0.5 * heavy, o, { type: 'lowpass', f0: 1600, f1: 250, q: 0.7 });
    this._noise(t, 0.06, 0.3 * heavy, o, { type: 'highpass', f0: 2500, q: 0.7 });
  }
  parry(pos, strong) {
    if (!this.running) return;
    const t = this.now, o = this._out(pos, 1.1, 0.6);
    this._bell(strong ? 523 : 392, t, o, 0.22, 1.4, [[1, 1, 1], [2.32, 0.7, 0.8], [4.25, 0.45, 0.5], [6.63, 0.3, 0.35], [9.38, 0.2, 0.2]]);
    this._noise(t, 0.08, 0.6, o, { f0: 5000, q: 0.7 });
    this._osc('sine', 180, 60, t, 0.2, 0.5, o);
  }
  telegraph(pos, t0, t1) {
    if (!this.running) return;
    const ac = this.ctx, o = this._out(pos, 1);
    const s = Math.max(this.now, t0), e = Math.max(s + 0.1, t1);
    const osc = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(110, s); osc.frequency.exponentialRampToValueAtTime(260, e);
    f.type = 'bandpass'; f.Q.value = 7; f.frequency.setValueAtTime(400, s); f.frequency.exponentialRampToValueAtTime(1800, e);
    g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.16, e - 0.03); g.gain.exponentialRampToValueAtTime(0.0001, e + 0.02);
    osc.connect(f).connect(g).connect(o); osc.start(s); osc.stop(e + 0.05);
    this._noise(Math.max(this.now, e - 0.09), 0.16, 0.4, o, { f0: 5000, f1: 700, q: 1.2, attack: 0.05 });
  }
  playerHit() {
    if (!this.running) return;
    const t = this.now, o = this._out(null, 1);
    this._osc('sine', 90, 30, t, 0.45, 0.9, o);
    this._noise(t, 0.3, 0.6, o, { type: 'lowpass', f0: 900, f1: 120, q: 0.9 });
    this._osc('square', 70, 45, t, 0.2, 0.08, o);
    this.muffle(420, 0.12, 0.8);
  }
  orbCharge(pos, t0, t1) {
    if (!this.running) return;
    const o = this._out(pos, 0.9), s = Math.max(this.now, t0), e = Math.max(s + 0.1, t1);
    this._osc('sine', 300, 900, s, e - s, 0.08, o, (e - s) * 0.9);
    this._osc('triangle', 600, 1800, s, e - s, 0.03, o, (e - s) * 0.9);
  }
  orbFire(pos) {
    if (!this.running) return;
    const t = this.now, o = this._out(pos, 1, 0.3);
    this._osc('sine', 900, 300, t, 0.25, 0.18, o);
    this._noise(t, 0.2, 0.25, o, { f0: 2500, f1: 600, q: 2 });
  }
  deflect(pos, grade) {
    if (!this.running) return;
    const t = this.now, o = this._out(pos, 1, 0.45), f = grade === 'perfect' ? 1568 : 1175;
    this._bell(f, t, o, 0.14, 0.7);
    this._noise(t, 0.05, 0.4, o, { f0: 6000, q: 0.8 });
  }
  enemyDie(pos, note) {
    if (!this.running) return;
    const t = this.now, o = this._out(pos, 1.1, 0.5);
    for (let i = 0; i < 9; i++) this._osc('sine', 1800 + Math.random() * 3200, 1500, t + Math.random() * 0.14, 0.14 + Math.random() * 0.12, 0.05, o);
    this._noise(t, 0.25, 0.5, o, { type: 'highpass', f0: 2500, q: 0.6 });
    this._osc('sine', 130, 35, t, 0.5, 0.7, o);
    const ch = this.chordAt(this.t).pad;
    for (const m of ch) this._osc('sawtooth', hz(m + 12), hz(m + 12), t, 0.5, 0.03, this._out(null, 1, 0.4));
    if (note) this._bell(hz(note + 12), t + 0.04, o, 0.08, 0.8);
  }
  spawn(pos, t0, t1) {
    if (!this.running) return;
    const o = this._out(pos, 0.9, 0.5), s = Math.max(this.now, t0), e = Math.max(s + 0.2, t1);
    this._noise(s, e - s + 0.05, 0.25, o, { f0: 300, f1: 4200, q: 2.2, attack: (e - s) * 0.85 });
    this._osc('sine', 80, 50, e, 0.4, 0.5, o);
    this._bell(hz(74), e, o, 0.05, 0.9);
  }
  reaction(kind, pos) {
    if (!this.running) return;
    const t = this.now, o = this._out(pos, 1.2, 0.6);
    if (kind === 'SHATTER') {
      for (let i = 0; i < 14; i++) this._osc('sine', 2200 + Math.random() * 5000, 1800, t + Math.random() * 0.2, 0.2 + Math.random() * 0.2, 0.05, o);
      this._noise(t, 0.4, 0.6, o, { type: 'highpass', f0: 3000, q: 0.5 });
      this._osc('sine', 150, 40, t, 0.4, 0.6, o);
    } else if (kind === 'OVERLOAD') {
      this._noise(t, 0.8, 0.9, o, { type: 'lowpass', f0: 2500, f1: 120, q: 0.6, attack: 0.005 });
      this._osc('sine', 120, 26, t, 0.7, 0.95, o);
      this._play(this.smp.crackle, t + 0.05, { gain: 0.9, dest: o });
    } else {
      for (let i = 0; i < 6; i++) {
        const z = this._osc('sawtooth', 70 + i * 13, 50, t + i * 0.05, 0.12, 0.08, o);
        z.detune.value = Math.random() * 300;
        this._noise(t + i * 0.05, 0.06, 0.25, o, { type: 'highpass', f0: 4000, q: 0.6 });
      }
      this._bell(hz(86), t, o, 0.05, 0.6);
    }
  }
  ringOut(pos) {
    if (!this.running) return;
    const t = this.now, o = this._out(pos, 1, 0.5);
    this._osc('sine', 900, 120, t, 1.1, 0.12, o);
    this._noise(t, 1.0, 0.2, o, { f0: 2000, f1: 200, q: 1.5 });
  }
  uiStart() {
    if (!this.running) return;
    const t = this.now, o = this._out(null, 1, 0.6);
    [62, 69, 74, 81].forEach((m, i) => this._bell(hz(m), t + i * 0.07, o, 0.09, 1.2));
    this._play(this.smp.crash, t, { gain: 0.35, dest: o });
  }
  waveClear() {
    if (!this.running) return;
    const t = this.now, o = this._out(null, 1, 0.6);
    [62, 66, 69, 74, 78].forEach((m, i) => this._bell(hz(m + 12), t + i * BEAT / 4, o, 0.07, 1));
  }
  gameOver() {
    if (!this.running) return;
    const t = this.now, o = this._out(null, 1, 0.7);
    [74, 70, 65, 62].forEach((m, i) => this._osc('triangle', hz(m), hz(m) * 0.98, t + i * 0.18, 0.9, 0.09, o, 0.01));
    this.muffle(350, 0, 0);
  }
  unmuffle() {
    if (!this.running) return;
    const p = this.musicFilter.frequency, t = this.now;
    p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.exponentialRampToValueAtTime(20000, t + 1.2);
  }
  tick(strong) { // tiny UI click
    if (!this.running) return;
    const o = this._out(null, 0.5);
    this._osc('sine', strong ? 1400 : 1000, strong ? 1400 : 1000, this.now, 0.04, 0.05, o);
  }
}
