// Three.js scene for the brain: 139,255 GPU-animated neurons, glowing axon
// tracts, bloom. Consumes the game's event stream and turns it into wave
// fronts and tract pulses.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { buildBrain, CLUSTER_COLORS } from './brainGeometry.js';
import {
  MAX_EDGES,
  MAX_WAVES,
  NEURON_FRAGMENT,
  NEURON_VERTEX,
  TRACT_FRAGMENT,
  TRACT_VERTEX,
} from './brainShaders.js';
import { C, CLUSTER_COUNT, CLUSTERS, CLASS_SENSORY, EDGES } from './connectome.js';
import { norm } from './genome.js';

const WAVE = {
  reward: [0.75, 1.0, 0.3],
  gold: [1.0, 0.82, 0.25],
  fear: [1.0, 0.12, 0.16],
  escape: [1.0, 0.45, 0.1],
  level: [1.0, 0.7, 1.0],
  mutate: [0.62, 0.42, 1.0],
};
const SPONTANEOUS_WAVE_INTERVAL = 0.45;

export class BrainRenderer {
  /**
   * @param {HTMLElement} host  element the canvas is appended to (sized by CSS)
   */
  constructor(host) {
    this.host = host;
    this.time = 0;
    this.pending = []; // scheduled waves: {at, cluster, color, strength}
    this.waveCursor = 0;
    this.lastSpontaneous = 0;
    this.act = new Float32Array(CLUSTER_COUNT);
    this.frameTimes = [];
    this.qualityChecked = false;

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x030304, 1);
    // ACES keeps saturated neon hues instead of clipping dense regions to white
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.domElement.className = 'block h-full w-full';
    host.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = null;
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    camera.position.set(12.5, 4.5, 21.5);
    this.camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, -0.9, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 7;
    controls.maxDistance = 38;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.55;
    this.controls = controls;

    this.brain = buildBrain();
    this.pointCount = this.brain.count;
    this.points = this.createNeurons(this.brain);
    this.tracts = this.createTracts(this.brain.tracts);
    scene.add(this.tracts, this.points);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.35, 0.3);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;

    this.resize = this.resize.bind(this);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.resize();
  }

  createNeurons(brain) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(brain.positions, 3));
    g.setAttribute('aCluster', new THREE.BufferAttribute(brain.cluster, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(brain.phase, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(brain.size, 1));
    // live firing of the real FlyWire neuron behind each point (0..255, see setConnectome)
    this.spikes = new Uint8Array(brain.count);
    this.spikeAttr = new THREE.BufferAttribute(this.spikes, 1, true);
    this.spikeAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aSpike', this.spikeAttr);
    g.computeBoundingSphere();
    this.neuronUniforms = {
      uTime: { value: 0 },
      uScale: { value: 400 },
      uAct: { value: new Float32Array(CLUSTER_COUNT) },
      uColor: { value: CLUSTER_COLORS.map((c) => new THREE.Vector3(...c)) },
      uWave: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4(0, 0, 0, -1e4)) },
      uWaveColor: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uWaveSpeed: { value: 5.5 },
      uIntensity: { value: 0.6 },
      uReal: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.neuronUniforms,
      vertexShader: NEURON_VERTEX,
      fragmentShader: NEURON_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Points(g, m);
  }

  createTracts(tracts) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(tracts.positions, 3));
    g.setAttribute('aT', new THREE.BufferAttribute(tracts.t, 1));
    g.setAttribute('aEdge', new THREE.BufferAttribute(tracts.edge, 1));
    g.setAttribute('color', new THREE.BufferAttribute(tracts.color, 3));
    this.tractUniforms = {
      uTime: { value: 0 },
      uPulse: { value: Array.from({ length: MAX_EDGES }, () => new THREE.Vector3(-1e4, 1, 0)) },
      uGain: { value: new Float32Array(MAX_EDGES).fill(0.5) },
      uFlash: { value: new Float32Array(MAX_EDGES).fill(-1e4) },
      uDim: { value: 1 }, // the model's tracts step back once real spikes are shown
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.tractUniforms,
      vertexShader: TRACT_VERTEX,
      fragmentShader: TRACT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.LineSegments(g, m);
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    // gl_PointSize is in framebuffer pixels: world size * (half framebuffer height / tan(fov/2)) / depth
    this.neuronUniforms.uScale.value = (h * pr * 0.5) / Math.tan((this.camera.fov * Math.PI) / 360);
  }

  /**
   * Bind the real connectome. With positions, the first brain points move to
   * the real soma positions of the FlyWire neurons (point i = neuron i); the few
   * extra points double up on neurons. Without positions, points and neurons of
   * a region are matched in order. VNC points keep the model's activity
   * (FlyWire is the brain only).
   * @param {Uint8Array} neuronCluster  region of each connectome neuron
   * @param {Float32Array|null} [positions]  xyz (nm) of each neuron
   * @param {Uint8Array|null} [neuronSide]  unused; the side is inferred from the regions
   */
  setConnectome(neuronCluster, positions = null) {
    const count = this.brain.count;
    const nb = this.brain.brainCount;
    const n = neuronCluster.length;
    const map = new Int32Array(count).fill(-1);
    if (positions) {
      const pos = this.points.geometry.attributes.position;
      const cl = this.points.geometry.attributes.aCluster;
      // FlyWire nm -> scene units: same width as the procedural brain, dorsal up, centred on the brain's region
      let lo = [Infinity, Infinity, Infinity];
      let hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++) {
        for (let a = 0; a < 3; a++) {
          const v = positions[i * 3 + a];
          if (v < lo[a]) lo[a] = v;
          if (v > hi[a]) hi[a] = v;
        }
      }
      const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      const k = 10.6 / (hi[0] - lo[0]);
      // which way is the fly's left in FlyWire x: the optic lobe labelled left
      let sumL = 0;
      let cntL = 0;
      for (let i = 0; i < n; i++) {
        if (neuronCluster[i] === C.OL_L) {
          sumL += positions[i * 3];
          cntL++;
        }
      }
      const flip = cntL && sumL / cntL > c[0] ? -1 : 1;
      const sum = Array.from({ length: CLUSTER_COUNT }, () => [0, 0, 0, 0]);
      for (let i = 0; i < nb; i++) {
        const j = i < n ? i : i % n;
        map[i] = j;
        const x = flip * (positions[j * 3] - c[0]) * k;
        const y = 3.1 - (positions[j * 3 + 1] - c[1]) * k;
        const z = -(positions[j * 3 + 2] - c[2]) * k;
        pos.setXYZ(i, x, y, z);
        cl.setX(i, neuronCluster[j]);
        const acc = sum[neuronCluster[j]];
        acc[0] += x;
        acc[1] += y;
        acc[2] += z;
        acc[3]++;
      }
      pos.needsUpdate = true;
      cl.needsUpdate = true;
      this.points.geometry.computeBoundingSphere();
      // wave fronts and hover labels start from the real regions' centroids
      this.anchors = CLUSTERS.map((cc, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : cc.anchor));
      this.realPositions = true;
    } else {
      const byCluster = Array.from({ length: CLUSTER_COUNT }, () => []);
      neuronCluster.forEach((c, i) => byCluster[c]?.push(i));
      const seen = new Int32Array(CLUSTER_COUNT);
      const points = new Int32Array(CLUSTER_COUNT);
      const cl = this.brain.cluster;
      for (let i = 0; i < count; i++) points[cl[i]]++;
      for (let i = 0; i < count; i++) {
        const c = cl[i];
        const list = byCluster[c];
        if (list.length) map[i] = list[Math.floor((seen[c]++ * list.length) / points[c])];
      }
    }
    this.pointNeuron = map;
    this.realTarget = 1;
  }

  /** Per-neuron activity from the LIF worker (Uint8 per connectome neuron). */
  setSpikes(activity) {
    const map = this.pointNeuron;
    if (!map) return;
    const out = this.spikes;
    for (let i = 0; i < map.length; i++) {
      const j = map[i];
      out[i] = j >= 0 ? activity[j] : 0;
    }
    this.spikeAttr.needsUpdate = true;
  }

  /** Queue a wave front from a cluster centroid after `delay` seconds. */
  wave(cluster, color, strength = 1, delay = 0) {
    this.pending.push({ at: this.time + delay, cluster, color, strength });
  }

  launchWave({ cluster, color, strength }) {
    const i = this.waveCursor;
    this.waveCursor = (this.waveCursor + 1) % MAX_WAVES;
    const a = this.anchors?.[cluster] ?? CLUSTERS[cluster].anchor;
    this.neuronUniforms.uWave.value[i].set(a[0], a[1], a[2], this.time);
    this.neuronUniforms.uWaveColor.value[i].set(color[0], color[1], color[2], strength);
  }

  flashGenes(genes) {
    EDGES.forEach((e, i) => {
      if (e.gene !== null && genes.includes(e.gene)) this.tractUniforms.uFlash.value[i] = this.time;
    });
  }

  flashEdges(pred) {
    EDGES.forEach((e, i) => {
      if (pred(e)) this.tractUniforms.uFlash.value[i] = this.time;
    });
  }

  /** Turn game events into visuals. */
  consume(events) {
    for (const ev of events) {
      switch (ev.type) {
        case 'pulse':
          this.tractUniforms.uPulse.value[ev.edge].set(this.time, ev.duration * 1.6, Math.min(1.4, ev.strength));
          break;
        case 'fire': {
          // throttle spontaneous fronts so reward/fear waves stay readable
          const c = CLUSTERS[ev.cluster];
          const salient = c.cls === CLASS_SENSORY || ev.cluster === C.DN || ev.cluster === C.PAM;
          if (salient && this.time - this.lastSpontaneous > SPONTANEOUS_WAVE_INTERVAL) {
            this.lastSpontaneous = this.time;
            this.wave(ev.cluster, CLUSTER_COLORS[ev.cluster], 0.45);
          }
          break;
        }
        case 'eat': {
          const s = 0.9 + ev.reward * 1.1;
          this.wave(C.SEZ, WAVE.gold, s);
          this.wave(C.PAM, WAVE.reward, s * 1.2, 0.14);
          this.wave(C.MB_L, WAVE.reward, s, 0.32);
          this.wave(C.MB_R, WAVE.reward, s, 0.32);
          this.flashEdges((e) => e.from === C.SEZ || e.from === C.PAM);
          break;
        }
        case 'hit': {
          const ol = ev.left ? C.OL_L : C.OL_R;
          const lh = ev.left ? C.LH_L : C.LH_R;
          this.wave(ol, WAVE.fear, 1.8);
          this.wave(lh, WAVE.fear, 1.5, 0.12);
          this.wave(C.DN, WAVE.escape, 1.6, 0.28);
          this.flashEdges((e) => e.from === ol || e.from === lh || e.from === C.DN);
          break;
        }
        case 'escape':
          this.wave(C.DN, WAVE.escape, 1.2);
          this.wave(C.T2, WAVE.escape, 1.0, 0.2);
          break;
        case 'predator':
          this.wave(C.OL_L, WAVE.fear, 0.9);
          this.wave(C.OL_R, WAVE.fear, 0.9);
          break;
        case 'levelup':
          this.wave(C.CX, WAVE.level, 2.4);
          this.wave(C.PROTO, WAVE.level, 2.0, 0.25);
          this.wave(C.T2, WAVE.level, 1.6, 0.5);
          this.flashEdges(() => true);
          break;
        case 'mutate':
          this.wave(C.PROTO, WAVE.mutate, 1.8);
          this.wave(C.CX, WAVE.mutate, 1.4, 0.2);
          this.flashGenes(ev.genes);
          break;
        case 'restart':
          this.pending.length = 0;
          this.wave(C.CX, WAVE.mutate, 1.2);
          break;
        default:
          break;
      }
    }
  }

  /**
   * Advance visuals and draw one frame.
   * @param {number} dt  seconds since the last frame
   * @param {Float32Array} activity  connectome cluster activity
   * @param {number[]} weights  genome, shown as tract brightness
   * @param {number} [elapsed]  unclamped wall-clock frame time, for quality adaptation
   */
  frame(dt, activity, weights, elapsed = dt) {
    this.time += dt;
    const k = Math.min(1, dt * 10);
    const uAct = this.neuronUniforms.uAct.value;
    for (let i = 0; i < CLUSTER_COUNT; i++) {
      this.act[i] += (activity[i] - this.act[i]) * k;
      uAct[i] = this.act[i];
    }
    const gain = this.tractUniforms.uGain.value;
    EDGES.forEach((e, i) => {
      gain[i] = e.gene === null ? 0.45 : 0.15 + norm(weights[e.gene]) * 1.1;
    });

    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].at <= this.time) {
        this.launchWave(this.pending[i]);
        this.pending.splice(i, 1);
      }
    }

    const real = this.neuronUniforms.uReal;
    real.value += ((this.realTarget ?? 0) - real.value) * Math.min(1, dt * 1.5);
    // the model's tracts are drawn on the procedural anatomy: hide them over real neuron positions
    this.tractUniforms.uDim.value = 1 - (this.realPositions ? 1 : 0.65) * real.value;
    this.neuronUniforms.uTime.value = this.time;
    this.tractUniforms.uTime.value = this.time;
    this.controls.update(dt);
    this.composer.render(dt);
    this.adaptQuality(elapsed);
  }

  /** One-shot downgrade on slow GPUs: drop to pixel ratio 1 (bloom follows the framebuffer). */
  adaptQuality(dt) {
    if (this.qualityChecked) return;
    this.frameTimes.push(dt);
    const total = this.frameTimes.reduce((a, b) => a + b, 0);
    if (total < 2.5) return;
    this.qualityChecked = true;
    const fps = this.frameTimes.length / total;
    if (fps < 45 && this.renderer.getPixelRatio() > 1) {
      this.renderer.setPixelRatio(1);
      this.composer.setPixelRatio(1);
      this.resize();
    }
  }

  /** Nearest cluster centroid to a client-space point, within `radius` px. */
  pick(clientX, clientY, radius = 44) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3();
    let best = null;
    let bestD = radius;
    CLUSTERS.forEach((c, i) => {
      v.set(...(this.anchors?.[i] ?? c.anchor)).project(this.camera);
      if (v.z > 1) return;
      const x = rect.left + ((v.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - v.y) / 2) * rect.height;
      const d = Math.hypot(x - clientX, y - clientY);
      if (d < bestD) {
        bestD = d;
        best = { cluster: i, x: x - rect.left, y: y - rect.top };
      }
    });
    return best;
  }

  dispose() {
    this.observer.disconnect();
    this.controls.dispose();
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.tracts.geometry.dispose();
    this.tracts.material.dispose();
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
