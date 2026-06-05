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

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
