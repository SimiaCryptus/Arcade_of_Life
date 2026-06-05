import {Logger} from './logger.js';

/**
 * Safe localStorage wrappers. All operations are guarded against:
 *   - localStorage being unavailable (private browsing, file://, etc.)
 *   - Quota exceeded errors
 *   - Corrupted JSON
 * On failure, helpers return the supplied default value and log a warning.
 */

let warnedUnavailable = false;

function hasStorage() {
  try {
    if (typeof localStorage === 'undefined') return false;
    // Probe with a no-op set/remove to detect disabled storage.
    const probe = '__md_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch (e) {
    if (!warnedUnavailable) {
      Logger.warn('localStorage unavailable; settings & high score will not persist.', e);
      warnedUnavailable = true;
    }
    return false;
  }
}

export function loadJSON(key, defaultValue) {
  if (!hasStorage()) return defaultValue;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return defaultValue;
    return JSON.parse(raw);
  } catch (e) {
    Logger.warn(`Failed to parse stored JSON for key "${key}"; using default.`, e);
    // Attempt to clear the corrupted entry so we don't keep failing.
    try {
      localStorage.removeItem(key);
    } catch (_e) { /* ignore */
    }
    return defaultValue;
  }
}

export function saveJSON(key, value) {
  if (!hasStorage()) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    // Most common cause: quota exceeded.
    Logger.warn(`Failed to save key "${key}" to localStorage.`, e);
    return false;
  }
}

export function loadInt(key, defaultValue) {
  if (!hasStorage()) return defaultValue;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return defaultValue;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : defaultValue;
  } catch (e) {
    Logger.warn(`Failed to read int for key "${key}"; using default.`, e);
    return defaultValue;
  }
}

export function saveString(key, value) {
  if (!hasStorage()) return false;
  try {
    localStorage.setItem(key, String(value));
    return true;
  } catch (e) {
    Logger.warn(`Failed to save key "${key}" to localStorage.`, e);
    return false;
  }
}
