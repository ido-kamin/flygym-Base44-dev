// NeuroMechFly v2 kinematics + locomotion for the browser, ported from the repo.
//
// - FlyRig: forward kinematics of the baked NeuroMechFly body tree
//   (scripts/bake_neuromechfly.py), matching MuJoCo's hinge-joint convention:
//   body frame = parent * T(body_pos) * R(body_quat) * prod_j R(axis_j, q_j - qpos0_j).
//   A unit test checks it against MuJoCo's own mj_kinematics.
// - CPGNetwork: flygym's coupled phase oscillators (tutorial 4a):
//   dtheta_i = 2*pi*nu_i + sum_j r_j w_ij sin(theta_j - theta_i - phi_ij),
//   dr_i = alpha_i (R_i - r_i), tripod phase biases.
// - Turning (tutorial 4d): a two-value descending signal [left, right]; |signal|
//   sets each side's CPG amplitude and a negative value reverses that side.
// - PreprogrammedSteps: per-leg joint-angle cycles baked from flygym_demo, played
//   at the CPG phase and scaled by the CPG magnitude around the neutral pose.

import * as THREE from 'three';

const TAU = Math.PI * 2;
const MAX_SUBSTEP = 1e-3; // s, Euler substep for the oscillators

export class FlyRig {
  constructor(rig) {
    this.rig = rig;
    this.nBodies = rig.bodies.length;
    this.nJoints = rig.joints.length;
    this.angles = new Float64Array(this.nJoints);
    rig.joints.forEach((j, i) => {
      this.angles[i] = j.neutral;
    });
    this.local = rig.bodies.map((b) => {
      const [w, x, y, z] = b.quat;
      return new THREE.Matrix4().compose(
        new THREE.Vector3(...b.pos),
        new THREE.Quaternion(x, y, z, w),
        new THREE.Vector3(1, 1, 1),
      );
    });
    this.axes = rig.joints.map((j) => new THREE.Vector3(...j.axis).normalize());
    this.anchors = rig.joints.map((j) => new THREE.Vector3(...j.pos));
    this.world = rig.bodies.map(() => new THREE.Matrix4());
    this._rot = new THREE.Matrix4();
    this._tmp = new THREE.Matrix4();
    this._t = new THREE.Matrix4();
    this.bodyIndex = Object.fromEntries(rig.bodies.map((b, i) => [b.name, i]));
    this.legOrder = rig.legOrder;
    this.tables = rig.legOrder.map((leg) => rig.preprogrammed.legs[leg]);
    this.nSamples = rig.preprogrammed.n_samples;
  }

  /** Recompute every body's matrix in the root (thorax) frame. */
  update() {
    const { rig, world, local, angles } = this;
    for (let i = 0; i < this.nBodies; i++) {
      const b = rig.bodies[i];
      const m = world[i];
      if (b.parent < 0) m.copy(local[i]);
      else m.multiplyMatrices(world[b.parent], local[i]);
      for (const ji of b.joints) {
        const q = angles[ji] - rig.joints[ji].qpos0;
        const p = this.anchors[ji];
        // rotation about the joint axis through its anchor (MuJoCo hinge)
        this._rot.makeRotationAxis(this.axes[ji], q);
        if (p.x || p.y || p.z) {
          this._t.makeTranslation(p.x, p.y, p.z);
          this._tmp.makeTranslation(-p.x, -p.y, -p.z);
          this._rot.premultiply(this._t).multiply(this._tmp);
        }
        m.multiply(this._rot);
      }
    }
    return world;
  }

  /** Body origin in the root frame. */
  bodyPosition(i, out = new THREE.Vector3()) {
    return out.setFromMatrixPosition(this.world[i]);
  }

  /**
   * Joint angles of one leg's 7 actuated DoFs at a step phase and magnitude,
   * written into this.angles: neutral + magnitude * (table(phase) - neutral).
   */
  setLegFromStep(li, phase, magnitude) {
    const t = this.tables[li];
    const N = this.nSamples;
    const x = ((((phase % TAU) + TAU) % TAU) / TAU) * N;
    const i0 = Math.floor(x) % N;
    const i1 = (i0 + 1) % N;
    const f = x - Math.floor(x);
    const row = this.rig.legDofJoint[li];
    for (let d = 0; d < 7; d++) {
      const sample = t.angles[i0][d] * (1 - f) + t.angles[i1][d] * f;
      this.angles[row[d]] = t.neutral[d] + magnitude * (sample - t.neutral[d]);
    }
  }

  /** True while the leg is in swing (adhesion off) at this phase. */
  inSwing(li, phase) {
    const [s, e] = this.tables[li].swing;
    const p = ((phase % TAU) + TAU) % TAU;
    return p > s && p < e;
  }
}

export class CPGNetwork {
  constructor(cpg, rng = Math.random) {
    this.freq = cpg.intrinsicFreq;
    this.amp = cpg.intrinsicAmp;
    this.conv = cpg.convergenceCoef;
    this.W = cpg.couplingWeights;
    this.PB = cpg.phaseBiases;
    this.phases = Float64Array.from({ length: 6 }, () => rng() * TAU);
    this.mags = new Float64Array(6);
    this._d = new Float64Array(6);
  }

  /**
   * Advance by dt seconds under a descending signal [left, right]
   * (legs 0-2 are left, 3-5 right, flygym order lf lm lh rf rm rh).
   */
  step(dt, left, right) {
    const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
    const h = dt / n;
    const { phases, mags, W, PB, _d: dph } = this;
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < 6; i++) {
        const drive = i < 3 ? left : right;
        let coupling = 0;
        for (let j = 0; j < 6; j++) coupling += mags[j] * W[i][j] * Math.sin(phases[j] - phases[i] - PB[i][j]);
        dph[i] = TAU * this.freq * (drive < 0 ? -1 : 1) + coupling;
      }
      for (let i = 0; i < 6; i++) {
        const target = this.amp * Math.abs(i < 3 ? left : right);
        phases[i] += dph[i] * h;
        mags[i] += this.conv * (target - mags[i]) * h;
      }
    }
  }
}

/**
 * Descending signal from the game's motor state, following the turning
 * controller: both sides scale with forward drive, and the inner side is
 * reduced (reversing on sharp turns), e.g. [1.2, 0.4] turns right.
 * @param {number} drive  0..1 forward drive
 * @param {number} turn   -1..1, positive = clockwise on screen (fly turns right)
 */
export function descendingSignal(drive, turn) {
  const t = Math.max(-1, Math.min(1, turn));
  const left = drive * (1 + 1.3 * Math.min(0, t));
  const right = drive * (1 - 1.3 * Math.max(0, t));
  return [left, right];
}

/** Fetch the baked rig + meshes (served from public/neuromechfly/). */
export async function loadNeuroMechFly(baseUrl) {
  const [rig, meshes] = await Promise.all([
    fetch(`${baseUrl}neuromechfly/rig.json`).then((r) => {
      if (!r.ok) throw new Error(`rig.json: HTTP ${r.status}`);
      return r.json();
    }),
    fetch(`${baseUrl}neuromechfly/meshes.bin`).then((r) => {
      if (!r.ok) throw new Error(`meshes.bin: HTTP ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  return { rig, meshes };
}

/** Decode one baked geom (int16 quantized verts + uint16 indices) into a BufferGeometry. */
export function geometryFromBake(geom, buffer) {
  const q = new Int16Array(buffer, geom.vertOffset, geom.vertCount * 3);
  const pos = new Float32Array(geom.vertCount * 3);
  const [ox, oy, oz] = geom.quantOrigin;
  const [sx, sy, sz] = geom.quantScale;
  for (let i = 0; i < geom.vertCount; i++) {
    pos[i * 3] = ox + (q[i * 3] + 32768) * sx;
    pos[i * 3 + 1] = oy + (q[i * 3 + 1] + 32768) * sy;
    pos[i * 3 + 2] = oz + (q[i * 3 + 2] + 32768) * sz;
  }
  const idx = new Uint16Array(buffer, geom.indexOffset, geom.indexCount);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(Uint16Array.from(idx), 1));
  g.computeVertexNormals();
  return g;
}
