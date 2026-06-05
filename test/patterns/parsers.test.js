/**
 * Unit tests for the pattern file parsers.
 *
 * Runs via:  node test/patterns/parsers.test.js
 */

import assert from 'node:assert/strict';
import { parseCells, parseRLE, parsePatternFile } from '../../src/patterns/parsers.js';

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

// ─────────────────────────────────────────────────────────────────────
section('parseCells:');
// ─────────────────────────────────────────────────────────────────────

test('parses simple block', () => {
  const text = `!Name: Block\n!Author: Test\nOO\nOO\n`;
  const { cells, meta } = parseCells(text);
  assert.equal(meta.name, 'Block');
  assert.equal(meta.author, 'Test');
  assert.equal(cells.length, 4);
  const set = new Set(cells.map((c) => c.join(',')));
  assert.ok(set.has('0,0'));
  assert.ok(set.has('1,0'));
  assert.ok(set.has('0,1'));
  assert.ok(set.has('1,1'));
});

test('accepts * as live char', () => {
  const text = `***\n`;
  const { cells } = parseCells(text);
  assert.equal(cells.length, 3);
});

test('blinker parses to 3 horizontal cells', () => {
  const text = `OOO\n`;
  const { cells } = parseCells(text);
  assert.deepEqual(
    cells.sort(),
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ].sort()
  );
});

test('captures comments', () => {
  const text = `!Glider\n!Discovered by Conway\nO\n`;
  const { meta } = parseCells(text);
  assert.ok(meta.comments.length >= 1);
});

// ─────────────────────────────────────────────────────────────────────
section('parseRLE:');
// ─────────────────────────────────────────────────────────────────────

test('parses glider RLE', () => {
  const text = `#N Glider\n#O Conway\nx = 3, y = 3, rule = B3/S23\nbob$2bo$3o!\n`;
  const { cells, meta } = parseRLE(text);
  assert.equal(meta.name, 'Glider');
  assert.equal(meta.author, 'Conway');
  assert.equal(meta.rule, 'B3/S23');
  assert.equal(meta.width, 3);
  assert.equal(meta.height, 3);
  assert.equal(cells.length, 5);
  const set = new Set(cells.map((c) => c.join(',')));
  assert.ok(set.has('1,0'));
  assert.ok(set.has('2,1'));
  assert.ok(set.has('0,2'));
  assert.ok(set.has('1,2'));
  assert.ok(set.has('2,2'));
});

test('handles run lengths greater than 9', () => {
  const text = `x = 12, y = 1, rule = B3/S23\n12o!\n`;
  const { cells } = parseRLE(text);
  assert.equal(cells.length, 12);
});

test('handles multi-row $ run', () => {
  const text = `x = 1, y = 3, rule = B3/S23\no2$o!\n`;
  const { cells } = parseRLE(text);
  assert.deepEqual(
    cells.sort(),
    [
      [0, 0],
      [0, 2],
    ].sort()
  );
});

test('parses without header (lenient)', () => {
  const text = `bob$2bo$3o!`;
  const { cells } = parseRLE(text);
  assert.equal(cells.length, 5);
});

test('stops at !', () => {
  const text = `x = 3, y = 1\no!ob\n`;
  const { cells } = parseRLE(text);
  assert.equal(cells.length, 1);
});

// ─────────────────────────────────────────────────────────────────────
section('parsePatternFile dispatch:');
// ─────────────────────────────────────────────────────────────────────

test('dispatches .rle by extension', () => {
  const r = parsePatternFile('foo.rle', `x = 1, y = 1\no!`);
  assert.ok(r);
  assert.equal(r.cells.length, 1);
});

test('dispatches .cells by extension', () => {
  const r = parsePatternFile('foo.cells', `O\n`);
  assert.ok(r);
  assert.equal(r.cells.length, 1);
});

test('sniffs RLE from content if no extension', () => {
  const r = parsePatternFile('mystery', `x = 1, y = 1\no!`);
  assert.ok(r);
  assert.equal(r.cells.length, 1);
});

test('sniffs cells from content if no extension', () => {
  const r = parsePatternFile('mystery', `!Name: Foo\nO\n`);
  assert.ok(r);
  assert.equal(r.cells.length, 1);
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
