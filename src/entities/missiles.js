import { CONFIG, CELL_TYPE } from '../config.js';
import { Logger } from '../logger.js';

// ============================================================
// GLIDER PATTERNS — projectiles emitted by spawners
// ============================================================

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
// Lightweight Spaceship variants — true GoL spaceships, traveling diagonally downward.
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
// Gosper Glider Gun — a compact glider factory.
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
// TARGET / BASE PATTERNS — stationary structures
// ============================================================

// Target: 4x4 emplacement that periodically emits gliders.
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
const FORTRESS_PATTERN = TARGET_PATTERN;
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
// Horizontal LWSS moving EAST (right).
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
// Horizontal LWSS moving WEST (left).
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

// ============================================================
// SPAWN POINT DEFINITIONS
//
// A SpawnPoint defines WHERE and HOW gliders enter the playfield.
// Each spawn point has:
//   - id: human-readable identifier for logging
//   - x, y: top-left anchor for glider stamping (grid coords)
//   - pattern: glider pattern array of [dx,dy] offsets
//   - interval: ms between emissions
//   - cooldown: current ms until next emission (mutable)
//   - emitCount: total gliders emitted (for logging)
//   - enabled: false disables this spawn point
// ============================================================

/**
 * Create a default set of spawn points for a wave. Spawns are
 * distributed across the top of the grid with varied patterns
 * and timings to keep gameplay interesting.
 *
 * @param {number} gridWidth
 * @param {number} spawnY - row where gliders enter
 * @param {number} waveNum - 0-indexed wave number
 * @param {number} desiredCount - how many spawn points to create
 * @returns {Array} spawn point definitions
 */
function buildDefaultSpawnPoints(gridWidth, spawnY, waveNum, desiredCount) {
  const patterns = [];
  if (CONFIG.GLIDER_SE) patterns.push({ name: 'SE', cells: SE_GLIDER, width: 3, height: 3 });
  if (CONFIG.GLIDER_SW) patterns.push({ name: 'SW', cells: SW_GLIDER, width: 3, height: 3 });
  if (CONFIG.GLIDER_LWSS) {
    patterns.push({ name: 'LWSS_SE', cells: LWSS_SE, width: 5, height: 4 });
    patterns.push({ name: 'LWSS_SW', cells: LWSS_SW, width: 5, height: 4 });
  }
  if (CONFIG.GLIDER_MWSS) {
    patterns.push({ name: 'MWSS_SE', cells: MWSS_SE, width: 5, height: 5 });
    patterns.push({ name: 'MWSS_SW', cells: MWSS_SW, width: 5, height: 5 });
  }
  if (CONFIG.GLIDER_TWIN) patterns.push({ name: 'TWIN', cells: TWIN_GLIDER, width: 8, height: 3 });
  if (CONFIG.GLIDER_GUN) patterns.push({ name: 'GUN', cells: GOSPER_GUN, width: 36, height: 9 });
  if (patterns.length === 0) {
    patterns.push({ name: 'SE', cells: SE_GLIDER, width: 3, height: 3 });
  }

  const spawnPoints = [];
  // Distribute spawn points evenly across the grid width with jitter.
  const usableWidth = gridWidth - 8; // leave margins
  const baseSpacing = usableWidth / Math.max(1, desiredCount);
  const baseInterval = Math.max(
    CONFIG.MISSILE_SPAWN_MIN,
    CONFIG.MISSILE_SPAWN_INTERVAL - waveNum * CONFIG.MISSILE_SPAWN_DECREMENT
  );

  for (let i = 0; i < desiredCount; i++) {
    const pattern = patterns[i % patterns.length];
    // Place spawn point with jitter so they don't form a perfect line.
    const baseX = 4 + Math.floor(baseSpacing * (i + 0.5));
    const jitter = Math.floor((Math.random() - 0.5) * baseSpacing * 0.4);
    const x = Math.max(2, Math.min(gridWidth - pattern.width - 2, baseX + jitter));
    // Stagger initial cooldowns so spawns don't synchronize.
    const initialCooldown = (i * baseInterval) / desiredCount + Math.random() * 200;
    spawnPoints.push({
      id: `wave${waveNum}_sp${i}_${pattern.name}`,
      x,
      y: spawnY,
      pattern: pattern.cells,
      patternWidth: pattern.width,
      patternHeight: pattern.height,
      patternName: pattern.name,
      interval: baseInterval,
      cooldown: initialCooldown,
      emitCount: 0,
      enabled: true,
    });
  }
  return spawnPoints;
}

/**
 * Missiles module — manages all enemy threats:
 *   - Wave-based glider spawn points (default game)
 *   - Custom designer-placed spawners (level designer)
 *   - Custom designer-placed bases (level designer)
 *   - Procedural bases per wave (default game)
 *   - Target emplacements
 */
export class Missiles {
  constructor(grid) {
    this.grid = grid;

    // ── Wave-based default spawning ─────────────────────────────
    // Replaces the old toSpawn/spawned/spawnCooldown system.
    this.spawnPoints = []; // active SpawnPoint definitions
    this.targetMissiles = 0; // missiles to emit this wave
    this.emittedMissiles = 0; // total missiles emitted this wave

    // Track recent spawn positions for collision avoidance.
    this.recentSpawns = []; // [{x, y, ttl}]

    // ── FX callbacks ────────────────────────────────────────────
    this.onMissileSpawn = null;
    this.onTargetSpawn = null;
    this.onTargetDestroyed = null;
    this.onBaseSpawn = null;
    this.onBaseDestroyed = null;

    // ── State ───────────────────────────────────────────────────
    this.targets = []; // active target emplacements
    this.bases = []; // procedurally-placed bases
    this.frozen = false; // Time Stop freezes all enemy activity

    // ── Custom level support ────────────────────────────────────
    this._customBases = [];
    this._customSpawners = [];
    this._designedBases = [];
    this._designedSpawners = [];
  }

  /**
   * Provide designer-placed base specs to be stamped at wave start.
   */
  setCustomBases(bases) {
    this._customBases = Array.isArray(bases) ? bases.slice() : [];
    Logger.info(`[Missiles] setCustomBases: ${this._customBases.length} bases registered.`);
  }

  /**
   * Provide designer-placed spawner specs to be stamped at wave start.
   */
  setCustomSpawners(spawners) {
    this._customSpawners = Array.isArray(spawners) ? spawners.slice() : [];
    Logger.info(
      `[Missiles] setCustomSpawners: ${this._customSpawners.length} spawners registered.`
    );
  }

  hasCustomContent() {
    return this._customBases.length > 0 || this._customSpawners.length > 0;
  }

  /**
   * Start a new wave. Sets up spawn points and bases.
   */
  startWave(waveNum) {
    Logger.info(`[Missiles] === WAVE ${waveNum + 1} START ===`);
    Logger.info(
      `[Missiles]   grid: ${this.grid.width}x${this.grid.height}, spawn Y: ${this.grid.missileSpawnY()}`
    );
    Logger.info(
      `[Missiles]   custom bases: ${this._customBases.length}, custom spawners: ${this._customSpawners.length}`
    );
    this.recentSpawns = [];
    this.targets = [];
    this.bases = [];
    this._designedBases = [];
    this._designedSpawners = [];
    this.spawnPoints = [];
    this.emittedMissiles = 0;

    // Spawn designer-placed bases & spawners first (they override default).
    this._spawnDesignedBases();
    this._spawnDesignedSpawners();

    if (this.hasCustomContent()) {
      // Custom level: designed spawners handle all glider emission.
      // No default spawn points, no target count to reach.
      this.targetMissiles = 0;
      Logger.info(
        `[Missiles] Custom level active — ${this._designedSpawners.length} spawner(s), ${this._designedBases.length} base(s).`
      );
    } else {
      // Default game: build wave spawn points + procedural bases.
      this.targetMissiles = CONFIG.MISSILES_PER_WAVE_BASE + waveNum * CONFIG.MISSILES_PER_WAVE_INC;
      this._buildWaveSpawnPoints(waveNum);
      this._spawnBasesForWave(waveNum);
      Logger.info(
        `[Missiles] Default wave: target=${this.targetMissiles} missiles, ${this.spawnPoints.length} spawn point(s).`
      );
      Logger.info(
        `[Missiles]   enabled gliders: SE=${CONFIG.GLIDER_SE}, SW=${CONFIG.GLIDER_SW}, LWSS=${CONFIG.GLIDER_LWSS}, MWSS=${CONFIG.GLIDER_MWSS}, TWIN=${CONFIG.GLIDER_TWIN}, GUN=${CONFIG.GLIDER_GUN}, HEAVY=${CONFIG.GLIDER_HEAVY}`
      );
    }
  }

  /**
   * Build the spawn points for the current wave. Number of spawn
   * points scales with wave: 1-2 early, up to 4-5 in late waves.
   */
  _buildWaveSpawnPoints(waveNum) {
    const spawnY = this.grid.missileSpawnY();
    // Number of concurrent spawn points: scales with wave.
    let spawnPointCount;
    if (waveNum < 2) spawnPointCount = 1;
    else if (waveNum < 5) spawnPointCount = 2;
    else if (waveNum < 9) spawnPointCount = 3;
    else if (waveNum < 14) spawnPointCount = 4;
    else spawnPointCount = 5;

    this.spawnPoints = buildDefaultSpawnPoints(this.grid.width, spawnY, waveNum, spawnPointCount);

    for (const sp of this.spawnPoints) {
      Logger.info(
        `[Missiles]   spawn point: ${sp.id} at (${sp.x},${sp.y}) interval=${sp.interval}ms`
      );
    }
  }

  /**
   * Per-frame tick. Updates spawn points, targets, bases, and
   * advances any other enemy systems.
   */
  update(deltaMs) {
    if (this.frozen) return;

    // Age out recent-spawn entries.
    for (let i = this.recentSpawns.length - 1; i >= 0; i--) {
      this.recentSpawns[i].ttl -= deltaMs;
      if (this.recentSpawns[i].ttl <= 0) this.recentSpawns.splice(i, 1);
    }

    // Update targets and bases (re-imprint, emit, move).
    this._updateTargets(deltaMs);
    this._updateBases(deltaMs);
    this._updateDesignedBases(deltaMs);
    this._updateDesignedSpawners(deltaMs);

    // Tick wave-based default spawn points.
    if (this.spawnPoints.length > 0 && this.emittedMissiles < this.targetMissiles) {
      this._updateSpawnPoints(deltaMs);
    }
  }

  /**
   * Tick each spawn point's cooldown and emit gliders when ready.
   */
  _updateSpawnPoints(deltaMs) {
    for (const sp of this.spawnPoints) {
      if (!sp.enabled) continue;
      if (this.emittedMissiles >= this.targetMissiles) break;

      sp.cooldown -= deltaMs;
      if (sp.cooldown <= 0) {
        const emitted = this._emitFromSpawnPoint(sp);
        if (emitted) {
          this.emittedMissiles++;
          sp.emitCount++;
          sp.cooldown = sp.interval;
          Logger.debug(
            `[Missiles] ${sp.id} emitted glider #${sp.emitCount} (wave total: ${this.emittedMissiles}/${this.targetMissiles})`
          );
        } else {
          // Spawn blocked — retry quickly to apply back-pressure.
          sp.cooldown = Math.min(150, sp.interval * 0.2);
          Logger.debug(`[Missiles] ${sp.id} blocked, retrying soon.`);
        }
      }
    }
  }

  /**
   * Emit one glider from the given spawn point. Returns true if
   * the spawn area is clear and the glider was placed.
   */
  _emitFromSpawnPoint(sp) {
    const g = this.grid;
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;

    // Check spawn area is clear (pattern footprint + 1-cell halo).
    for (let dy = -1; dy <= sp.patternHeight; dy++) {
      for (let dx = -1; dx <= sp.patternWidth; dx++) {
        const px = sp.x + dx;
        const py = sp.y + dy;
        if (py < 0 || py >= g.height) continue;
        if (px < 0 || px >= g.width) continue;
        const t = g.get(px, py);
        if (t === CELL_TYPE.MISSILE || t === CELL_TYPE.DEFENSE) {
          Logger.debug(`[Missiles] ${sp.id} spawn blocked: cell at (${px},${py}) is type ${t}.`);
          return false;
        }
      }
    }

    // Stamp the glider.
    let placed = 0;
    for (const [dx, dy] of sp.pattern) {
      const px = sp.x + dx;
      const py = sp.y + dy;
      if (!g.inBounds(px, py)) continue;
      if (g.get(px, py) !== CELL_TYPE.EMPTY) continue;
      g.set(px, py, CELL_TYPE.MISSILE);
      const wx = g.wrapX(px);
      const i = py * g.width + wx;
      g.cellColor[i] = (Math.random() * variants) | 0;
      g.cellDir[i] = DIR_DOWN;
      placed++;
    }

    if (placed === 0) {
      Logger.warn(`[Missiles] ${sp.id} placed 0 cells despite clear area check!`);
      return false;
    }

    this.recentSpawns.push({ x: sp.x, y: sp.y, ttl: 2000 });
    if (this.onMissileSpawn) {
      this.onMissileSpawn(
        sp.x + sp.patternWidth / 2,
        sp.y + sp.patternHeight / 2,
        sp.patternWidth,
        sp.patternHeight
      );
    }
    Logger.debug(`[Missiles] ${sp.id} placed ${placed} cells at (${sp.x},${sp.y}).`);
    return true;
  }

  /**
   * Wave is complete when:
   *   - All target missiles emitted (default game) OR all spawners destroyed (custom)
   *   - No live missile cells remain on the grid
   *   - All targets, bases, designed bases, designed spawners destroyed
   */
  isWaveComplete() {
    // For default game: must have emitted all target missiles.
    if (!this.hasCustomContent() && this.emittedMissiles < this.targetMissiles) {
      return false;
    }
    // For custom: must have destroyed all designed spawners.
    if (this._designedSpawners.some((s) => s.alive)) return false;
    // Live threats remaining?
    if (this.targets.some((t) => t.alive)) return false;
    if (this.bases.some((b) => b.alive)) return false;
    if (this._designedBases.some((b) => b.alive)) return false;
    // Any missile cells still flying?
    const cells = this.grid.cells;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === CELL_TYPE.MISSILE) return false;
    }
    return true;
  }

  // ============================================================
  // TARGET EMPLACEMENTS (legacy support)
  // ============================================================

  _updateTargets(deltaMs) {
    const g = this.grid;
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      if (!t.alive) continue;
      let alive = 0;
      for (const [dx, dy] of TARGET_PATTERN) {
        const px = t.x + dx,
          py = t.y + dy;
        if (g.inBounds(px, py) && g.get(px, py) === CELL_TYPE.MISSILE) alive++;
      }
      if (alive < Math.ceil(TARGET_PATTERN.length / 2)) {
        t.alive = false;
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
        if (this.onTargetDestroyed) this.onTargetDestroyed(t.x + 2, t.y + 2);
        this.targets.splice(i, 1);
        continue;
      }
      // Re-imprint.
      const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
      for (const [dx, dy] of TARGET_PATTERN) {
        const px = t.x + dx,
          py = t.y + dy;
        if (g.inBounds(px, py)) {
          const idx = py * g.width + g.wrapX(px);
          if (g.cells[idx] === CELL_TYPE.EMPTY || g.cells[idx] === CELL_TYPE.MISSILE) {
            g.cells[idx] = CELL_TYPE.MISSILE;
            g.cellAge[idx] = 0;
            g.cellColor[idx] = (idx * 7) % variants;
            g.cellDir[idx] = 0;
          }
        }
      }
      t.emitCooldown -= deltaMs;
      if (t.emitCooldown <= 0) {
        this._targetEmitGlider(t);
        t.emitCooldown = 2500 + Math.random() * 1500;
      }
    }
  }

  _targetEmitGlider(t) {
    const pattern = Math.random() < 0.5 ? SE_GLIDER : SW_GLIDER;
    const baseX = t.x;
    const baseY = t.y + 5;
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

  // ============================================================
  // PROCEDURAL BASES (default game)
  // ============================================================

  _spawnBasesForWave(waveNum) {
    if (!CONFIG.BASE_SPAWN_ENABLED) return;
    const bz = this.grid.baseZoneBounds();
    if (!bz) return;
    const desired = Math.min(
      CONFIG.BASE_SPAWN_MAX | 0,
      Math.round(CONFIG.BASE_SPAWN_COUNT_BASE + waveNum * CONFIG.BASE_SPAWN_COUNT_INC)
    );
    Logger.info(`[Missiles] Spawning ${desired} procedural base(s) for wave ${waveNum + 1}.`);
    for (let i = 0; i < desired; i++) {
      this._spawnRandomBase(bz);
    }
  }

  _spawnRandomBase(bz) {
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
    let pw = 0,
      ph = 0;
    for (const [dx, dy] of spec.pattern) {
      if (dx + 1 > pw) pw = dx + 1;
      if (dy + 1 > ph) ph = dy + 1;
    }
    const minY = bz.minY;
    const maxY = bz.maxY - ph + 1;
    if (maxY < minY) return false;
    const MAX_ATTEMPTS = 20;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const x = 2 + Math.floor(Math.random() * (g.width - pw - 4));
      const y = minY + Math.floor(Math.random() * (maxY - minY + 1));
      if (!this._isSpawnClear(x, y, pw, ph, 2)) continue;
      if (this._overlapsExistingBase(x, y, pw, ph, 2)) continue;
      const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
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
        moveCooldown: dir === DIR_EAST || dir === DIR_WEST ? 600 + Math.random() * 200 : 0,
        dir,
      };
      this.bases.push(base);
      this.recentSpawns.push({ x, y, ttl: 3000 });
      if (this.onBaseSpawn) this.onBaseSpawn(x + pw / 2, y + ph / 2, spec.kind);
      else if (this.onTargetSpawn) this.onTargetSpawn(x + pw / 2, y + ph / 2);
      Logger.info(`[Missiles]   placed ${spec.kind} at (${x},${y}).`);
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

  _updateBases(deltaMs) {
    const g = this.grid;
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    for (let i = this.bases.length - 1; i >= 0; i--) {
      const b = this.bases[i];
      if (!b.alive) continue;
      let alive = 0;
      for (const [dx, dy] of b.pattern) {
        const px = b.x + dx,
          py = b.y + dy;
        if (g.inBounds(px, py) && g.get(px, py) === CELL_TYPE.MISSILE) alive++;
      }
      const threshold = Math.ceil(b.pattern.length / 2);
      if (alive < threshold) {
        b.alive = false;
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
        if (this.onBaseDestroyed) this.onBaseDestroyed(b.x + b.w / 2, b.y + b.h / 2, b.kind);
        else if (this.onTargetDestroyed) this.onTargetDestroyed(b.x + b.w / 2, b.y + b.h / 2);
        Logger.info(`[Missiles] base destroyed: ${b.kind} at (${b.x},${b.y}).`);
        this.bases.splice(i, 1);
        continue;
      }
      if (b.dir === DIR_EAST || b.dir === DIR_WEST) {
        b.moveCooldown -= deltaMs;
        if (b.moveCooldown <= 0) {
          this._moveCruiser(b);
          b.moveCooldown = 600 + Math.random() * 200;
        }
      }
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
      if (b.kind === 'fortress' || b.kind === 'bunker') {
        b.emitCooldown -= deltaMs;
        if (b.emitCooldown <= 0) {
          this._baseEmitGlider(b);
          b.emitCooldown = (b.kind === 'fortress' ? 2200 : 3000) + Math.random() * 1500;
        }
      }
    }
  }

  _moveCruiser(b) {
    const g = this.grid;
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
    const dx = b.dir === DIR_EAST ? 1 : -1;
    b.x = (((b.x + dx) % g.width) + g.width) % g.width;
  }

  _baseEmitGlider(b) {
    const pattern = Math.random() < 0.5 ? SE_GLIDER : SW_GLIDER;
    const buffer = Math.max(1, CONFIG.BASE_GLIDER_BUFFER | 0);
    const baseX = b.x;
    const baseY = b.y + b.h + buffer;
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

  // ============================================================
  // DESIGNER-PLACED BASES (custom levels)
  // ============================================================

  _spawnDesignedBases() {
    if (this._customBases.length === 0) return;
    const g = this.grid;
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    for (const spec of this._customBases) {
      if (!Array.isArray(spec.cells) || spec.cells.length === 0) continue;
      for (let dy = -1; dy <= spec.height; dy++) {
        for (let dx = -1; dx <= spec.width; dx++) {
          const px = spec.x + dx,
            py = spec.y + dy;
          if (!g.inBounds(px, py)) continue;
          const i = py * g.width + g.wrapX(px);
          if (g.cells[i] === CELL_TYPE.CITY) continue;
          g.cells[i] = CELL_TYPE.EMPTY;
          g.cellAge[i] = 0;
          g.cellDir[i] = 0;
        }
      }
      for (const [dx, dy] of spec.cells) {
        const px = spec.x + dx,
          py = spec.y + dy;
        if (!g.inBounds(px, py)) continue;
        g.set(px, py, CELL_TYPE.MISSILE);
        const i = py * g.width + g.wrapX(px);
        g.cellColor[i] = (i * 7) % variants;
        g.cellDir[i] = 0;
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
      Logger.info(`[Missiles]   designed base "${designed.name}" at (${spec.x},${spec.y}).`);
    }
  }

  /**
   * Stamp designer spawners onto the grid AND register them as
   * spawn points for emission. Unlike v1, designed spawners are
   * just spawn points with a visible static pattern marker.
   */
  _spawnDesignedSpawners() {
    if (this._customSpawners.length === 0) return;
    const g = this.grid;
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    for (const spec of this._customSpawners) {
      if (!Array.isArray(spec.cells) || spec.cells.length === 0) continue;
      const interval = spec.interval > 0 ? spec.interval : 2000;
      // Clear footprint + halo and stamp the pattern marker.
      for (let dy = -1; dy <= spec.height; dy++) {
        for (let dx = -1; dx <= spec.width; dx++) {
          const px = spec.x + dx,
            py = spec.y + dy;
          if (!g.inBounds(px, py)) continue;
          const i = py * g.width + g.wrapX(px);
          if (g.cells[i] === CELL_TYPE.CITY) continue;
          g.cells[i] = CELL_TYPE.EMPTY;
          g.cellAge[i] = 0;
          g.cellDir[i] = 0;
        }
      }
      for (const [dx, dy] of spec.cells) {
        const px = spec.x + dx,
          py = spec.y + dy;
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
        cooldown: 500 + Math.random() * interval,
        alive: true,
        _damage: 0,
        emitCount: 0,
      });
      Logger.info(
        `[Missiles]   designed spawner "${spec.name || spec.patternId}" at (${spec.x},${spec.y}) interval=${interval}ms.`
      );
    }
  }

  _updateDesignedBases(_deltaMs) {
    if (this._designedBases.length === 0) return;
    const g = this.grid;
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    for (let i = this._designedBases.length - 1; i >= 0; i--) {
      const b = this._designedBases[i];
      if (!b.alive) continue;
      // Refresh cell ages so designer-placed bases don't age out from
      // CONFIG.MISSILE_MAX_AGE_TICKS. The base lives until its cells
      // are killed by neighbor rules or the player.
      for (const [dx, dy] of b.cells) {
        const px = b.x + dx,
          py = b.y + dy;
        if (!g.inBounds(px, py)) continue;
        const idx = py * g.width + g.wrapX(px);
        if (g.cells[idx] === CELL_TYPE.MISSILE) {
          g.cellAge[idx] = 1; // keep young
        }
      }
      // Designed bases evolve naturally via Life rules. We track
      // "alive-ness" by counting how many of the originally-stamped
      // footprint cells still contain MISSILE cells. Once that falls
      // below a threshold, the base is considered destroyed.
      //
      // Note: this only catches bases that decay AT their original
      // location. Spaceship-type bases (MWSS etc.) will move out of
      // their footprint and naturally trigger "destruction" here even
      // though they're alive elsewhere on the grid. That's intentional
      // — once a designed base leaves its anchor, it's no longer
      // tracked as a destructible objective; the player just has to
      // deal with whatever it spawned/became.
      let liveCellCount = 0;
      for (const [dx, dy] of b.cells) {
        const px = b.x + dx,
          py = b.y + dy;
        if (!g.inBounds(px, py)) continue;
        const idx = py * g.width + g.wrapX(px);
        if (g.cells[idx] === CELL_TYPE.MISSILE) liveCellCount++;
      }
      // Initialize "anchor reached" tracker so we don't immediately
      // destroy bases that intentionally vacate their start position
      // (e.g. spaceships). We give them a 30-tick grace period before
      // we start tracking decay-at-anchor.
      if (b._lifeTicks === undefined) b._lifeTicks = 0;
      b._lifeTicks++;
      const aliveThreshold = Math.max(1, Math.ceil(b.cells.length / 3));
      if (b._lifeTicks > 30 && liveCellCount < aliveThreshold) {
        b.alive = false;
        if (this.onBaseDestroyed) {
          this.onBaseDestroyed(b.x + b.w / 2, b.y + b.h / 2, 'designed');
        }
        Logger.info(
          `[Missiles] designed base "${b.name}" destroyed (${liveCellCount}/${b.cells.length} cells remain at anchor after ${b._lifeTicks} ticks).`
        );
        this._designedBases.splice(i, 1);
        continue;
      }
      // No re-imprinting! Let the base evolve naturally via Life rules.
      // If it's a spaceship pattern, it will move on its own.
      // If it's a still life or oscillator, it will stay put.
      // If player defenses chew through it, it will naturally decay.
    }
  }

  /**
   * Designed spawners: emit gliders periodically while alive.
   * Damage tracking + halo clearing keeps them stable against
   * Life rule erosion.
   */
  _updateDesignedSpawners(deltaMs) {
    if (this._designedSpawners.length === 0) return;
    const g = this.grid;
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    for (let i = this._designedSpawners.length - 1; i >= 0; i--) {
      const s = this._designedSpawners[i];
      if (!s.alive) continue;
      // Refresh cell ages so designer-placed spawners (guns, etc.)
      // don't age out. Their cells stay young indefinitely.
      for (const [dx, dy] of s.cells) {
        const px = s.x + dx,
          py = s.y + dy;
        if (!g.inBounds(px, py)) continue;
        const idx = py * g.width + g.wrapX(px);
        if (g.cells[idx] === CELL_TYPE.MISSILE) {
          g.cellAge[idx] = 1;
        }
      }

      // Track spawner aliveness the same way as bases: count how many
      // originally-stamped cells still exist as MISSILE at the anchor.
      // Once below a threshold (and past a grace period for moving
      // spawners like spaceships), the spawner is destroyed.
      let liveCellCount = 0;
      for (const [dx, dy] of s.cells) {
        const px = s.x + dx,
          py = s.y + dy;
        if (!g.inBounds(px, py)) continue;
        const idx = py * g.width + g.wrapX(px);
        if (g.cells[idx] === CELL_TYPE.MISSILE) liveCellCount++;
      }
      if (s._lifeTicks === undefined) s._lifeTicks = 0;
      s._lifeTicks++;
      const aliveThreshold = Math.max(1, Math.ceil(s.cells.length / 3));
      if (s._lifeTicks > 30 && liveCellCount < aliveThreshold) {
        s.alive = false;
        if (this.onBaseDestroyed) {
          this.onBaseDestroyed(s.x + s.w / 2, s.y + s.h / 2, 'spawner');
        }
        Logger.info(
          `[Missiles] designed spawner "${s.name}" destroyed (${liveCellCount}/${s.cells.length} cells at anchor) after emitting ${s.emitCount} glider(s).`
        );
        this._designedSpawners.splice(i, 1);
        continue;
      }

      // No re-imprinting! Let the spawner pattern evolve naturally.

      // Emit on cooldown.
      s.cooldown -= deltaMs;
      if (s.cooldown <= 0) {
        const emitted = this._designedSpawnerEmit(s);
        if (emitted) {
          s.emitCount++;
          s.cooldown = s.interval;
          Logger.debug(`[Missiles] designed spawner "${s.name}" emitted glider #${s.emitCount}.`);
        } else {
          // Emit blocked — wait a short time and retry. We do NOT
          // emit in a different location. The user designed this
          // spawn point; we wait for it to clear.
          s.cooldown = Math.min(300, s.interval * 0.15);
        }
      }
    }
  }

  _designedSpawnerEmit(s) {
    const g = this.grid;
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    // Designed spawners emit copies of their own pattern.
    const pattern = s.cells;
    if (!pattern || pattern.length === 0) {
      Logger.warn(`[Missiles] designed spawner "${s.name}" has no cells to emit.`);
      return false;
    }
    let pw = 0,
      ph = 0;
    for (const [dx, dy] of pattern) {
      if (dx + 1 > pw) pw = dx + 1;
      if (dy + 1 > ph) ph = dy + 1;
    }
    const buffer = 3;
    // Emit centered horizontally below the spawner footprint.
    const baseX = s.x + Math.floor((s.w - pw) / 2);
    const baseY = s.y + s.h + buffer;
    if (baseY + ph >= g.height) {
      Logger.debug(`[Missiles] designed spawner "${s.name}" emit blocked: off-grid bottom.`);
      return false;
    }
    // Check the entire emit footprint + 1-cell halo is clear. If ANY
    // cell is occupied by anything (MISSILE, DEFENSE, CITY, EXPLOSION),
    // abort and let the caller schedule a retry. We do NOT emit
    // elsewhere.
    for (let dy = -1; dy <= ph; dy++) {
      for (let dx = -1; dx <= pw; dx++) {
        const px = baseX + dx,
          py = baseY + dy;
        if (!g.inBounds(px, py)) continue;
        const t = g.get(px, py);
        if (t !== CELL_TYPE.EMPTY) {
          Logger.debug(
            `[Missiles] designed spawner "${s.name}" emit blocked at (${px},${py}) type=${t}. Will retry.`
          );
          return false;
        }
      }
    }
    let placed = 0;
    for (const [dx, dy] of pattern) {
      const px = baseX + dx,
        py = baseY + dy;
      if (g.inBounds(px, py) && g.get(px, py) === CELL_TYPE.EMPTY) {
        g.set(px, py, CELL_TYPE.MISSILE);
        const wx = g.wrapX(px);
        const i = py * g.width + wx;
        g.cellColor[i] = (Math.random() * variants) | 0;
        g.cellDir[i] = DIR_DOWN;
        g.cellAge[i] = 1;
        placed++;
      }
    }
    if (placed > 0 && this.onMissileSpawn) {
      this.onMissileSpawn(baseX + pw / 2, baseY + ph / 2, pw, ph);
    }
    Logger.debug(
      `[Missiles] designed spawner "${s.name}" emitted ${placed} cells at (${baseX},${baseY}).`
    );
    return placed > 0;
  }

  // ============================================================
  // UTILITY
  // ============================================================

  _isSpawnClear(x, y, pw, ph, clearance) {
    const g = this.grid;
    const minX = x - clearance;
    const maxX = x + pw - 1 + clearance;
    const minY = Math.max(0, y - clearance);
    const maxY = Math.min(g.height - 1, y + ph - 1 + clearance);
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const t = g.get(cx, cy);
        if (t === CELL_TYPE.MISSILE || t === CELL_TYPE.DEFENSE) return false;
      }
    }
    for (const rs of this.recentSpawns) {
      let dx = Math.abs(rs.x - x);
      if (dx > g.width / 2) dx = g.width - dx;
      const dy = Math.abs(rs.y - y);
      if (dx <= pw + clearance && dy <= ph + clearance) return false;
    }
    return true;
  }
}
