/**
 * Ruleset module entry point. Importing this file ensures all built-in
 * and extra rulesets are registered in the runtime registry.
 *
 * Game code should import from here rather than from ruleset.js directly
 * if it wants access to the extra rulesets (Move, DryLife, Gnarl, etc.).
 */

// Load neighborhoods FIRST so the global hook is installed before any
// ruleset registration tries to validate against exotic neighborhoods.
export * from './neighborhoods.js';
export * from './ruleset.js';
// Side-effect import registers the extra rulesets.
import './extraRulesets.js';
import './exoticRulesets.js';
