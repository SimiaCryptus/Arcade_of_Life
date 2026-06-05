/**
 * PWA utilities: service worker registration, install prompt,
 * update notifications, and mobile UI helpers.
 */

import { Logger } from './logger.js';

// ── Service Worker registration ────────────────────────────────────────────
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    Logger.info('[PWA] Service workers not supported.');
    return;
  }
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });
      Logger.info('[PWA] Service worker registered:', reg.scope);

      // Notify user when a new version is waiting.
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(reg);
          }
        });
      });
    } catch (err) {
      Logger.warn('[PWA] Service worker registration failed:', err);
    }
  });
}

// ── Install prompt (A2HS) ──────────────────────────────────────────────────
let _deferredInstallPrompt = null;

export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredInstallPrompt = e;
    Logger.info('[PWA] Install prompt deferred.');
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
    <button id="pwa-install-dismiss" title="Dismiss">✕</button>
  `;
  document.body.appendChild(banner);

  document.getElementById('pwa-install-btn').addEventListener('click', async () => {
    const accepted = await triggerInstallPrompt();
    if (accepted) hideInstallBanner();
  });
  document.getElementById('pwa-install-dismiss').addEventListener('click', () => {
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
    <span class="pwa-banner-text">🆕 A new version is available!</span>
    <button id="pwa-update-btn">Reload</button>
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
  const params = new URLSearchParams(window.location.search);
  if (params.get('autostart') === '1') {
    // Wait one tick so the game is fully initialised.
    setTimeout(startGameFn, 100);
  }
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
