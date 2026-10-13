import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { AudioEngine } from './audio.js';
import { buildWorld } from './world.js';
import { FX } from './fx.js';
import { Player } from './player.js';
import { Game } from './game.js';
import { WristDisplay, ComboHud, Board, Vignette, DomHud, Fade } from './hud.js';
import { Sandbox, MODES, LAB_MODES } from './sandbox.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(0.5);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const rig = new THREE.Group();
scene.add(rig);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.03, 400);
camera.position.set(0, 1.6, 0);
rig.add(camera);

const audio = new AudioEngine();
const world = buildWorld(scene, renderer);
const fx = new FX(scene);
const player = new Player({ renderer, scene, camera, rig });
const game = new Game({
  scene, audio, fx, player,
  wrist: new WristDisplay(player.offGlove.forearm, player.forceHand),
  comboHud: new ComboHud(scene),
  board: new Board(scene),
  vignette: new Vignette(camera),
  domHud: new DomHud(),
});
const fade = new Fade(camera);
const sandbox = new Sandbox({ game, player, scene, board: game.board, fade, comboHud: game.comboHud, audio, fx });
game.sandbox = sandbox;

// desktop mode bar (in VR you slash the hub crystals instead)
const modeBar = document.getElementById('modes');
for (const [id, label] of MODES) {
  const b = document.createElement('button');
  b.textContent = label; b.dataset.mode = id;
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', () => { audio.unlock(); sandbox.enter(id); b.blur(); });
  modeBar.appendChild(b);
}
// movement lab: one button per mechanic, shown while you're in the lab
const labBar = document.getElementById('labmodes');
LAB_MODES.forEach((m, i) => {
  const b = document.createElement('button');
  b.textContent = `${i + 1} ${m.name}`;
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', () => { sandbox.lab.setMode(i); b.blur(); });
  labBar.appendChild(b);
});
sandbox.lab.onModeChange = (i) => { [...labBar.children].forEach((b, k) => b.classList.toggle('on', k === i)); };
const markMode = (id) => {
  for (const b of modeBar.children) b.classList.toggle('on', b.dataset.mode === id);
  labBar.style.display = id === 'movement' ? 'flex' : 'none';
  document.body.classList.toggle('lab', id === 'movement');
};
sandbox.onModeChange = markMode;
markMode('hub');

// --- VR entry + audio unlock (browsers only start audio after a gesture)
const vrButton = VRButton.createButton(renderer);
document.body.appendChild(vrButton);
vrButton.addEventListener('click', () => audio.unlock());
const unlock = () => audio.unlock();
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);
renderer.xr.addEventListener('sessionstart', () => {
  audio.unlock();
  const s = renderer.xr.getSession();
  if (s && s.updateTargetFrameRate && s.supportedFrameRates) {
    const rates = Array.from(s.supportedFrameRates);
    if (rates.includes(90)) s.updateTargetFrameRate(90).catch(() => {});
  }
  document.body.classList.add('in-vr');
  sandbox.onSessionStart();
});
renderer.xr.addEventListener('sessionend', () => { document.body.classList.remove('in-vr'); sandbox.onSessionStart(); });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- loop
const _fwd = new THREE.Vector3(), _up = new THREE.Vector3();
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000));
  last = now;

  const t = audio.update();
  player.update(dt, now);
  game.update(dt, t, now);
  world.update(dt, t, game.beatInfo(), game.tierIdx + (game.state === 'play' ? 1 : 0), player.head, player.head);

  let vh = renderer.domElement.height;
  if (renderer.xr.isPresenting) { const cams = renderer.xr.getCamera().cameras; if (cams.length && cams[0].viewport) vh = cams[0].viewport.w; }
  fx.update(dt, player.head, vh);
  fade.update(dt);

  camera.getWorldDirection(_fwd);
  _up.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  audio.setListener(player.head, _fwd, _up);
  audio.setSwing(player.blade.speed, player.blade.tip);

  renderer.render(scene, camera);
});

// handy for debugging from the console
window.__cadence = { game, player, audio, scene, renderer, camera, fx, sandbox, THREE };
