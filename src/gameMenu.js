// Hamburger game menu, inline buttons, pattern mode zoo visibility.
// Extracted from main.js.
import { CONFIG } from './config.js';
import { Logger } from './logger.js';
import { TimeControl } from './timeControl.js';
import { toggleFullscreen } from './pwa.js';

export function initTimeControl(game) {
  const mount = document.getElementById('time-control-mount');
  if (!mount) {
    Logger.warn('[Game] time-control-mount not found in DOM.');
    return;
  }
  game.timeControl = new TimeControl({
    container: mount,
    onStepForward: () => game.stepForward(),
    onSpeedChange: (val) => {
      if (game.speedLabel) game.speedLabel.textContent = val === 0 ? 'Paused' : `${val}x`;
    },
  });
  const cells = (CONFIG.GRID_WIDTH | 0) * (CONFIG.GRID_HEIGHT | 0);
  game.timeControl.recapForGrid(cells);
}

export function initGameMenu(game) {
  const btn = document.getElementById('game-menu-button');
  const dropdown = document.getElementById('game-menu-dropdown');
  if (!btn || !dropdown) {
    Logger.warn('[Game] Game menu DOM not found.');
    return;
  }
  const setOpen = (open) => {
    dropdown.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.classList.toggle('active', open);
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !dropdown.classList.contains('hidden');
    setOpen(!isOpen);
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== btn) setOpen(false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dropdown.classList.contains('hidden')) setOpen(false);
  });
  const wireItem = (id, handler) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      try {
        handler();
      } catch (err) {
        Logger.error(`[Game] Menu handler '${id}' failed`, err);
      }
    });
  };
  wireItem('gm-settings', () => game.openIngameSettings());
  wireItem('gm-howtoplay', () => game.openHelpGuide());
  wireItem('gm-guide', () => game.openGuide());
  wireItem('gm-zoo', () => game.openPatternZoo());
  wireItem('gm-designer', () => game.openLevelDesigner());
  wireItem('gm-hotkeys', () => game._toggleHotkeyHelp(true));
  wireItem('gm-fullscreen', () => toggleFullscreen());
  wireItem('gm-restart', () => game.restartLevel());
  wireItem('gm-exit', () => game.exitToMenu());
  document.addEventListener('fullscreenchange', () => {
    const fsItem = document.getElementById('gm-fullscreen');
    if (fsItem) {
      fsItem.textContent = document.fullscreenElement ? '⛶ Exit Fullscreen' : '⛶ Fullscreen';
    }
  });
}

export function initInlineZooButton(game) {
  const inlineZoo = document.getElementById('pattern-zoo-inline-button');
  if (inlineZoo) {
    inlineZoo.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      game.openPatternZoo();
    });
  }
}

export function wirePatternModeZooVisibility(game) {
  const updateVisibility = () => {
    const inlineZoo = document.getElementById('pattern-zoo-inline-button');
    if (!inlineZoo) return;
    const mode = game.input && game.input.mode;
    const isPattern = mode === 'pattern';
    inlineZoo.style.display = isPattern ? '' : 'none';
  };
  setTimeout(updateVisibility, 0);
  const modeButtons = document.querySelectorAll('.mode-btn[data-mode]');
  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => setTimeout(updateVisibility, 0));
  });
  window.addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    if (['f', 'l', 'p', 'b'].includes(k) || e.key === 'Tab') {
      setTimeout(updateVisibility, 16);
    }
  });
}
