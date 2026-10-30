// Deterministic randomness for the fake club: the same seed always gives the
// same club, in the browser and in Node. Never Math.random.

/** mulberry32: small, fast, good enough for fake data. Yields [0, 1). */
export const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** cyrb128: four 32-bit hashes of a string (128 bits, for ids and seeds). */
export const hash128 = (text: string): [number, number, number, number] => {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
};

const hex8 = (value: number) => (value >>> 0).toString(16).padStart(8, "0");

/**
 * UUID-shaped (version 4 layout) id derived from a key, so that a record
 * keeps its id whatever else changes in the seed.
 */
export const uuidFor = (key: string): string => {
  const [a, b, c, d] = hash128(key);
  const hex =
    hex8(a) +
    hex8(b) +
    hex8((c & 0xffff0fff) | 0x00004000) +
    hex8((d & 0x3fffffff) | 0x80000000);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** Integer in [min, max], both included. */
  int(min: number, max: number): number;
  /** Float in [min, max). */
  float(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(list: readonly T[]): T;
  /** Index drawn with the given (non-negative) weights. */
  weightedIndex(weights: readonly number[]): number;
  /** Fisher-Yates on a copy. */
  shuffle<T>(list: readonly T[]): T[];
  /** Roughly normal (sum of uniforms), mean 0, deviation 1. */
  normal(): number;
}

/** A seeded generator; a string seed is hashed first. */
export const createRng = (seed: number | string): Rng => {
  const next = mulberry32(typeof seed === "number" ? seed : hash128(seed)[0]);
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
    chance: (probability) => next() < probability,
    pick: (list) => {
      if (list.length === 0) throw new Error("pick() on an empty list");
      return list[Math.floor(next() * list.length)];
    },
    weightedIndex: (weights) => {
      let total = 0;
      for (const weight of weights) total += Math.max(0, weight);
      if (total <= 0) return -1;
      let draw = next() * total;
      for (let i = 0; i < weights.length; i++) {
        draw -= Math.max(0, weights[i]);
        if (draw < 0) return i;
      }
      return weights.length - 1;
    },
    shuffle: (list) => {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    normal: () => {
      let sum = 0;
      for (let i = 0; i < 6; i++) sum += next();
      return (sum - 3) / Math.sqrt(0.5);
    },
  };
  return rng;
};
