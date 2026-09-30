import { describe, expect, it } from 'vitest';

import {
  ALPHABET,
  bitsOf,
  decodeBase44,
  decodeFlyFromBase44,
  dequantizePose,
  DNA_LENGTH,
  DNAError,
  encodeBase44,
  encodeFlyToBase44,
  extractDNA,
  packDNA,
  quantizePose,
  unpackDNA,
} from './base44.js';
import { ARENA } from './constants.js';
import { mulberry32 } from './genome.js';

const randomDNA = (rng) => ({
  weights: Array.from({ length: 6 }, () => Math.floor(rng() * 16)),
  score: Math.floor(rng() * 4096),
  gx: Math.floor(rng() * 16),
  gy: Math.floor(rng() * 16),
  heading: Math.floor(rng() * 16),
});

describe('alphabet', () => {
  it('has 44 unique URL-safe symbols without + / = ?', () => {
    expect(ALPHABET).toHaveLength(44);
    expect(new Set(ALPHABET).size).toBe(44);
    for (const ch of '+/=?') expect(ALPHABET).not.toContain(ch);
    expect(encodeURIComponent(ALPHABET)).toBe(ALPHABET);
  });
});

describe('Base44 codec', () => {
  it('round-trips 10k random 48-bit payloads through pack/encode/decode/unpack', () => {
    const rng = mulberry32(1234);
    for (let i = 0; i < 10000; i++) {
      const dna = randomDNA(rng);
      const s = encodeBase44(packDNA(dna));
      expect(s).toHaveLength(DNA_LENGTH);
      expect(unpackDNA(decodeBase44(s))).toEqual(dna);
    }
  });

  it('encodes the extremes of the 48-bit range', () => {
    const zero = encodeBase44(0n);
    const max = encodeBase44((1n << 48n) - 1n);
    expect(decodeBase44(zero)).toBe(0n);
    expect(decodeBase44(max)).toBe((1n << 48n) - 1n);
    expect(zero).toBe('0000000000');
    expect(() => encodeBase44(1n << 48n)).toThrow(DNAError);
    expect(() => encodeBase44(-1n)).toThrow(DNAError);
  });

  it('packs all-ones fields into all 48 bits set', () => {
    const v = packDNA({ weights: [15, 15, 15, 15, 15, 15], score: 4095, gx: 15, gy: 15, heading: 15 });
    expect(v).toBe((1n << 48n) - 1n);
    expect(bitsOf(v).every(Boolean)).toBe(true);
  });

  it('lays the fields out MSB-first: weights, score, x, y, heading', () => {
    const v = packDNA({ weights: [1, 0, 0, 0, 0, 0], score: 1, gx: 1, gy: 2, heading: 3 });
    const bits = bitsOf(v);
    expect(bits.slice(0, 4)).toEqual([false, false, false, true]); // gene 0 = 1
    expect(bits[35]).toBe(true); // score LSB
    expect(Number(v & 0xfffn)).toBe(0x123);
  });

  it('clamps the score to 12 bits', () => {
    const v = packDNA({ weights: [0, 0, 0, 0, 0, 0], score: 99999, gx: 0, gy: 0, heading: 0 });
    expect(unpackDNA(v).score).toBe(4095);
  });

  it('rejects out-of-range fields', () => {
    const ok = { weights: [0, 0, 0, 0, 0, 0], score: 0, gx: 0, gy: 0, heading: 0 };
    expect(() => packDNA({ ...ok, weights: [16, 0, 0, 0, 0, 0] })).toThrow(DNAError);
    expect(() => packDNA({ ...ok, weights: [0, 0, 0] })).toThrow(DNAError);
    expect(() => packDNA({ ...ok, gx: 16 })).toThrow(DNAError);
    expect(() => packDNA({ ...ok, heading: -1 })).toThrow(DNAError);
  });

  it('rejects bad symbols, bad lengths, a bad checksum and >48-bit payloads', () => {
    const s = encodeBase44(packDNA(randomDNA(mulberry32(7))));
    expect(() => decodeBase44(s.slice(1))).toThrow(DNAError);
    expect(() => decodeBase44(`${s}0`)).toThrow(DNAError);
    expect(() => decodeBase44(`${s.slice(0, 3)}+${s.slice(4)}`)).toThrow(/symbol/);
    expect(() => decodeBase44(`${s.slice(0, 3)}I${s.slice(4)}`)).toThrow(/symbol/);
    expect(() => decodeBase44('kkkkkkkkkk')).toThrow(DNAError);
  });

  it('detects every single-character substitution via the checksum', () => {
    const s = encodeBase44(packDNA(randomDNA(mulberry32(99))));
    for (let pos = 0; pos < DNA_LENGTH; pos++) {
      for (const ch of ALPHABET) {
        if (ch === s[pos]) continue;
        const t = s.slice(0, pos) + ch + s.slice(pos + 1);
        expect(() => decodeBase44(t)).toThrow(DNAError);
      }
    }
  });
});

describe('pose quantization', () => {
  it('dequantize -> quantize is the identity on every cell and sector', () => {
    for (let gx = 0; gx < 16; gx++) {
      for (let gy = 0; gy < 16; gy++) {
        for (let h = 0; h < 16; h++) {
          const p = dequantizePose(gx, gy, h);
          expect(quantizePose(p.x, p.y, p.theta)).toEqual({ gx, gy, heading: h });
        }
      }
    }
  });

  it('wraps headings and clamps positions at the arena edge', () => {
    expect(quantizePose(0, 0, Math.PI * 2).heading).toBe(0);
    expect(quantizePose(0, 0, -Math.PI / 2).heading).toBe(12);
    expect(quantizePose(0, 0, Math.PI * 2 - 0.01).heading).toBe(0);
    expect(quantizePose(ARENA.w, ARENA.h, 0)).toMatchObject({ gx: 15, gy: 15 });
    expect(quantizePose(-5, -5, 0)).toMatchObject({ gx: 0, gy: 0 });
  });
});

describe('fly <-> DNA', () => {
  it('encode(decode(s)) === s for random valid DNA', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 2000; i++) {
      const s = encodeBase44(packDNA(randomDNA(rng)));
      const fly = decodeFlyFromBase44(`#dna=${s}`);
      expect(encodeFlyToBase44({ weights: fly.weights, score: fly.score, fly })).toBe(s);
    }
  });

  it('extracts DNA from hashes in several shapes', () => {
    expect(extractDNA('#dna=ABCDEFGHJK')).toBe('ABCDEFGHJK');
    expect(extractDNA('dna=ABCDEFGHJK&x=1')).toBe('ABCDEFGHJK');
    expect(extractDNA('ABCDEFGHJK')).toBe('ABCDEFGHJK');
    expect(extractDNA('#')).toBeNull();
    expect(extractDNA('#other=1')).toBeNull();
    expect(() => decodeFlyFromBase44('#other=1')).toThrow(DNAError);
  });
});
