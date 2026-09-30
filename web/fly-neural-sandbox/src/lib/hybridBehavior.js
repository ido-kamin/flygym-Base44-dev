// Explicit behavioral assistance, not a claim of emergent FlyWire behavior.
// Short walking bouts, local food targets and anticipatory wall avoidance keep
// persistent neural steering biases from turning into endless circles.
import { ARENA } from './constants.js';
import { mulberry32 } from './genome.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const angle = (x) => Math.atan2(Math.sin(x), Math.cos(x));

export class HybridBehavior {
  constructor(seed, heading) {
    this.rng = mulberry32(seed ^ 0x71af39);
    this.heading = heading;
    this.bout = 2 + this.rng() * 3;
    this.pause = 0;
    this.target = null;
    this.neuralBias = 0;
    this.behaviour = 'explore';
  }

  step(dt, game) {
    const { fly, sensors: s, brainMotor: brain } = game;
    const hunger = 1 - game.energy / 100;
    const threat = s.threatL + s.threatR;
    const distance = (p) => Math.hypot(p.x - fly.x, p.y - fly.y);
    // Stay with one nearby target instead of averaging conflicting food cues.
    if (!game.sugars.includes(this.target) || distance(this.target) > 420) this.target = null;
    if (!this.target) {
      let nearest = 360;
      for (const food of game.sugars) {
        const d = distance(food);
        if (d < nearest) { this.target = food; nearest = d; }
      }
    }

    const neuralTurn = brain?.turn ?? 0;
    this.neuralBias += (neuralTurn - this.neuralBias) * Math.min(1, dt / 0.8);
    const neuralTransient = neuralTurn - this.neuralBias;
    // Feeding/grooming/escape programs own the body; don't spend walking bouts during them.
    if (fly.feedTimer > 0 || fly.groomTimer > 0 || fly.escapeTimer > 0) return { turn: 0, speed: 0 };

    const nearWall = Math.min(fly.x, ARENA.w - fly.x, fly.y, ARENA.h - fly.y) < 105;
    if (threat > 0.15 || nearWall || brain?.steering) this.pause = 0;
    if (this.pause > 0) {
      this.pause = Math.max(0, this.pause - dt);
      this.behaviour = 'stand';
      return { turn: 0, speed: 0 };
    }
    this.bout -= dt;
    if (this.bout <= 0) {
      this.bout = 2 + this.rng() * 3 + hunger * 2;
      // A new heading per bout, not random jitter every frame.
      this.heading = fly.theta + (this.rng() - 0.5) * 1.8;
      if (threat < 0.15 && !nearWall && !brain?.steering) {
        this.pause = (0.4 + this.rng() * 0.9) * (1 - hunger * 0.5);
        this.behaviour = 'stand';
        return { turn: 0, speed: 0 };
      }
    }

    const targetDistance = this.target ? distance(this.target) : Infinity;
    const desired = this.target ? Math.atan2(this.target.y - fly.y, this.target.x - fly.x) : this.heading;
    let dx = Math.cos(desired);
    let dy = Math.sin(desired);
    // Look ahead so the fly pivots before touching a wall, rather than bouncing.
    const lookAhead = Math.min(55, targetDistance * 0.3);
    const px = fly.x + Math.cos(fly.theta) * lookAhead;
    const py = fly.y + Math.sin(fly.theta) * lookAhead;
    const repel = (d) => 3 * clamp((45 - d) / 30, 0, 1);
    dx += repel(px) - repel(ARENA.w - px);
    dy += repel(py) - repel(ARENA.h - py);
    for (const predator of game.predators) {
      const d = distance(predator);
      if (d > 0 && d < 200) {
        const strength = 4 * (1 - d / 200);
        dx += (fly.x - predator.x) / d * strength;
        dy += (fly.y - predator.y) / d * strength;
      }
    }
    // Keep the new exploration heading after avoiding an edge; otherwise the
    // old heading would immediately pull the fly back toward the same wall.
    if (nearWall && !this.target) this.heading = Math.atan2(dy, dx);
    const error = angle(Math.atan2(dy, dx) - fly.theta);
    const learnedTurn = brain?.memory ? game.memoryTurn(brain.memory) : 0;
    // Deliberate DNa02 stimulation remains effective while held; only the
    // spontaneous resting bias is suppressed by the lifelike controller.
    const turn = brain?.steering
      ? clamp(neuralTurn * 0.65 + error * 0.08, -0.65, 0.65)
      : clamp(error * 0.34 + neuralTransient * 0.12 + learnedTurn * 0.3, -0.48, 0.48);
    const alignment = Math.max(0.12, Math.cos(error));
    const approach = clamp(targetDistance / 85, 0.3, 1);
    const drive = 0.28 + hunger * 0.12 + clamp(brain?.walk ?? 0, 0, 1) * 0.14;
    this.behaviour = this.target ? 'forage' : 'explore';
    return { turn, speed: drive * alignment * approach };
  }
}
