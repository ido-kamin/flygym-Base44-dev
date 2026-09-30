# Fly Neural Sandbox

A browser game built with React, Tailwind CSS and Three.js. A virtual fruit fly hunts sugar and dodges spiders. Its behaviour comes entirely from a small Sensory → Intrinsic → Motor connectome, and a 24-bit genome sets the strength of that connectome's connections. Next to the playground, 139,255 neurons fire in 3D: reward (dopamine) waves when it eats, fear waves when a spider strikes. The whole fly is serialized into a 10-character, URL-safe **Base44** DNA string in the page hash, so a shared link respawns the same fly.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # vitest: codec, genome, game, geometry
npm run build    # static site in dist/ (relative paths, host anywhere)
```

## How to play

| Action | How |
|---|---|
| Feed the fly | click the playground to drop sugar |
| **Spawn Predator** | arm the button (or press <kbd>P</kbd>), then click to drop spiders (max 8) |
| **Mutate Brain DNA** | the button or <kbd>M</kbd> shifts 1–2 genes by ±1–4 levels |
| Restart | <kbd>R</kbd> keeps the same genome and resets score and energy |
| **Copy Viral DNA Link** | copies `Look at my Super Fly! Score: X. Can you beat its DNA? <link>` |
| Orbit the brain | drag, scroll to zoom, and hover to name a neuropil |

- **Eating**: each sugar is worth +1 score, plus energy that scales with the Dopamine-gain gene.
- **Energy drain**: energy runs down with a baseline cost plus a speed² cost, so a fast fly starves faster.
- **Game over**: when energy hits 0 the fly has starved.
- **Generation**: the level is `1 + ⌊√(score/5)⌋`.

## The connectome drives the fly

Each fixed 1/120 s step (`src/lib/game.js`) goes through three stages.

1. **Sense**:
   - Two antennae sample the sugar odour field, and the antennal lobes normalize them into a left/right contrast.
   - Two eyes sample looming predators and nearby walls.
2. **Think**: 16 neuropil clusters integrate these inputs (`src/lib/connectome.js`). Each cluster integrates toward `tanh(drive)` over a leak time constant τ. When a cluster crosses threshold it fires, and a pulse travels down each outgoing tract. That delayed message passing is what you see in 3D.
3. **Act**: the motor command is read out Braitenberg-style.
   - **Turn** comes from the left/right mushroom-body contrast (toward food) and the left/right lateral-horn contrast (away from threats). The central-complex steering gain scales it.
   - **Speed** comes from descending-neuron activity. Big threats trigger a giant-fiber escape burst.

The six genes scale these edges, so they genuinely change behaviour; `game.test.js` checks that a high sugar drive forages better than a low one.

| # | Gene | Edge | Effect |
|---|---|---|---|
| 0 | Sugar drive | AL → MB | steering up the odour gradient |
| 1 | Threat reflex | OL → LH | veering away from spiders and walls |
| 2 | Dopamine gain | SEZ → PAM → MB | energy per sugar, size of the reward wave |
| 3 | Steering precision | PROTO → CX → DN | turning gain |
| 4 | Locomotor drive | PROTO → DN | top speed, and metabolic cost |
| 5 | Chaos loop | CX ↺ PROTO | erratic exploration noise |

## Base44 DNA

- **Alphabet**: `0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjk`. It has 44 symbols, no `+ / = ?`, and no look-alike I/O/i/l.
- **Payload**: 48 bits, MSB first:

| Bits | Field | Detail |
|---|---|---|
| 24 | neural weights | 6 genes × 4 bits |
| 12 | score | 0–4095, clamped |
| 4 + 4 | x, y | cell on a 16 × 16 arena grid |
| 4 | heading | 16 sectors of 22.5° |

- **Encoding**: 9 base-44 digits (44⁹ ≈ 6.2·10¹⁴ > 2⁴⁸) plus 1 checksum digit, giving 10 characters, for example `#dna=D8HR0T6Ncc`.
  - The checksum weights are coprime with 44, so any single mistyped character is rejected.
- **Decoding** puts the fly at the centre of its grid cell with the stored heading, genome and score. A decoded fly therefore re-encodes to exactly the same string (`encode(decode(s)) === s`), and the game pauses for about 1.4 s after decoding so you can see the restored state.
- **What the DNA leaves out**:
  - Energy is not stored, so it restarts at full.
  - Generation is derived from score.
  - The DNA string also seeds the food layout.
- **Hash updates**: the hash is rewritten with `history.replaceState` at 2 Hz. Safari limits it to 100 calls per 30 s, and replacing rather than pushing keeps the history clean. Pasting a new link into the address bar loads it live.

Code: `src/lib/base44.js` (`encodeFlyToBase44`, `decodeFlyFromBase44`, `packDNA`, `unpackDNA`).

## Rendering

- **Brain** (`brainGeometry.js`, `brainShaders.js`, `brainRenderer.js`): one `THREE.Points` draw call of 139,255 neurons with every neuron animated in the vertex shader. It combines:
  - 3D simplex noise for spontaneous firing;
  - per-neuron spike flicker;
  - cluster activity;
  - up to 12 expanding wave-front shells.

  The CPU uploads only about 100 uniforms per frame. Axon tracts are `LineSegments` bundles with travelling pulse packets. Post-processing is UnrealBloom plus ACES tone mapping. On slow GPUs the renderer drops to pixel ratio 1.
- **Playground** (`drawPlayground.js`): Canvas2D.
  - The fly has a tripod-gait leg animation, hex-faceted compound eyes and buzzing wings.
  - Spiders have gait and threat rings.
  - Antenna and eye sensory rays are drawn, and the fly's current DNA grid cell is highlighted.

**Honesty note**: neuron positions are *procedural*. They are shapes placed where the real neuropils are, with the FlyWire whole-brain neuron count, and they are not FlyWire morphology. The 16-cluster network is a didactic rate model, not the real synaptic connectome.

## Layout

```
src/
  FlyNeuralSandbox.jsx   game component: engine refs, rAF loop, hash binding, actions
  components/            TopHud, DnaPanel, ActionBar, BrainView, Playground, Overlays
  lib/
    base44.js            DNA codec (pure)
    genome.js            genes, mutation, personality, PRNG (pure)
    connectome.js        16-cluster network + motor readout (pure)
    game.js              deterministic world: fly, sugar, predators, energy (pure)
    brainGeometry.js     seeded procedural anatomy + tracts (pure)
    brainShaders.js      GLSL
    brainRenderer.js     Three.js scene
    drawPlayground.js    Canvas2D renderer
```
