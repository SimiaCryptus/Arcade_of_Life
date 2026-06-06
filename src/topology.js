/**
 * Grid topology module.
 *
 * Defines tessellations of the 2D plane: square (default Conway),
 * hexagonal (HexLife — 6 edge neighbors), and triangular (TriLife —
 * 12 vertex+edge neighbors).
 *
 * Each topology provides:
 *   - id, name, description
 *   - neighbor offset lists (in topology-native coordinates)
 *   - pixel-conversion math (cell ↔ canvas position)
 *   - cell polygon vertices for rendering
 *   - hit-testing (pointer → cell)
 *
 * Square coordinates are (x, y) integers in [0, W-1] × [0, H-1].
 *
 * Hex coordinates use "axial" (q, r) with offset storage in a
 * rectangular array indexed as cells[r * W + q]. We use "pointy-top"
 * orientation by default.
 *
 * Triangular coordinates use (x, y, orientation) where orientation
 * is 0 = upward-pointing △, 1 = downward-pointing ▽. We pack into
 * the array as cells[y * (2*W) + 2*x + orientation], so each
 * "logical column" holds two triangles.
 */

// ── Square topology (default) ───────────────────────────────────────

const SQUARE_NEIGHBOR_OFFSETS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/** @type {Topology} */
export const SQUARE_TOPOLOGY = {
  id: 'square',
  name: 'Square',
  description: 'Standard 2D square lattice (Moore neighborhood, 8 neighbors).',
  // Storage: cells[y * W + x], dimensions (W, H).
  arraySize: (w, h) => w * h,
  index: (x, y, w) => y * w + x,
  unindex: (i, w) => [i % w, Math.floor(i / w)],
  // Default 8-neighbor Moore offsets.
  defaultOffsets: SQUARE_NEIGHBOR_OFFSETS,
  // Pixel conversion: cell at (x, y) covers [x*cs, (x+1)*cs] × [y*cs, (y+1)*cs].
  cellToPixel: (x, y, cs) => ({ px: x * cs, py: y * cs }),
  cellCenter: (x, y, cs) => ({ px: x * cs + cs / 2, py: y * cs + cs / 2 }),
  pixelToCell: (px, py, cs) => ({ x: Math.floor(px / cs), y: Math.floor(py / cs) }),
  // Polygon vertices for rendering. Returns array of [px, py] absolute coords.
  cellPolygon: (x, y, cs) => [
    [x * cs, y * cs],
    [x * cs + cs, y * cs],
    [x * cs + cs, y * cs + cs],
    [x * cs, y * cs + cs],
  ],
  // Pixel size of one cell's bounding box.
  cellBoundingBox: (cs) => ({ w: cs, h: cs }),
  // Total canvas size for a (W, H) grid at cell size cs.
  canvasSize: (w, h, cs) => ({ w: w * cs, h: h * cs }),
  // Horizontal wrap for square grid.
  wrap: (x, y, w, h) => {
    const nx = ((x % w) + w) % w;
    return { x: nx, y, valid: y >= 0 && y < h };
  },
  // Neighbor count for a given offset list.
  neighborCount: (offsets) => offsets.length,
};

// ── Hex topology (HexLife) ──────────────────────────────────────────

// Pointy-top hex with odd-r OFFSET coordinates (rectangular layout).
// Each odd row r is shifted right by half a hex width.
// Neighbor offsets depend on row parity for the diagonals.
//
// For EVEN rows (r is even):
//   E: (q+1, r)      W: (q-1, r)
//   NE: (q, r-1)     NW: (q-1, r-1)
//   SE: (q, r+1)     SW: (q-1, r+1)
//
// For ODD rows (r is odd):
//   E: (q+1, r)      W: (q-1, r)
//   NE: (q+1, r-1)   NW: (q, r-1)
//   SE: (q+1, r+1)   SW: (q, r+1)
const HEX_NEIGHBOR_OFFSETS_6_EVEN = [
  [+1, 0],
  [-1, 0],
  [0, -1],
  [-1, -1],
  [0, +1],
  [-1, +1],
];
const HEX_NEIGHBOR_OFFSETS_6_ODD = [
  [+1, 0],
  [-1, 0],
  [+1, -1],
  [0, -1],
  [+1, +1],
  [0, +1],
];
// Legacy axial offsets kept for backward compatibility with the
// neighborhoods.js registry (which uses them as the canonical
// "hex_6" offset list). The topology helper getOffsetsForCell()
// returns the correct row-parity-dependent offsets.
const HEX_NEIGHBOR_OFFSETS_6 = HEX_NEIGHBOR_OFFSETS_6_EVEN;

// Extended hex neighborhood: 6 + 12 = 18 cells (two concentric rings).
// Row-parity-dependent for the same reason as the 6-cell set.
const HEX_NEIGHBOR_OFFSETS_18_EVEN = [
  ...HEX_NEIGHBOR_OFFSETS_6_EVEN,
  [+2, 0],
  [-2, 0],
  [+1, -1],
  [-2, -1],
  [+1, +1],
  [-2, +1],
  [-1, -2],
  [0, -2],
  [+1, -2],
  [-1, +2],
  [0, +2],
  [+1, +2],
];
const HEX_NEIGHBOR_OFFSETS_18_ODD = [
  ...HEX_NEIGHBOR_OFFSETS_6_ODD,
  [+2, 0],
  [-2, 0],
  [+2, -1],
  [-1, -1],
  [+2, +1],
  [-1, +1],
  [-1, -2],
  [0, -2],
  [+1, -2],
  [-1, +2],
  [0, +2],
  [+1, +2],
];
const HEX_NEIGHBOR_OFFSETS_18 = HEX_NEIGHBOR_OFFSETS_18_EVEN;
// Helper exported so the simulation backend can resolve per-cell offsets.
export function getHexNeighborOffsets(r, size = 6) {
  const isOdd = (r & 1) === 1;
  if (size === 18) {
    return isOdd ? HEX_NEIGHBOR_OFFSETS_18_ODD : HEX_NEIGHBOR_OFFSETS_18_EVEN;
  }
  return isOdd ? HEX_NEIGHBOR_OFFSETS_6_ODD : HEX_NEIGHBOR_OFFSETS_6_EVEN;
}

// Hex pixel math constants (pointy-top).
// For hex of "size" s (center-to-vertex distance):
//   width  = sqrt(3) * s
//   height = 2 * s
//   horiz spacing (q-axis): sqrt(3) * s
//   vert spacing  (r-axis): 1.5 * s
// We use cellSize (cs) as the hex height for consistency, so s = cs/2.
const SQRT3 = Math.sqrt(3);

/** @type {Topology} */
export const HEX_TOPOLOGY = {
  id: 'hex',
  name: 'Hexagonal',
  description:
    'Hexagonal lattice with 6 edge neighbors (HexLife). Isotropic propagation, no diagonal bias.',
  arraySize: (w, h) => w * h,
  index: (q, r, w) => r * w + q,
  unindex: (i, w) => [i % w, Math.floor(i / w)],
  defaultOffsets: HEX_NEIGHBOR_OFFSETS_6,
  extendedOffsets: HEX_NEIGHBOR_OFFSETS_18,
  // Per-cell offset getter — neighbors depend on row parity.
  getOffsetsForCell: (r, size = 6) => getHexNeighborOffsets(r, size),
  // Rectangular layout using "odd-r offset" coordinates: each odd
  // row is shifted right by half a hex width, so the overall grid
  // forms a rectangle (not a slanted parallelogram).
  // For pointy-top hex of size s (s = cs/2):
  //   hex width  = √3 * s
  //   hex height = 2 * s
  //   horizontal stride: √3 * s
  //   vertical stride:   1.5 * s
  //   odd rows offset by: (√3 * s) / 2
  cellToPixel: (q, r, cs) => {
    const s = cs / 2;
    const w = SQRT3 * s;
    const offset = (r & 1) === 1 ? w * 0.5 : 0;
    return {
      px: w * q + offset,
      py: 1.5 * s * r,
    };
  },
  cellCenter: (q, r, cs) => {
    const s = cs / 2;
    const w = SQRT3 * s;
    const offset = (r & 1) === 1 ? w * 0.5 : 0;
    return {
      px: w * q + offset + w / 2,
      py: 1.5 * s * r + s,
    };
  },
  pixelToCell: (px, py, cs) => {
    // Inverse of cellCenter for odd-r offset layout.
    //   py = 1.5*s*r + s  ⇒  r = (py - s) / (1.5*s)
    //   px = w*q + offset + w/2  ⇒  q = (px - offset - w/2) / w
    const s = cs / 2;
    const w = SQRT3 * s;
    const rFloat = (py - s) / (1.5 * s);
    // We need to round r first to know the offset.
    // Try both even and odd r candidates and pick the closest hex.
    const rCandidates = [Math.floor(rFloat), Math.ceil(rFloat)];
    let best = null;
    let bestDist = Infinity;
    for (const rCand of rCandidates) {
      const offset = (rCand & 1) === 1 ? w * 0.5 : 0;
      const qFloat = (px - offset - w / 2) / w;
      const qCandidates = [Math.floor(qFloat), Math.ceil(qFloat)];
      for (const qCand of qCandidates) {
        // Distance from pixel to this hex center.
        const cx = w * qCand + offset + w / 2;
        const cy = 1.5 * s * rCand + s;
        const dx = px - cx;
        const dy = py - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) {
          bestDist = d2;
          best = { x: qCand, y: rCand };
        }
      }
    }
    return best || { x: 0, y: 0 };
  },
  cellPolygon: (q, r, cs) => {
    const s = cs / 2;
    const center = HEX_TOPOLOGY.cellCenter(q, r, cs);
    // Pointy-top: vertices at 30°, 90°, 150°, 210°, 270°, 330°.
    const verts = [];
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 6 + (i * Math.PI) / 3;
      verts.push([center.px + s * Math.cos(angle), center.py + s * Math.sin(angle)]);
    }
    return verts;
  },
  cellBoundingBox: (cs) => ({ w: (SQRT3 * cs) / 2, h: cs }),
  canvasSize: (w, h, cs) => {
    const s = cs / 2;
    const hexW = SQRT3 * s;
    // Rectangular layout: width is just w hexes plus a half-hex
    // offset for any odd row (always present unless h <= 1).
    return {
      w: hexW * w + (h > 1 ? hexW * 0.5 : 0),
      h: 1.5 * s * (h - 1) + cs,
    };
  },
  wrap: (q, r, w, h) => {
    // Horizontal wrap on q axis (within the same logical row).
    const nq = ((q % w) + w) % w;
    return { x: nq, y: r, valid: r >= 0 && r < h };
  },
  neighborCount: (offsets) => offsets.length,
};

// Hex rounding helper: snap fractional axial coords to nearest hex.
function hexRound(q, r) {
  // Convert to cube, round, convert back.
  const x = q;
  const z = r;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { x: rx, y: rz };
}

// ── Triangular topology (TriLife) ──────────────────────────────────

// Triangular grid: each cell is △ (upward, orientation 0) or ▽ (downward, orientation 1).
// Storage: cells[y * (2*W) + 2*x + orientation].
//
// Neighbor structure:
//   - Edge neighbors: 3 (cells sharing an edge with opposite orientation).
//   - Vertex neighbors: 9 more (cells sharing only a vertex).
//   Total: 12 neighbors when including vertex-sharing.
//
// We compute neighbor offsets dynamically based on cell orientation,
// since the offset pattern depends on whether the cell points up or down.
//
// For an upward triangle △ at (x, y, 0):
//   Edge neighbors:
//     (x-1, y, 1)   left
//     (x+1, y, 1)   right
//     (x,   y+1, 1) below (downward triangle in row below)
//   Vertex neighbors (9 more for 12 total):
//     (x-1, y-1, 1), (x, y-1, 0), (x, y-1, 1), (x+1, y-1, 0),
//     (x-2, y, 0), (x-1, y, 0), (x+1, y, 0), (x+2, y, 0),
//     (x-1, y+1, 0)
//   Actually the full 12-neighbor set varies by source. We'll use
//   the standard "shared edge OR vertex" definition.
//
// We provide a function getTriNeighborOffsets(orientation) that
// returns the 12 [dx, dy, dOrient] triples.

function getTriNeighborOffsets12(orientation) {
  if (orientation === 0) {
    // Upward triangle △ at (x, y, 0).
    // The 12 neighbors are organized as:
    //   3 edge-sharing (downward triangles touching each edge)
    //   9 vertex-sharing
    return [
      // Edge neighbors (share an edge → must be downward ▽):
      [-1, 0, 1], // left edge
      [+1, 0, 1], // right edge
      [0, +1, 1], // bottom edge → ▽ in row y+1
      // Vertex neighbors:
      // Top vertex (apex):
      [-1, -1, 1],
      [0, -1, 0],
      [0, -1, 1],
      [+1, -1, 0],
      // Left vertex:
      [-2, 0, 0],
      [-1, 0, 0],
      // Right vertex:
      [+1, 0, 0],
      [+2, 0, 0],
      // Bottom-left/right vertices (shared with row below):
      [-1, +1, 0],
    ];
  } else {
    // Downward triangle ▽ at (x, y, 1).
    return [
      // Edge neighbors (share an edge → must be upward △):
      [-1, 0, 0], // left edge
      [+1, 0, 0], // right edge
      [0, -1, 0], // top edge → △ in row y-1
      // Vertex neighbors:
      // Bottom vertex:
      [-1, +1, 0],
      [0, +1, 1],
      [0, +1, 0],
      [+1, +1, 1],
      // Left vertex:
      [-2, 0, 1],
      [-1, 0, 1],
      // Right vertex:
      [+1, 0, 1],
      [+2, 0, 1],
      // Top-left/right vertex (shared with row above):
      [+1, -1, 0],
    ];
  }
}

// Reduced 3-neighbor set (edge-sharing only).
function getTriNeighborOffsets3(orientation) {
  if (orientation === 0) {
    return [
      [-1, 0, 1],
      [+1, 0, 1],
      [0, +1, 1],
    ];
  } else {
    return [
      [-1, 0, 0],
      [+1, 0, 0],
      [0, -1, 0],
    ];
  }
}

/** @type {Topology} */
export const TRI_TOPOLOGY = {
  id: 'tri',
  name: 'Triangular',
  description:
    'Triangular lattice. 12 vertex+edge neighbors (TriLife). Highly connected, supports fluid-like propagation.',
  // Storage doubled: 2 triangles per logical cell (up + down).
  arraySize: (w, h) => w * h * 2,
  index: (x, y, w, orient = 0) => y * w * 2 + x * 2 + orient,
  unindex: (i, w) => {
    const orient = i & 1;
    const xy = (i - orient) / 2;
    return [xy % w, Math.floor(xy / w), orient];
  },
  // Offsets are dynamic per orientation; use helper.
  defaultOffsets: null, // overridden by getTriOffsetsForCell
  getOffsetsForCell: getTriNeighborOffsets12,
  getEdgeOffsetsForCell: getTriNeighborOffsets3,
  // Pixel math: each triangle has base cs (horizontal width),
  // height = cs * sqrt(3) / 2. Two triangles fit in one "column"
  // of width cs/2 horizontally (they share an edge).
  // Layout: row y has triangles at y * triH vertical position.
  //   △ (orient=0) at logical (x, y) sits with its base on bottom,
  //   apex at top, centered horizontally at x * (cs/2) + cs/2.
  //   ▽ (orient=1) at logical (x, y) sits with its base on top,
  //   apex at bottom, centered at x * (cs/2) + cs/2.
  // Actually we use a denser packing: each column of width cs/2
  // alternates △ and ▽ across rows AND across x.
  // Simpler scheme: triangles in row y at columns 0,1,2,...,2W-1.
  // Even indices (2x) = △, odd indices (2x+1) = ▽.
  // Each triangle has width cs (base), centered.
  cellToPixel: (x, y, cs, orient = 0) => {
    const triH = (cs * SQRT3) / 2;
    // Each logical (x, orient) pair contributes a half-width offset:
    //   △ at logical (x, 0) → spans [x*cs/2, x*cs/2 + cs] horizontally
    //   ▽ at logical (x, 1) → spans [x*cs/2 + cs/2, x*cs/2 + 3cs/2]
    const px = x * cs * 0.5 + (orient === 1 ? cs * 0.5 : 0);
    return { px, py: y * triH };
  },
  cellCenter: (x, y, cs, orient = 0) => {
    const triH = (cs * SQRT3) / 2;
    const px = x * cs * 0.5 + cs * 0.5 + (orient === 1 ? cs * 0.5 : 0);
    // Centroid of triangle: 1/3 from base.
    const py =
      orient === 0
        ? y * triH + (triH * 2) / 3 // △: centroid lower
        : y * triH + triH / 3; // ▽: centroid higher
    return { px, py };
  },
  pixelToCell: (px, py, cs) => {
    // Determine row first.
    const triH = (cs * SQRT3) / 2;
    const y = Math.floor(py / triH);
    const ry = py - y * triH; // y within row
    // Determine column by halving cs.
    const colHalf = Math.floor(px / (cs * 0.5));
    const rx = px - colHalf * cs * 0.5; // x within half-column
    // Each "tile" is a parallelogram half of width cs/2 and height triH.
    // Determine if click is in △ or ▽ via slope test.
    //   The dividing line within each tile goes from (0, 0) to (cs/2, triH)
    //   for even colHalf, and (0, triH) to (cs/2, 0) for odd colHalf.
    // Simpler: use barycentric test.
    const x = Math.floor(colHalf / 2);
    const isOddCol = (colHalf & 1) === 1;
    // Determine orientation based on slope:
    // For even colHalf:
    //   if ry/triH < rx/(cs*0.5) → above the rising diagonal → △ in this x
    //   else → ▽ in (x-1) ... this gets fiddly. Use a robust test:
    // Convert to barycentric within the triangle pair.
    // For now, approximate via slope test:
    const slope = ry / triH - rx / (cs * 0.5);
    let orient, finalX;
    if (!isOddCol) {
      // Column starts with △ (orient=0).
      if (slope < 0) {
        orient = 0;
        finalX = x;
      } else {
        orient = 1;
        finalX = x - 1;
      }
    } else {
      // Column starts with ▽ (orient=1).
      if (slope < 0) {
        orient = 1;
        finalX = x;
      } else {
        orient = 0;
        finalX = x + 1;
      }
    }
    return { x: finalX, y, orient };
  },
  cellPolygon: (x, y, cs, orient = 0) => {
    const triH = (cs * SQRT3) / 2;
    const x0 = x * cs * 0.5 + (orient === 1 ? cs * 0.5 : 0);
    const y0 = y * triH;
    if (orient === 0) {
      // △: apex on top, base on bottom.
      return [
        [x0 + cs * 0.5, y0], // apex
        [x0 + cs, y0 + triH], // bottom right
        [x0, y0 + triH], // bottom left
      ];
    } else {
      // ▽: apex on bottom, base on top.
      return [
        [x0, y0], // top left
        [x0 + cs, y0], // top right
        [x0 + cs * 0.5, y0 + triH], // apex on bottom
      ];
    }
  },
  cellBoundingBox: (cs) => ({ w: cs, h: (cs * SQRT3) / 2 }),
  canvasSize: (w, h, cs) => ({
    w: w * cs * 0.5 + cs * 0.5,
    h: (h * cs * SQRT3) / 2,
  }),
  wrap: (x, y, w, h, orient = 0) => {
    const nx = ((x % w) + w) % w;
    return { x: nx, y, valid: y >= 0 && y < h, orient };
  },
  neighborCount: (offsets) => offsets.length,
};

// ── Registry ────────────────────────────────────────────────────────

const REGISTRY = new Map();
REGISTRY.set('square', SQUARE_TOPOLOGY);
REGISTRY.set('hex', HEX_TOPOLOGY);
REGISTRY.set('tri', TRI_TOPOLOGY);

export function getTopology(id) {
  return REGISTRY.get(id) || SQUARE_TOPOLOGY;
}

export function listTopologies() {
  return Array.from(REGISTRY.values());
}

// Convenience: total neighbor count for a topology's default offsets.
export function defaultNeighborCount(topology) {
  if (topology.defaultOffsets) return topology.defaultOffsets.length;
  if (topology.id === 'tri') return 12;
  return 8;
}
