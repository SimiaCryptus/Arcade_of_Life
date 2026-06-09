// Tower Defense mode helper. Manages per-ink-type budgets for
// barrier and fire tiles when a custom level enables them.
//
// A level is considered "tower defense" when TD_BARRIER_INK > 0
// or TD_FIRE_INK > 0 in its captured settings. In that case:
//   • the game starts paused with a "Ready" button overlay
//   • the player can paint defense / barrier / fire ink
//   • barrier & fire ink do not regen and cannot be refunded
//   • after start, in-game placement of barrier/fire is gated by
//     TD_ALLOW_INGAME_PLACEMENT

import { CONFIG, CELL_TYPE } from './config.js';
import { Logger } from './logger.js';

export class TowerDefenseManager {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.preGame = false;
    this.barrierInk = 0;
    this.fireInk = 0;
    this.maxBarrierInk = 0;
    this.maxFireInk = 0;
    this.allowInGamePlacement = true;
    // Track which paint type is currently selected by the player.
    // 'defense' | 'barrier' | 'fire'
    this.activeInkType = 'defense';
    this._readyOverlay = null;
    this._inkSelectorEl = null;
  }

  /** Initialize TD state for the active level. Call AFTER settings applied. */
  activate() {
    this.active = true;
    this.preGame = true;
    this.maxBarrierInk = Math.max(0, CONFIG.TD_BARRIER_INK | 0);
    this.maxFireInk = Math.max(0, CONFIG.TD_FIRE_INK | 0);
    this.barrierInk = this.maxBarrierInk;
    this.fireInk = this.maxFireInk;
    this.allowInGamePlacement = !!CONFIG.TD_ALLOW_INGAME_PLACEMENT;
    this.activeInkType = 'defense';
    Logger.info(
      `[TD] Activated: barrier=${this.barrierInk}, fire=${this.fireInk}, ` +
        `ingame=${this.allowInGamePlacement}`
    );
    this._wireInput();
    this._buildInkSelectorUI();
    this._showReadyOverlay();
    // Force pause until player presses Ready.
    this._stashedSpeed = CONFIG.SPEED_MULTIPLIER;
    CONFIG.SPEED_MULTIPLIER = 0;
    const lbl = document.getElementById('speed-label');
    if (lbl) lbl.textContent = 'PAUSED (place defenses)';
  }

  /** Tear down TD state when leaving the level. */
  deactivate() {
    this.active = false;
    this.preGame = false;
    this._hideReadyOverlay();
    this._destroyInkSelectorUI();
    this._unwireInput();
    this.activeInkType = 'defense';
    // Defensive cleanup: also remove any orphaned DOM nodes that might
    // have been left behind by an earlier instance (e.g. after a reload
    // or state desync).
    const staleSelector = document.getElementById('td-ink-selector');
    if (staleSelector && staleSelector.parentNode) {
      staleSelector.parentNode.removeChild(staleSelector);
    }
    const staleOverlay = document.getElementById('td-ready-overlay');
    if (staleOverlay && staleOverlay.parentNode) {
      staleOverlay.parentNode.removeChild(staleOverlay);
    }
  }

  /** Called once per frame to keep budget UI fresh. */
  update() {
    if (!this.active) return;
    this._updateInkBudgetDisplay();
    this._updateInkSelectorEnabled();
  }

  /** Tells the InputManager whether refunds are allowed for active ink. */
  allowsRefund() {
    if (!this.active) return true;
    return this.activeInkType === 'defense';
  }

  /** Check whether the supplied settings enable TD mode. */
  static isTowerDefenseLevel(settings) {
    if (!settings) return false;
    const b = settings.TD_BARRIER_INK | 0;
    const f = settings.TD_FIRE_INK | 0;
    return b > 0 || f > 0;
  }

  /** Resolve which CELL_TYPE the current draw should produce. */
  resolveDrawCellType() {
    if (!this.active) return CELL_TYPE.DEFENSE;
    if (this.activeInkType === 'barrier') return CELL_TYPE.BARRIER;
    if (this.activeInkType === 'fire') return CELL_TYPE.FIRE;
    return CELL_TYPE.DEFENSE;
  }

  /** Returns true if a given ink type can be drawn right now. */
  canDraw(inkType) {
    if (!this.active) return inkType === 'defense';
    if (inkType === 'defense') return true;
    if (this.preGame) {
      if (inkType === 'barrier') return this.barrierInk > 0;
      if (inkType === 'fire') return this.fireInk > 0;
      return false;
    }
    // In-game.
    if (!this.allowInGamePlacement) return false;
    if (inkType === 'barrier') return this.barrierInk > 0;
    if (inkType === 'fire') return this.fireInk > 0;
    return false;
  }

  /**
   * Get available budget for current ink. Defense uses normal
   * defenses.ink; barrier/fire use TD budgets.
   */
  getAvailableInk() {
    if (!this.active || this.activeInkType === 'defense') {
      return this.game.defenses ? this.game.defenses.ink : 0;
    }
    if (this.activeInkType === 'barrier') return this.barrierInk;
    if (this.activeInkType === 'fire') return this.fireInk;
    return 0;
  }

  /** Spend N units of the active ink type. */
  spendInk(n) {
    if (!this.active) return;
    if (this.activeInkType === 'defense') {
      // Defense ink is handled by the InputManager via Defenses.consume.
      return;
    }
    if (this.activeInkType === 'barrier') {
      this.barrierInk = Math.max(0, this.barrierInk - n);
    } else if (this.activeInkType === 'fire') {
      this.fireInk = Math.max(0, this.fireInk - n);
    }
    this._updateInkBudgetDisplay();
    this._updateInkSelectorEnabled();
  }

  /** Called when player clicks the Ready button. */
  startGame() {
    if (!this.active || !this.preGame) return;
    Logger.info('[TD] Ready pressed — starting wave.');
    this.preGame = false;
    this._hideReadyOverlay();
    // Restore the saved speed (or default to 1).
    const restore =
      this._stashedSpeed != null && this._stashedSpeed > 0
        ? this._stashedSpeed
        : CONFIG.STARTING_SPEED || 1.0;
    CONFIG.SPEED_MULTIPLIER = restore;
    this._stashedSpeed = null;
    if (this.game._applySpeedFromSlider) this.game._applySpeedFromSlider();
    // If in-game placement is disabled, hide selector for non-defense.
    this._updateInkSelectorEnabled();
  }

  // ── UI: Ready overlay ───────────────────────────────────────
  _showReadyOverlay() {
    if (this._readyOverlay) return;
    const overlay = document.createElement('div');
    overlay.id = 'td-ready-overlay';
    overlay.style.cssText = [
      'position:fixed',
      'top:50%',
      'left:50%',
      'transform:translate(-50%,-50%)',
      'background:rgba(10,10,30,0.92)',
      'border:2px solid #00ffcc',
      'border-radius:10px',
      'padding:20px 28px',
      'z-index:1500',
      'text-align:center',
      'box-shadow:0 0 24px rgba(0,255,200,0.4)',
      'font-family:monospace',
      'color:#e0e0ff',
      'max-width:480px',
    ].join(';');
    const title = document.createElement('div');
    title.textContent = '🛡 TOWER DEFENSE';
    title.style.cssText =
      'font-size:18px;font-weight:bold;color:#00ffcc;margin-bottom:8px;cursor:move;user-select:none;';
    title.title = 'Drag to move';
    const msg = document.createElement('div');
    const parts = [];
    if (this.maxBarrierInk > 0)
      parts.push(`<strong style="color:#a0a0a0;">${this.maxBarrierInk} barrier</strong>`);
    if (this.maxFireInk > 0)
      parts.push(`<strong style="color:#ff8855;">${this.maxFireInk} fire</strong>`);
    const inkText = parts.length > 0 ? `${parts.join(' and ')} ink` : 'special ink';
    msg.innerHTML =
      `Place your defenses and ${inkText} before the assault begins.<br>` +
      `<span style="font-size:11px;color:#8080a0;">` +
      (this.allowInGamePlacement
        ? 'You can also place more during the wave.'
        : 'These special inks are only available now.') +
      `</span>`;
    msg.style.cssText = 'font-size:13px;margin-bottom:14px;line-height:1.5;';
    const btn = document.createElement('button');
    btn.textContent = '▶ Ready — Start Wave';
    btn.style.cssText = [
      'background:linear-gradient(180deg,#00aa66,#008855)',
      'color:#fff',
      'border:1px solid #00ffcc',
      'border-radius:6px',
      'padding:10px 18px',
      'font-size:14px',
      'font-weight:bold',
      'cursor:pointer',
      'font-family:monospace',
    ].join(';');
    btn.addEventListener('click', () => this.startGame());
    overlay.appendChild(title);
    overlay.appendChild(msg);
    overlay.appendChild(btn);
    document.body.appendChild(overlay);
    this._readyOverlay = overlay;
    this._makeDraggable(overlay, title, { centered: true });
  }

  _hideReadyOverlay() {
    if (this._readyOverlay && this._readyOverlay.parentNode) {
      this._readyOverlay.parentNode.removeChild(this._readyOverlay);
    }
    this._readyOverlay = null;
  }

  // ── UI: Ink-type selector ──────────────────────────────────
  _buildInkSelectorUI() {
    this._destroyInkSelectorUI();
    const container = document.createElement('div');
    container.id = 'td-ink-selector';
    container.style.cssText = [
      'position:fixed',
      'top:90px',
      'right:10px',
      'background:rgba(10,10,30,0.9)',
      'border:1px solid #4040a0',
      'border-radius:6px',
      'padding:8px',
      'z-index:900',
      'font-family:monospace',
      'color:#e0e0ff',
      'font-size:12px',
      'min-width:140px',
    ].join(';');
    const title = document.createElement('div');
    title.textContent = '🎨 Ink Type';
    title.style.cssText =
      'font-weight:bold;color:#00ffcc;margin-bottom:6px;font-size:11px;cursor:move;user-select:none;';
    title.title = 'Drag to move';
    container.appendChild(title);
    const types = [{ id: 'defense', label: '✏ Defense', color: '#00ff88' }];
    if (this.maxBarrierInk > 0) {
      types.push({ id: 'barrier', label: '🧱 Barrier', color: '#a0a0a0' });
    }
    if (this.maxFireInk > 0) {
      types.push({ id: 'fire', label: '🔥 Fire', color: '#ff6622' });
    }
    this._inkButtons = {};
    this._inkBudgets = {};
    for (const t of types) {
      const btn = document.createElement('button');
      btn.dataset.ink = t.id;
      btn.style.cssText = [
        'display:flex',
        'justify-content:space-between',
        'align-items:center',
        'width:100%',
        'padding:5px 8px',
        'margin-bottom:3px',
        'background:rgba(40,40,80,0.6)',
        'border:1px solid #4040a0',
        'border-radius:4px',
        `color:${t.color}`,
        'cursor:pointer',
        'font-family:monospace',
        'font-size:11px',
      ].join(';');
      const lbl = document.createElement('span');
      lbl.textContent = t.label;
      const budget = document.createElement('span');
      budget.style.cssText = 'font-weight:bold;font-size:10px;';
      btn.appendChild(lbl);
      btn.appendChild(budget);
      btn.addEventListener('click', () => this._selectInkType(t.id));
      container.appendChild(btn);
      this._inkButtons[t.id] = btn;
      this._inkBudgets[t.id] = budget;
    }
    document.body.appendChild(container);
    this._inkSelectorEl = container;
    this._updateInkBudgetDisplay();
    this._updateInkSelectorEnabled();
    this._highlightActive();
    this._makeDraggable(container, title);
  }

  _destroyInkSelectorUI() {
    if (this._inkSelectorEl && this._inkSelectorEl.parentNode) {
      this._inkSelectorEl.parentNode.removeChild(this._inkSelectorEl);
    }
    this._inkSelectorEl = null;
    this._inkButtons = null;
    this._inkBudgets = null;
  }

  _selectInkType(id) {
    if (!this.canDraw(id)) return;
    this.activeInkType = id;
    this._highlightActive();
  }

  _highlightActive() {
    if (!this._inkButtons) return;
    for (const [id, btn] of Object.entries(this._inkButtons)) {
      const isActive = id === this.activeInkType;
      btn.style.background = isActive ? 'rgba(0,255,200,0.25)' : 'rgba(40,40,80,0.6)';
      btn.style.borderColor = isActive ? '#00ffcc' : '#4040a0';
    }
  }

  _updateInkBudgetDisplay() {
    if (!this._inkBudgets) return;
    if (this._inkBudgets.defense) {
      const def = this.game.defenses;
      this._inkBudgets.defense.textContent = def ? `${Math.floor(def.ink)}/${def.maxInk}` : '—';
    }
    if (this._inkBudgets.barrier) {
      this._inkBudgets.barrier.textContent = `${this.barrierInk}/${this.maxBarrierInk}`;
    }
    if (this._inkBudgets.fire) {
      this._inkBudgets.fire.textContent = `${this.fireInk}/${this.maxFireInk}`;
    }
  }

  _updateInkSelectorEnabled() {
    if (!this._inkButtons) return;
    for (const [id, btn] of Object.entries(this._inkButtons)) {
      const can = this.canDraw(id);
      btn.disabled = !can;
      btn.style.opacity = can ? '' : '0.35';
      btn.style.cursor = can ? 'pointer' : 'not-allowed';
    }
    // If active ink is no longer allowed, fall back to defense.
    if (!this.canDraw(this.activeInkType)) {
      this.activeInkType = 'defense';
      this._highlightActive();
    }
  }

  /**
   * Wire the InputManager reference. The InputManager checks
   * `input.towerDefense` directly during paint operations to route
   * cell-type and budget logic. No monkey-patching needed.
   */
  _wireInput() {
    const input = this.game.input;
    if (input) input.towerDefense = this;
  }

  _unwireInput() {
    const input = this.game && this.game.input;
    if (input && input.towerDefense === this) {
      input.towerDefense = null;
    }
  }
  /**
   * Make `el` draggable by `handle`. If `centered` is true, the element
   * uses transform:translate(-50%,-50%); we clear that on first drag and
   * switch to absolute top/left positioning so dragging feels natural.
   */
  _makeDraggable(el, handle, opts = {}) {
    const state = { dragging: false, dx: 0, dy: 0, normalized: !opts.centered };
    const onDown = (ev) => {
      // Ignore clicks on interactive children (buttons, etc.)
      if (ev.target !== handle) return;
      ev.preventDefault();
      const pt = ev.touches ? ev.touches[0] : ev;
      const rect = el.getBoundingClientRect();
      if (!state.normalized) {
        // Convert from centered transform to absolute top/left.
        el.style.transform = '';
        el.style.left = rect.left + 'px';
        el.style.top = rect.top + 'px';
        state.normalized = true;
      }
      state.dragging = true;
      state.dx = pt.clientX - rect.left;
      state.dy = pt.clientY - rect.top;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    };
    const onMove = (ev) => {
      if (!state.dragging) return;
      ev.preventDefault();
      const pt = ev.touches ? ev.touches[0] : ev;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let x = pt.clientX - state.dx;
      let y = pt.clientY - state.dy;
      // Clamp into viewport.
      x = Math.max(0, Math.min(window.innerWidth - w, x));
      y = Math.max(0, Math.min(window.innerHeight - h, y));
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    };
    const onUp = () => {
      state.dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };
    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
  }
}
