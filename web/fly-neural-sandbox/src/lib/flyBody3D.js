// Three.js world for the NeuroMechFly v2 body: the fly roams a 3D arena on its
// own, at the game's position and heading, among the sugar drops and spiders.
//
// Legs follow flygym's CPG + PreprogrammedSteps (neuromechfly.js), fed by a
// descending signal from the game's motor state. The arena is the game world
// at MM_PER_UNIT, chosen so the game's top speed matches what the same model
// walks in MuJoCo physics at full CPG amplitude (scripts/bake_neuromechfly.py:
// ~13 mm/s), so feet don't skate. Survival programs show on the body: the
// giant-fiber escape is a jump, feeding stops the legs, grooming rubs the
// front legs. Body segments glow with the activity of the neuropil that drives
// or senses them (VNC neuromeres -> legs, optic lobes -> eyes, antennal lobes
// -> antennae, SEZ -> proboscis).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { ARENA } from './constants.js';
import { C } from './connectome.js';
import { MAX_SPEED, MAX_TURN, MISSIONS, SEARCH_TOKEN } from './game.js';
import { CPGNetwork, descendingSignal, FlyRig, geometryFromBake } from './neuromechfly.js';

/** Millimetres per game unit: 300 units/s (top speed) = 13.2 mm/s. */
export const MM_PER_UNIT = 0.044;
const TAU = Math.PI * 2;
const ESCAPE_HOP = 1.6; // mm apex of the escape jump
const ESCAPE_HOP_TIME = 0.38; // s

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

const GLOW = new THREE.Color(0xffb347);
const SWING_GLOW = new THREE.Color(0xfff4dc);
const ACCENT = '#f5a524';

const FLOOR_VERTEX = /* glsl */ `
varying vec2 vXZ;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vXZ = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const FLOOR_FRAGMENT = /* glsl */ `
uniform vec2 uHalf; // arena half-size (mm)
varying vec2 vXZ;
float line(float v, float w) {
  float d = abs(fract(v - 0.5) - 0.5) / fwidth(v);
  return 1.0 - min(d / w, 1.0);
}
void main() {
  vec2 p = vXZ;
  float inside = step(abs(p.x), uHalf.x) * step(abs(p.y), uHalf.y);
  float fine = max(line(p.x, 1.0), line(p.y, 1.0));
  float coarse = max(line(p.x / 5.0, 1.2), line(p.y / 5.0, 1.2));
  vec3 base = mix(vec3(0.045, 0.047, 0.052), vec3(0.085, 0.088, 0.095), inside);
  vec3 col = base + vec3(0.035) * fine * inside + vec3(0.07) * coarse * inside;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Game world (units) -> scene (mm): arena centred on the origin, game y -> scene +z. */
function toScene(x, y, out) {
  return out.set((x - ARENA.w / 2) * MM_PER_UNIT, 0, (y - ARENA.h / 2) * MM_PER_UNIT);
}

function tokenLabel(s, mission) {
  if (s.result) return s.kind.length > 28 ? `${s.kind.slice(0, 27)}…` : s.kind;
  if (s.kind === SEARCH_TOKEN) return 'Search';
  return mission === 'build' ? `+ ${s.kind}` : s.kind;
}

/** A flat text chip as a sprite (canvas texture), `heightMm` tall. */
function makeLabel(text, highlight, heightMm = 0.5) {
  const scale = 2;
  const font = `600 ${22 * scale}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 28 * scale;
  const h = 40 * scale;
  c.width = w;
  c.height = h;
  ctx.font = font;
  ctx.fillStyle = highlight ? ACCENT : 'rgba(20,21,24,0.92)';
  ctx.strokeStyle = highlight ? ACCENT : 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.roundRect(scale, scale, w - 2 * scale, h - 2 * scale, 8 * scale);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = highlight ? '#111214' : '#e9eaec';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2 + scale);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sprite.scale.set((heightMm * w) / h, heightMm, 1);
  sprite.renderOrder = 2;
  return sprite;
}

/** A simple procedural spider: two body parts and eight two-segment legs. */
function makeSpider(material, legMaterial) {
  const g = new THREE.Group();
  const ceph = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 14), material);
  ceph.scale.set(1.1, 0.7, 1);
  ceph.position.set(0.55, 0.9, 0);
  const abd = new THREE.Mesh(new THREE.SphereGeometry(1.05, 20, 14), material);
  abd.scale.set(1.25, 0.85, 1);
  abd.position.set(-1.1, 1.1, 0);
  g.add(ceph, abd);
  const femur = new THREE.CylinderGeometry(0.09, 0.11, 1.9, 6);
  femur.translate(0, 0.95, 0);
  const tibia = new THREE.CylinderGeometry(0.05, 0.09, 2.6, 6);
  tibia.translate(0, 1.3, 0);
  const legs = [];
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 4; k++) {
      const hip = new THREE.Group();
      hip.position.set(0.9 - k * 0.32, 0.9, side * 0.35);
      const yaw = new THREE.Group();
      // splay: front legs reach forward, hind legs back (local +x is forward, +z the right side)
      yaw.rotation.y = -side * (0.5 + k * 0.72);
      const f = new THREE.Mesh(femur, legMaterial);
      f.rotation.z = -0.55; // up and out
      const knee = new THREE.Group();
      knee.position.y = 1.9;
      const t = new THREE.Mesh(tibia, legMaterial);
      t.rotation.z = -2.25; // down to the floor
      knee.add(t);
      f.add(knee);
      yaw.add(f);
      hip.add(yaw);
      g.add(hip);
      legs.push({ yaw, base: yaw.rotation.y, k, side });
    }
  }
  g.userData.legs = legs;
  return g;
}

export class FlyBody3D {
  /**
   * @param {HTMLElement} host
   * @param {{rig:object, meshes:ArrayBuffer}} asset  from loadNeuroMechFly()
   * @param {{onFloorClick?: (x:number, y:number) => void}} [opts]  click on the floor, in game units
   */
  constructor(host, { rig, meshes }, { onFloorClick } = {}) {
    this.host = host;
    this.rigData = rig;
    this.fly = new FlyRig(rig);
    this.cpg = new CPGNetwork(rig.cpg);
    this.playback = 1;
    this.swing = new Array(6).fill(false);
    this.strideMm = measureStride(this.fly);
    this.walking = rig.walking;
    this.onFloorClick = onFloorClick;
    this.time = 0;
    this.hopT = -1;
    /** Rhythmic motor drive per VNC neuromere (T1, T2, T3): swing-phase bursts. */
    this.rhythm = new Float32Array(3);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x0c0d0f, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = 'block h-full w-full';
    host.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0c0d0f, 30, 70);
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
    this.camera = camera;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 3;
    controls.maxDistance = 45;
    controls.maxPolarAngle = Math.PI * 0.47;
    this.controls = controls;
    this.follow = new THREE.Vector3();
    toScene(ARENA.w / 2, ARENA.h / 2, this.follow);
    controls.target.copy(this.follow).setY(0.6);
    camera.position.set(-9, 8, 11);

    scene.add(new THREE.HemisphereLight(0xe8ecf2, 0x202226, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(6, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera;
    sc.left = -6;
    sc.right = 6;
    sc.top = 6;
    sc.bottom = -6;
    sc.near = 1;
    sc.far = 40;
    key.shadow.bias = -0.0005;
    scene.add(key, key.target);
    this.key = key;

    const halfW = (ARENA.w / 2) * MM_PER_UNIT;
    const halfH = (ARENA.h / 2) * MM_PER_UNIT;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(halfW * 2 + 40, halfH * 2 + 40),
      new THREE.ShaderMaterial({
        uniforms: { uHalf: { value: new THREE.Vector2(halfW, halfH) } },
        vertexShader: FLOOR_VERTEX,
        fragmentShader: FLOOR_FRAGMENT,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    this.floor = floor;
    // shadows on a transparent catcher above the grid
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, halfH * 2), new THREE.ShadowMaterial({ opacity: 0.45 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = 0.002;
    catcher.receiveShadow = true;
    scene.add(catcher);
    // low arena wall
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.9 });
    const wallH = 0.8;
    for (const [w, d, x, z] of [
      [halfW * 2 + 0.4, 0.2, 0, -halfH - 0.1],
      [halfW * 2 + 0.4, 0.2, 0, halfH + 0.1],
      [0.2, halfH * 2, -halfW - 0.1, 0],
      [0.2, halfH * 2, halfW + 0.1, 0],
    ]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
      wall.position.set(x, wallH / 2, z);
      wall.receiveShadow = true;
      scene.add(wall);
    }

    // the fly's path over the last few seconds
    this.trailMax = 90;
    this.trailPos = new Float32Array(this.trailMax * 3);
    const trailGeom = new THREE.BufferGeometry();
    trailGeom.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trail = new THREE.Line(trailGeom, new THREE.LineBasicMaterial({ color: 0x5b5f68, transparent: true, opacity: 0.8 }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);

    // ---- the fly: NeuroMechFly is z-up (MuJoCo); Three.js is y-up ----
    this.flyGroup = new THREE.Group(); // position + heading in the arena
    scene.add(this.flyGroup);
    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2;
    this.flyGroup.add(root);
    this.root = root;
    const posture = new THREE.Group();
    posture.rotation.y = rig.walking?.pitch ?? 0;
    root.add(posture);
    this.standHeight = measureStanceHeight(this.fly, posture.rotation.y);
    root.position.y = this.standHeight;

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
      mesh.castShadow = a >= 1;
      const [w, x, y, z] = g.quat;
      mesh.position.set(...g.pos);
      mesh.quaternion.set(x, y, z, w);
      this.bodyObjects[g.body].add(mesh);
      const leg = rig.legOrder.indexOf(g.segment.slice(0, 2));
      this.materials.push({ mat, cluster, leg });
    }

    // ---- sugar drops, mission tokens, spiders ----
    this.sugarGeom = new THREE.IcosahedronGeometry(0.32, 1);
    this.sugarMat = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.25, metalness: 0, emissive: 0x3a3220 });
    this.tokenMat = new THREE.MeshStandardMaterial({ color: 0xe9eaec, roughness: 0.4 });
    this.nextMat = new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.35, emissive: 0x3d2600 });
    this.sugarObjs = new Map();
    this.spiderMat = new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.55 });
    this.spiderLegMat = new THREE.MeshStandardMaterial({ color: 0x2b2826, roughness: 0.6 });
    this.spiderObjs = new Map();
    this.rings = [];
    this.ringGeom = new THREE.RingGeometry(0.9, 1, 48);
    this.ringGeom.rotateX(-Math.PI / 2);

    this._v = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.onPointerDown = (e) => {
      this.down = { x: e.clientX, y: e.clientY };
    };
    this.onPointerUp = (e) => {
      const d = this.down;
      this.down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || !this.onFloorClick) return;
      const p = this.floorPoint(e.clientX, e.clientY);
      if (p) this.onFloorClick(p.x, p.y);
    };
    renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    renderer.domElement.addEventListener('pointerup', this.onPointerUp);

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

  /** Client point -> game coordinates on the floor, or null outside the arena. */
  floorPoint(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = this.ray.ray.intersectPlane(this.plane, this._v);
    if (!hit) return null;
    const x = hit.x / MM_PER_UNIT + ARENA.w / 2;
    const y = hit.z / MM_PER_UNIT + ARENA.h / 2;
    if (x < 0 || y < 0 || x > ARENA.w || y > ARENA.h) return null;
    return { x, y };
  }

  /** Visual effects for game events. */
  consume(events) {
    for (const ev of events) {
      if (ev.type === 'escape') this.hopT = 0;
      if (ev.type === 'eat') this.ring(ev.x, ev.y, 0xf5a524);
      if (ev.type === 'hit') this.ring(ev.x, ev.y, 0xef4444);
      if (ev.type === 'predator') this.ring(ev.x, ev.y, 0xef4444);
      if (ev.type === 'sugar') this.ring(ev.x, ev.y, 0xe9eaec);
    }
  }

  ring(x, y, color) {
    const m = new THREE.Mesh(this.ringGeom, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    toScene(x, y, m.position).setY(0.02);
    this.scene.add(m);
    this.rings.push({ m, age: 0 });
  }

  /**
   * Advance the gait and draw.
   * @param {number} dt  wall seconds since the last frame
   * @param {import('./game.js').Game} game
   * @param {Float32Array} activity  smoothed cluster activity
   */
  frame(dt, game, activity) {
    const h = dt * this.playback;
    this.time += h;
    const f = game.fly;
    const behaviour = game.behaviour;
    const still = game.over || behaviour === 'feed' || behaviour === 'groom';
    const drive = still ? 0 : Math.min(1, f.v / MAX_SPEED);
    const turn = f.omega / MAX_TURN;
    const [left, right] = descendingSignal(drive, turn);
    this.cpg.step(h, left, right);

    const mags = this.cpg.mags;
    for (let li = 0; li < 6; li++) {
      const phase = this.cpg.phases[li];
      if (behaviour === 'groom' && (li === 0 || li === 3)) {
        // front legs lifted and rubbing against each other (~6 Hz)
        const rub = Math.sin(this.time * TAU * 6 + (li === 3 ? Math.PI : 0));
        this.fly.setLegFromStep(li, Math.PI * 0.9 + 0.55 * rub, 1.1);
        this.swing[li] = true;
      } else {
        this.fly.setLegFromStep(li, phase, mags[li]);
        this.swing[li] = mags[li] > 0.05 && this.fly.inSwing(li, phase);
      }
    }
    // front legs <- T1, middle <- T2, hind <- T3 (flygym order lf lm lh rf rm rh)
    for (let k = 0; k < 3; k++) {
      this.rhythm[k] = ((this.swing[k] ? Math.max(mags[k], 0.6 * (behaviour === 'groom' && k === 0)) : 0) + (this.swing[k + 3] ? mags[k + 3] : 0)) / 2;
    }
    const world = this.fly.update();
    for (let i = 0; i < world.length; i++) this.bodyObjects[i].matrix.copy(world[i]);

    // place the fly in the arena; the escape is a jump
    toScene(f.x, f.y, this.flyGroup.position);
    this.flyGroup.rotation.y = -f.theta;
    let hop = 0;
    if (this.hopT >= 0) {
      this.hopT += h;
      const u = this.hopT / ESCAPE_HOP_TIME;
      if (u >= 1) this.hopT = -1;
      else hop = ESCAPE_HOP * 4 * u * (1 - u);
    }
    this.root.position.y = this.standHeight + hop;

    for (const m of this.materials) {
      const a = Math.min(1.2, activity[m.cluster] ?? 0);
      const swing = m.leg >= 0 && this.swing[m.leg];
      m.mat.emissive.copy(GLOW).multiplyScalar(0.01 + a * a * 0.22);
      if (swing) m.mat.emissive.lerp(SWING_GLOW, 0.18);
    }

    this.syncSugar(game);
    this.syncSpiders(game);
    this.syncTrail(game);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += h;
      const s = 0.4 + r.age * 5;
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = Math.max(0, 0.8 - r.age * 1.4);
      if (r.age > 0.6) {
        this.scene.remove(r.m);
        r.m.material.dispose();
        this.rings.splice(i, 1);
      }
    }

    // chase camera: follow the fly, keeping whatever orbit the user chose
    const target = toScene(f.x, f.y, this._d).setY(0.6);
    const k = 1 - Math.exp(-dt * 3);
    this._v.copy(target).sub(this.controls.target).multiplyScalar(k);
    this.controls.target.add(this._v);
    this.camera.position.add(this._v);
    this.key.position.set(this.controls.target.x + 6, 14, this.controls.target.z + 8);
    this.key.target.position.copy(this.controls.target);

    this.controls.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  syncSugar(game) {
    const stages = MISSIONS[game.mission]?.stages;
    const need = stages ? stages[game.pipeline] : null;
    const seen = new Set();
    for (const s of game.sugars) {
      seen.add(s);
      let o = this.sugarObjs.get(s);
      const next = Boolean(s.kind) && (s.kind === need || s.kind === SEARCH_TOKEN || Boolean(s.result));
      if (o && o.next !== next) {
        this.removeSugar(s, o);
        o = null;
      }
      if (!o) {
        const mat = s.kind ? (next ? this.nextMat : this.tokenMat) : this.sugarMat;
        const mesh = new THREE.Mesh(this.sugarGeom, mat);
        mesh.castShadow = true;
        const group = new THREE.Group();
        group.add(mesh);
        let label = null;
        if (s.kind) {
          label = makeLabel(tokenLabel(s, game.mission), next);
          label.position.y = 1.0;
          group.add(label);
        }
        toScene(s.x, s.y, group.position);
        this.scene.add(group);
        o = { group, mesh, label, next, labelW: label?.scale.x ?? 0, labelH: label?.scale.y ?? 0 };
        this.sugarObjs.set(s, o);
      }
      const pop = Math.min(1, s.age * 5);
      o.mesh.scale.setScalar(pop);
      if (o.label) {
        // keep labels readable: never bigger on screen than at ~10 mm, hidden right at the lens
        const d = this.camera.position.distanceTo(o.group.position);
        const k = Math.min(1, d / 10) * pop;
        o.label.scale.set(o.labelW * k, o.labelH * k, 1);
        o.label.visible = d > 2.5;
      }
      o.mesh.position.y = 0.3 + 0.08 * Math.sin(this.time * 2 + s.phase);
      o.mesh.rotation.y = this.time * 0.6 + s.phase;
    }
    for (const [s, o] of this.sugarObjs) if (!seen.has(s)) this.removeSugar(s, o);
  }

  removeSugar(s, o) {
    this.scene.remove(o.group);
    if (o.label) {
      o.label.material.map.dispose();
      o.label.material.dispose();
    }
    this.sugarObjs.delete(s);
  }

  syncSpiders(game) {
    const seen = new Set();
    for (const p of game.predators) {
      seen.add(p);
      let g = this.spiderObjs.get(p);
      if (!g) {
        g = makeSpider(this.spiderMat, this.spiderLegMat);
        g.traverse((o) => {
          if (o.isMesh) o.castShadow = true;
        });
        this.scene.add(g);
        this.spiderObjs.set(p, g);
      }
      toScene(p.x, p.y, g.position);
      g.rotation.y = -p.theta;
      const s = Math.min(1, p.age * 4);
      g.scale.setScalar(s);
      // alternating tetrapod gait
      for (const leg of g.userData.legs) {
        const ph = p.gait * TAU + (leg.k % 2 === 0 ? 0 : Math.PI) + (leg.side > 0 ? Math.PI : 0);
        leg.yaw.rotation.y = leg.base + 0.28 * Math.sin(ph);
      }
    }
    for (const [p, g] of this.spiderObjs) {
      if (!seen.has(p)) {
        this.scene.remove(g);
        this.spiderObjs.delete(p);
      }
    }
  }

  syncTrail(game) {
    const t = game.trail;
    const n = Math.min(t.length, this.trailMax);
    const start = t.length - n;
    for (let i = 0; i < n; i++) {
      toScene(t[start + i].x, t[start + i].y, this._v);
      this.trailPos[i * 3] = this._v.x;
      this.trailPos[i * 3 + 1] = 0.01;
      this.trailPos[i * 3 + 2] = this._v.z;
    }
    this.trail.geometry.setDrawRange(0, n);
    this.trail.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.observer.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        o.material.map?.dispose();
        o.material.dispose();
      }
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
