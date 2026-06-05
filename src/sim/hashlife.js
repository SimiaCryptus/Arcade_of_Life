/**
 * A lightweight Hashlife-inspired memoization cache for 4x4 sub-block
 * transitions of pure-defense regions.
 *
 * True Hashlife uses quad-tree macrocells that double in time per level,
 * achieving exponential speedups on repetitive patterns. That's overkill
 * (and the wrong shape) for this game's heterogeneous grids with cities,
 * missiles, and player-painted defenses. Instead we memoize the much
 * simpler case: 4x4 defense-only blocks whose 6x6 neighborhood is also
 * pure-defense (or empty). The center 2x2 evolves deterministically by
 * Life rules and can be looked up by hash.
 *
 * Key: 36-bit integer (6x6 neighborhood bitpacked).
 * Value: 4-bit integer (resulting 2x2 center cells).
 *
 * This is a no-op on small/active grids but speeds up large boards
 * with sprawling static defense lattices considerably.
 *
 * Usage is opt-in by callers — currently exposed for future integration
 * passes. The CPU backend already handles the common case very fast.
 */
export class HashlifeCache {
  constructor(maxSize = 65536) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Look up or compute the next 2x2 center of a 6x6 pure-life neighborhood.
   * @param {number} key  - bitpacked 36-bit neighborhood (low 36 bits)
   * @returns {number}    - bitpacked 4-bit center result
   */
  step2x2(key) {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.hits++;
      return cached;
    }
    this.misses++;
    const result = this._compute2x2(key);
    if (this.cache.size >= this.maxSize) {
      // Simple eviction: drop oldest entry.
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, result);
    return result;
  }

  _compute2x2(key) {
    // Unpack 6x6 grid: bit (y*6 + x) = cell at (x, y).
    const bits = new Uint8Array(36);
    for (let i = 0; i < 36; i++) bits[i] = (key >>> i) & 1;
    // Center 2x2 is at (2,2), (3,2), (2,3), (3,3).
    let result = 0;
    for (let cy = 2; cy <= 3; cy++) {
      for (let cx = 2; cx <= 3; cx++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            n += bits[(cy + dy) * 6 + (cx + dx)];
          }
        }
        const alive = bits[cy * 6 + cx];
        let nextAlive;
        if (alive) nextAlive = n === 2 || n === 3 ? 1 : 0;
        else nextAlive = n === 3 ? 1 : 0;
        if (nextAlive) {
          const bit = (cy - 2) * 2 + (cx - 2);
          result |= 1 << bit;
        }
      }
    }
    return result;
  }

  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total).toFixed(3) : '0',
    };
  }
}
