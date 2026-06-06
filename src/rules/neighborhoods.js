/**
 * Custom neighborhood definitions for cellular automata.
 *
 * Standard Life uses the 8-cell Moore neighborhood. This module
 * supports:
 *   - Fractional Euclidean-radius neighborhoods (isotropic, circular)
 *   - Anisotropic transformed neighborhoods (elliptical, sheared, rotated)
 *
 * A neighborhood is represented as a list of [dx, dy] offsets relative
 * to a cell, excluding (0, 0). The maximum live count is len(offsets),
 * which may exceed 8 for larger radii.
 */

/**
 * Generate offsets for a Euclidean neighborhood with the given radius.
 * Includes all integer lattice points (dx, dy) with dx² + dy² ≤ r²,
 * excluding the origin.
 *
 * @param {number} radius
 * @returns {Array<[number, number]>}
 */
export function euclideanOffsets(radius) {
  const r2 = radius * radius;
  const rCeil = Math.ceil(radius);
  const out = [];
  for (let dy = -rCeil; dy <= rCeil; dy++) {
    for (let dx = -rCeil; dx <= rCeil; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (dx * dx + dy * dy <= r2 + 1e-9) {
        out.push([dx, dy]);
      }
    }
  }
  return out;
}

/**
 * Apply a 2x2 linear transform T to a vector [dx, dy].
 * @param {number[][]} T  - 2x2 matrix as [[a,b],[c,d]]
 * @param {number} dx
 * @param {number} dy
 * @returns {[number, number]}
 */
export function applyTransform(T, dx, dy) {
  return [T[0][0] * dx + T[0][1] * dy, T[1][0] * dx + T[1][1] * dy];
}

/**
 * Generate offsets for a transformed Euclidean neighborhood.
 * A cell at offset (dx, dy) is included iff ||T·[dx,dy]||₂ ≤ radius.
 *
 * @param {number} radius
 * @param {number[][]} T  - 2x2 transform matrix
 * @returns {Array<[number, number]>}
 */
export function transformedEuclideanOffsets(radius, T) {
  const r2 = radius * radius;
  // Compute conservative search bounds. The inverse transform tells us
  // how far in raw lattice space we need to look to capture all cells
  // whose transformed distance is ≤ radius.
  const det = T[0][0] * T[1][1] - T[0][1] * T[1][0];
  let searchR;
  if (Math.abs(det) < 1e-9) {
    // Degenerate transform; fall back to a generous bound.
    searchR = Math.ceil(radius * 10);
  } else {
    const Tinv = [
      [T[1][1] / det, -T[0][1] / det],
      [-T[1][0] / det, T[0][0] / det],
    ];
    // The operator norm of T⁻¹ gives the max stretching factor.
    // Approximate with the Frobenius norm (always ≥ operator norm).
    const frob = Math.sqrt(Tinv[0][0] ** 2 + Tinv[0][1] ** 2 + Tinv[1][0] ** 2 + Tinv[1][1] ** 2);
    searchR = Math.ceil(radius * frob) + 1;
  }
  // Hard cap to keep things sane.
  searchR = Math.min(searchR, 32);
  const out = [];
  for (let dy = -searchR; dy <= searchR; dy++) {
    for (let dx = -searchR; dx <= searchR; dx++) {
      if (dx === 0 && dy === 0) continue;
      const [tx, ty] = applyTransform(T, dx, dy);
      if (tx * tx + ty * ty <= r2 + 1e-9) {
        out.push([dx, dy]);
      }
    }
  }
  return out;
}

/**
 * Build a 2x2 rotation matrix.
 * @param {number} theta - angle in radians
 */
export function rotationMatrix(theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [
    [c, -s],
    [s, c],
  ];
}

/**
 * Build a 2x2 diagonal scale matrix.
 */
export function scaleMatrix(sx, sy) {
  return [
    [sx, 0],
    [0, sy],
  ];
}

/**
 * Build a 2x2 shear matrix [[1, k],[0, 1]].
 */
export function shearMatrix(k) {
  return [
    [1, k],
    [0, 1],
  ];
}

/**
 * Multiply two 2x2 matrices A·B.
 */
export function matMul(A, B) {
  return [
    [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
    [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]],
  ];
}

/**
 * Build a rotated, anisotropically scaled transform:
 *   T = R(θ) · S(sx, sy) · R(-θ)
 */
export function rotatedScaleMatrix(theta, sx, sy) {
  const R = rotationMatrix(theta);
  const Rinv = rotationMatrix(-theta);
  const S = scaleMatrix(sx, sy);
  return matMul(R, matMul(S, Rinv));
}

/**
 * A neighborhood descriptor. Holds the offset list plus metadata
 * useful for debugging/UI.
 */
export class Neighborhood {
  /**
   * @param {Object} opts
   * @param {string} opts.id
   * @param {string} opts.name
   * @param {Array<[number, number]>} opts.offsets
   * @param {string} [opts.description]
   * @param {number} [opts.radius]
   * @param {number[][]} [opts.transform]
   */
  constructor({ id, name, offsets, description, radius, transform }) {
    this.id = id;
    this.name = name;
    this.offsets = offsets;
    this.description = description || '';
    this.radius = radius != null ? radius : null;
    this.transform = transform || null;
    this.size = offsets.length;
    // Bounding box for efficient iteration.
    let minX = 0,
      minY = 0,
      maxX = 0,
      maxY = 0;
    for (const [dx, dy] of offsets) {
      if (dx < minX) minX = dx;
      if (dy < minY) minY = dy;
      if (dx > maxX) maxX = dx;
      if (dy > maxY) maxY = dy;
    }
    this.bounds = { minX, minY, maxX, maxY };
  }
}

/**
 * The canonical 8-cell Moore neighborhood.
 */
export const MOORE_NEIGHBORHOOD = new Neighborhood({
  id: 'moore',
  name: 'Moore (8-cell)',
  offsets: [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ],
  description: 'Standard 8-cell Moore neighborhood. The classic Life topology.',
  radius: Math.SQRT2,
});

/**
 * Built-in neighborhood presets. Mix of Euclidean radii and transforms.
 */
const REGISTRY = new Map();
REGISTRY.set('moore', MOORE_NEIGHBORHOOD);

function register(nbhd) {
  REGISTRY.set(nbhd.id, nbhd);
  return nbhd;
}

// ── Euclidean-radius presets ─────────────────────────────────────────

register(
  new Neighborhood({
    id: 'eucl_1',
    name: 'Von Neumann (r=1)',
    offsets: euclideanOffsets(1.0),
    description: '4-cell von Neumann neighborhood (orthogonal only).',
    radius: 1.0,
  })
);

register(
  new Neighborhood({
    id: 'eucl_1_9',
    name: 'Euclidean r=1.9',
    offsets: euclideanOffsets(1.9),
    description:
      'Fractional Euclidean radius 1.9 — same 8 cells as Moore, but the ' +
      'rule context is explicit about the underlying isotropic geometry. ' +
      'Used as a baseline for comparing with larger fractional radii.',
    radius: 1.9,
  })
);

register(
  new Neighborhood({
    id: 'eucl_2',
    name: 'Euclidean r=2.0 (12-cell)',
    offsets: euclideanOffsets(2.0),
    description:
      '12-cell neighborhood: Moore plus the 4 cells at orthogonal ' +
      'distance 2. Crosses the √4 lattice threshold.',
    radius: 2.0,
  })
);

register(
  new Neighborhood({
    id: 'eucl_2_236',
    name: 'Euclidean r=√5 ≈ 2.236',
    offsets: euclideanOffsets(Math.sqrt(5)),
    description: '20-cell neighborhood including the 8 knight-jump cells at ' + 'distance √5.',
    radius: Math.sqrt(5),
  })
);

register(
  new Neighborhood({
    id: 'eucl_2_6',
    name: 'Euclidean r=2.6',
    offsets: euclideanOffsets(2.6),
    description:
      '20 cells — includes (2,1) and (1,2) knight-jumps but excludes ' +
      '(2,2) at √8 ≈ 2.828 and (3,0)/(0,3) at distance 3. Distinctly ' +
      'isotropic emergent dynamics.',
    radius: 2.6,
  })
);

register(
  new Neighborhood({
    id: 'eucl_3',
    name: 'Euclidean r=3.0',
    offsets: euclideanOffsets(3.0),
    description: '28-cell neighborhood. Approaches PDE-like wave propagation.',
    radius: 3.0,
  })
);

// ── Anisotropic presets ──────────────────────────────────────────────

register(
  new Neighborhood({
    id: 'aniso_horiz_stretch',
    name: 'Anisotropic: horizontal stretch',
    offsets: transformedEuclideanOffsets(2.0, [
      [0.5, 0],
      [0, 1.0],
    ]),
    description:
      'Elliptical neighborhood stretched horizontally (sx=0.5, sy=1.0). ' +
      'Patterns elongate and slide along the horizontal axis like wind.',
    radius: 2.0,
    transform: [
      [0.5, 0],
      [0, 1.0],
    ],
  })
);

register(
  new Neighborhood({
    id: 'aniso_vert_stretch',
    name: 'Anisotropic: vertical stretch',
    offsets: transformedEuclideanOffsets(2.0, [
      [1.0, 0],
      [0, 0.5],
    ]),
    description:
      'Elliptical neighborhood stretched vertically (sx=1.0, sy=0.5). ' +
      'Patterns elongate vertically — useful for simulating gravity wells.',
    radius: 2.0,
    transform: [
      [1.0, 0],
      [0, 0.5],
    ],
  })
);

register(
  new Neighborhood({
    id: 'aniso_shear',
    name: 'Anisotropic: shear (k=0.5)',
    offsets: transformedEuclideanOffsets(2.0, shearMatrix(0.5)),
    description:
      'Sheared neighborhood. Introduces diagonal drift — emergent ' + 'structures slip diagonally.',
    radius: 2.0,
    transform: shearMatrix(0.5),
  })
);

register(
  new Neighborhood({
    id: 'aniso_rot45_stretch',
    name: 'Anisotropic: rotated 45° elongation',
    offsets: transformedEuclideanOffsets(2.5, rotatedScaleMatrix(Math.PI / 4, 0.5, 1.0)),
    description:
      'Ellipse rotated 45° and elongated along that diagonal axis. ' +
      'Creates diagonal flow fields.',
    radius: 2.5,
    transform: rotatedScaleMatrix(Math.PI / 4, 0.5, 1.0),
  })
);

register(
  new Neighborhood({
    id: 'aniso_rot30_stretch',
    name: 'Anisotropic: rotated 30° elongation',
    offsets: transformedEuclideanOffsets(2.5, rotatedScaleMatrix(Math.PI / 6, 0.5, 1.0)),
    description: 'Ellipse rotated 30°. Asymmetric flow with subtle directional bias.',
    radius: 2.5,
    transform: rotatedScaleMatrix(Math.PI / 6, 0.5, 1.0),
  })
);

/**
 * Look up a neighborhood by id.
 * @param {string} id
 * @returns {Neighborhood|null}
 */
export function getNeighborhood(id) {
  return REGISTRY.get(id) || null;
}
// Expose a global hook so ruleset.js can validate neighbor counts
// without creating a circular import. This is safe because the module
// is loaded once and the registry is module-scoped.
if (typeof globalThis !== 'undefined') {
  globalThis.__getNeighborhood__ = getNeighborhood;
}

/**
 * List all registered neighborhoods.
 * @returns {Neighborhood[]}
 */
export function listNeighborhoods() {
  return Array.from(REGISTRY.values());
}

/**
 * Register a custom neighborhood.
 */
export function registerNeighborhood(nbhd) {
  REGISTRY.set(nbhd.id, nbhd);
  return nbhd;
}

/**
 * Build a Neighborhood from a fractional Euclidean radius.
 */
export function neighborhoodFromRadius(radius, id, name) {
  const offsets = euclideanOffsets(radius);
  return new Neighborhood({
    id: id || `eucl_${radius}`,
    name: name || `Euclidean r=${radius}`,
    offsets,
    description: `Fractional Euclidean radius ${radius} (${offsets.length} cells).`,
    radius,
  });
}

/**
 * Build a Neighborhood from a transform matrix.
 */
export function neighborhoodFromTransform(radius, T, id, name) {
  const offsets = transformedEuclideanOffsets(radius, T);
  return new Neighborhood({
    id: id || `aniso_${radius}`,
    name: name || `Anisotropic r=${radius}`,
    offsets,
    description: `Transformed Euclidean neighborhood (${offsets.length} cells).`,
    radius,
    transform: T,
  });
}
