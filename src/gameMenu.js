// Hamburger game menu, inline buttons, pattern mode zoo visibility.
// Extracted from main.js.
import { CONFIG } from './config.js';
import { Logger } from './logger.js';
import { TimeControl } from './timeControl.js';
import { toggleFullscreen } from './pwa.js';
import { Sfx } from './audio.js';
const AUDIO_PREFS_KEY = 'gol_audio_prefs_v1';
function loadAudioPrefs() {
  try {
    const raw = localStorage.getItem(AUDIO_PREFS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}
function saveAudioPrefs(prefs) {
  try {
    localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(prefs));
  } catch (_e) {
    /* ignore */
  }
}
function applyStoredAudioPrefs() {
  const prefs = loadAudioPrefs();
  if (!prefs) return;
  if (typeof prefs.muted === 'boolean') Sfx.setMuted(prefs.muted);
  if (typeof prefs.volume === 'number') Sfx.setVolume(prefs.volume);
}
function updateMuteLabel() {
  const el = document.getElementById('gm-mute');
  if (!el) return;
  const icon = el.querySelector('.gm-mute-icon');
  const label = el.querySelector('.gm-mute-label');
  if (icon) icon.textContent = Sfx.muted ? '🔇' : '🔊';
  if (label) label.textContent = Sfx.muted ? 'Unmute Sound' : 'Mute Sound';
  el.classList.toggle('gm-muted', !!Sfx.muted);
}
function updateVolumeLabel() {
  const el = document.getElementById('gm-volume-label');
  if (!el) return;
  el.textContent = `${Math.round(Sfx.volume * 100)}%`;
  // Also update the slider's visual fill via a CSS var.
  const slider = document.getElementById('gm-volume');
  if (slider) {
    const pct = Math.round(Sfx.volume * 100);
    slider.style.setProperty('--gm-vol-pct', `${pct}%`);
    // Dim the row if muted.
    const row = slider.closest('.gm-volume-item');
    if (row) row.classList.toggle('gm-volume-dim', !!Sfx.muted);
  }
}
function ensureAudioMenuItems(dropdown) {
  if (document.getElementById('gm-audio-section')) return;
  // Insert before the "exit" item if it exists, otherwise append.
  const section = document.createElement('div');
  section.id = 'gm-audio-section';
  section.className = 'game-menu-section';
  section.innerHTML = `
     <div class="gm-divider"></div>
     <div class="gm-audio-header">🎵 Audio</div>
     <button class="gm-item gm-mute-item" id="gm-mute" role="menuitem" tabindex="0">
       <span class="gm-mute-icon">🔊</span>
       <span class="gm-mute-label">Mute Sound</span>
       <span class="gm-mute-hint">M</span>
     </button>
     <div class="gm-volume-item" role="menuitem">
       <div class="gm-volume-row">
         <span class="gm-volume-icon">🎚</span>
         <span class="gm-volume-text">Volume</span>
         <span id="gm-volume-label" class="gm-volume-value">35%</span>
       </div>
       <input type="range" id="gm-volume" class="gm-volume-slider"
              min="0" max="100" step="1" aria-label="Volume" />
     </div>
   `;
  const exitItem = document.getElementById('gm-exit');
  if (exitItem && exitItem.parentNode === dropdown) {
    dropdown.insertBefore(section, exitItem);
  } else {
    dropdown.appendChild(section);
  }
}

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
  // Load stored audio prefs once, then inject UI items.
  applyStoredAudioPrefs();
  ensureAudioMenuItems(dropdown);

  const setOpen = (open) => {
    dropdown.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.classList.toggle('active', open);
    if (open) {
      updateMuteLabel();
      updateVolumeLabel();
      const slider = document.getElementById('gm-volume');
      if (slider) slider.value = String(Math.round(Sfx.volume * 100));
    }
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
  // Mute toggle — keeps menu open (so the user sees the new label).
  const muteEl = document.getElementById('gm-mute');
  if (muteEl) {
    const onMute = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const muted = Sfx.toggleMute();
      saveAudioPrefs({ muted, volume: Sfx.volume });
      updateMuteLabel();
      if (!muted) Sfx.uiClick();
    };
    muteEl.addEventListener('click', onMute);
    muteEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') onMute(e);
    });
  }
  // Volume slider — change value live, persist on release. Don't close menu.
  const volEl = document.getElementById('gm-volume');
  if (volEl) {
    volEl.value = String(Math.round(Sfx.volume * 100));
    volEl.addEventListener('input', (e) => {
      e.stopPropagation();
      const pct = Number(volEl.value) || 0;
      Sfx.setVolume(pct / 100);
      updateVolumeLabel();
    });
    volEl.addEventListener('change', () => {
      saveAudioPrefs({ muted: Sfx.muted, volume: Sfx.volume });
      Sfx.uiClick();
    });
    // Stop click on slider from closing the menu.
    volEl.addEventListener('click', (e) => e.stopPropagation());
    volEl.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
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
