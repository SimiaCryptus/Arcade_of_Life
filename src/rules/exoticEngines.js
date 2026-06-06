/**
 * Exotic rule engines for non-standard cellular automata.
 *
 * This module implements three exotic paradigms:
 *
 *   1. Teleological CA (TCA / MPCA)
 *      - Ambiguous rules with multiple candidate next states
 *      - Bounded lookahead simulation
 *      - Deterministic scoring + tie-breaking
 *
 *   2. Time-Integrated Rules
 *      - Weighted history window
 *      - Cells "remember" past states
 *      - Enables momentum, inertia, drag
 *
 *   3. Fractional Lightcones
 *      - Continuous spatial + temporal decay
 *      - Soft-boundary neighborhoods
 *      - Relativistic-like propagation
 *
 * All engines are deterministic: same input → same output.
 */

import { CompiledRuleset } from './ruleset.js';
import { getNeighborhood, MOORE_NEIGHBORHOOD } from './neighborhoods.js';

// ─────────────────────────────────────────────────────────────────────
// Scoring functions for TCA
// ─────────────────────────────────────────────────────────────────────

/**
 * Compute Shannon entropy of a cell grid as a measure of disorder.
 * Lower entropy = more structured. We use a coarse-grained version:
 * count live cells per K×K block and compute entropy of that distribution.
 *
 * @param {Uint8Array} cells
 * @param {number} w
 * @param {number} h
 * @param {number} cellType  Which cell type to score (e.g. DEFENSE)
 * @returns {number}  Entropy in nats (0 = maximally ordered)
 */
export function gridEntropy(cells, w, h, cellType = 1) {
  const blockSize = 4;
  const bw = Math.max(1, Math.ceil(w / blockSize));
  const bh = Math.max(1, Math.ceil(h / blockSize));
  const counts = new Uint16Array(bw * bh);
  let total = 0;
  for (let y = 0; y < h; y++) {
    const by = (y / blockSize) | 0;
    for (let x = 0; x < w; x++) {
      if (cells[y * w + x] === cellType) {
        const bx = (x / blockSize) | 0;
        counts[by * bw + bx]++;
        total++;
      }
    }
  }
  if (total === 0) return 0;
  let H = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] === 0) continue;
    const p = counts[i] / total;
    H -= p * Math.log(p);
  }
  return H;
}

/**
 * Score grid by symmetry. Returns a value in [0, 1] where 1 is
 * perfectly symmetric (both horizontal and vertical bilateral).
 */
export function gridSymmetry(cells, w, h, cellType = 1) {
  let matchH = 0,
    totalH = 0;
  let matchV = 0,
    totalV = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < ((w / 2) | 0); x++) {
      const a = cells[y * w + x] === cellType;
      const b = cells[y * w + (w - 1 - x)] === cellType;
      if (a || b) {
        totalH++;
        if (a === b) matchH++;
      }
    }
  }
  for (let y = 0; y < ((h / 2) | 0); y++) {
    for (let x = 0; x < w; x++) {
      const a = cells[y * w + x] === cellType;
      const b = cells[(h - 1 - y) * w + x] === cellType;
      if (a || b) {
        totalV++;
        if (a === b) matchV++;
      }
    }
  }
  const sH = totalH > 0 ? matchH / totalH : 1;
  const sV = totalV > 0 ? matchV / totalV : 1;
  return (sH + sV) / 2;
}

/**
 * Score grid by population persistence. Higher = more cells alive.
 */
export function gridPopulation(cells, w, h, cellType = 1) {
  let n = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === cellType) n++;
  }
  return n;
}

/**
 * Score grid by glider-likeness: count of small, isolated, moving clusters.
 * Approximates by counting connected components of size 3-7.
 */
export function gridGliderScore(cells, w, h, cellType = 1) {
  const visited = new Uint8Array(w * h);
  let score = 0;
  const stack = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (cells[i] !== cellType || visited[i]) continue;
      // BFS to find component size.
      let size = 0;
      stack.length = 0;
      stack.push(i);
      visited[i] = 1;
      while (stack.length > 0 && size < 20) {
        const idx = stack.pop();
        size++;
        const cy = (idx / w) | 0;
        const cx = idx - cy * w;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = cy + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = (cx + dx + w) % w;
            const ni = ny * w + nx;
            if (cells[ni] === cellType && !visited[ni]) {
              visited[ni] = 1;
              stack.push(ni);
            }
          }
        }
      }
      // Reward clusters in the glider/small-spaceship size range.
      if (size >= 3 && size <= 7) score += 1;
    }
  }
  return score;
}

/**
 * Built-in TCA scoring objectives. Each returns a number; higher is better.
 */
export const TCA_OBJECTIVES = {
  entropy_min: {
    name: 'Entropy Minimization',
    description: 'Reward structured, organized patterns. Discourages chaos.',
    score: (cells, w, h, cellType) => -gridEntropy(cells, w, h, cellType),
  },
  symmetry_max: {
    name: 'Symmetry Maximization',
    description: 'Reward bilateral symmetry. Patterns drift toward elegance.',
    score: (cells, w, h, cellType) => gridSymmetry(cells, w, h, cellType),
  },
  survival: {
    name: 'Survival',
    description: 'Maximize live cell count. Patterns self-preserve and dodge death.',
    score: (cells, w, h, cellType) => gridPopulation(cells, w, h, cellType),
  },
  glider_max: {
    name: 'Glider Maximization',
    description: 'Reward formation of small, coherent moving clusters.',
    score: (cells, w, h, cellType) => gridGliderScore(cells, w, h, cellType),
  },
  composite: {
    name: 'Composite (structure + survival)',
    description: 'Balanced objective: rewards structure, symmetry, and persistence.',
    score: (cells, w, h, cellType) => {
      const pop = gridPopulation(cells, w, h, cellType);
      const sym = gridSymmetry(cells, w, h, cellType);
      const ent = gridEntropy(cells, w, h, cellType);
      // Normalize population by grid area.
      const popNorm = pop / (w * h);
      return popNorm * 0.3 + sym * 0.5 - ent * 0.1;
    },
  },
};

// ─────────────────────────────────────────────────────────────────────
// TCA (Teleological CA) Engine
// ─────────────────────────────────────────────────────────────────────

/**
 * A TCA rule has multiple "proposal" sub-rules. Each proposal is itself
 * a standard B/S rule that yields a candidate next state. The engine
 * simulates `lookahead` steps for each candidate, scores the resulting
 * states with the objective function, and commits to the best one.
 *
 * @typedef {Object} TCARuleDef
 * @property {string}   id
 * @property {string}   name
 * @property {string}   description
 * @property {Array}    proposals   Array of {birth, survival, label?}
 * @property {string}   objective   Key into TCA_OBJECTIVES, or function
 * @property {number}   lookahead   Generations to simulate per proposal
 * @property {string}   [neighborhood]  Default 'moore'
 * @property {string}   [tiebreak]  'first' | 'lex' (default 'lex')
 */

/**
 * Compile a TCA rule definition. Returns a callable engine.
 */
export class TCACompiledRule {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.description = def.description || '';
    this.notation = `TCA[${def.proposals.length} props, d=${def.lookahead}]`;
    this.proposals = def.proposals.map((p) => ({
      ...p,
      compiled: new CompiledRuleset({
        id: `${def.id}_prop`,
        name: p.label || 'proposal',
        notation: '',
        description: '',
        birth: p.birth,
        survival: p.survival,
        neighborhood: def.neighborhood || 'moore',
      }),
    }));
    const nbhdId = def.neighborhood || 'moore';
    this.neighborhood = getNeighborhood(nbhdId) || MOORE_NEIGHBORHOOD;
    this.lookahead = Math.max(1, def.lookahead | 0);
    this.tiebreak = def.tiebreak || 'lex';
    // Resolve objective function.
    if (typeof def.objective === 'function') {
      this.objectiveFn = def.objective;
      this.objectiveName = 'custom';
    } else {
      const obj = TCA_OBJECTIVES[def.objective || 'composite'];
      this.objectiveFn = obj.score;
      this.objectiveName = obj.name;
    }
    // Mark as TCA for the simulation engine.
    this.isTCA = true;
    // These tables exist so code that does feature-detection on
    // CompiledRuleset (shouldBirth/shouldSurvive) doesn't crash.
    // We delegate to the first proposal for any direct queries.
    this.birthTable = this.proposals[0].compiled.birthTable;
    this.survivalTable = this.proposals[0].compiled.survivalTable;
  }
  shouldBirth(n) {
    return this.proposals[0].compiled.shouldBirth(n);
  }
  shouldSurvive(n) {
    return this.proposals[0].compiled.shouldSurvive(n);
  }
}

/**
 * Apply one Life step given a CompiledRuleset and a flat cell array.
 * Only considers DEFENSE-vs-empty (cell type 1). Used internally by
 * the TCA lookahead simulator on scratch buffers.
 *
 * @param {Uint8Array} cells   Input (cellType used as 1=alive)
 * @param {Uint8Array} out     Output buffer
 * @param {number} w
 * @param {number} h
 * @param {CompiledRuleset} rule
 */
export function stepLifeScratch(cells, out, w, h, rule) {
  out.fill(0);
  const offsets = rule.neighborhood.offsets;
  const nOff = offsets.length;
  for (let y = 0; y < h; y++) {
    const rowBase = y * w;
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let k = 0; k < nOff; k++) {
        const dx = offsets[k][0];
        const dy = offsets[k][1];
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        let nx = x + dx;
        if (nx < 0) nx = ((nx % w) + w) % w;
        else if (nx >= w) nx = nx % w;
        if (cells[ny * w + nx]) n++;
      }
      const i = rowBase + x;
      const alive = cells[i];
      let next;
      if (alive) next = rule.shouldSurvive(n) ? 1 : 0;
      else next = rule.shouldBirth(n) ? 1 : 0;
      out[i] = next;
    }
  }
}

/**
 * Lexicographically compare two Uint8Arrays. Returns -1/0/1.
 */
export function lexCompare(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return 0;
}

/**
 * Run a TCA rule for one step on a flat cell array (1=alive, 0=dead).
 * Mutates `target` to hold the chosen next state.
 *
 * This is the core deterministic engine: it generates all proposal
 * trajectories, simulates them for `lookahead` steps, scores the
 * final states, and picks the best.
 */
export function runTCAStep(tcaRule, cells, target, w, h) {
  const n = w * h;
  const proposals = tcaRule.proposals;
  const lookahead = tcaRule.lookahead;
  // Allocate scratch buffers: 2 per proposal (current + next).
  // Reuse via static cache on the rule object to avoid GC churn.
  if (!tcaRule._scratch || tcaRule._scratch[0].length !== n) {
    tcaRule._scratch = proposals.map(() => [new Uint8Array(n), new Uint8Array(n)]);
    tcaRule._finals = proposals.map(() => new Uint8Array(n));
  }
  // For each proposal: simulate `lookahead` steps from current state.
  for (let p = 0; p < proposals.length; p++) {
    const [bufA, bufB] = tcaRule._scratch[p];
    bufA.set(cells);
    let cur = bufA,
      nxt = bufB;
    for (let step = 0; step < lookahead; step++) {
      stepLifeScratch(cur, nxt, w, h, proposals[p].compiled);
      const t = cur;
      cur = nxt;
      nxt = t;
    }
    // `cur` now holds the state at t + lookahead.
    tcaRule._finals[p].set(cur);
  }
  // Score each final state.
  let bestIdx = 0;
  let bestScore = tcaRule.objectiveFn(tcaRule._finals[0], w, h, 1);
  for (let p = 1; p < proposals.length; p++) {
    const s = tcaRule.objectiveFn(tcaRule._finals[p], w, h, 1);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = p;
    } else if (s === bestScore) {
      // Tie-break.
      if (tcaRule.tiebreak === 'lex') {
        // Compare final states lexicographically; lower wins
        // (deterministic, reproducible).
        if (lexCompare(tcaRule._finals[p], tcaRule._finals[bestIdx]) < 0) {
          bestIdx = p;
        }
      }
      // 'first': keep bestIdx unchanged (first proposal wins).
    }
  }
  // Apply the winning proposal to the actual target buffer.
  stepLifeScratch(cells, target, w, h, proposals[bestIdx].compiled);
}

// ─────────────────────────────────────────────────────────────────────
// Time-Integrated Rules
// ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} TimeIntegratedRuleDef
 * @property {string}   id
 * @property {string}   name
 * @property {string}   description
 * @property {number[]} birth
 * @property {number[]} survival
 * @property {number}   windowSize       History depth (e.g. 3)
 * @property {number[]} [temporalWeights] Defaults to exponential decay
 * @property {number}   [threshold]      Memory threshold for activation
 * @property {string}   [neighborhood]
 */

/**
 * Compile a time-integrated rule. The engine stores a rolling history
 * of past grid states and computes neighbor counts using a weighted
 * sum over the temporal window.
 */
export class TimeIntegratedRule {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.description = def.description || '';
    this.windowSize = Math.max(1, def.windowSize | 0);
    // Default exponential decay: w_τ = 0.5^τ.
    const defaults = [];
    for (let i = 0; i < this.windowSize; i++) {
      defaults.push(Math.pow(0.5, i));
    }
    this.weights =
      def.temporalWeights && def.temporalWeights.length >= this.windowSize
        ? def.temporalWeights.slice(0, this.windowSize)
        : defaults;
    this.threshold = def.threshold != null ? def.threshold : 0.5;
    this.notation = `B${def.birth.join('')}/S${def.survival.join('')} w=${this.windowSize}`;
    this.birthSet = new Set(def.birth);
    this.survivalSet = new Set(def.survival);
    const nbhdId = def.neighborhood || 'moore';
    this.neighborhood = getNeighborhood(nbhdId) || MOORE_NEIGHBORHOOD;
    this.isTimeIntegrated = true;
    this.history = []; // ring buffer of past states (Uint8Array)
    // For feature-detection compatibility.
    this.birthTable = new Uint8Array(this.neighborhood.size + 1);
    this.survivalTable = new Uint8Array(this.neighborhood.size + 1);
    for (const n of def.birth) this.birthTable[n] = 1;
    for (const n of def.survival) this.survivalTable[n] = 1;
  }
  shouldBirth(n) {
    return this.birthTable[n] === 1;
  }
  shouldSurvive(n) {
    return this.survivalTable[n] === 1;
  }

  /**
   * Record current state into the history ring buffer.
   */
  pushHistory(cells) {
    // Deep copy (small price for determinism).
    const snapshot = new Uint8Array(cells.length);
    snapshot.set(cells);
    this.history.unshift(snapshot);
    if (this.history.length > this.windowSize) {
      this.history.length = this.windowSize;
    }
  }

  /**
   * Compute the time-integrated state H(x, y) = Σ w_τ S_{t-τ}(x, y).
   * Cells with H >= threshold are treated as "alive" for rule purposes.
   */
  computeHistoryField(out, n) {
    out.fill(0);
    for (let τ = 0; τ < this.history.length; τ++) {
      const w_τ = this.weights[τ];
      const snap = this.history[τ];
      for (let i = 0; i < n; i++) {
        if (snap[i]) out[i] += w_τ * 255; // scale to integer-ish
      }
    }
  }
}

/**
 * Apply one step of a time-integrated rule. Reads cells, writes target.
 */
export function runTimeIntegratedStep(rule, cells, target, w, h) {
  const n = w * h;
  // Push current state into history BEFORE evaluating.
  rule.pushHistory(cells);
  // Compute integrated field.
  if (!rule._histField || rule._histField.length !== n) {
    rule._histField = new Float32Array(n);
  }
  const H = rule._histField;
  H.fill(0);
  for (let τ = 0; τ < rule.history.length; τ++) {
    const w_τ = rule.weights[τ];
    const snap = rule.history[τ];
    for (let i = 0; i < n; i++) {
      if (snap[i]) H[i] += w_τ;
    }
  }
  // Normalize threshold to total weight.
  let totalW = 0;
  for (const w_τ of rule.weights) totalW += w_τ;
  const thresh = rule.threshold * totalW;
  // Compute "effective alive" mask from history field.
  if (!rule._effMask || rule._effMask.length !== n) {
    rule._effMask = new Uint8Array(n);
  }
  const eff = rule._effMask;
  for (let i = 0; i < n; i++) {
    eff[i] = H[i] >= thresh ? 1 : 0;
  }
  // Run Life on the effective mask.
  target.fill(0);
  const offsets = rule.neighborhood.offsets;
  const nOff = offsets.length;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let neighborCount = 0;
      for (let k = 0; k < nOff; k++) {
        const dx = offsets[k][0];
        const dy = offsets[k][1];
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        let nx = x + dx;
        if (nx < 0) nx = ((nx % w) + w) % w;
        else if (nx >= w) nx = nx % w;
        if (eff[ny * w + nx]) neighborCount++;
      }
      const i = y * w + x;
      const alive = eff[i];
      let next;
      if (alive) next = rule.shouldSurvive(neighborCount) ? 1 : 0;
      else next = rule.shouldBirth(neighborCount) ? 1 : 0;
      target[i] = next;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Fractional Lightcone Rules
// ─────────────────────────────────────────────────────────────────────

/**
 * A fractional lightcone rule combines spatial decay (within a
 * neighborhood) and temporal decay (over a history window) into a
 * continuous influence kernel:
 *
 *   I(d, τ) ∝ exp(-(α·d + β·τ))
 *
 * Each cell's "influence sum" is the weighted contribution of all
 * cells in its spatiotemporal lightcone. Cells with influence ≥
 * threshold fire (birth) or persist (survival) under thresholded
 * rules.
 *
 * @typedef {Object} FractionalLightconeRuleDef
 * @property {string}   id
 * @property {string}   name
 * @property {string}   description
 * @property {number}   spatialRadius    Maximum neighborhood radius
 * @property {number}   alpha            Spatial decay rate
 * @property {number}   beta             Temporal decay rate
 * @property {number}   windowSize       History depth
 * @property {number[]} birthThresholds  Influence thresholds for birth (e.g. [2.5, 4.0])
 * @property {number[]} survivalThresholds Influence thresholds for survival
 */

export class FractionalLightconeRule {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.description = def.description || '';
    this.spatialRadius = def.spatialRadius || 2.0;
    this.alpha = def.alpha != null ? def.alpha : 0.8;
    this.beta = def.beta != null ? def.beta : 0.5;
    this.windowSize = Math.max(1, def.windowSize | 0);
    this.birthMin = def.birthMin != null ? def.birthMin : 2.5;
    this.birthMax = def.birthMax != null ? def.birthMax : 3.5;
    this.survivalMin = def.survivalMin != null ? def.survivalMin : 1.8;
    this.survivalMax = def.survivalMax != null ? def.survivalMax : 4.0;
    this.notation = `LC[r=${this.spatialRadius},α=${this.alpha},β=${this.beta},w=${this.windowSize}]`;
    this.isFractionalLightcone = true;
    // Precompute spatial decay kernel: list of (dx, dy, weight) tuples.
    this.kernel = [];
    const r = this.spatialRadius;
    const rCeil = Math.ceil(r);
    for (let dy = -rCeil; dy <= rCeil; dy++) {
      for (let dx = -rCeil; dx <= rCeil; dx++) {
        if (dx === 0 && dy === 0) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r + 1e-9) continue;
        this.kernel.push([dx, dy, Math.exp(-this.alpha * d)]);
      }
    }
    // Precompute temporal weights.
    this.temporalWeights = [];
    for (let τ = 0; τ < this.windowSize; τ++) {
      this.temporalWeights.push(Math.exp(-this.beta * τ));
    }
    // Total possible weight, for normalization.
    let kernelSum = 0;
    for (const [, , w] of this.kernel) kernelSum += w;
    let tempSum = 0;
    for (const w of this.temporalWeights) tempSum += w;
    this.maxInfluence = kernelSum * tempSum;
    // History buffer.
    this.history = [];
    // Stub neighborhood for compatibility (just for size-based UI hints).
    this.neighborhood = {
      id: 'fractional_lightcone',
      name: `Lightcone r=${this.spatialRadius}`,
      size: this.kernel.length,
      offsets: this.kernel.map(([x, y]) => [x, y]),
    };
    // Stub tables for compatibility.
    this.birthTable = new Uint8Array(this.kernel.length + 2);
    this.survivalTable = new Uint8Array(this.kernel.length + 2);
  }
  shouldBirth() {
    return false;
  } // unused; engine uses thresholds
  shouldSurvive() {
    return false;
  }

  pushHistory(cells) {
    const snapshot = new Uint8Array(cells.length);
    snapshot.set(cells);
    this.history.unshift(snapshot);
    if (this.history.length > this.windowSize) {
      this.history.length = this.windowSize;
    }
  }
}

/**
 * Apply one step of a fractional lightcone rule.
 */
export function runFractionalLightconeStep(rule, cells, target, w, h) {
  const n = w * h;
  rule.pushHistory(cells);
  // For each cell, sum spatiotemporal influence from neighbors.
  if (!rule._influence || rule._influence.length !== n) {
    rule._influence = new Float32Array(n);
  }
  const inf = rule._influence;
  inf.fill(0);
  const kernel = rule.kernel;
  const tempWeights = rule.temporalWeights;
  const hist = rule.history;
  for (let τ = 0; τ < hist.length; τ++) {
    const w_τ = tempWeights[τ];
    const snap = hist[τ];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const baseIdx = y * w + x;
        // Sum influences from neighbors at this temporal slice.
        // (We accumulate INTO this cell from its neighbors.)
        for (let k = 0; k < kernel.length; k++) {
          const dx = kernel[k][0];
          const dy = kernel[k][1];
          const kw = kernel[k][2];
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          let nx = x + dx;
          if (nx < 0) nx = ((nx % w) + w) % w;
          else if (nx >= w) nx = nx % w;
          if (snap[ny * w + nx]) {
            inf[baseIdx] += kw * w_τ;
          }
        }
      }
    }
  }
  // Apply thresholded rules.
  target.fill(0);
  const bMin = rule.birthMin;
  const bMax = rule.birthMax;
  const sMin = rule.survivalMin;
  const sMax = rule.survivalMax;
  for (let i = 0; i < n; i++) {
    const alive = cells[i];
    const I = inf[i];
    let next;
    if (alive) {
      next = I >= sMin && I <= sMax ? 1 : 0;
    } else {
      next = I >= bMin && I <= bMax ? 1 : 0;
    }
    target[i] = next;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Unified exotic rule registry
// ─────────────────────────────────────────────────────────────────────

const EXOTIC_REGISTRY = new Map();

/**
 * Register an exotic rule. Types: 'tca' | 'time_integrated' | 'fractional_lightcone'.
 */
export function registerExoticRule(type, def) {
  let compiled;
  switch (type) {
    case 'tca':
      compiled = new TCACompiledRule(def);
      break;
    case 'time_integrated':
      compiled = new TimeIntegratedRule(def);
      break;
    case 'fractional_lightcone':
      compiled = new FractionalLightconeRule(def);
      break;
    default:
      throw new Error(`Unknown exotic rule type: ${type}`);
  }
  EXOTIC_REGISTRY.set(def.id, { type, compiled, def });
  return compiled;
}

export function getExoticRule(id) {
  return EXOTIC_REGISTRY.get(id) || null;
}

export function listExoticRules() {
  return Array.from(EXOTIC_REGISTRY.values());
}

export function isExoticRule(id) {
  return EXOTIC_REGISTRY.has(id);
}

/**
 * Dispatch one step for any exotic rule type. Reads `cells`, writes `target`.
 */
export function runExoticStep(compiled, cells, target, w, h) {
  if (compiled.isTCA) {
    runTCAStep(compiled, cells, target, w, h);
  } else if (compiled.isTimeIntegrated) {
    runTimeIntegratedStep(compiled, cells, target, w, h);
  } else if (compiled.isFractionalLightcone) {
    runFractionalLightconeStep(compiled, cells, target, w, h);
  } else {
    throw new Error('Unknown exotic rule kind');
  }
}

/**
 * Reset any internal state (history buffers) on an exotic rule.
 * Call when the grid is rebuilt or game restarts.
 */
export function resetExoticState(compiled) {
  if (compiled.history) compiled.history.length = 0;
}

// ─────────────────────────────────────────────────────────────────────
// Built-in exotic rules
// ─────────────────────────────────────────────────────────────────────

// ── TCA examples ──

registerExoticRule('tca', {
  id: 'tca_survivor',
  name: 'TCA: Survivor',
  description:
    'Teleological Life with 3 proposals (Conway, HighLife, DryLife). ' +
    'Lookahead picks whichever variant maximizes population persistence. ' +
    'Patterns actively "dodge" destruction.',
  proposals: [
    { label: 'Conway', birth: [3], survival: [2, 3] },
    { label: 'HighLife', birth: [3, 6], survival: [2, 3] },
    { label: 'DryLife', birth: [3, 7], survival: [2, 3] },
  ],
  objective: 'survival',
  lookahead: 3,
  tiebreak: 'lex',
});

registerExoticRule('tca', {
  id: 'tca_aesthetic',
  name: 'TCA: Aesthetic',
  description:
    'Three Conway-like proposals scored by composite structure+symmetry. ' +
    'Patterns drift toward beautiful, symmetric configurations.',
  proposals: [
    { label: 'Conway', birth: [3], survival: [2, 3] },
    { label: 'B36/S23', birth: [3, 6], survival: [2, 3] },
    { label: 'B3/S234', birth: [3], survival: [2, 3, 4] },
  ],
  objective: 'composite',
  lookahead: 4,
  tiebreak: 'lex',
});

registerExoticRule('tca', {
  id: 'tca_glider_seeker',
  name: 'TCA: Glider Seeker',
  description:
    'TCA tuned to reward small, glider-like clusters. The system ' +
    'preferentially evolves toward states rich in spaceships.',
  proposals: [
    { label: 'Conway', birth: [3], survival: [2, 3] },
    { label: 'HighLife', birth: [3, 6], survival: [2, 3] },
    { label: 'Move', birth: [3, 6, 8], survival: [2, 4, 5] },
  ],
  objective: 'glider_max',
  lookahead: 3,
  tiebreak: 'lex',
});

registerExoticRule('tca', {
  id: 'tca_minimal',
  name: 'TCA: Minimal Entropy',
  description:
    'Two-proposal TCA scored by entropy minimization. Patterns ' +
    'collapse toward highly ordered, low-entropy structures.',
  proposals: [
    { label: 'Conway', birth: [3], survival: [2, 3] },
    { label: 'Maze', birth: [3], survival: [1, 2, 3, 4, 5] },
  ],
  objective: 'entropy_min',
  lookahead: 3,
  tiebreak: 'lex',
});

// ── Time-integrated examples ──

registerExoticRule('time_integrated', {
  id: 'ti_momentum',
  name: 'Time-Integrated: Momentum',
  description:
    'Conway with 3-tick memory window. Cells "remember" recent ' +
    'activity, creating momentum and inertia in pattern movement.',
  birth: [3],
  survival: [2, 3],
  windowSize: 3,
  temporalWeights: [1.0, 0.6, 0.3],
  threshold: 0.4,
  neighborhood: 'moore',
});

registerExoticRule('time_integrated', {
  id: 'ti_persistence',
  name: 'Time-Integrated: Persistence',
  description:
    'Long 5-tick memory. Past states heavily influence the present. ' +
    'Patterns leave "ghost trails" and feel sticky.',
  birth: [3, 4],
  survival: [2, 3, 4],
  windowSize: 5,
  temporalWeights: [1.0, 0.8, 0.6, 0.4, 0.2],
  threshold: 0.5,
  neighborhood: 'moore',
});

registerExoticRule('time_integrated', {
  id: 'ti_drag',
  name: 'Time-Integrated: Drag',
  description:
    'Short 2-tick memory creates a "drag" effect. Spaceships slow ' +
    'down; oscillators get a subtle echo.',
  birth: [3],
  survival: [2, 3],
  windowSize: 2,
  temporalWeights: [1.0, 0.5],
  threshold: 0.55,
  neighborhood: 'moore',
});

// ── Fractional lightcone examples ──

registerExoticRule('fractional_lightcone', {
  id: 'flc_relativistic',
  name: 'Lightcone: Relativistic',
  description:
    'Continuous spatial + temporal decay. Influence falls off ' +
    'smoothly with distance AND time. Feels like a discretized PDE.',
  spatialRadius: 2.0,
  alpha: 0.7,
  beta: 0.5,
  windowSize: 3,
  birthMin: 1.8,
  birthMax: 3.0,
  survivalMin: 1.0,
  survivalMax: 3.5,
});

registerExoticRule('fractional_lightcone', {
  id: 'flc_diffusive',
  name: 'Lightcone: Diffusive',
  description:
    'Larger spatial radius with strong decay. Patterns blur and ' +
    'diffuse outward like heat. Hard for stable structures to form.',
  spatialRadius: 3.0,
  alpha: 1.2,
  beta: 0.3,
  windowSize: 4,
  birthMin: 2.0,
  birthMax: 3.5,
  survivalMin: 1.5,
  survivalMax: 4.0,
});

registerExoticRule('fractional_lightcone', {
  id: 'flc_compact',
  name: 'Lightcone: Compact',
  description:
    'Sharp spatial decay, no temporal history. Approximates classic ' +
    'Life with soft neighborhood edges.',
  spatialRadius: 1.5,
  alpha: 1.5,
  beta: 10.0, // effectively no temporal contribution
  windowSize: 1,
  birthMin: 2.3,
  birthMax: 2.8,
  survivalMin: 1.5,
  survivalMax: 2.8,
});
