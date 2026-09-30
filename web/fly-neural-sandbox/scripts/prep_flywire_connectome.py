"""Pack the FlyWire v783 whole-brain connectome for the in-browser LIF brain.

Inputs:
- the Shiu et al. 2024 model data (https://github.com/philshiu/Drosophila_brain_model,
  MIT code; data derived from FlyWire): `Completeness_783.csv` (neuron order)
  and `Connectivity_783.parquet` (signed synapse counts, "Excitatory x Connectivity").
- the FlyWire annotation table (Schlegel et al. 2024,
  https://github.com/flyconnectome/flywire_annotations,
  `Supplemental_file1_neuron_annotations.tsv`) for classes, cell types and sides.

Output: `public/connectome/flywire783.bin.gz` (gzip; browsers inflate it with
DecompressionStream):

    magic "FWC2" | uint32 header_len | header JSON (utf-8) | pad to 4 | payload
    payload = offsets  Uint32[n + 1]   CSR row pointers by presynaptic neuron
              cluster  Uint8[n]        which of the 16 game clusters the neuron belongs to
              side     Uint8[n]        0 left, 1 right, 2 center/unknown
              edges    varint stream   per row, targets sorted: delta(post), zigzag(weight)

`weight` is the signed synapse count (excitatory > 0, inhibitory GABA/Glu < 0),
exactly the model's `Excitatory x Connectivity`. Connections weaker than
`--min-synapses` are dropped to keep the file browser-sized.

The header names the neuron groups the game reads and writes (photoreceptors,
sugar-taste, olfactory and looming sensory neurons; steering / walking / escape
descending neurons; brain motor neurons).

NOTE: FlyWire data is licensed CC BY-NC 4.0; see the README. Run with:

    uv run --with pandas --with pyarrow python web/fly-neural-sandbox/scripts/prep_flywire_connectome.py \\
        --model-dir /path/to/Drosophila_brain_model --annotations /path/to/neuron_annotations.tsv
"""

from __future__ import annotations

import argparse
import gzip
import json
import struct
from pathlib import Path

import numpy as np
import pandas as pd

OUT_DIR = Path(__file__).resolve().parents[1] / "public" / "connectome"

# game clusters (src/lib/connectome.js CLUSTERS order)
C = {
    k: i
    for i, k in enumerate(
        [
            "OL_L",
            "OL_R",
            "AL_L",
            "AL_R",
            "MB_L",
            "MB_R",
            "LH_L",
            "LH_R",
            "CX",
            "PROTO",
            "PAM",
            "SEZ",
            "DN",
            "T1",
            "T2",
            "T3",
        ]
    )
}


def encode_varints(values: np.ndarray) -> bytes:
    """LEB128-encode non-negative integers (vectorized, 7 bits per byte)."""
    v = values.astype(np.uint64)
    nbytes = np.ones(len(v), dtype=np.int64)
    t = v >> np.uint64(7)
    while np.any(t):
        nbytes += t > 0
        t >>= np.uint64(7)
    out = np.zeros(int(nbytes.sum()), dtype=np.uint8)
    pos = np.r_[0, np.cumsum(nbytes)[:-1]]
    cur = v.copy()
    for k in range(int(nbytes.max())):
        live = nbytes > k
        byte = (cur[live] & np.uint64(0x7F)).astype(np.uint8)
        more = nbytes[live] > k + 1
        out[pos[live] + k] = byte | (more.astype(np.uint8) << 7)
        cur[live] >>= np.uint64(7)
    return out.tobytes()


def cluster_of(row) -> int:
    sc, cc, ct, side = row.super_class, row.cell_class, row.cell_type, row.side
    right = side == "right"
    if sc in ("optic", "visual_projection", "visual_centrifugal") or (
        sc == "sensory" and cc == "visual"
    ):
        return C["OL_R"] if right else C["OL_L"]
    if (
        sc == "sensory" and cc in ("olfactory", "hygrosensory", "thermosensory")
    ) or cc in ("ALPN", "ALLN", "ALIN", "ALON", "mAL"):
        return C["AL_R"] if right else C["AL_L"]
    if cc in ("Kenyon_Cell", "MBON", "MBIN"):
        return C["MB_R"] if right else C["MB_L"]
    if cc in ("LHLN", "LHCENT"):
        return C["LH_R"] if right else C["LH_L"]
    if cc in ("CX", "TuBu"):
        return C["CX"]
    if isinstance(ct, str) and ct.startswith("PAM"):
        return C["PAM"]
    if sc == "sensory" or sc == "motor":
        return C["SEZ"]
    if sc in ("descending", "ascending", "sensory_ascending"):
        return C["DN"]
    return C["PROTO"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", type=Path, required=True)
    ap.add_argument("--annotations", type=Path, required=True)
    # 5 synapses is FlyWire's standard threshold for a "connection" (Dorkenwald et al. 2024)
    ap.add_argument("--min-synapses", type=int, default=5)
    ap.add_argument("--out", type=Path, default=OUT_DIR / "flywire783.bin.gz")
    args = ap.parse_args()

    comp = pd.read_csv(args.model_dir / "Completeness_783.csv", index_col=0)
    ids = comp.index.values.astype(np.int64)
    n = len(ids)
    con = pd.read_parquet(
        args.model_dir / "Connectivity_783.parquet",
        columns=[
            "Presynaptic_Index",
            "Postsynaptic_Index",
            "Connectivity",
            "Excitatory x Connectivity",
        ],
    )
    con = con[con["Connectivity"] >= args.min_synapses]
    pre = con["Presynaptic_Index"].to_numpy(np.int64)
    post = con["Postsynaptic_Index"].to_numpy(np.int64)
    w = con["Excitatory x Connectivity"].to_numpy(np.int64)
    order = np.lexsort((post, pre))  # by presynaptic row, then target
    pre, post, w = pre[order], post[order], w[order]
    offsets = np.zeros(n + 1, dtype=np.uint32)
    np.add.at(offsets, pre + 1, 1)
    offsets = np.cumsum(offsets, dtype=np.uint64).astype(np.uint32)
    # delta-encode targets within each row (first delta is absolute), zigzag weights
    delta = post.copy()
    same_row = np.r_[False, pre[1:] == pre[:-1]]
    delta[same_row] = post[same_row] - post[np.flatnonzero(same_row) - 1]
    zig = np.where(w >= 0, 2 * w, -2 * w - 1)
    edges = encode_varints(np.column_stack([delta, zig]).ravel())

    ann = pd.read_csv(
        args.annotations,
        sep="\t",
        usecols=[
            "root_id",
            "super_class",
            "cell_class",
            "cell_sub_class",
            "cell_type",
            "side",
        ],
        dtype=str,
    )
    ann["root_id"] = ann["root_id"].astype(np.int64)
    m = ann.drop_duplicates("root_id").set_index("root_id").reindex(ids)
    m["side"] = m["side"].fillna("na")
    cluster = np.array([cluster_of(r) for r in m.itertuples()], dtype=np.uint8)
    side = np.where(
        m["side"].values == "left", 0, np.where(m["side"].values == "right", 1, 2)
    ).astype(np.uint8)

    def idx(mask) -> list[int]:
        return [int(i) for i in np.flatnonzero(mask)]

    def by_side(mask) -> dict:
        return {"L": idx(mask & (side == 0)), "R": idx(mask & (side == 1))}

    ct = m["cell_type"].fillna("")
    cc = m["cell_class"].fillna("")
    sub = m["cell_sub_class"].fillna("")
    groups = {
        # sensory inputs the game drives
        "sugar": by_side(
            (cc == "gustatory").values & sub.isin(["sugar", "sugar/low_salt"]).values
        ),
        "olfactory": by_side((cc == "olfactory").values),
        "looming": by_side(ct.isin(["LPLC2", "LC4"]).values),
        "photoreceptor": by_side(
            ct.isin(["R1-6", "R7", "R8"]).values
        ),  # compound-eye photoreceptors
        "bitter": by_side((cc == "gustatory").values & (sub == "bitter").values),
        "mechano": by_side((cc == "mechanosensory").values),
        # motor readouts
        "steer": by_side((ct == "DNa02").values),  # turning (Rayshubskiy et al.)
        "steer2": by_side((ct == "DNa01").values),
        "walk": by_side((ct == "DNp09").values),  # forward walking (Bidaye et al. 2020)
        "escape": by_side((ct == "DNp01").values),  # giant fiber
        "groom": by_side(ct.isin(["DNg11", "DNg12_a"]).values),
        "feed": {
            "all": idx((m["super_class"] == "motor").values)
        },  # brain motor neurons (proboscis, pharynx...)
        "dopamine": {"all": idx(ct.str.startswith("PAM").values)},
    }

    header = {
        "source": "FlyWire v783 via Shiu et al. 2024 model data; annotations Schlegel et al. 2024",
        "license": "FlyWire data: CC BY-NC 4.0 (https://flywire.ai/guidelines). Model code: MIT.",
        "n": int(n),
        "nnz": int(offsets[-1]),
        "minSynapses": args.min_synapses,
        "encoding": "varint(delta post), varint(zigzag weight) per edge; rows sorted by post",
        "params": {  # Shiu et al. 2024 default_params
            "v0": -52.0,
            "vReset": -52.0,
            "vTh": -45.0,
            "tauM": 20.0,
            "tauSyn": 5.0,
            "tRef": 2.2,
            "delay": 1.8,
            "wSyn": 0.275,
            "poissonWeight": 0.275 * 250,
        },
        "groups": groups,
        "clusterCounts": np.bincount(cluster, minlength=16).tolist(),
    }
    hjson = json.dumps(header, separators=(",", ":")).encode()
    out = args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    pad = (-(8 + len(hjson))) % 4
    raw = b"".join(
        [
            b"FWC2",
            struct.pack("<I", len(hjson)),
            hjson,
            b"\0" * pad,
            offsets.tobytes(),
            cluster.tobytes(),
            side.tobytes(),
            edges,
        ]
    )
    out.write_bytes(gzip.compress(raw, compresslevel=9))
    gz = out.stat().st_size
    print(
        f"n={n} nnz={int(offsets[-1]):,} (>= {args.min_synapses} synapses) -> {out.name} {len(raw) / 1e6:.1f} MB raw "
        f"({gz / 1e6:.1f} MB gzip); groups: "
        + ", ".join(f"{k}={sum(len(v) for v in g.values())}" for k, g in groups.items())
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
