// The arena: a floating moonlit temple platform whose stone hums with the beat.
import * as THREE from 'three';
import { ARENA_R } from './config.js';

const V = THREE.Vector3;
const MOON_DIR = new V(-0.42, 0.36, -0.83).normalize();
const HORIZON = new THREE.Color(0x141b36);

const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith, uHorizon, uGlow, uMoonDir, uMoon;
  uniform float uPulse, uTier;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.42));
    col = mix(col, uHorizon * 0.35, smoothstep(0.0, -0.25, h));
    col += uGlow * exp(-abs(h) * 8.0) * (0.5 + 0.18 * uPulse + 0.12 * uTier);
    float m = max(dot(d, uMoonDir), 0.0);
    col += uMoon * (pow(m, 700.0) * 0.5 + pow(m, 40.0) * 0.07 + pow(m, 6.0) * 0.03);
    float disc = smoothstep(0.99858, 0.99872, m);
    vec3 q = (d - uMoonDir) * 40.0;
    float mare = 0.86 - 0.16 * smoothstep(0.2, 0.9, sin(q.x * 3.1 + 0.4) * sin(q.y * 2.3 - 0.8) + 0.5 * sin(q.z * 4.7 + q.x * 2.0));
    col = mix(col, uMoon * mare, disc);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = (modelMatrix * vec4(position, 0.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

function skyUniforms() {
  return {
    uZenith: { value: new THREE.Color(0x02030a) },
    uHorizon: { value: HORIZON.clone() },
    uGlow: { value: new THREE.Color(0x26356a) },
    uMoonDir: { value: MOON_DIR.clone() },
    uMoon: { value: new THREE.Color(0xfff0d8) },
    uPulse: { value: 0 },
    uTier: { value: 0 },
  };
}

const FLOOR_VERT = /* glsl */ `
  varying vec3 vPos;
  void main() { vPos = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0); }`;
const FLOOR_FRAG = /* glsl */ `
  uniform float uPhase, uPulse, uDown, uTier, uTime;
  uniform vec3 uPlayer, uLine, uAccent;
  varying vec3 vPos;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float aline(float d, float w) { float fw = fwidth(d) * 1.2; return 1.0 - smoothstep(w - fw, w + fw, abs(d)); }
  void main() {
    vec2 p = vPos.xz;
    float r = length(p);
    float a = atan(p.y, p.x);
    // flagstones laid in rings
    float RW = 1.15;
    float ring = floor(r / RW);
    float segs = max(6.0, floor(6.2831853 * (ring + 0.5) * RW / 1.25));
    float sa = (a / 6.2831853 + 0.5) * segs + hash(vec2(ring, 7.0)) * 3.0;
    vec2 cell = vec2(ring, floor(sa));
    float tone = hash(cell);
    float grain = noise(p * 4.0) * 0.6 + noise(p * 17.0) * 0.4;
    vec3 stone = mix(vec3(0.030, 0.034, 0.048), vec3(0.068, 0.072, 0.092), tone) * (0.75 + 0.5 * grain);
    float dr = (fract(r / RW + 0.5) - 0.5) * RW;
    float da = (fract(sa + 0.5) - 0.5) * 6.2831853 * max(r, 0.3) / segs;
    float groove = min(abs(dr), abs(da));
    stone *= mix(0.25, 1.0, smoothstep(0.008, 0.028, groove));
    // inlaid rune circles
    float inlay = aline(r - 2.3, 0.01) + aline(r - 4.6, 0.01) + aline(r - ${ARENA_R.toFixed(1)} + 0.12, 0.018);
    // rune band
    float cellA = (a / 6.2831853 + 0.5) * 120.0;
    float glyph1 = step(0.38, hash(vec2(floor(cellA), 1.0))) * step(fract(cellA), 0.72);
    float glyph2 = step(0.5, hash(vec2(floor(cellA * 0.5 + 0.25), 2.0))) * step(fract(cellA * 0.5 + 0.25), 0.8);
    float runes = aline(r - 6.3, 0.022) * glyph1 + aline(r - 6.5, 0.018) * glyph2;
    // beat ripple from the player
    float rr = length(p - uPlayer.xz);
    float wave = uPhase * 8.5;
    float ripple = aline(rr - wave, 0.03 + 0.12 * uPhase) * pow(1.0 - uPhase, 1.6) * (0.55 + 0.45 * uDown);
    float pulse = uPulse;
    vec3 col = stone;
    col += inlay * uLine * (0.35 + 1.1 * pulse);
    col += runes * uAccent * (0.25 + 0.9 * pulse + 0.25 * uTier);
    col += ripple * uAccent * 0.55;
    // soft moon sheen and a warm pool of light around the player
    col += vec3(0.020, 0.026, 0.045) * smoothstep(8.0, 0.0, r);
    col += uAccent * 0.025 * smoothstep(2.5, 0.0, rr);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function buildWorld(scene, renderer) {
  scene.background = HORIZON.clone().multiplyScalar(0.4);
  scene.fog = new THREE.Fog(HORIZON.getHex(), 26, 170);

  // --- sky dome + stars (follow the camera)
  const sky = new THREE.Group();
  const skyMat = new THREE.ShaderMaterial({ uniforms: skyUniforms(), vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(300, 40, 20), skyMat);
  dome.renderOrder = -10;
  sky.add(dome);
  {
    const n = 1600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random(), v = Math.random() * 0.98 + 0.02;
      const th = u * Math.PI * 2, y = Math.pow(v, 0.7);
      const rr = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * rr * 280, y * 280, Math.sin(th) * rr * 280], i * 3);
      const b = 0.45 + Math.random() * 0.55, warm = Math.random();
      col.set([b * (0.85 + warm * 0.15), b * 0.9, b * (1.0 - warm * 0.15)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false, transparent: true, opacity: 0.9 }));
    stars.renderOrder = -9;
    sky.add(stars);
  }
  scene.add(sky);

  // --- distant mountain ridges
  function ridge(radius, n, hMin, hMax, color) {
    const ph = [Math.random() * 9, Math.random() * 9, Math.random() * 9, Math.random() * 9];
    const pos = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      let h = 0.5 + 0.3 * Math.sin(a * 3 + ph[0]) + 0.2 * Math.sin(a * 7 + ph[1]) + 0.12 * Math.sin(a * 17 + ph[2]) + 0.06 * Math.sin(a * 41 + ph[3]);
      h = hMin + (hMax - hMin) * Math.max(0, h);
      pos.push(Math.cos(a) * radius, -30, Math.sin(a) * radius, Math.cos(a) * radius, h, Math.sin(a) * radius);
      if (i < n) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    scene.add(m);
  }
  ridge(120, 220, 4, 30, 0x0c1226);
  ridge(82, 180, 1, 14, 0x070a17);

  // --- the platform
  const floorMat = new THREE.ShaderMaterial({
    uniforms: {
      uPhase: { value: 0 }, uPulse: { value: 0 }, uDown: { value: 0 }, uTier: { value: 0 }, uTime: { value: 0 },
      uPlayer: { value: new V() },
      uLine: { value: new THREE.Color(0x9fb6ff) },
      uAccent: { value: new THREE.Color(0xffd27a) },
    },
    vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG, fog: false,
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R, 128), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x1b1f2c, roughness: 0.92, metalness: 0.05, flatShading: true });
  const cliff = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_R, ARENA_R * 0.55, 3.2, 40, 3, true), stoneMat);
  {
    const p = cliff.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < 1.5) { const k = 1 + (Math.random() - 0.5) * 0.12; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); p.setY(i, y + (Math.random() - 0.5) * 0.3); }
    }
    cliff.geometry.computeVertexNormals();
  }
  cliff.position.y = -1.62;
  scene.add(cliff);
  const keel = new THREE.Mesh(new THREE.ConeGeometry(ARENA_R * 0.55, 6, 14, 2), stoneMat);
  keel.rotation.x = Math.PI; keel.position.y = -6.2;
  scene.add(keel);

  const rimMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(ARENA_R, 0.035, 6, 160), rimMat);
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.01;
  scene.add(rim);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(ARENA_R + 0.06, 0.09, 6, 120), stoneMat);
  lip.rotation.x = Math.PI / 2; lip.position.y = -0.03;
  scene.add(lip);

  // --- monoliths, with rune strips that light up with the music
  const N_P = 10, PR = 10.5;
  const pillarGeo = new THREE.BoxGeometry(0.9, 7, 0.55, 1, 3, 1);
  {
    const p = pillarGeo.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 1 - ((p.getY(i) + 3.5) / 7) * 0.32; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    pillarGeo.computeVertexNormals();
  }
  const pillars = new THREE.InstancedMesh(pillarGeo, stoneMat, N_P);
  const strips = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.1, 5.2), new THREE.MeshBasicMaterial({ toneMapped: false }), N_P);
  const pillarInfo = [];
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new V(1, 1, 1);
    for (let i = 0; i < N_P; i++) {
      const a = (i / N_P) * Math.PI * 2 + Math.PI / N_P;
      const x = Math.cos(a) * PR, z = Math.sin(a) * PR, y = 1.2 + (i % 3) * 0.6;
      const yaw = Math.atan2(-x, -z), tilt = (Math.random() - 0.5) * 0.08;
      e.set(tilt, yaw, (Math.random() - 0.5) * 0.06); q.setFromEuler(e);
      pillarInfo.push({ x, y, z, q: q.clone(), bob: Math.random() * 6 });
      m.compose(new V(x, y, z), q, s); pillars.setMatrixAt(i, m);
      const off = new V(0, 0, 0.29).applyQuaternion(q);
      m.compose(new V(x + off.x, y, z + off.z), q, s); strips.setMatrixAt(i, m);
      strips.setColorAt(i, new THREE.Color(0x222233));
    }
  }
  scene.add(pillars, strips);

  // --- floating debris for parallax
  const debris = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), stoneMat, 46);
  const debrisInfo = [];
  for (let i = 0; i < debris.count; i++) {
    const a = Math.random() * Math.PI * 2, r = 13 + Math.random() * 26;
    debrisInfo.push({
      p: new V(Math.cos(a) * r, -9 + Math.random() * 22, Math.sin(a) * r),
      s: 0.25 + Math.random() * Math.random() * 1.8,
      rot: new V(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      spin: new V((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 0),
      bob: Math.random() * 6,
    });
  }
  scene.add(debris);

  // --- lights
  scene.add(new THREE.HemisphereLight(0x6b7cb8, 0x0a0a14, 0.9));
  const moon = new THREE.DirectionalLight(0xbfd0ff, 1.7);
  moon.position.copy(MOON_DIR).multiplyScalar(20);
  scene.add(moon);
  const warm = new THREE.DirectionalLight(0xff9a55, 0.65);
  warm.position.set(6, 3, 8);
  scene.add(warm);

  // --- environment map for metals (rendered once)
  {
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({ uniforms: skyUniforms(), vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide })));
    const panel = (color, k, pos, w = 7, h = 2.5) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.copy(pos); m.lookAt(0, 0, 0); envScene.add(m);
    };
    panel(0x9db4ff, 2.2, new V(0, 8, 0), 9, 9);
    panel(0xff9a55, 1.4, new V(6, 2, 7));
    panel(0x6a80ff, 1.0, new V(-7, 1, -5));
    panel(0xffd27a, 0.5, new V(0, -6, 0), 12, 12);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(envScene, 0.035).texture;
    pm.dispose();
  }

  const lineCold = new THREE.Color(0x8ea6ff), lineHot = new THREE.Color(0xffc56a);
  const accentCold = new THREE.Color(0xc8d4ff), accentHot = new THREE.Color(0xffd27a);
  const tmpC = new THREE.Color(), dm = new THREE.Matrix4(), dq = new THREE.Quaternion(), de = new THREE.Euler();

  return {
    // beat: { phase 0..1 since last beat, pulse decaying 1→0, down 1 on bar starts, step 0..15 }
    update(dt, t, beat, tier, playerPos, cameraPos) {
      sky.position.copy(cameraPos);
      const k = tier / 4;
      skyMat.uniforms.uPulse.value = beat.pulse;
      skyMat.uniforms.uTier.value = k;
      const fu = floorMat.uniforms;
      fu.uPhase.value = beat.phase; fu.uPulse.value = beat.pulse; fu.uDown.value = beat.down; fu.uTier.value = k; fu.uTime.value = t;
      fu.uPlayer.value.copy(playerPos);
      fu.uLine.value.copy(lineCold).lerp(lineHot, Math.min(1, k * 1.2));
      fu.uAccent.value.copy(accentCold).lerp(accentHot, Math.min(1, 0.35 + k));
      rimMat.color.setRGB(1, 0.82, 0.48).multiplyScalar(0.55 + beat.pulse * 0.9 + k * 0.4);
      // pillar strips: a light chases around the ring on sixteenths; tier raises the floor
      for (let i = 0; i < N_P; i++) {
        const chase = Math.max(0, 1 - (((beat.step16 - i * 1.6) % 16 + 16) % 16) / 3);
        const lvl = 0.12 + k * 0.5 + beat.pulse * 0.4 * (0.5 + k) + chase * (0.25 + k * 0.7);
        tmpC.copy(accentCold).lerp(accentHot, Math.min(1, k * 1.3)).multiplyScalar(lvl);
        strips.setColorAt(i, tmpC);
      }
      strips.instanceColor.needsUpdate = true;
      for (let i = 0; i < debris.count; i++) {
        const d = debrisInfo[i];
        d.rot.x += d.spin.x * dt; d.rot.y += d.spin.y * dt;
        de.set(d.rot.x, d.rot.y, d.rot.z); dq.setFromEuler(de);
        const y = d.p.y + Math.sin(t * 0.4 + d.bob) * 0.4;
        dm.compose(tmpV.set(d.p.x, y, d.p.z), dq, tmpS.setScalar(d.s));
        debris.setMatrixAt(i, dm);
      }
      debris.instanceMatrix.needsUpdate = true;
    },
  };
}
const tmpV = new V(), tmpS = new V();
