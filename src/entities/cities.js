import {CONFIG, CELL_TYPE} from '../config.js';

/**
 * Cities are placed along the bottom row of the grid.
 * They are static and immune to Game of Life death rules.
 */
export class Cities {
  constructor(grid) {
    this.grid = grid;
    this.cities = []; // [{x, y, width, height, alive}]
  }

  place() {
    const count = CONFIG.CITY_COUNT;
    const w = this.grid.width;
    const cityW = CONFIG.CITY_WIDTH;
    const cityH = CONFIG.CITY_HEIGHT;
    const spacing = Math.floor(w / (count + 1));

    this.cities = [];
    // Wipe any leftover pending cells so freshly-placed cities aren't drawn over.
    this.grid.clearPending();
    // Ensure cities are placed within the draw zone (below the boundary).
    const dzMinY = this.grid.drawZoneMinY();
    const cy = Math.max(dzMinY, this.grid.height - cityH - 1);
    for (let i = 0; i < count; i++) {
      const cx = spacing * (i + 1) - Math.floor(cityW / 2);
      const city = {x: cx, y: cy, width: cityW, height: cityH, alive: true};
      this.cities.push(city);
      this._drawCity(city);
    }
  }

  _drawCity(city) {
    for (let dy = 0; dy < city.height; dy++) {
      for (let dx = 0; dx < city.width; dx++) {
        this.grid.set(city.x + dx, city.y + dy, CELL_TYPE.CITY);
      }
    }
  }

  // Count cities still alive (have at least one city cell remaining)
  update() {
    for (const city of this.cities) {
      if (!city.alive) continue;
      let hasCell = false;
      for (let dy = 0; dy < city.height && !hasCell; dy++) {
        for (let dx = 0; dx < city.width && !hasCell; dx++) {
          if (this.grid.get(city.x + dx, city.y + dy) === CELL_TYPE.CITY) {
            hasCell = true;
          }
        }
      }
      if (!hasCell) city.alive = false;
    }
  }

  aliveCount() {
    return this.cities.filter(c => c.alive).length;
  }
}