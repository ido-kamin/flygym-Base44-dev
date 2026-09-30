"""Bake the NeuroMechFly v2 body into a compact kinematic rig for the web app.

The Fly Neural Sandbox shows the real NeuroMechFly body walking in 3D, driven by
its simulated connectome. It does not run physics in the browser: it runs the
repo's CPG controller (ported to JS) and applies forward kinematics to the same
model that ``scripts/dev/build_wasm_game_assets.py`` exports for the browser
game. This script composes that model with flygym, compiles it with MuJoCo and
writes:

``public/neuromechfly/rig.json``
    The body tree (parent, local pos/quat), the hinge joints (axis, anchor,
    qpos0 and neutral-keyframe angle), one entry per mesh geom (body, local
    pose, color, byte ranges into ``meshes.bin``), the (leg, DoF) -> joint map
    of the 42 actuated DoFs, the CPG parameters and the baked
    ``PreprogrammedSteps`` tables.
``public/neuromechfly/meshes.bin``
    Mesh vertices (int16, quantized per mesh) and triangle indices (uint16).

The browser plays the gait kinematically, so the script also walks the fly in
real MuJoCo physics (same CPG, PreprogrammedSteps, adhesion) and bakes the
measured posture (thorax height, pitch), forward speed as a function of CPG
amplitude and yaw rate as a function of left/right asymmetry. The web view
moves the fly with these physics-calibrated numbers rather than guesses.

The CPG parameters are flygym's defaults from
``flygym_demo/complex_terrain/cpg_controller.py`` / tutorial 4a (12 Hz,
amplitude 1, coupling 10, convergence 20, tripod phase biases). The baked step
tables and segment colors come from ``build_wasm_game_assets.py`` itself, so
the web fly and the in-repo browser game share one source of truth.

Run it whenever the model changes (needs the repo environment)::

    uv run python web/fly-neural-sandbox/scripts/bake_neuromechfly.py
"""

from __future__ import annotations

import importlib.util
import json
import tempfile
from pathlib import Path

import mujoco as mj
import numpy as np
from flygym.compose import FlatGroundWorld
from flygym.utils.math import Rotation3D
from flygym_demo.complex_terrain.common import make_locomotion_fly
from flygym_demo.complex_terrain.preprogrammed import PreprogrammedSteps

REPO_ROOT = Path(__file__).resolve().parents[3]
OUT_DIR = Path(__file__).resolve().parents[1] / "public" / "neuromechfly"

# flygym CPG defaults (tutorial 4a / cpg_controller.py)
CPG_INTRINSIC_FREQ = 12.0  # Hz
CPG_INTRINSIC_AMP = 1.0
CPG_COUPLING_STRENGTH = 10.0
CPG_CONVERGENCE_COEF = 20.0
# phase samples for the step tables (the JS side lerps periodically)
N_PHASE_SAMPLES = 180


def _load_game_builder():
    """Import scripts/dev/build_wasm_game_assets.py as a module (main-guarded)."""
    path = REPO_ROOT / "scripts" / "dev" / "build_wasm_game_assets.py"
    spec = importlib.util.spec_from_file_location("build_wasm_game_assets", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def compile_model() -> mj.MjModel:
    """The same legs-only, position-actuated NeuroMechFly as the browser game."""
    game = _load_game_builder()
    fly = make_locomotion_fly(
        name="nmf",
        joint_stiffness=game.JOINT_STIFFNESS,
        joint_damping=game.JOINT_DAMPING,
        passive_tarsus_stiffness=game.PASSIVE_TARSUS_STIFFNESS,
        passive_tarsus_damping=game.PASSIVE_TARSUS_DAMPING,
        actuator_gain=game.ACTUATOR_GAIN,
        actuator_forcerange=game.ACTUATOR_FORCERANGE,
        add_adhesion=True,
        adhesion_gain=game.ADHESION_GAIN,
        colorize=True,
    )
    world = FlatGroundWorld()
    world.add_fly(fly, (0.0, 0.0, 0.5), Rotation3D("quat", (1, 0, 0, 0)))
    with tempfile.TemporaryDirectory() as tmp:
        world.save_xml_with_assets(Path(tmp), "fly.xml")
        return mj.MjModel.from_xml_path(str(Path(tmp) / "fly.xml"))


def short(name: str) -> str:
    return name.split("/")[-1]


def bake(model: mj.MjModel) -> tuple[dict, bytes]:
    game = _load_game_builder()
    data = mj.MjData(model)
    mj.mj_resetDataKeyframe(model, data, 0)  # the "neutral" keyframe
    mj.mj_forward(model, data)

    # ---- bodies: every fly body (skip the world body 0) ----
    fly_bodies = [b for b in range(1, model.nbody) if model.body(b).name.startswith("nmf")]
    index_of = {b: i for i, b in enumerate(fly_bodies)}
    root = fly_bodies[0]
    assert short(model.body(root).name) == "c_thorax", "expected c_thorax as the fly root"

    # ---- hinge joints (the root free joint is replaced by the game's own pose) ----
    joints = []
    joint_index = {}
    for j in range(model.njnt):
        if model.jnt_type[j] != mj.mjtJoint.mjJNT_HINGE:
            continue
        adr = int(model.jnt_qposadr[j])
        joint_index[j] = len(joints)
        joints.append(
            {
                "name": short(model.joint(j).name),
                "axis": [round(float(v), 6) for v in model.jnt_axis[j]],
                "pos": [round(float(v), 6) for v in model.jnt_pos[j]],
                "qpos0": round(float(model.qpos0[adr]), 6),
                "neutral": round(float(data.qpos[adr]), 6),
            }
        )

    bodies = []
    for b in fly_bodies:
        parent = int(model.body_parentid[b])
        bodies.append(
            {
                "name": short(model.body(b).name),
                "parent": index_of.get(parent, -1),
                # the root's placement comes from the game; keep only its height
                "pos": [0.0, 0.0, 0.0] if b == root else [round(float(v), 6) for v in model.body_pos[b]],
                "quat": [1.0, 0.0, 0.0, 0.0] if b == root else [round(float(v), 6) for v in model.body_quat[b]],
                "joints": [
                    joint_index[j]
                    for j in range(model.body_jntadr[b], model.body_jntadr[b] + model.body_jntnum[b])
                    if j in joint_index
                ],
            }
        )

    # ---- mesh geoms: int16-quantized vertices + uint16 indices ----
    seg_color = game.segment_colors()
    blob = bytearray()
    geoms = []
    for g in range(model.ngeom):
        b = int(model.geom_bodyid[g])
        mesh_id = int(model.geom_dataid[g])
        if b not in index_of or mesh_id < 0:
            continue
        va, vn = int(model.mesh_vertadr[mesh_id]), int(model.mesh_vertnum[mesh_id])
        fa, fn = int(model.mesh_faceadr[mesh_id]), int(model.mesh_facenum[mesh_id])
        verts = np.asarray(model.mesh_vert[va : va + vn], dtype=np.float64)
        faces = np.asarray(model.mesh_face[fa : fa + fn], dtype=np.int64)
        assert vn < 65536, "mesh too large for uint16 indices"
        lo, hi = verts.min(axis=0), verts.max(axis=0)
        scale = np.maximum(hi - lo, 1e-9) / 65535.0
        q = np.round((verts - lo) / scale - 32768).astype(np.int16)

        while len(blob) % 4:
            blob.append(0)
        vert_offset = len(blob)
        blob += q.tobytes()
        while len(blob) % 4:
            blob.append(0)
        index_offset = len(blob)
        blob += faces.astype(np.uint16).tobytes()

        segment = short(model.geom(g).name)
        rgba = seg_color.get(segment) or seg_color.get(short(model.body(b).name)) or [0.7, 0.7, 0.7, 1.0]
        geoms.append(
            {
                "segment": segment,
                "body": index_of[b],
                "pos": [round(float(v), 6) for v in model.geom_pos[g]],
                "quat": [round(float(v), 6) for v in model.geom_quat[g]],
                "rgba": rgba,
                "vertOffset": vert_offset,
                "vertCount": vn,
                "indexOffset": index_offset,
                "indexCount": fn * 3,
                "quantOrigin": [float(v) for v in lo],
                "quantScale": [float(v) for v in scale],
            }
        )

    # ---- (leg, dof) -> joint map for the 42 actuated DoFs ----
    leg_dof_joint = [[None] * 7 for _ in range(6)]
    legs = list(PreprogrammedSteps.legs)
    for a in range(model.nu):
        if model.actuator_trntype[a] != mj.mjtTrn.mjTRN_JOINT:
            continue
        j = int(model.actuator_trnid[a][0])
        leg, dof = game._parse_actuator_joint(short(model.joint(j).name))
        if leg is not None and dof is not None:
            leg_dof_joint[legs.index(leg)][dof] = joint_index[j]
    assert all(all(x is not None for x in row) for row in leg_dof_joint), "unmapped actuated DoF"

    # ---- ground offset: lowest foot in the neutral pose touches z = 0 ----
    root_z = float(data.xpos[root][2])
    foot_z = min(float(data.xpos[b][2]) for b in fly_bodies if short(model.body(b).name).endswith("tarsus5"))

    # ---- baked preprogrammed steps (the game builder's own baking, resampled) ----
    game.N_PHASE_SAMPLES = N_PHASE_SAMPLES
    steps = game.bake_preprogrammed_steps()
    for leg in steps["legs"].values():
        leg["angles"] = [[round(v, 5) for v in row] for row in leg["angles"]]
        leg["neutral"] = [round(v, 5) for v in leg["neutral"]]

    fixture = fk_fixture(model, fly_bodies, joint_index)
    walking = calibrate_walking(model)

    rig = {
        "fkFixture": fixture,
        "source": "NeuroMechFly v2 via flygym (legs-only position-actuated model, as in wasm/game)",
        "units": "mm",
        "rootHeight": round(root_z - foot_z, 5),
        "walking": walking,
        "bodies": bodies,
        "joints": joints,
        "geoms": geoms,
        "legOrder": legs,
        "dofsPerLeg": [list(map(str, d)) for d in PreprogrammedSteps.dofs_per_leg],
        "legDofJoint": leg_dof_joint,
        "cpg": {
            "intrinsicFreq": CPG_INTRINSIC_FREQ,
            "intrinsicAmp": CPG_INTRINSIC_AMP,
            "convergenceCoef": CPG_CONVERGENCE_COEF,
            "couplingWeights": (game._tripod_phase_biases > 0).astype(float).__mul__(CPG_COUPLING_STRENGTH).tolist(),
            "phaseBiases": game._tripod_phase_biases.tolist(),
        },
        "preprogrammed": steps,
    }
    return rig, bytes(blob)


def calibrate_walking(model: mj.MjModel, duration: float = 1.5, settle: float = 0.5) -> dict:
    """Walk the model in MuJoCo physics under flygym's CPG and measure the gait.

    Same controller as the in-repo browser game / tutorial 4a-4d: tripod CPG at
    12 Hz, PreprogrammedSteps joint targets, adhesion on in stance. Returns the
    mean thorax height and pitch, speed per CPG amplitude and the yaw rate per
    unit of (right - left) amplitude.
    """
    game = _load_game_builder()
    steps = PreprogrammedSteps()
    legs = list(steps.legs)
    cmap = [[None] * 7 for _ in range(6)]
    adhesion = [None] * 6
    for a in range(model.nu):
        if model.actuator_trntype[a] == mj.mjtTrn.mjTRN_BODY:
            leg = short(model.body(int(model.actuator_trnid[a][0])).name).split("_")[0]
            adhesion[legs.index(leg)] = a
            continue
        leg, d = game._parse_actuator_joint(short(model.joint(int(model.actuator_trnid[a][0])).name))
        if leg is not None and d is not None:
            cmap[legs.index(leg)][d] = a
    pb = game._tripod_phase_biases
    w = (pb > 0) * CPG_COUPLING_STRENGTH
    data = mj.MjData(model)
    dt = model.opt.timestep

    def walk(gain_left: float, gain_right: float) -> dict:
        mj.mj_resetDataKeyframe(model, data, 0)
        rng = np.random.default_rng(0)
        phases = rng.uniform(0, 2 * np.pi, 6)
        mags = np.zeros(6)
        amps = np.array([abs(gain_left)] * 3 + [abs(gain_right)] * 3) * CPG_INTRINSIC_AMP
        freqs = CPG_INTRINSIC_FREQ * np.array(
            [1 if gain_left >= 0 else -1] * 3 + [1 if gain_right >= 0 else -1] * 3
        )
        zs, pitches, xys, yaws = [], [], [], []
        for k in range(int(duration / dt)):
            coupling = (mags[None, :] * w * np.sin(phases[None, :] - phases[:, None] - pb)).sum(1)
            phases += (2 * np.pi * freqs + coupling) * dt
            mags += CPG_CONVERGENCE_COEF * (amps - mags) * dt
            for i, leg in enumerate(legs):
                angles = steps.get_joint_angles(leg, phases[i], mags[i])
                for d in range(7):
                    data.ctrl[cmap[i][d]] = angles[d]
                data.ctrl[adhesion[i]] = 1.0 if steps.get_adhesion_onoff(leg, phases[i]) else 0.0
            mj.mj_step(model, data)
            if k * dt >= settle and k % 20 == 0:
                qw, qx, qy, qz = data.qpos[3:7]
                pitches.append(np.arcsin(np.clip(2 * (qw * qy - qz * qx), -1, 1)))
                yaws.append(np.arctan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz)))
                zs.append(float(data.qpos[2]))
                xys.append(data.qpos[:2].copy())
        span = (len(xys) - 1) * 20 * dt
        heading = np.unwrap(yaws)
        disp = xys[-1] - xys[0]
        # signed speed along the mean heading (negative when stepping backward)
        fwd = np.array([np.cos(heading.mean()), np.sin(heading.mean())])
        return {
            "z": float(np.mean(zs)),
            "pitch": float(np.mean(pitches)),
            "speed": float(disp @ fwd / span),
            "yaw": float((heading[-1] - heading[0]) / span),
        }

    amps = [0.25, 0.5, 0.75, 1.0]
    straight = [walk(a, a) for a in amps]
    turns = [(walk(1.0, r), 1.0 - r) for r in (0.6, 0.2)]
    for a, r in zip(amps, straight):
        print(f"  physics walk amp {a:.2f}: {r['speed']:.2f} mm/s, thorax z {r['z']:.3f} mm")
    yaw_per_diff = float(np.mean([t["yaw"] / diff for t, diff in turns]))
    print(f"  physics turn: yaw {yaw_per_diff:.3f} rad/s per unit (L - R) amplitude")
    return {
        "thoraxHeight": round(float(np.mean([r["z"] for r in straight])), 4),
        "pitch": round(float(np.mean([r["pitch"] for r in straight])), 5),
        "speedByAmp": {"amp": [0.0, *amps], "mmPerS": [0.0, *[round(r["speed"], 4) for r in straight]]},
        # MuJoCo frame (z up, y left): positive yaw = counter-clockwise from above
        "yawPerAmpDiff": round(yaw_per_diff, 5),
    }


def fk_fixture(model: mj.MjModel, fly_bodies: list[int], joint_index: dict[int, int]) -> dict:
    """MuJoCo's own forward kinematics at a random pose, for the JS unit test.

    Hinge angles are the neutral keyframe plus seeded noise; body positions are
    expressed in the root (thorax) frame, which is what the JS rig computes.
    """
    rng = np.random.default_rng(44)
    data = mj.MjData(model)
    mj.mj_resetDataKeyframe(model, data, 0)
    angles = [0.0] * len(joint_index)
    for j, ji in joint_index.items():
        adr = int(model.jnt_qposadr[j])
        data.qpos[adr] += rng.uniform(-0.6, 0.6)
        angles[ji] = float(data.qpos[adr])
    mj.mj_kinematics(model, data)
    root = fly_bodies[0]
    r_root = data.xmat[root].reshape(3, 3)
    positions = [
        [round(float(v), 7) for v in r_root.T @ (data.xpos[b] - data.xpos[root])] for b in fly_bodies
    ]
    return {"angles": [round(a, 9) for a in angles], "bodyPositions": positions}


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Composing + compiling NeuroMechFly ...")
    model = compile_model()
    rig, blob = bake(model)
    (OUT_DIR / "rig.json").write_text(json.dumps(rig, separators=(",", ":")))
    (OUT_DIR / "meshes.bin").write_bytes(blob)
    print(
        f"Done -> {OUT_DIR.relative_to(REPO_ROOT)}: {len(rig['bodies'])} bodies, "
        f"{len(rig['joints'])} hinge joints, {len(rig['geoms'])} meshes, "
        f"rig.json {(OUT_DIR / 'rig.json').stat().st_size / 1e3:.0f} kB, "
        f"meshes.bin {len(blob) / 1e6:.2f} MB, root height {rig['rootHeight']:.3f} mm"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
