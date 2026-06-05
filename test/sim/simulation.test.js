/**
 * Tests for the Simulation engine (src/simulation.js).
 *
 * These tests verify the integration of the CPU backend with the
 * game's custom rules: collisions, aging, return-fire, etc.
 *
 * Note: We can't directly import simulation.js in Node because it
 * imports from config.js which references browser globals. Instead
 * we test the CPU backend's neighbor counting directly here, plus
 * the pure helpers from grid.js.
 *
 * Run via:  node test/sim/simulation.test.js
 */

import assert from 'node:assert/strict';
import { CpuSimBackend } from '../../src/sim/cpuBackend.js';
import { HashlifeCache } from '../../src/sim/hashlife.js';

// Cell type constants (mirror of CELL_TYPE in config.js).
const EMPTY = 0;
const DEFENSE = 1;
const MISSILE = 2;
const CITY = 3;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

// Helper: build a grid from an ASCII map.
//   '.' = empty, 'D' = defense, 'M' = missile, 'C' = city
function buildGrid(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      let t = EMPTY;
      if (ch === 'D') t = DEFENSE;
      else if (ch === 'M') t = MISSILE;
      else if (ch === 'C') t = CITY;
      cells[y * w + x] = t;
    }
  }
  return { cells, w, h };
}

// ─────────────────────────────────────────────────────────────────────
section('CpuSimBackend: neighbor counts');
// ─────────────────────────────────────────────────────────────────────

test('Empty grid produces zero neighbor counts', () => {
  const w = 5,
    h = 5;
  const cells = new Uint8Array(w * h);
  const backend = new CpuSimBackend(w, h);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  for (let i = 0; i < w * h; i++) {
    assert.equal(lifeOut[i], 0, `lifeOut[${i}] should be 0`);
    assert.equal(missOut[i], 0, `missOut[${i}] should be 0`);
    assert.equal(defOut[i], 0, `defOut[${i}] should be 0`);
  }
});

test('Single defense cell has 0 neighbors at itself, 1 at each of 8 neighbors', () => {
  const { cells, w, h } = buildGrid(['.....', '.....', '..D..', '.....', '.....']);
  const backend = new CpuSimBackend(w, h);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // Self at (2,2): no neighbors.
  assert.equal(defOut[2 * w + 2], 0);
  assert.equal(lifeOut[2 * w + 2], 0);
  // 8 neighbors should each see 1 defense.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const i = (2 + dy) * w + (2 + dx);
      assert.equal(defOut[i], 1, `defOut at (${2 + dx},${2 + dy}) should be 1`);
      assert.equal(lifeOut[i], 1, `lifeOut at (${2 + dx},${2 + dy}) should be 1`);
      assert.equal(missOut[i], 0);
    }
  }
});

test('Glider produces correct neighbor counts at center', () => {
  // Glider pattern:
  //   .M.
  //   ..M
  //   MMM
  const { cells, w, h } = buildGrid(['.....', '..M..', '...M.', '..MMM', '.....']);
  const backend = new CpuSimBackend(w, h);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // Cell at (3, 2) — the lone missile in row 2 — has 3 missile neighbors:
  // (2,1), (2,3), (3,3), (4,3)... wait let me recount.
  // Missiles are at: (2,1), (3,2), (2,3), (3,3), (4,3)
  // Neighbors of (3, 2):
  //   (2,1)=M (3,1)=. (4,1)=.
  //   (2,2)=. (4,2)=.
  //   (2,3)=M (3,3)=M (4,3)=M
  // = 4 missile neighbors.
  assert.equal(missOut[2 * w + 3], 4);
  assert.equal(lifeOut[2 * w + 3], 4);
  assert.equal(defOut[2 * w + 3], 0);
});

test('Mixed missile + defense neighbors: life count = miss + def', () => {
  const { cells, w, h } = buildGrid(['.....', '.DMD.', '.M.M.', '.DMD.', '.....']);
  const backend = new CpuSimBackend(w, h);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // Center cell (2, 2) is empty. Neighbors:
  //   (1,1)=D (2,1)=M (3,1)=D
  //   (1,2)=M       (3,2)=M
  //   (1,3)=D (2,3)=M (3,3)=D
  // = 4 missiles + 4 defenses = 8 total
  assert.equal(missOut[2 * w + 2], 4);
  assert.equal(defOut[2 * w + 2], 4);
  assert.equal(lifeOut[2 * w + 2], 8);
});

test('Horizontal wrap: cells at x=0 see neighbors at x=w-1', () => {
  const w = 5,
    h = 3;
  const cells = new Uint8Array(w * h);
  // Place a defense at the right edge (x=4, y=1)
  cells[1 * w + 4] = DEFENSE;
  const backend = new CpuSimBackend(w, h);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // Cell at (0, 1) should see the defense at (4, 1) via wrap.
  assert.equal(defOut[1 * w + 0], 1, 'Cell at (0,1) should see wrapped neighbor at (4,1)');
});

test('Vertical edges do NOT wrap (y boundary is hard)', () => {
  const w = 5,
    h = 5;
  const cells = new Uint8Array(w * h);
  // Place a defense at the bottom row.
  cells[(h - 1) * w + 2] = DEFENSE;
  const backend = new CpuSimBackend(w, h);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // Top row should NOT see the bottom defense (no vertical wrap).
  for (let x = 0; x < w; x++) {
    assert.equal(defOut[0 * w + x], 0, `Top row (${x},0) should have no neighbors from bottom row`);
  }
});

test('City cells are NOT counted as life/missile/defense neighbors', () => {
  const { cells, w, h } = buildGrid(['.....', '..C..', '.....']);
  const backend = new CpuSimBackend(w, h);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // No cell should see the city as a life/missile/defense neighbor.
  for (let i = 0; i < w * h; i++) {
    assert.equal(lifeOut[i], 0);
    assert.equal(missOut[i], 0);
    assert.equal(defOut[i], 0);
  }
});

test('Dense defense field: all cells have 8 neighbors except edges', () => {
  const w = 5,
    h = 5;
  const cells = new Uint8Array(w * h);
  cells.fill(DEFENSE);
  const backend = new CpuSimBackend(w, h);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // Interior cell (2, 2) has 8 defense neighbors.
  assert.equal(defOut[2 * w + 2], 8);
  // Top row interior cells: 5 neighbors (no row above), wrapped horizontally.
  // But wait - horizontal wraps, so x=0 row 0: sees (4,0), (1,0) left/right
  // and (4,1), (0,1), (1,1) below = 5 neighbors. Yes.
  assert.equal(defOut[0 * w + 0], 5);
  // Bottom row interior cell (2, 4): 5 neighbors.
  assert.equal(defOut[4 * w + 2], 5);
});

test('Larger grid: neighbor counts match brute-force computation', () => {
  const w = 20,
    h = 15;
  const cells = new Uint8Array(w * h);
  // Random sprinkle.
  const rng = mulberry32(42);
  for (let i = 0; i < w * h; i++) {
    const r = rng();
    if (r < 0.2) cells[i] = DEFENSE;
    else if (r < 0.35) cells[i] = MISSILE;
    else if (r < 0.4) cells[i] = CITY;
  }
  const backend = new CpuSimBackend(w, h);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // Brute-force reference computation.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let life = 0,
        miss = 0,
        def = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = (((x + dx) % w) + w) % w;
          const t = cells[ny * w + nx];
          if (t === MISSILE) {
            life++;
            miss++;
          } else if (t === DEFENSE) {
            life++;
            def++;
          }
        }
      }
      const i = y * w + x;
      assert.equal(lifeOut[i], life, `lifeOut mismatch at (${x},${y})`);
      assert.equal(missOut[i], miss, `missOut mismatch at (${x},${y})`);
      assert.equal(defOut[i], def, `defOut mismatch at (${x},${y})`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────
section('HashlifeCache');
// ─────────────────────────────────────────────────────────────────────

test('Hashlife cache: empty 6x6 produces empty 2x2', () => {
  const cache = new HashlifeCache();
  const result = cache.step2x2(0);
  assert.equal(result, 0, 'Empty input should yield empty output');
});

test('Hashlife cache: dense 6x6 of all-alive produces dead cells (overpopulation)', () => {
  const cache = new HashlifeCache();
  // All 36 bits set.
  const key = 0xfffffffff; // 36 bits
  const result = cache.step2x2(key);
  // Each center cell has 8 alive neighbors → dies. So result = 0.
  assert.equal(result, 0);
});

test('Hashlife cache: block pattern is stable', () => {
  const cache = new HashlifeCache();
  // 6x6 neighborhood with a 2x2 block at center (positions 2,2 / 3,2 / 2,3 / 3,3).
  // Bit positions: (y * 6 + x).
  const block = (1 << (2 * 6 + 2)) | (1 << (2 * 6 + 3)) | (1 << (3 * 6 + 2)) | (1 << (3 * 6 + 3));
  const result = cache.step2x2(block);
  // 2x2 block result bits: (cy-2)*2 + (cx-2)
  // All 4 should be set: 0b1111 = 15
  assert.equal(result, 15, 'Block should survive intact');
});

test('Hashlife cache: memoization actually caches', () => {
  const cache = new HashlifeCache();
  const key = 0x12345;
  cache.step2x2(key);
  const stats1 = cache.stats();
  cache.step2x2(key);
  const stats2 = cache.stats();
  assert.equal(stats2.hits, stats1.hits + 1, 'Second call should be a cache hit');
  assert.equal(stats2.misses, stats1.misses, 'Misses should not increase');
});

test('Hashlife cache: clear resets statistics', () => {
  const cache = new HashlifeCache();
  cache.step2x2(123);
  cache.step2x2(456);
  cache.clear();
  const stats = cache.stats();
  assert.equal(stats.size, 0);
  assert.equal(stats.hits, 0);
  assert.equal(stats.misses, 0);
});

test('Hashlife cache: eviction at max size', () => {
  const cache = new HashlifeCache(3); // tiny cache
  cache.step2x2(1);
  cache.step2x2(2);
  cache.step2x2(3);
  assert.equal(cache.stats().size, 3);
  cache.step2x2(4); // should evict key=1
  assert.equal(cache.stats().size, 3);
  // Accessing key=1 again should be a miss.
  const beforeMisses = cache.stats().misses;
  cache.step2x2(1);
  assert.equal(cache.stats().misses, beforeMisses + 1);
});

// ─────────────────────────────────────────────────────────────────────
section('Performance smoke tests');
// ─────────────────────────────────────────────────────────────────────

test('Large grid (200x200) neighbor counts complete in reasonable time', () => {
  const w = 200,
    h = 200;
  const cells = new Uint8Array(w * h);
  const rng = mulberry32(123);
  for (let i = 0; i < w * h; i++) {
    if (rng() < 0.3) cells[i] = DEFENSE;
    else if (rng() < 0.15) cells[i] = MISSILE;
  }
  const backend = new CpuSimBackend(w, h);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  const start = Date.now();
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 500, `200x200 neighbor count took ${elapsed}ms (expected < 500ms)`);
});

test('100 ticks of a 100x100 grid completes in reasonable time', () => {
  const w = 100,
    h = 100;
  const cells = new Uint8Array(w * h);
  const rng = mulberry32(789);
  for (let i = 0; i < w * h; i++) {
    if (rng() < 0.3) cells[i] = DEFENSE;
  }
  const backend = new CpuSimBackend(w, h);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  const start = Date.now();
  for (let i = 0; i < 100; i++) {
    backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  }
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `100 ticks of 100x100 took ${elapsed}ms (expected < 2000ms)`);
});

// Simple seeded PRNG for reproducibility.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
