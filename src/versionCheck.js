/**
 * Runtime version check: fetches /src/version.js bypassing HTTP and SW
 * caches, compares its build timestamp / git hash against the version
 * baked into the running bundle, and reports whether an update is
 * available.
 *
 * Designed to work alongside the service worker — when a mismatch is
 * detected we instruct the SW to clear its caches and reload, ensuring
 * the user always gets the freshest build.
 */
import { Logger } from './logger.js';
import { VERSION as BUNDLED_VERSION } from './version.js';

// Path to the generated version file, resolved relative to the document.
// Mirrors getBasePath() in pwa.js so subdirectory deployments work.
function getBasePath() {
  const path = window.location.pathname;
  if (path.endsWith('/')) return path;
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx + 1) : '/';
}

/**
 * Fetch the current deployed version metadata, bypassing all caches.
 * Uses a cache-busting query string AND `cache: 'no-store'` AND
 * `Cache-Control: no-cache` headers — belt, suspenders, and a rope.
 *
 * @returns {Promise<object|null>}
 */
export async function fetchDeployedVersion() {
  const base = getBasePath();
  const url = `${base}src/version.js?_=${Date.now()}`;
  try {
    const resp = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
    if (!resp.ok) {
      Logger.warn(`[VersionCheck] HTTP ${resp.status} fetching version.js`);
      return null;
    }
    const text = await resp.text();
    // Parse the exported VERSION object out of the ES module source.
    // The generator emits `export const VERSION = { ... };` — we extract
    // the JSON-like literal with a non-greedy regex.
    const match = text.match(/export\s+const\s+VERSION\s*=\s*(\{[\s\S]*?\});/);
    if (!match) {
      Logger.warn('[VersionCheck] Could not parse VERSION from version.js');
      return null;
    }
    // The literal is valid JSON because the generator uses JSON.stringify.
    const meta = JSON.parse(match[1]);
    return meta;
  } catch (e) {
    Logger.warn('[VersionCheck] Failed to fetch deployed version:', e);
    return null;
  }
}

/**
 * Compare bundled vs deployed versions. Returns true if they differ
 * (i.e. an update is available and a reload is recommended).
 */
export function isOutdated(deployed) {
  if (!deployed) return false;
  if (deployed.gitHash && BUNDLED_VERSION.gitHash) {
    return deployed.gitHash !== BUNDLED_VERSION.gitHash;
  }
  if (deployed.buildTimestamp && BUNDLED_VERSION.buildTimestamp) {
    return deployed.buildTimestamp > BUNDLED_VERSION.buildTimestamp;
  }
  return false;
}

/**
 * Perform a one-shot version check. If outdated, invokes the callback
 * with the deployed metadata so callers can surface a UI banner.
 *
 * @param {(deployed: object) => void} onOutdated
 */
export async function checkVersionOnce(onOutdated) {
  const deployed = await fetchDeployedVersion();
  if (isOutdated(deployed)) {
    Logger.info(
      `[VersionCheck] Update available: bundled=${BUNDLED_VERSION.gitShortHash}, ` +
        `deployed=${deployed.gitShortHash}`
    );
    try {
      onOutdated?.(deployed);
    } catch (e) {
      Logger.warn('[VersionCheck] onOutdated callback threw:', e);
    }
  } else {
    Logger.info(
      `[VersionCheck] Up to date (${BUNDLED_VERSION.gitShortHash}, ` +
        `built ${BUNDLED_VERSION.buildTime})`
    );
  }
  return deployed;
}

/**
 * Start periodic version checking. Default: check 30 seconds after load,
 * then every 5 minutes while the tab is visible.
 */
export function startPeriodicVersionCheck(onOutdated, opts = {}) {
  const initialDelayMs = opts.initialDelayMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 5 * 60_000;
  let timer = null;
  let stopped = false;
  let alreadyNotified = false;

  const wrapped = (deployed) => {
    if (alreadyNotified) return;
    alreadyNotified = true;
    onOutdated?.(deployed);
  };

  const tick = () => {
    if (stopped) return;
    if (document.visibilityState === 'visible') {
      checkVersionOnce(wrapped).catch(() => {});
    }
    timer = setTimeout(tick, intervalMs);
  };

  setTimeout(tick, initialDelayMs);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export { BUNDLED_VERSION };
