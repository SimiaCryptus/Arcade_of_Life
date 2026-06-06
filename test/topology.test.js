/**
 * Tests for the topology module: square, hex, tri.
 *
 * Run via:  node test/topology.test.js
 */

import assert from 'node:assert/strict';
import {
  getTopology,
  listTopologies,
  SQUARE_TOPOLOGY,
  HEX_TOPOLOGY,
  TRI_TOPOLOGY,
} from '../src/topology.js';

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

section('Square topology:');
test('arraySize is W*H', () => {
  assert.equal(SQUARE_TOPOLOGY.arraySize(10, 10), 100);
  assert.equal(SQUARE_TOPOLOGY.arraySize(50, 30), 1500);
});
test('index/unindex round-trip', () => {
  const i = SQUARE_TOPOLOGY.index(3, 7, 10);
  assert.equal(i, 73);
  const [x, y] = SQUARE_TOPOLOGY.unindex(73, 10);
  assert.equal(x, 3);
  assert.equal(y, 7);
});
test('cellPolygon has 4 vertices', () => {
  const verts = SQUARE_TOPOLOGY.cellPolygon(2, 3, 10);
  assert.equal(verts.length, 4);
});
test('pixelToCell inverts cellToPixel', () => {
  for (let x = 0; x < 5; x++) {
    for (let y = 0; y < 5; y++) {
      const center = SQUARE_TOPOLOGY.cellCenter(x, y, 10);
      const cell = SQUARE_TOPOLOGY.pixelToCell(center.px, center.py, 10);
      assert.equal(cell.x, x);
      assert.equal(cell.y, y);
    }
  }
});
test('Moore neighborhood has 8 cells', () => {
  assert.equal(SQUARE_TOPOLOGY.defaultOffsets.length, 8);
});

section('Hex topology:');
test('arraySize is W*H', () => {
  assert.equal(HEX_TOPOLOGY.arraySize(10, 10), 100);
});
test('cellPolygon has 6 vertices', () => {
  const verts = HEX_TOPOLOGY.cellPolygon(2, 3, 10);
  assert.equal(verts.length, 6);
});
test('default has 6 edge neighbors', () => {
  assert.equal(HEX_TOPOLOGY.defaultOffsets.length, 6);
});
test('extended has 18 neighbors (6 + 12)', () => {
  assert.equal(HEX_TOPOLOGY.extendedOffsets.length, 18);
});
test('all hex neighbor offsets unique', () => {
  const set = new Set(HEX_TOPOLOGY.defaultOffsets.map((o) => o.join(',')));
  assert.equal(set.size, 6);
});
test('pixelToCell snaps to nearest hex', () => {
  // Pick a hex, get its center, round-trip.
  const center = HEX_TOPOLOGY.cellCenter(3, 4, 20);
  const cell = HEX_TOPOLOGY.pixelToCell(center.px, center.py, 20);
  assert.equal(cell.x, 3);
  assert.equal(cell.y, 4);
});

section('Triangular topology:');
test('arraySize is 2*W*H', () => {
  assert.equal(TRI_TOPOLOGY.arraySize(10, 10), 200);
});
test('index considers orientation', () => {
  const i0 = TRI_TOPOLOGY.index(3, 4, 10, 0);
  const i1 = TRI_TOPOLOGY.index(3, 4, 10, 1);
  assert.notEqual(i0, i1);
  assert.equal(i1 - i0, 1);
});
test('cellPolygon has 3 vertices', () => {
  const verts = TRI_TOPOLOGY.cellPolygon(2, 3, 10, 0);
  assert.equal(verts.length, 3);
});
test('upward triangle (orient=0) has apex on top', () => {
  const verts = TRI_TOPOLOGY.cellPolygon(0, 0, 10, 0);
  // The apex should have the smallest y.
  const minY = Math.min(...verts.map((v) => v[1]));
  const apexCount = verts.filter((v) => v[1] === minY).length;
  assert.equal(apexCount, 1, 'upward triangle should have exactly one top vertex');
});
test('downward triangle (orient=1) has apex on bottom', () => {
  const verts = TRI_TOPOLOGY.cellPolygon(0, 0, 10, 1);
  const maxY = Math.max(...verts.map((v) => v[1]));
  const apexCount = verts.filter((v) => v[1] === maxY).length;
  assert.equal(apexCount, 1);
});
test('upward triangle has 3 edge neighbors (all downward)', () => {
  const offsets = TRI_TOPOLOGY.getEdgeOffsetsForCell(0);
  assert.equal(offsets.length, 3);
  for (const [, , o] of offsets) {
    assert.equal(o, 1, 'edge neighbors of △ must all be ▽');
  }
});
test('upward triangle has 12 total neighbors', () => {
  const offsets = TRI_TOPOLOGY.getOffsetsForCell(0);
  assert.equal(offsets.length, 12);
});
test('downward triangle has 12 total neighbors', () => {
  const offsets = TRI_TOPOLOGY.getOffsetsForCell(1);
  assert.equal(offsets.length, 12);
});

section('Registry:');
test('getTopology returns the right topology', () => {
  assert.equal(getTopology('square'), SQUARE_TOPOLOGY);
  assert.equal(getTopology('hex'), HEX_TOPOLOGY);
  assert.equal(getTopology('tri'), TRI_TOPOLOGY);
});
test('unknown topology falls back to square', () => {
  assert.equal(getTopology('nonexistent'), SQUARE_TOPOLOGY);
});
test('listTopologies returns all 3', () => {
  assert.equal(listTopologies().length, 3);
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
