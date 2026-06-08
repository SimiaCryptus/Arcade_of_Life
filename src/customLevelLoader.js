// Loads a custom level: applies settings, color theme, builds grid,
// places cities/defenses/enemies/barriers/fire/bases/spawners,
// wires tool restrictions, and starts wave 0. Extracted from main.js.
import { CONFIG, SPEED_PRESETS, CELL_TYPE } from './config.js';
import { Logger } from './logger.js';
import { Sfx } from './audio.js';
import { STATE } from './gameState.js';
import { getLevel } from './levels.js';
import { requestWakeLock } from './pwa.js';

function applyLevelSettings(game, level) {
  if (level.settings && typeof level.settings === 'object') {
    for (const [k, v] of Object.entries(level.settings)) {
      if (k in CONFIG) CONFIG[k] = v;
    }
    Logger.info(`[Game] Applied ${Object.keys(level.settings).length} setting overrides.`);
    if (game.settings && game.settings.values) {
      for (const [k, v] of Object.entries(level.settings)) {
        if (k in game.settings.values) game.settings.values[k] = v;
      }
    }
  }
  // Apply unlimited-toggle sentinels.
  const UNLIMITED = CONFIG.UNLIMITED_SENTINEL || 999999;
  const unlimitedMap = {
    UNLIMITED_MAX_INK: ['MAX_INK', 'INITIAL_INK'],
    UNLIMITED_INK_REGEN: ['INK_REGEN_RATE'],
    UNLIMITED_DEF_AGE_FRIENDLY: ['DEFENSE_AGE_FRIENDLY'],
    UNLIMITED_DEF_AGE_ENEMY: ['DEFENSE_AGE_ENEMY'],
    UNLIMITED_DEF_AGE_NEUTRAL: ['DEFENSE_AGE_NEUTRAL'],
    UNLIMITED_MISS_AGE_FRIENDLY: ['MISSILE_AGE_FRIENDLY'],
    UNLIMITED_MISS_AGE_ENEMY: ['MISSILE_AGE_ENEMY'],
    UNLIMITED_MISS_AGE_NEUTRAL: ['MISSILE_AGE_NEUTRAL'],
  };
  if (level.settings) {
    if (level.settings.UNLIMITED_CELL_AGE) {
      const regionFlags = [
        ['UNLIMITED_DEF_AGE_FRIENDLY', 'DEFENSE_AGE_FRIENDLY'],
        ['UNLIMITED_DEF_AGE_ENEMY', 'DEFENSE_AGE_ENEMY'],
        ['UNLIMITED_DEF_AGE_NEUTRAL', 'DEFENSE_AGE_NEUTRAL'],
        ['UNLIMITED_MISS_AGE_FRIENDLY', 'MISSILE_AGE_FRIENDLY'],
        ['UNLIMITED_MISS_AGE_ENEMY', 'MISSILE_AGE_ENEMY'],
        ['UNLIMITED_MISS_AGE_NEUTRAL', 'MISSILE_AGE_NEUTRAL'],
      ];
      const anyRegionUnlimited = regionFlags.some(([flag]) => level.settings[flag]);
      const anyRegionFinite = regionFlags.some(
        ([, key]) => typeof level.settings[key] === 'number' && level.settings[key] < UNLIMITED
      );
      if (!anyRegionUnlimited && !anyRegionFinite) {
        for (const [, key] of regionFlags) {
          CONFIG[key] = UNLIMITED;
        }
      }
    }
    for (const [flag, keys] of Object.entries(unlimitedMap)) {
      if (level.settings[flag]) {
        for (const k of keys) CONFIG[k] = UNLIMITED;
      }
    }
  }
}

function applyColorTheme(game, level) {
  if (!level.colorTheme || typeof level.colorTheme !== 'object') return;
  if (!game._defaultColors) {
    game._defaultColors = { ...CONFIG.COLORS };
  }
  for (const [k, v] of Object.entries(level.colorTheme)) {
    CONFIG.COLORS[k] = v;
  }
  Logger.info(`[Game] Applied ${Object.keys(level.colorTheme).length} color theme overrides.`);
}

function applyGridAndRuleset(game, level) {
  CONFIG.GRID_WIDTH = level.gridWidth || CONFIG.GRID_WIDTH;
  CONFIG.GRID_HEIGHT = level.gridHeight || CONFIG.GRID_HEIGHT;
  if (level.ruleset) CONFIG.ACTIVE_RULESET = level.ruleset;
  if (level.enemyRuleset !== undefined) {
    CONFIG.ENEMY_RULESET = level.enemyRuleset || null;
  }
  const hasCustomBases = Array.isArray(level.bases) && level.bases.length > 0;
  const hasCustomSpawners = Array.isArray(level.spawners) && level.spawners.length > 0;
  if (hasCustomBases || hasCustomSpawners) {
    CONFIG.BASE_SPAWN_ENABLED = false;
  }
  if (hasCustomSpawners) {
    CONFIG.MISSILES_PER_WAVE_BASE = 0;
    CONFIG.MISSILES_PER_WAVE_INC = 0;
  }
}

function populateGrid(game, level) {
  game.grid.cells.fill(0);
  game.grid.pending.fill(0);
  game.grid.pendingDry.fill(0);
  game.grid.explosionTimers.fill(0);
  game.grid.cellAge.fill(0);
  game.grid.cellColor.fill(0);
  game.grid.cellDir.fill(0);
  if (game.simulation.returnFireFired) game.simulation.returnFireFired.fill(0);

  // Cities.
  game.cities.cities = [];
  game.grid.clearPending();
  for (const c of level.cities || []) {
    const city = { x: c.x, y: c.y, width: c.width, height: c.height, alive: true };
    if (c.patternId) city.patternId = c.patternId;
    if (Array.isArray(c.cells) && c.cells.length > 0) {
      city.cells = c.cells.map(([dx, dy]) => [dx, dy]);
    }
    game.cities.cities.push(city);
    if (city.cells) {
      for (const [dx, dy] of city.cells) {
        game.grid.set(city.x + dx, city.y + dy, CELL_TYPE.CITY);
      }
    } else {
      for (let dy = 0; dy < city.height; dy++) {
        for (let dx = 0; dx < city.width; dx++) {
          game.grid.set(city.x + dx, city.y + dy, CELL_TYPE.CITY);
        }
      }
    }
  }
  // Defenses.
  const defenseVariants = CONFIG.COLORS.DEFENSE_VARIANTS.length;
  for (const [x, y] of level.defenses || []) {
    if (game.grid.inBounds(x, y) && game.grid.get(x, y) === CELL_TYPE.EMPTY) {
      game.grid.set(x, y, CELL_TYPE.DEFENSE);
      const i = y * game.grid.width + game.grid.wrapX(x);
      game.grid.cellAge[i] = 1;
      game.grid.cellColor[i] = (Math.random() * defenseVariants) | 0;
    }
  }
  // Enemies.
  const missileVariants = CONFIG.COLORS.MISSILE_VARIANTS.length;
  for (const [x, y] of level.enemies || []) {
    if (game.grid.inBounds(x, y) && game.grid.get(x, y) === CELL_TYPE.EMPTY) {
      game.grid.set(x, y, CELL_TYPE.MISSILE);
      const i = y * game.grid.width + game.grid.wrapX(x);
      game.grid.cellAge[i] = 1;
      game.grid.cellColor[i] = (Math.random() * missileVariants) | 0;
      game.grid.cellDir[i] = 1;
    }
  }
  // Barriers.
  for (const [x, y] of level.barriers || []) {
    if (game.grid.inBounds(x, y) && game.grid.get(x, y) === CELL_TYPE.EMPTY) {
      game.grid.set(x, y, CELL_TYPE.BARRIER);
      const i = y * game.grid.width + game.grid.wrapX(x);
      game.grid.cellAge[i] = 0;
      game.grid.cellColor[i] = 0;
    }
  }
  // Fire.
  for (const [x, y] of level.fire || []) {
    if (game.grid.inBounds(x, y) && game.grid.get(x, y) === CELL_TYPE.EMPTY) {
      game.grid.set(x, y, CELL_TYPE.FIRE);
      const i = y * game.grid.width + game.grid.wrapX(x);
      game.grid.cellAge[i] = 0;
      game.grid.cellColor[i] = 0;
    }
  }
}

function applyToolRestrictions(game, level) {
  if (!game.drawTools) return;
  if (level.allowedTools && typeof level.allowedTools === 'object') {
    game.drawTools.setLevelToolRestriction(level.allowedTools);
  } else {
    game.drawTools.setLevelToolRestriction(null);
  }
  if (Array.isArray(level.allowedPatterns) && level.allowedPatterns.length > 0) {
    game.drawTools.setLevelPatternRestriction(new Set(level.allowedPatterns));
  } else {
    game.drawTools.setLevelPatternRestriction(null);
  }
  if (level.allowedTools) {
    const toolOrder = ['freehand', 'line', 'pattern', 'fill'];
    const firstEnabled = toolOrder.find((t) => level.allowedTools[t]);
    if (firstEnabled) game.drawTools.setMode(firstEnabled);
  }
  if (Array.isArray(level.allowedPatterns) && level.allowedPatterns.length > 0) {
    const presetSelect = document.getElementById('pattern-presets');
    if (presetSelect) {
      const firstAllowed = level.allowedPatterns[0];
      const found = Array.from(presetSelect.options).some((o) => o.value === firstAllowed);
      if (found) {
        presetSelect.value = firstAllowed;
        presetSelect.dispatchEvent(new Event('change'));
      }
    }
  }
}

function applyStartingSpeed(game, level) {
  let startSpeed = 1.0;
  if (level.settings && typeof level.settings.STARTING_SPEED === 'number') {
    startSpeed = level.settings.STARTING_SPEED;
  } else if (typeof CONFIG.STARTING_SPEED === 'number') {
    startSpeed = CONFIG.STARTING_SPEED;
  }
  CONFIG.SPEED_MULTIPLIER = startSpeed;
  if (game.speedSlider) {
    const startIdx = SPEED_PRESETS.findIndex((p) => p.value === startSpeed);
    let idx;
    if (startIdx >= 0) {
      idx = startIdx;
    } else {
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
    CONFIG.SPEED_MULTIPLIER = startSpeed;
    if (game.speedLabel) {
      const matched = SPEED_PRESETS[idx];
      if (matched && matched.value === startSpeed) {
        game.speedLabel.textContent = matched.name;
      } else {
        game.speedLabel.textContent = startSpeed === 0 ? 'Paused' : `${startSpeed}x (custom)`;
      }
    }
    if (startSpeed === 0) {
      game._prePauseIdx = SPEED_PRESETS.findIndex((p) => p.value === 1.0);
    }
  }
}

export function startCustomLevel(game, levelName) {
  const level = getLevel(levelName);
  if (!level) {
    Logger.warn(`[Game] Custom level "${levelName}" not found.`);
    return false;
  }
  Logger.info(`[Game] Starting custom level "${levelName}".`);
  game._activeCustomLevel = level;
  game._customVictoryShown = false;

  applyLevelSettings(game, level);
  applyColorTheme(game, level);
  applyGridAndRuleset(game, level);

  requestWakeLock();
  game._fitCellSize();

  game._pendingWrapVerticalShift =
    typeof level.wrapVerticalShift === 'number' ? level.wrapVerticalShift | 0 : 0;
  game._buildWorld();
  if (game.grid && typeof level.wrapVerticalShift === 'number') {
    game.grid.wrapVerticalShift = level.wrapVerticalShift | 0;
    if (game.simulation && game.simulation._initBackend) {
      game.simulation._initBackend();
      game.simulation._syncWrapShiftToBackend();
    }
  }
  game.renderer.setGrid(game.grid);
  game._initSpeedControls();
  game.defenses.maxInk = CONFIG.MAX_INK;
  game.defenses.reset();
  game.hud.reset();
  game.score.resetCombo();
  game.score.setGlobalMultiplier(1.0);

  populateGrid(game, level);
  game.missiles.setCustomBases(level.bases || []);
  game.missiles.setCustomSpawners(level.spawners || []);
  applyToolRestrictions(game, level);

  game.missiles.startWave(0);
  game._announceWave(1);
  game.gameState.set(STATE.PLAYING);
  game.hideOverlay();

  if (game.renderer && game.grid) {
    game.renderer.addBigFloater(
      Math.floor(game.grid.width / 2),
      Math.floor(game.grid.height / 3),
      `🛠 LEVEL: ${level.name}`,
      '#ffcc44',
      1.6
    );
  }
  if (game.freeplayAbilities) {
    game.freeplayAbilities.uninstall();
    game.freeplayAbilities.install();
  }
  Sfx.waveStart();
  applyStartingSpeed(game, level);
  return true;
}
