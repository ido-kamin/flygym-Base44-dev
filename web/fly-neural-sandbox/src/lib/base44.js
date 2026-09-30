// Base44 "Viral DNA" codec.
//
// The whole shareable game state is a 48-bit payload (big-endian, MSB first):
//
//   bits 47..24  neural weights   6 genes x 4 bits (gene 0 in the top nibble)
//   bits 23..12  score            0..4095 (clamped)
//   bits 11..8   grid x           0..15  (16 columns across the arena)
//   bits  7..4   grid y           0..15
//   bits  3..0   heading sector   0..15  (22.5 deg each, 0 = +x, clockwise on screen)
//
// It is written as 9 base-44 digits (44^9 ~ 6.2e14 > 2^48) followed by one
// checksum digit, so every DNA string is exactly 10 URL-safe characters and
// lives in the page hash as `#dna=XXXXXXXXXX`.

import {
  ARENA,
  GENE_COUNT,
  GENE_LEVELS,
  GRID,
  HEADING_SECTORS,
  MAX_SCORE,
} from './constants.js';

/**
 * 44 URL-safe symbols: digits, upper case without I/O, and ten lower-case
 * letters without i/l. No `+`, `/`, `=` or `?`, and no look-alike glyphs, so a
 * DNA string survives URLs, chat apps and being read aloud.
 */
export const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjk';

export const PAYLOAD_BITS = 48;
export const PAYLOAD_DIGITS = 9;
export const DNA_LENGTH = PAYLOAD_DIGITS + 1;
export const HASH_KEY = 'dna';

const BASE = BigInt(ALPHABET.length);
const PAYLOAD_LIMIT = 1n << BigInt(PAYLOAD_BITS);
const FORBIDDEN = ['+', '/', '=', '?', '#', '&', '%'];
// Checksum weights are all coprime with 44 (odd, not multiples of 11), so any
// single mistyped digit always changes the checksum.
const CHECK_WEIGHTS = [1, 3, 5, 7, 9, 13, 15, 17, 19];

const INDEX = new Map([...ALPHABET].map((ch, i) => [ch, i]));

if (ALPHABET.length !== 44 || INDEX.size !== 44) {
  throw new Error('Base44 alphabet must contain 44 unique symbols');
}
for (const ch of FORBIDDEN) {
  if (ALPHABET.includes(ch)) throw new Error(`Base44 alphabet contains "${ch}"`);
}

/** Error raised for any malformed, truncated or tampered DNA string. */
export class DNAError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DNAError';
  }
}

function checksumDigit(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += digits[i] * CHECK_WEIGHTS[i];
  return sum % 44;
}

/** 48-bit BigInt -> 10-character Base44 string (9 payload digits + checksum). */
export function encodeBase44(value) {
  let v = BigInt(value);
  if (v < 0n || v >= PAYLOAD_LIMIT) {
    throw new DNAError(`payload out of range: ${value}`);
  }
  const digits = new Array(PAYLOAD_DIGITS);
  for (let i = PAYLOAD_DIGITS - 1; i >= 0; i--) {
    digits[i] = Number(v % BASE);
    v /= BASE;
  }
  return digits.map((d) => ALPHABET[d]).join('') + ALPHABET[checksumDigit(digits)];
}

/** 10-character Base44 string -> 48-bit BigInt. Throws DNAError when invalid. */
export function decodeBase44(str) {
  if (typeof str !== 'string' || str.length !== DNA_LENGTH) {
    throw new DNAError(`DNA must be ${DNA_LENGTH} characters`);
  }
  const digits = [];
  for (const ch of str) {
    const d = INDEX.get(ch);
    if (d === undefined) throw new DNAError(`invalid DNA symbol "${ch}"`);
    digits.push(d);
  }
  const check = digits.pop();
  if (checksumDigit(digits) !== check) throw new DNAError('DNA checksum mismatch');
  let v = 0n;
  for (const d of digits) v = v * BASE + BigInt(d);
  if (v >= PAYLOAD_LIMIT) throw new DNAError('DNA payload exceeds 48 bits');
  return v;
}

function assertField(name, value, levels) {
  if (!Number.isInteger(value) || value < 0 || value >= levels) {
    throw new DNAError(`${name} must be an integer in [0, ${levels - 1}], got ${value}`);
  }
}

/**
 * Pack the quantized DNA fields into a 48-bit BigInt.
 * @param {{weights:number[], score:number, gx:number, gy:number, heading:number}} dna
 */
export function packDNA({ weights, score, gx, gy, heading }) {
  if (!Array.isArray(weights) || weights.length !== GENE_COUNT) {
    throw new DNAError(`expected ${GENE_COUNT} weights`);
  }
  let v = 0n;
  weights.forEach((w, i) => {
    assertField(`weight ${i}`, w, GENE_LEVELS);
    v = (v << 4n) | BigInt(w);
  });
  const s = Math.max(0, Math.min(MAX_SCORE, Math.floor(score)));
  v = (v << 12n) | BigInt(s);
  assertField('gx', gx, GRID);
  assertField('gy', gy, GRID);
  assertField('heading', heading, HEADING_SECTORS);
  v = (v << 4n) | BigInt(gx);
  v = (v << 4n) | BigInt(gy);
  v = (v << 4n) | BigInt(heading);
  return v;
}

/** Inverse of packDNA. */
export function unpackDNA(value) {
  let v = BigInt(value);
  const heading = Number(v & 0xfn);
  v >>= 4n;
  const gy = Number(v & 0xfn);
  v >>= 4n;
  const gx = Number(v & 0xfn);
  v >>= 4n;
  const score = Number(v & 0xfffn);
  v >>= 12n;
  const weights = new Array(GENE_COUNT);
  for (let i = GENE_COUNT - 1; i >= 0; i--) {
    weights[i] = Number(v & 0xfn);
    v >>= 4n;
  }
  return { weights, score, gx, gy, heading };
}

/** The 48 payload bits, MSB first, for the HUD bit matrix. */
export function bitsOf(value) {
  const v = BigInt(value);
  const bits = new Array(PAYLOAD_BITS);
  for (let i = 0; i < PAYLOAD_BITS; i++) {
    bits[i] = ((v >> BigInt(PAYLOAD_BITS - 1 - i)) & 1n) === 1n;
  }
  return bits;
}

/** Which DNA field each of the 48 bits (MSB first) belongs to. */
export const BIT_FIELDS = [
  ...Array(24).fill('weights'),
  ...Array(12).fill('score'),
  ...Array(12).fill('pose'),
];

// ---- continuous world state <-> quantized DNA fields -----------------------

const TAU = Math.PI * 2;

/** World position/heading -> DNA grid cell and heading sector. */
export function quantizePose(x, y, theta) {
  const gx = Math.min(GRID - 1, Math.max(0, Math.floor((x / ARENA.w) * GRID)));
  const gy = Math.min(GRID - 1, Math.max(0, Math.floor((y / ARENA.h) * GRID)));
  const a = ((theta % TAU) + TAU) % TAU;
  const heading = Math.round((a / TAU) * HEADING_SECTORS) % HEADING_SECTORS;
  return { gx, gy, heading };
}

/** DNA grid cell and heading sector -> world position (cell centre) and heading. */
export function dequantizePose(gx, gy, heading) {
  return {
    x: ((gx + 0.5) / GRID) * ARENA.w,
    y: ((gy + 0.5) / GRID) * ARENA.h,
    theta: (heading / HEADING_SECTORS) * TAU,
  };
}

/**
 * Serialize a live fly into its Base44 DNA.
 * @param {{weights:number[], score:number, fly:{x:number, y:number, theta:number}}} game
 */
export function encodeFlyToBase44({ weights, score, fly }) {
  const pose = quantizePose(fly.x, fly.y, fly.theta);
  return encodeBase44(packDNA({ weights, score, ...pose }));
}

/**
 * Parse a DNA string (bare, `dna=...` or a full `#dna=...` hash) back into
 * the state needed to respawn the fly: weights, score, world pose.
 * Throws DNAError when the string is not valid DNA.
 */
export function decodeFlyFromBase44(input) {
  const raw = extractDNA(input);
  if (raw === null) throw new DNAError('no DNA found');
  const dna = unpackDNA(decodeBase44(raw));
  return { ...dna, ...dequantizePose(dna.gx, dna.gy, dna.heading), dna: raw };
}

/** Pull the DNA string out of a location hash; null when there is none. */
export function extractDNA(input) {
  if (typeof input !== 'string') return null;
  const s = input.startsWith('#') ? input.slice(1) : input;
  if (!s) return null;
  if (!s.includes('=')) return s;
  const params = new URLSearchParams(s);
  return params.get(HASH_KEY);
}

/** Build the `#dna=...` hash fragment for a DNA string. */
export function dnaHash(dna) {
  return `#${HASH_KEY}=${dna}`;
}
