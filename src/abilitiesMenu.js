// Abilities dropup menu controller.
//
// Replaces the row-of-buttons layout with a single dropup CTA plus a
// "last used" quick-access button. Aggregates:
//   - Always-available actions: Clear Defenses, Capture Pattern
//   - Free-play active abilities (EMP Burst, Ink Surge, Time Stop, ...)
//
// The legacy buttons (#clear-defenses-button, #pattern-capture-button,
// and the per-slot freeplay-ability buttons) are kept in the DOM but
// hidden; we proxy clicks to them so existing wiring continues to work.

import { Logger } from './logger.js';

export class AbilitiesMenu {
  constructor(game) {
    this.game = game;
    this.menuBtn = document.getElementById('abilities-menu-button');
    this.dropup = document.getElementById('abilities-menu-dropup');
    this.quickBtn = document.getElementById('ability-quick-button');
    this.quickIcon = this.quickBtn ? this.quickBtn.querySelector('.ability-quick-icon') : null;
    this.quickLabel = this.quickBtn ? this.quickBtn.querySelector('.ability-quick-label') : null;
    this._lastUsed = null; // { kind: 'always'|'active', id, icon, label }
    if (!this.menuBtn || !this.dropup) {
      Logger.warn('[AbilitiesMenu] DOM elements missing; abort wiring.');
      return;
    }
    this._wireToggle();
    this._wireQuickButton();
    this.rebuild();
    // Refresh periodically so cooldown timers update in the dropup.
    this._tickInterval = setInterval(() => {
      if (!this.dropup.classList.contains('hidden')) this._refreshCooldowns();
      this._refreshQuickButton();
    }, 250);
  }

  _wireToggle() {
    this.menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !this.dropup.classList.contains('hidden');
      this._setOpen(!isOpen);
    });
    document.addEventListener('click', (e) => {
      if (!this.dropup.contains(e.target) && e.target !== this.menuBtn) {
        this._setOpen(false);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.dropup.classList.contains('hidden')) {
        this._setOpen(false);
      }
    });
  }

  _setOpen(open) {
    if (open) this.rebuild(); // refresh contents on open
    this.dropup.classList.toggle('hidden', !open);
    this.menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.menuBtn.classList.toggle('active', open);
  }

  _wireQuickButton() {
    if (!this.quickBtn) return;
    this.quickBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this._lastUsed) return;
      this._invokeLastUsed();
    });
  }

  _invokeLastUsed() {
    if (!this._lastUsed) return;
    const { kind, id } = this._lastUsed;
    if (kind === 'always') {
      const btn = document.getElementById(id);
      if (btn) btn.click();
    } else if (kind === 'active') {
      // id is the slot index in freeplayAbilities.activeAbilities
      if (this.game.freeplayAbilities) {
        this.game.freeplayAbilities.trigger(id | 0);
      }
    }
    // Keep last-used label in sync.
    this._refreshQuickButton();
  }

  // Rebuild the dropup contents based on current ability state.
  rebuild() {
    if (!this.dropup) return;
    // Clear.
    while (this.dropup.firstChild) this.dropup.removeChild(this.dropup.firstChild);
    // Always-available items first.
    const alwaysItems = [
      { id: 'clear-defenses-button', icon: '🧹', label: 'Clear Defenses', hotkey: 'C' },
      { id: 'pattern-capture-button', icon: '◧', label: 'Capture Pattern', hotkey: '⇧C' },
    ];
    for (const it of alwaysItems) {
      const legacy = document.getElementById(it.id);
      if (!legacy) continue;
      const item = this._makeMenuItem({
        icon: it.icon,
        label: it.label,
        hotkey: it.hotkey,
        className: 'ability-menu-item ability-always',
        disabled: legacy.disabled,
        onClick: () => {
          legacy.click();
          this._lastUsed = { kind: 'always', id: it.id, icon: it.icon, label: it.label };
          this._refreshQuickButton();
          this._setOpen(false);
        },
      });
      this.dropup.appendChild(item);
    }
    // Free-play active abilities (if any installed).
    const fa = this.game.freeplayAbilities;
    const actives = fa ? fa.activeAbilities : [];
    if (actives && actives.length > 0) {
      // Divider.
      const div = document.createElement('div');
      div.className = 'ability-menu-divider';
      this.dropup.appendChild(div);
      const ACTIVE_KEYS = ['Q', 'W', 'E'];
      actives.forEach((ab, idx) => {
        const cd = ab._cdRemaining || 0;
        const hotkey = ACTIVE_KEYS[idx] || '';
        const item = this._makeMenuItem({
          icon: ab.icon,
          label: ab.name,
          hotkey,
          cd,
          className: 'ability-menu-item',
          disabled: cd > 0,
          onClick: () => {
            const ok = fa.trigger(idx);
            if (ok) {
              this._lastUsed = {
                kind: 'active',
                id: idx,
                icon: ab.icon,
                label: ab.name,
              };
              this._refreshQuickButton();
            }
            this._setOpen(false);
          },
        });
        item.dataset.slot = String(idx);
        this.dropup.appendChild(item);
      });
    }
    // If totally empty, show a placeholder.
    if (this.dropup.children.length === 0) {
      const p = document.createElement('div');
      p.style.cssText = 'padding:8px 12px;color:#888;font-style:italic;font-size:11px;';
      p.textContent = 'No abilities available.';
      this.dropup.appendChild(p);
    }
    this._refreshQuickButton();
  }

  _makeMenuItem({ icon, label, hotkey, cd, className, disabled, onClick }) {
    const btn = document.createElement('button');
    btn.className = className;
    if (disabled) btn.disabled = true;
    const iconSpan = document.createElement('span');
    iconSpan.className = 'ability-menu-icon';
    iconSpan.textContent = icon || '•';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'ability-menu-label';
    labelSpan.textContent = label;
    btn.appendChild(iconSpan);
    btn.appendChild(labelSpan);
    if (cd && cd > 0) {
      const cdSpan = document.createElement('span');
      cdSpan.className = 'ability-menu-cd';
      cdSpan.textContent = `${Math.ceil(cd)}s`;
      btn.appendChild(cdSpan);
    } else if (hotkey) {
      const hkSpan = document.createElement('span');
      hkSpan.className = 'ability-menu-cd';
      hkSpan.style.color = '#88aacc';
      hkSpan.textContent = `[${hotkey}]`;
      btn.appendChild(hkSpan);
    }
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      onClick();
    });
    return btn;
  }

  // Update only the cooldown labels on existing items (cheap refresh).
  _refreshCooldowns() {
    const fa = this.game.freeplayAbilities;
    if (!fa) return;
    const items = this.dropup.querySelectorAll('[data-slot]');
    items.forEach((el) => {
      const idx = parseInt(el.dataset.slot, 10);
      const ab = fa.activeAbilities[idx];
      if (!ab) return;
      const cd = ab._cdRemaining || 0;
      const cdEl = el.querySelector('.ability-menu-cd');
      if (cd > 0) {
        el.disabled = true;
        if (cdEl) {
          cdEl.style.color = '#ff8888';
          cdEl.textContent = `${Math.ceil(cd)}s`;
        }
      } else {
        el.disabled = false;
        if (cdEl) {
          cdEl.style.color = '#88aacc';
          const ACTIVE_KEYS = ['Q', 'W', 'E'];
          cdEl.textContent = `[${ACTIVE_KEYS[idx] || ''}]`;
        }
      }
    });
  }

  _refreshQuickButton() {
    if (!this.quickBtn) return;
    if (!this._lastUsed) {
      this.quickBtn.style.display = 'none';
      return;
    }
    this.quickBtn.style.display = '';
    if (this.quickIcon) this.quickIcon.textContent = this._lastUsed.icon || '•';
    if (this.quickLabel) this.quickLabel.textContent = this._lastUsed.label || '';
    // If the last used was an active on cooldown, disable the quick button.
    let disabled = false;
    let cdLeft = 0;
    if (this._lastUsed.kind === 'active' && this.game.freeplayAbilities) {
      const ab = this.game.freeplayAbilities.activeAbilities[this._lastUsed.id | 0];
      if (ab && (ab._cdRemaining || 0) > 0) {
        disabled = true;
        cdLeft = ab._cdRemaining;
      }
    } else if (this._lastUsed.kind === 'always') {
      const btn = document.getElementById(this._lastUsed.id);
      if (btn && btn.disabled) disabled = true;
    }
    this.quickBtn.disabled = disabled;
    this.quickBtn.title =
      disabled && cdLeft > 0
        ? `${this._lastUsed.label} (cooldown ${Math.ceil(cdLeft)}s)`
        : `${this._lastUsed.label} — click to re-trigger`;
  }
}
