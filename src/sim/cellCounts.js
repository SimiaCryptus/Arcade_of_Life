import { CONFIG, CELL_TYPE } from '../config.js';

/**
 * Count cells of various types in their respective territories.
 * - cityCells: total CITY cells anywhere on the grid (cities live in
 *   friendly region by convention).
 * - enemyCellsInEnemyRegion: MISSILE cells in the enemy region (top
 *   dead zone + base zone rows).
 * - enemyCellsTotal: MISSILE cells anywhere.
 *
 * @param {Grid} grid
 * @returns {{cityCells: number, enemyCellsInEnemyRegion: number, enemyCellsTotal: number}}
 */
export function countCells(grid) {
  if (!grid || !grid.cells) {
    return { cityCells: 0, enemyCellsInEnemyRegion: 0, enemyCellsTotal: 0 };
  }
  const cells = grid.cells;
  const w = grid.width;
  const h = grid.height;
  // Enemy region = top dead zone + base zone.
  const topDeadMax = Math.min(h - 1, CONFIG.RETURN_FIRE_ZONE_MAX_Y | 0);
  const baseZoneH = Math.max(0, CONFIG.BASE_ZONE_HEIGHT | 0);
  const enemyRegionMaxY = Math.min(h - 1, topDeadMax + baseZoneH);
  let cityCells = 0;
  let enemyCellsInEnemyRegion = 0;
  let enemyCellsTotal = 0;
  for (let y = 0; y < h; y++) {
    const rowBase = y * w;
    const inEnemyRegion = y <= enemyRegionMaxY;
    for (let x = 0; x < w; x++) {
      const t = cells[rowBase + x];
      if (t === CELL_TYPE.CITY) cityCells++;
      else if (t === CELL_TYPE.MISSILE) {
        enemyCellsTotal++;
        if (inEnemyRegion) enemyCellsInEnemyRegion++;
      }
    }
  }
  return { cityCells, enemyCellsInEnemyRegion, enemyCellsTotal };
}
