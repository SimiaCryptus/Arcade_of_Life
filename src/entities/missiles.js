import { CONFIG, CELL_TYPE } from '../config.js';

// Glider pattern definitions. Each is a list of [dx, dy] offsets from a spawn anchor.
// SE = R-type (Conway glider moving south-east)
const SE_GLIDER = [
  [1, 0],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
];
// SW = L-type (mirrored Conway glider moving south-west)
const SW_GLIDER = [
  [1, 0],
  [0, 1],
  [0, 2],
  [1, 2],
  [2, 2],
];
// NOTE: Heavy descenders were removed; the GLIDER_HEAVY flag now spawns
// stationary TARGET emplacements instead (see Missiles.spawnTarget).
// A target is a small stable block of MISSILE cells that periodically
// emits gliders downward and refuses to die from Life rules. It only
// disappears when the player destroys it with defenses.
const TARGET_PATTERN = [
  [1, 0],
  [2, 0],
  [0, 1],
  [3, 1],
  [0, 2],
  [3, 2],
  [1, 3],
  [2, 3],
];
// Lightweight Spaceship variants — true GoL spaceships, traveling diagonally downward.
// LWSS-SE: travels southeast
const LWSS_SE = [
  [0, 0],
  [3, 0],
  [4, 1],
  [0, 2],
  [4, 2],
  [1, 3],
  [2, 3],
  [3, 3],
  [4, 3],
];
// LWSS-SW: mirrored, travels southwest
const LWSS_SW = [
  [1, 0],
  [4, 0],
  [0, 1],
  [0, 2],
  [4, 2],
  [0, 3],
  [1, 3],
  [2, 3],
  [3, 3],
];
// Middleweight Spaceship variants
const MWSS_SE = [
  [0, 0],
  [3, 0],
  [4, 1],
  [0, 2],
  [4, 2],
  [4, 3],
  [1, 4],
  [2, 4],
  [3, 4],
  [4, 4],
];
const MWSS_SW = [
  [1, 0],
  [4, 0],
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [1, 4],
  [2, 4],
  [3, 4],
];
// Twin glider: two SE gliders side-by-side for synchronized attacks.
const TWIN_GLIDER = [
  [1, 0],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
  [6, 0],
  [7, 1],
  [5, 2],
  [6, 2],
  [7, 2],
];
// Mini glider gun: a compact Gosper Glider Gun. Plants itself near the top
// of the playfield and produces gliders that descend toward the cities.
// This is the standard 36x9 Gosper Gun (offsets [dx, dy]).
const GOSPER_GUN = [
  [24, 0],
  [22, 1],
  [24, 1],
  [12, 2],
  [13, 2],
  [20, 2],
  [21, 2],
  [34, 2],
  [35, 2],
  [11, 3],
  [15, 3],
  [20, 3],
  [21, 3],
  [34, 3],
  [35, 3],
  [0, 4],
  [1, 4],
  [10, 4],
  [16, 4],
  [20, 4],
  [21, 4],
  [0, 5],
  [1, 5],
  [10, 5],
  [14, 5],
  [16, 5],
  [17, 5],
  [22, 5],
  [24, 5],
  [10, 6],
  [16, 6],
  [24, 6],
  [11, 7],
  [15, 7],
  [12, 8],
  [13, 8],
];

// ============================================================
// BASE PATTERNS — placed in the base zone. Two flavors:
//   STATIC: small block of MISSILE cells, re-imprinted each tick so
//           Life rules can't kill them. Periodically emit gliders.
//   HORIZONTAL: true GoL spaceships that travel ONLY left or right
//           (no diagonal motion). We use LWSS rotated 90° so they
//           glide horizontally across the base zone.
// ============================================================

// Fortress: 4x4 block emplacement (same as legacy TARGET_PATTERN).
const FORTRESS_PATTERN = TARGET_PATTERN;

// Bunker: smaller 3x3 still-life-ish block (pre-stamped, re-imprinted).
const BUNKER_PATTERN = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, 1],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
];

// Horizontal Lightweight Spaceship moving EAST (right).
// This is the standard LWSS rotated so it travels +x.
// Pattern is 5 wide x 4 tall; signature: missing corners + tail bit.
const CRUISER_E = [
  [1, 0],
  [2, 0],
  [3, 0],
  [4, 0],
  [0, 1],
  [4, 1],
  [4, 2],
  [0, 3],
  [3, 3],
];

// Horizontal LWSS moving WEST (left) — mirror of CRUISER_E.
const CRUISER_W = [
  [0, 0],
  [1, 0],
  [2, 0],
  [3, 0],
  [0, 1],
  [4, 1],
  [0, 2],
  [1, 3],
  [4, 3],
];

// Direction constants for cell direction tracking.
const DIR_DOWN = 1;
const DIR_EAST = 3;
const DIR_WEST = 4;

/**
 * Missiles are spawned as small downward-moving patterns at the top of the grid.
 * Glider type and direction are chosen from the currently-enabled set in CONFIG.
 */
export class Missiles {
  constructor(grid) {
    this.grid = grid;
    this.spawnCooldown = 0;
    this.toSpawn = 0;
    this.spawned = 0;
    this.spawnInterval = CONFIG.MISSILE_SPAWN_INTERVAL;
    // Track recent spawn positions so we can avoid spawning gliders too
    // close together (which causes them to collide mid-air, producing
    // debris that drifts upward and gets misclassified as return-fire).
    this.recentSpawns = []; // [{x, y, ttl}]
    // Optional callback for spawn FX: (anchorX, anchorY, patternW, patternH) => void
    this.onMissileSpawn = null;
    // Active "target" emplacements: stationary missile structures that
    // periodically emit gliders until destroyed by the player. Each:
    // { x, y, w, h, emitCooldown, hp, alive }
    this.targets = [];
    // Optional FX callbacks for targets.
    this.onTargetSpawn = null; // (cx, cy) => void
    this.onTargetDestroyed = null; // (cx, cy) => void
    // When true, enemy missile spawning + target emission is paused.
    // Set by Time Stop ability. Defenses are unaffected.
    this.frozen = false;
    // Bases placed in the base zone. Each:
    //   { kind, x, y, w, h, pattern, alive, emitCooldown?, mover? }
    // Static bases have a pattern + emit cooldown; horizontal cruisers
    // move sideways via custom logic (Life rules would let them age out).
    this.bases = [];
    // FX callbacks for bases (reuse target callbacks if present).
    this.onBaseSpawn = null;
    this.onBaseDestroyed = null;
    // Custom level support: designer-placed bases and spawners.
    // _customBases: [{patternId, name, x, y, width, height, cells:[[dx,dy],...]}]
    // _customSpawners: same shape but emit missiles periodically
    this._customBases = [];
    this._customSpawners = [];
    // Active "designed" bases (stamped from _customBases on startWave).
    // Each: { patternId, name, x, y, w, h, cells, alive }
    this._designedBases = [];
    // Active "designed" spawners. Each:
    //   { patternId, name, x, y, w, h, cells, interval, cooldown, alive }
    this._designedSpawners = [];
  }
  /**
   * Provide designer-placed base specs to be stamped at wave start.
   * Each spec: {patternId, name, x, y, width, height, cells:[[dx,dy],...]}
   */
  setCustomBases(bases) {
    this._customBases = Array.isArray(bases) ? bases.slice() : [];
  }
  /**
   * Provide designer-placed spawner specs to be stamped at wave start.
   * Each spec: {patternId, name, x, y, width, height, cells, interval}
   */
  setCustomSpawners(spawners) {
    this._customSpawners = Array.isArray(spawners) ? spawners.slice() : [];
  }
  hasCustomContent() {
    return this._customBases.length > 0 || this._customSpawners.length > 0;
  }

  startWave(waveNum) {
    this.toSpawn = CONFIG.MISSILES_PER_WAVE_BASE + waveNum * CONFIG.MISSILES_PER_WAVE_INC;
    this.spawned = 0;
    this.spawnInterval = Math.max(
      CONFIG.MISSILE_SPAWN_MIN,
      CONFIG.MISSILE_SPAWN_INTERVAL - waveNum * CONFIG.MISSILE_SPAWN_DECREMENT
    );
    this.spawnCooldown = 300;
    this.recentSpawns = [];
    this.targets = [];
    this.bases = [];
    this._designedBases = [];
    this._designedSpawners = [];
    // Spawn designer-placed bases & spawners first (they override default).
    this._spawnDesignedBases();
    this._spawnDesignedSpawners();
    // Spawn the wave's default bases up front (only if no custom content).
    if (!this.hasCustomContent()) {
      this._spawnBasesForWave(waveNum);
    }
  }
  // Stamp designer-placed bases as persistent MISSILE-cell structures
  // that re-imprint each tick. Destroying them is required to clear the wave.
  _spawnDesignedBases() {
    if (this._customBases.length === 0) return;
    const g = this.grid;
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    for (const spec of this._customBases) {
      if (!Array.isArray(spec.cells) || spec.cells.length === 0) continue;
      // First, clear the entire footprint area (including a 1-cell halo)
      // so we don't have residual state interfering with our pattern.
      for (let dy = -1; dy <= spec.height; dy++) {
        for (let dx = -1; dx <= spec.width; dx++) {
          const px = spec.x + dx;
          const py = spec.y + dy;
          if (!g.inBounds(px, py)) continue;
          const i = py * g.width + g.wrapX(px);
          // Don't clear cities.
          if (g.cells[i] === CELL_TYPE.CITY) continue;
          g.cells[i] = CELL_TYPE.EMPTY;
          g.cellAge[i] = 0;
          g.cellDir[i] = 0;
        }
      }
      // Now stamp cells onto the grid.
      for (const [dx, dy] of spec.cells) {
        const px = spec.x + dx;
        const py = spec.y + dy;
        if (!g.inBounds(px, py)) continue;
        g.set(px, py, CELL_TYPE.MISSILE);
        const i = py * g.width + g.wrapX(px);
        g.cellColor[i] = (i * 7) % variants;
        g.cellDir[i] = 0; // stationary
        g.cellAge[i] = 0;
      }
      const designed = {
        patternId: spec.patternId,
        name: spec.name || spec.patternId,
        x: spec.x,
        y: spec.y,
        w: spec.width,
        h: spec.height,
        cells: spec.cells.map(([dx, dy]) => [dx, dy]),
        alive: true,
        _damage: 0,
      };
      this._designedBases.push(designed);
      if (this.onBaseSpawn) {
        this.onBaseSpawn(spec.x + spec.width / 2, spec.y + spec.height / 2, 'designed');
      }
    }
  }
  // Initialize designer-placed spawners. They will emit missiles based
  // on their pattern at the configured interval.
  _spawnDesignedSpawners() {
    if (this._customSpawners.length === 0) return;
    const g = this.grid;
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    for (const spec of this._customSpawners) {
      if (!Array.isArray(spec.cells) || spec.cells.length === 0) continue;
      const interval = spec.interval > 0 ? spec.interval : 2000;
      // Clear footprint + halo and stamp the pattern.
      for (let dy = -1; dy <= spec.height; dy++) {
        for (let dx = -1; dx <= spec.width; dx++) {
          const px = spec.x + dx;
          const py = spec.y + dy;
          if (!g.inBounds(px, py)) continue;
          const i = py * g.width + g.wrapX(px);
          if (g.cells[i] === CELL_TYPE.CITY) continue;
          g.cells[i] = CELL_TYPE.EMPTY;
          g.cellAge[i] = 0;
          g.cellDir[i] = 0;
        }
      }
      for (const [dx, dy] of spec.cells) {
        const px = spec.x + dx;
        const py = spec.y + dy;
        if (!g.inBounds(px, py)) continue;
        g.set(px, py, CELL_TYPE.MISSILE);
        const i = py * g.width + g.wrapX(px);
        g.cellColor[i] = (i * 11) % variants;
        g.cellDir[i] = 0;
        g.cellAge[i] = 0;
      }
      this._designedSpawners.push({
        patternId: spec.patternId,
        name: spec.name || spec.patternId,
        x: spec.x,
        y: spec.y,
        w: spec.width,
        h: spec.height,
        cells: spec.cells.map(([dx, dy]) => [dx, dy]),
        interval,
        // Stagger initial emissions so they don't all fire at once.
        cooldown: 500 + Math.random() * interval,
        alive: true,
        _damage: 0,
      });
    }
  }

  _spawnBasesForWave(waveNum) {
    if (!CONFIG.BASE_SPAWN_ENABLED) return;
    const bz = this.grid.baseZoneBounds();
    if (!bz) return;
    const desired = Math.min(
      CONFIG.BASE_SPAWN_MAX | 0,
      Math.round(CONFIG.BASE_SPAWN_COUNT_BASE + waveNum * CONFIG.BASE_SPAWN_COUNT_INC)
    );
    for (let i = 0; i < desired; i++) {
      this._spawnRandomBase(bz);
    }
  }

  _spawnRandomBase(bz) {
    // Build weighted pool from CONFIG.
    const pool = [
      { kind: 'fortress', weight: CONFIG.BASE_TYPE_FORTRESS || 0, pattern: FORTRESS_PATTERN },
      { kind: 'bunker', weight: CONFIG.BASE_TYPE_BUNKER || 0, pattern: BUNKER_PATTERN },
      { kind: 'cruiser_e', weight: CONFIG.BASE_TYPE_CRUISER_E || 0, pattern: CRUISER_E },
      { kind: 'cruiser_w', weight: CONFIG.BASE_TYPE_CRUISER_W || 0, pattern: CRUISER_W },
    ].filter((p) => p.weight > 0);
    if (pool.length === 0) return false;
    const totalW = pool.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * totalW;
    let pick = pool[0];
    for (const p of pool) {
      r -= p.weight;
      if (r <= 0) {
        pick = p;
        break;
      }
    }
    return this._placeBase(pick, bz);
  }

  _placeBase(spec, bz) {
    const g = this.grid;
    // Compute pattern bbox.
    let pw = 0,
      ph = 0;
    for (const [dx, dy] of spec.pattern) {
      if (dx + 1 > pw) pw = dx + 1;
      if (dy + 1 > ph) ph = dy + 1;
    }
    // Try several random positions within the base zone.
    const minY = bz.minY;
    const maxY = bz.maxY - ph + 1;
    if (maxY < minY) return false;
    const MAX_ATTEMPTS = 20;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const x = 2 + Math.floor(Math.random() * (g.width - pw - 4));
      const y = minY + Math.floor(Math.random() * (maxY - minY + 1));
      // Check clearance against existing bases, targets, and any cells.
      if (!this._isSpawnClear(x, y, pw, ph, 2)) continue;
      // Also check against existing bases directly.
      if (this._overlapsExistingBase(x, y, pw, ph, 2)) continue;
      // Stamp it.
      const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
      // Cruisers face east (DIR_EAST) or west (DIR_WEST); statics are stationary (0).
      let dir = 0;
      if (spec.kind === 'cruiser_e') dir = DIR_EAST;
      else if (spec.kind === 'cruiser_w') dir = DIR_WEST;
      for (const [dx, dy] of spec.pattern) {
        const px = x + dx,
          py = y + dy;
        if (g.inBounds(px, py)) {
          g.set(px, py, CELL_TYPE.MISSILE);
          const i = py * g.width + g.wrapX(px);
          g.cellColor[i] = (i * 7) % variants;
          g.cellDir[i] = dir;
          g.cellAge[i] = 0;
        }
      }
      const base = {
        kind: spec.kind,
        x,
        y,
        w: pw,
        h: ph,
        pattern: spec.pattern,
        alive: true,
        emitCooldown:
          spec.kind === 'fortress' || spec.kind === 'bunker' ? 2000 + Math.random() * 2000 : 0,
        // Cruisers move every N ms.
        moveCooldown: dir === DIR_EAST || dir === DIR_WEST ? 600 + Math.random() * 200 : 0,
        dir,
      };
      this.bases.push(base);
      this.recentSpawns.push({ x, y, ttl: 3000 });
      if (this.onBaseSpawn) {
        this.onBaseSpawn(x + pw / 2, y + ph / 2, spec.kind);
      } else if (this.onTargetSpawn) {
        // Fallback to target FX.
        this.onTargetSpawn(x + pw / 2, y + ph / 2);
      }
      return true;
    }
    return false;
  }

  _overlapsExistingBase(x, y, pw, ph, clearance) {
    for (const b of this.bases) {
      if (!b.alive) continue;
      const minX1 = x - clearance,
        maxX1 = x + pw - 1 + clearance;
      const minY1 = y - clearance,
        maxY1 = y + ph - 1 + clearance;
      const minX2 = b.x,
        maxX2 = b.x + b.w - 1;
      const minY2 = b.y,
        maxY2 = b.y + b.h - 1;
      if (maxX1 < minX2 || minX1 > maxX2) continue;
      if (maxY1 < minY2 || minY1 > maxY2) continue;
      return true;
    }
    return false;
  }

  update(deltaMs) {
    // Time-stop: skip all enemy spawning and target/base ticking entirely.
    if (this.frozen) return;
    // Age out recent-spawn entries.
    for (let i = this.recentSpawns.length - 1; i >= 0; i--) {
      this.recentSpawns[i].ttl -= deltaMs;
      if (this.recentSpawns[i].ttl <= 0) this.recentSpawns.splice(i, 1);
    }
    // Update targets: re-stamp them so Life rules can't kill them, and
    // let them periodically emit gliders.
    this._updateTargets(deltaMs);
    // Update bases similarly: static bases re-imprint + emit; cruisers
    // move horizontally.
    this._updateBases(deltaMs);
    // Update designed (level-designer) bases and spawners.
    this._updateDesignedBases(deltaMs);
    this._updateDesignedSpawners(deltaMs);
    if (this.spawned >= this.toSpawn) return;
    this.spawnCooldown -= deltaMs;
    if (this.spawnCooldown <= 0) {
      if (this.spawnMissile()) {
        this.spawned++;
      }
      // Always reset cooldown — even if spawn failed, wait before retrying
      // so we don't hammer the grid every frame looking for clear space.
      this.spawnCooldown = this.spawnInterval;
    }
  }

  // Re-imprint targets on the grid and tick their emit cooldowns. Targets
  // are considered "alive" as long as a majority of their footprint cells
  // remain MISSILE. If the player damages them enough, they die.
  _updateTargets(deltaMs) {
    const g = this.grid;
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      if (!t.alive) continue;
      // Count surviving footprint cells.
      let alive = 0;
      for (const [dx, dy] of TARGET_PATTERN) {
        const px = t.x + dx,
          py = t.y + dy;
        if (g.inBounds(px, py) && g.get(px, py) === CELL_TYPE.MISSILE) {
          alive++;
        }
      }
      // If more than half the cells are gone, the target is destroyed.
      if (alive < Math.ceil(TARGET_PATTERN.length / 2)) {
        t.alive = false;
        // Clear remaining cells.
        for (const [dx, dy] of TARGET_PATTERN) {
          const px = t.x + dx,
            py = t.y + dy;
          if (g.inBounds(px, py)) {
            const i2 = py * g.width + g.wrapX(px);
            if (g.cells[i2] === CELL_TYPE.MISSILE) {
              g.cells[i2] = CELL_TYPE.EXPLOSION;
              g.explosionTimers[i2] = 8;
            }
          }
        }
        if (this.onTargetDestroyed) {
          this.onTargetDestroyed(t.x + 2, t.y + 2);
        }
        this.targets.splice(i, 1);
        continue;
      }
      // Re-imprint the target pattern so Life rules can't slowly erode it.
      const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
      for (const [dx, dy] of TARGET_PATTERN) {
        const px = t.x + dx,
          py = t.y + dy;
        if (g.inBounds(px, py)) {
          const idx = py * g.width + g.wrapX(px);
          if (g.cells[idx] === CELL_TYPE.EMPTY || g.cells[idx] === CELL_TYPE.MISSILE) {
            g.cells[idx] = CELL_TYPE.MISSILE;
            g.cellAge[idx] = 0; // reset age so missile-age cascade can't reap them
            g.cellColor[idx] = (idx * 7) % variants;
            g.cellDir[idx] = 0;
          }
        }
      }
      // Tick emit cooldown.
      t.emitCooldown -= deltaMs;
      if (t.emitCooldown <= 0) {
        this._targetEmitGlider(t);
        t.emitCooldown = 2500 + Math.random() * 1500;
      }
    }
  }

  // Update bases: re-imprint static bases; move cruisers horizontally.
  // Detect base death from player damage.
  _updateBases(deltaMs) {
    const g = this.grid;
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    for (let i = this.bases.length - 1; i >= 0; i--) {
      const b = this.bases[i];
      if (!b.alive) continue;
      // Count surviving footprint cells at current position.
      let alive = 0;
      for (const [dx, dy] of b.pattern) {
        const px = b.x + dx,
          py = b.y + dy;
        if (g.inBounds(px, py) && g.get(px, py) === CELL_TYPE.MISSILE) {
          alive++;
        }
      }
      const threshold = Math.ceil(b.pattern.length / 2);
      if (alive < threshold) {
        b.alive = false;
        // Clear remaining cells and explode.
        for (const [dx, dy] of b.pattern) {
          const px = b.x + dx,
            py = b.y + dy;
          if (g.inBounds(px, py)) {
            const i2 = py * g.width + g.wrapX(px);
            if (g.cells[i2] === CELL_TYPE.MISSILE) {
              g.cells[i2] = CELL_TYPE.EXPLOSION;
              g.explosionTimers[i2] = 8;
            }
          }
        }
        if (this.onBaseDestroyed) {
          this.onBaseDestroyed(b.x + b.w / 2, b.y + b.h / 2, b.kind);
        } else if (this.onTargetDestroyed) {
          this.onTargetDestroyed(b.x + b.w / 2, b.y + b.h / 2);
        }
        this.bases.splice(i, 1);
        continue;
      }
      // Cruisers: move horizontally on cooldown. We use a custom mover
      // rather than Life evolution because pure-Life LWSS would drift
      // diagonally up/down too, and we want PURE horizontal motion.
      if (b.dir === DIR_EAST || b.dir === DIR_WEST) {
        b.moveCooldown -= deltaMs;
        if (b.moveCooldown <= 0) {
          this._moveCruiser(b);
          b.moveCooldown = 600 + Math.random() * 200;
        }
      }
      // Re-imprint the pattern at current (x, y) so Life rules can't
      // erode it between movements.
      for (const [dx, dy] of b.pattern) {
        const px = b.x + dx,
          py = b.y + dy;
        if (g.inBounds(px, py)) {
          const idx = py * g.width + g.wrapX(px);
          if (g.cells[idx] === CELL_TYPE.EMPTY || g.cells[idx] === CELL_TYPE.MISSILE) {
            g.cells[idx] = CELL_TYPE.MISSILE;
            g.cellAge[idx] = 0;
            g.cellColor[idx] = (idx * 7) % variants;
            g.cellDir[idx] = b.dir;
          }
        }
      }
      // Static bases emit gliders periodically.
      if (b.kind === 'fortress' || b.kind === 'bunker') {
        b.emitCooldown -= deltaMs;
        if (b.emitCooldown <= 0) {
          this._baseEmitGlider(b);
          b.emitCooldown = (b.kind === 'fortress' ? 2200 : 3000) + Math.random() * 1500;
        }
      }
    }
  }

  // Move a cruiser one cell horizontally. Clears old footprint, stamps
  // new footprint at new x. Wraps around grid edges.
  _moveCruiser(b) {
    const g = this.grid;
    // Clear old cells (only MISSILE cells matching us; avoid wiping
    // player defenses that might overlap).
    for (const [dx, dy] of b.pattern) {
      const px = b.x + dx,
        py = b.y + dy;
      if (g.inBounds(px, py)) {
        const i = py * g.width + g.wrapX(px);
        if (g.cells[i] === CELL_TYPE.MISSILE) {
          g.cells[i] = CELL_TYPE.EMPTY;
          g.cellAge[i] = 0;
          g.cellDir[i] = 0;
        }
      }
    }
    // Advance x with wrap.
    const dx = b.dir === DIR_EAST ? 1 : -1;
    b.x = (((b.x + dx) % g.width) + g.width) % g.width;
    // New footprint is stamped on next _updateBases re-imprint pass.
  }

  _baseEmitGlider(b) {
    // Drop an SE or SW glider just below the base footprint.
    const pattern = Math.random() < 0.5 ? SE_GLIDER : SW_GLIDER;
    const buffer = Math.max(1, CONFIG.BASE_GLIDER_BUFFER | 0);
    const baseX = b.x;
    const baseY = b.y + b.h + buffer;
    // Make sure we're emitting into a row below the base zone + buffer.
    const bz = this.grid.baseZoneBounds();
    if (bz && baseY <= bz.maxY + buffer - 1) return;
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    let placed = 0;
    for (const [dx, dy] of pattern) {
      const px = baseX + dx,
        py = baseY + dy;
      if (this.grid.inBounds(px, py) && this.grid.get(px, py) === CELL_TYPE.EMPTY) {
        this.grid.set(px, py, CELL_TYPE.MISSILE);
        const wx = this.grid.wrapX(px);
        const i = py * this.grid.width + wx;
        this.grid.cellColor[i] = (Math.random() * variants) | 0;
        this.grid.cellDir[i] = DIR_DOWN;
        placed++;
      }
    }
    if (placed > 0 && this.onMissileSpawn) {
      this.onMissileSpawn(baseX + 1.5, baseY + 1.5, 3, 3);
    }
  }
  // Tick designer-placed bases: re-imprint and check for destruction.
  _updateDesignedBases(_deltaMs) {
    if (this._designedBases.length === 0) return;
    const g = this.grid;
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    for (let i = this._designedBases.length - 1; i >= 0; i--) {
      const b = this._designedBases[i];
      if (!b.alive) continue;
      // Count cells in the footprint that were damaged by player defenses
      // (i.e., became EMPTY or EXPLOSION). We track damage via b._damage
      // counter rather than relying on cell state, because Life evolution
      // around the base can constantly mutate cells in ways unrelated
      // to player damage.
      if (b._damage === undefined) b._damage = 0;
      // Check for direct damage: any footprint cell adjacent to a DEFENSE
      // cell counts as a damage tick. This makes the player's defenses
      // actually destroy bases rather than just colliding with neighbors.
      let damageThisTick = 0;
      for (const [dx, dy] of b.cells) {
        const px = b.x + dx;
        const py = b.y + dy;
        if (!g.inBounds(px, py)) continue;
        // Count adjacent defense cells.
        for (let ddy = -1; ddy <= 1; ddy++) {
          for (let ddx = -1; ddx <= 1; ddx++) {
            if (ddx === 0 && ddy === 0) continue;
            const nx = (((px + ddx) % g.width) + g.width) % g.width;
            const ny = py + ddy;
            if (ny < 0 || ny >= g.height) continue;
            if (g.cells[ny * g.width + nx] === CELL_TYPE.DEFENSE) {
              damageThisTick++;
            }
          }
        }
      }
      // Each tick of contact deals 1 damage unit. Threshold is roughly
      // half the footprint size — making bases reasonably durable but
      // not impossible.
      b._damage += damageThisTick * 0.1;
      const threshold = Math.max(3, Math.ceil(b.cells.length * 0.4));
      if (b._damage >= threshold) {
        b.alive = false;
        // Explode remaining cells.
        for (const [dx, dy] of b.cells) {
          const px = b.x + dx;
          const py = b.y + dy;
          if (g.inBounds(px, py)) {
            const idx = py * g.width + g.wrapX(px);
            g.cells[idx] = CELL_TYPE.EXPLOSION;
            g.explosionTimers[idx] = 8;
          }
        }
        if (this.onBaseDestroyed) {
          this.onBaseDestroyed(b.x + b.w / 2, b.y + b.h / 2, 'designed');
        }
        this._designedBases.splice(i, 1);
        continue;
      }
      // Hard re-imprint: force every footprint cell to MISSILE, regardless
      // of what Life rules tried to do this tick. This makes designed bases
      // immutable structures (until destroyed by player damage).
      for (const [dx, dy] of b.cells) {
        const px = b.x + dx;
        const py = b.y + dy;
        if (g.inBounds(px, py)) {
          const idx = py * g.width + g.wrapX(px);
          // Don't overwrite cities or active explosions.
          if (g.cells[idx] === CELL_TYPE.CITY) continue;
          if (g.cells[idx] === CELL_TYPE.EXPLOSION && g.explosionTimers[idx] > 0) continue;
          const wasEmpty = g.cells[idx] !== CELL_TYPE.MISSILE;
          g.cells[idx] = CELL_TYPE.MISSILE;
          g.cellAge[idx] = 0;
          if (wasEmpty) {
            g.cellColor[idx] = (idx * 7) % variants;
          }
          g.cellDir[idx] = 0;
        }
      }
      // Also clear any orphaned MISSILE cells in a small halo around
      // the base that aren't part of the footprint. This prevents Life
      // rules from "growing" the base into nearby spawners.
      const footprintSet = new Set(b.cells.map(([dx, dy]) => `${b.x + dx},${b.y + dy}`));
      for (let dy = -1; dy <= b.h; dy++) {
        for (let dx = -1; dx <= b.w; dx++) {
          const px = b.x + dx;
          const py = b.y + dy;
          if (!g.inBounds(px, py)) continue;
          const key = `${px},${py}`;
          if (footprintSet.has(key)) continue;
          const idx = py * g.width + g.wrapX(px);
          // Only clear MISSILE cells that have very high age (likely
          // Life-spawned debris, not freshly-spawned gliders).
          if (g.cells[idx] === CELL_TYPE.MISSILE && g.cellAge[idx] > 5 && g.cellDir[idx] === 0) {
            g.cells[idx] = CELL_TYPE.EMPTY;
            g.cellAge[idx] = 0;
          }
        }
      }
    }
  }
  // Tick designer-placed spawners: re-imprint and emit missiles on cooldown.
  _updateDesignedSpawners(deltaMs) {
    if (this._designedSpawners.length === 0) return;
    const g = this.grid;
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    for (let i = this._designedSpawners.length - 1; i >= 0; i--) {
      const s = this._designedSpawners[i];
      if (!s.alive) continue;
      // Damage tracking same as bases.
      if (s._damage === undefined) s._damage = 0;
      let damageThisTick = 0;
      for (const [dx, dy] of s.cells) {
        const px = s.x + dx;
        const py = s.y + dy;
        if (!g.inBounds(px, py)) continue;
        for (let ddy = -1; ddy <= 1; ddy++) {
          for (let ddx = -1; ddx <= 1; ddx++) {
            if (ddx === 0 && ddy === 0) continue;
            const nx = (((px + ddx) % g.width) + g.width) % g.width;
            const ny = py + ddy;
            if (ny < 0 || ny >= g.height) continue;
            if (g.cells[ny * g.width + nx] === CELL_TYPE.DEFENSE) {
              damageThisTick++;
            }
          }
        }
      }
      s._damage += damageThisTick * 0.1;
      const threshold = Math.max(3, Math.ceil(s.cells.length * 0.4));
      if (s._damage >= threshold) {
        s.alive = false;
        for (const [dx, dy] of s.cells) {
          const px = s.x + dx;
          const py = s.y + dy;
          if (g.inBounds(px, py)) {
            const idx = py * g.width + g.wrapX(px);
            g.cells[idx] = CELL_TYPE.EXPLOSION;
            g.explosionTimers[idx] = 8;
          }
        }
        if (this.onBaseDestroyed) {
          this.onBaseDestroyed(s.x + s.w / 2, s.y + s.h / 2, 'spawner');
        }
        this._designedSpawners.splice(i, 1);
        continue;
      }
      // Hard re-imprint, same as bases.
      for (const [dx, dy] of s.cells) {
        const px = s.x + dx;
        const py = s.y + dy;
        if (g.inBounds(px, py)) {
          const idx = py * g.width + g.wrapX(px);
          if (g.cells[idx] === CELL_TYPE.CITY) continue;
          if (g.cells[idx] === CELL_TYPE.EXPLOSION && g.explosionTimers[idx] > 0) continue;
          const wasNotMissile = g.cells[idx] !== CELL_TYPE.MISSILE;
          g.cells[idx] = CELL_TYPE.MISSILE;
          g.cellAge[idx] = 0;
          if (wasNotMissile) {
            g.cellColor[idx] = (idx * 11) % variants;
          }
          g.cellDir[idx] = 0;
        }
      }
      // Clear halo of Life-spawned debris around spawner.
      const footprintSet = new Set(s.cells.map(([dx, dy]) => `${s.x + dx},${s.y + dy}`));
      for (let dy = -1; dy <= s.h; dy++) {
        for (let dx = -1; dx <= s.w; dx++) {
          const px = s.x + dx;
          const py = s.y + dy;
          if (!g.inBounds(px, py)) continue;
          const key = `${px},${py}`;
          if (footprintSet.has(key)) continue;
          const idx = py * g.width + g.wrapX(px);
          if (g.cells[idx] === CELL_TYPE.MISSILE && g.cellAge[idx] > 5 && g.cellDir[idx] === 0) {
            g.cells[idx] = CELL_TYPE.EMPTY;
            g.cellAge[idx] = 0;
          }
        }
      }
      // Tick emission cooldown.
      s.cooldown -= deltaMs;
      if (s.cooldown <= 0) {
        this._spawnerEmit(s);
        s.cooldown = s.interval;
      }
    }
  }
  // Emit a glider from a designed spawner. Tries SE then SW. Emits below
  // the spawner footprint with enough buffer to clear the pattern.
  _spawnerEmit(s) {
    const g = this.grid;
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    const patterns = [SE_GLIDER, SW_GLIDER];
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    // Compute glider bounding box.
    let pw = 0,
      ph = 0;
    for (const [dx, dy] of pattern) {
      if (dx + 1 > pw) pw = dx + 1;
      if (dy + 1 > ph) ph = dy + 1;
    }
    // Spawn the glider well below the spawner's footprint, with a buffer
    // so the new glider doesn't collide with the spawner's own cells
    // (which would cause Life chaos and erode the spawner).
    const buffer = 3;
    const baseX = s.x + Math.max(0, Math.floor((s.w - pw) / 2));
    const baseY = s.y + s.h + buffer;
    // Bail if spawn would go off-grid.
    if (baseY + ph >= g.height) return;
    // Check spawn area is clear.
    for (const [dx, dy] of pattern) {
      const px = baseX + dx;
      const py = baseY + dy;
      if (!g.inBounds(px, py)) return;
      if (g.get(px, py) !== CELL_TYPE.EMPTY) return;
    }
    // Also check a 1-cell halo around the spawn area is clear so the
    // new glider has room to start moving without immediate collisions.
    for (let dy = -1; dy <= ph; dy++) {
      for (let dx = -1; dx <= pw; dx++) {
        const px = baseX + dx;
        const py = baseY + dy;
        if (!g.inBounds(px, py)) continue;
        const t = g.get(px, py);
        if (t === CELL_TYPE.MISSILE || t === CELL_TYPE.DEFENSE) return;
      }
    }
    let placed = 0;
    for (const [dx, dy] of pattern) {
      const px = baseX + dx;
      const py = baseY + dy;
      if (g.inBounds(px, py) && g.get(px, py) === CELL_TYPE.EMPTY) {
        g.set(px, py, CELL_TYPE.MISSILE);
        const wx = g.wrapX(px);
        const i = py * g.width + wx;
        g.cellColor[i] = (Math.random() * variants) | 0;
        g.cellDir[i] = DIR_DOWN;
        placed++;
      }
    }
    if (placed > 0 && this.onMissileSpawn) {
      this.onMissileSpawn(baseX + pw / 2, baseY + ph / 2, pw, ph);
    }
  }

  _targetEmitGlider(t) {
    // Drop an SE or SW glider just below the target.
    const pattern = Math.random() < 0.5 ? SE_GLIDER : SW_GLIDER;
    const baseX = t.x;
    const baseY = t.y + 5; // below the target footprint
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    let placed = 0;
    for (const [dx, dy] of pattern) {
      const px = baseX + dx,
        py = baseY + dy;
      if (this.grid.inBounds(px, py) && this.grid.get(px, py) === CELL_TYPE.EMPTY) {
        this.grid.set(px, py, CELL_TYPE.MISSILE);
        const wx = this.grid.wrapX(px);
        const i = py * this.grid.width + wx;
        this.grid.cellColor[i] = (Math.random() * variants) | 0;
        this.grid.cellDir[i] = 1;
        placed++;
      }
    }
    if (placed > 0 && this.onMissileSpawn) {
      this.onMissileSpawn(baseX + 1.5, baseY + 1.5, 3, 3);
    }
  }

  spawnTarget() {
    const g = this.grid;
    const w = g.width;
    const y = Math.max(CONFIG.RETURN_FIRE_ZONE_MAX_Y + 1, 2);
    // Try a few random x positions.
    const MAX_ATTEMPTS = 12;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const x = 3 + Math.floor(Math.random() * (w - 9));
      if (this._isSpawnClear(x, y, 4, 4, 3)) {
        const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
        for (const [dx, dy] of TARGET_PATTERN) {
          const px = x + dx,
            py = y + dy;
          if (g.inBounds(px, py)) {
            g.set(px, py, CELL_TYPE.MISSILE);
            const i = py * g.width + g.wrapX(px);
            g.cellColor[i] = (i * 7) % variants;
            g.cellDir[i] = 0;
          }
        }
        const target = {
          x,
          y,
          w: 4,
          h: 4,
          emitCooldown: 1500 + Math.random() * 1500,
          alive: true,
        };
        this.targets.push(target);
        this.recentSpawns.push({ x, y, ttl: 3000 });
        if (this.onTargetSpawn) this.onTargetSpawn(x + 2, y + 2);
        return true;
      }
    }
    return false;
  }

  // Build the list of currently-enabled glider patterns based on CONFIG flags.
  _enabledPatterns() {
    const patterns = [];
    if (CONFIG.GLIDER_SE) patterns.push(SE_GLIDER);
    if (CONFIG.GLIDER_SW) patterns.push(SW_GLIDER);
    // GLIDER_HEAVY is handled separately as a stationary target emplacement
    // (see spawnMissile()), so it does NOT contribute to the per-tick
    // glider pattern pool.
    if (CONFIG.GLIDER_LWSS) {
      patterns.push(LWSS_SE);
      patterns.push(LWSS_SW);
    }
    if (CONFIG.GLIDER_MWSS) {
      patterns.push(MWSS_SE);
      patterns.push(MWSS_SW);
    }
    if (CONFIG.GLIDER_TWIN) {
      patterns.push(TWIN_GLIDER);
    }
    if (CONFIG.GLIDER_GUN) {
      patterns.push(GOSPER_GUN);
    }
    // Safety: at least one pattern must always be available.
    if (patterns.length === 0) patterns.push(SE_GLIDER);
    return patterns;
  }

  // Check that a candidate spawn region [x..x+pw-1] × [y..y+ph-1] expanded
  // by `clearance` cells in every direction is empty of MISSILE cells and
  // does not overlap any recent spawn footprint. Returns true if clear.
  _isSpawnClear(x, y, pw, ph, clearance) {
    const g = this.grid;
    const minX = x - clearance;
    const maxX = x + pw - 1 + clearance;
    const minY = Math.max(0, y - clearance);
    const maxY = Math.min(g.height - 1, y + ph - 1 + clearance);
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const t = g.get(cx, cy);
        // Block spawn on any live cell (missile OR defense). Defense
        // cells up here are player-launched gliders that successfully
        // traveled into the enemy rear; we shouldn't spawn directly on
        // top of them either.
        if (t === CELL_TYPE.MISSILE || t === CELL_TYPE.DEFENSE) return false;
      }
    }
    // Also reject if too close to a very recent spawn anchor.
    for (const rs of this.recentSpawns) {
      // Horizontal distance with wrap-around.
      let dx = Math.abs(rs.x - x);
      if (dx > g.width / 2) dx = g.width - dx;
      const dy = Math.abs(rs.y - y);
      if (dx <= pw + clearance && dy <= ph + clearance) return false;
    }
    return true;
  }

  spawnMissile() {
    const w = this.grid.width;
    // Spawn just below the base zone (or just below the top dead zone
    // if the base zone is disabled). The grid computes the correct row.
    const y = this.grid.missileSpawnY();
    // If heavy targets are enabled, occasionally (10%) spawn a target
    // emplacement instead of a regular glider.
    if (CONFIG.GLIDER_HEAVY && Math.random() < 0.1) {
      if (this.spawnTarget()) return true;
    }

    const patterns = this._enabledPatterns();
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    // Compute pattern bounding box for clearance checks.
    let pw = 0,
      ph = 0;
    for (const [dx, dy] of pattern) {
      if (dx + 1 > pw) pw = dx + 1;
      if (dy + 1 > ph) ph = dy + 1;
    }
    // Try several random x positions until we find one with 2px clearance.
    const CLEARANCE = 2;
    const MAX_ATTEMPTS = 12;
    let x = -1;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = 2 + Math.floor(Math.random() * (w - 6));
      if (this._isSpawnClear(candidate, y, pw, ph, CLEARANCE)) {
        x = candidate;
        break;
      }
    }
    if (x < 0) {
      // Could not find clear space this tick; skip spawn (will retry next interval).
      return false;
    }

    for (const [dx, dy] of pattern) {
      const px = x + dx;
      const py = y + dy;
      if (this.grid.inBounds(px, py) && this.grid.get(px, py) === CELL_TYPE.EMPTY) {
        this.grid.set(px, py, CELL_TYPE.MISSILE);
        const wx = this.grid.wrapX(px);
        const i = py * this.grid.width + wx;
        this.grid.cellColor[i] = (Math.random() * variants) | 0;
        this.grid.cellDir[i] = 1; // downward
      }
    }
    // Record this spawn so subsequent spawns avoid the same area until
    // the glider has had time to move away (~3 seconds of ticks).
    this.recentSpawns.push({ x, y, ttl: 3000 });
    // Fire spawn FX callback.
    if (this.onMissileSpawn) {
      this.onMissileSpawn(x + pw / 2, y + ph / 2, pw, ph);
    }
    return true;
  }

  isWaveComplete() {
    if (this.spawned < this.toSpawn) return false;
    // Targets count as live threats — wave isn't complete until they're gone.
    if (this.targets.some((t) => t.alive)) return false;
    // Bases must all be destroyed for wave to complete.
    if (this.bases.some((b) => b.alive)) return false;
    // Designed bases must be destroyed too.
    if (this._designedBases.some((b) => b.alive)) return false;
    // Designed spawners must be destroyed too.
    if (this._designedSpawners.some((s) => s.alive)) return false;
    const cells = this.grid.cells;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === CELL_TYPE.MISSILE) return false;
    }
    return true;
  }
}
