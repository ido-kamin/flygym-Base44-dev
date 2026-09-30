# Fly Neural Sandbox

A browser game built with React, Tailwind CSS and Three.js. A virtual fruit fly roams an arena on its own, hunts sugar (or mission tokens: Base44 builder tasks, web results, `[Compile]` `[Audit]` `[Mint]` `[Deploy]` `[Base]`) and escapes spiders. It is driven by the **whole FlyWire brain** (138,639 neurons, simulated live in a Web Worker) plus a small genome-controlled Sensory → Intrinsic → Motor model that gives each fly its personality.

Three linked views:
- **World (hero):** the real **NeuroMechFly v2** body from this repo walks a 3D arena with flygym's CPG, at the game's position and heading. Its survival programs show on the body: a giant-fiber escape jump, stopping to feed, rubbing its front legs to groom.
- **Brain:** each of the 139,255 brain points is lit by the live firing rate of a real FlyWire neuron of its region; 22,300 nerve-cord points (MANC) follow the legs' CPG. The panel shows spikes/s, active neurons, the real-time factor and the descending-neuron readouts.
- **Mission map:** the top-down arena inside a small fly-driven browser window.

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

## The real brain (FlyWire v783, LIF), running on Base44

`public/connectome/flywire783.bin.gz` (8.5 MB) packs the FlyWire v783 connectome as used by Shiu et al. 2024: 138,639 neurons and 2.69M connections of 5 or more synapses (FlyWire's standard threshold) with signed synapse counts, every neuron's soma position, and 22 identified neurons (with their FlyWire root IDs) for the live raster. `scripts/prep_flywire_connectome.py` builds it from the model's `Completeness_783.csv` / `Connectivity_783.parquet` and the FlyWire annotation table.

`src/lib/lifBrain.js` integrates the published leaky integrate-and-fire model (v0 −52 mV, threshold −45 mV, τm 20 ms, τsyn 5 ms, 2.2 ms refractory, 1.8 ms delay, 0.275 mV per synapse, Poisson inputs of 250 × w) with forward Euler at 1 ms, event-driven (only neurons with input or not yet at rest are updated). A unit test checks it against a dense integration of the same equations.

**Where it runs.** `server/brainHost.mjs` gives every visitor their own brain in a Node worker thread on the Base44 container (up to CPUs − 1 at once; the connectome is parsed once and shared), streamed over a WebSocket (`/api/brain`): the page sends senses and controls, the server sends spikes, rates, per-neuron activity and the descending-neuron readouts. When all slots are taken (or on static hosting) the same code (`src/lib/brainSession.js`) runs in a Web Worker in the browser, and the page says so.

**Transmitter corrections.** The published model signs synapses by FlyWire's *predicted* transmitter. With those signs any smell or taste ignites a self-sustaining antennal-lobe / mushroom-body loop (≈ 480k spikes/s, with 60% of Kenyon cells firing; the same on the full, unthresholded graph). Three corrections from the annotation table fix it: experimentally known transmitters (`known_nt`) override predictions (80k neurons; e.g. photoreceptors are histaminergic), AL local neurons without a known transmitter are GABAergic (85), and the chemical synapses of cholinergic AL local neurons, which act mainly through gap junctions, are left out (46). Now an odour activates ~50–120 Kenyon cells (a sparse code, as in vivo), sugar drives the feeding motor neurons without ignition, and the brain returns to rest by itself.

| The fly senses | Sensory neurons (Poisson drive) |
|---|---|
| light and image motion on each eye | R1-6 / R7 / R8 photoreceptors, 6–30 Hz |
| a spider looming on the left / right | LPLC2 + LC4, up to 140 Hz |
| bumping into a wall | mechanosensory neurons, 60 Hz |
| sugar on the proboscis | sugar GRNs, 200 Hz (a 0.4 s trial) |
| a new scent | ORNs of one antenna, 30 Hz (a 0.25 s trial) |

| Descending / motor neurons | Behaviour |
|---|---|
| DNp09 (walk command) | forward walking, speed ∝ rate (60 Hz = full) |
| DNa02 (+ DNa01) right − left | turning |
| DNp01 (giant fiber) > 40 Hz | escape jump away from the leading side |
| brain motor neurons > 5 Hz | keep feeding |
| DNg11 / DNg12_a > 12 Hz | groom |

**Lifelike hybrid (default for Sandbox and Training).** An explicit behavioral controller blends local food targeting, short walking bouts and pauses, anticipatory wall avoidance, and brief escape pivots with live neural steering transients, walk drive, learned odour responses, and brain-triggered escape/grooming. This assistance is not claimed to emerge from the connectome: it can move without a connected brain and continues when neurons are silenced. A separate seeded controller keeps tests reproducible. Build missions keep the existing Autopilot; all three movement sources remain selectable. Regression checks live in `src/lib/hybridBehavior.test.js`.

**Neurons only (optional).** The body moves only from those descending neurons: no genome model, no noise, no scripted instincts; without a brain the fly stands still. The player drives the neurons like an optogenetics experiment: *Explore* stimulates DNp09 (Bidaye et al. 2020), holding A / D stimulates DNa02 left / right (Rayshubskiy et al. 2020), *Reward* (E) pulses dopamine into the PAM neurons, and *Silence* lesions a group (giant fibers, steering, walk command, motor neurons, sugar neurons): silence DNp01 and the fly no longer escapes a spider. *Autopilot* adds the 16-region genome model's steering toward food and tasks for the missions.

**Learning.** Dopamine-gated plasticity at the Kenyon cell → MBON synapses of the mushroom body (Hige et al. 2015; Cohn et al. 2015): while PAM dopamine neurons fire, the KC→MBON synapses of Kenyon cells that fired in the same trial are depressed, in the compartments of the MBONs those DANs synapse onto (dopamine acts only through this rule, not as fast excitation). The *Learning* tab runs the classic experiment on the fly's own brain: odour A (glomerulus DM4) and B (VA2) are tested, A is paired with dopamine three times, and both are tested again. A's KC→MBON drive drops by ~40–50%, B's by under 10%.

**Proof.** The *Is it real?* tab shows where the brain runs (host, CPUs, the share of a core this brain uses, spikes computed), the live chain from descending-neuron rates to the body's speed and turning, a spike raster of 22 identified neurons (links to FlyWire Codex by root ID), and a self-test (`GET /api/brain/selftest`) that runs the published circuits on fresh brains on the server: looming left / right (giant fibers, steering away), the DNp01 lesion, sugar → feeding, light → optic lobes, and the odour-specific learning, with the measured numbers.

**3D.** Each brain point sits at its FlyWire neuron's real soma position and flashes when that neuron fires; the nerve cord below is procedural (MANC counts; FlyWire is the brain only).

Speed: 1–4× real time at rest, with light, looming or an odour; ~1× during a taste trial; each brain uses ~70% of one CPU core.

**Licence:** FlyWire connectome data is © the FlyWire Consortium, licensed **CC BY-NC 4.0** (non-commercial use, with attribution): Dorkenwald et al., *Nature* 2024; Schlegel et al., *Nature* 2024; FlyWire guidelines at https://flywire.ai. Model: Shiu et al., *Nature* 2024, code MIT (https://github.com/philshiu/Drosophila_brain_model). Hosting this app commercially needs FlyWire's permission.

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

**Honesty note**: brain points are at real FlyWire soma positions once the connectome loads (before that, and for the nerve cord, positions are procedural). In *Neurons only* mode all movement comes from the LIF brain's descending neurons; forward walking needs the Explore drive on DNp09, because nothing in the published model activates DNp09 on its own. Smell- and taste-guided steering are not in the model; *Autopilot* uses the 16-region genome model for that. The escape jump itself is a fixed motor program triggered by DNp01, as the giant fiber triggers take-off in real flies.

## Layout

```
src/
  FlyNeuralSandbox.jsx   game component: engine refs, rAF loop, hash binding, actions
  components/            TopHud, DnaPanel, ActionBar, BrainView, Playground, Overlays
  lib/
    base44.js            DNA codec (pure)
    genome.js            genes, mutation, personality, PRNG (pure)
    connectome.js        16-cluster network + motor readout (pure)
    game.js              deterministic world: fly, sugar, predators, energy, instincts (pure)
    lifBrain.js          FlyWire whole-brain LIF model, lesions, raster, mushroom-body plasticity (pure)
    brainSession.js      one running brain: senses, controls, trials, learning experiments, frames
    selfTest.js          the published circuits as pass/fail checks
    connectomeWorker.js  runs a BrainSession in a Web Worker (fallback)
    realBrain.js         page client: server WebSocket or local worker; senses in, motor commands out
server/
    brainHost.mjs        one brain per visitor in worker threads on the server, ws /api/brain, self-test
    brainWorker.mjs      the worker thread
    flyBody3D.js         NeuroMechFly 3D world: arena, sugar, spiders, chase camera
    brainGeometry.js     seeded procedural anatomy + tracts (pure)
    brainShaders.js      GLSL
    brainRenderer.js     Three.js scene
    drawPlayground.js    Canvas2D renderer
```
