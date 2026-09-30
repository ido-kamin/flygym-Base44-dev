// Canvas2D renderer for the playground. Pure drawing: reads Game state,
// keeps only cosmetic state of its own (particles, floating text, shock rings).

import { ARENA, GRID } from './constants.js';
import { quantizePose } from './base44.js';
import { MISSIONS, PREDATOR_RADIUS, SEARCH_TOKEN } from './game.js';

/** Vibecode token colors; Base uses the Base brand blue. */
export const TOKEN_COLORS = {
  Compile: '#22d3ee',
  Audit: '#fbbf24',
  Mint: '#a3e635',
  Deploy: '#e879f9',
  Base: '#3b7bff',
  // Base44 builder tasks
  'Add page': '#e879f9',
  'Add entity': '#a78bfa',
  'Connect login': '#22d3ee',
  'Design UI': '#f472b6',
  'Add function': '#fbbf24',
  Publish: '#a3e635',
  // web search
  [SEARCH_TOKEN]: '#22d3ee',
};

const TAU = Math.PI * 2;

export function createPlaygroundView(canvas) {
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  let time = 0;
  let cursor = null;
  let mission = 'forage';
  const particles = [];
  const texts = [];
  const rings = [];

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  /** CSS-pixel layout of the letterboxed arena inside the canvas. */
  const layout = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const scale = Math.min(w / ARENA.w, h / ARENA.h);
    return { scale, ox: (w - ARENA.w * scale) / 2, oy: (h - ARENA.h * scale) / 2 };
  };

  function clientToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const { scale, ox, oy } = layout();
    const x = (clientX - rect.left - ox) / scale;
    const y = (clientY - rect.top - oy) / scale;
    if (x < 0 || y < 0 || x > ARENA.w || y > ARENA.h) return null;
    return { x, y };
  }

  function burst(x, y, colors, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.3 + Math.random());
      particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0.6 + Math.random() * 0.5,
        age: 0,
        color: colors[i % colors.length],
        size: 1.5 + Math.random() * 2.5,
      });
    }
  }

  /** Big banners stack instead of overlapping when several fire at once. */
  function banner(text, color, life) {
    const live = texts.filter((t) => t.big).length;
    texts.push({ x: ARENA.w / 2, y: ARENA.h / 2 + live * 56, text, color, age: 0, life, big: true });
  }

  function consume(events) {
    for (const ev of events) {
      if (ev.type === 'eat') {
        burst(ev.x, ev.y, ['#fde047', '#a3e635', '#fef9c3'], 26, 160);
        rings.push({ x: ev.x, y: ev.y, age: 0, life: 0.6, color: '163,230,53', r: 50 });
        texts.push({ x: ev.x, y: ev.y - 10, text: `+1  ⚡${Math.round(ev.energy)}`, color: '#bef264', age: 0, life: 1.1 });
      } else if (ev.type === 'hit') {
        burst(ev.x, ev.y, ['#f43f5e', '#fb7185', '#ffffff'], 30, 220);
        rings.push({ x: ev.x, y: ev.y, age: 0, life: 0.7, color: '244,63,94', r: 90 });
        texts.push({ x: ev.x, y: ev.y - 14, text: '-12 ⚡ STRIKE', color: '#fb7185', age: 0, life: 1.2 });
      } else if (ev.type === 'escape') {
        rings.push({ x: ev.x, y: ev.y, age: 0, life: 0.45, color: '251,146,60', r: 60 });
      } else if (ev.type === 'predator') {
        rings.push({ x: ev.x, y: ev.y, age: 0, life: 0.8, color: '244,63,94', r: 70 });
      } else if (ev.type === 'sugar') {
        burst(ev.x, ev.y, ['#fde047', '#fef9c3'], 10, 70);
      } else if (ev.type === 'stage') {
        texts.push({ x: ARENA.w / 2, y: 70, text: `[${ev.stage}] ✓ ${Math.round(ev.progress * 100)}%`, color: TOKEN_COLORS[ev.stage], age: 0, life: 1.3 });
      } else if (ev.type === 'deployed') {
        banner('DEPLOYED ON BASE 🚀', '#6b9bff', 2.2);
        burst(ARENA.w / 2, ARENA.h / 2, ['#3b7bff', '#ffffff', '#e879f9'], 60, 320);
      } else if (ev.type === 'shipped') {
        banner('APP SHIPPED ON BASE44 🚀', '#f0abfc', 2.4);
        burst(ARENA.w / 2, ARENA.h / 2, ['#e879f9', '#ffffff', '#22d3ee', '#a3e635'], 70, 340);
      } else if (ev.type === 'read') {
        texts.push({ x: ARENA.w / 2, y: 70, text: `📖 +knowledge`, color: '#67e8f9', age: 0, life: 1.2 });
      } else if (ev.type === 'trained' && ev.reward >= 1) {
        texts.push({ x: ARENA.w / 2, y: ARENA.h - 60, text: 'GOOD FLY! 🍬', color: '#bef264', age: 0, life: 1.3, big: true });
      } else if (ev.type === 'trained' && ev.reward <= -1) {
        texts.push({ x: ARENA.w / 2, y: ARENA.h - 60, text: 'NO! ⚡', color: '#fb7185', age: 0, life: 1.1, big: true });
      } else if (ev.type === 'levelup') {
        banner('GENERATION UP', '#f0abfc', 1.6);
      }
    }
  }

  function drawGrid(game) {
    const cw = ARENA.w / GRID;
    const ch = ARENA.h / GRID;
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID; i++) {
      ctx.strokeStyle = i % 4 === 0 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      ctx.moveTo(i * cw, 0);
      ctx.lineTo(i * cw, ARENA.h);
      ctx.moveTo(0, i * ch);
      ctx.lineTo(ARENA.w, i * ch);
      ctx.stroke();
    }
    // the DNA grid cell the fly occupies (the 8 pose bits)
    const { gx, gy } = quantizePose(game.fly.x, game.fly.y, game.fly.theta);
    ctx.fillStyle = 'rgba(245,165,36,0.06)';
    ctx.fillRect(gx * cw, gy * ch, cw, ch);
    ctx.strokeStyle = 'rgba(245,165,36,0.3)';
    ctx.strokeRect(gx * cw + 0.5, gy * ch + 0.5, cw - 1, ch - 1);
  }

  function drawBorder() {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, ARENA.w - 2, ARENA.h - 2);
    ctx.restore();
  }

  function drawOdor(game) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of game.sugars) {
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 120);
      g.addColorStop(0, 'rgba(190,242,100,0.10)');
      g.addColorStop(1, 'rgba(190,242,100,0)');
      ctx.fillStyle = g;
      ctx.fillRect(s.x - 120, s.y - 120, 240, 240);
    }
    ctx.restore();
  }

  function drawTrail(game) {
    const tr = game.trail;
    if (tr.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < tr.length; i++) {
      const f = i / tr.length;
      ctx.strokeStyle = `rgba(${Math.round(217 - 183 * f)},${Math.round(70 + 141 * f)},${Math.round(239 - 1 * f)},${f * 0.5})`;
      ctx.lineWidth = 1 + f * 3;
      ctx.beginPath();
      ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
      ctx.lineTo(tr[i].x, tr[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSugar(s) {
    const pulse = 0.75 + 0.25 * Math.sin(time * 3 + s.phase);
    const pop = Math.min(1, s.age * 4);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(time * 0.6 + s.phase);
    ctx.scale(pop, pop);
    ctx.shadowColor = '#fde047';
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(254,240,138,${0.85 * pulse})`;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      const r = k % 2 ? 5 : 8;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(-1.5, -1.5, 1.8, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawToken(s, need) {
    const pop = Math.min(1, s.age * 4);
    const next = s.kind === need || s.kind === SEARCH_TOKEN;
    const color = next || s.result ? '#f5a524' : '#a1a1aa';
    const pulse = 0.7 + 0.3 * Math.sin(time * (next ? 7 : 3) + s.phase);
    const title = s.kind.length > 24 ? `${s.kind.slice(0, 23)}…` : s.kind;
    const label = s.result ? `📄 ${title}` : s.kind === SEARCH_TOKEN ? '🔎 Search' : mission === 'build' ? `＋ ${s.kind}` : `[${s.kind}]`;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(pop, pop);
    ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    const w = ctx.measureText(label).width + 12;
    ctx.shadowColor = color;
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(20,21,24,0.92)';
    ctx.strokeStyle = color;
    ctx.lineWidth = next ? 2 : 1.2;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -10, w, 20, 5);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 1);
    if (next) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5 * pulse;
      ctx.beginPath();
      ctx.arc(0, 0, w / 2 + 8 + 4 * Math.sin(time * 5), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPipeline(game, stages) {
    const cell = stages.length > 5 ? 84 : 70;
    const x0 = ARENA.w - 20 - stages.length * cell;
    ctx.save();
    ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    stages.forEach((stage, i) => {
      const done = i < game.pipeline;
      const active = i === game.pipeline;
      const color = TOKEN_COLORS[stage];
      ctx.globalAlpha = done ? 1 : active ? 0.75 + 0.25 * Math.sin(time * 6) : 0.3;
      ctx.fillStyle = done ? color : 'rgba(3,6,20,0.8)';
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.roundRect(x0 + i * cell, ARENA.h - 34, cell - 8, 18, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = done ? '#020617' : color;
      ctx.fillText(stage, x0 + i * cell + (cell - 8) / 2, ARENA.h - 24.5);
    });
    ctx.restore();
  }

  function drawSpider(p, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.scale(1.25, 1.25);
    if (p.hunting) {
      ctx.strokeStyle = `rgba(244,63,94,${0.25 + 0.2 * Math.sin(time * 8)})`;
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, PREDATOR_RADIUS + 14 + 4 * Math.sin(time * 6), 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.rotate(p.theta);
    // legs: 4 per side, alternating gait
    ctx.strokeStyle = '#3f0d1a';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < 4; k++) {
        const base = -0.9 + k * 0.6;
        const swing = Math.sin(p.gait * TAU + k * Math.PI + (side > 0 ? Math.PI : 0)) * 0.25;
        const a = side * (Math.PI / 2 + base * 0.9 + swing);
        const kx = Math.cos(a) * 16;
        const ky = Math.sin(a) * 16;
        ctx.beginPath();
        ctx.moveTo(2, 0);
        ctx.lineTo(kx * 0.9 + 2, ky * 0.9 - side * 6 + ky * 0.2);
        ctx.lineTo(kx * 1.55 + 2 + Math.cos(a) * 4, ky * 1.55);
        ctx.stroke();
      }
    }
    ctx.shadowColor = '#f43f5e';
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1c0710';
    ctx.beginPath();
    ctx.ellipse(-11, 0, 13, 10.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2a0b16';
    ctx.beginPath();
    ctx.ellipse(4, 0, 8.5, 7.5, 0, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    // hourglass marking + eyes
    ctx.fillStyle = 'rgba(244,63,94,0.85)';
    ctx.beginPath();
    ctx.moveTo(-16, -3);
    ctx.lineTo(-6, 3);
    ctx.lineTo(-6, -3);
    ctx.lineTo(-16, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ff4d6d';
    for (const [ex, ey] of [[9, -2.5], [9, 2.5], [7, -4.5], [7, 4.5]]) {
      ctx.beginPath();
      ctx.arc(ex, ey, 1.3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawLeg(ax, ay, side, phase, stride) {
    // tripod gait: swing forward while sin(phase) > 0, sweep back in stance
    const s = Math.sin(phase);
    const reach = stride * Math.cos(phase);
    const lift = s > 0 ? s : 0;
    const fx = ax + reach;
    const fy = ay + side * (13 + lift * 2);
    const kx = (ax + fx) / 2 + 1.5;
    const ky = ay + side * 9;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(kx, ky);
    ctx.lineTo(fx, fy);
    ctx.stroke();
  }

  function drawEye(cx, cy, side) {
    ctx.save();
    const g = ctx.createRadialGradient(cx - 1, cy - side, 0.5, cx, cy, 4.2);
    g.addColorStop(0, '#fca5a5');
    g.addColorStop(0.45, '#dc2626');
    g.addColorStop(1, '#450a0a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 3.9, 3.2, 0, 0, TAU);
    ctx.fill();
    ctx.clip();
    // ommatidia lattice
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.35;
    for (let r = -4; r <= 4; r++) {
      for (let c = -4; c <= 4; c++) {
        const hx = cx + c * 1.25 + (r % 2 ? 0.62 : 0);
        const hy = cy + r * 1.08;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU + Math.PI / 6;
          ctx.lineTo(hx + Math.cos(a) * 0.68, hy + Math.sin(a) * 0.68);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawFly(game) {
    const f = game.fly;
    const s = game.sensors;
    const speedN = Math.min(1, f.v / 300);
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(1.5, 1.5);

    // shadow
    ctx.save();
    ctx.filter = 'blur(3px)';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.ellipse(3, 5, 20, 12, f.theta, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.rotate(f.theta);

    // legs (drawn under the body)
    ctx.strokeStyle = '#3b2a1a';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    const p = f.gait * TAU;
    const stride = 3 + 5 * speedN;
    const legs = [
      [5, -1, 0], [0, 1, 0], [-5, -1, 0], // tripod A: L1, R2, L3
      [5, 1, Math.PI], [0, -1, Math.PI], [-5, 1, Math.PI], // tripod B: R1, L2, R3
    ];
    for (const [ax, side, off] of legs) drawLeg(ax, side * 3, side, p + off, stride);

    // abdomen with dark tergite bands
    const ab = ctx.createLinearGradient(-22, 0, -3, 0);
    ab.addColorStop(0, '#78350f');
    ab.addColorStop(1, '#d97706');
    ctx.fillStyle = ab;
    ctx.beginPath();
    ctx.ellipse(-11, 0, 11.5, 7, 0, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(41,20,5,0.75)';
    for (const bx of [-19, -14.5, -10, -5.5]) ctx.fillRect(bx, -8, 2.2, 16);
    ctx.restore();

    // thorax
    ctx.fillStyle = '#b45309';
    ctx.beginPath();
    ctx.ellipse(1.5, 0, 7.5, 6.2, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,15,5,0.6)';
    ctx.lineWidth = 0.5;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      ctx.moveTo(-2, k * 1.8);
      ctx.lineTo(4, k * 1.4);
      ctx.stroke();
    }

    // wings: folded at rest, buzzing blur when fast
    const buzz = speedN > 0.35;
    const beat = Math.sin(f.wing * TAU);
    const drawWing = (side, spread, alpha) => {
      ctx.save();
      ctx.translate(0, side * 2);
      ctx.rotate(Math.PI + side * spread);
      ctx.fillStyle = `rgba(186,230,253,${0.2 * alpha})`;
      ctx.strokeStyle = `rgba(224,242,254,${0.55 * alpha})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.ellipse(12, 0, 13, 4.6, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(1, 0);
      ctx.lineTo(24, 0.5);
      ctx.moveTo(4, -1.5);
      ctx.lineTo(21, -3);
      ctx.moveTo(4, 1.5);
      ctx.lineTo(20, 3);
      ctx.stroke();
      ctx.restore();
    };
    for (const side of [-1, 1]) {
      if (buzz) {
        for (let k = 0; k < 3; k++) drawWing(side, 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(f.wing * TAU + k * 2.1)), 0.55);
      } else {
        drawWing(side, 0.14 + 0.04 * beat, 1);
      }
    }

    // head, eyes, antennae
    ctx.fillStyle = '#92400e';
    ctx.beginPath();
    ctx.ellipse(10, 0, 4.4, 5.2, 0, 0, TAU);
    ctx.fill();
    drawEye(10.5, -4.2, -1);
    drawEye(10.5, 4.2, 1);
    const antenna = (side, level) => {
      const tipX = 17.5;
      const tipY = side * 3.8;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(13.5, side * 1.2);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      const glow = Math.min(1, level);
      ctx.save();
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(103,232,249,${0.35 + 0.65 * glow})`;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 1.3 + 1.6 * glow, 0, TAU);
      ctx.fill();
      ctx.restore();
    };
    antenna(-1, s.odorL);
    antenna(1, s.odorR);
    ctx.restore();
  }

  function drawSensoryRays(game) {
    const f = game.fly;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const c = Math.cos(f.theta);
    const sn = Math.sin(f.theta);
    for (const p of game.predators) {
      const d = Math.hypot(p.x - f.x, p.y - f.y);
      if (d > 320) continue;
      const alpha = Math.min(0.8, 50 / d);
      // eye positions in world space
      for (const side of [-1, 1]) {
        const ex = f.x + c * 10.5 - sn * side * 4.2;
        const ey = f.y + sn * 10.5 + c * side * 4.2;
        const g = ctx.createLinearGradient(ex, ey, p.x, p.y);
        g.addColorStop(0, `rgba(34,211,238,${alpha})`);
        g.addColorStop(1, `rgba(244,63,94,${alpha * 0.4})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
    // odour pull: a faint line to the strongest sugar
    let best = null;
    let bestD = 260;
    for (const s of game.sugars) {
      const d = Math.hypot(s.x - f.x, s.y - f.y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best) {
      ctx.setLineDash([2, 6]);
      ctx.strokeStyle = `rgba(190,242,100,${0.45 * (1 - bestD / 260)})`;
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(best.x, best.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawEffects(dt) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.age += dt;
      if (r.age > r.life) {
        rings.splice(i, 1);
        continue;
      }
      const k = r.age / r.life;
      ctx.strokeStyle = `rgba(${r.color},${1 - k})`;
      ctx.lineWidth = 3 * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 6 + r.r * k, 0, TAU);
      ctx.stroke();
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.age += dt;
      if (q.age > q.life) {
        particles.splice(i, 1);
        continue;
      }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= 1 - 2.5 * dt;
      q.vy *= 1 - 2.5 * dt;
      ctx.globalAlpha = 1 - q.age / q.life;
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.save();
    ctx.textAlign = 'center';
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.age += dt;
      if (t.age > t.life) {
        texts.splice(i, 1);
        continue;
      }
      const k = t.age / t.life;
      ctx.globalAlpha = 1 - k * k;
      ctx.font = t.big ? '800 44px ui-sans-serif, system-ui, sans-serif' : '700 15px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 0;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y - k * (t.big ? 30 : 36));
    }
    ctx.restore();
  }

  function draw(game, dt) {
    time += dt;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0c0d0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const { scale, ox, oy } = layout();
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, ARENA.w, ARENA.h);
    ctx.clip();
    ctx.fillStyle = '#141518';
    ctx.fillRect(0, 0, ARENA.w, ARENA.h);
    drawGrid(game);
    drawOdor(game);
    drawTrail(game);
    mission = game.mission ?? 'forage';
    const stages = MISSIONS[mission]?.stages;
    if (mission === 'forage') {
      for (const s of game.sugars) drawSugar(s);
    } else {
      const need = stages?.[game.pipeline];
      for (const s of game.sugars) drawToken(s, need);
    }
    drawSensoryRays(game);
    for (const p of game.predators) drawSpider(p);
    drawFly(game);
    drawEffects(dt);
    if (cursor && cursor.armed) {
      drawSpider({ x: cursor.x, y: cursor.y, theta: -Math.PI / 2, gait: time, hunting: false }, 0.45);
    }
    if (stages) drawPipeline(game, stages);
    ctx.restore();
    drawBorder();
  }

  return {
    draw,
    consume,
    clientToWorld,
    setCursor(c) {
      cursor = c;
    },
    dispose() {
      observer.disconnect();
    },
  };
}

