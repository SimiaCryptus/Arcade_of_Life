// src/game/spaceInvadersMode.js
//
// "Space Invaders" wave-based game mode. Enemy invaders spawn in
// formations at the top of the play field and descend toward the
// player's cities. Each wave increases invader count, formation
// density, and descent speed. Every 5th wave is a boss wave with
// a large multi-cell invader that requires sustained fire.
//
// Implementation notes:
//   • Loads the prototype level (levels/invaders.json) as the base
//     configuration, then scales spawner emit limits / intervals
//     each wave for escalating difficulty.
//   • Cities and defenses behave normally.
//   • Wave is complete when all spawners have exhausted their emit
//     limits AND no enemy cells remain in the enemy region.
//   • Score awarded per invader destroyed + wave clear bonus.

import { CONFIG, SPEED_PRESETS, CELL_TYPE } from '../config.js';
import { STATE } from '../gameState.js';
import { Logger } from '../logger.js';
import { Sfx } from '../audio.js';
import { requestWakeLock, releaseWakeLock } from '../pwa.js';
import { INVADERS_LEVEL } from './invadersLevel.js';
import { saveLevel } from '../levels.js';

export class SpaceInvadersMode {
  /**
   * @param {object} game - the live Game instance
   */
  constructor(game) {
    this.game = game;
    this.active = false;
    this.currentWave = 0;
    this.waveStartTime = 0;
    // Track whether we already triggered next-wave for the current wave.
    this._waveTransitionPending = false;
  }

  /**
   * Begin a fresh Space Invaders campaign. Resets state, builds
   * world from the prototype invaders level, and launches wave 1.
   */
  start() {
    const game = this.game;
    Logger.info('[SpaceInvadersMode] Starting campaign.');
    if (game._suppressNextStartGame) {
      game._suppressNextStartGame = false;
      return;
    }
    if (!game._checkAndPromptForReset('Space Invaders Mode')) {
      return;
    }
    this.active = true;
    this.currentWave = 0;
    this._waveTransitionPending = false;
    this._loggedExhaustedOnce = false;
    // Build a fresh copy of the prototype level for wave 1.
    const level = this._buildLevelForWave(1);
    Logger.info(
      `[SpaceInvadersMode] Loading prototype level "${level.name}" for wave 1: ` +
        `grid=${level.gridWidth}x${level.gridHeight}, ` +
        `${level.cities.length} cities, ${level.spawners.length} spawners, ` +
        `wrapVerticalShift=${level.wrapVerticalShift}.`
    );
    // Stash the level on the game so startCustomLevel-like behavior
    // can find it, but bypass the "custom level victory" auto-trigger
    // since we drive wave progression ourselves.
    this._loadLevelIntoGame(level);
    // Mark active so update() drives wave progression.
    this.currentWave = 1;
    this.waveStartTime = performance.now();
    // Set grace period for wave 1 (matches startNextWave logic).
    let maxInitialDelay = 0;
    for (const sp of level.spawners) {
      const d = sp.initialDelay != null ? sp.initialDelay : sp.interval || 0;
      if (d > maxInitialDelay) maxInitialDelay = d;
    }
    this._waveGraceUntil = performance.now() + Math.max(2000, maxInitialDelay + 1000);
    this._announceWave(1, false);
    Sfx.waveStart();
    game.gameState.set(STATE.PLAYING);
    game.hideOverlay();
  }

  /**
   * Load a level object into the game, mimicking startCustomLevel
   * but suppressing the custom-level victory check (we handle wave
   * progression ourselves).
   */
  _loadLevelIntoGame(level) {
    const game = this.game;
    // Persist the wave-scaled level in the in-memory levels store
    // (overwriting any prior wave's copy) so startCustomLevel can
    // find it by name. We use a stable name per session so the
    // saved-levels list doesn't get spammed with wave variants.
    try {
      saveLevel(level.name, level);
    } catch (e) {
      Logger.warn('[SpaceInvadersMode] saveLevel failed', e);
    }
    // Use the game's existing startCustomLevel path — it already
    // handles settings application, color theme, grid rebuild,
    // cities, defenses, bases, spawners, tool restrictions, ink,
    // and wrap vertical shift. Crucially, it also clamps the cells
    // grid bounds and re-initializes the backend.
    game.startCustomLevel(level.name);
    // startCustomLevel calls _customLevelVictory once enemies are
    // cleared, which would end the game prematurely. We need to
    // prevent that by clearing the active custom level handle —
    // but only AFTER startCustomLevel has finished applying state.
    // We keep a reference to the level locally for re-loading on
    // wave transitions.
    this._currentLevel = level;
    // Clear the game's custom level handle so its auto-victory
    // logic (in _update) doesn't fire. Our update() drives waves.
    game._activeCustomLevel = null;
    game._customVictoryShown = false;
  }

  /**
   * Build a deep copy of the prototype level, scaled for the given
   * wave number. Wave scaling:
   *   • Each wave reduces spawner interval (faster shots).
   *   • Each wave increases emit limit per spawner.
   *   • Initial delay drops on later waves.
   *   • Boss waves (every 5th) double the emit limit.
   * @param {number} wave - 1-indexed wave number
   */
  _buildLevelForWave(wave) {
    // Deep clone the prototype JSON each time so wave-to-wave edits
    // don't accumulate.
    const proto = JSON.parse(JSON.stringify(INVADERS_LEVEL));
    const isBoss = wave % 5 === 0;
    // Tag the level name with wave number so the HUD-friendly debug
    // logs are clearer.
    proto.name = `SpaceInvaders W${wave}`;
    // Scale ink economy per wave so it stays a visible, present
    // mechanic from wave 1 and becomes increasingly tight as waves
    // progress. Regen scales down slowly; max ink also tightens so
    // hoarding between waves is limited. Boss waves give a small
    // bump so the player can mount sustained fire on the mothership.
    const inkRegenScale = Math.max(0.45, 1.0 - (wave - 1) * 0.07);
    const maxInkScale = Math.max(0.6, 1.0 - (wave - 1) * 0.05);
    if (proto.settings) {
      const baseRegen = proto.settings.INK_REGEN_RATE ?? 0.25;
      const baseMax = proto.settings.MAX_INK ?? 140;
      const baseInitial = proto.settings.INITIAL_INK ?? 80;
      proto.settings.INK_REGEN_RATE = Math.max(0.1, +(baseRegen * inkRegenScale).toFixed(3));
      proto.settings.MAX_INK = Math.max(60, Math.round(baseMax * maxInkScale));
      // Initial ink only matters on wave 1 (subsequent waves keep
      // the player's current ink), but scale it for consistency.
      proto.settings.INITIAL_INK = Math.min(
        proto.settings.MAX_INK,
        Math.max(50, Math.round(baseInitial * maxInkScale))
      );
      if (isBoss) {
        // Slight boss-wave relief: +25% max, +15% regen.
        proto.settings.MAX_INK = Math.round(proto.settings.MAX_INK * 1.25);
        proto.settings.INK_REGEN_RATE = +(proto.settings.INK_REGEN_RATE * 1.15).toFixed(3);
      }
      // Tighten the clear-defenses refund a bit too so spamming
      // clear isn't a free reset.
      proto.settings.CLEAR_REFUND_FRACTION = Math.max(0.2, +(0.5 - (wave - 1) * 0.03).toFixed(2));
    }
    // Scale each spawner. The prototype's spawners already have
    // sensible defaults; we modulate emit limits and intervals.
    const intervalScale = Math.max(0.4, 1.0 - (wave - 1) * 0.08);
    const emitScale = 1.0 + (wave - 1) * 0.5; // +50% per wave
    const delayScale = Math.max(0.3, 1.0 - (wave - 1) * 0.1);
    for (const sp of proto.spawners) {
      const baseInterval = sp.interval || 2000;
      const baseLimit = sp.emitLimit || 10;
      const baseDelay = sp.initialDelay != null ? sp.initialDelay : baseInterval;
      sp.interval = Math.max(400, Math.round(baseInterval * intervalScale));
      sp.emitLimit = Math.max(1, Math.round(baseLimit * emitScale));
      sp.initialDelay = Math.round(baseDelay * delayScale);
      if (isBoss) {
        // Boss waves: double emit limit, slightly faster spawns.
        sp.emitLimit = Math.round(sp.emitLimit * 2);
        sp.interval = Math.max(300, Math.round(sp.interval * 0.8));
      }
    }
    return proto;
  }

  /**
   * Start the next wave by reloading the prototype level with
   * updated wave-scaled spawners. We don't rebuild the world (that
   * would wipe the player's defenses) — we just inject fresh
   * spawners and announce.
   */
  startNextWave() {
    const game = this.game;
    this.currentWave++;
    this._waveTransitionPending = false;
    this._loggedExhaustedOnce = false;
    this._loggedNoSpawnersOnce = false;
    const isBoss = this.currentWave % 5 === 0;
    const level = this._buildLevelForWave(this.currentWave);
    this._currentLevel = level;
    game.hud.wave = this.currentWave;
    Logger.info(
      `[SpaceInvadersMode] Wave ${this.currentWave}: ` +
        `${level.spawners.length} spawners, boss=${isBoss}, ` +
        `total emitLimit=${level.spawners.reduce((s, sp) => s + (sp.emitLimit || 0), 0)}.`
    );
    // Inject fresh spawners (level.spawners use the missile module's
    // expected format: patternId, cells, interval, emitLimit, etc.).
    // Reset to no spawners first so the missiles module fully discards
    // any prior wave's spawner runtime state (emitted counters, timers,
    // exhausted flags). Then re-register the freshly wave-scaled
    // spawners. Without this two-step reset, the missiles module sees
    // the same spawner array shape and short-circuits initialization,
    // leaving the new wave with zero active spawners — which is why
    // wave 2+ instantly reports "all designed threats destroyed".
    game.missiles.setCustomSpawners([]);
    game.missiles.setCustomSpawners(level.spawners);
    // Always pass wave index 0: each Space Invaders wave is a fresh
    // "wave 0" of a freshly-scaled custom level. Passing the real
    // wave index causes the missiles module to compute extra
    // procedural threats on top of our designed spawners, which we
    // don't want here.
    game.missiles.startWave(0);
    // Compute the maximum initialDelay across spawners so we know
    // how long to wait before considering wave-completion checks
    // valid. Otherwise isWaveComplete() can fire on the very next
    // frame (no enemies on grid yet, no emissions yet) and we
    // skip the whole wave.
    let maxInitialDelay = 0;
    for (const sp of level.spawners) {
      const d = sp.initialDelay != null ? sp.initialDelay : sp.interval || 0;
      if (d > maxInitialDelay) maxInitialDelay = d;
    }
    this._waveGraceUntil = performance.now() + Math.max(2000, maxInitialDelay + 1000);
    // Top up ink between waves. Refund shrinks with wave number so
    // ink pressure climbs alongside the spawn pressure. Boss waves
    // get a modest bonus so the player isn't completely starved
    // against the mothership.
    if (this.currentWave > 1) {
      const isBoss = this.currentWave % 5 === 0;
      const baseRefill = Math.max(15, 50 - (this.currentWave - 2) * 4);
      const refill = isBoss ? Math.round(baseRefill * 1.6) : baseRefill;
      game.defenses.refill(refill);
      Logger.info(
        `[SpaceInvadersMode] Wave ${this.currentWave} ink refill: ${refill} ` +
          `(maxInk=${game.defenses.maxInk}, regen=${CONFIG.INK_REGEN_RATE}).`
      );
      // Award wave clear bonus.
      game.score.awardWaveClear(this.currentWave - 1, game.cities.aliveCount(), game.defenses.ink);
    }
    this._announceWave(this.currentWave, isBoss);
    Sfx.waveStart();
    this.waveStartTime = performance.now();
  }

  /**
   * Show a wave-start banner. Boss waves get extra-dramatic VFX.
   */
  _announceWave(waveNum, isBoss) {
    const game = this.game;
    if (!game.renderer || !game.grid) return;
    const cx = Math.floor(game.grid.width / 2);
    const cy = Math.floor(game.grid.height / 4);
    if (isBoss) {
      game.renderer.addBigFloater(cx, cy - 4, '⚠ BOSS WAVE ⚠', '#ff0044', 3.0);
      game.renderer.addBigFloater(cx, cy - 1, `WAVE ${waveNum}`, '#ff4488', 2.4);
      game.renderer.addBigFloater(cx, cy + 2, 'DESTROY THE MOTHERSHIP', '#ff8844', 1.6);
      game.renderer.addShockwave(cx, cy - 1, {
        maxRadius: 180,
        color: '#ff0044',
        ttl: 70,
        width: 6,
      });
      game.renderer.addShockwave(cx, cy - 1, {
        maxRadius: 240,
        color: '#ff8800',
        ttl: 90,
        width: 3,
      });
      game.renderer.addParticleBurst(cx, cy, {
        count: 80,
        colors: ['#ff0044', '#ff4488', '#ffaa00', '#ffffff'],
        speed: 4.0,
        ttl: 90,
        size: 4.0,
        glow: 16,
      });
      game.renderer.addShake(8, 40);
    } else {
      const colors = ['#00ffff', '#00ffaa', '#88ff44', '#ffcc44', '#ff8844', '#ff4444', '#ff44ff'];
      const color = colors[Math.min(waveNum - 1, colors.length - 1) % colors.length];
      game.renderer.addBigFloater(cx, cy - 3, `◆ WAVE ${waveNum} ◆`, color, 2.4);
      game.renderer.addBigFloater(cx, cy, 'INVADERS APPROACHING!', color, 1.6);
      game.renderer.addShockwave(cx, cy - 1, {
        maxRadius: 120,
        color,
        ttl: 50,
        width: 4,
      });
      game.renderer.addParticleBurst(cx, cy, {
        count: 40,
        colors: [color, '#ffffff'],
        speed: 3.0,
        ttl: 60,
        size: 3.0,
        glow: 14,
      });
      game.renderer.addShake(3, 18);
    }
  }

  /**
   * Called each frame by the main loop. Detects wave completion
   * and triggers the next wave (or game over).
   */
  update() {
    if (!this.active) return;
    const game = this.game;
    if (!game.gameState.is(STATE.PLAYING)) return;
    // Defeat check: all cities lost.
    if (game.cities.aliveCount() === 0) {
      this.gameOver();
      return;
    }
    if (this._waveTransitionPending) return;
    // Grace period after wave start: spawners with initialDelay
    // haven't fired yet, and isWaveComplete() would falsely report
    // completion because no enemy cells exist and no emissions have
    // happened. Wait until at least the max initialDelay has elapsed.
    if (this._waveGraceUntil && performance.now() < this._waveGraceUntil) return;
    // Wave completion: defer to the missiles module's own logic, which
    // already correctly handles custom-level spawner exhaustion + enemy
    // cell cleanup. Reimplementing it here using private state risks
    // drifting out of sync with the missiles module (which is exactly
    // what was happening: missiles.isWaveComplete() returned true every
    // frame but our local _allSpawnersExhausted() check kept returning
    // false because it read state shapes that didn't match).
    if (!game.missiles || !game.missiles.isWaveComplete()) return;
    const enemyCells = this._countEnemyCells();
    // Defensive: if the missiles module reports complete but we have
    // no spawner state at all, the wave failed to initialize. Log
    // loudly and bail out of advancing so we don't burn through
    // waves instantly.
    const spawners = game.missiles._customSpawners;
    if (!Array.isArray(spawners) || spawners.length === 0) {
      if (!this._loggedNoSpawnersOnce) {
        Logger.warn(
          `[SpaceInvadersMode] Wave ${this.currentWave} has no spawners registered ` +
            `but missiles reports complete; aborting auto-advance.`
        );
        this._loggedNoSpawnersOnce = true;
      }
      return;
    }
    if (!this._loggedExhaustedOnce) {
      Logger.info(
        `[SpaceInvadersMode] Missiles report wave ${this.currentWave} complete; ` +
          `enemyCells=${enemyCells}.`
      );
      this._loggedExhaustedOnce = true;
    }
    Logger.info(
      `[SpaceInvadersMode] Wave ${this.currentWave} complete — ` + `triggering next wave in 1.8s.`
    );
    this._waveTransitionPending = true;
    // Brief delay before next wave so player gets feedback.
    setTimeout(() => {
      if (this.active && game.gameState.is(STATE.PLAYING)) {
        this.startNextWave();
      }
    }, 1800);
  }

  _allSpawnersExhausted() {
    const game = this.game;
    if (!game.missiles) return false;
    // The missiles module exposes _customSpawnerState, an array of
    // per-spawner runtime state objects with .emitted counts.
    const state = game.missiles._customSpawnerState;
    const spawners = game.missiles._customSpawners;
    if (!Array.isArray(spawners) || spawners.length === 0) {
      // No spawners means nothing left to fire.
      return true;
    }
    if (!Array.isArray(state) || state.length !== spawners.length) {
      // State not yet initialized (e.g. wave just started this frame).
      // Treat as not-exhausted so we don't immediately advance.
      return false;
    }
    for (let i = 0; i < spawners.length; i++) {
      const sp = spawners[i];
      const st = state[i];
      const limit = sp.emitLimit || 0;
      const emitted = (st && st.emitted) || 0;
      // 0 means infinite — never exhausted.
      if (limit === 0) return false;
      if (emitted < limit) return false;
    }
    return true;
  }

  _countEnemyCells() {
    const g = this.game.grid;
    if (!g) return 0;
    // Count all MISSILE cells anywhere on the grid — invaders may
    // wrap or drift into the friendly zone before being cleared.
    let count = 0;
    const total = g.width * g.height;
    for (let i = 0; i < total; i++) {
      if (g.cells[i] === CELL_TYPE.MISSILE) count++;
    }
    return count;
  }

  gameOver() {
    const game = this.game;
    if (!this.active) return;
    this.active = false;
    game.gameState.set(STATE.GAME_OVER);
    Sfx.gameOver();
    releaseWakeLock();
    Logger.info(
      `[SpaceInvadersMode] Game over at wave ${this.currentWave}. ` +
        `Score=${game.hud.score}, high=${game.hud.highScore}.`
    );
    const waveLabel = this.currentWave;
    game.showOverlay(
      '👾 GAME OVER',
      `The invaders have overrun your cities!<br><br>
                     Wave Reached: <strong>${waveLabel}</strong><br>
                     Final Score: <strong>${game.hud.score}</strong><br>
                     High Score: ${game.hud.highScore}`,
      'Play Again'
    );
    // Override Play Again to restart Space Invaders mode.
    const btn = game.startButton;
    const origHandler = btn.onclick;
    btn.onclick = () => {
      btn.onclick = origHandler;
      game._suppressNextStartGame = true;
      this.start();
    };
  }

  /**
   * Called when player exits to menu — cleans up state.
   */
  stop() {
    this.active = false;
    this.currentWave = 0;
    this._waveTransitionPending = false;
    this._currentLevel = null;
    if (this.game.missiles) {
      this.game.missiles.setCustomSpawners([]);
    }
  }
}
