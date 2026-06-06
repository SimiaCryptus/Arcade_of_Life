/**
 * Simple test runner — imports each test module in turn. Each test
 * module prints its own results and `process.exit(1)`s on failure.
 *
 * Usage:  node test/run-all.js
 */

import './rules/ruleset.test.js';
import './rules/neighborhoods.test.js';
import './rules/exoticEngines.test.js';
import './patterns/library.test.js';
import './patterns/simulation.test.js';
import './patterns/inferMetadata.test.js';
import './patterns/parsers.test.js';
import './sim/simulation.test.js';
import './sim/wrapShift.test.js';
import './sim/wrapShiftIntegration.test.js';
import './grid.test.js';
import './topology.test.js';

console.log('\nAll test suites loaded.');
