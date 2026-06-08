// Drawing-tool math: Bresenham lines (with width + dash) and
// pattern-fill rectangles. Pure functions — no DOM, no state.

const DASH_SPECS = {
  solid: null,
  dashed: [2, 2],
  dotted: [1, 2],
  sparse: [1, 4],
};

const FILL_FNS = {
  solid: () => true,
  checker: (x, y) => ((x + y) & 1) === 0,
  stripes_h: (_x, y) => (y & 1) === 0,
  stripes_v: (x) => (x & 1) === 0,
  diagonal: (x, y) => (x + y) % 3 === 0,
  dots_sparse: (x, y) => x % 3 === 0 && y % 3 === 0,
  dots_dense: (x, y) => x % 2 === 0 && y % 2 === 0,
  grid: (x, y) => x % 4 === 0 || y % 4 === 0,
  cross: (x, y) => x % 4 === 0 && y % 4 === 0,
  random50: () => Math.random() < 0.5,
  random25: () => Math.random() < 0.25,
};

/**
 * Bresenham line from (x0,y0) to (x1,y1), thickened by `lineWidth`
 * cells with optional `dashPattern`. Cells outside the grid bounds
 * are clipped out. Returns an array of [x,y] tuples.
 */
export function computeLine(x0, y0, x1, y1, gridWidth, gridHeight, lineWidth, dashPattern) {
  const out = [];
  const seen = new Set();
  const w = lineWidth;
  const half = Math.floor(w / 2);
  const dashSpec = DASH_SPECS[dashPattern];
  const dashScale = Math.max(1, w);
  let dashCounter = 0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0,
    y = y0;
  while (true) {
    let emit = true;
    if (dashSpec) {
      const on = dashSpec[0] * dashScale;
      const off = dashSpec[1] * dashScale;
      emit = dashCounter % (on + off) < on;
    }
    dashCounter++;
    if (emit) {
      if (w <= 1) {
        const key = `${x},${y}`;
        if (!seen.has(key) && x >= 0 && x < gridWidth && y >= 0 && y < gridHeight) {
          seen.add(key);
          out.push([x, y]);
        }
      } else {
        for (let by = -half; by <= half; by++) {
          for (let bx = -half; bx <= half; bx++) {
            const px = x + bx;
            const py = y + by;
            const key = `${px},${py}`;
            if (!seen.has(key) && px >= 0 && px < gridWidth && py >= 0 && py < gridHeight) {
              seen.add(key);
              out.push([px, py]);
            }
          }
        }
      }
    }
    if (x === x1 && y === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/**
 * Compute the cells of a fill rectangle from (x0,y0)..(x1,y1) using
 * the named `fillPattern`. Returns an array of [x,y] tuples clipped
 * to grid bounds.
 */
export function computeFillRect(x0, y0, x1, y1, gridWidth, gridHeight, fillPattern) {
  const fn = FILL_FNS[fillPattern] || FILL_FNS.solid;
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const out = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) continue;
      if (fn(x - minX, y - minY)) out.push([x, y]);
    }
  }
  return out;
}
