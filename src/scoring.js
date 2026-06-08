import { CONFIG } from './config.js';
import { Logger } from './logger.js';

/**
 * Centralized scoring system.
 *
 * Design philosophy:
 *   - Only reward MEANINGFUL player accomplishments.
 *   - Ambient simulation events (cells dying, ricochets, return fire)
 *     produce visual feedback but no score.
 *   - Structural threats (bases, targets, spawners) are the real
 *     point sources — destroying them reflects player skill.
 *   - Wave survival bonuses scale with wave number, so late-game
 *     defense is properly rewarded.
 *   - A combo multiplier rewards rapid successive kills, replacing
 *     the old "lots of small numbers" excitement.
 *
 * Score categories (constants below) provide default values. At
 * runtime, every value can be overridden via CONFIG.SCORE_VALUES_*
 * and CONFIG.COMBO_* keys (set by the user/level designer). The
 * helpers `sv()` and `cc()` read CONFIG first and fall back to
 * these defaults, so a level can completely retune scoring.
 */

export const SCORE_VALUES_DEFAULTS = {
  // ── Structural kills (the meat of scoring) ──────────────────
  TARGET_DESTROYED: 1000, // mobile glider-spawning targets
  FORTRESS_DESTROYED: 1500, // largest static base
  BUNKER_DESTROYED: 800, // smaller static base
  CRUISER_DESTROYED: 1200, // horizontal spaceship base
  SPAWNER_DESTROYED: 750, // custom-level spawners

  // ── Wave completion ──────────────────────────────────────────
  // Per surviving city, multiplied by wave number.
  CITY_SURVIVAL_PER_WAVE: 200,
  // Flat completion bonus, also multiplied by wave number.
  WAVE_CLEAR_BASE: 500,
  // Per unit of remaining ink at wave end (efficiency bonus).
  INK_EFFICIENCY: 0.25,

  // ── Custom level victory ─────────────────────────────────────
  // Per surviving city.
  VICTORY_CITY_BONUS: 1500,
  // Flat victory bonus.
  VICTORY_FLAT: 3000,
  // Per remaining ink unit.
  VICTORY_INK: 1.0,

  // ── Penalties (real consequences) ────────────────────────────
  CITY_CELL_LOST: -50, // each city cell destroyed by an attacker
  FRIENDLY_FIRE_PENALTY: -100, // each city cell destroyed by your own defenses
  BREACH_PENALTY: -75, // missile slipped past defenses into rear zone
};
/**
 * Live proxy: reading SCORE_VALUES.X returns the CONFIG override if
 * present, else the default. Mutating SCORE_VALUES.X writes through
 * to CONFIG so all callers see the change.
 *
 * This preserves backwards compatibility with code that imports and
 * reads SCORE_VALUES.X directly.
 */
export const SCORE_VALUES = new Proxy(SCORE_VALUES_DEFAULTS, {
  get(target, prop) {
    const cfgKey = `SCORE_${prop}`;
    if (CONFIG && Object.prototype.hasOwnProperty.call(CONFIG, cfgKey)) {
      const v = CONFIG[cfgKey];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return target[prop];
  },
  set(_target, prop, value) {
    const cfgKey = `SCORE_${prop}`;
    if (CONFIG) CONFIG[cfgKey] = value;
    return true;
  },
});

/**
 * Combo system. Kills within COMBO_WINDOW_MS of each other build a
 * multiplier that resets when the window expires. Caps at COMBO_MAX.
 */
export const COMBO_CONFIG_DEFAULTS = {
  WINDOW_MS: 4000, // time within which kills chain
  MAX_MULT: 5.0, // hard cap on combo multiplier
  INCREMENT: 0.25, // each chained kill adds this to the multiplier
  // Only "real" kills (targets, bases, spawners) build combo.
  // Penalties don't break it (so a single bad event doesn't gut a run),
  // but they don't extend it either.
};
/** Live proxy for combo config — see SCORE_VALUES above. */
export const COMBO_CONFIG = new Proxy(COMBO_CONFIG_DEFAULTS, {
  get(target, prop) {
    const cfgKey = `COMBO_${prop}`;
    if (CONFIG && Object.prototype.hasOwnProperty.call(CONFIG, cfgKey)) {
      const v = CONFIG[cfgKey];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return target[prop];
  },
  set(_target, prop, value) {
    const cfgKey = `COMBO_${prop}`;
    if (CONFIG) CONFIG[cfgKey] = value;
    return true;
  },
});

export class ScoreManager {
  constructor(hud, renderer, grid) {
    this.hud = hud;
    this.renderer = renderer;
    this.grid = grid;
    // Combo state.
    this.comboCount = 0;
    this.comboMult = 1.0;
    this.lastKillTime = 0;
    // External score multiplier (e.g. from Combat Bonuses ability).
    this.globalMult = 1.0;
  }

  /** Set a permanent multiplier applied to ALL scoring events. */
  setGlobalMultiplier(m) {
    this.globalMult = Math.max(0, +m || 1.0);
  }

  /** Reset combo state (e.g. at game start, wave transition optional). */
  resetCombo() {
    this.comboCount = 0;
    this.comboMult = 1.0;
    this.lastKillTime = 0;
  }

  /** Internal: update combo state for a "real" kill at time `now`. */
  _bumpCombo(now) {
    if (now - this.lastKillTime <= COMBO_CONFIG.WINDOW_MS) {
      this.comboCount++;
      this.comboMult = Math.min(
        COMBO_CONFIG.MAX_MULT,
        1.0 + this.comboCount * COMBO_CONFIG.INCREMENT
      );
    } else {
      this.comboCount = 1;
      this.comboMult = 1.0 + COMBO_CONFIG.INCREMENT;
    }
    this.lastKillTime = now;
  }

  /** Has the active combo expired? */
  update(_dt) {
    if (this.comboCount === 0) return;
    const now = performance.now();
    if (now - this.lastKillTime > COMBO_CONFIG.WINDOW_MS) {
      // Combo ended — show a small visual cue if it was a big one.
      if (this.comboCount >= 3 && this.renderer && this.grid) {
        this.renderer.addFloater(
          Math.floor(this.grid.width / 2),
          Math.floor(this.grid.height / 3) + 2,
          `Combo end: x${this.comboCount}`,
          '#888888'
        );
      }
      this.comboCount = 0;
      this.comboMult = 1.0;
    }
  }

  /**
   * Award score for destroying a structural threat. Builds combo.
   * @param {string} kind  human-readable label (for floater)
   * @param {number} basePoints  raw value from SCORE_VALUES
   * @param {number} [gx]  grid x for floater origin
   * @param {number} [gy]  grid y for floater origin
   */
  awardKill(kind, basePoints, gx, gy) {
    const now = performance.now();
    this._bumpCombo(now);
    const total = Math.round(basePoints * this.comboMult * this.globalMult);
    this.hud.addScore(total);
    if (this.renderer && gx != null && gy != null) {
      const comboTag = this.comboMult > 1.0 ? ` x${this.comboMult.toFixed(2)}` : '';
      this.renderer.addBigFloater(gx, gy, `${kind} +${total}${comboTag}`, '#ffff44', 1.6);
      if (this.comboCount >= 3) {
        this.renderer.addFloater(gx, gy + 2, `COMBO ${this.comboCount}!`, '#ffaa00');
      }
    }
    Logger.debug(
      `Score: ${kind} +${total} (base=${basePoints}, combo=x${this.comboMult.toFixed(2)}, global=x${this.globalMult})`
    );
    return total;
  }

  /**
   * Award score for a wave being cleared. No combo applied (this is a
   * planned bonus, not a reflex event), but global multiplier applies.
   */
  awardWaveClear(waveNum, citiesAlive, inkRemaining) {
    const flat = SCORE_VALUES.WAVE_CLEAR_BASE * waveNum;
    const cities = SCORE_VALUES.CITY_SURVIVAL_PER_WAVE * citiesAlive * waveNum;
    const ink = Math.floor(inkRemaining * SCORE_VALUES.INK_EFFICIENCY);
    const total = Math.round((flat + cities + ink) * this.globalMult);
    this.hud.addScore(total);
    if (this.renderer && this.grid) {
      const cx = Math.floor(this.grid.width / 2);
      const cy = Math.floor(this.grid.height / 3);
      this.renderer.addBigFloater(cx, cy + 4, `WAVE ${waveNum} CLEAR +${total}`, '#00ffaa', 1.8);
      this.renderer.addFloater(
        cx,
        cy + 6,
        `Cities x${citiesAlive} • Ink ${Math.floor(inkRemaining)}`,
        '#88ffcc'
      );
    }
    Logger.info(
      `Wave ${waveNum} clear bonus: +${total} (flat=${flat}, cities=${cities}, ink=${ink})`
    );
    return total;
  }

  /** Award score for completing a custom level. */
  awardVictory(citiesAlive, inkRemaining) {
    const flat = SCORE_VALUES.VICTORY_FLAT;
    const cities = SCORE_VALUES.VICTORY_CITY_BONUS * citiesAlive;
    const ink = Math.floor(inkRemaining * SCORE_VALUES.VICTORY_INK);
    const total = Math.round((flat + cities + ink) * this.globalMult);
    this.hud.addScore(total);
    Logger.info(`Victory bonus: +${total} (flat=${flat}, cities=${cities}, ink=${ink})`);
    return total;
  }

  /**
   * Apply a penalty. Penalties are NOT multiplied by globalMult
   * (so abilities can't be exploited to reduce penalties) and do
   * NOT reset combo (one bad event shouldn't gut a great run).
   */
  penalty(kind, points, gx, gy) {
    this.hud.addScore(points);
    if (this.renderer && gx != null && gy != null) {
      this.renderer.addFloater(gx, gy, `${kind} ${points}`, '#ff6666');
    }
    Logger.debug(`Score penalty: ${kind} ${points}`);
    return points;
  }
}
