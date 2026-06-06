/**
 * Integration test for wrapVerticalShift behavior in the CPU backend.
 *
 * Verifies that a single live cell placed near the east edge correctly
 * influences neighbors on the west edge with the appropriate vertical
 * shift applied.
 *
 * Run via: node test/sim/wrapShift.test.js
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

section('CpuSimBackend wrap shift integration:');

test('setWrapVerticalShift method exists and stores value', () => {
  const b = new CpuSimBackend(20, 20);
  assert.equal(typeof b.setWrapVerticalShift, 'function');
  b.setWrapVerticalShift(5);
  assert.equal(b._wrapVerticalShift, 5);
});

test('default shift is 0', () => {
  const b = new CpuSimBackend(20, 20);
  assert.equal(b._wrapVerticalShift, 0);
});

test('shift=0: east edge cell influences west edge at same y (Moore fast path)', () => {
  const w = 10,
    h = 10;
  const cells = new Uint8Array(w * h);
  // Place a defense at east edge, middle row.
  cells[5 * w + 9] = DEFENSE;
  const backend = new CpuSimBackend(w, h);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // West edge at same y should see the wrapped neighbor.
  assert.equal(defOut[5 * w + 0], 1, `(0,5) should see east-edge neighbor at (9,5) via wrap`);
});

test('shift=3: east-edge cell influences west edge at y-3 (generic path)', () => {
  const w = 10,
    h = 20;
  const cells = new Uint8Array(w * h);
  // Place a defense at east edge, row 10.
  cells[10 * w + 9] = DEFENSE;
  const backend = new CpuSimBackend(w, h);
  backend.setWrapVerticalShift(3);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // West edge cell at (0, 7) — looking east (dx=+1) wraps to (9, 7-3=4)? No.
  // Wait: the lookup direction matters.
  // For cell (0, y) looking east (dx=+1): nx = 1 (no wrap), no shift applied.
  // For cell (9, y) looking east (dx=+1): nx = 10 → nx>=w → wrap.
  //   ny -= shift → ny = y - 3, nx = 0.
  // So cell (9, y) sees neighbor at (0, y-3).
  // Equivalently, cell (0, y) sees neighbor at (9, y+3) when looking WEST.
  //
  // We placed defense at (9, 10). Which cells see it?
  // Cell (0, y) looking WEST: dx=-1 → nx=-1 → wrap → nx=9, ny += shift.
  //   So cell (0, y) sees (9, y+3). For (9, 10) to be seen, y+3=10 → y=7.
  assert.equal(
    defOut[7 * w + 0],
    1,
    `(0,7) should see defense at (9,10) when looking west with shift=3`
  );
  // And cell (9, y) looking EAST: dx=+1 → nx=10 → wrap → nx=0, ny -= shift.
  //   So cell (9, y) sees (0, y-3). Defense is at (9, 10) not (0, *) so no.
  // But cell (0, y) sees (9, y+3) covering the y=7 row above.
  // Cells at (0, 6) and (0, 8) should also see it via diagonal lookup.
  // (0, 6) looking west-down: dx=-1, dy=+1 → nx=-1, ny=7. After wrap: nx=9, ny=7+3=10. ✓
  assert.equal(defOut[6 * w + 0], 1, `(0,6) should see defense at (9,10) via diagonal+shift`);
  // (0, 8) looking west-up: dx=-1, dy=-1 → nx=-1, ny=7. After wrap: nx=9, ny=7+3=10. ✓
  assert.equal(defOut[8 * w + 0], 1, `(0,8) should see defense at (9,10) via diagonal+shift`);
});

test('shift=3: cells at wrong y do NOT see the wrapped neighbor', () => {
  const w = 10,
    h = 20;
  const cells = new Uint8Array(w * h);
  cells[10 * w + 9] = DEFENSE;
  const backend = new CpuSimBackend(w, h);
  backend.setWrapVerticalShift(3);
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // (0, 10) without shift would see (9, 10), but with shift=3 it sees (9, 13).
  // (9, 13) is empty, so defOut should be 0.
  assert.equal(
    defOut[10 * w + 0],
    0,
    `(0,10) should NOT see defense at (9,10) when shift=3 is active`
  );
});

test('shift=0 forces fast path even after a non-zero shift was set', () => {
  const w = 10,
    h = 10;
  const cells = new Uint8Array(w * h);
  cells[5 * w + 9] = DEFENSE;
  const backend = new CpuSimBackend(w, h);
  backend.setWrapVerticalShift(5);
  backend.setWrapVerticalShift(0); // reset
  const lifeOut = new Uint8Array(w * h);
  const missOut = new Uint8Array(w * h);
  const defOut = new Uint8Array(w * h);
  backend.computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut);
  // With shift=0, (0, 5) sees (9, 5) directly.
  assert.equal(defOut[5 * w + 0], 1);
  // (0, 8) should NOT see (9, 5) when shift=0.
  assert.equal(defOut[8 * w + 0], 0);
});

test('shift sync: backend property reflects setter calls', () => {
  const b = new CpuSimBackend(10, 10);
  b.setWrapVerticalShift(7);
  assert.equal(b._wrapVerticalShift, 7);
  // Also writable directly (legacy path).
  b._wrapVerticalShift = 2;
  const cells = new Uint8Array(100);
  cells[5 * 10 + 9] = DEFENSE;
  const lifeOut = new Uint8Array(100);
  const missOut = new Uint8Array(100);
  const defOut = new Uint8Array(100);
  b.computeNeighborCounts(cells, 10, 10, lifeOut, missOut, defOut);
  // With shift=2, (0, y) looking west sees (9, y+2). Defense at (9,5) → y=3.
  assert.equal(defOut[3 * 10 + 0], 1);
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
