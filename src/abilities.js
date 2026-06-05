import {CONFIG, CELL_TYPE} from './config.js';
import {Logger} from './logger.js';

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
      icon: '⭐', name: 'Combat Bonuses',
      apply: (mgr) => {
        mgr.scoreMult *= 1.5;
      },
    },
    ABILITY_NO_DRY: {
      icon: '⚡', name: 'Instant Set',
      apply: () => {
        CONFIG.INK_DRY_TICKS = 0;
      },
    },
    ABILITY_WAVE_BONUS: {
      icon: '💰', name: 'Veteran Pay',
      apply: (mgr) => {
        mgr.waveInkBonus += 30;
      },
    },
    ABILITY_SAFE_ZONE: {
      icon: '🛡', name: 'Demilitarized Zone',
      apply: () => {
        CONFIG.HARDCORE_MODE = false;
      },
    },
    ABILITY_SLOW_MISSILES: {
      icon: '🐢', name: 'Atmospheric Drag',
      apply: () => {
        CONFIG.MISSILE_SPAWN_INTERVAL = Math.round(
          CONFIG.MISSILE_SPAWN_INTERVAL * 1.2);
      },
    },
  };
}

function buildActives(game) {
  return {
    ABILITY_EMP_BURST: {
      id: 'ab_emp_burst', name: 'EMP Burst', icon: '💥', cooldown: 30,
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
      id: 'ab_ink_surge', name: 'Ink Surge', icon: '🎁', cooldown: 20,
      trigger: () => {
        game.defenses.refill(200);
        return true;
      },
    },
    ABILITY_FREEZE: {
      id: 'ab_freeze', name: 'Time Stop', icon: '⏱', cooldown: 45,
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
              '⏱ TIME RESUMES', '#88ccff', 1.4);
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
        this.activeAbilities.push({...def, _cdRemaining: 0});
      }
    }
    // Apply wave bonus immediately if any.
    if (this.waveInkBonus > 0 && this.game.defenses) {
      this.game.defenses.refill(this.waveInkBonus);
    }
    // Hook scoring multiplier into sim callbacks.
    if (this.scoreMult > 1) this._hookScoreMult();
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
  }

  _hookScoreMult() {
    const sim = this.game.simulation;
    const mgr = this;
    const origDestroy = sim.onMissileDestroyed;
    sim.onMissileDestroyed = () => {
      const bonus = Math.round(10 * (mgr.scoreMult - 1));
      if (bonus > 0) mgr.game.hud.addScore(bonus);
      if (origDestroy) origDestroy();
    };
    const origRet = sim.onMissileReturn;
    sim.onMissileReturn = (x, y, kind) => {
      const base = (kind === 'ricochet') ? 50 : 20;
      const bonus = Math.round(base * (mgr.scoreMult - 1));
      if (bonus > 0) mgr.game.hud.addScore(bonus);
      if (origRet) origRet(x, y, kind);
    };
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
    const speedCtrl = document.getElementById('speed-control');
    if (!speedCtrl) return;
    this._removeButtons();
    // Find the anchor: insert before the clear-defenses button.
    const anchor = document.getElementById('clear-defenses-button') || null;
    // Also hide the legacy single-slot button if present (story mode owns it).
    const legacy = document.getElementById('ability-button');
    if (legacy) legacy.style.display = 'none';
    this.activeAbilities.forEach((ab, idx) => {
      const btn = document.createElement('button');
      btn.className = 'freeplay-ability-btn';
      btn.style.cssText = 'background:transparent;color:#ffcc44;border:1px solid #ffcc44;padding:4px 10px;font-size:12px;font-family:inherit;cursor:pointer;border-radius:3px;font-weight:bold;';
      const key = ACTIVE_HOTKEYS[idx];
      btn.title = `Trigger ${ab.name}${key ? ` [${key.toUpperCase()}]` : ''}`;
      btn.addEventListener('click', () => this.trigger(idx));
      speedCtrl.insertBefore(btn, anchor);
      this._buttonEls.push(btn);
    });
  }

  _removeButtons() {
    for (const btn of this._buttonEls) {
      if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    }
    this._buttonEls = [];
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
          '#ff8888', 1.2);
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
          '#ffcc44', 1.6);
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
    this.activeAbilities.forEach((ab, idx) => {
      const btn = this._buttonEls[idx];
      if (!btn) return;
      const cd = ab._cdRemaining || 0;
      const key = ACTIVE_HOTKEYS[idx];
      const keyTag = key ? ` [${key.toUpperCase()}]` : '';
      if (cd > 0) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.textContent = `${ab.icon} ${ab.name} (${Math.ceil(cd)}s)`;
      } else {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.textContent = `${ab.icon} ${ab.name}${keyTag}`;
      }
    });
  }

  // Whether the player has any active ability bound. Used by main.js
  // to decide if the legacy 'A' hotkey path should fire.
  hasAnyActive() {
    return this.activeAbilities.length > 0;
  }
}
