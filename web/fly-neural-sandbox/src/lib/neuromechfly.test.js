import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CPGNetwork, descendingSignal, FlyRig, geometryFromBake } from './neuromechfly.js';

const dir = fileURLToPath(new URL('../../public/neuromechfly/', import.meta.url));
const rig = JSON.parse(readFileSync(`${dir}rig.json`, 'utf8'));
const meshes = readFileSync(`${dir}meshes.bin`);
const meshBuffer = meshes.buffer.slice(meshes.byteOffset, meshes.byteOffset + meshes.byteLength);

describe('NeuroMechFly rig', () => {
  it('has the flygym body plan: 6 legs x 7 actuated DoFs, tarsus1-5 per leg', () => {
    expect(rig.legOrder).toEqual(['lf', 'lm', 'lh', 'rf', 'rm', 'rh']);
    expect(rig.legDofJoint.flat()).toHaveLength(42);
    expect(new Set(rig.legDofJoint.flat()).size).toBe(42);
    for (const leg of rig.legOrder) {
      for (const seg of ['coxa', 'trochanterfemur', 'tibia', 'tarsus1', 'tarsus5']) {
        expect(rig.bodies.some((b) => b.name === `${leg}_${seg}`)).toBe(true);
      }
    }
  });

  it("forward kinematics matches MuJoCo's mj_kinematics to < 1 nm", () => {
    const fly = new FlyRig(rig);
    fly.angles.set(rig.fkFixture.angles);
    fly.update();
    let worst = 0;
    rig.fkFixture.bodyPositions.forEach((p, i) => {
      const v = fly.bodyPosition(i);
      worst = Math.max(worst, Math.abs(v.x - p[0]), Math.abs(v.y - p[1]), Math.abs(v.z - p[2]));
    });
    expect(worst).toBeLessThan(1e-6); // mm
  });

  it('decodes quantized meshes to finite geometry within their bounds', () => {
    const g = geometryFromBake(rig.geoms[0], meshBuffer);
    const pos = g.getAttribute('position').array;
    expect(pos.every(Number.isFinite)).toBe(true);
    expect(g.index.count).toBe(rig.geoms[0].indexCount);
  });
});

describe('CPG (flygym tutorial 4a/4d)', () => {
  it('locks into a tripod gait: LF, RM, LH in phase; the two tripods anti-phase', () => {
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const cpg = new CPGNetwork(rig.cpg, rng);
    for (let i = 0; i < 3000; i++) cpg.step(1e-3, 1, 1);
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const [lf, lm, lh, rf, rm, rh] = cpg.phases;
    expect(Math.abs(wrap(lf - rm))).toBeLessThan(0.05);
    expect(Math.abs(wrap(lf - lh))).toBeLessThan(0.05);
    expect(Math.abs(wrap(rf - lm))).toBeLessThan(0.05);
    expect(Math.abs(Math.abs(wrap(lf - rf)) - Math.PI)).toBeLessThan(0.05);
    expect(cpg.mags.every((m) => Math.abs(m - 1) < 1e-3)).toBe(true);
  });

  it('runs at the 12 Hz intrinsic frequency', () => {
    const cpg = new CPGNetwork(rig.cpg, () => 0);
    for (let i = 0; i < 2000; i++) cpg.step(1e-3, 1, 1);
    const p0 = cpg.phases[0];
    for (let i = 0; i < 1000; i++) cpg.step(1e-3, 1, 1);
    expect((cpg.phases[0] - p0) / (2 * Math.PI)).toBeCloseTo(12, 1);
  });

  it('turns by reducing the inner side, reversing it on sharp turns', () => {
    expect(descendingSignal(1, 0)).toEqual([1, 1]);
    const [l, r] = descendingSignal(1, 0.6);
    expect(l).toBe(1);
    expect(r).toBeCloseTo(0.22, 2);
    expect(descendingSignal(1, 1)[1]).toBeLessThan(0);
    expect(descendingSignal(1, -0.6)[0]).toBeCloseTo(0.22, 2);
  });

  it('steps move the feet: tarsus5 sweeps during a cycle', () => {
    const fly = new FlyRig(rig);
    const foot = fly.bodyIndex.lf_tarsus5;
    const xs = [];
    for (let k = 0; k < 36; k++) {
      fly.setLegFromStep(0, (k / 36) * 2 * Math.PI, 1);
      fly.update();
      xs.push(fly.bodyPosition(foot).x);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.2); // mm of stride
  });
});

describe('body view mapping', () => {
  it('maps body segments to the neuropils that drive/sense them', async () => {
    const { clusterForSegment, measureStride } = await import('./flyBody3D.js');
    const { C } = await import('./connectome.js');
    expect(clusterForSegment('lf_tibia')).toBe(C.T1);
    expect(clusterForSegment('rm_tarsus3')).toBe(C.T2);
    expect(clusterForSegment('lh_coxa')).toBe(C.T3);
    expect(clusterForSegment('l_eye')).toBe(C.OL_L);
    expect(clusterForSegment('r_arista')).toBe(C.AL_R);
    expect(clusterForSegment('c_haustellum')).toBe(C.SEZ);
    const stride = measureStride(new FlyRig(rig));
    expect(stride).toBeGreaterThan(0.2);
    expect(stride).toBeLessThan(1.5);
    console.log('stance stroke (mm):', stride.toFixed(3));
  });
});

describe('physics calibration (MuJoCo walk baked by scripts/bake_neuromechfly.py)', () => {
  it('speed rises with CPG amplitude and a stronger left side turns right', async () => {
    const { speedForAmplitude } = await import('./flyBody3D.js');
    const w = rig.walking;
    expect(w.thoraxHeight).toBeGreaterThan(0.8);
    expect(w.thoraxHeight).toBeLessThan(1.5);
    expect(Math.abs(w.pitch)).toBeLessThan(0.2);
    const sp = w.speedByAmp.mmPerS;
    for (let i = 1; i < sp.length; i++) expect(sp[i]).toBeGreaterThan(sp[i - 1]);
    // real Drosophila walk at roughly 5-30 mm/s
    expect(sp.at(-1)).toBeGreaterThan(5);
    expect(sp.at(-1)).toBeLessThan(40);
    expect(speedForAmplitude(w, 0.5)).toBeCloseTo(sp[2], 6);
    expect(speedForAmplitude(w, 0.375)).toBeGreaterThan(sp[1]);
    // MuJoCo yaw is CCW-positive: (L - R) > 0 must give negative yaw (right turn)
    expect(w.yawPerAmpDiff).toBeLessThan(0);
  });

  it('stands the kinematic stance feet on the floor', async () => {
    const { measureStanceHeight } = await import('./flyBody3D.js');
    const h = measureStanceHeight(new FlyRig(rig), rig.walking.pitch);
    expect(h).toBeGreaterThan(0.9);
    expect(h).toBeLessThan(1.6);
  });
});
