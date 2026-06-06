/**
 * Centralized logger with levels and a tagged prefix.
 * Levels: 'debug' | 'info' | 'warn' | 'error' | 'silent'
 * Default level is 'info'. Override via localStorage key 'missileDefenseLogLevel'
 * or by calling Logger.setLevel().
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const PREFIX = '[ArcadeOfLife]';

let currentLevel = LEVELS.info;

// Attempt to read level override from localStorage. Guarded because
// localStorage may be unavailable (private mode, SSR contexts).
try {
  const stored =
    typeof localStorage !== 'undefined' ? localStorage.getItem('missileDefenseLogLevel') : null;
  if (stored && LEVELS[stored] != null) {
    currentLevel = LEVELS[stored];
  }
} catch (_e) {
  // Ignore - keep default level.
}

function shouldLog(level) {
  return LEVELS[level] >= currentLevel;
}

function fmt(args) {
  return [PREFIX, ...args];
}

export const Logger = {
  setLevel(level) {
    if (LEVELS[level] != null) {
      currentLevel = LEVELS[level];
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('missileDefenseLogLevel', level);
        }
      } catch (_e) {
        /* ignore */
      }
    }
  },
  getLevel() {
    for (const [name, val] of Object.entries(LEVELS)) {
      if (val === currentLevel) return name;
    }
    return 'info';
  },
  /**
   * List available log levels.
   */
  levels() {
    return Object.keys(LEVELS);
  },
  debug(...args) {
    if (shouldLog('debug')) console.debug(...fmt(args));
  },
  info(...args) {
    if (shouldLog('info')) console.info(...fmt(args));
  },
  warn(...args) {
    if (shouldLog('warn')) console.warn(...fmt(args));
  },
  error(...args) {
    if (shouldLog('error')) console.error(...fmt(args));
  },
  /**
   * Group helpers — useful for grouping related diagnostic output.
   */
  group(label) {
    if (shouldLog('info') && typeof console.group === 'function') {
      console.group(`${PREFIX} ${label}`);
    }
  },
  groupEnd() {
    if (typeof console.groupEnd === 'function') {
      console.groupEnd();
    }
  },
};

// Expose for ad-hoc debugging from the browser console.
if (typeof window !== 'undefined') {
  window.ArcadeOfLifeLogger = Logger;
  // Back-compat alias.
  window.MissileDefenseLogger = Logger;
}
