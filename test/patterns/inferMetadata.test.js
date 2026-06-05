/**
 * Tests for inferPatternMetadata().
 *
 * Runs via: node test/patterns/inferMetadata.test.js
 */

import assert from 'node:assert/strict';
import {
  inferPatternMetadata,
  directionFromDisplacement,
} from '../../src/patterns/inferMetadata.js';
import { getPattern } from '../../src/patterns/library.js';

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

section('directionFromDisplacement:');
test('axial directions', () => {
  assert.equal(directionFromDisplacement(0, -1), 'N');
  assert.equal(directionFromDisplacement(0, 1), 'S');
  assert.equal(directionFromDisplacement(1, 0), 'E');
  assert.equal(directionFromDisplacement(-1, 0), 'W');
});
test('diagonal directions', () => {
  assert.equal(directionFromDisplacement(1, 1), 'SE');
  assert.equal(directionFromDisplacement(-1, -1), 'NW');
});
test('zero returns null', () => {
  assert.equal(directionFromDisplacement(0, 0), null);
});

section('inferPatternMetadata: built-in patterns:');

test('block → still_life period 1', () => {
  const p = getPattern('block');
  const r = inferPatternMetadata(p.cells.map((c) => [c[0], c[1]]));
  assert.equal(r.category, 'still_life');
  assert.equal(r.period, 1);
});

test('blinker → oscillator period 2', () => {
  const p = getPattern('blinker');
  const r = inferPatternMetadata(p.cells.map((c) => [c[0], c[1]]));
  assert.equal(r.category, 'oscillator');
  assert.equal(r.period, 2);
});

test('toad → oscillator period 2', () => {
  const p = getPattern('toad');
  const r = inferPatternMetadata(p.cells.map((c) => [c[0], c[1]]));
  assert.equal(r.category, 'oscillator');
  assert.equal(r.period, 2);
});

test('pulsar → oscillator period 3', () => {
  const p = getPattern('pulsar');
  const r = inferPatternMetadata(p.cells.map((c) => [c[0], c[1]]));
  assert.equal(r.category, 'oscillator');
  assert.equal(r.period, 3);
});

test('glider → spaceship SE period 4', () => {
  const p = getPattern('glider');
  const r = inferPatternMetadata(p.cells.map((c) => [c[0], c[1]]));
  assert.equal(r.category, 'spaceship');
  assert.equal(r.period, 4);
  assert.equal(r.direction, 'SE');
});

test('lwss → spaceship period 4 (some W direction)', () => {
  const p = getPattern('lwss');
  const r = inferPatternMetadata(p.cells.map((c) => [c[0], c[1]]));
  assert.equal(r.category, 'spaceship');
  assert.equal(r.period, 4);
  assert.equal(r.direction, 'W');
});

test('rpentomino → methuselah (with enough generations)', () => {
  const p = getPattern('rpentomino');
  const r = inferPatternMetadata(
    p.cells.map((c) => [c[0], c[1]]),
    {
      maxPeriod: 20,
      methuselahGens: 200,
    }
  );
  assert.equal(r.category, 'methuselah');
});

test('diehard → dies (categorized as misc)', () => {
  const p = getPattern('diehard');
  const r = inferPatternMetadata(
    p.cells.map((c) => [c[0], c[1]]),
    {
      maxPeriod: 20,
      methuselahGens: 200,
    }
  );
  // Dies fully; categorized as misc.
  assert.equal(r.category, 'misc');
  assert.ok(r.notes.some((n) => /died/.test(n)));
});

test('empty input handled', () => {
  const r = inferPatternMetadata([]);
  assert.equal(r.category, 'misc');
  assert.equal(r.period, 0);
});

test('explicit rule B3/S23 still gives correct results', () => {
  const p = getPattern('blinker');
  const r = inferPatternMetadata(
    p.cells.map((c) => [c[0], c[1]]),
    { rule: 'B3/S23' }
  );
  assert.equal(r.category, 'oscillator');
  assert.equal(r.period, 2);
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
