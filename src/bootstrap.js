// App bootstrap: PWA wiring, epilepsy warning gate, error nets,
// and Game construction. Extracted from main.js.
import { Logger } from './logger.js';
import {
  registerServiceWorker,
  initInstallPrompt,
  initNetworkIndicator,
  checkAutoStart,
  checkLevelUrlParam,
} from './pwa.js';

export function initGame(GameClass) {
  registerServiceWorker();
  initInstallPrompt();
  initNetworkIndicator();
  window.addEventListener('error', (ev) => {
    Logger.error('Uncaught error:', ev.message, ev.error || '');
  });
  window.addEventListener('unhandledrejection', (ev) => {
    Logger.error('Unhandled promise rejection:', ev.reason);
  });
  try {
    new GameClass();
    checkAutoStart(() => {
      const btn = document.getElementById('start-button');
      if (btn) btn.click();
    });
    checkLevelUrlParam((levelName) => {
      if (window.game && window.game.startCustomLevel) {
        window.game.startCustomLevel(levelName);
      }
    });
  } catch (e) {
    Logger.error('Fatal error during Game construction.', e);
    const overlay = document.getElementById('overlay');
    const msg = document.getElementById('overlay-message');
    const title = document.getElementById('overlay-title');
    if (overlay && msg && title) {
      title.textContent = 'Startup Error';
      msg.innerHTML =
        'The game failed to start. ' + 'Open the browser console for details, then reload.';
      overlay.classList.remove('hidden');
    }
  }
}

export function installEpilepsyGate(GameClass) {
  const EPILEPSY_ACK_KEY = 'arcadeOfLifeEpilepsyAcknowledged';
  const warningOverlay = document.getElementById('epilepsy-warning-overlay');
  const warningAcceptBtn = document.getElementById('epilepsy-warning-accept');
  const warningDontShow = document.getElementById('epilepsy-warning-dont-show');

  let alreadyAcknowledged = false;
  try {
    alreadyAcknowledged = localStorage.getItem(EPILEPSY_ACK_KEY) === 'true';
  } catch (_e) {
    /* private mode */
  }

  if (alreadyAcknowledged || !warningOverlay) {
    if (warningOverlay) warningOverlay.classList.add('hidden');
    initGame(GameClass);
    return;
  }
  if (warningAcceptBtn) {
    const handleAccept = () => {
      if (warningDontShow && warningDontShow.checked) {
        try {
          localStorage.setItem(EPILEPSY_ACK_KEY, 'true');
        } catch (_e) {
          /* ignore */
        }
      }
      warningOverlay.classList.add('hidden');
      initGame(GameClass);
    };
    warningAcceptBtn.addEventListener('click', handleAccept);
    const keyHandler = (e) => {
      if (warningOverlay.classList.contains('hidden')) {
        window.removeEventListener('keydown', keyHandler);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleAccept();
        window.removeEventListener('keydown', keyHandler);
      }
    };
    window.addEventListener('keydown', keyHandler);
    setTimeout(() => warningAcceptBtn.focus(), 100);
  } else {
    initGame(GameClass);
  }
}
