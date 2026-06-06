/**
 * Unit tests for custom neighborhoods.
 *
 * Run via: node test/rules/neighborhoods.test.js
 */

import assert from 'node:assert/strict';
import {
  euclideanOffsets,
  transformedEuclideanOffsets,
  rotationMatrix,
  scaleMatrix,
  shearMatrix,
  rotatedScaleMatrix,
  matMul,
  Neighborhood,
  MOORE_NEIGHBORHOOD,
  getNeighborhood,
  listNeighborhoods,
  registerNeighborhood,
  neighborhoodFromRadius,
  neighborhoodFromTransform,
} from '../../src/rules/neighborhoods.js';
import { CompiledRuleset, CONWAY } from '../../src/rules/ruleset.js';

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

section('euclideanOffsets:');

test('r=1 gives 4 orthogonal neighbors', () => {
  const off = euclideanOffsets(1.0);
  assert.equal(off.length, 4);
  const set = new Set(off.map(([x, y]) => `${x},${y}`));
  assert.ok(set.has('1,0'));
  assert.ok(set.has('-1,0'));
  assert.ok(set.has('0,1'));
  assert.ok(set.has('0,-1'));
});

test('r=√2 gives Moore (8 cells)', () => {
  const off = euclideanOffsets(Math.SQRT2);
  assert.equal(off.length, 8);
});

test('r=1.9 still gives 8 cells (no new lattice points crossed)', () => {
  const off = euclideanOffsets(1.9);
  assert.equal(off.length, 8);
});

test('r=2.0 gives 12 cells (Moore + 4 orthogonals at distance 2)', () => {
  const off = euclideanOffsets(2.0);
  assert.equal(off.length, 12);
  const set = new Set(off.map(([x, y]) => `${x},${y}`));
  assert.ok(set.has('2,0'));
  assert.ok(set.has('-2,0'));
  assert.ok(set.has('0,2'));
  assert.ok(set.has('0,-2'));
});

test('r=√5 (≈2.236) gives 20 cells', () => {
  const off = euclideanOffsets(Math.sqrt(5));
  assert.equal(off.length, 20);
  const set = new Set(off.map(([x, y]) => `${x},${y}`));
  assert.ok(set.has('2,1'));
  assert.ok(set.has('1,2'));
});

test('r=2.6 gives 20 cells (excludes √8 ≈ 2.828 and 3)', () => {
  const off = euclideanOffsets(2.6);
  assert.equal(off.length, 20);
  const set = new Set(off.map(([x, y]) => `${x},${y}`));
  assert.ok(!set.has('2,2'));
  assert.ok(!set.has('3,0'));
});

test('r=3.0 gives 28 cells', () => {
  const off = euclideanOffsets(3.0);
  assert.equal(off.length, 28);
});

test('all offsets exclude origin', () => {
  for (const r of [1, 1.5, 2, 2.6, 3]) {
    const off = euclideanOffsets(r);
    for (const [dx, dy] of off) {
      assert.ok(dx !== 0 || dy !== 0, `r=${r}: origin should be excluded`);
    }
  }
});

section('transformedEuclideanOffsets:');

test('identity transform matches euclidean', () => {
  const id = [
    [1, 0],
    [0, 1],
  ];
  const a = transformedEuclideanOffsets(2.0, id);
  const b = euclideanOffsets(2.0);
  assert.equal(a.length, b.length);
});

test('horizontal stretch (sx=0.5) includes far-horizontal cells', () => {
  // sx=0.5 means horizontal distance is halved → reach is doubled.
  const off = transformedEuclideanOffsets(2.0, [
    [0.5, 0],
    [0, 1.0],
  ]);
  const set = new Set(off.map(([x, y]) => `${x},${y}`));
  assert.ok(set.has('4,0'), 'should reach (4,0) with sx=0.5, r=2');
  assert.ok(!set.has('0,3'), 'should NOT reach (0,3) (vertical still r=2)');
});

test('vertical stretch (sy=0.5) includes far-vertical cells', () => {
  const off = transformedEuclideanOffsets(2.0, [
    [1.0, 0],
    [0, 0.5],
  ]);
  const set = new Set(off.map(([x, y]) => `${x},${y}`));
  assert.ok(set.has('0,4'));
  assert.ok(!set.has('3,0'));
});

test('shear matrix produces an asymmetric set', () => {
  const off = transformedEuclideanOffsets(2.0, shearMatrix(0.5));
  // The set should not be horizontally symmetric.
  const set = new Set(off.map(([x, y]) => `${x},${y}`));
  let asymmetric = false;
  for (const [dx, dy] of off) {
    if (!set.has(`${-dx},${dy}`)) {
      asymmetric = true;
      break;
    }
  }
  assert.ok(asymmetric, 'sheared neighborhood should not be x-symmetric');
});

section('matrix helpers:');

test('rotationMatrix(0) is identity', () => {
  const R = rotationMatrix(0);
  assert.ok(Math.abs(R[0][0] - 1) < 1e-9);
  assert.ok(Math.abs(R[1][1] - 1) < 1e-9);
  assert.ok(Math.abs(R[0][1]) < 1e-9);
  assert.ok(Math.abs(R[1][0]) < 1e-9);
});

test('rotationMatrix(π/2) rotates (1,0) to (0,1)', () => {
  const R = rotationMatrix(Math.PI / 2);
  const x = R[0][0] * 1 + R[0][1] * 0;
  const y = R[1][0] * 1 + R[1][1] * 0;
  assert.ok(Math.abs(x) < 1e-9);
  assert.ok(Math.abs(y - 1) < 1e-9);
});

test('matMul: identity × A = A', () => {
  const I = [
    [1, 0],
    [0, 1],
  ];
  const A = [
    [2, 3],
    [4, 5],
  ];
  const result = matMul(I, A);
  assert.deepEqual(result, A);
});

test('rotatedScaleMatrix produces a 2x2 matrix', () => {
  const T = rotatedScaleMatrix(Math.PI / 4, 0.5, 1.0);
  assert.equal(T.length, 2);
  assert.equal(T[0].length, 2);
});

section('Neighborhood class:');

test('MOORE_NEIGHBORHOOD has 8 cells', () => {
  assert.equal(MOORE_NEIGHBORHOOD.size, 8);
  assert.equal(MOORE_NEIGHBORHOOD.offsets.length, 8);
});

test('Neighborhood computes correct bounds', () => {
  const n = new Neighborhood({
    id: 'test',
    name: 'Test',
    offsets: [
      [-2, 0],
      [0, 0],
      [3, 1],
    ],
  });
  assert.equal(n.bounds.minX, -2);
  assert.equal(n.bounds.maxX, 3);
  assert.equal(n.bounds.minY, 0);
  assert.equal(n.bounds.maxY, 1);
});

section('Registry:');

test('built-in neighborhoods are accessible', () => {
  assert.ok(getNeighborhood('moore'));
  assert.ok(getNeighborhood('eucl_2'));
  assert.ok(getNeighborhood('eucl_2_6'));
  assert.ok(getNeighborhood('aniso_horiz_stretch'));
});

test('listNeighborhoods returns array', () => {
  const all = listNeighborhoods();
  assert.ok(Array.isArray(all));
  assert.ok(all.length >= 5);
});

test('registerNeighborhood stores custom', () => {
  const custom = neighborhoodFromRadius(2.0, 'test_custom_r2');
  registerNeighborhood(custom);
  assert.ok(getNeighborhood('test_custom_r2'));
});

section('CompiledRuleset with custom neighborhood:');

test('Conway defaults to Moore', () => {
  const c = new CompiledRuleset(CONWAY);
  assert.equal(c.neighborhood.id, 'moore');
  assert.equal(c.neighborhood.size, 8);
});

test('Rule with neighborhood field uses that neighborhood', () => {
  const def = {
    id: 'test_r2',
    name: 'Test r=2',
    notation: 'B3/S23',
    description: '',
    birth: [3],
    survival: [2, 3],
    neighborhood: 'eucl_2',
  };
  const c = new CompiledRuleset(def);
  assert.equal(c.neighborhood.id, 'eucl_2');
  assert.equal(c.neighborhood.size, 12);
  // Tables sized for the neighborhood.
  assert.equal(c.birthTable.length, 13);
  assert.equal(c.survivalTable.length, 13);
});

test('Unknown neighborhood falls back to Moore', () => {
  const def = {
    id: 'test_unknown',
    name: 'Unknown',
    notation: 'B3/S23',
    description: '',
    birth: [3],
    survival: [2, 3],
    neighborhood: 'this_does_not_exist',
  };
  const c = new CompiledRuleset(def);
  assert.equal(c.neighborhood.id, 'moore');
});

test('Threshold rule on r=3.0 neighborhood compiles correctly', () => {
  const def = {
    id: 'test_threshold',
    name: 'Threshold',
    notation: 'B9-12/S8-13',
    description: '',
    birth: [9, 10, 11, 12],
    survival: [8, 9, 10, 11, 12, 13],
    neighborhood: 'eucl_3',
  };
  const c = new CompiledRuleset(def);
  assert.equal(c.shouldBirth(10), true);
  assert.equal(c.shouldBirth(5), false);
  assert.equal(c.shouldSurvive(13), true);
  assert.equal(c.shouldSurvive(14), false);
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
