/**
 * Ruleset module entry point. Importing this file ensures all built-in
 * and extra rulesets are registered in the runtime registry.
 *
 * Game code should import from here rather than from ruleset.js directly
 * if it wants access to the extra rulesets (Move, DryLife, Gnarl, etc.).
 */

export * from './ruleset.js';
// Side-effect import registers the extra rulesets.
import './extraRulesets.js';
