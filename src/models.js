// Procedural models. Everything is built from primitives so materials can be
// driven by game state (blade = cadence meter, visors = enemy intent, etc.).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, GRIP_PITCH } from './config.js';
import { glowTexture } from './fx.js';

const V = THREE.Vector3, V2 = THREE.Vector2;

export function merge(geos) {
  const g = mergeGeometries(geos.map((x) => {
    const n = x.index ? x.toNonIndexed() : x;
    n.clearGroups();
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    return n;
  }));
  g.computeBoundingSphere();
  return g;
}
const lathe = (pts, segs) => new THREE.LatheGeometry(pts.map(([x, y]) => new V2(x, y)), segs);

// Fresnel rim light on standard materials — keeps dark armour readable at night.
export function rimify(mat, color = 0xffffff, power = 2.6, strength = 0.7) {
  mat.userData.rim = { value: new THREE.Color(color) };
  mat.userData.rimK = { value: new V2(power, strength) };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = mat.userData.rim;
    sh.uniforms.uRimK = mat.userData.rimK;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform vec2 uRimK;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float f = 1.0 - abs(dot(normalize(vViewPosition), normal)); totalEmissiveRadiance += uRim * pow(f, uRimK.x) * uRimK.y; }`);
  };
  mat.customProgramCacheKey = () => 'rim';
  return mat;
}

const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: opacity < 1, opacity });
// Additive halo that shares the colour object of an emissive material.
function haloSprite(mat, size, pos) {
  const sm = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  sm.color = mat.color; // follows the enemy's state colour
  const s = new THREE.Sprite(sm);
  s.scale.setScalar(size); s.position.copy(pos);
  return s;
}

// ===================================================================== sword
// Built in a "blade space" (+Y along the blade, +X across the edges, +Z out of
// the flat), then oriented into WebXR grip space: blade along -Z, edges along
// ±Y (the knuckle line), flats facing ±X (the palm).
const RUNE_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`;
const RUNE_FRAG = `
  uniform float uFill, uPulse, uFlash; uniform vec3 uColor, uFlashColor;
  varying vec2 vUv;
  void main(){
    float y = vUv.y * 5.0;
    float seg = floor(y), f = fract(y);
    float gap = smoothstep(0.0, 0.06, f) * smoothstep(1.0, 0.94, f);
    float fill = clamp(uFill * 5.0 - seg, 0.0, 1.0);
    float lit = fill >= 1.0 ? 1.0 : fill * 0.35;
    float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
    vec3 c = uColor * (0.08 + lit * (1.4 + uPulse * 1.2)) * gap * (0.55 + 0.45 * edge);
    c = mix(c, uFlashColor * 2.0, uFlash * gap);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

export function buildSword() {
  const root = new THREE.Group();          // lives in grip space
  const model = new THREE.Group();         // blade space
  const basis = new THREE.Matrix4().makeBasis(new V(0, 1, 0), new V(0, 0, -1), new V(-1, 0, 0));
  root.quaternion.setFromRotationMatrix(basis);
  root.rotateOnWorldAxis(new V(1, 0, 0), GRIP_PITCH);
  root.add(model);
  model.position.y = 0.095; // grip centre sits at the fist's origin

  const steel = new THREE.MeshStandardMaterial({ color: 0xdfe4ee, metalness: 1, roughness: 0.16, emissive: 0x000000 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262f, metalness: 0.85, roughness: 0.32 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc89b55, metalness: 1, roughness: 0.28 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x2a1812, roughness: 0.82, metalness: 0.05 });
  const gemMat = glow(0xff8a2a);

  // blade
  const L = 0.8;
  const shape = new THREE.Shape();
  shape.moveTo(-0.019, 0);
  shape.lineTo(-0.0175, 0.55);
  shape.quadraticCurveTo(-0.016, 0.72, 0, L);
  shape.quadraticCurveTo(0.016, 0.72, 0.0175, 0.55);
  shape.lineTo(0.019, 0);
  shape.lineTo(-0.019, 0);
  const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.0036, bevelSize: 0.0085, bevelSegments: 1, curveSegments: 10 });
  bladeGeo.translate(0, 0, -0.0015);
  const blade = new THREE.Mesh(bladeGeo, steel);
  blade.position.y = 0.012;
  model.add(blade);

  // rune channel = cadence meter (both flats)
  const runeMat = new THREE.ShaderMaterial({
    uniforms: { uFill: { value: 0.4 }, uPulse: { value: 0 }, uFlash: { value: 0 }, uColor: { value: new THREE.Color(0xff8a2a) }, uFlashColor: { value: new THREE.Color(0xff3344) } },
    vertexShader: RUNE_VERT, fragmentShader: RUNE_FRAG, toneMapped: false,
  });
  const runeGeo = new THREE.PlaneGeometry(0.0075, 0.6);
  for (const s of [1, -1]) {
    const r = new THREE.Mesh(runeGeo, runeMat);
    r.position.set(0, 0.05 + 0.3, s * 0.0056);
    if (s < 0) r.rotation.y = Math.PI;
    model.add(r);
  }

  // cross-guard: swept quillons that curve toward the blade
  const gs = new THREE.Shape(), N = 10, GW = 0.105;
  const top = (u) => 0.016 + 0.018 * Math.pow(Math.abs(u) / GW, 2.2);
  const bot = (u) => -0.013 + 0.024 * Math.pow(Math.abs(u) / GW, 2.0);
  gs.moveTo(-GW, bot(-GW));
  for (let i = 0; i <= N; i++) { const u = -GW + (2 * GW * i) / N; gs.lineTo(u, bot(u)); }
  for (let i = N; i >= 0; i--) { const u = -GW + (2 * GW * i) / N; gs.lineTo(u, top(u)); }
  const guardGeo = new THREE.ExtrudeGeometry(gs, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 1 });
  guardGeo.translate(0, 0, -0.009);
  model.add(new THREE.Mesh(guardGeo, brass));
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.011, 0), gemMat);
  for (const s of [1, -1]) { const g = gem.clone(); g.position.set(0, 0.002, s * 0.015); g.scale.set(1, 1.4, 0.5); model.add(g); }

  // grip with a leather wrap
  const gripPts = [[0.0, -0.19]]; // lathe profiles run bottom→top so faces point outward
  for (let i = 0; i <= 24; i++) {
    const y = -0.19 + 0.19 * (i / 24);
    gripPts.push([0.0148 + 0.0016 * Math.abs(Math.sin((y / 0.0125) * Math.PI)), y]);
  }
  gripPts.push([0.0, 0]);
  model.add(new THREE.Mesh(lathe(gripPts, 10), leather));
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.017, 0.016, 10), dark);
  ferrule.position.y = -0.008;
  model.add(ferrule);

  // pommel
  const pommel = new THREE.Mesh(new THREE.IcosahedronGeometry(0.026, 0), brass);
  pommel.position.y = -0.212; pommel.scale.set(1, 1.15, 0.8);
  model.add(pommel);
  const pgem = new THREE.Mesh(new THREE.OctahedronGeometry(0.009, 0), gemMat);
  pgem.position.y = -0.24;
  model.add(pgem);

  // collision / fx markers along the blade
  const mk = (y) => { const o = new THREE.Object3D(); o.position.y = y; model.add(o); return o; };
  const base = mk(0.04), mid = mk(0.36), tip = mk(L + 0.012);
  return { root, steel, runeMat, gemMat, base, mid, tip };
}

// ===================================================================== gauntlet
// Grip space: fist around the Z axis, back of hand toward +X (right) / -X (left),
// forearm toward +Y, knuckles toward -Y.
export function buildGauntlet(hand) {
  const s = hand === 'left' ? -1 : 1;
  const g = new THREE.Group();
  const plate = rimify(new THREE.MeshStandardMaterial({ color: 0x2b303d, metalness: 0.85, roughness: 0.34 }), 0x8899cc, 3, 0.35);
  const trim = new THREE.MeshStandardMaterial({ color: 0xc89b55, metalness: 1, roughness: 0.3 });

  const parts = [];
  // curled fingers: partial tori wrapping the grip axis
  const zs = [-0.034, -0.012, 0.01, 0.031], tubes = [0.0118, 0.0122, 0.0116, 0.0102];
  zs.forEach((z, i) => {
    const t = new THREE.TorusGeometry(0.0255, tubes[i], 5, 10, Math.PI * 1.25);
    t.rotateZ(s > 0 ? -Math.PI * 1.08 : Math.PI * 0.83);
    t.translate(0, 0, z);
    parts.push(t);
  });
  // back of hand
  const back = new THREE.BoxGeometry(0.026, 0.08, 0.09);
  back.translate(s * 0.034, 0.025, 0);
  parts.push(back);
  // thumb over the top of the grip
  const thumb = new THREE.CapsuleGeometry(0.011, 0.045, 3, 6);
  thumb.rotateX(Math.PI / 2.3);
  thumb.translate(-s * 0.002, -0.006, -0.054);
  parts.push(thumb);
  g.add(new THREE.Mesh(merge(parts), plate));

  // Forearm: on a real Quest grip pose the arm runs ~45° between grip +Y and +Z
  // (back along the pointing ray), not straight up +Y.
  const forearm = new THREE.Group();
  forearm.rotation.x = Math.PI / 4;
  forearm.position.set(s * 0.012, 0.03, 0.01);
  g.add(forearm);
  const bracer = new THREE.CylinderGeometry(0.036, 0.042, 0.13, 8);
  bracer.translate(0, 0.11, 0);
  forearm.add(new THREE.Mesh(bracer, plate));
  const ring = new THREE.TorusGeometry(0.039, 0.005, 4, 16);
  ring.rotateX(Math.PI / 2);
  const r1 = ring.clone().translate(0, 0.05, 0), r2 = ring.clone().scale(1.1, 1, 1.1).translate(0, 0.17, 0);
  forearm.add(new THREE.Mesh(merge([r1, r2]), trim));

  // a gem on the back of the hand (force focus on the off-hand)
  const gemMat = glow(COLORS.force);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.014, 0), gemMat);
  gem.position.set(s * 0.05, 0.025, 0);
  gem.scale.set(0.6, 1.3, 1);
  g.add(gem);
  return { group: g, gemMat, forearm };
}

// ===================================================================== enemies
const GEO = {};
function gruntGeo() {
  if (GEO.grunt) return GEO.grunt;
  const torso = lathe([[0, -0.56], [0.07, -0.46], [0.15, -0.28], [0.25, -0.08], [0.33, 0.14], [0.3, 0.3], [0.17, 0.4], [0.0, 0.42]], 8);
  torso.scale(1, 1, 0.74);
  const pd = new THREE.SphereGeometry(0.16, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const collar = new THREE.TorusGeometry(0.16, 0.04, 5, 10);
  collar.rotateX(Math.PI / 2).translate(0, 0.4, 0);
  const belt = new THREE.TorusGeometry(0.2, 0.025, 4, 10);
  belt.rotateX(Math.PI / 2).scale(1, 1, 0.74).translate(0, -0.18, 0);
  const body = merge([torso, pd.clone().rotateZ(0.5).translate(-0.34, 0.27, 0), pd.clone().rotateZ(-0.5).translate(0.34, 0.27, 0), collar, belt]);

  const helm = lathe([[0, -0.12], [0.12, -0.1], [0.145, 0.02], [0.12, 0.11], [0.05, 0.17], [0, 0.18]], 6);
  const crest = new THREE.BoxGeometry(0.024, 0.07, 0.24); crest.translate(0, 0.17, -0.03);
  const jaw = new THREE.BoxGeometry(0.17, 0.05, 0.12); jaw.translate(0, -0.1, 0.06);
  const head = merge([helm, crest, jaw]);
  const visor = new THREE.BoxGeometry(0.2, 0.026, 0.03); visor.translate(0, 0.005, 0.125);

  const upper = new THREE.CylinderGeometry(0.055, 0.045, 0.3, 6); upper.translate(0, -0.15, 0);
  const elbow = new THREE.SphereGeometry(0.06, 6, 4); elbow.translate(0, -0.31, 0);
  const fore = new THREE.CylinderGeometry(0.048, 0.068, 0.24, 6); fore.translate(0, -0.44, 0);
  const arm = merge([upper, elbow, fore]);
  const bladeG = new THREE.OctahedronGeometry(1, 0); bladeG.scale(0.012, 0.36, 0.075); bladeG.translate(0, -0.88, 0.02);

  const core = new THREE.IcosahedronGeometry(0.075, 0); core.translate(0, 0.08, 0.2);
  const hover = new THREE.TorusGeometry(0.2, 0.016, 5, 20); hover.rotateX(Math.PI / 2);
  const thrust = new THREE.ConeGeometry(0.2, 0.55, 14, 1, true); thrust.translate(0, -0.275, 0);

  const ice = [];
  for (let i = 0; i < 9; i++) {
    const c = new THREE.OctahedronGeometry(1, 0);
    c.scale(0.06, 0.2 + Math.random() * 0.18, 0.06);
    c.rotateZ((Math.random() - 0.5) * 1.6); c.rotateX((Math.random() - 0.5) * 1.6);
    const a = (i / 9) * Math.PI * 2;
    c.translate(Math.cos(a) * 0.3, -0.2 + Math.random() * 0.6, Math.sin(a) * 0.24);
    ice.push(c);
  }
  return (GEO.grunt = { body, head, visor, arm, blade: bladeG, core, hover, thrust, ice: merge(ice) });
}
function casterGeo() {
  if (GEO.caster) return GEO.caster;
  const robe = lathe([[0, -0.85], [0.05, -0.7], [0.2, -0.38], [0.24, -0.05], [0.2, 0.2], [0.26, 0.32], [0.12, 0.42], [0, 0.44]], 7);
  const mantle = new THREE.ConeGeometry(0.36, 0.22, 7, 1, true); mantle.translate(0, 0.3, 0);
  const body = merge([robe, mantle]);
  const head = new THREE.OctahedronGeometry(0.13, 0); head.scale(1, 1.3, 1);
  const eye = new THREE.SphereGeometry(0.035, 10, 8); eye.translate(0, 0.0, 0.1);
  const halo = new THREE.TorusGeometry(0.24, 0.012, 4, 32);
  const crystal = new THREE.OctahedronGeometry(1, 0); crystal.scale(0.05, 0.13, 0.05);
  const core = new THREE.IcosahedronGeometry(0.06, 0); core.translate(0, 0.05, 0.2);
  return (GEO.caster = { body, head, eye, halo, crystal, core });
}

let shadowTex = null;
function blobShadow() {
  if (!shadowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(c);
  }
  GEO.shadow ??= new THREE.PlaneGeometry(1.2, 1.2);
  const m = new THREE.Mesh(GEO.shadow, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.012;
  return m;
}

// Danger sector on the floor: fills toward the player during a telegraph.
const SECTOR_FRAG = `
  uniform float uProgress, uReach, uHalf, uAlpha; uniform vec3 uColor; varying vec2 vP;
  void main(){
    float r = length(vP), a = abs(atan(vP.x, vP.y));
    if (a > uHalf || r > uReach || r < 0.25) discard;
    float edge = smoothstep(uHalf - 0.05, uHalf, a) + smoothstep(uReach - 0.06, uReach, r);
    float fill = step(r, 0.25 + (uReach - 0.25) * uProgress);
    float k = max(edge * 0.9, fill * 0.42) + 0.08;
    gl_FragColor = vec4(uColor * k * uAlpha, 1.0);
    #include <colorspace_fragment>
  }`;
function dangerSector(reach) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uProgress: { value: 0 }, uReach: { value: reach }, uHalf: { value: 0.55 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color(COLORS.danger) } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: SECTOR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  GEO.sector ??= new THREE.PlaneGeometry(reach * 2, reach * 2);
  const m = new THREE.Mesh(GEO.sector, mat);
  m.rotation.x = -Math.PI / 2; m.position.y = 0.02; m.visible = false;
  return m;
}

export function buildGrunt() {
  const G = gruntGeo();
  const armor = rimify(new THREE.MeshStandardMaterial({ color: 0x323848, metalness: 0.75, roughness: 0.36, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0 }), 0x7f8fc0, 2.6, 0.55);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4c, metalness: 0.9, roughness: 0.25, emissive: COLORS.danger, emissiveIntensity: 0.25, flatShading: true });
  const eyeMat = glow(COLORS.enemyIdle);
  const iceMat = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.7, emissive: 0x2a9fd0, emissiveIntensity: 0.6 });

  const root = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 1.15; root.add(body);
  const torso = new THREE.Mesh(G.body, armor); body.add(torso);
  const core = new THREE.Mesh(G.core, eyeMat); body.add(core);
  body.add(haloSprite(eyeMat, 0.42, new V(0, 0.08, 0.24)));
  const head = new THREE.Group(); head.position.y = 0.56; body.add(head);
  head.add(new THREE.Mesh(G.head, armor), new THREE.Mesh(G.visor, eyeMat));
  const arms = [-1, 1].map((sd) => {
    const pivot = new THREE.Group(); pivot.position.set(sd * 0.37, 0.22, 0.02);
    pivot.add(new THREE.Mesh(G.arm, armor), new THREE.Mesh(G.blade, bladeMat));
    body.add(pivot);
    return pivot;
  });
  const hover = new THREE.Mesh(G.hover, eyeMat); hover.position.y = -0.62; body.add(hover);
  const thrust = new THREE.Mesh(G.thrust, new THREE.MeshBasicMaterial({ color: COLORS.enemyIdle, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  thrust.position.y = -0.62; body.add(thrust);
  const ice = new THREE.Mesh(G.ice, iceMat); ice.visible = false; body.add(ice);
  const shadow = blobShadow(); root.add(shadow);
  const sector = dangerSector(1.9); root.add(sector);
  return {
    root, body, head, arms, core, hover, thrust, ice, shadow, sector,
    mats: { armor, bladeMat, eyeMat, iceMat, thrust: thrust.material },
    breakable: [torso, ...head.children, ...arms.flatMap((a) => a.children), core],
    radius: 0.36, height: 1.15,
  };
}

export function buildCaster() {
  const G = casterGeo();
  const armor = rimify(new THREE.MeshStandardMaterial({ color: 0x2c2a3c, metalness: 0.7, roughness: 0.4, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0 }), 0xb08fd8, 2.4, 0.6);
  const eyeMat = glow(COLORS.enemyIdle);
  const iceMat = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, roughness: 0.08, transparent: true, opacity: 0.7, emissive: 0x2a9fd0, emissiveIntensity: 0.6 });
  const root = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 1.6; root.add(body);
  const robe = new THREE.Mesh(G.body, armor); body.add(robe);
  const head = new THREE.Group(); head.position.y = 0.62; body.add(head);
  head.add(new THREE.Mesh(G.head, armor), new THREE.Mesh(G.eye, eyeMat));
  const halo = new THREE.Mesh(G.halo, eyeMat); halo.position.set(0, 0.66, -0.12); body.add(halo);
  const crystals = [-1, 1].map((sd) => { const c = new THREE.Mesh(G.crystal, eyeMat); c.position.set(sd * 0.42, 0.1, 0.12); body.add(c); return c; });
  const core = new THREE.Mesh(G.core, eyeMat); body.add(core);
  body.add(haloSprite(eyeMat, 0.34, new V(0, 0.05, 0.24)));
  const ice = new THREE.Mesh(gruntGeo().ice, iceMat); ice.visible = false; ice.scale.setScalar(0.9); body.add(ice);
  const shadow = blobShadow(); shadow.scale.setScalar(0.8); root.add(shadow);
  return {
    root, body, head, halo, crystals, core, ice, shadow, arms: [], sector: null, hover: halo, thrust: null,
    mats: { armor, eyeMat, iceMat },
    breakable: [robe, ...head.children, ...crystals, halo, core],
    radius: 0.3, height: 1.6,
  };
}

// The orb casters throw.
export function buildOrb() {
  const g = new THREE.Group();
  GEO.orb ??= { core: new THREE.IcosahedronGeometry(0.09, 1), shell: new THREE.IcosahedronGeometry(0.14, 1), ring: new THREE.TorusGeometry(0.18, 0.008, 4, 40) };
  const core = new THREE.Mesh(GEO.orb.core, glow(0xff4d6d));
  const shell = new THREE.Mesh(GEO.orb.shell, new THREE.MeshBasicMaterial({ color: 0xff2a48, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const ring = new THREE.Mesh(GEO.orb.ring, glow(0xffd27a, 0.9));
  g.add(core, shell, ring);
  return { group: g, core, shell, ring };
}
