import { CONFIG, CELL_TYPE } from './config.js';
import { Logger } from './logger.js';
import { CpuSimBackend } from './sim/cpuBackend.js';
import { GpuSimBackend } from './sim/gpuBackend.js';
import { HashlifeCache } from './sim/hashlife.js';
import { getRuleset, CompiledRuleset, CONWAY } from './rules/index.js';
import { runExoticStep, resetExoticState } from './rules/exoticEngines.js';

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
    // Compile the currently-configured ruleset.
    this._compileActiveRuleset();
    // Note: hashlife is only used when CONFIG.SIM_HASHLIFE_ENABLED is true.
    // The cache is kept allocated so it can be re-enabled at runtime without
    // a full rebuild; it just won't be consulted when the flag is false.
  }
  _compileActiveRuleset() {
    const id = CONFIG.ACTIVE_RULESET || 'conway';
    const def = getRuleset(id) || CONWAY;
    // Exotic rules: use the precompiled engine, mark for dispatch.
    if (def._exoticType && def._exoticCompiled) {
      this._rule = def._exoticCompiled;
      this._ruleId = id;
      this._isExotic = true;
      this._exoticType = def._exoticType;
      // Reset any internal state when switching to an exotic rule.
      resetExoticState(this._rule);
      Logger.info(`Sim ruleset (exotic): ${def.name} [${def._exoticType}]`);
      return;
    }
    this._rule = new CompiledRuleset(def);
    this._ruleId = id;
    this._isExotic = false;
    this._exoticType = null;
    // Inform the backend about the active neighborhood so it can
    // dispatch to the generic path for non-Moore neighborhoods.
    if (this.backend && this.backend.setNeighborhood) {
      this.backend.setNeighborhood(this._rule.neighborhood);
    }
    Logger.info(`Sim ruleset: ${def.name} (${def.notation})`);
  }

  _initBackend() {
    const w = this.grid.width;
    const h = this.grid.height;
    const cells = w * h;
    const gridShift = this.grid ? this.grid.wrapVerticalShift | 0 : 0;
    Logger.info(
      `[Sim] _initBackend() called: grid=${w}x${h}, gridShift=${gridShift}, ` +
        `current backend=${this.backend ? this.backend.constructor.name : 'none'}`
    );
    // Selection policy:
    //   CONFIG.SIM_BACKEND='cpu'|'gpu'|'auto' (default auto)
    //   auto: GPU if grid >= 200x200 AND WebGL2 available; else CPU.
    let mode = (CONFIG.SIM_BACKEND || 'auto').toLowerCase();
    if (mode === 'auto') {
      mode = cells >= 40000 ? 'gpu' : 'cpu';
    }
    // GPU backend's Moore fast path does not currently honor
    // wrapVerticalShift (Klein-bottle-style wrap). Force CPU when the
    // grid has a non-zero shift so neighbor lookups stay correct.
    if (mode === 'gpu' && gridShift !== 0) {
      Logger.info(
        `[Sim] Forcing CPU backend: wrapVerticalShift=${gridShift} ` + `is unsupported on GPU.`
      );
      mode = 'cpu';
    }
    // GPU backend currently only supports the Moore neighborhood.
    // Force CPU when an exotic neighborhood is active.
    if (mode === 'gpu') {
      const ruleId = CONFIG.ACTIVE_RULESET || 'conway';
      const def = getRuleset(ruleId);
      // Exotic rules also require CPU path.
      if (def && def._exoticType) {
        Logger.info(`Sim backend: forced CPU due to exotic rule type "${def._exoticType}".`);
        mode = 'cpu';
      } else {
        const nbhdId = def && def.neighborhood ? def.neighborhood : 'moore';
        if (nbhdId !== 'moore') {
          Logger.info(`Sim backend: forced CPU due to non-Moore neighborhood "${nbhdId}".`);
          mode = 'cpu';
        }
      }
    }
    if (mode === 'gpu') {
      try {
        this.backend = new GpuSimBackend(w, h);
        Logger.info(`Sim backend: GPU (WebGL2) for ${w}x${h} grid.`);
        this._syncWrapShiftToBackend();
        return;
      } catch (e) {
        Logger.warn('GPU backend unavailable; falling back to CPU.', e);
      }
    }
    this.backend = new CpuSimBackend(w, h);
    Logger.info(
      `Sim backend: CPU (bitpacked) for ${w}x${h} grid ` + `(wrapVerticalShift=${gridShift}).`
    );
    this._syncWrapShiftToBackend();
  }
  // Push the grid's wrapVerticalShift into the backend. Backends that
  // don't implement a setter ignore this silently.
  _syncWrapShiftToBackend() {
    if (!this.backend) return;
    const shift = this.grid ? this.grid.wrapVerticalShift | 0 : 0;
    if (typeof this.backend.setWrapVerticalShift === 'function') {
      this.backend.setWrapVerticalShift(shift);
    }
    // Also expose as a public field for backends/paths that read it directly.
    this.backend.wrapVerticalShift = shift;
    // Keep the legacy underscored name in sync for older code paths.
    this.backend._wrapVerticalShift = shift;
    // Always log when shift is non-zero so we can verify it propagated.
    if (shift !== 0) {
      // Throttle to once per second to avoid log spam.
      const now = performance.now();
      if (!this._lastShiftLog || now - this._lastShiftLog > 1000) {
        Logger.info(
          `[Sim] wrap shift active: shift=${shift}, ` +
            `backend=${this.backend.constructor.name}, ` +
            `tickCount=${this.tickCount}`
        );
        this._lastShiftLog = now;
      }
    }
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
    // Re-compile ruleset if it changed at runtime.
    if (this._ruleId !== (CONFIG.ACTIVE_RULESET || 'conway')) {
      this._compileActiveRuleset();
    }
    // Sync wrap vertical shift to backend each tick — the grid's value
    // may have changed (e.g. when loading a custom level). If we're
    // currently on GPU and the shift becomes non-zero, switch to CPU
    // since the GPU Moore fast path does not honor wrap shift.
    const desiredShift = this.grid ? this.grid.wrapVerticalShift | 0 : 0;
    const currentBackendIsGpu =
      this.backend && this.backend.constructor && this.backend.constructor.name === 'GpuSimBackend';
    if (currentBackendIsGpu && desiredShift !== 0) {
      Logger.info(
        `[Sim] tick(): switching GPU→CPU because ` +
          `wrapVerticalShift=${desiredShift} is unsupported on GPU. ` +
          `(tickCount=${this.tickCount})`
      );
      this._initBackend();
      this._syncWrapShiftToBackend();
    } else {
      this._syncWrapShiftToBackend();
    }
    // Exotic rules: dispatch to the exotic engine. The exotic engine
    // operates on a binary DEFENSE-only grid; we extract DEFENSE cells,
    // run the exotic step, and reintegrate while preserving missiles,
    // cities, and other cell types using vanilla game rules.
    if (this._isExotic) {
      this._tickExotic();
      return;
    }
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
    // Per-region age limits. A value >= UNLIMITED means "effectively infinite".
    // Note: cell age is stored in Uint8Array (max 255). Any finite limit
    // above 255 is clamped to 255 here so age comparisons work correctly.
    // Limits >= UNLIMITED stay as-is and are treated as "no limit" below.
    const clampAge = (v) => (v >= UNLIMITED ? v : Math.min(v | 0, 255));
    const defAgeF = clampAge(CONFIG.DEFENSE_AGE_FRIENDLY);
    const defAgeE = clampAge(CONFIG.DEFENSE_AGE_ENEMY);
    const defAgeN = clampAge(CONFIG.DEFENSE_AGE_NEUTRAL);
    const missAgeF = clampAge(CONFIG.MISSILE_AGE_FRIENDLY);
    const missAgeE = clampAge(CONFIG.MISSILE_AGE_ENEMY);
    const missAgeN = clampAge(CONFIG.MISSILE_AGE_NEUTRAL);
    const dzMinYBoundary = g.drawZoneMinY();
    // Enemy region = base zone (top dead zone + base zone rows).
    // Neutral region = between base zone bottom and draw zone top.
    const topDeadMax = Math.min(h - 1, CONFIG.RETURN_FIRE_ZONE_MAX_Y | 0);
    const baseZoneH = Math.max(0, CONFIG.BASE_ZONE_HEIGHT | 0);
    const enemyRegionMaxY = Math.min(h - 1, topDeadMax + baseZoneH);
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
      cells,
      w,
      h,
      this._lifeNbr,
      this._missileNbr,
      this._defenseNbr
    );
    const lifeNbr = this._lifeNbr;
    const missileNbr = this._missileNbr;
    const defenseNbr = this._defenseNbr;
    // FIRE cells participate as "live defense" neighbors but the
    // backend's fast path only counts DEFENSE/MISSILE. Patch the
    // counts here: any cell adjacent to a FIRE gets +1 lifeNbr only.
    // FIRE is "activated" for both friendly (defense) and enemy
    // (missile) births/survivals, so it must NOT bias defenseNbr
    // (which would cause missiles to annihilate on contact and would
    // bias empty-cell births toward defense).
    this._addFireNeighborCounts(cells, w, h, lifeNbr, defenseNbr, missileNbr);

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
          // Missiles hitting barriers are destroyed; the barrier stays.
          if (this._countNeighborsOfType(x, y, CELL_TYPE.BARRIER) > 0) {
            annihilated[i] = 1;
            if (this.onMissileDestroyed) this.onMissileDestroyed();
            if (this.onAnnihilation) this.onAnnihilation(x, y);
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
    if (!freezeEnemies) {
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] === CELL_TYPE.MISSILE) {
          const y = (i / w) | 0;
          let effectiveLimit;
          if (y >= dzMinYBoundary) effectiveLimit = missAgeF;
          else if (y <= enemyRegionMaxY) effectiveLimit = missAgeE;
          else effectiveLimit = missAgeN;
          if (effectiveLimit < UNLIMITED && age[i] >= effectiveLimit) {
            ageDespawn[i] = 1;
          }
        }
      }
      // Cascade: any missile within cascadeTicks of expiry adjacent to an
      // already-despawning missile also despawns. Iterate until stable.
      // Use a worklist approach for efficiency on large grids.
      // Use the largest region limit as the reference for
      // cascade threshold (cells nearing expiry in either region cascade).
      const maxRegionLimit = Math.max(
        missAgeF < UNLIMITED ? missAgeF : 0,
        missAgeE < UNLIMITED ? missAgeE : 0,
        missAgeN < UNLIMITED ? missAgeN : 0
      );
      const cascadeThreshold = maxRegionLimit - cascadeTicks;
      const worklist = [];
      for (let i = 0; i < cells.length; i++) {
        if (ageDespawn[i]) worklist.push(i);
      }
      while (worklist.length > 0 && maxRegionLimit > 0) {
        const i = worklist.pop();
        const y = (i / w) | 0;
        const x = i - y * w;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = (((x + dx) % w) + w) % w;
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
    // --- Step 3b: Death contagion. When AGE_CONTAGION_AMOUNT > 0,
    // increment the age of neighbors of any cell that's about to die
    // (whether from annihilation OR age expiry). This makes loss-tolerant
    // patterns (oscillators, spaceships) gradually decay because each
    // death accelerates aging of nearby cells.
    const contagionAmount = CONFIG.AGE_CONTAGION_AMOUNT | 0;
    if (contagionAmount > 0) {
      for (let i = 0; i < cells.length; i++) {
        const willDie = annihilated[i] || ageDespawn[i];
        if (!willDie) continue;
        const t = cells[i];
        if (t !== CELL_TYPE.MISSILE && t !== CELL_TYPE.DEFENSE) continue;
        const y = (i / w) | 0;
        const x = i - y * w;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = (((x + dx) % w) + w) % w;
            const ni = ny * w + nx;
            const nt = cells[ni];
            if (nt !== CELL_TYPE.MISSILE && nt !== CELL_TYPE.DEFENSE) continue;
            if (annihilated[ni] || ageDespawn[ni]) continue;
            // Bump current age so the next-pass survival check sees it.
            const newAge = age[ni] + contagionAmount;
            age[ni] = newAge > 255 ? 255 : newAge;
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
        // Barrier: static, immune to all rules. Persists forever and
        // blocks missile cells from being birthed in its cell.
        if (t === CELL_TYPE.BARRIER) {
          next[i] = CELL_TYPE.BARRIER;
          continue;
        }
        // Fire: static activated tile. Persists forever. Counted as
        // a live cell by the neighbor-counting pass (see backend), so
        // it influences births/survives in nearby cells without
        // itself being subject to Life rules.
        if (t === CELL_TYPE.FIRE) {
          next[i] = CELL_TYPE.FIRE;
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
          let maxForType;
          let ageUnlimited;
          if (t === CELL_TYPE.MISSILE) {
            if (y >= dzMinYBoundary) maxForType = missAgeF;
            else if (y <= enemyRegionMaxY) maxForType = missAgeE;
            else maxForType = missAgeN;
            ageUnlimited = maxForType >= UNLIMITED;
          } else {
            if (y >= dzMinYBoundary) maxForType = defAgeF;
            else if (y <= enemyRegionMaxY) maxForType = defAgeE;
            else maxForType = defAgeN;
            ageUnlimited = maxForType >= UNLIMITED;
          }
          if (this._rule.shouldSurvive(ln) && (ageUnlimited || currentAge < maxForType)) {
            next[i] = t;
            nextAge[i] = currentAge < 255 ? currentAge + 1 : 255;
            nextColor[i] = color[i];
            nextDir[i] = g.cellDir[i];
          } else {
            next[i] = CELL_TYPE.EMPTY;
            nextAge[i] = 0;
          }
        } else if (t === CELL_TYPE.EMPTY) {
          if (this._rule.shouldBirth(ln)) {
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
  /**
   * Tick the simulation when an exotic rule is active.
   *
   * Strategy:
   *   - Extract the binary DEFENSE-cell layer into a scratch buffer.
   *   - Run the exotic engine (TCA / time-integrated / lightcone) one step
   *     to produce the next defense layer.
   *   - Run vanilla Life on the MISSILE layer using a standard Conway
   *     ruleset (exotic rules apply only to friendly evolution).
   *   - Resolve collisions (missile vs defense, missile vs city) and
   *     apply aging / cascades exactly as in the standard tick.
   *
   * This keeps gameplay coherent (enemies still behave predictably) while
   * letting the player's defenses evolve under the chosen exotic rule.
   */
  _tickExotic() {
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
    const n = w * h;
    // Scratch defense layer (binary: 1 = DEFENSE present, 0 = absent).
    if (!this._exoticDefIn || this._exoticDefIn.length !== n) {
      this._exoticDefIn = new Uint8Array(n);
      this._exoticDefOut = new Uint8Array(n);
    }
    const defIn = this._exoticDefIn;
    const defOut = this._exoticDefOut;
    for (let i = 0; i < n; i++) {
      defIn[i] = cells[i] === CELL_TYPE.DEFENSE || cells[i] === CELL_TYPE.FIRE ? 1 : 0;
    }
    const freezeDefenses = !!this.freezeDefenses;
    if (!freezeDefenses) {
      runExoticStep(this._rule, defIn, defOut, w, h);
    } else {
      defOut.set(defIn);
    }
    // Run standard Life for missile cells (always under Conway).
    // We compute neighbor counts on the missile-only layer using the
    // backend's CPU path.
    this.backend.computeNeighborCounts(
      cells,
      w,
      h,
      this._lifeNbr,
      this._missileNbr,
      this._defenseNbr
    );
    let missileNbr = this._missileNbr;
    const lifeNbr = this._lifeNbr;
    // FIRE participates as a live neighbor (for births/survivals) in
    // exotic mode too, but does not bias birth type or trigger
    // collisions. See _addFireNeighborCounts.
    this._addFireNeighborCounts(cells, w, h, lifeNbr, this._defenseNbr, missileNbr);
    // Collision detection (missile↔defense, missile↔city).
    const annihilated = this._annihilated;
    annihilated.fill(0);
    const hardcore = CONFIG.HARDCORE_MODE;
    const freezeEnemies = !!this.freezeEnemies;
    const shift = g.wrapVerticalShift | 0;
    for (let y = 0; y < h; y++) {
      const rowBase = y * w;
      for (let x = 0; x < w; x++) {
        const i = rowBase + x;
        const t = cells[i];
        if (t === CELL_TYPE.MISSILE) {
          if (freezeEnemies) continue;
          // Check against NEW defense layer for collisions.
          // Note: defIn includes FIRE tiles (they act as live neighbors
          // for the exotic engine), but FIRE must not trigger missile
          // annihilation — it's "activated" for both paints. Skip FIRE
          // cells explicitly when counting collision-causing neighbors.
          let defAdjacent = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              let nx = x + dx;
              let ny = y + dy;
              if (shift !== 0) {
                if (nx < 0) ny += shift;
                else if (nx >= w) ny -= shift;
              }
              nx = ((nx % w) + w) % w;
              if (ny < 0 || ny >= h) continue;
              const ni = ny * w + nx;
              if (defIn[ni] && cells[ni] !== CELL_TYPE.FIRE) defAdjacent++;
            }
          }
          if (defAdjacent > 0) {
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
    // Age-based missile despawn.
    const UNLIMITED = CONFIG.UNLIMITED_SENTINEL || 999999;
    const dzMinYBoundary = g.drawZoneMinY();
    const ageDespawn = this._ageDespawn;
    ageDespawn.fill(0);
    // Clamp age limits to Uint8Array range (see comment in tick()).
    const clampAge = (v) => (v >= UNLIMITED ? v : Math.min(v | 0, 255));
    const missAgeF = clampAge(CONFIG.MISSILE_AGE_FRIENDLY);
    const missAgeE = clampAge(CONFIG.MISSILE_AGE_ENEMY);
    const missAgeN = clampAge(CONFIG.MISSILE_AGE_NEUTRAL);
    const defAgeF = clampAge(CONFIG.DEFENSE_AGE_FRIENDLY);
    const defAgeE = clampAge(CONFIG.DEFENSE_AGE_ENEMY);
    const defAgeN = clampAge(CONFIG.DEFENSE_AGE_NEUTRAL);
    const topDeadMaxX = Math.min(h - 1, CONFIG.RETURN_FIRE_ZONE_MAX_Y | 0);
    const baseZoneHX = Math.max(0, CONFIG.BASE_ZONE_HEIGHT | 0);
    const enemyRegionMaxY = Math.min(h - 1, topDeadMaxX + baseZoneHX);
    if (!freezeEnemies) {
      for (let i = 0; i < n; i++) {
        if (cells[i] === CELL_TYPE.MISSILE) {
          const y = (i / w) | 0;
          let eff;
          if (y >= dzMinYBoundary) eff = missAgeF;
          else if (y <= enemyRegionMaxY) eff = missAgeE;
          else eff = missAgeN;
          if (eff < UNLIMITED && age[i] >= eff) {
            ageDespawn[i] = 1;
          }
        }
      }
    }
    const defenseVariants = CONFIG.COLORS.DEFENSE_VARIANTS.length;
    const missileVariants = CONFIG.COLORS.MISSILE_VARIANTS.length;
    // Build the next-state grid by combining:
    //   - Cities pass through (or explode if hit).
    //   - Explosions decay.
    //   - Missiles follow vanilla Conway.
    //   - Defenses follow the exotic rule (already computed in defOut).
    for (let y = 0; y < h; y++) {
      const rowBase = y * w;
      for (let x = 0; x < w; x++) {
        const i = rowBase + x;
        const t = cells[i];
        // City logic.
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
        // Barrier: static, immune.
        if (t === CELL_TYPE.BARRIER) {
          next[i] = CELL_TYPE.BARRIER;
          continue;
        }
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
        // Frozen state passes through.
        if (t === CELL_TYPE.MISSILE && freezeEnemies) {
          next[i] = CELL_TYPE.MISSILE;
          nextAge[i] = age[i];
          nextColor[i] = color[i];
          nextDir[i] = g.cellDir[i];
          continue;
        }
        // Missile evolution (vanilla Conway).
        if (t === CELL_TYPE.MISSILE) {
          const ln = lifeNbr[i];
          // Use Conway rules for missile lifecycle in exotic mode.
          // (Player's exotic choice only affects friendly defenses.)
          const alive = ln === 2 || ln === 3;
          if (alive) {
            let eff;
            if (y >= dzMinYBoundary) eff = missAgeF;
            else if (y <= enemyRegionMaxY) eff = missAgeE;
            else eff = missAgeN;
            const ageUnlimited = eff >= UNLIMITED;
            const currentAge = age[i];
            if (ageUnlimited || currentAge < eff) {
              next[i] = CELL_TYPE.MISSILE;
              nextAge[i] = currentAge < 255 ? currentAge + 1 : 255;
              nextColor[i] = color[i];
              nextDir[i] = g.cellDir[i];
            } else {
              next[i] = CELL_TYPE.EMPTY;
              nextAge[i] = 0;
            }
          } else {
            next[i] = CELL_TYPE.EMPTY;
            nextAge[i] = 0;
          }
          continue;
        }
        // Empty cells: check missile birth (Conway) and defense from exotic.
        if (t === CELL_TYPE.EMPTY) {
          // Missile birth (only if dominated by missile neighbors).
          if (missileNbr[i] === 3 && !freezeEnemies) {
            next[i] = CELL_TYPE.MISSILE;
            nextColor[i] = (Math.random() * missileVariants) | 0;
            nextDir[i] = 1;
            nextAge[i] = 1;
            continue;
          }
          // Defense birth from exotic engine output.
          if (defOut[i]) {
            next[i] = CELL_TYPE.DEFENSE;
            nextColor[i] = (Math.random() * defenseVariants) | 0;
            nextDir[i] = 0;
            nextAge[i] = 1;
            continue;
          }
          next[i] = CELL_TYPE.EMPTY;
          continue;
        }
        // Defense cells: use exotic engine output.
        if (t === CELL_TYPE.DEFENSE) {
          if (freezeDefenses) {
            next[i] = CELL_TYPE.DEFENSE;
            nextAge[i] = age[i];
            nextColor[i] = color[i];
            nextDir[i] = g.cellDir[i];
            continue;
          }
          if (defOut[i]) {
            // Survives.
            let eff;
            if (y >= dzMinYBoundary) eff = defAgeF;
            else if (y <= enemyRegionMaxY) eff = defAgeE;
            else eff = defAgeN;
            const ageUnlimited = eff >= UNLIMITED;
            const currentAge = age[i];
            if (ageUnlimited || currentAge < eff) {
              next[i] = CELL_TYPE.DEFENSE;
              nextAge[i] = currentAge < 255 ? currentAge + 1 : 255;
              nextColor[i] = color[i];
              nextDir[i] = 0;
            } else {
              next[i] = CELL_TYPE.EMPTY;
              nextAge[i] = 0;
            }
          } else {
            next[i] = CELL_TYPE.EMPTY;
            nextAge[i] = 0;
          }
          continue;
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
    // Return-fire / breach detection unchanged.
    if (!freezeEnemies) {
      const dzMinY = Math.max(0, CONFIG.RETURN_FIRE_ZONE_MIN_Y | 0);
      const dzMaxY = Math.min(h - 1, CONFIG.RETURN_FIRE_ZONE_MAX_Y | 0);
      this._detectReturnFire(dzMinY, dzMaxY);
      this._detectBreach();
    }
  }

  _countCityNeighbors(x, y) {
    const g = this.grid;
    const w = g.width;
    const h = g.height;
    const cells = g.cells;
    const shift = g.wrapVerticalShift | 0;
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        let nx = x + dx;
        let ny = y + dy;
        // Apply vertical shift when wrapping horizontally (Klein-bottle style).
        if (shift !== 0) {
          if (nx < 0) ny += shift;
          else if (nx >= w) ny -= shift;
        }
        nx = ((nx % w) + w) % w;
        if (ny < 0 || ny >= h) continue;
        if (cells[ny * w + nx] === CELL_TYPE.CITY) count++;
      }
    }
    return count;
  }
  // Augment neighbor-count arrays so FIRE cells act as live neighbors
  // for Life-rule purposes (births and survivals) without being
  // treated as defenses. FIRE is "activated" for both friendly and
  // enemy paints: it should help patterns of either type live/grow
  // nearby, but it should NOT:
  //   - cause missiles to annihilate (which checks defenseNbr > 0)
  //   - bias empty-cell births toward DEFENSE (which compares
  //     missileNbr vs defenseNbr)
  // Therefore we only increment lifeNbr here. The defenseNbr param is
  // retained for signature compatibility but intentionally unused.
  _addFireNeighborCounts(cells, w, h, lifeNbr, defenseNbr, missileNbr) {
    void defenseNbr;
    const shift = this.grid.wrapVerticalShift | 0;
    const n = cells.length;
    // Determine enemy region bounds (same logic as in tick()).
    const topDeadMax = Math.min(h - 1, CONFIG.RETURN_FIRE_ZONE_MAX_Y | 0);
    const baseZoneH = Math.max(0, CONFIG.BASE_ZONE_HEIGHT | 0);
    const enemyRegionMaxY = Math.min(h - 1, topDeadMax + baseZoneH);
    for (let i = 0; i < n; i++) {
      if (cells[i] !== CELL_TYPE.FIRE) continue;
      const y = (i / w) | 0;
      const x = i - y * w;
      // FIRE tiles in enemy territory bias births toward MISSILE so the
      // enemy can spawn new attacker cells nearby. FIRE in friendly or
      // neutral territory remains neutral (only contributes to lifeNbr)
      // to avoid causing missile self-annihilation against friendly FIRE.
      const inEnemyRegion = y <= enemyRegionMaxY;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          let nx = x + dx;
          let ny = y + dy;
          if (shift !== 0) {
            if (nx < 0) ny += shift;
            else if (nx >= w) ny -= shift;
          }
          nx = ((nx % w) + w) % w;
          if (ny < 0 || ny >= h) continue;
          const ni = ny * w + nx;
          lifeNbr[ni]++;
          if (inEnemyRegion && missileNbr) {
            missileNbr[ni]++;
          }
          if (inEnemyRegion) {
            // Bias empty-cell births toward MISSILE in enemy territory.
            // We use a scratch missileNbr array — look it up via the
            // simulation's stored buffer.
            this._missileNbr[ni]++;
          }
        }
      }
    }
  }
  // Generic neighbor counter for a specific cell type. Used by barrier
  // collision (and reusable for any other "any neighbor of this type?"
  // check).
  _countNeighborsOfType(x, y, type) {
    const g = this.grid;
    const w = g.width;
    const h = g.height;
    const cells = g.cells;
    const shift = g.wrapVerticalShift | 0;
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        let nx = x + dx;
        let ny = y + dy;
        if (shift !== 0) {
          if (nx < 0) ny += shift;
          else if (nx >= w) ny -= shift;
        }
        nx = ((nx % w) + w) % w;
        if (ny < 0 || ny >= h) continue;
        if (cells[ny * w + nx] === type) count++;
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
    const shift = g.wrapVerticalShift | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        let nx = x + dx;
        let ny = y + dy;
        if (shift !== 0) {
          if (nx < 0) ny += shift;
          else if (nx >= w) ny -= shift;
        }
        nx = ((nx % w) + w) % w;
        if (ny < 0 || ny >= h) continue;
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
    if (!CONFIG.EVENT_RETURN_FIRE && !CONFIG.EVENT_RICOCHET) return;
    const g = this.grid;
    const w = g.width;
    const h = g.height;
    const cells = g.cells;
    const fired = this.returnFireFired;
    // Bounds sanity check.
    if (minY < 0) minY = 0;
    if (maxY >= h) maxY = h - 1;
    if (minY > maxY) return;
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
            const nx = (((x + dx) % w) + w) % w;
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
        // Respect per-event toggles.
        if (kind === 'ricochet' && !CONFIG.EVENT_RICOCHET) continue;
        if (kind === 'return' && !CONFIG.EVENT_RETURN_FIRE) continue;
        this.onMissileReturn(x, y, kind);
        fired[i] = 1;
        if (kind === 'ricochet') {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const ny = y + dy;
              if (ny < 0 || ny >= h) continue;
              const nx = (((x + dx) % w) + w) % w;
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
    if (!CONFIG.EVENT_BREACH) return;
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
