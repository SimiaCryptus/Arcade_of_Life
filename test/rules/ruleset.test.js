/**
 * Unit tests for the ruleset module.
 *
 * Runnable via `node test/rules/ruleset.test.js`.
 */

import assert from 'node:assert/strict';
import {
  registerRuleset,
  getRuleset,
  listRulesets,
  parseBSNotation,
  formatBSNotation,
  rulesetFromNotation,
  CompiledRuleset,
  getActiveRuleset,
  setActiveRuleset,
  CONWAY,
  HIGHLIFE,
  SEEDS,
} from '../../src/rules/ruleset.js';

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

console.log('Ruleset tests:');

// ── B/S notation parsing ─────────────────────────────────────────────
test('parseBSNotation: parses Conway B3/S23', () => {
  const r = parseBSNotation('B3/S23');
  assert.deepEqual(r.birth, [3]);
  assert.deepEqual(r.survival, [2, 3]);
});

test('parseBSNotation: parses HighLife B36/S23', () => {
  const r = parseBSNotation('B36/S23');
  assert.deepEqual(r.birth, [3, 6]);
  assert.deepEqual(r.survival, [2, 3]);
});

test('parseBSNotation: parses Seeds B2/S (empty survival)', () => {
  const r = parseBSNotation('B2/S');
  assert.deepEqual(r.birth, [2]);
  assert.deepEqual(r.survival, []);
});

test('parseBSNotation: case-insensitive', () => {
  const r = parseBSNotation('b3/s23');
  assert.deepEqual(r.birth, [3]);
  assert.deepEqual(r.survival, [2, 3]);
});

test('parseBSNotation: deduplicates and sorts', () => {
  const r = parseBSNotation('B33/S32');
  assert.deepEqual(r.birth, [3]);
  assert.deepEqual(r.survival, [2, 3]);
});

test('parseBSNotation: returns null on bad input', () => {
  assert.equal(parseBSNotation('garbage'), null);
  assert.equal(parseBSNotation(''), null);
  assert.equal(parseBSNotation(null), null);
  assert.equal(parseBSNotation('B9/S3'), null); // 9 is invalid
  assert.equal(parseBSNotation('   '), null); // whitespace only
  assert.equal(parseBSNotation('/'), null); // empty both sides
});

test('formatBSNotation: round-trips', () => {
  const cases = ['B3/S23', 'B36/S23', 'B2/S', 'B3/S012345678'];
  for (const c of cases) {
    const parsed = parseBSNotation(c);
    const formatted = formatBSNotation(parsed.birth, parsed.survival);
    assert.equal(formatted, c, `round-trip failed for ${c}`);
  }
});

// ── rulesetFromNotation ──────────────────────────────────────────────
test('rulesetFromNotation: builds valid ruleset', () => {
  const r = rulesetFromNotation({
    id: 'test_b3s23',
    name: 'Test',
    notation: 'B3/S23',
  });
  assert.equal(r.id, 'test_b3s23');
  assert.deepEqual(r.birth, [3]);
  assert.deepEqual(r.survival, [2, 3]);
});

test('rulesetFromNotation: throws on invalid notation', () => {
  assert.throws(() =>
    rulesetFromNotation({
      id: 'bad',
      name: 'Bad',
      notation: 'garbage',
    })
  );
});

// ── Registry ─────────────────────────────────────────────────────────
test('Registry: built-in rulesets are present', () => {
  assert.ok(getRuleset('conway'), 'missing conway');
  assert.ok(getRuleset('highlife'), 'missing highlife');
  assert.ok(getRuleset('seeds'), 'missing seeds');
  assert.ok(getRuleset('day_night'), 'missing day_night');
});

test('Registry: list returns array', () => {
  const all = listRulesets();
  assert.ok(Array.isArray(all));
  assert.ok(all.length >= 5);
});

test('Registry: rejects ruleset without id', () => {
  assert.throws(() => registerRuleset({ name: 'no id' }));
});

test('Registry: rejects invalid neighbor values', () => {
  assert.throws(() =>
    registerRuleset({
      id: 'bad1',
      name: 'Bad',
      birth: [9],
      survival: [],
    })
  );
  assert.throws(() =>
    registerRuleset({
      id: 'bad2',
      name: 'Bad',
      birth: [-1],
      survival: [],
    })
  );
});

test('Registry: re-registration overrides', () => {
  registerRuleset({
    id: 'overridable',
    name: 'V1',
    notation: 'B3/S23',
    birth: [3],
    survival: [2, 3],
  });
  registerRuleset({
    id: 'overridable',
    name: 'V2',
    notation: 'B3/S23',
    birth: [3],
    survival: [2, 3],
  });
  assert.equal(getRuleset('overridable').name, 'V2');
});

// ── CompiledRuleset ──────────────────────────────────────────────────
test('CompiledRuleset: Conway birth at 3 only', () => {
  const c = new CompiledRuleset(CONWAY);
  assert.equal(c.shouldBirth(0), false);
  assert.equal(c.shouldBirth(2), false);
  assert.equal(c.shouldBirth(3), true);
  assert.equal(c.shouldBirth(4), false);
  assert.equal(c.shouldBirth(8), false);
});

test('CompiledRuleset: Conway survival at 2 and 3', () => {
  const c = new CompiledRuleset(CONWAY);
  assert.equal(c.shouldSurvive(0), false);
  assert.equal(c.shouldSurvive(1), false);
  assert.equal(c.shouldSurvive(2), true);
  assert.equal(c.shouldSurvive(3), true);
  assert.equal(c.shouldSurvive(4), false);
});

test('CompiledRuleset: HighLife birth at 3 and 6', () => {
  const c = new CompiledRuleset(HIGHLIFE);
  assert.equal(c.shouldBirth(3), true);
  assert.equal(c.shouldBirth(6), true);
  assert.equal(c.shouldBirth(5), false);
});

test('CompiledRuleset: Seeds never survive', () => {
  const c = new CompiledRuleset(SEEDS);
  for (let n = 0; n <= 8; n++) {
    assert.equal(c.shouldSurvive(n), false, `Seeds.shouldSurvive(${n}) should be false`);
  }
});

// ── Active ruleset ───────────────────────────────────────────────────
test('getActiveRuleset: defaults to Conway', () => {
  const a = getActiveRuleset();
  assert.equal(a.def.id, 'conway');
});

test('setActiveRuleset: switches active', () => {
  const ok = setActiveRuleset('highlife');
  assert.equal(ok, true);
  assert.equal(getActiveRuleset().def.id, 'highlife');
  // Restore for other tests.
  setActiveRuleset('conway');
});

test('setActiveRuleset: unknown id returns false', () => {
  const ok = setActiveRuleset('does_not_exist');
  assert.equal(ok, false);
  assert.equal(getActiveRuleset().def.id, 'conway');
});

// ── Done ─────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
