/**
 * Simple test runner — imports each test module in turn. Each test
 * module prints its own results and `process.exit(1)`s on failure.
 *
 * Usage:  node test/run-all.js
 */

import './patterns/library.test.js';
import './rules/ruleset.test.js';
import './patterns/simulation.test.js';
import './sim/simulation.test.js';
import './grid.test.js';

console.log('\nAll test suites loaded.');
