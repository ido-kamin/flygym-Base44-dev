# Fly Neural Sandbox

A browser game built with React, Tailwind CSS and Three.js. A virtual fruit fly hunts sugar (or, in the **Vibecode · Base** theme, `[Compile]` `[Audit]` `[Mint]` `[Deploy]` `[Base]` tokens) and dodges spiders. Its behaviour comes entirely from a small Sensory → Intrinsic → Motor connectome, and a 24-bit genome sets the strength of that connectome's connections.

Three linked views:
- **Brain:** 139,255 brain neurons (FlyWire) and 22,300 nerve-cord neurons (MANC) fire in 3D. Reward (dopamine) waves fire when the fly eats, and fear waves when a spider strikes.
- **Body:** the real **NeuroMechFly v2** body from this repo walks with flygym's CPG, and its legs glow with the nerve-cord neuromeres that drive them.
- **Playground:** the 2D arena (a fly-driven browser in the Vibecode theme).

The whole fly is serialized into a 10-character, URL-safe **Base44** DNA string in the page hash, so a shared link respawns the same fly.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # vitest: codec, genome, game, geometry, NeuroMechFly FK/CPG, FlyCoin EVM deploy
npm run build    # static site in dist/ (relative paths, host anywhere)

# regenerate baked assets (only when the model / contract changes)
uv run python web/fly-neural-sandbox/scripts/bake_neuromechfly.py   # from the repo root; needs the flygym env
npm run compile:contract                                            # contracts/FlyCoin.sol -> src/lib/flycoin.artifact.json
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

## The NeuroMechFly body (how accurate is it?)

`scripts/bake_neuromechfly.py` composes the same legs-only, position-actuated NeuroMechFly as the in-repo browser game (`scripts/dev/build_wasm_game_assets.py`), compiles it with MuJoCo and bakes it into `public/neuromechfly/` (about 1.1 MB): 68 bodies, 66 hinge joints and 69 meshes. It reuses that script's own `PreprogrammedSteps` baking and segment colours.

**In the browser** (`src/lib/neuromechfly.js`, `flyBody3D.js`):
- **Forward kinematics** ports MuJoCo's hinge convention. A test checks it against MuJoCo's `mj_kinematics` at a random pose: all bodies agree to < 1 nm.
- **CPG** is flygym's defaults from tutorial 4a: 12 Hz, amplitude 1, coupling 10, convergence 20, tripod phase biases. Tests check that it locks LF/RM/LH in phase against RF/LM/RH, at 12 Hz.
- **Legs** play the baked `PreprogrammedSteps` cycles at the CPG phase, scaled by the CPG magnitude, 42 actuated DoFs in total. Swing and stance follow flygym's swing periods.
- **Turning** uses the two-value descending signal from tutorial 4d: the inner side's amplitude is reduced, and reversed on sharp turns. The signal comes from the connectome's motor readout.

**Physics calibration.** The body is animated kinematically, so the bake also walks the model in MuJoCo physics with the same controller and adhesion. From that run it bakes the thorax height (≈1.13 mm), body pitch, forward speed against CPG amplitude (3.3 / 5.9 / 9.4 / 13.1 mm/s at 0.25 / 0.5 / 0.75 / 1) and yaw rate against left/right asymmetry. The view moves the fly with those measured numbers, not guesses.

**Neural coupling:**
- Legs glow with their neuromere: T1 for the front legs, T2 for the middle legs and wings, T3 for the hind legs and halteres.
- The eyes glow with the optic lobes, the antennae with the antennal lobes, and the proboscis with the SEZ.
- Each VNC neuromere's activity in the 3D brain bursts with its legs' swing phase, because the locomotor CPGs sit in the VNC.
- A leg flashes during its swing phase.

## Neuron counts

Positions are procedural, but every region's count comes from the published FlyWire annotations (Schlegel et al. 2024, grouped by `super_class`/`cell_class`; see `REGION_COUNTS` in `brainGeometry.js`):

| Region | Neurons | Contents |
|---|---|---|
| Optic lobes | 97,494 | optic-lobe intrinsic, visual projection, visual centrifugal and photoreceptor neurons |
| Antennal lobes | 3,614 | |
| Mushroom bodies | 5,277 | 5,177 Kenyon cells |
| Lateral horn | 556 | |
| Central complex | 3,025 | |
| PAM | 307 | |
| SEZ | 3,241 | |
| Neck connective | 3,665 | 1,303 descending, 2,362 ascending |
| Other central brain | 22,076 | |
| **Brain total** | **139,255** | |
| VNC | 22,300 | MANC; the split across neuromeres is approximate |

FlyWire data is CC BY-NC 4.0, so this app ships only these published counts. Real FlyWire neuron coordinates could be baked in, but only with FlyWire's permission for the intended (commercial) use.

## Vibecode · Base theme

Toggle it in the top bar. A shared link carries `&mode=vibe`.

- **Tokens:** food becomes pipeline tokens. Collecting `Compile → Audit → Mint → Deploy → Base` in order is a (simulated) deployment. Tokens taken out of order are "merge conflicts".
- **FlyCode terminal:** streams glitchy pseudo-Solidity, one line per leg step, taken from the 3D body's swing onsets. Its header, `contract FlyCoin_<DNA>`, is compiled deterministically from the DNA fields, so the Base44 string is the "bytecode". How glitchy it looks follows the chaos gene and central-complex activity.
- **Fly status:** a sarcastic line picked from brain and body state (`src/lib/flycode.js`). Examples: erratic brain gives "hallucinating a new Layer 3…", a cornered fly gives "waiting for a VC funding round", and a completed deployment gives "deployed an ERC-20 … using pure muscle memory".
- **DNA panel:** rebranded **Fly's Compiled Bytecode**.

## Build this fly's app on Base44

`src/lib/base44App.js` turns the DNA into an app prompt, deterministically: the genome picks the app concept and the strongest genes become its features. The button opens the Base44 builder with `?prompt=` and copies the prompt to the clipboard.

- **Unverified prefill:** `?prompt=` is not publicly documented. If the builder ignores it, the user pastes the prompt.
- **Why a click:** browsers only allow `window.open` from a user gesture, and a page cannot script base44.com. So the fly drives the in-page browser, and a human click hands the app to Base44.
- **Server-side option:** creating apps through the Base44 Platform API (`POST /api/apps`) needs an access token and spends that workspace's credits, so it belongs in a backend function, not in visitors' browsers.

## Claim Fly's Deployment (optional, testnet by default)

It deploys `contracts/FlyCoin.sol` from the visitor's own wallet over EIP-1193 (Coinbase Wallet, MetaMask, …).
- The contract is a fixed-supply ERC-20 with no owner, mint or sale logic, and an immutable `dna` string.
- It targets **Base Sepolia** (chainId 84532). Base mainnet (8453) appears only in builds made with `VITE_ALLOW_BASE_MAINNET=true`; get legal and brand review before enabling it.
- The flow is `eth_requestAccounts`, then `wallet_switchEthereumChain` (falling back to `wallet_addEthereumChain`), then a contract-creation `eth_sendTransaction`, then polling for the receipt.
- Smart-contract wallets such as Coinbase Smart Wallet cannot `CREATE` this way, and the UI says so when that happens.
- The artifact is compiled with solc 0.8.37 for the cancun EVM. `baseDeploy.test.js` deploys it in a real EVM (`@ethereumjs/vm`) and reads back `name`, `symbol`, `dna`, `totalSupply` and the deployer's balance.

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

**Honesty note**: neuron positions are *procedural*. They are shapes placed where the real neuropils are, with FlyWire's per-region neuron counts, and they are not FlyWire morphology. The 16-cluster network is a didactic rate model, not the real synaptic connectome. Running a real FlyWire leaky integrate-and-fire (LIF) brain in the browser is feasible: open-source Web Worker and WebGPU ports exist. It would be the next step, subject to FlyWire's licence.

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
