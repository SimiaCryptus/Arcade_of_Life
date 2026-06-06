/**
 * Tests for grid.js helper functions (those that don't depend on
 * CONFIG or browser globals).
 *
 * Run via: node test/grid.test.js
 */

import assert from 'node:assert/strict';

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

// Inline reimplementation of wrapX so we don't need to import grid.js
// (which transitively imports config.js with browser deps).
function wrapX(x, width) {
  return ((x % width) + width) % width;
}

section('Grid coordinate wrapping:');

test('wrapX: positive in-bounds value is unchanged', () => {
  assert.equal(wrapX(5, 10), 5);
  assert.equal(wrapX(0, 10), 0);
  assert.equal(wrapX(9, 10), 9);
});

test('wrapX: negative value wraps to positive', () => {
  assert.equal(wrapX(-1, 10), 9);
  assert.equal(wrapX(-5, 10), 5);
  assert.equal(wrapX(-10, 10), 0);
});

test('wrapX: value larger than width wraps', () => {
  assert.equal(wrapX(10, 10), 0);
  assert.equal(wrapX(15, 10), 5);
  assert.equal(wrapX(25, 10), 5);
});

test('wrapX: large negative values wrap correctly', () => {
  assert.equal(wrapX(-15, 10), 5);
  assert.equal(wrapX(-100, 10), 0);
});

test('wrapX: identity for width=1', () => {
  assert.equal(wrapX(0, 1), 0);
  assert.equal(wrapX(5, 1), 0);
  assert.equal(wrapX(-5, 1), 0);
});
section('Grid wrapVerticalShift (Klein-bottle-style wrap):');
// Inline reimplementation of wrapXY logic from grid.js
function wrapXY(x, y, width, height, shift) {
  let nx = x;
  let ny = y;
  if (shift !== 0) {
    if (x >= width) {
      const wraps = Math.floor(x / width);
      nx = x - wraps * width;
      // Positive shift: going EAST decreases y.
      ny = y - wraps * shift;
    } else if (x < 0) {
      const wraps = Math.ceil(-x / width);
      nx = x + wraps * width;
      // Going WEST increases y.
      ny = y + wraps * shift;
    }
  } else {
    nx = ((x % width) + width) % width;
  }
  return { x: nx, y: ny };
}
test('wrapXY: shift=0 behaves like plain wrapX', () => {
  assert.deepEqual(wrapXY(10, 5, 10, 20, 0), { x: 0, y: 5 });
  assert.deepEqual(wrapXY(-1, 5, 10, 20, 0), { x: 9, y: 5 });
});
test('wrapXY: going east with positive shift decreases y', () => {
  // x=10 (one past width=10), shift=5: should give nx=0, ny=y-5
  assert.deepEqual(wrapXY(10, 50, 10, 100, 5), { x: 0, y: 45 });
});
test('wrapXY: going west with positive shift increases y', () => {
  // x=-1 (one before 0), shift=5: should give nx=9, ny=y+5
  assert.deepEqual(wrapXY(-1, 50, 10, 100, 5), { x: 9, y: 55 });
});
test('wrapXY: two full wraps east doubles the shift', () => {
  assert.deepEqual(wrapXY(20, 50, 10, 100, 5), { x: 0, y: 40 });
});
test('wrapXY: east then west cancels', () => {
  const eastward = wrapXY(10, 50, 10, 100, 5);
  // From the wrapped position, going west once should return original y.
  const westward = wrapXY(-1, eastward.y, 10, 100, 5);
  assert.equal(westward.y, 50);
});
test('wrapXY: matches CPU backend convention (east → y - shift)', () => {
  // The CPU backend in cpuBackend.js does:
  //   else if (nx >= w) { ny -= vShift; nx = nx % w; }
  // So a neighbor at (x+1, y) when x+1 == w should look up cell (0, y - shift).
  const w = 10;
  const shift = 3;
  const x = w; // one past east edge
  const y = 50;
  const result = wrapXY(x, y, w, 200, shift);
  assert.equal(result.x, 0);
  assert.equal(result.y, y - shift);
});
section('CpuBackend wrap shift behavior:');
// Simulate the CPU backend's neighbor lookup for a single cell with
// vertical shift to verify the wrap math.
function lookupNeighbor(x, y, dx, dy, w, h, vShift) {
  let nx = x + dx;
  let ny = y + dy;
  if (vShift !== 0) {
    if (nx < 0) {
      ny += vShift;
      nx = ((nx % w) + w) % w;
    } else if (nx >= w) {
      ny -= vShift;
      nx = nx % w;
    }
  } else {
    if (nx < 0) nx = ((nx % w) + w) % w;
    else if (nx >= w) nx = nx % w;
  }
  if (ny < 0 || ny >= h) return null;
  return { x: nx, y: ny };
}
test('lookupNeighbor with shift=0 wraps normally', () => {
  // Cell at east edge (x=9) looking east (dx=+1) wraps to x=0.
  const r = lookupNeighbor(9, 50, 1, 0, 10, 100, 0);
  assert.deepEqual(r, { x: 0, y: 50 });
});
test('lookupNeighbor with shift=5 going east shifts y down by 5', () => {
  // Going east past edge: y decreases (matches CPU backend code).
  const r = lookupNeighbor(9, 50, 1, 0, 10, 100, 5);
  assert.deepEqual(r, { x: 0, y: 45 });
});
test('lookupNeighbor with shift=5 going west shifts y up by 5', () => {
  const r = lookupNeighbor(0, 50, -1, 0, 10, 100, 5);
  assert.deepEqual(r, { x: 9, y: 55 });
});
test('lookupNeighbor with shift returns null when wrap goes off top/bottom', () => {
  // y=2, going east with shift=5 → ny = 2 - 5 = -3, out of bounds.
  const r = lookupNeighbor(9, 2, 1, 0, 10, 100, 5);
  assert.equal(r, null);
});
test('lookupNeighbor with shift only applies when actually wrapping', () => {
  // Non-wrapping neighbor (x=5, dx=+1 in width=10) — no shift.
  const r = lookupNeighbor(5, 50, 1, 0, 10, 100, 5);
  assert.deepEqual(r, { x: 6, y: 50 });
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
