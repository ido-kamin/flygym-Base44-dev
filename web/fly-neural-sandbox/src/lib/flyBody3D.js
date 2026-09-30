// Three.js view of the NeuroMechFly v2 body walking under its connectome.
//
// The fly walks on a virtual treadmill: the body stays at the origin and the
// floor scrolls beneath it. Legs follow flygym's CPG + PreprogrammedSteps
// (neuromechfly.js), fed by a descending signal derived from the game's motor
// state. How far and how fast the body travels is not guessed: forward speed per
// CPG amplitude, yaw rate per left/right asymmetry and body pitch come from
// walking the same model in MuJoCo physics (scripts/bake_neuromechfly.py).
// Body segments glow with the activity of the neuropil that drives or senses
// them (VNC neuromeres -> legs, optic lobes -> eyes, antennal lobes ->
// antennae, SEZ -> proboscis).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { C } from './connectome.js';
import { MAX_SPEED, MAX_TURN } from './game.js';
import { CPGNetwork, descendingSignal, FlyRig, geometryFromBake } from './neuromechfly.js';

/** Which connectome cluster lights up each body segment (by segment name). */
export function clusterForSegment(seg) {
  if (/^(lf|rf)_/.test(seg)) return C.T1; // prothoracic neuromere: front legs
  if (/^(lm|rm)_/.test(seg)) return C.T2; // mesothoracic: middle legs
  if (/^(lh|rh)_/.test(seg)) return C.T3; // metathoracic: hind legs
  if (seg === 'l_eye') return C.OL_L;
  if (seg === 'r_eye') return C.OL_R;
  if (/^l_(pedicel|funiculus|arista)/.test(seg)) return C.AL_L;
  if (/^r_(pedicel|funiculus|arista)/.test(seg)) return C.AL_R;
  if (/wing/.test(seg)) return C.T2; // flight motor in the mesothorax
  if (/haltere/.test(seg)) return C.T3;
  if (/rostrum|haustellum/.test(seg)) return C.SEZ; // proboscis motor neurons
  if (/abdomen/.test(seg)) return C.T3; // abdominal ganglion, fused to T3 here
  return C.DN;
}

const SENSORY_GLOW = new THREE.Color(0x22d3ee);
const MOTOR_GLOW = new THREE.Color(0xff7a1a);
const SWING_GLOW = new THREE.Color(0xfff1c2);

const FLOOR_VERTEX = /* glsl */ `
varying vec2 vXY;
void main() {
  vXY = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FLOOR_FRAGMENT = /* glsl */ `
uniform vec2 uOffset;   // treadmill position (mm)
uniform float uHeading; // fly heading (rad)
uniform float uPulse;
varying vec2 vXY;
float line(float v, float w) {
  float d = abs(fract(v - 0.5) - 0.5) / fwidth(v);
  return 1.0 - min(d / w, 1.0);
}
void main() {
  // floor coordinates in the fly frame -> world frame (rotate + translate)
  float c = cos(uHeading), s = sin(uHeading);
  vec2 p = vec2(c * vXY.x - s * vXY.y, s * vXY.x + c * vXY.y) + uOffset;
  float fine = line(p.x * 2.0, 1.0) + line(p.y * 2.0, 1.0);
  float coarse = line(p.x * 0.5, 1.5) + line(p.y * 0.5, 1.5);
  float r = length(vXY);
  float fade = smoothstep(9.0, 1.5, r);
  vec3 col = vec3(0.13, 0.83, 0.93) * fine * 0.18 + vec3(0.91, 0.47, 0.98) * coarse * 0.35;
  col += vec3(0.13, 0.83, 0.93) * exp(-r * r * 0.35) * (0.10 + 0.25 * uPulse);
  gl_FragColor = vec4(col * fade, 1.0);
}
`;

export class FlyBody3D {
  /**
   * @param {HTMLElement} host
   * @param {{rig:object, meshes:ArrayBuffer}} asset  from loadNeuroMechFly()
   */
  constructor(host, { rig, meshes }) {
    this.host = host;
    this.rigData = rig;
    this.fly = new FlyRig(rig);
    this.cpg = new CPGNetwork(rig.cpg);
    this.playback = 0.25;
    this.treadmill = new THREE.Vector2();
    this.swing = new Array(6).fill(false);
    this.strideMm = measureStride(this.fly);
    this.walking = rig.walking;
    this.heading = 0; // treadmill heading, MuJoCo convention (CCW from above)
    this.speedMm = 0;
    /** Rhythmic motor drive per VNC neuromere (T1, T2, T3): swing-phase bursts. */
    this.rhythm = new Float32Array(3);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x03040b, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.className = 'block h-full w-full';
    host.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x03040b, 7, 16);
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
    camera.position.set(3.6, 2.4, 4.4);
    this.camera = camera;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.7, 0);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 2;
    controls.maxDistance = 12;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    this.controls = controls;

    scene.add(new THREE.HemisphereLight(0xbfdcff, 0x1a0b24, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 6, 4);
    const rimCyan = new THREE.DirectionalLight(0x22d3ee, 1.6);
    rimCyan.position.set(-4, 2, -3);
    const rimPink = new THREE.DirectionalLight(0xe879f9, 1.2);
    rimPink.position.set(4, 1.5, -4);
    scene.add(key, rimCyan, rimPink);

    this.floorUniforms = { uOffset: { value: this.treadmill }, uHeading: { value: 0 }, uPulse: { value: 0 } };
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShaderMaterial({ uniforms: this.floorUniforms, vertexShader: FLOOR_VERTEX, fragmentShader: FLOOR_FRAGMENT }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // NeuroMechFly is z-up (MuJoCo); Three.js is y-up
    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2;
    scene.add(root);
    this.root = root;
    // body pitch measured in physics (rotation about the fly's lateral y axis)
    const posture = new THREE.Group();
    posture.rotation.y = rig.walking?.pitch ?? 0;
    root.add(posture);
    // stand the kinematic legs on the floor: the stance feet touch y = 0
    root.position.y = measureStanceHeight(this.fly, posture.rotation.y);

    this.bodyObjects = rig.bodies.map(() => {
      const o = new THREE.Object3D();
      o.matrixAutoUpdate = false;
      posture.add(o);
      return o;
    });
    this.materials = [];
    for (const g of rig.geoms) {
      const [r, gg, b, a] = g.rgba;
      const cluster = clusterForSegment(g.segment);
      const isEye = /eye/.test(g.segment);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setRGB(r, gg, b, THREE.SRGBColorSpace),
        roughness: isEye ? 0.25 : 0.6,
        metalness: 0.05,
        transparent: a < 1,
        opacity: a,
        depthWrite: a >= 1,
        side: THREE.DoubleSide,
        emissive: new THREE.Color(0, 0, 0),
      });
      const mesh = new THREE.Mesh(geometryFromBake(g, meshes), mat);
      const [w, x, y, z] = g.quat;
      mesh.position.set(...g.pos);
      mesh.quaternion.set(x, y, z, w);
      this.bodyObjects[g.body].add(mesh);
      const leg = rig.legOrder.indexOf(g.segment.slice(0, 2));
      this.materials.push({ mat, cluster, leg, sensory: cluster <= C.AL_R });
    }

    this.resize = this.resize.bind(this);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setPlayback(p) {
    this.playback = p;
  }

  /**
   * Advance the gait and draw.
   * @param {number} dt  wall seconds since the last frame
   * @param {import('./game.js').Game} game
   * @param {Float32Array} activity  smoothed cluster activity
   */
  frame(dt, game, activity) {
    const h = dt * this.playback;
    const f = game.fly;
    const drive = game.over ? 0 : Math.min(1, f.v / MAX_SPEED);
    const turn = f.omega / MAX_TURN;
    const [left, right] = descendingSignal(drive, turn);
    this.cpg.step(h, left, right);

    for (let li = 0; li < 6; li++) {
      const phase = this.cpg.phases[li];
      this.fly.setLegFromStep(li, phase, this.cpg.mags[li]);
      this.swing[li] = this.cpg.mags[li] > 0.05 && this.fly.inSwing(li, phase);
    }
    // front legs <- T1, middle <- T2, hind <- T3 (flygym order lf lm lh rf rm rh)
    const mags = this.cpg.mags;
    for (let k = 0; k < 3; k++) {
      this.rhythm[k] = ((this.swing[k] ? mags[k] : 0) + (this.swing[k + 3] ? mags[k + 3] : 0)) / 2;
    }
    const world = this.fly.update();
    for (let i = 0; i < world.length; i++) this.bodyObjects[i].matrix.copy(world[i]);

    // treadmill, physics-calibrated: speed from the CPG amplitude, yaw from the
    // left/right amplitude difference (right-side reduction turns right)
    const magL = (mags[0] + mags[1] + mags[2]) / 3;
    const magR = (mags[3] + mags[4] + mags[5]) / 3;
    const signed = (magL * Math.sign(left || 1) + magR * Math.sign(right || 1)) / 2;
    this.speedMm = Math.sign(signed) * speedForAmplitude(this.walking, Math.abs(signed));
    this.heading += (this.walking?.yawPerAmpDiff ?? -1) * (magL - magR) * h;
    this.treadmill.x += Math.cos(this.heading) * this.speedMm * h;
    this.treadmill.y += Math.sin(this.heading) * this.speedMm * h;
    this.floorUniforms.uHeading.value = this.heading;
    this.floorUniforms.uPulse.value = Math.min(1, activity[C.DN] ?? 0);

    for (const m of this.materials) {
      const a = Math.min(1.2, activity[m.cluster] ?? 0);
      const swing = m.leg >= 0 && this.swing[m.leg];
      const base = m.sensory ? SENSORY_GLOW : MOTOR_GLOW;
      m.mat.emissive.copy(base).multiplyScalar(0.015 + a * a * 0.3);
      if (swing) m.mat.emissive.lerp(SWING_GLOW, 0.3);
    }

    this.controls.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.observer.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** Forward speed (mm/s) at a CPG amplitude, interpolated from the physics calibration. */
export function speedForAmplitude(walking, amp) {
  if (!walking) return 0;
  const { amp: xs, mmPerS: ys } = walking.speedByAmp;
  if (amp <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (amp <= xs[i]) return ys[i - 1] + ((amp - xs[i - 1]) / (xs[i] - xs[i - 1])) * (ys[i] - ys[i - 1]);
  }
  const n = xs.length - 1;
  return ys[n] + ((amp - xs[n]) * (ys[n] - ys[n - 1])) / (xs[n] - xs[n - 1]);
}

/**
 * Thorax height at which the kinematic stance feet rest on the floor (mm):
 * the lowest tarsus5 over a full step cycle at magnitude 1, with body pitch.
 * (Physics settles the loaded body lower, see walking.thoraxHeight; the
 * kinematic joint targets are the unloaded pose, so we stand them on the floor.)
 */
export function measureStanceHeight(fly, pitch = 0, samples = 72) {
  const feet = fly.legOrder.map((leg) => fly.bodyIndex[`${leg}_tarsus5`]);
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  let lowest = Infinity;
  const v = new THREE.Vector3();
  for (let k = 0; k < samples; k++) {
    for (let li = 0; li < 6; li++) fly.setLegFromStep(li, (k / samples) * Math.PI * 2, 1);
    fly.update();
    for (const foot of feet) {
      fly.bodyPosition(foot, v);
      // rotate about +y by the pitch: z' = -x sin + z cos
      lowest = Math.min(lowest, -v.x * s + v.z * c);
    }
  }
  for (let li = 0; li < 6; li++) fly.setLegFromStep(li, 0, 0);
  return -lowest;
}

/**
 * Mean stance stroke of the six feet at step magnitude 1 (mm): how far each
 * tarsus5 travels backward while on the ground. Treadmill speed is this times
 * step frequency times CPG magnitude, so feet in stance stay put on the floor.
 */
export function measureStride(fly, samples = 90) {
  let total = 0;
  for (let li = 0; li < 6; li++) {
    const foot = fly.bodyIndex[`${fly.legOrder[li]}_tarsus5`];
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < samples; k++) {
      const phase = (k / samples) * Math.PI * 2;
      if (fly.inSwing(li, phase)) continue;
      fly.setLegFromStep(li, phase, 1);
      fly.update();
      const x = fly.bodyPosition(foot).x;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    total += hi - lo;
  }
  for (let li = 0; li < 6; li++) fly.setLegFromStep(li, 0, 0);
  return total / 6;
}
