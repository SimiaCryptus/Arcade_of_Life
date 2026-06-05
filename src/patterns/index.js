/**
 * Pattern library public API.
 *
 * This module re-exports the canonical pattern registry plus a small set
 * of helpers that the game UI consumes. It also exports a back-compat
 * PATTERN_PRESETS object that matches the legacy drawTools.js shape,
 * so existing code can be updated incrementally.
 */

import {
  CATEGORY,
  registerPattern,
  getPattern,
  clonePatternCells,
  listPatterns,
  searchPatterns,
  transformCells,
  normalizeCells,
} from './library.js';

export {
  CATEGORY,
  registerPattern,
  getPattern,
  clonePatternCells,
  listPatterns,
  searchPatterns,
  transformCells,
  normalizeCells,
};

/**
 * Back-compat presets map (id -> cells[]) so legacy callers in
 * drawTools.js continue to work without code changes.
 *
 * This map is generated from the registry at module load. New patterns
 * registered later won't appear here unless rebuildLegacyPresets() is
 * called explicitly.
 */
export function rebuildLegacyPresets() {
  const out = {};
  for (const p of listPatterns()) {
    // Provide cells as plain arrays for legacy mutation.
    out[p.id] = p.cells.map((c) => [c[0], c[1]]);
  }
  return out;
}

/**
 * The current snapshot of the legacy presets map.
 */
export const PATTERN_PRESETS = rebuildLegacyPresets();
