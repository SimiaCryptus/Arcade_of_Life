// src/game/missileDefender.js
//
// Normal "Missile Defender" game mode. Extracted from main.js to keep
// mode-specific logic isolated from the core Game shell. Handles:
//   • Starting a fresh default game (clearing the grid, placing cities,
//     resetting ink/HUD, starting wave 0)
//   • Wave progression (nextWave) and the dramatic wave banner
//   • Default game-over detection and overlay
//   • Clearing stray friendly paint outside the draw zone between waves
//
// The Game instance is passed in so this module can reach the grid,
// simulation, entities, HUD, renderer, and other singletons without
// owning them.

import { CONFIG, SPEED_PRESETS, CELL_TYPE } from '../config.js';
import { STATE } from '../gameState.js';
import { Logger } from '../logger.js';
import { Sfx } from '../audio.js';
import { requestWakeLock, releaseWakeLock } from '../pwa.js';

export class MissileDefenderMode {
  /**
   * @param {object} game - the live Game instance
   */
  constructor(game) {
    this.game = game;
  }

  /**
   * Start (or restart) a default Missile Defender game. Resets all
   * mutable state, applies user settings, rebuilds the world if the
   * resolution changed, places cities, and kicks off wave 0.
   */
  start() {
    const game = this.game;
    Logger.info('[MissileDefenderMode] Starting game.');
    // If a custom-level replay is in flight, the startButton's persistent
    // addEventListener still fires alongside the onclick override. Skip
    // the default-config check (and the rest of default startup) in that
    // case so we don't prompt the user about settings on Play Again.
    if (game._suppressNextStartGame) {
      game._suppressNextStartGame = false;
      Logger.info(
        '[MissileDefenderMode] Suppressing default start — custom level replay in progress.'
      );
      return;
    }
    // Check for non-default settings (excluding board size) and offer reset.
    if (!game._checkAndPromptForReset('Arcade Mode')) {
      return; // user cancelled
    }
    // Always re-apply settings to CONFIG at game start. This ensures the
    // simulation begins from a known-consistent state even on a truly
    // fresh launch (no localStorage, no reset prompt fired). Without this,
    // CONFIG values mutated during Game construction (_fitCellSize,
    // _buildWorld, backend init) can leave the simulation in a stale
    // state where gliders spawn but never advance.
    try {
      game.settings.apply();
      Logger.info('[MissileDefenderMode] Applied settings to CONFIG at start entry.');
    } catch (e) {
      Logger.warn('[MissileDefenderMode] settings.apply() at start entry failed', e);
    }
    // Force a full world rebuild at game start. This guarantees the
    // simulation backend, grid, and entities all reflect the current
    // CONFIG state — critical on a fresh launch where the initial
    // _buildWorld() ran before settings were fully applied.
    Logger.info('[MissileDefenderMode] Forcing world rebuild at start entry.');
    game._fitCellSize();
    game._buildWorld();
    game.renderer.setGrid(game.grid);
    game._initSpeedControls();
    Sfx.waveStart();
    // Clear any active custom level state — default game mode is starting.
    game._activeCustomLevel = null;
    game._customVictoryShown = false;
    // Restore default colors if a custom level had overridden them.
    if (game._defaultColors) {
      Object.assign(CONFIG.COLORS, game._defaultColors);
      game._defaultColors = null;
    }
    // Clear level-imposed tool/pattern restrictions.
    if (game.drawTools) {
      game.drawTools.setLevelToolRestriction(null);
      game.drawTools.setLevelPatternRestriction(null);
    }
    // Clear custom bases/spawners from missiles module.
    if (game.missiles) {
      game.missiles.setCustomBases([]);
      game.missiles.setCustomSpawners([]);
    }
    // Acquire wake lock so the screen stays on during gameplay.
    requestWakeLock();
    // Apply any pending settings (may have changed resolution / gliders).
    game.settings.apply();
    // World was already rebuilt at start entry, but double-check
    // resolution in case settings.apply() changed it after the rebuild.
    if (game.grid.width !== CONFIG.GRID_WIDTH || game.grid.height !== CONFIG.GRID_HEIGHT) {
      Logger.info(
        `Resolution changed to ${CONFIG.GRID_WIDTH}x${CONFIG.GRID_HEIGHT}; rebuilding world.`
      );
      game._fitCellSize();
      game._buildWorld();
      game.renderer.setGrid(game.grid);
      game._initSpeedControls();
    }
    game.defenses.maxInk = CONFIG.MAX_INK;
    game.grid.cells.fill(0);
    game.grid.pending.fill(0);
    game.grid.pendingDry.fill(0);
    game.grid.explosionTimers.fill(0);
    game.grid.cellAge.fill(0);
    game.grid.cellColor.fill(0);
    game.grid.cellDir.fill(0);
    if (game.simulation.returnFireFired) {
      game.simulation.returnFireFired.fill(0);
    }
    game.defenses.reset();
    game.hud.reset();
    game.cities.place();
    // Initial wave: also enforce draw-zone constraint.
    this.clearFriendlyOutsideDrawZone();
    game.missiles.startWave(0);
    this.announceWave(1);
    game.gameState.set(STATE.PLAYING);
    game.hideOverlay();
    // Apply starting speed from CONFIG.STARTING_SPEED. This must happen AFTER
    // settings.apply() above, so it picks up any user-configured starting speed.
    const startSpeed = CONFIG.STARTING_SPEED != null ? CONFIG.STARTING_SPEED : 1.0;
    CONFIG.SPEED_MULTIPLIER = startSpeed;
    Logger.info(`[MissileDefenderMode] Default game starting speed: ${startSpeed}x`);
    if (game.speedSlider) {
      const startIdx = SPEED_PRESETS.findIndex((p) => p.value === startSpeed);
      let idx;
      if (startIdx >= 0) {
        idx = startIdx;
      } else {
        // Find closest preset.
        let bestIdx = SPEED_PRESETS.findIndex((p) => p.value === 1.0);
        let bestDiff = Infinity;
        SPEED_PRESETS.forEach((p, i) => {
          const diff = Math.abs(p.value - startSpeed);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
          }
        });
        idx = bestIdx;
      }
      game.speedSlider.value = String(idx);
      game._applySpeedFromSlider();
      if (startSpeed === 0) {
        game._prePauseIdx = SPEED_PRESETS.findIndex((p) => p.value === 1.0);
      }
      Logger.info(
        `[MissileDefenderMode] Speed slider set to idx=${idx} ` +
          `(${SPEED_PRESETS[idx].name}), CONFIG.SPEED_MULTIPLIER=${CONFIG.SPEED_MULTIPLIER}x`
      );
    }
    // Install/uninstall free-play abilities based on mode.
    if (game.story && game.story.isActive()) {
      // Story mode owns the ability button; ensure free-play is uninstalled.
      if (game.freeplayAbilities) game.freeplayAbilities.uninstall();
    } else {
      // Free-play: refresh tool lock state (all tools unlocked) and install
      // configured abilities.
      if (game.drawTools && game.drawTools.refreshToolLockState) {
        game.drawTools.refreshToolLockState();
        if (game.drawTools.refreshPatternLockState) {
          game.drawTools.refreshPatternLockState();
        }
      }
      if (game.freeplayAbilities) {
        game.freeplayAbilities.uninstall();
        game.freeplayAbilities.install();
      }
    }
    // Wire 'A' hotkey for free-play abilities (story engine has its own).
    // (Note: the FreeplayAbilityManager binds Q/W/E for individual slots;
    //  the legacy 'A' hotkey triggers slot 0 as a convenience.)
    if (!game._freeplayHotkeyBound) {
      game._freeplayHotkeyBound = true;
      window.addEventListener('keydown', (e) => {
        if (game.story && game.story.isActive()) return; // story owns A
        if (!game.freeplayAbilities || !game.freeplayAbilities.hasAnyActive()) return;
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          game.freeplayAbilities.trigger(0);
        }
      });
    }
  }

  /**
   * Advance to the next wave. Awards wave-completion bonus, refills
   * ink, clears stray paint outside the draw zone, and starts the
   * new wave.
   */
  nextWave() {
    const game = this.game;
    game.hud.wave++;
    Logger.info(`[MissileDefenderMode] Advancing to wave ${game.hud.wave}.`);
    Sfx.waveStart();
    // Award wave-completion bonus for the wave we just finished.
    // (game.hud.wave is now the upcoming wave; the cleared one is wave-1.)
    const clearedWave = game.hud.wave - 1;
    game.score.awardWaveClear(clearedWave, game.cities.aliveCount(), game.defenses.ink);
    game.defenses.refill(80);
    // Clear any friendly paint outside the drawable area before the next wave starts.
    this.clearFriendlyOutsideDrawZone();
    game.missiles.startWave(game.hud.wave - 1);
    this.announceWave(game.hud.wave);
    game.gameState.set(STATE.PLAYING);
  }

  /**
   * Show a dramatic floater banner announcing the start of a wave.
   * @param {number} waveNum
   */
  announceWave(waveNum) {
    const game = this.game;
    if (!game.renderer || !game.grid) return;
    const cx = Math.floor(game.grid.width / 2);
    const cy = Math.floor(game.grid.height / 4);
    // Pick a color that escalates with wave number.
    const colors = ['#00ffff', '#00ffaa', '#88ff44', '#ffcc44', '#ff8844', '#ff4444', '#ff44ff'];
    const color = colors[Math.min(waveNum - 1, colors.length - 1)];
    game.renderer.addBigFloater(cx, cy - 3, `◆ WAVE ${waveNum} ◆`, color, 2.4);
    game.renderer.addBigFloater(cx, cy, 'INCOMING!', color, 1.6);
    // Add a dramatic shockwave ring.
    game.renderer.addShockwave(cx, cy - 1, {
      maxRadius: 120,
      color,
      ttl: 50,
      width: 4,
    });
    // Particle burst.
    game.renderer.addParticleBurst(cx, cy, {
      count: 40,
      colors: [color, '#ffffff', '#ffcc44'],
      speed: 3.0,
      ttl: 60,
      size: 3.0,
      glow: 14,
    });
    game.renderer.addShake(3, 18);
  }

  /**
   * Remove DEFENSE cells (and pending ink) that lie outside the
   * current drawable area. Called at the start of each new wave so
   * stray paint from previous waves doesn't accumulate in the enemy
   * region.
   */
  clearFriendlyOutsideDrawZone() {
    const g = this.game.grid;
    if (!g) return;
    const dzMinY = g.drawZoneMinY();
    const dzMaxY = g.drawZoneMaxY();
    let cleared = 0;
    for (let y = 0; y < g.height; y++) {
      if (y >= dzMinY && y <= dzMaxY) continue;
      for (let x = 0; x < g.width; x++) {
        const i = y * g.width + x;
        if (g.cells[i] === CELL_TYPE.DEFENSE) {
          g.cells[i] = CELL_TYPE.EMPTY;
          g.cellAge[i] = 0;
          cleared++;
        }
        if (g.pending[i]) {
          g.pending[i] = 0;
          g.pendingDry[i] = 0;
        }
      }
    }
    if (cleared > 0) {
      Logger.info(`[MissileDefenderMode] Cleared ${cleared} friendly cells outside draw zone.`);
    }
  }

  /**
   * End the game. Shows the Game Over overlay and, if a custom level
   * was active, overrides the Play Again button to replay it.
   */
  gameOver() {
    const game = this.game;
    game.gameState.set(STATE.GAME_OVER);
    Sfx.gameOver();
    releaseWakeLock();
    Logger.info(
      `[MissileDefenderMode] Game over. Score=${game.hud.score}, ` +
        `wave=${game.hud.wave}, high=${game.hud.highScore}.`
    );
    // If this was a custom level, override "Play Again" to replay the level
    // rather than fall back to the default game mode.
    const wasCustomLevel = game._activeCustomLevel;
    const customLevelName = wasCustomLevel ? wasCustomLevel.name : null;
    game.showOverlay(
      'Game Over',
      `All cities destroyed!<br><br>
                     Final Score: <strong>${game.hud.score}</strong><br>
                     Wave Reached: ${game.hud.wave}<br>
                     High Score: ${game.hud.highScore}`,
      'Play Again'
    );
    if (customLevelName) {
      // Replace the start button handler temporarily to replay the level.
      const btn = game.startButton;
      const origHandler = btn.onclick;
      btn.onclick = () => {
        btn.onclick = origHandler;
        // Suppress the addEventListener-based startGame() that also fires
        // on this click, so we don't trigger the default-config prompt.
        game._suppressNextStartGame = true;
        game.startCustomLevel(customLevelName);
      };
    }
  }
}
