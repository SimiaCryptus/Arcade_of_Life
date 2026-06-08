// Keyboard shortcuts, hotkey help overlay, and pan controls.
// Extracted from main.js.
import { CONFIG } from './config.js';
import { STATE } from './gameState.js';
import { Sfx } from './audio.js';
import { toggleFullscreen } from './pwa.js';

export function initKeyboardShortcuts(game) {
  game._prePauseIdx = null;
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'F1') {
      e.preventDefault();
      game.guidePanel.toggle();
      return;
    }
    if (game.guidePanel && game.guidePanel.isVisible()) return;
    if (game.helpGuidePanel && game.helpGuidePanel.isVisible()) return;
    if (game.patternZoo && game.patternZoo.isVisible()) return;
    if (e.key === 'Escape') {
      if (game.hotkeyHelpVisible) {
        e.preventDefault();
        toggleHotkeyHelp(game, false);
        return;
      }
      if (game.settingsPanel && !game.settingsPanel.overlay.classList.contains('hidden')) {
        e.preventDefault();
        game.settingsPanel.hide();
        return;
      }
      if (game.helpGuidePanel && game.helpGuidePanel.isVisible()) {
        e.preventDefault();
        game.helpGuidePanel.hide();
        return;
      }
      if (game.input && game.input.drawing) {
        e.preventDefault();
        game.input.cancelDrawing();
        return;
      }
    }
    if (e.key === '?') {
      e.preventDefault();
      toggleHotkeyHelp(game);
      return;
    }
    if (game.hotkeyHelpVisible) return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (game.timeControl) game.timeControl.togglePause();
      return;
    }
    if (e.key === 'n' || e.key === 'N') {
      if (
        (game.gameState.is(STATE.PLAYING) || game.gameState.is(STATE.WAVE_TRANSITION)) &&
        CONFIG.SPEED_MULTIPLIER === 0
      ) {
        e.preventDefault();
        game.stepForward();
        return;
      }
    }
    if (e.key === '[' || e.key === ',') {
      if (game.timeControl) game.timeControl.setIndex(game.timeControl.getIndex() - 1);
      return;
    }
    if (e.key === ']' || e.key === '.') {
      if (game.timeControl) game.timeControl.setIndex(game.timeControl.getIndex() + 1);
      return;
    }
    if (!e.shiftKey && /^[0-9]$/.test(e.key)) {
      const digit = parseInt(e.key, 10);
      if (game.timeControl) game.timeControl.setIndex(digit);
      return;
    }
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      game._onClearDefenses();
      return;
    }
    if ((e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      if (!e.ctrlKey && !e.metaKey) {
        // Bare Z handled below as zoo-toggle.
      } else {
        e.preventDefault();
        if (game.input && game.input.undo) {
          const removed = game.input.undo();
          if (removed > 0 && game.renderer) {
            game.renderer.addFloater(
              Math.floor(game.grid.width / 2),
              Math.floor(game.grid.height / 2),
              `UNDO (${removed})`,
              '#88ddff'
            );
          }
        }
        return;
      }
    }
    if (e.key === 'g' || e.key === 'G') {
      e.preventDefault();
      game.guidePanel.toggle();
      return;
    }
    if (e.key === 'h' || e.key === 'H') {
      e.preventDefault();
      game.helpGuidePanel.toggle();
      return;
    }
    if (e.key === 'z' || e.key === 'Z') {
      if (e.ctrlKey || e.metaKey) {
        // Fall through.
      } else if (!e.shiftKey) {
        e.preventDefault();
        game.patternZoo.toggle();
        return;
      }
    }
    if (e.key === 'd' || e.key === 'D') {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      game.levelDesigner.toggle();
      return;
    }
    if (e.key === 's' || e.key === 'S') {
      if (
        CONFIG.IN_PLAY_SETTINGS_ENABLED &&
        (game.gameState.is(STATE.PLAYING) || game.gameState.is(STATE.WAVE_TRANSITION))
      ) {
        e.preventDefault();
        game.openIngameSettings();
        return;
      }
    }
    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      const muted = Sfx.toggleMute();
      if (game.renderer) {
        game.renderer.addBigFloater(
          Math.floor(game.grid.width / 2),
          Math.floor(game.grid.height / 3),
          muted ? '🔇 MUTED' : '🔊 SOUND ON',
          muted ? '#888888' : '#00ffff',
          1.4
        );
      }
      return;
    }
    if (e.key === 'Enter') {
      if (game.gameState.is(STATE.MENU) || game.gameState.is(STATE.GAME_OVER)) {
        if (!game.overlay.classList.contains('hidden')) {
          e.preventDefault();
          game.startGame();
        }
      }
      return;
    }
    if (e.key === 'F11') {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
  });
}

export function initHotkeyHelp(game) {
  game.hotkeyHelpVisible = false;
  if (document.getElementById('hotkey-help-overlay')) return;
  const div = document.createElement('div');
  div.id = 'hotkey-help-overlay';
  div.className = 'overlay hidden';
  div.innerHTML = `
       <div id="hotkey-help-content">
         <h2>Keyboard Shortcuts</h2>
         <div class="hk-grid">
           <div class="hk-col">
             <h3>Simulation</h3>
             <div class="hk-row"><kbd>Space</kbd><span>Pause / resume</span></div>
             <div class="hk-row"><kbd>N</kbd><span>Step forward one tick (when paused)</span></div>
             <div class="hk-row"><kbd>[</kbd> <kbd>,</kbd><span>Slower</span></div>
             <div class="hk-row"><kbd>]</kbd> <kbd>.</kbd><span>Faster</span></div>
             <div class="hk-row"><kbd>0</kbd>–<kbd>7</kbd><span>Speed preset</span></div>
             <h3>Drawing</h3>
             <div class="hk-row"><kbd>F</kbd><span>Freehand mode</span></div>
             <div class="hk-row"><kbd>L</kbd><span>Line mode</span></div>
             <div class="hk-row"><kbd>P</kbd><span>Pattern mode</span></div>
             <div class="hk-row"><kbd>R</kbd><span>Rotate pattern</span></div>
             <div class="hk-row"><kbd>X</kbd><span>Flip pattern horizontally</span></div>
             <div class="hk-row"><kbd>Y</kbd><span>Flip pattern vertically</span></div>
             <div class="hk-row"><kbd>+</kbd> <kbd>=</kbd><span>Wider brush</span></div>
             <div class="hk-row"><kbd>-</kbd><span>Narrower brush</span></div>
           </div>
           <div class="hk-col">
             <h3>Actions</h3>
             <div class="hk-row"><kbd>Z</kbd><span>Undo last stroke</span></div>
             <div class="hk-row"><kbd>C</kbd><span>Clear all defenses</span></div>
             <div class="hk-row"><kbd>Tab</kbd><span>Cycle draw mode</span></div>
             <div class="hk-row"><kbd>Esc</kbd><span>Cancel draw / close menu</span></div>
             <h3>Abilities</h3>
             <div class="hk-row"><kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd><span>Trigger ability slots 1–3</span></div>
             <div class="hk-row"><kbd>A</kbd><span>Trigger ability slot 1 (alias)</span></div>
             <h3>Patterns</h3>
             <div class="hk-row"><kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>8</kbd><span>Load preset</span></div>
             <h3>Menus</h3>
             <div class="hk-row"><kbd>Enter</kbd><span>Start game (from menu)</span></div>
             <div class="hk-row"><kbd>G</kbd> <kbd>F1</kbd><span>Hacking guide</span></div>
            <div class="hk-row"><kbd>H</kbd><span>How to Play guide</span></div>
            <div class="hk-row"><kbd>?</kbd><span>This hotkey help</span></div>
           </div>
         </div>
         <p class="hk-hint">Press <kbd>?</kbd> or <kbd>Esc</kbd> to close.</p>
       </div>`;
  document.getElementById('game-container').appendChild(div);
  game.hotkeyHelpEl = div;
  div.addEventListener('click', (e) => {
    if (e.target === div) toggleHotkeyHelp(game, false);
  });
}

export function toggleHotkeyHelp(game, force) {
  if (!game.hotkeyHelpEl) return;
  const show = force === undefined ? !game.hotkeyHelpVisible : !!force;
  game.hotkeyHelpVisible = show;
  if (show) {
    game._helpPauseSpeed = CONFIG.SPEED_MULTIPLIER;
    CONFIG.SPEED_MULTIPLIER = 0;
    game.hotkeyHelpEl.classList.remove('hidden');
  } else {
    if (game._helpPauseSpeed != null) {
      CONFIG.SPEED_MULTIPLIER = game._helpPauseSpeed;
      game._helpPauseSpeed = null;
    }
    if (game.speedSlider) game._applySpeedFromSlider();
    game.hotkeyHelpEl.classList.add('hidden');
  }
}

export function initPanControls(game) {
  window.addEventListener('keydown', (e) => {
    if (!game.gameState.is(STATE.PLAYING) && !game.gameState.is(STATE.WAVE_TRANSITION)) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!game.grid) return;
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const step = e.ctrlKey ? 10 : 2;
      const delta = e.key === 'ArrowLeft' ? -step : step;
      const w = game.grid.width;
      game.grid.panOffset = (((game.grid.panOffset + delta) % w) + w) % w;
      if (game.renderer) {
        game.renderer.addFloater(
          Math.floor(w / 2),
          Math.floor(game.grid.height / 2),
          `↔ Pan: ${game.grid.panOffset}`,
          '#88ddff'
        );
      }
    }
  });
  if (game.canvas) {
    let panning = false;
    let lastX = 0;
    let accumulator = 0;
    game.canvas.addEventListener('mousedown', (e) => {
      if (!e.altKey) return;
      if (!game.gameState.is(STATE.PLAYING) && !game.gameState.is(STATE.WAVE_TRANSITION)) return;
      e.preventDefault();
      panning = true;
      lastX = e.clientX;
      accumulator = 0;
    });
    window.addEventListener('mousemove', (e) => {
      if (!panning) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      accumulator += dx;
      const cs = CONFIG.CELL_SIZE > 0 ? CONFIG.CELL_SIZE : 1;
      const cellsMoved = Math.trunc(accumulator / cs);
      if (cellsMoved !== 0 && game.grid) {
        const w = game.grid.width;
        game.grid.panOffset = (((game.grid.panOffset - cellsMoved) % w) + w) % w;
        accumulator -= cellsMoved * cs;
      }
    });
    window.addEventListener('mouseup', () => {
      panning = false;
    });
  }
}
