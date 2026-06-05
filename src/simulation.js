import {CONFIG, CELL_TYPE} from './config.js';
  import {Logger} from './logger.js';
  import {CpuSimBackend} from './sim/cpuBackend.js';
  import {GpuSimBackend} from './sim/gpuBackend.js';
  import {HashlifeCache} from './sim/hashlife.js';

/**
 * Simulation runs the Game of Life tick with extensions:
 * - City cells are immune to death
 * - Missile cells and defense cells annihilate on contact (explosion)
 * - Missile cells have biased downward movement (handled as glider pattern naturally)
 *
 * Architecture: this class owns the tick orchestration and all game-specific
 * rules (collisions, age, cascades, return-fire). The raw Life step is
 * delegated to a pluggable backend (CPU/GPU). A Hashlife memoization cache
 * accelerates regions of pure-defense activity on very large grids.
 */
export class Simulation {
  constructor(grid) {
    this.grid = grid;
    this.next = new Uint8Array(grid.cells.length);
    this.nextAge = new Uint8Array(grid.cells.length);
    this.nextColor = new Uint8Array(grid.cells.length);
    this.nextDir = new Uint8Array(grid.cells.length);
    this.tickCount = 0;
    this.onMissileDestroyed = null;
    this.onCityDestroyed = null;
    this.onMissileReturn = null; // (x, y, kind) - kind: 'return' | 'bounce'
    this.onAnnihilation = null;
    this.onCityHit = null;
     this.onBreach = null; // (x, y) - missile reached the rear dead zone
    this.returnFireFired = new Uint8Array(grid.cells.length);
     this.breachFired = new Uint8Array(grid.cells.length);
    // When true, missile cells are frozen (no aging, no Life evolution,
    // no return-fire detection). Defense cells continue to evolve normally.
    // Used by Time Stop ability and the M:N timestep ratio.
    this.freezeEnemies = false;
    // When true, defense cells are frozen. Used by the M:N timestep ratio
    // when attackers should tick while defenders are skipped this step.
    this.freezeDefenses = false;

    // Scratch buffers reused across ticks to avoid GC churn.
    this._annihilated = new Uint8Array(grid.cells.length);
    this._ageDespawn = new Uint8Array(grid.cells.length);
    // Neighbor count buffers (one per type) used by the fast CPU path.
    this._lifeNbr = new Uint8Array(grid.cells.length);
    this._missileNbr = new Uint8Array(grid.cells.length);
    this._defenseNbr = new Uint8Array(grid.cells.length);

    this._initBackend();
   this.hashlife = new HashlifeCache();
   // Note: hashlife is only used when CONFIG.SIM_HASHLIFE_ENABLED is true.
   // The cache is kept allocated so it can be re-enabled at runtime without
   // a full rebuild; it just won't be consulted when the flag is false.
  }

  _initBackend() {
    const w = this.grid.width;
    const h = this.grid.height;
    const cells = w * h;
    // Selection policy:
    //   CONFIG.SIM_BACKEND='cpu'|'gpu'|'auto' (default auto)
    //   auto: GPU if grid >= 200x200 AND WebGL2 available; else CPU.
    let mode = (CONFIG.SIM_BACKEND || 'auto').toLowerCase();
    if (mode === 'auto') {
      mode = (cells >= 40000) ? 'gpu' : 'cpu';
    }
    if (mode === 'gpu') {
      try {
        this.backend = new GpuSimBackend(w, h);
        Logger.info(`Sim backend: GPU (WebGL2) for ${w}x${h} grid.`);
        return;
      } catch (e) {
        Logger.warn('GPU backend unavailable; falling back to CPU.', e);
      }
    }
    this.backend = new CpuSimBackend(w, h);
    Logger.info(`Sim backend: CPU (bitpacked) for ${w}x${h} grid.`);
  }

  // Resize internal buffers if the grid was rebuilt (e.g. resolution change).
  _ensureBuffers() {
    const n = this.grid.cells.length;
    if (this.next.length !== n) {
      this.next = new Uint8Array(n);
      this.nextAge = new Uint8Array(n);
      this.nextColor = new Uint8Array(n);
      this.nextDir = new Uint8Array(n);
      this.returnFireFired = new Uint8Array(n);
       this.breachFired = new Uint8Array(n);
      this._annihilated = new Uint8Array(n);
      this._ageDespawn = new Uint8Array(n);
      this._lifeNbr = new Uint8Array(n);
      this._missileNbr = new Uint8Array(n);
      this._defenseNbr = new Uint8Array(n);
      // Backend also needs to resize.
      this._initBackend();
      this.hashlife.clear();
    }
  }

  tick() {
    this._ensureBuffers();
    const g = this.grid;
    const w = g.width;
    const h = g.height;
    const cells = g.cells;
    const age = g.cellAge;
    const color = g.cellColor;
    const next = this.next;
    const nextAge = this.nextAge;
    const nextColor = this.nextColor;
    const nextDir = this.nextDir;
    next.fill(0);
    nextAge.fill(0);
    nextColor.fill(0);
    nextDir.fill(0);

         const UNLIMITED = CONFIG.UNLIMITED_SENTINEL || 999999;
         const defenseMaxAge = CONFIG.CELL_MAX_AGE_TICKS;
         const missileMaxAge = CONFIG.MISSILE_MAX_AGE_TICKS;
         // When set to the sentinel, treat as effectively infinite (skip age expiry).
         const defenseAgeUnlimited = defenseMaxAge >= UNLIMITED;
         const missileAgeUnlimited = missileMaxAge >= UNLIMITED;
    const cascadeTicks = CONFIG.MISSILE_CASCADE_TICKS;
    const defenseVariants = CONFIG.COLORS.DEFENSE_VARIANTS.length;
    const missileVariants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    const dzMinY = Math.max(0, CONFIG.RETURN_FIRE_ZONE_MIN_Y | 0);
    const dzMaxY = Math.min(h - 1, CONFIG.RETURN_FIRE_ZONE_MAX_Y | 0);
    const freezeEnemies = !!this.freezeEnemies;
    const freezeDefenses = !!this.freezeDefenses;


    // --- Step 1: Pre-compute neighbor counts ONCE per tick. ---
    // This replaces the old per-cell countTypeNeighbors calls which did
    // up to 24 grid lookups per cell. The new path makes 3 passes over
    // the grid producing three neighbor-count arrays. For a 200x200 grid
    // this is ~5-8x faster than the old approach.
    this.backend.computeNeighborCounts(
      cells, w, h,
      this._lifeNbr, this._missileNbr, this._defenseNbr
    );
    const lifeNbr = this._lifeNbr;
    const missileNbr = this._missileNbr;
    const defenseNbr = this._defenseNbr;

    // --- Step 2: Collision detection (missile↔defense, missile↔city). ---
    const annihilated = this._annihilated;
    annihilated.fill(0);
    const hardcore = CONFIG.HARDCORE_MODE;
    // City neighbor count is small enough to compute inline only where needed.
    for (let y = 0; y < h; y++) {
      const rowBase = y * w;
      for (let x = 0; x < w; x++) {
        const i = rowBase + x;
        const t = cells[i];
        if (t === CELL_TYPE.MISSILE) {
          // If enemies are frozen, they can't collide with anything.
          if (freezeEnemies) continue;
          if (defenseNbr[i] > 0) {
            annihilated[i] = 1;
            this._annihilateNeighborsOfType(x, y, CELL_TYPE.DEFENSE, 1);
            if (this.onMissileDestroyed) this.onMissileDestroyed();
            if (this.onAnnihilation) this.onAnnihilation(x, y);
          }
          if (this._countCityNeighbors(x, y) > 0) {
            annihilated[i] = 1;
            this._annihilateNeighborsOfType(x, y, CELL_TYPE.CITY, 2, 'missile');
          }
        } else if (t === CELL_TYPE.DEFENSE && hardcore) {
          if (freezeDefenses) continue;
          if (this._countCityNeighbors(x, y) > 0) {
            annihilated[i] = 1;
            this._annihilateNeighborsOfType(x, y, CELL_TYPE.CITY, 2, 'defense');
          }
        }
      }
    }

    // --- Step 3: Missile age expiration + cascade propagation. ---
    const ageDespawn = this._ageDespawn;
    ageDespawn.fill(0);
    // When enemies are frozen, skip aging entirely.
     if (!freezeEnemies && !missileAgeUnlimited) {
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] === CELL_TYPE.MISSILE && age[i] >= missileMaxAge) {
          ageDespawn[i] = 1;
        }
      }
      // Cascade: any missile within cascadeTicks of expiry adjacent to an
      // already-despawning missile also despawns. Iterate until stable.
      // Use a worklist approach for efficiency on large grids.
      const cascadeThreshold = missileMaxAge - cascadeTicks;
      const worklist = [];
      for (let i = 0; i < cells.length; i++) {
        if (ageDespawn[i]) worklist.push(i);
      }
      while (worklist.length > 0) {
        const i = worklist.pop();
        const y = (i / w) | 0;
        const x = i - y * w;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = ((x + dx) % w + w) % w;
            const ni = ny * w + nx;
            if (ageDespawn[ni]) continue;
            if (cells[ni] === CELL_TYPE.MISSILE && age[ni] >= cascadeThreshold) {
              ageDespawn[ni] = 1;
              worklist.push(ni);
            }
          }
        }
      }
    }

    // --- Step 4: Apply Life rules + custom rules in a single pass. ---
    for (let y = 0; y < h; y++) {
      const rowBase = y * w;
      for (let x = 0; x < w; x++) {
        const i = rowBase + x;
        const t = cells[i];

        // City: immune to death (unless annihilated by missile).
        if (t === CELL_TYPE.CITY) {
          if (annihilated[i] === 2) {
            next[i] = CELL_TYPE.EXPLOSION;
            g.explosionTimers[i] = 6;
            if (this.onCityDestroyed) this.onCityDestroyed(x, y);
          } else {
            next[i] = CELL_TYPE.CITY;
          }
          continue;
        }

        // Explosion fade-out.
        if (t === CELL_TYPE.EXPLOSION) {
          if (g.explosionTimers[i] > 0) {
            g.explosionTimers[i]--;
            next[i] = CELL_TYPE.EXPLOSION;
          } else {
            next[i] = CELL_TYPE.EMPTY;
          }
          continue;
        }

        if (annihilated[i]) {
          next[i] = CELL_TYPE.EXPLOSION;
          g.explosionTimers[i] = 4;
          continue;
        }
        if (ageDespawn[i]) {
          next[i] = CELL_TYPE.EMPTY;
          nextAge[i] = 0;
          if (this.onMissileDestroyed) this.onMissileDestroyed();
          continue;
        }
        // Frozen missile cells: preserve exactly as-is (no aging, no Life).
        if (t === CELL_TYPE.MISSILE && freezeEnemies) {
          next[i] = CELL_TYPE.MISSILE;
          nextAge[i] = age[i]; // do not advance age
          nextColor[i] = color[i];
          nextDir[i] = g.cellDir[i];
          continue;
        }
        // Frozen defense cells: preserve exactly as-is.
        if (t === CELL_TYPE.DEFENSE && freezeDefenses) {
          next[i] = CELL_TYPE.DEFENSE;
          nextAge[i] = age[i];
          nextColor[i] = color[i];
          nextDir[i] = g.cellDir[i];
          continue;
        }


        const ln = lifeNbr[i];
        if (t === CELL_TYPE.DEFENSE || t === CELL_TYPE.MISSILE) {
          const currentAge = age[i];
          const maxForType = t === CELL_TYPE.MISSILE ? missileMaxAge : defenseMaxAge;
               const ageUnlimited = t === CELL_TYPE.MISSILE ? missileAgeUnlimited : defenseAgeUnlimited;
               if ((ln === 2 || ln === 3) && (ageUnlimited || currentAge < maxForType)) {
            next[i] = t;
            nextAge[i] = currentAge < 255 ? currentAge + 1 : 255;
            nextColor[i] = color[i];
            nextDir[i] = g.cellDir[i];
          } else {
            next[i] = CELL_TYPE.EMPTY;
            nextAge[i] = 0;
          }
        } else if (t === CELL_TYPE.EMPTY) {
          if (ln === 3) {
            const isMissile = missileNbr[i] > defenseNbr[i];
            // If enemies are frozen, suppress missile-cell birth.
            // If defenses are frozen, suppress defense-cell birth.
            if (isMissile && freezeEnemies) {
              next[i] = CELL_TYPE.EMPTY;
              continue;
            }
            if (!isMissile && freezeDefenses) {
              next[i] = CELL_TYPE.EMPTY;
              continue;
            }
            if (isMissile) {
              next[i] = CELL_TYPE.MISSILE;
              nextColor[i] = (Math.random() * missileVariants) | 0;
              nextDir[i] = 1;
            } else {
              next[i] = CELL_TYPE.DEFENSE;
              nextColor[i] = (Math.random() * defenseVariants) | 0;
              nextDir[i] = 0;
            }
            nextAge[i] = 1;
          }
        }
      }
    }

    // Swap buffers.
    const tmp = g.cells;
    g.cells = next;
    this.next = tmp;
    const tmpAge = g.cellAge;
    g.cellAge = this.nextAge;
    this.nextAge = tmpAge;
    const tmpColor = g.cellColor;
    g.cellColor = this.nextColor;
    this.nextColor = tmpColor;
    const tmpDir = g.cellDir;
    g.cellDir = this.nextDir;
    this.nextDir = tmpDir;
    this.tickCount++;

    // Skip return-fire detection when enemies are frozen — frozen missile
    // cells aren't moving, so anything in the dead zone is stale state.
    if (!freezeEnemies) {
      this._detectReturnFire(dzMinY, dzMaxY);
       this._detectBreach();
    }
  }

  _countCityNeighbors(x, y) {
    const g = this.grid;
    const w = g.width;
    const h = g.height;
    const cells = g.cells;
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = ((x + dx) % w + w) % w;
        if (cells[ny * w + nx] === CELL_TYPE.CITY) count++;
      }
    }
    return count;
  }

  _annihilateNeighborsOfType(x, y, type, marker, cityAttacker) {
    const g = this.grid;
    const w = g.width;
    const h = g.height;
    const cells = g.cells;
    const annihilated = this._annihilated;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = ((x + dx) % w + w) % w;
        const ni = ny * w + nx;
        if (cells[ni] === type) {
          annihilated[ni] = marker;
          if (type === CELL_TYPE.CITY && this.onCityHit) {
            this.onCityHit(nx, ny, cityAttacker);
          }
        }
      }
    }
  }

    _detectReturnFire(minY, maxY) {
      if (!this.onMissileReturn) return;
    const g = this.grid;
    const w = g.width;
    const h = g.height;
    const cells = g.cells;
    const fired = this.returnFireFired;
    for (let i = 0; i < fired.length; i++) {
      if (fired[i] && cells[i] !== CELL_TYPE.MISSILE && cells[i] !== CELL_TYPE.DEFENSE) {
        fired[i] = 0;
      }
    }
    for (let y = minY; y <= maxY; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const cellType = cells[i];
        if (cellType !== CELL_TYPE.MISSILE && cellType !== CELL_TYPE.DEFENSE) continue;
        if (fired[i]) continue;
        let neighbors = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dy === 0) continue;
            const ny = y + dy;
            if (ny < 0 || ny >= h) continue;
            const nx = ((x + dx) % w + w) % w;
            const nt = cells[ny * w + nx];
            if (nt === cellType) neighbors++;
          }
        }
        let kind;
        if (cellType === CELL_TYPE.DEFENSE) {
          kind = 'ricochet';
        } else {
          kind = neighbors >= 4 ? 'ricochet' : 'return';
        }
        this.onMissileReturn(x, y, kind);
        fired[i] = 1;
        if (kind === 'ricochet') {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const ny = y + dy;
              if (ny < 0 || ny >= h) continue;
              const nx = ((x + dx) % w + w) % w;
              const ni = ny * w + nx;
              if (cells[ni] === CELL_TYPE.MISSILE || cells[ni] === CELL_TYPE.DEFENSE) {
                cells[ni] = CELL_TYPE.EXPLOSION;
                g.explosionTimers[ni] = 6;
                fired[ni] = 1;
              }
            }
          }
        } else {
          cells[i] = CELL_TYPE.EXPLOSION;
          g.explosionTimers[i] = 4;
        }
      }
    }
  }
   // Detect MISSILE cells that have arrived in the rear dead zone, meaning
   // they slipped past the player's defenses without hitting a city.
   _detectBreach() {
     if (!this.onBreach) return;
     const g = this.grid;
     const w = g.width;
     const h = g.height;
     const cells = g.cells;
     const fired = this.breachFired;
     // Reset stale flags.
     for (let i = 0; i < fired.length; i++) {
       if (fired[i] && cells[i] !== CELL_TYPE.MISSILE) {
         fired[i] = 0;
       }
     }
     const minY = g.rearDeadZoneMinY();
     if (minY >= h) return;
     for (let y = minY; y < h; y++) {
       for (let x = 0; x < w; x++) {
         const i = y * w + x;
         if (cells[i] !== CELL_TYPE.MISSILE) continue;
         if (fired[i]) continue;
         this.onBreach(x, y);
         fired[i] = 1;
         // Explode it immediately so it doesn't keep marching past.
         cells[i] = CELL_TYPE.EXPLOSION;
         g.explosionTimers[i] = 6;
       }
     }
   }
}