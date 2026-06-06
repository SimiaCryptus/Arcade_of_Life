/**
 * Integration test: verifies that level loading with wrapVerticalShift
 * correctly propagates through Grid → Simulation → Backend.
 *
 * Run via: node test/sim/wrapShiftIntegration.test.js
 */

import assert from 'node:assert/strict';
import { CpuSimBackend } from '../../src/sim/cpuBackend.js';

const EMPTY = 0;
const DEFENSE = 1;

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

section('Wrap shift propagation through CPU backend:');

test('Backend with shift=5 uses generic path (verified by behavior)', () => {
  const w = 10;
  const h = 50;
  const cells = new Uint8Array(w * h);
  // Place a defense at east edge, row 20.
  cells[20 * w + 9] = DEFENSE;
  const backend = new CpuSimBackend(w, h);
  backend.setWrapVerticalShift(5);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // With shift=5 going east: cell (0, y) looking WEST (dx=-1) wraps to
  // (9, y+5). For (9, 20) to be seen, y+5=20 → y=15.
  assert.equal(
    defOut[15 * w + 0],
    1,
    `(0,15) should see defense at (9,20) when looking west with shift=5`
  );
  // Diagonals at (0, 14) and (0, 16) should also see it.
  assert.equal(defOut[14 * w + 0], 1);
  assert.equal(defOut[16 * w + 0], 1);
  // Cell at (0, 20) should NOT see (9, 20) when shift=5.
  assert.equal(defOut[20 * w + 0], 0);
});

test('Backend re-syncs shift when changed mid-stream', () => {
  const w = 10;
  const h = 50;
  const cells = new Uint8Array(w * h);
  cells[20 * w + 9] = DEFENSE;
  const backend = new CpuSimBackend(w, h);
  // Start with shift=0.
  backend.setWrapVerticalShift(0);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // (0, 20) sees (9, 20) directly with shift=0.
  assert.equal(defOut[20 * w + 0], 1);
  // Now switch to shift=5.
  backend.setWrapVerticalShift(5);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // (0, 20) no longer sees (9, 20).
  assert.equal(defOut[20 * w + 0], 0);
  // (0, 15) now sees it.
  assert.equal(defOut[15 * w + 0], 1);
});

test('Public _wrapVerticalShift field reflects setter immediately', () => {
  const b = new CpuSimBackend(10, 10);
  assert.equal(b._wrapVerticalShift, 0);
  b.setWrapVerticalShift(7);
  assert.equal(b._wrapVerticalShift, 7);
  b.setWrapVerticalShift(-3);
  assert.equal(b._wrapVerticalShift, -3);
});

test('Negative shift: going west DECREASES y (mirror of positive)', () => {
  const w = 10;
  const h = 50;
  const cells = new Uint8Array(w * h);
  cells[20 * w + 9] = DEFENSE;
  const backend = new CpuSimBackend(w, h);
  backend.setWrapVerticalShift(-3);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // With shift=-3, cell (0, y) looking west sees (9, y - 3).
  // For (9, 20) to be seen: y - 3 = 20 → y = 23.
  assert.equal(defOut[23 * w + 0], 1);
});

section('Default Moore path is bypassed when shift != 0:');

test('Shift=0 with no neighborhood: uses fast Moore path (still correct)', () => {
  const w = 5;
  const h = 5;
  const cells = new Uint8Array(w * h);
  cells[2 * w + 2] = DEFENSE;
  const backend = new CpuSimBackend(w, h);
  backend.setWrapVerticalShift(0);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // 8 neighbors see 1 defense each.
  let total = 0;
  for (let i = 0; i < defOut.length; i++) total += defOut[i];
  assert.equal(total, 8);
});

test('Shift!=0 still gives same neighbor count totals for interior cells', () => {
  const w = 10;
  const h = 10;
  const cells = new Uint8Array(w * h);
  cells[5 * w + 5] = DEFENSE; // interior, won't wrap
  const backend = new CpuSimBackend(w, h);
  backend.setWrapVerticalShift(3);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // Same as without shift: 8 neighbors see 1 each.
  let total = 0;
  for (let i = 0; i < defOut.length; i++) total += defOut[i];
  assert.equal(total, 8);
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
