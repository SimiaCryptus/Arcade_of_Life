import { CONFIG, RESOLUTION_PRESETS, GAME_MODE_PRESETS } from './config.js';
import { Logger } from './logger.js';
import { loadJSON, saveJSON } from './storage.js';

/**
 * Compute an automatic grid size that:
 *  - Matches the current window aspect ratio
 *  - Yields a reasonable cell size (4..12px)
 *  - Stays within sane bounds
 */
export function computeAutoGrid() {
    if (typeof window === 'undefined') {
        return { width: 160, height: 100 };
    }
    const reservedH = (CONFIG.HUD_HEIGHT || 40) + 220;
    const reservedW = 24;
    const availW = Math.max(400, window.innerWidth - reservedW);
    const availH = Math.max(300, window.innerHeight - reservedH);
    // Target a cell size around 8px for a good visual density.
    const targetCell = 8;
    let w = Math.round(availW / targetCell);
    let h = Math.round(availH / targetCell);
    // Snap to even multiples of 4 for nicer numbers.
    w = Math.max(80, Math.min(640, Math.round(w / 4) * 4));
    h = Math.max(60, Math.min(400, Math.round(h / 4) * 4));
    return { width: w, height: h };
}

/**
 * Settings manages user-tunable game parameters.
 * Settings are persisted to localStorage and applied to CONFIG at runtime.
 */

const STORAGE_KEY = 'missileDefenseSettings';

// Definition of all numeric tunable settings: maps CONFIG keys to display info.
export const SETTING_DEFS = [
    { key: 'INITIAL_INK', id: 'setting-ink', format: v => v },
    { key: 'MAX_INK', id: 'setting-max-ink', format: v => v },
    { key: 'INK_REGEN_RATE', id: 'setting-ink-regen', format: v => v.toFixed(1) },
    { key: 'TICK_RATE', id: 'setting-tick-rate', format: v => v },
    { key: 'DEFENDER_TICKS', id: 'setting-defender-ticks', format: v => `${v}` },
    { key: 'ATTACKER_TICKS', id: 'setting-attacker-ticks', format: v => `${v}` },
    { key: 'MISSILES_PER_WAVE_BASE', id: 'setting-missiles-base', format: v => v },
    { key: 'MISSILES_PER_WAVE_INC', id: 'setting-missiles-inc', format: v => v },
    { key: 'MISSILE_SPAWN_INTERVAL', id: 'setting-spawn-interval', format: v => v },
    { key: 'MISSILE_SPAWN_DECREMENT', id: 'setting-spawn-decrement', format: v => v },
    { key: 'MISSILE_SPAWN_MIN', id: 'setting-spawn-min', format: v => v },
    { key: 'CELL_MAX_AGE_TICKS', id: 'setting-cell-age', format: v => v },
    { key: 'MISSILE_MAX_AGE_TICKS', id: 'setting-missile-age', format: v => v },
    { key: 'MISSILE_CASCADE_TICKS', id: 'setting-cascade-ticks', format: v => v },
    { key: 'CITY_COUNT', id: 'setting-city-count', format: v => v },
    { key: 'CLEAR_REFUND_FRACTION', id: 'setting-clear-refund', format: v => v.toFixed(2) },
    { key: 'INK_DRY_TICKS', id: 'setting-ink-dry', format: v => v },
    { key: 'DRAW_ZONE_FRACTION', id: 'setting-draw-zone', format: v => `${Math.round(v * 100)}%` },
    { key: 'REAR_DEAD_ZONE_HEIGHT', id: 'setting-rear-zone', format: v => `${v} rows` },
    { key: 'BASE_ZONE_HEIGHT', id: 'setting-base-zone', format: v => `${v} rows` },
    { key: 'BASE_SPAWN_COUNT_BASE', id: 'setting-base-count-base', format: v => v },
    { key: 'BASE_SPAWN_COUNT_INC', id: 'setting-base-count-inc', format: v => v.toFixed(1) },
    { key: 'BASE_SPAWN_MAX', id: 'setting-base-max', format: v => v },
    { key: 'BASE_GLIDER_BUFFER', id: 'setting-base-glider-buffer', format: v => `${v} rows` },
];

// Boolean settings (checkboxes), e.g. enabled glider types.
export const BOOLEAN_SETTING_DEFS = [
    { key: 'GLIDER_SE', id: 'setting-glider-se' },
    { key: 'GLIDER_SW', id: 'setting-glider-sw' },
    { key: 'GLIDER_HEAVY', id: 'setting-glider-heavy' },
    { key: 'GLIDER_LWSS', id: 'setting-glider-lwss' },
    { key: 'GLIDER_MWSS', id: 'setting-glider-mwss' },
    { key: 'GLIDER_TWIN', id: 'setting-glider-twin' },
    { key: 'GLIDER_GUN', id: 'setting-glider-gun' },
    { key: 'HARDCORE_MODE', id: 'setting-hardcore' },
    { key: 'SHOW_DRAW_ZONE', id: 'setting-show-draw-zone' },
    { key: 'BASE_SPAWN_ENABLED', id: 'setting-base-spawn-enabled' },
    { key: 'ABILITY_DOUBLE_SCORE', id: 'setting-ability-double-score' },
    { key: 'ABILITY_NO_DRY', id: 'setting-ability-no-dry' },
    { key: 'ABILITY_WAVE_BONUS', id: 'setting-ability-wave-bonus' },
    { key: 'ABILITY_SAFE_ZONE', id: 'setting-ability-safe-zone' },
    { key: 'ABILITY_SLOW_MISSILES', id: 'setting-ability-slow-missiles' },
    { key: 'ABILITY_EMP_BURST', id: 'setting-ability-emp-burst' },
    { key: 'ABILITY_INK_SURGE', id: 'setting-ability-ink-surge' },
    { key: 'ABILITY_FREEZE', id: 'setting-ability-freeze' },
    { key: 'SIM_HASHLIFE_ENABLED', id: 'setting-hashlife' },
    { key: 'VFX_PARTICLES', id: 'setting-vfx-particles' },
    { key: 'VFX_SHOCKWAVES', id: 'setting-vfx-shockwaves' },
    { key: 'VFX_FLOATERS', id: 'setting-vfx-floaters' },
    { key: 'VFX_SCREEN_SHAKE', id: 'setting-vfx-shake' },
    { key: 'VFX_CELL_GLOW', id: 'setting-vfx-glow' },
    { key: 'VFX_DRAW_ZONE_TINT', id: 'setting-vfx-draw-zone-tint' },
];

// Store defaults at module load (before any modification).
const DEFAULTS = {};
for (const def of SETTING_DEFS) {
    DEFAULTS[def.key] = CONFIG[def.key];
}
for (const def of BOOLEAN_SETTING_DEFS) {
    DEFAULTS[def.key] = CONFIG[def.key];
}
// Resolution preset index (default = 0 = Auto fit window)
DEFAULTS.RESOLUTION_INDEX = 0;
DEFAULTS.CUSTOM_GRID_WIDTH = 160;
DEFAULTS.CUSTOM_GRID_HEIGHT = 100;
// Game mode preset (default = 'custom' = no preset applied)
DEFAULTS.GAME_MODE_ID = 'custom';
// Numeric settings added in v2
DEFAULTS.BASE_GLIDER_BUFFER = CONFIG.BASE_GLIDER_BUFFER;

export class Settings {
    constructor() {
        this.values = { ...DEFAULTS };
        this.load();
        this.apply();
    }

    load() {
        const parsed = loadJSON(STORAGE_KEY, null);
        if (!parsed || typeof parsed !== 'object') return;
        let mismatches = 0;
        for (const key of Object.keys(DEFAULTS)) {
            if (parsed[key] === undefined) continue;
            if (typeof parsed[key] === typeof DEFAULTS[key]) {
                this.values[key] = parsed[key];
            } else {
                mismatches++;
            }
        }
        if (mismatches > 0) {
            Logger.warn(`Settings: ${mismatches} stored value(s) had unexpected types and were ignored.`);
        }
    }

    save() {
        saveJSON(STORAGE_KEY, this.values);
    }

    // Apply current values into the live CONFIG object.
    apply() {
        try {
            for (const def of SETTING_DEFS) {
                CONFIG[def.key] = this.values[def.key];
            }
            for (const def of BOOLEAN_SETTING_DEFS) {
                CONFIG[def.key] = this.values[def.key];
            }
            // Apply resolution preset.
            const idx = Math.max(0, Math.min(RESOLUTION_PRESETS.length - 1,
                this.values.RESOLUTION_INDEX | 0));
            const res = RESOLUTION_PRESETS[idx];
            if (res.auto) {
                // Compute grid size to match window aspect ratio.
                const dims = computeAutoGrid();
                CONFIG.GRID_WIDTH = dims.width;
                CONFIG.GRID_HEIGHT = dims.height;
            } else if (res.custom) {
                CONFIG.GRID_WIDTH = Math.max(60, Math.min(800,
                    this.values.CUSTOM_GRID_WIDTH | 0));
                CONFIG.GRID_HEIGHT = Math.max(40, Math.min(600,
                    this.values.CUSTOM_GRID_HEIGHT | 0));
            } else {
                CONFIG.GRID_WIDTH = res.width;
                CONFIG.GRID_HEIGHT = res.height;
            }
            // CELL_SIZE is computed dynamically from window size in main.js fitToWindow().
            // Provide a fallback if window not available yet.
            if (!CONFIG.CELL_SIZE) CONFIG.CELL_SIZE = 8;
            // Ensure at least one glider type is enabled.
            if (!CONFIG.GLIDER_SE && !CONFIG.GLIDER_SW && !CONFIG.GLIDER_HEAVY) {
                CONFIG.GLIDER_SE = true;
                this.values.GLIDER_SE = true;
                Logger.info('Settings: at least one glider must be enabled; restored R-Glider (SE).');
            }
            // Apply game mode patch on top of individual settings.
            // The patch is re-applied every time so it stays dominant over
            // slider tweaks made before the game starts.
            if (this.values.GAME_MODE_ID && this.values.GAME_MODE_ID !== 'custom') {
                const mode = GAME_MODE_PRESETS.find(m => m.id === this.values.GAME_MODE_ID);
                if (mode && mode.patch) {
                    for (const [k, v] of Object.entries(mode.patch)) {
                        CONFIG[k] = v;
                    }
                }
            }
        } catch (e) {
            Logger.error('Settings.apply() failed; CONFIG may be in an inconsistent state.', e);
        }
    }

    set(key, value) {
        this.values[key] = value;
        // Reapply en masse so derived fields (resolution) update too.
        this.apply();
    }

    reset() {
        this.values = { ...DEFAULTS };
        this.apply();
        this.save();
    }
    applyGameMode(id) {
        const mode = GAME_MODE_PRESETS.find(m => m.id === id);
        if (!mode) return;
        this.values.GAME_MODE_ID = id;
        if (mode.patch) {
            // Mirror patch values into this.values so sliders reflect the mode.
            for (const [k, v] of Object.entries(mode.patch)) {
                if (k in this.values) this.values[k] = v;
            }
        }
        this.apply();
        this.save();
        Logger.info(`Settings: game mode "${mode.name}" applied.`);
    }

    getDefault(key) {
        return DEFAULTS[key];
    }
}

/**
 * Wires up the settings panel DOM and binds inputs to the Settings instance.
 */
export class SettingsPanel {
    constructor(settings, { onClose, onResolutionChange } = {}) {
        this.settings = settings;
        this.onClose = onClose;
        this.onResolutionChange = onResolutionChange;
        this.overlay = document.getElementById('settings-overlay');
        this.backButton = document.getElementById('settings-back-button');
        this.resetButton = document.getElementById('settings-reset-button');
        this._initTabs();
        this._initTabs();
        this._initResolutionSelect();
        this._initCustomResInputs();
        this._initInputs();
        this._initBooleanInputs();
        this._initGameModeSelect();
        this.backButton.addEventListener('click', () => this.hide());
        this.resetButton.addEventListener('click', () => this._onReset());
    }
    _initTabs() {
        const tabBtns = document.querySelectorAll('#settings-tabs .settings-tab');
        const panels = document.querySelectorAll('#settings-list .settings-tab-panel');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.tab;
                tabBtns.forEach(b => b.classList.toggle('active', b === btn));
                panels.forEach(p => p.classList.toggle('active', p.dataset.panel === target));
            });
        });
    }

    _initResolutionSelect() {
        this.resolutionSelect = document.getElementById('setting-resolution');
        if (!this.resolutionSelect) return;
        this._populateResolutionSelect(this.resolutionSelect);
        // Mirror select on Display tab.
        this.resolutionSelectDisplay = document.getElementById('setting-resolution-display');
        if (this.resolutionSelectDisplay) {
            this._populateResolutionSelect(this.resolutionSelectDisplay);
            this.resolutionSelectDisplay.addEventListener('change', () => {
                const idx = parseInt(this.resolutionSelectDisplay.value, 10) || 0;
                this.settings.set('RESOLUTION_INDEX', idx);
                this.settings.save();
                this.resolutionSelect.value = String(idx);
                this._updateCustomVisibility();
                if (this.onResolutionChange) this.onResolutionChange();
            });
        }
    }

    _populateResolutionSelect(sel) {
        sel.innerHTML = '';
        RESOLUTION_PRESETS.forEach((preset, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = preset.name;
            sel.appendChild(opt);
        });
        sel.addEventListener('change', () => {
            const idx = parseInt(sel.value, 10) || 0;
            this.settings.set('RESOLUTION_INDEX', idx);
            this.settings.save();
            // Keep both selects in sync.
            if (this.resolutionSelect && this.resolutionSelect !== sel)
                this.resolutionSelect.value = String(idx);
            if (this.resolutionSelectDisplay && this.resolutionSelectDisplay !== sel)
                this.resolutionSelectDisplay.value = String(idx);
            this._updateCustomVisibility();
            if (this.onResolutionChange) this.onResolutionChange();
        });
    }

    _initCustomResInputs() {
        this.customRow = document.getElementById('setting-custom-res-row');
        this.customW = document.getElementById('setting-custom-w');
        this.customH = document.getElementById('setting-custom-h');
        if (!this.customW || !this.customH) return;
        const update = () => {
            const w = Math.max(60, Math.min(800,
                parseInt(this.customW.value, 10) || 160));
            const h = Math.max(40, Math.min(600,
                parseInt(this.customH.value, 10) || 100));
            this.settings.set('CUSTOM_GRID_WIDTH', w);
            this.settings.set('CUSTOM_GRID_HEIGHT', h);
            this.settings.save();
            if (this.onResolutionChange) this.onResolutionChange();
        };
        this.customW.addEventListener('change', update);
        this.customH.addEventListener('change', update);
    }

    _updateCustomVisibility() {
        if (!this.customRow) return;
        const idx = this.settings.values.RESOLUTION_INDEX | 0;
        const preset = RESOLUTION_PRESETS[idx];
        this.customRow.style.display = (preset && preset.custom) ? 'grid' : 'none';
    }
    _initGameModeSelect() {
        this.gameModeSelect = document.getElementById('setting-game-mode');
        if (!this.gameModeSelect) return;
        // Populate options.
        this.gameModeSelect.innerHTML = '';
        for (const mode of GAME_MODE_PRESETS) {
            const opt = document.createElement('option');
            opt.value = mode.id;
            opt.textContent = mode.name;
            opt.title = mode.desc;
            this.gameModeSelect.appendChild(opt);
        }
        this.gameModeSelect.addEventListener('change', () => {
            const id = this.gameModeSelect.value;
            this.settings.applyGameMode(id);
            // Re-sync all sliders/checkboxes to reflect the new values.
            this._syncInputs();
            // Show description.
            const mode = GAME_MODE_PRESETS.find(m => m.id === id);
            const descEl = document.getElementById('setting-game-mode-desc');
            if (descEl && mode) descEl.textContent = mode.desc;
            if (this.onResolutionChange) this.onResolutionChange();
        });
        this._syncGameModeSelect();
    }
    _syncGameModeSelect() {
        if (!this.gameModeSelect) return;
        this.gameModeSelect.value = this.settings.values.GAME_MODE_ID || 'custom';
        const mode = GAME_MODE_PRESETS.find(m => m.id === this.gameModeSelect.value);
        const descEl = document.getElementById('setting-game-mode-desc');
        if (descEl && mode) descEl.textContent = mode.desc;
    }

    _initInputs() {
        this.bindings = [];
        for (const def of SETTING_DEFS) {
            const input = document.getElementById(def.id);
            const valueEl = document.getElementById(def.id + '-value');
            if (!input || !valueEl) {
                Logger.warn(`Settings: missing DOM element(s) for "${def.key}" (id="${def.id}"); skipping binding.`);
                continue;
            }
            const update = () => {
                try {
                    const step = parseFloat(input.step) || 1;
                    const raw = parseFloat(input.value);
                    if (!Number.isFinite(raw)) {
                        Logger.warn(`Settings: invalid numeric input for "${def.key}"; ignoring.`);
                        return;
                    }
                    const isInt = Number.isInteger(step);
                    const value = isInt ? Math.round(raw) : raw;
                    this.settings.set(def.key, value);
                    valueEl.textContent = def.format(value);
                    this.settings.save();
                } catch (e) {
                    Logger.error(`Settings: error updating "${def.key}".`, e);
                }
            };
            input.addEventListener('input', update);
            this.bindings.push({ def, input, valueEl });
        }
    }

    _initBooleanInputs() {
        this.boolBindings = [];
        for (const def of BOOLEAN_SETTING_DEFS) {
            const input = document.getElementById(def.id);
            if (!input) continue;
            const update = () => {
                this.settings.set(def.key, !!input.checked);
                this._enforceGliderMin();
                this.settings.save();
            };
            input.addEventListener('change', update);
            this.boolBindings.push({ def, input });
        }
        // Wire the mirrored show-draw-zone checkbox on the Display tab.
        const mirrorDZ = document.getElementById('setting-show-draw-zone-display');
        const primaryDZ = document.getElementById('setting-show-draw-zone');
        if (mirrorDZ && primaryDZ) {
            mirrorDZ.addEventListener('change', () => {
                primaryDZ.checked = mirrorDZ.checked;
                this.settings.set('SHOW_DRAW_ZONE', !!mirrorDZ.checked);
                this.settings.save();
            });
        }
        // Wire the mirrored cell-age slider on the Advanced tab.
        const advAge = document.getElementById('setting-cell-age-adv');
        const advAgeVal = document.getElementById('setting-cell-age-adv-value');
        const primaryAge = document.getElementById('setting-cell-age');
        if (advAge && primaryAge) {
            advAge.addEventListener('input', () => {
                const v = parseInt(advAge.value, 10) || 20;
                primaryAge.value = String(v);
                this.settings.set('CELL_MAX_AGE_TICKS', v);
                if (advAgeVal) advAgeVal.textContent = String(v);
                const primaryVal = document.getElementById('setting-cell-age-value');
                if (primaryVal) primaryVal.textContent = String(v);
                this.settings.save();
            });
        }
    }

    _enforceGliderMin() {
        // If user just unchecked the last enabled glider, re-check SE.
        const anyEnabled = BOOLEAN_SETTING_DEFS.some(d =>
            d.key.startsWith('GLIDER_') && this.settings.values[d.key]
        );
        if (!anyEnabled) {
            this.settings.set('GLIDER_SE', true);
            const seInput = document.getElementById('setting-glider-se');
            if (seInput) seInput.checked = true;
        }
    }

    _syncInputs() {
        for (const { def, input, valueEl } of this.bindings) {
            const value = this.settings.values[def.key];
            input.value = value;
            valueEl.textContent = def.format(value);
        }
        for (const { def, input } of this.boolBindings) {
            input.checked = !!this.settings.values[def.key];
        }
        if (this.resolutionSelect) {
            this.resolutionSelect.value = String(this.settings.values.RESOLUTION_INDEX || 0);
        }
        if (this.resolutionSelectDisplay) {
            this.resolutionSelectDisplay.value = String(this.settings.values.RESOLUTION_INDEX || 0);
        }
        if (this.resolutionSelectDisplay) {
            this.resolutionSelectDisplay.value = String(this.settings.values.RESOLUTION_INDEX || 0);
        }
        if (this.customW) this.customW.value = this.settings.values.CUSTOM_GRID_WIDTH || 160;
        if (this.customH) this.customH.value = this.settings.values.CUSTOM_GRID_HEIGHT || 100;
        this._updateCustomVisibility();
        this._syncGameModeSelect();
    }

    _onReset() {
        this.settings.reset();
        this._syncInputs();
        this._syncGameModeSelect();
        if (this.onResolutionChange) this.onResolutionChange();
    }

    show() {
        this._syncInputs();
        this._syncGameModeSelect();
        this.overlay.classList.remove('hidden');
    }

    hide() {
        this.overlay.classList.add('hidden');
        if (this.onClose) this.onClose();
    }
}