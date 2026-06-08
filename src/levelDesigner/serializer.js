// Serialization (save/load/import/export/share) helpers for the LevelDesigner.
// These functions mutate the designer's state via the passed-in instance
// but isolate the JSON shape from the main class.

import { Logger } from '../logger.js';
import { listLevels, saveLevel, deleteLevel, getLevel, importLevelJSON } from '../levels.js';

export function serializeLevel(d) {
  const out = {
    name: d.currentLevelName || 'untitled',
    createdAt: Date.now(),
    gridWidth: d.gridWidth,
    gridHeight: d.gridHeight,
    cities: d.cities.map((c) => {
      const o = { x: c.x, y: c.y, width: c.width, height: c.height };
      if (c.patternId) o.patternId = c.patternId;
      if (c.patternName) o.patternName = c.patternName;
      if (Array.isArray(c.cells)) o.cells = c.cells.map(([dx, dy]) => [dx, dy]);
      return o;
    }),
    defenses: Array.from(d.defenseCells).map((k) => k.split(',').map(Number)),
    enemies: Array.from(d.enemyCells).map((k) => k.split(',').map(Number)),
    barriers: Array.from(d.barrierCells).map((k) => k.split(',').map(Number)),
    fire: Array.from(d.fireCells).map((k) => k.split(',').map(Number)),
    bases: d.bases.map((pb) => ({
      patternId: pb.patternId,
      name: pb.name,
      x: pb.x,
      y: pb.y,
      width: pb.width,
      height: pb.height,
      cells: pb.cells.map(([dx, dy]) => [dx, dy]),
    })),
    spawners: d.spawners.map((sp) => ({
      patternId: sp.patternId,
      name: sp.name,
      x: sp.x,
      y: sp.y,
      width: sp.width,
      height: sp.height,
      cells: sp.cells.map(([dx, dy]) => [dx, dy]),
      interval: sp.interval || 2000,
      emitLimit: sp.emitLimit || 0,
      initialDelay: sp.initialDelay != null ? sp.initialDelay : sp.interval || 2000,
      padding: sp.padding != null ? sp.padding : 1,
    })),
    ruleset: d.ruleset,
    enemyRuleset: d.enemyRuleset || null,
    description: d.description,
    settings: JSON.parse(JSON.stringify(d.levelSettings || {})),
    allowedTools: { ...d.allowedTools },
    allowedPatterns: Array.from(d.allowedPatterns),
    colorTheme: { ...d.colorTheme },
    wrapVerticalShift: d.wrapVerticalShift | 0,
  };
  const s = out.settings || {};
  Logger.info(
    `[LevelDesigner] serialize "${out.name}": ` +
      `UNLIMITED_CELL_AGE=${s.UNLIMITED_CELL_AGE}, ` +
      `DEFENSE_AGE_FRIENDLY=${s.DEFENSE_AGE_FRIENDLY}, ` +
      `UNLIMITED_DEF_AGE_FRIENDLY=${s.UNLIMITED_DEF_AGE_FRIENDLY}, ` +
      `DEFENSE_AGE_ENEMY=${s.DEFENSE_AGE_ENEMY}, ` +
      `UNLIMITED_DEF_AGE_ENEMY=${s.UNLIMITED_DEF_AGE_ENEMY}, ` +
      `MISSILE_AGE_FRIENDLY=${s.MISSILE_AGE_FRIENDLY}, ` +
      `UNLIMITED_MISS_AGE_FRIENDLY=${s.UNLIMITED_MISS_AGE_FRIENDLY}, ` +
      `MISSILE_AGE_ENEMY=${s.MISSILE_AGE_ENEMY}, ` +
      `UNLIMITED_MISS_AGE_ENEMY=${s.UNLIMITED_MISS_AGE_ENEMY}`
  );
  return out;
}

export function deserializeLevel(d, level, defaultSettingsFn) {
  d.gridWidth = level.gridWidth || 120;
  d.gridHeight = level.gridHeight || 80;
  d.cities = (level.cities || []).map((c) => {
    const city = { x: c.x, y: c.y, width: c.width, height: c.height };
    if (c.patternId) city.patternId = c.patternId;
    if (c.patternName) city.patternName = c.patternName;
    if (Array.isArray(c.cells)) city.cells = c.cells.map(([dx, dy]) => [dx, dy]);
    return city;
  });
  d.defenseCells = new Set((level.defenses || []).map(([x, y]) => `${x},${y}`));
  d.enemyCells = new Set((level.enemies || []).map(([x, y]) => `${x},${y}`));
  d.barrierCells = new Set((level.barriers || []).map(([x, y]) => `${x},${y}`));
  d.fireCells = new Set((level.fire || []).map(([x, y]) => `${x},${y}`));
  const rawBases = level.patternBases || level.bases || [];
  d.bases = rawBases
    .filter((b) => Array.isArray(b.cells))
    .map((pb) => ({
      patternId: pb.patternId,
      name: pb.name || pb.patternId,
      x: pb.x,
      y: pb.y,
      width: pb.width,
      height: pb.height,
      cells: (pb.cells || []).map(([dx, dy]) => [dx, dy]),
    }));
  d.spawners = (level.spawners || []).map((sp) => ({
    patternId: sp.patternId,
    name: sp.name || sp.patternId,
    x: sp.x,
    y: sp.y,
    width: sp.width,
    height: sp.height,
    cells: (sp.cells || []).map(([dx, dy]) => [dx, dy]),
    interval: sp.interval || 2000,
    emitLimit: sp.emitLimit || 0,
    initialDelay: sp.initialDelay != null ? sp.initialDelay : sp.interval || 2000,
    padding: sp.padding != null ? sp.padding : 1,
  }));
  d.ruleset = level.ruleset || 'conway';
  d.enemyRuleset = level.enemyRuleset || null;
  d.description = level.description || '';
  d.currentLevelName = level.name;
  d.levelSettings =
    level.settings && typeof level.settings === 'object'
      ? { ...defaultSettingsFn(), ...level.settings }
      : defaultSettingsFn();
  d.allowedTools = { freehand: true, line: true, pattern: true, fill: true };
  if (level.allowedTools && typeof level.allowedTools === 'object') {
    for (const k of Object.keys(d.allowedTools)) {
      if (typeof level.allowedTools[k] === 'boolean') {
        d.allowedTools[k] = level.allowedTools[k];
      }
    }
  }
  d.allowedPatterns = new Set(Array.isArray(level.allowedPatterns) ? level.allowedPatterns : []);
  d.colorTheme =
    level.colorTheme && typeof level.colorTheme === 'object' ? { ...level.colorTheme } : {};
  d.wrapVerticalShift = level.wrapVerticalShift | 0;
}

export function refreshLevelList(overlay) {
  const sel = overlay.querySelector('#ld-level-select');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '';
  for (const lvl of listLevels()) {
    const opt = document.createElement('option');
    opt.value = lvl.name;
    const dim = `${lvl.gridWidth || '?'}×${lvl.gridHeight || '?'}`;
    opt.textContent = `${lvl.name} (${dim}, ${(lvl.cities || []).length} cities)`;
    sel.appendChild(opt);
  }
  if (current) sel.value = current;
}

export { saveLevel, deleteLevel, getLevel, importLevelJSON };
