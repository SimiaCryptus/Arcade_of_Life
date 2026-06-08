/**
 * PWA utilities: service worker registration, install prompt,
 * update notifications, and mobile UI helpers.
 */

import { Logger } from './logger.js';
import { importLevelJSON, getLevel } from './levels.js';
import { startPeriodicVersionCheck, BUNDLED_VERSION } from './versionCheck.js';
// Compute base path so the app works whether served from the domain root
// or from a subdirectory (e.g. http://host/Arcade_of_Life/).
// Strips the trailing filename (if any) from the current pathname.
function getBasePath() {
  const path = window.location.pathname;
  // If the path ends with a slash, use it directly.
  if (path.endsWith('/')) return path;
  // Otherwise drop the last segment (typically index.html).
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx + 1) : '/';
}

// ── Service Worker registration ────────────────────────────────────────────
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    Logger.info('[PWA] Service workers not supported.');
    return;
  }
  window.addEventListener('load', async () => {
    try {
      const basePath = getBasePath();
      const reg = await navigator.serviceWorker.register(basePath + 'sw.js', {
        scope: basePath,
      });
      Logger.info('[PWA] Service worker registered:', reg.scope);
      Logger.info(
        `[PWA] Running build: ${BUNDLED_VERSION.gitShortHash} ` + `(${BUNDLED_VERSION.buildTime})`
      );

      // Notify user when a new version is waiting.
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(reg);
          }
        });
      });
      // Independent of the SW lifecycle, poll the uncached version.js
      // to catch deploys where the SW didn't pick up the change yet
      // (e.g. aggressive CDN caching of sw.js itself).
      startPeriodicVersionCheck(
        (deployed) => {
          Logger.info(
            `[PWA] Deployed version differs (deployed=${deployed.gitShortHash}); ` +
              `prompting reload.`
          );
          // Try to nudge the SW into updating, then show the banner.
          reg.update().catch(() => {});
          showVersionUpdateBanner(reg, deployed);
        },
        { initialDelayMs: 30_000, intervalMs: 5 * 60_000 }
      );
    } catch (err) {
      Logger.warn('[PWA] Service worker registration failed:', err);
    }
  });
}

// Key for permanent dismissal of the install banner.
const INSTALL_DISMISS_KEY = 'arcadeOfLifeInstallDismissed';

// ── Install prompt (A2HS) ──────────────────────────────────────────────────
let _deferredInstallPrompt = null;

export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredInstallPrompt = e;
    Logger.info('[PWA] Install prompt deferred.');
    // Respect prior "don't show again" preference.
    try {
      if (localStorage.getItem(INSTALL_DISMISS_KEY) === 'true') {
        Logger.info('[PWA] Install banner suppressed by user preference.');
        return;
      }
    } catch (_e) {
      /* private mode — fall through and show banner */
    }
    // Respect per-session dismissal.
    try {
      if (sessionStorage.getItem('pwa-install-dismissed') === '1') return;
    } catch (_e) {
      /* ignore */
    }
    showInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    Logger.info('[PWA] App installed successfully.');
    _deferredInstallPrompt = null;
    hideInstallBanner();
  });
}

export async function triggerInstallPrompt() {
  if (!_deferredInstallPrompt) return false;
  _deferredInstallPrompt.prompt();
  const { outcome } = await _deferredInstallPrompt.userChoice;
  Logger.info('[PWA] Install prompt outcome:', outcome);
  _deferredInstallPrompt = null;
  return outcome === 'accepted';
}

// ── Install banner UI ──────────────────────────────────────────────────────
function showInstallBanner() {
  if (document.getElementById('pwa-install-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.innerHTML = `
    <span class="pwa-banner-icon">🕹️</span>
    <span class="pwa-banner-text">Install <strong>Arcade of Life</strong> for offline play!</span>
    <button id="pwa-install-btn">Install</button>
     <label class="pwa-banner-dont-show" title="Don't show this banner again">
       <input type="checkbox" id="pwa-install-dont-show" />
       <span>Don't show again</span>
     </label>
    <button id="pwa-install-dismiss" title="Dismiss">✕</button>
  `;
  document.body.appendChild(banner);

  document.getElementById('pwa-install-btn').addEventListener('click', async () => {
    const accepted = await triggerInstallPrompt();
    if (accepted) hideInstallBanner();
  });
  document.getElementById('pwa-install-dismiss').addEventListener('click', () => {
    const dontShow = document.getElementById('pwa-install-dont-show');
    if (dontShow && dontShow.checked) {
      try {
        localStorage.setItem(INSTALL_DISMISS_KEY, 'true');
        Logger.info('[PWA] Install banner permanently dismissed.');
      } catch (_e) {
        /* private mode — fall back to session-only */
      }
    }
    hideInstallBanner();
    // Don't show again this session.
    sessionStorage.setItem('pwa-install-dismissed', '1');
  });

  // Animate in.
  requestAnimationFrame(() => banner.classList.add('pwa-banner-visible'));
}

function hideInstallBanner() {
  const banner = document.getElementById('pwa-install-banner');
  if (!banner) return;
  banner.classList.remove('pwa-banner-visible');
  banner.addEventListener('transitionend', () => banner.remove(), { once: true });
}

// ── Update banner UI ───────────────────────────────────────────────────────
function showUpdateBanner(reg) {
  if (document.getElementById('pwa-update-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-update-banner';
  banner.innerHTML = `
     <span class="pwa-banner-icon">✨</span>
     <span class="pwa-banner-text">A new version is available — <strong>reload to upgrade</strong></span>
     <button id="pwa-update-btn">↻ Reload</button>
    <button id="pwa-update-dismiss" title="Dismiss">✕</button>
  `;
  document.body.appendChild(banner);

  document.getElementById('pwa-update-btn').addEventListener('click', () => {
    if (reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    window.location.reload();
  });
  document.getElementById('pwa-update-dismiss').addEventListener('click', () => {
    banner.remove();
  });

  requestAnimationFrame(() => banner.classList.add('pwa-banner-visible'));
}
// ── Version-mismatch banner (driven by uncached version.js poll) ───────────
function showVersionUpdateBanner(reg, deployed) {
  if (document.getElementById('pwa-update-banner')) return;
  if (document.getElementById('pwa-version-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'pwa-version-banner';
  const short = (deployed && deployed.gitShortHash) || 'new build';
  banner.innerHTML = `
      <span class="pwa-banner-icon">✨</span>
      <span class="pwa-banner-text">New version available — <strong>${short}</strong></span>
      <button id="pwa-version-btn">↻ Reload</button>
     <button id="pwa-version-dismiss" title="Dismiss">✕</button>
   `;
  document.body.appendChild(banner);
  document.getElementById('pwa-version-btn').addEventListener('click', async () => {
    try {
      // Ask the SW to clear caches if it supports the message.
      if (reg && reg.active) {
        reg.active.postMessage({ type: 'CLEAR_CACHES' });
      }
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      // Best-effort: also clear caches from the page side.
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) {
      Logger.warn('[PWA] Cache clear before reload failed:', e);
    }
    window.location.reload();
  });
  document.getElementById('pwa-version-dismiss').addEventListener('click', () => {
    banner.remove();
  });
  requestAnimationFrame(() => banner.classList.add('pwa-banner-visible'));
}

// ── Online / offline indicator ─────────────────────────────────────────────
export function initNetworkIndicator() {
  const indicator = document.createElement('div');
  indicator.id = 'pwa-network-indicator';
  document.body.appendChild(indicator);

  function update() {
    const online = navigator.onLine;
    indicator.textContent = online ? '● ONLINE' : '● OFFLINE';
    indicator.className = online ? 'pwa-online' : 'pwa-offline';
    // Auto-hide when online after a brief show.
    if (online) {
      indicator.classList.add('pwa-fade');
      setTimeout(() => indicator.classList.remove('pwa-fade'), 3000);
    } else {
      indicator.classList.remove('pwa-fade');
    }
  }

  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

// ── Auto-start via URL param (?autostart=1) ────────────────────────────────
export function checkAutoStart(startGameFn) {
  // Deprecated: URL parameter handling is now centralised in
  // src/urlParams.js (processUrlParams). Kept as a no-op for
  // backwards compatibility with any external callers.
  Logger.info('[PWA] checkAutoStart() is deprecated; use processUrlParams().');
}
// ── Load level from URL param (?level=<encoded-url>) ────────────────────────
/**
 * Check for a ?level=<url> query parameter. If present, fetch the JSON
 * from that URL, import it as a custom level, and invoke the callback
 * with the level name so the caller can start it.
 *
 * Supports two forms:
 *   ?level=https%3A%2F%2Fexample.com%2Fmylevel.json   (URL-encoded URL)
 *   ?level=https://example.com/mylevel.json           (raw URL)
 *
 * Only https:// URLs are accepted for security. The fetched JSON must
 * conform to the level schema (see levels.js).
 *
 * @param {Function} startLevelFn  Callback invoked with the imported
 *                                 level's name on success.
 */
export function checkLevelUrlParam(startLevelFn) {
  // Deprecated: URL parameter handling is now centralised in
  // src/urlParams.js (processUrlParams). Kept as a no-op for
  // backwards compatibility.
  Logger.info('[PWA] checkLevelUrlParam() is deprecated; use processUrlParams().');
}
/**
 * Fetch and import a level JSON from a URL.
 * @param {string} url
 * @returns {Promise<string>}  Resolves with the imported level's name.
 */
async function loadLevelFromUrl(url) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'default',
    });
  } catch (e) {
    throw new Error(`Network error: ${e.message}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json') && !contentType.includes('text')) {
    Logger.warn(`[PWA] Unexpected content-type for level: ${contentType}`);
  }
  const text = await response.text();
  if (!text || text.trim().length === 0) {
    throw new Error('Empty response body.');
  }
  // Size sanity check: 5MB cap on level JSON.
  if (text.length > 5 * 1024 * 1024) {
    throw new Error('Level file too large (>5MB).');
  }
  const result = importLevelJSON(text);
  if (!result.ok) {
    throw new Error(`Invalid level JSON: ${result.error}`);
  }
  // Verify the level actually got saved.
  const saved = getLevel(result.name);
  if (!saved) {
    throw new Error('Level was imported but could not be retrieved.');
  }
  return result.name;
}
function showLevelLoadingBanner(url) {
  hideLevelLoadingBanner();
  const banner = document.createElement('div');
  banner.id = 'level-loading-banner';
  banner.style.cssText = `
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(5, 5, 20, 0.96);
    border: 2px solid #ffcc44;
    border-radius: 6px;
    padding: 12px 22px;
    color: #ffcc44;
    font-family: 'Courier New', monospace;
    font-size: 13px;
    font-weight: bold;
    z-index: 10000;
    box-shadow: 0 0 20px rgba(255, 204, 68, 0.5);
    text-align: center;
    min-width: 280px;
  `;
  banner.innerHTML = `
    <div style="margin-bottom:6px;">⬇ Loading level from URL...</div>
    <div style="font-size:10px;color:#a0a0c0;font-weight:normal;
                word-break:break-all;max-width:600px;">${escapeHtml(url)}</div>
  `;
  document.body.appendChild(banner);
}
function hideLevelLoadingBanner() {
  const banner = document.getElementById('level-loading-banner');
  if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
}
function showLevelLoadError(msg) {
  hideLevelLoadingBanner();
  const banner = document.createElement('div');
  banner.id = 'level-error-banner';
  banner.style.cssText = `
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(5, 5, 20, 0.96);
    border: 2px solid #ff6666;
    border-radius: 6px;
    padding: 12px 22px;
    color: #ff6666;
    font-family: 'Courier New', monospace;
    font-size: 13px;
    font-weight: bold;
    z-index: 10000;
    box-shadow: 0 0 20px rgba(255, 102, 102, 0.5);
    text-align: center;
    max-width: 600px;
    cursor: pointer;
  `;
  banner.innerHTML = `
    <div style="margin-bottom:6px;">⚠ Failed to load level</div>
    <div style="font-size:11px;color:#ffaaaa;font-weight:normal;">${escapeHtml(msg)}</div>
    <div style="font-size:10px;color:#8080a0;font-weight:normal;margin-top:6px;font-style:italic;">
      Click to dismiss
    </div>
  `;
  banner.addEventListener('click', () => {
    if (banner.parentNode) banner.parentNode.removeChild(banner);
  });
  document.body.appendChild(banner);
  // Auto-dismiss after 10s.
  setTimeout(() => {
    if (banner.parentNode) banner.parentNode.removeChild(banner);
  }, 10000);
}
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// ── Fullscreen helper ──────────────────────────────────────────────────────
export function toggleFullscreen() {
  const el = document.getElementById('game-container') || document.documentElement;
  if (!document.fullscreenElement) {
    el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.() ?? el.mozRequestFullScreen?.();
  } else {
    document.exitFullscreen?.() ??
      document.webkitExitFullscreen?.() ??
      document.mozCancelFullScreen?.();
  }
}

// ── Wake Lock (keep screen on while playing) ───────────────────────────────
let _wakeLock = null;

export async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    Logger.info('[PWA] Wake lock acquired.');
    _wakeLock.addEventListener('release', () => {
      Logger.info('[PWA] Wake lock released.');
    });
  } catch (err) {
    Logger.warn('[PWA] Wake lock failed:', err);
  }
}

export function releaseWakeLock() {
  _wakeLock?.release();
  _wakeLock = null;
}

// Re-acquire wake lock when tab becomes visible again.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && _wakeLock === null) {
    await requestWakeLock();
  }
});
