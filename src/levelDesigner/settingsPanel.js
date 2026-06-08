// Settings tab: dynamically builds sliders/checkboxes for the
// per-level CONFIG override snapshot.

import { CONFIG } from '../config.js';
import { Logger } from '../logger.js';
import { SETTING_DEFS, BOOLEAN_SETTING_DEFS } from '../settings.js';
import { UNLIMITED_KEY_MAP } from './constants.js';

const SETTING_SECTIONS = [
  {
    title: '🎮 Gameplay',
    keys: ['HARDCORE_MODE', 'STARTING_SPEED', 'VICTORY_ENEMY_THRESHOLD', 'DEFEAT_CITY_THRESHOLD'],
  },
  { title: '🚀 Enemy Pacing', keys: ['MISSILE_CASCADE_TICKS', 'AGE_CONTAGION_AMOUNT'] },
  { title: '⚔ Bases', keys: ['BASE_ZONE_HEIGHT', 'BASE_GLIDER_BUFFER'] },
  {
    title: '🏆 Scoring',
    keys: [
      'SCORE_TARGET_DESTROYED',
      'SCORE_FORTRESS_DESTROYED',
      'SCORE_BUNKER_DESTROYED',
      'SCORE_CRUISER_DESTROYED',
      'SCORE_SPAWNER_DESTROYED',
      'SCORE_CITY_SURVIVAL_PER_WAVE',
      'SCORE_WAVE_CLEAR_BASE',
      'SCORE_INK_EFFICIENCY',
      'SCORE_VICTORY_CITY_BONUS',
      'SCORE_VICTORY_FLAT',
      'SCORE_VICTORY_INK',
      'SCORE_CITY_CELL_LOST',
      'SCORE_FRIENDLY_FIRE_PENALTY',
      'SCORE_BREACH_PENALTY',
      'COMBO_WINDOW_MS',
      'COMBO_MAX_MULT',
      'COMBO_INCREMENT',
    ],
  },
  {
    title: '✏️ Drawing & Ink',
    keys: [
      'INITIAL_INK',
      'MAX_INK',
      'INK_REGEN_RATE',
      'CLEAR_REFUND_FRACTION',
      'INK_DRY_TICKS',
      'DRAW_ZONE_FRACTION',
      'REAR_DEAD_ZONE_HEIGHT',
      'SHOW_DRAW_ZONE',
    ],
  },
  {
    title: '⏳ Region-Specific Aging',
    keys: [
      'DEFENSE_AGE_FRIENDLY',
      'DEFENSE_AGE_NEUTRAL',
      'DEFENSE_AGE_ENEMY',
      'MISSILE_AGE_FRIENDLY',
      'MISSILE_AGE_NEUTRAL',
      'MISSILE_AGE_ENEMY',
    ],
  },
  {
    title: '⚡ Abilities',
    keys: [
      'ABILITY_DOUBLE_SCORE',
      'ABILITY_NO_DRY',
      'ABILITY_WAVE_BONUS',
      'ABILITY_SAFE_ZONE',
      'ABILITY_SLOW_MISSILES',
      'ABILITY_EMP_BURST',
      'ABILITY_INK_SURGE',
      'ABILITY_FREEZE',
    ],
  },
  {
    title: '🎯 Event Detection',
    keys: [
      'EVENT_RETURN_FIRE',
      'EVENT_RICOCHET',
      'EVENT_BREACH',
      'EVENT_CITY_HIT',
      'EVENT_ANNIHILATION',
    ],
  },
  {
    title: '⚙️ Advanced',
    keys: [
      'DEFENDER_TICKS',
      'ATTACKER_TICKS',
      'SIM_HASHLIFE_ENABLED',
      'VFX_PARTICLES',
      'VFX_SHOCKWAVES',
      'VFX_FLOATERS',
      'VFX_SCREEN_SHAKE',
      'VFX_CELL_GLOW',
      'VFX_DRAW_ZONE_TINT',
    ],
  },
];

const EVENT_KEYS = [
  'EVENT_RETURN_FIRE',
  'EVENT_RICOCHET',
  'EVENT_BREACH',
  'EVENT_CITY_HIT',
  'EVENT_ANNIHILATION',
];

const SCORE_INT_KEYS = [
  'SCORE_TARGET_DESTROYED',
  'SCORE_FORTRESS_DESTROYED',
  'SCORE_BUNKER_DESTROYED',
  'SCORE_CRUISER_DESTROYED',
  'SCORE_SPAWNER_DESTROYED',
  'SCORE_CITY_SURVIVAL_PER_WAVE',
  'SCORE_WAVE_CLEAR_BASE',
  'SCORE_VICTORY_CITY_BONUS',
  'SCORE_VICTORY_FLAT',
  'SCORE_CITY_CELL_LOST',
  'SCORE_FRIENDLY_FIRE_PENALTY',
  'SCORE_BREACH_PENALTY',
];

const SCORE_FLOAT_KEYS = ['SCORE_INK_EFFICIENCY', 'SCORE_VICTORY_INK', 'COMBO_INCREMENT'];

/** Capture a snapshot of all relevant CONFIG values into a plain object. */
export function captureCurrentSettings() {
  const out = {};
  for (const def of SETTING_DEFS) out[def.key] = CONFIG[def.key];
  for (const def of BOOLEAN_SETTING_DEFS) out[def.key] = CONFIG[def.key];
  Logger.info(
    `[LevelDesigner] captureCurrentSettings: ` +
      `DEFENSE_AGE_FRIENDLY=${out.DEFENSE_AGE_FRIENDLY}, ` +
      `DEFENSE_AGE_ENEMY=${out.DEFENSE_AGE_ENEMY}, ` +
      `MISSILE_AGE_FRIENDLY=${out.MISSILE_AGE_FRIENDLY}, ` +
      `MISSILE_AGE_ENEMY=${out.MISSILE_AGE_ENEMY}`
  );
  return out;
}

export function defaultSettings() {
  return captureCurrentSettings();
}

/**
 * Build the settings panel. Returns a controller object exposing
 * .syncFromState() and .updateBaseZoneSliderMax().
 */
export function buildSettingsPanel(d) {
  const container = d.overlay.querySelector('#ld-settings-list');
  if (!container) return null;
  container.innerHTML = '';
  const sliderDefs = buildSliderDefs();
  const boolDefs = buildBoolDefs();
  const inputs = {};
  for (const sec of SETTING_SECTIONS) {
    const header = document.createElement('div');
    header.className = 'ld-settings-section-header';
    header.textContent = sec.title;
    container.appendChild(header);
    for (const key of sec.keys) {
      if (sliderDefs[key]) {
        buildSliderRow(d, container, sliderDefs[key], inputs);
      } else if (boolDefs[key]) {
        buildBoolRow(d, container, boolDefs[key], inputs);
      }
    }
  }
  const controller = {
    inputs,
    syncFromState: () => syncSettingsPanelFromState(d, inputs),
    updateBaseZoneSliderMax: () => updateBaseZoneSliderMax(d, inputs),
  };
  controller.syncFromState();
  return controller;
}

function buildSliderDefs() {
  const out = {};
  for (const d of SETTING_DEFS) out[d.key] = d;
  if (!out.STARTING_SPEED) {
    out.STARTING_SPEED = {
      key: 'STARTING_SPEED',
      id: 'setting-starting-speed',
      format: (v) => `${v.toFixed(2)}x`,
    };
  }
  if (!out.VICTORY_ENEMY_THRESHOLD) {
    out.VICTORY_ENEMY_THRESHOLD = {
      key: 'VICTORY_ENEMY_THRESHOLD',
      id: 'setting-victory-threshold',
      format: (v) => `${v | 0} cells`,
    };
  }
  if (!out.DEFEAT_CITY_THRESHOLD) {
    out.DEFEAT_CITY_THRESHOLD = {
      key: 'DEFEAT_CITY_THRESHOLD',
      id: 'setting-defeat-threshold',
      format: (v) => `${v | 0} cells`,
    };
  }
  for (const k of SCORE_INT_KEYS) {
    if (!out[k]) {
      out[k] = {
        key: k,
        id: `setting-${k.toLowerCase().replace(/_/g, '-')}`,
        format: (v) => `${v | 0} pts`,
      };
    }
  }
  for (const k of SCORE_FLOAT_KEYS) {
    if (!out[k]) {
      out[k] = {
        key: k,
        id: `setting-${k.toLowerCase().replace(/_/g, '-')}`,
        format: (v) => v.toFixed(2),
      };
    }
  }
  if (!out.COMBO_WINDOW_MS) {
    out.COMBO_WINDOW_MS = {
      key: 'COMBO_WINDOW_MS',
      id: 'setting-combo-window-ms',
      format: (v) => `${v | 0} ms`,
    };
  }
  if (!out.COMBO_MAX_MULT) {
    out.COMBO_MAX_MULT = {
      key: 'COMBO_MAX_MULT',
      id: 'setting-combo-max-mult',
      format: (v) => `${v.toFixed(2)}x`,
    };
  }
  return out;
}

function buildBoolDefs() {
  const out = {};
  for (const d of BOOLEAN_SETTING_DEFS) out[d.key] = d;
  for (const k of EVENT_KEYS) {
    if (!out[k]) out[k] = { key: k, id: `setting-${k.toLowerCase()}` };
  }
  return out;
}

function buildSliderRow(d, container, def, inputs) {
  const row = document.createElement('div');
  row.className = 'ld-settings-row';
  const label = document.createElement('label');
  label.textContent = humanizeKey(def.key);
  label.htmlFor = `ld-set-${def.key}`;
  row.appendChild(label);
  const valueEl = document.createElement('span');
  valueEl.className = 'ld-settings-value';
  const controls = document.createElement('div');
  controls.className = 'ld-settings-controls';
  const input = document.createElement('input');
  input.type = 'range';
  input.id = `ld-set-${def.key}`;
  const ranges = guessSliderRange(d, def.key);
  input.min = String(ranges.min);
  input.max = String(ranges.max);
  input.step = String(ranges.step);
  const UNLIMITED = CONFIG.UNLIMITED_SENTINEL || 999999;
  const initialValue =
    d.levelSettings[def.key] != null ? d.levelSettings[def.key] : CONFIG[def.key];
  const isInitiallyUnlimited = initialValue >= UNLIMITED;
  const sliderDefault = isInitiallyUnlimited ? getDefaultForKey(def.key, ranges) : initialValue;
  input.value = String(sliderDefault);
  controls.appendChild(input);
  const numInput = document.createElement('input');
  numInput.type = 'number';
  numInput.className = 'ld-settings-num';
  numInput.min = String(ranges.min);
  numInput.max = String(ranges.max);
  numInput.step = String(ranges.step);
  numInput.value = String(sliderDefault);
  controls.appendChild(numInput);
  const unlimitedKey = UNLIMITED_KEY_MAP[def.key] || null;
  let infCheckbox = null;
  if (unlimitedKey) {
    const infLabel = document.createElement('label');
    infLabel.className = 'ld-unlimited-label';
    infLabel.title = 'Set to unlimited (∞)';
    infCheckbox = document.createElement('input');
    infCheckbox.type = 'checkbox';
    const explicitUnlimited = !!d.levelSettings[unlimitedKey];
    infCheckbox.checked = explicitUnlimited || isInitiallyUnlimited;
    if (isInitiallyUnlimited && !explicitUnlimited) {
      d.levelSettings[unlimitedKey] = true;
    }
    if (isInitiallyUnlimited) {
      d.levelSettings[def.key] = sliderDefault;
    }
    infLabel.appendChild(infCheckbox);
    const txt = document.createElement('span');
    txt.textContent = ' ∞';
    infLabel.appendChild(txt);
    controls.appendChild(infLabel);
    infCheckbox.addEventListener('change', () => {
      d.levelSettings[unlimitedKey] = infCheckbox.checked;
      input.disabled = infCheckbox.checked;
      numInput.disabled = infCheckbox.checked;
      input.style.opacity = infCheckbox.checked ? '0.35' : '';
      numInput.style.opacity = infCheckbox.checked ? '0.35' : '';
      if (infCheckbox.checked) {
        valueEl.textContent = '∞';
      } else {
        const step = parseFloat(input.step) || 1;
        const raw = parseFloat(input.value);
        const v = Number.isInteger(step) ? Math.round(raw) : raw;
        d.levelSettings[def.key] = v;
        numInput.value = String(v);
        valueEl.textContent = def.format(parseFloat(input.value));
      }
    });
    if (infCheckbox.checked) {
      input.disabled = true;
      numInput.disabled = true;
      input.style.opacity = '0.35';
      numInput.style.opacity = '0.35';
    }
  }
  row.appendChild(controls);
  valueEl.textContent = infCheckbox && infCheckbox.checked ? '∞' : def.format(sliderDefault);
  row.appendChild(valueEl);
  input.addEventListener('input', () => {
    const step = parseFloat(input.step) || 1;
    const raw = parseFloat(input.value);
    const v = Number.isInteger(step) ? Math.round(raw) : raw;
    d.levelSettings[def.key] = v;
    numInput.value = String(v);
    valueEl.textContent = def.format(v);
    if (def.key.startsWith('DEFENSE_AGE_') || def.key.startsWith('MISSILE_AGE_')) {
      Logger.info(`[LevelDesigner] Slider ${def.key} → ${v}`);
    }
    if (def.key === 'DRAW_ZONE_FRACTION' || def.key === 'REAR_DEAD_ZONE_HEIGHT') {
      updateBaseZoneSliderMax(d, inputs);
    }
    if (
      def.key === 'DRAW_ZONE_FRACTION' ||
      def.key === 'REAR_DEAD_ZONE_HEIGHT' ||
      def.key === 'BASE_ZONE_HEIGHT'
    ) {
      d._draw();
    }
    if (def.key === 'VICTORY_ENEMY_THRESHOLD' || def.key === 'DEFEAT_CITY_THRESHOLD') {
      d._updateStats();
    }
  });
  numInput.addEventListener('change', () => {
    const step = parseFloat(numInput.step) || 1;
    let raw = parseFloat(numInput.value);
    if (!Number.isFinite(raw)) return;
    const v = Number.isInteger(step) ? Math.round(raw) : raw;
    d.levelSettings[def.key] = v;
    const sMin = parseFloat(input.min);
    const sMax = parseFloat(input.max);
    const clamped = Math.max(sMin, Math.min(sMax, v));
    input.value = String(clamped);
    valueEl.textContent = def.format(v);
    if (def.key === 'DRAW_ZONE_FRACTION' || def.key === 'REAR_DEAD_ZONE_HEIGHT') {
      updateBaseZoneSliderMax(d, inputs);
    }
    if (
      def.key === 'DRAW_ZONE_FRACTION' ||
      def.key === 'REAR_DEAD_ZONE_HEIGHT' ||
      def.key === 'BASE_ZONE_HEIGHT'
    ) {
      d._draw();
    }
    if (def.key === 'VICTORY_ENEMY_THRESHOLD' || def.key === 'DEFEAT_CITY_THRESHOLD') {
      d._updateStats();
    }
  });
  container.appendChild(row);
  inputs[def.key] = {
    input,
    numInput,
    valueEl,
    infCheckbox,
    unlimitedKey,
    type: 'slider',
    def,
  };
}

function buildBoolRow(d, container, def, inputs) {
  const row = document.createElement('div');
  row.className = 'ld-settings-row ld-settings-row-check';
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = `ld-set-${def.key}`;
  input.checked = !!(d.levelSettings[def.key] != null ? d.levelSettings[def.key] : CONFIG[def.key]);
  input.addEventListener('change', () => {
    d.levelSettings[def.key] = !!input.checked;
  });
  label.appendChild(input);
  const txt = document.createElement('span');
  txt.textContent = ' ' + humanizeKey(def.key);
  label.appendChild(txt);
  row.appendChild(label);
  container.appendChild(row);
  inputs[def.key] = { input, type: 'bool', def };
}

function updateBaseZoneSliderMax(d, inputs) {
  const entry = inputs && inputs.BASE_ZONE_HEIGHT;
  if (!entry) return;
  const range = guessSliderRange(d, 'BASE_ZONE_HEIGHT');
  entry.input.max = String(range.max);
  entry.numInput.max = String(range.max);
  const cur = d.levelSettings.BASE_ZONE_HEIGHT;
  if (cur > range.max) {
    d.levelSettings.BASE_ZONE_HEIGHT = range.max;
    entry.input.value = String(range.max);
    entry.numInput.value = String(range.max);
    entry.valueEl.textContent = entry.def.format(range.max);
  }
}

function syncSettingsPanelFromState(d, inputs) {
  if (!inputs) return;
  const UNLIMITED = CONFIG.UNLIMITED_SENTINEL || 999999;
  for (const [key, entry] of Object.entries(inputs)) {
    const v = d.levelSettings[key] != null ? d.levelSettings[key] : CONFIG[key];
    if (entry.type === 'slider') {
      const isUnlimited = v >= UNLIMITED;
      const ranges = guessSliderRange(d, key);
      const displayValue = isUnlimited ? getDefaultForKey(key, ranges) : v;
      entry.input.value = String(displayValue);
      if (entry.numInput) entry.numInput.value = String(displayValue);
      if (entry.infCheckbox && entry.unlimitedKey) {
        const explicitInf = !!d.levelSettings[entry.unlimitedKey];
        const inf = explicitInf || isUnlimited;
        entry.infCheckbox.checked = inf;
        if (isUnlimited && !explicitInf) {
          d.levelSettings[entry.unlimitedKey] = true;
          d.levelSettings[key] = displayValue;
        }
        entry.input.disabled = inf;
        if (entry.numInput) entry.numInput.disabled = inf;
        entry.input.style.opacity = inf ? '0.35' : '';
        if (entry.numInput) entry.numInput.style.opacity = inf ? '0.35' : '';
      }
      if (entry.valueEl && entry.def) {
        const inf = entry.infCheckbox && entry.infCheckbox.checked;
        entry.valueEl.textContent = inf ? '∞' : entry.def.format(displayValue);
      }
    } else if (entry.type === 'bool') {
      entry.input.checked = !!v;
    }
  }
}

function guessSliderRange(d, key) {
  const ranges = {
    INITIAL_INK: { min: 50, max: 9999, step: 10 },
    MAX_INK: { min: 100, max: 2000, step: 10 },
    INK_REGEN_RATE: { min: 0, max: 20, step: 0.1 },
    INK_DRY_TICKS: { min: 0, max: 30, step: 1 },
    TICK_RATE: { min: 40, max: 300, step: 10 },
    STARTING_SPEED: { min: 0, max: 16, step: 1 },
    DEFENDER_TICKS: { min: 1, max: 8, step: 1 },
    ATTACKER_TICKS: { min: 1, max: 8, step: 1 },
    MISSILES_PER_WAVE_BASE: { min: 1, max: 30, step: 1 },
    MISSILES_PER_WAVE_INC: { min: 0, max: 10, step: 1 },
    MISSILE_SPAWN_INTERVAL: { min: 200, max: 5000, step: 50 },
    MISSILE_SPAWN_DECREMENT: { min: 0, max: 200, step: 5 },
    MISSILE_SPAWN_MIN: { min: 100, max: 2000, step: 50 },
    DEFENSE_AGE_FRIENDLY: { min: 100, max: 10000, step: 100 },
    DEFENSE_AGE_ENEMY: { min: 100, max: 10000, step: 100 },
    DEFENSE_AGE_NEUTRAL: { min: 100, max: 10000, step: 100 },
    MISSILE_AGE_FRIENDLY: { min: 100, max: 10000, step: 100 },
    MISSILE_AGE_ENEMY: { min: 100, max: 10000, step: 100 },
    MISSILE_AGE_NEUTRAL: { min: 100, max: 10000, step: 100 },
    MISSILE_CASCADE_TICKS: { min: 0, max: 200, step: 1 },
    AGE_CONTAGION_AMOUNT: { min: 0, max: 200, step: 1 },
    CLEAR_REFUND_FRACTION: { min: 0, max: 1, step: 0.05 },
    DRAW_ZONE_FRACTION: { min: 0.2, max: 0.8, step: 0.05 },
    REAR_DEAD_ZONE_HEIGHT: { min: 0, max: 10, step: 1 },
    BASE_ZONE_HEIGHT: { min: 0, max: 60, step: 1 },
    BASE_SPAWN_COUNT_BASE: { min: 0, max: 6, step: 1 },
    BASE_SPAWN_COUNT_INC: { min: 0, max: 2, step: 0.1 },
    BASE_SPAWN_MAX: { min: 1, max: 12, step: 1 },
    BASE_GLIDER_BUFFER: { min: 1, max: 12, step: 1 },
    VICTORY_ENEMY_THRESHOLD: { min: 0, max: 100, step: 1 },
    DEFEAT_CITY_THRESHOLD: { min: 0, max: 200, step: 1 },
    SCORE_TARGET_DESTROYED: { min: 0, max: 10000, step: 50 },
    SCORE_FORTRESS_DESTROYED: { min: 0, max: 10000, step: 50 },
    SCORE_BUNKER_DESTROYED: { min: 0, max: 10000, step: 50 },
    SCORE_CRUISER_DESTROYED: { min: 0, max: 10000, step: 50 },
    SCORE_SPAWNER_DESTROYED: { min: 0, max: 10000, step: 50 },
    SCORE_CITY_SURVIVAL_PER_WAVE: { min: 0, max: 2000, step: 25 },
    SCORE_WAVE_CLEAR_BASE: { min: 0, max: 5000, step: 50 },
    SCORE_INK_EFFICIENCY: { min: 0, max: 5, step: 0.05 },
    SCORE_VICTORY_CITY_BONUS: { min: 0, max: 10000, step: 50 },
    SCORE_VICTORY_FLAT: { min: 0, max: 20000, step: 100 },
    SCORE_VICTORY_INK: { min: 0, max: 10, step: 0.1 },
    SCORE_CITY_CELL_LOST: { min: -1000, max: 0, step: 5 },
    SCORE_FRIENDLY_FIRE_PENALTY: { min: -1000, max: 0, step: 5 },
    SCORE_BREACH_PENALTY: { min: -1000, max: 0, step: 5 },
    COMBO_WINDOW_MS: { min: 500, max: 15000, step: 100 },
    COMBO_MAX_MULT: { min: 1, max: 20, step: 0.25 },
    COMBO_INCREMENT: { min: 0, max: 2, step: 0.05 },
  };
  if (key === 'BASE_ZONE_HEIGHT' && d.gridHeight) {
    const settings = d.levelSettings || {};
    const drawFrac =
      settings.DRAW_ZONE_FRACTION != null
        ? settings.DRAW_ZONE_FRACTION
        : CONFIG.DRAW_ZONE_FRACTION || 0.5;
    const topDeadMax =
      settings.RETURN_FIRE_ZONE_MAX_Y != null
        ? settings.RETURN_FIRE_ZONE_MAX_Y
        : CONFIG.RETURN_FIRE_ZONE_MAX_Y || 4;
    const rearH =
      settings.REAR_DEAD_ZONE_HEIGHT != null
        ? settings.REAR_DEAD_ZONE_HEIGHT
        : CONFIG.REAR_DEAD_ZONE_HEIGHT || 2;
    const drawZoneRows = Math.floor(d.gridHeight * drawFrac);
    const topDeadRows = topDeadMax + 1;
    const available = d.gridHeight - topDeadRows - drawZoneRows - rearH - 1;
    const maxByGrid = Math.max(2, available);
    ranges.BASE_ZONE_HEIGHT.max = maxByGrid;
  }
  return ranges[key] || { min: 0, max: 1000, step: 1 };
}

function getDefaultForKey(key, ranges) {
  const defaults = {
    MAX_INK: 300,
    INK_REGEN_RATE: 0.5,
    DEFENSE_AGE_FRIENDLY: 200,
    DEFENSE_AGE_ENEMY: 200,
    DEFENSE_AGE_NEUTRAL: 200,
    MISSILE_AGE_FRIENDLY: 200,
    MISSILE_AGE_ENEMY: 200,
    MISSILE_AGE_NEUTRAL: 200,
    MISSILE_CASCADE_TICKS: 20,
  };
  if (defaults[key] != null) return defaults[key];
  return Math.round((ranges.min + ranges.max) / 2);
}

function humanizeKey(key) {
  return key
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
