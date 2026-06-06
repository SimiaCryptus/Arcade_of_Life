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
// Exotic engines (TCA, time-integrated, fractional lightcone).
export * from './exoticEngines.js';
import { listExoticRules as _listExotic, getExoticRule as _getExotic } from './exoticEngines.js';
import { registerRuleset } from './ruleset.js';
// Register each exotic rule into the main ruleset registry as a stub
// entry, so they appear in the standard ruleset dropdown. The simulation
// dispatcher checks for `isExotic` and routes to the exotic engine.
for (const { type, compiled, def } of _listExotic()) {
  try {
    // Stub B/S so registerRuleset's validation passes. The real engine
    // will be invoked by the simulation backend via isExotic check.
    registerRuleset({
      id: compiled.id,
      name: compiled.name,
      notation: compiled.notation || `EXOTIC[${type}]`,
      description: compiled.description,
      birth: [],
      survival: [],
      neighborhood: 'moore',
      _exoticType: type,
      _exoticCompiled: compiled,
    });
  } catch (e) {
    console.warn(`[exotic] Failed to register "${compiled.id}":`, e.message);
  }
}
