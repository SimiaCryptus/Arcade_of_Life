import { CONFIG, CELL_TYPE } from './config.js';
import { Logger } from './logger.js';

/**
 * Free-play active ability manager.
 *
 * Story mode installs abilities via perk selection. In free-play we
 * install all CONFIG-enabled abilities up front so the player can use
 * them. All enabled active abilities are available simultaneously,
 * each with its own button and hotkey (Q, W, E for slots 1, 2, 3).
 */

// Hotkeys for the active ability slots (in order).
const ACTIVE_HOTKEYS = ['q', 'w', 'e'];

// Build the registry of available actives + passives.
function buildPassives() {
  return {
    ABILITY_DOUBLE_SCORE: {
      icon: '⭐',
      name: 'Combat Bonuses',
      apply: (mgr) => {
        mgr.scoreMult *= 1.5;
      },
    },
    ABILITY_NO_DRY: {
      icon: '⚡',
      name: 'Instant Set',
      apply: () => {
        CONFIG.INK_DRY_TICKS = 0;
      },
    },
    ABILITY_WAVE_BONUS: {
      icon: '💰',
      name: 'Veteran Pay',
      apply: (mgr) => {
        mgr.waveInkBonus += 30;
      },
    },
    ABILITY_SAFE_ZONE: {
      icon: '🛡',
      name: 'Demilitarized Zone',
      apply: () => {
        CONFIG.HARDCORE_MODE = false;
      },
    },
    ABILITY_SLOW_MISSILES: {
      icon: '🐢',
      name: 'Atmospheric Drag',
      apply: () => {
        CONFIG.MISSILE_SPAWN_INTERVAL = Math.round(CONFIG.MISSILE_SPAWN_INTERVAL * 1.2);
      },
    },
  };
}

function buildActives(game) {
  return {
    ABILITY_EMP_BURST: {
      id: 'ab_emp_burst',
      name: 'EMP Burst',
      icon: '💥',
      cooldown: 30,
      trigger: () => {
        const g = game.grid;
        let n = 0;
        for (let i = 0; i < g.cells.length; i++) {
          if (g.cells[i] === CELL_TYPE.MISSILE) {
            g.cells[i] = CELL_TYPE.EXPLOSION;
            g.explosionTimers[i] = 6;
            n++;
          }
        }
        for (const t of game.missiles.targets) t.alive = false;
        game.missiles.targets = [];
        if (game.renderer) game.renderer.addShake(6, 25);
        return n > 0;
      },
    },
    ABILITY_INK_SURGE: {
      id: 'ab_ink_surge',
      name: 'Ink Surge',
      icon: '🎁',
      cooldown: 20,
      trigger: () => {
        game.defenses.refill(200);
        return true;
      },
    },
    ABILITY_FREEZE: {
      id: 'ab_freeze',
      name: 'Time Stop',
      icon: '⏱',
      cooldown: 45,
      trigger: () => {
        // Freeze only the enemy: missiles stop moving/aging/spawning.
        // Defenses continue to evolve under normal Life rules.
        const dur = 5000;
        if (game.simulation) game.simulation.freezeEnemies = true;
        if (game.missiles) game.missiles.frozen = true;
        // Auto-release after duration.
        if (game._freezeTimer) clearTimeout(game._freezeTimer);
        game._freezeTimer = setTimeout(() => {
          if (game.simulation) game.simulation.freezeEnemies = false;
          if (game.missiles) game.missiles.frozen = false;
          game._freezeTimer = null;
          if (game.renderer) {
            game.renderer.addBigFloater(
              Math.floor(game.grid.width / 2),
              Math.floor(game.grid.height / 3),
              '⏱ TIME RESUMES',
              '#88ccff',
              1.4
            );
          }
        }, dur);
        return true;
      },
    },
  };
}

export class FreeplayAbilityManager {
  constructor(game) {
    this.game = game;
    this.scoreMult = 1;
    this.waveInkBonus = 0;
    // All currently equipped active abilities, in slot order.
    // Each: { id, name, icon, cooldown, trigger, _cdRemaining }
    this.activeAbilities = [];
    this._buttonEls = []; // parallel to activeAbilities
    this._installed = false;
    this._hotkeyBound = false;
    // Initialize freeze timer slot on the game object so the cheats
    // dispatch in main.js doesn't trip over an undefined property.
    if (game && game._freezeTimer === undefined) {
      game._freezeTimer = null;
    }
  }

  // Apply enabled passives and bind ALL enabled active abilities.
  install() {
    if (this._installed) return;
    this._installed = true;
    const passives = buildPassives();
    for (const [cfgKey, def] of Object.entries(passives)) {
      if (CONFIG[cfgKey]) {
        try {
          def.apply(this);
        } catch (e) {
          Logger.error(`Freeplay ability ${cfgKey} failed`, e);
        }
      }
    }
    // Bind ALL enabled actives (in declared order).
    const actives = buildActives(this.game);
    this.activeAbilities = [];
    for (const [cfgKey, def] of Object.entries(actives)) {
      if (CONFIG[cfgKey]) {
        this.activeAbilities.push({ ...def, _cdRemaining: 0 });
      }
    }
    // Apply wave bonus immediately if any.
    if (this.waveInkBonus > 0 && this.game.defenses) {
      this.game.defenses.refill(this.waveInkBonus);
    }
    // Push scoring multiplier into the ScoreManager so it applies to
    // every kill and wave bonus uniformly. No more callback hooks.
    if (this.scoreMult > 1 && this.game.score) {
      this.game.score.setGlobalMultiplier(this.scoreMult);
    }
    // Hook wave-start bonus.
    if (this.waveInkBonus > 0) this._hookWaveBonus();
    // Build / show buttons.
    this._ensureButtons();
    this._updateButtons();
    // Bind hotkeys (once).
    this._bindHotkeys();
  }

  uninstall() {
    // We don't bother undoing passive CONFIG mutations — they get
    // re-applied on next game start anyway via Settings.apply().
    this._installed = false;
    this.activeAbilities = [];
    this._removeButtons();
    // Reset the score multiplier so a new game starts clean.
    if (this.game && this.game.score) {
      this.game.score.setGlobalMultiplier(1.0);
    }
  }

  _hookWaveBonus() {
    const game = this.game;
    const mgr = this;
    const origNext = game.nextWave.bind(game);
    game.nextWave = function () {
      origNext();
      if (mgr.waveInkBonus > 0) {
        game.defenses.refill(mgr.waveInkBonus);
      }
    };
  }

  _ensureButtons() {
    const abilitiesGroup = document.getElementById('abilities-group');
    if (!abilitiesGroup) return;
    this._removeButtons();
    // Also hide the legacy single-slot button if present (story mode owns it).
    const legacy = document.getElementById('ability-button');
    if (legacy) legacy.style.display = 'none';
    // The new AbilitiesMenu dropup hosts all abilities — we no longer
    // create individual visible buttons here. Hidden stub buttons remain
    // in the DOM (legacy compatibility) but are styled out.
    // Just notify the menu to rebuild its contents.
    if (this.game && this.game.abilitiesMenu) {
      this.game.abilitiesMenu.rebuild();
    }
  }

  _removeButtons() {
    for (const btn of this._buttonEls) {
      if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    }
    this._buttonEls = [];
    if (this.game && this.game.abilitiesMenu) {
      this.game.abilitiesMenu.rebuild();
    }
  }

  _bindHotkeys() {
    if (this._hotkeyBound) return;
    this._hotkeyBound = true;
    window.addEventListener('keydown', (e) => {
      if (!this._installed) return;
      if (this.activeAbilities.length === 0) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      const idx = ACTIVE_HOTKEYS.indexOf(k);
      if (idx >= 0 && idx < this.activeAbilities.length) {
        e.preventDefault();
        this.trigger(idx);
      }
    });
  }

  trigger(idx) {
    const ab = this.activeAbilities[idx];
    if (!ab) return false;
    if (ab._cdRemaining > 0) {
      if (this.game.renderer) {
        this.game.renderer.addBigFloater(
          Math.floor(this.game.grid.width / 2),
          Math.floor(this.game.grid.height / 3),
          `COOLDOWN ${Math.ceil(ab._cdRemaining)}s`,
          '#ff8888',
          1.2
        );
      }
      return false;
    }
    const ok = ab.trigger();
    if (ok) {
      ab._cdRemaining = ab.cooldown;
      if (this.game.renderer) {
        this.game.renderer.addBigFloater(
          Math.floor(this.game.grid.width / 2),
          Math.floor(this.game.grid.height / 3),
          `${ab.icon} ${ab.name}`,
          '#ffcc44',
          1.6
        );
      }
      this._updateButtons();
    }
    return ok;
  }

  update(dt) {
    if (this.activeAbilities.length === 0) return;
    let changed = false;
    for (const ab of this.activeAbilities) {
      if (ab._cdRemaining > 0) {
        ab._cdRemaining = Math.max(0, ab._cdRemaining - dt / 1000);
        changed = true;
      }
    }
    if (changed) this._updateButtons();
  }

  _updateButtons() {
    // No-op: the AbilitiesMenu dropup polls cooldowns itself and
    // refreshes labels on a timer. We just leave the data fresh on
    // each ability object and let the menu pick it up.
  }

  // Whether the player has any active ability bound. Used by main.js
  // to decide if the legacy 'A' hotkey path should fire.
  hasAnyActive() {
    return this.activeAbilities.length > 0;
  }
}
