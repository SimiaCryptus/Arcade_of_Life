/**
 * Custom level storage and registry.
 *
 * Levels are stored in localStorage under a single key. Each level
 * has a name, a grid snapshot (cities, defenses, bases), and wave
 * configuration overrides.
 *
 * Level schema:
 *   {
 *     name: string,
 *     createdAt: number,
 *     gridWidth: number,
 *     gridHeight: number,
 *     cities: [{x, y, width, height}],
 *     defenses: [[x, y], ...],         // pre-placed defense cells
 *     bases: [{patternId, name, x, y, width, height, cells}],  // zoo-pattern bases
 *     spawners: [{patternId, name, x, y, width, height, cells, interval}],  // missile spawners
 *     waveConfig: {
 *       missilesPerWaveBase: number,
 *       missilesPerWaveInc: number,
 *       spawnInterval: number,
 *       gliderTypes: { se, sw, heavy, lwss, mwss, twin, gun },
 *     },
 *     ruleset: string,                  // ruleset id, e.g. 'conway'
 *     description: string,
 *     settings: { ... },                // full CONFIG snapshot overrides (optional)
 *   }
 */

import { Logger } from './logger.js';
import { loadJSON, saveJSON } from './storage.js';

const STORAGE_KEY = 'arcadeOfLifeCustomLevels';

// Pub/sub for level changes so UI can refresh.
const _listeners = new Set();
export function onLevelsChanged(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
function notifyLevelsChanged() {
  for (const fn of _listeners) {
    try {
      fn();
    } catch (e) {
      Logger.warn('Level listener failed', e);
    }
  }
}

export function loadAllLevels() {
  return loadJSON(STORAGE_KEY, {});
}

export function saveLevel(name, level) {
  if (!name || typeof name !== 'string') return false;
  const all = loadAllLevels();
  all[name] = { ...level, name, savedAt: Date.now() };
  saveJSON(STORAGE_KEY, all);
  Logger.info(`[Levels] Saved "${name}".`);
  notifyLevelsChanged();
  return true;
}

export function getLevel(name) {
  const all = loadAllLevels();
  return all[name] || null;
}

export function deleteLevel(name) {
  const all = loadAllLevels();
  if (!all[name]) return false;
  delete all[name];
  saveJSON(STORAGE_KEY, all);
  Logger.info(`[Levels] Deleted "${name}".`);
  notifyLevelsChanged();
  return true;
}

export function listLevels() {
  const all = loadAllLevels();
  return Object.values(all).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

export function exportLevelJSON(name) {
  const lvl = getLevel(name);
  if (!lvl) return null;
  return JSON.stringify(lvl, null, 2);
}

export function importLevelJSON(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.name || !Array.isArray(parsed.cities)) {
      return { ok: false, error: 'Invalid level: missing name or cities.' };
    }
    saveLevel(parsed.name, parsed);
    return { ok: true, name: parsed.name };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
