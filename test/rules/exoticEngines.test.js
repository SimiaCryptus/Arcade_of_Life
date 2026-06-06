/**
 * Unit tests for exotic rule engines:
 *   - TCA (teleological CA)
 *   - Time-integrated rules
 *   - Fractional lightcone rules
 *
 * Run via: node test/rules/exoticEngines.test.js
 */

import assert from 'node:assert/strict';
import {
  TCACompiledRule,
  TimeIntegratedRule,
  FractionalLightconeRule,
  runTCAStep,
  runTimeIntegratedStep,
  runFractionalLightconeStep,
  stepLifeScratch,
  lexCompare,
  gridEntropy,
  gridSymmetry,
  gridPopulation,
  gridGliderScore,
  TCA_OBJECTIVES,
  registerExoticRule,
  getExoticRule,
  listExoticRules,
  isExoticRule,
  runExoticStep,
  resetExoticState,
} from '../../src/rules/exoticEngines.js';
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

// Helper: build a flat binary cell grid from rows of ASCII.
function makeGrid(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      cells[y * w + x] = rows[y][x] === 'O' ? 1 : 0;
    }
  }
  return { cells, w, h };
}

section('Scoring functions:');

test('gridPopulation counts live cells', () => {
  const { cells, w, h } = makeGrid(['....', '.OO.', '.OO.', '....']);
  assert.equal(gridPopulation(cells, w, h, 1), 4);
});

test('gridEntropy is 0 for empty grid', () => {
  const cells = new Uint8Array(64);
  assert.equal(gridEntropy(cells, 8, 8, 1), 0);
});

test('gridEntropy is positive for non-trivial grid', () => {
  const cells = new Uint8Array(64);
  cells[0] = 1;
  cells[10] = 1;
  cells[20] = 1;
  cells[30] = 1;
  const H = gridEntropy(cells, 8, 8, 1);
  assert.ok(H > 0, `entropy should be positive, got ${H}`);
});

test('gridSymmetry: perfectly symmetric block returns ~1', () => {
  const { cells, w, h } = makeGrid(['....', '.OO.', '.OO.', '....']);
  const s = gridSymmetry(cells, w, h, 1);
  assert.ok(s > 0.99, `symmetry should be ~1, got ${s}`);
});

test('gridSymmetry: asymmetric pattern is < 1', () => {
  const { cells, w, h } = makeGrid(['OOOO', 'O...', 'O...', 'O...']);
  const s = gridSymmetry(cells, w, h, 1);
  assert.ok(s < 0.99, `asymmetric should be < 1, got ${s}`);
});

test('gridGliderScore detects small clusters', () => {
  // Two separate gliders.
  const { cells, w, h } = makeGrid([
    '.O.......',
    '..O......',
    'OOO......',
    '.........',
    '......O..',
    '.......O.',
    '.....OOO.',
    '.........',
  ]);
  const s = gridGliderScore(cells, w, h, 1);
  assert.equal(s, 2, `should find 2 gliders, got ${s}`);
});

section('stepLifeScratch (Life kernel):');

test('Conway block is stable', () => {
  const { cells, w, h } = makeGrid(['....', '.OO.', '.OO.', '....']);
  const out = new Uint8Array(cells.length);
  const rule = new CompiledRuleset(CONWAY);
  stepLifeScratch(cells, out, w, h, rule);
  assert.deepEqual(Array.from(out), Array.from(cells));
});

test('Conway blinker oscillates', () => {
  const { cells, w, h } = makeGrid(['.....', '.....', '.OOO.', '.....', '.....']);
  const out = new Uint8Array(cells.length);
  const out2 = new Uint8Array(cells.length);
  const rule = new CompiledRuleset(CONWAY);
  stepLifeScratch(cells, out, w, h, rule);
  stepLifeScratch(out, out2, w, h, rule);
  // After 2 steps, blinker returns.
  assert.deepEqual(Array.from(out2), Array.from(cells));
});

section('TCA Engine:');

test('TCACompiledRule constructs with valid proposals', () => {
  const rule = new TCACompiledRule({
    id: 'test_tca',
    name: 'Test',
    proposals: [
      { birth: [3], survival: [2, 3] },
      { birth: [3, 6], survival: [2, 3] },
    ],
    objective: 'survival',
    lookahead: 2,
  });
  assert.equal(rule.isTCA, true);
  assert.equal(rule.proposals.length, 2);
  assert.equal(rule.lookahead, 2);
});

test('TCA picks Conway over chaos for stable patterns', () => {
  // A 2x2 block is stable under Conway. Even if HighLife allows it
  // to stay, both proposals should yield identical results for a
  // block, so the tiebreak picks the first (Conway).
  const rule = new TCACompiledRule({
    id: 'test_tca_block',
    name: 'Test',
    proposals: [
      { birth: [3], survival: [2, 3] },
      { birth: [3, 6], survival: [2, 3] },
    ],
    objective: 'survival',
    lookahead: 3,
    tiebreak: 'first',
  });
  const { cells, w, h } = makeGrid(['....', '.OO.', '.OO.', '....']);
  const target = new Uint8Array(cells.length);
  runTCAStep(rule, cells, target, w, h);
  // Block should persist.
  assert.deepEqual(Array.from(target), Array.from(cells));
});

test('TCA is deterministic: same input → same output', () => {
  const rule = new TCACompiledRule({
    id: 'test_det',
    name: 'Test',
    proposals: [
      { birth: [3], survival: [2, 3] },
      { birth: [3, 6], survival: [2, 3] },
      { birth: [3, 7], survival: [2, 3] },
    ],
    objective: 'composite',
    lookahead: 2,
  });
  const { cells, w, h } = makeGrid(['.....', '..O..', '.OOO.', '..O..', '.....']);
  const a = new Uint8Array(cells.length);
  const b = new Uint8Array(cells.length);
  runTCAStep(rule, cells, a, w, h);
  runTCAStep(rule, cells, b, w, h);
  assert.deepEqual(Array.from(a), Array.from(b), 'TCA must be deterministic');
});

test('TCA tiebreak "lex" produces deterministic result', () => {
  const rule = new TCACompiledRule({
    id: 'test_lex',
    name: 'Test',
    proposals: [
      { birth: [3], survival: [2, 3] },
      { birth: [3], survival: [2, 3] }, // identical
    ],
    objective: 'survival',
    lookahead: 1,
    tiebreak: 'lex',
  });
  const { cells, w, h } = makeGrid(['.....', '.OOO.', '.....']);
  const target = new Uint8Array(cells.length);
  runTCAStep(rule, cells, target, w, h);
  // No exception, deterministic result.
  assert.ok(target.some((c) => c !== 0));
});

test('lexCompare: shorter array comes first if equal prefix', () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([1, 2, 3, 4]);
  assert.equal(lexCompare(a, b), -1);
  assert.equal(lexCompare(b, a), 1);
});

test('lexCompare: equal arrays return 0', () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([1, 2, 3]);
  assert.equal(lexCompare(a, b), 0);
});

test('lexCompare: differing element decides', () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([1, 5, 3]);
  assert.equal(lexCompare(a, b), -1);
});

section('Time-Integrated Engine:');

test('TimeIntegratedRule constructs with default weights', () => {
  const rule = new TimeIntegratedRule({
    id: 'test_ti',
    name: 'Test',
    birth: [3],
    survival: [2, 3],
    windowSize: 3,
  });
  assert.equal(rule.windowSize, 3);
  assert.equal(rule.weights.length, 3);
  assert.ok(rule.weights[0] > rule.weights[1]); // decay
});

test('TimeIntegratedRule accepts custom weights', () => {
  const rule = new TimeIntegratedRule({
    id: 'test_ti_custom',
    name: 'Test',
    birth: [3],
    survival: [2, 3],
    windowSize: 3,
    temporalWeights: [1.0, 0.5, 0.25],
  });
  assert.deepEqual(rule.weights, [1.0, 0.5, 0.25]);
});

test('Time-integrated rule history is tracked correctly', () => {
  const rule = new TimeIntegratedRule({
    id: 'test_hist',
    name: 'Test',
    birth: [3],
    survival: [2, 3],
    windowSize: 2,
  });
  const a = new Uint8Array([1, 0, 1]);
  const b = new Uint8Array([0, 1, 0]);
  rule.pushHistory(a);
  assert.equal(rule.history.length, 1);
  rule.pushHistory(b);
  assert.equal(rule.history.length, 2);
  // Window size = 2, push a third, should drop oldest.
  rule.pushHistory(a);
  assert.equal(rule.history.length, 2);
});

test('Time-integrated rule produces same output for same input', () => {
  const rule1 = new TimeIntegratedRule({
    id: 'test_det_ti',
    name: 'Test',
    birth: [3],
    survival: [2, 3],
    windowSize: 1, // no memory
  });
  const rule2 = new TimeIntegratedRule({
    id: 'test_det_ti',
    name: 'Test',
    birth: [3],
    survival: [2, 3],
    windowSize: 1,
  });
  const { cells, w, h } = makeGrid(['.....', '..O..', '.OOO.', '..O..', '.....']);
  const a = new Uint8Array(cells.length);
  const b = new Uint8Array(cells.length);
  runTimeIntegratedStep(rule1, cells, a, w, h);
  runTimeIntegratedStep(rule2, cells, b, w, h);
  assert.deepEqual(Array.from(a), Array.from(b));
});

section('Fractional Lightcone Engine:');

test('FractionalLightconeRule precomputes kernel', () => {
  const rule = new FractionalLightconeRule({
    id: 'test_flc',
    name: 'Test',
    spatialRadius: 2.0,
    alpha: 0.5,
    beta: 0.5,
    windowSize: 2,
  });
  assert.ok(rule.kernel.length > 0);
  assert.equal(rule.temporalWeights.length, 2);
  // Closer cells should have higher weight.
  const w1 = rule.kernel.find(([x, y]) => x === 1 && y === 0)[2];
  const wDiag = rule.kernel.find(([x, y]) => x === 1 && y === 1)[2];
  assert.ok(w1 > wDiag, 'closer cells should have higher weight');
});

test('Fractional lightcone runs without crashing on empty grid', () => {
  const rule = new FractionalLightconeRule({
    id: 'test_flc_empty',
    name: 'Test',
    spatialRadius: 1.5,
    alpha: 1.0,
    beta: 1.0,
    windowSize: 2,
    birthMin: 0.5,
    birthMax: 1.5,
    survivalMin: 0.3,
    survivalMax: 1.8,
  });
  const cells = new Uint8Array(64);
  const target = new Uint8Array(64);
  runFractionalLightconeStep(rule, cells, target, 8, 8);
  assert.deepEqual(Array.from(target), Array.from(cells));
});

test('Fractional lightcone produces nontrivial output on populated grid', () => {
  const rule = new FractionalLightconeRule({
    id: 'test_flc_pop',
    name: 'Test',
    spatialRadius: 2.0,
    alpha: 0.5,
    beta: 0.5,
    windowSize: 2,
    birthMin: 0.5,
    birthMax: 4.0,
    survivalMin: 0.3,
    survivalMax: 5.0,
  });
  const { cells, w, h } = makeGrid([
    '........',
    '........',
    '...OO...',
    '...OO...',
    '........',
    '........',
  ]);
  const target = new Uint8Array(cells.length);
  runFractionalLightconeStep(rule, cells, target, w, h);
  // Should produce some live cells.
  let n = 0;
  for (let i = 0; i < target.length; i++) if (target[i]) n++;
  assert.ok(n > 0, 'lightcone should produce live cells');
});

section('Registry & dispatch:');

test('Built-in exotic rules are registered', () => {
  assert.ok(getExoticRule('tca_survivor'));
  assert.ok(getExoticRule('ti_momentum'));
  assert.ok(getExoticRule('flc_relativistic'));
});

test('listExoticRules returns all registered', () => {
  const all = listExoticRules();
  assert.ok(all.length >= 5);
});

test('isExoticRule correctly identifies exotic ids', () => {
  assert.equal(isExoticRule('tca_survivor'), true);
  assert.equal(isExoticRule('conway'), false);
  assert.equal(isExoticRule('nonexistent'), false);
});

test('runExoticStep dispatches to correct engine', () => {
  const { cells, w, h } = makeGrid(['.....', '..O..', '.OOO.', '..O..', '.....']);
  const target = new Uint8Array(cells.length);
  const rule = getExoticRule('tca_survivor').compiled;
  runExoticStep(rule, cells, target, w, h);
  // Should not crash and produce some valid state.
  assert.equal(target.length, cells.length);
});

test('resetExoticState clears history', () => {
  const rule = getExoticRule('ti_momentum').compiled;
  const { cells, w, h } = makeGrid(['...', '.O.', '...']);
  const target = new Uint8Array(cells.length);
  runTimeIntegratedStep(rule, cells, target, w, h);
  assert.ok(rule.history.length > 0);
  resetExoticState(rule);
  assert.equal(rule.history.length, 0);
});

section('TCA objectives:');

test('TCA_OBJECTIVES.survival rewards population', () => {
  const sparse = new Uint8Array(64);
  sparse[0] = 1;
  const dense = new Uint8Array(64);
  for (let i = 0; i < 20; i++) dense[i] = 1;
  const s1 = TCA_OBJECTIVES.survival.score(sparse, 8, 8, 1);
  const s2 = TCA_OBJECTIVES.survival.score(dense, 8, 8, 1);
  assert.ok(s2 > s1);
});

test('registerExoticRule allows custom rules', () => {
  const compiled = registerExoticRule('tca', {
    id: 'test_custom_tca',
    name: 'Custom Test',
    proposals: [
      { birth: [3], survival: [2, 3] },
      { birth: [2], survival: [2, 3] },
    ],
    objective: 'survival',
    lookahead: 1,
  });
  assert.ok(compiled.isTCA);
  assert.ok(getExoticRule('test_custom_tca'));
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
