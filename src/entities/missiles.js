import {CONFIG, CELL_TYPE} from '../config.js';

// Glider pattern definitions. Each is a list of [dx, dy] offsets from a spawn anchor.
// SE = R-type (Conway glider moving south-east)
const SE_GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
// SW = L-type (mirrored Conway glider moving south-west)
const SW_GLIDER = [[1, 0], [0, 1], [0, 2], [1, 2], [2, 2]];
// NOTE: Heavy descenders were removed; the GLIDER_HEAVY flag now spawns
// stationary TARGET emplacements instead (see Missiles.spawnTarget).
// A target is a small stable block of MISSILE cells that periodically
// emits gliders downward and refuses to die from Life rules. It only
// disappears when the player destroys it with defenses.
const TARGET_PATTERN = [
  [1, 0], [2, 0],
  [0, 1], [3, 1],
  [0, 2], [3, 2],
  [1, 3], [2, 3],
];
// Lightweight Spaceship variants — true GoL spaceships, traveling diagonally downward.
// LWSS-SE: travels southeast
const LWSS_SE = [[0, 0], [3, 0], [4, 1], [0, 2], [4, 2], [1, 3], [2, 3], [3, 3], [4, 3]];
// LWSS-SW: mirrored, travels southwest
const LWSS_SW = [[1, 0], [4, 0], [0, 1], [0, 2], [4, 2], [0, 3], [1, 3], [2, 3], [3, 3]];
// Middleweight Spaceship variants
const MWSS_SE = [[0, 0], [3, 0], [4, 1], [0, 2], [4, 2], [4, 3], [1, 4], [2, 4], [3, 4], [4, 4]];
const MWSS_SW = [[1, 0], [4, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 4], [2, 4], [3, 4]];
// Twin glider: two SE gliders side-by-side for synchronized attacks.
const TWIN_GLIDER = [
  [1, 0], [2, 1], [0, 2], [1, 2], [2, 2],
  [6, 0], [7, 1], [5, 2], [6, 2], [7, 2],
];
// Mini glider gun: a compact Gosper Glider Gun. Plants itself near the top
// of the playfield and produces gliders that descend toward the cities.
// This is the standard 36x9 Gosper Gun (offsets [dx, dy]).
const GOSPER_GUN = [
  [24, 0],
  [22, 1], [24, 1],
  [12, 2], [13, 2], [20, 2], [21, 2], [34, 2], [35, 2],
  [11, 3], [15, 3], [20, 3], [21, 3], [34, 3], [35, 3],
  [0, 4], [1, 4], [10, 4], [16, 4], [20, 4], [21, 4],
  [0, 5], [1, 5], [10, 5], [14, 5], [16, 5], [17, 5], [22, 5], [24, 5],
  [10, 6], [16, 6], [24, 6],
  [11, 7], [15, 7],
  [12, 8], [13, 8],
];

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
    this.onTargetSpawn = null;   // (cx, cy) => void
    this.onTargetDestroyed = null; // (cx, cy) => void
    // When true, enemy missile spawning + target emission is paused.
    // Set by Time Stop ability. Defenses are unaffected.
    this.frozen = false;
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
  }

  update(deltaMs) {
    // Time-stop: skip all enemy spawning and target ticking entirely.
    if (this.frozen) return;
    // Age out recent-spawn entries.
    for (let i = this.recentSpawns.length - 1; i >= 0; i--) {
      this.recentSpawns[i].ttl -= deltaMs;
      if (this.recentSpawns[i].ttl <= 0) this.recentSpawns.splice(i, 1);
    }
    // Update targets: re-stamp them so Life rules can't kill them, and
    // let them periodically emit gliders.
    this._updateTargets(deltaMs);
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
        const px = t.x + dx, py = t.y + dy;
        if (g.inBounds(px, py) && g.get(px, py) === CELL_TYPE.MISSILE) {
          alive++;
        }
      }
      // If more than half the cells are gone, the target is destroyed.
      if (alive < Math.ceil(TARGET_PATTERN.length / 2)) {
        t.alive = false;
        // Clear remaining cells.
        for (const [dx, dy] of TARGET_PATTERN) {
          const px = t.x + dx, py = t.y + dy;
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
        const px = t.x + dx, py = t.y + dy;
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

  _targetEmitGlider(t) {
    // Drop an SE or SW glider just below the target.
    const pattern = Math.random() < 0.5 ? SE_GLIDER : SW_GLIDER;
    const baseX = t.x;
    const baseY = t.y + 5; // below the target footprint
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    let placed = 0;
    for (const [dx, dy] of pattern) {
      const px = baseX + dx, py = baseY + dy;
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
          const px = x + dx, py = y + dy;
          if (g.inBounds(px, py)) {
            g.set(px, py, CELL_TYPE.MISSILE);
            const i = py * g.width + g.wrapX(px);
            g.cellColor[i] = (i * 7) % variants;
            g.cellDir[i] = 0;
          }
        }
        const target = {
          x, y, w: 4, h: 4,
          emitCooldown: 1500 + Math.random() * 1500,
          alive: true,
        };
        this.targets.push(target);
        this.recentSpawns.push({x, y, ttl: 3000});
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
    // Spawn below the return-fire dead zone so freshly-spawned missile
    // cells never trigger false-positive "return fire" events. The dead
    // zone is defined by CONFIG.RETURN_FIRE_ZONE_{MIN,MAX}_Y and must
    // remain strictly above this spawn y.
    const y = Math.max(
      CONFIG.RETURN_FIRE_ZONE_MAX_Y + 1,
      1
    );
    // If heavy targets are enabled, occasionally (10%) spawn a target
    // emplacement instead of a regular glider.
    if (CONFIG.GLIDER_HEAVY && Math.random() < 0.10) {
      if (this.spawnTarget()) return true;
    }


    const patterns = this._enabledPatterns();
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    const variants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    // Compute pattern bounding box for clearance checks.
    let pw = 0, ph = 0;
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
    this.recentSpawns.push({x, y, ttl: 3000});
    // Fire spawn FX callback.
    if (this.onMissileSpawn) {
      this.onMissileSpawn(x + pw / 2, y + ph / 2, pw, ph);
    }
    return true;
  }

  isWaveComplete() {
    if (this.spawned < this.toSpawn) return false;
    // Targets count as live threats — wave isn't complete until they're gone.
    if (this.targets.some(t => t.alive)) return false;
    const cells = this.grid.cells;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === CELL_TYPE.MISSILE) return false;
    }
    return true;
  }
}
