// src/sim/tickHelpers.js
//
// Shared helpers for Simulation.tick() and Simulation._tickExotic().
// These two methods used to contain a lot of near-identical logic for:
//   - clamping per-region age limits into Uint8 range
//   - selecting the effective age limit based on cell Y position
//   - applying anchor semantics (immortal-until-first-death) to a
//     life/death decision
//   - swapping the simulation's double-buffered grid arrays
//
// Centralizing these here keeps the two tick paths shorter and makes
// it much harder to introduce subtle divergences between them.

import { CONFIG, CELL_TYPE } from '../config.js';

/**
 * Clamp a configured age limit into Uint8Array range while leaving
 * the "unlimited" sentinel intact. Cell ages are stored in Uint8
 * arrays (max 255); any finite limit above 255 is clamped so the
 * comparisons in the tick loop work correctly. Limits >= UNLIMITED
 * are treated as "no limit" later, so we leave them as-is.
 */
export function clampAgeLimit(v, unlimited) {
  return v >= unlimited ? v : Math.min(v | 0, 255);
}

/**
 * Resolve all six per-type, per-region age limits up-front. Returns
 * a single object so callers can keep their local-variable list
 * short.
 */
export function resolveAgeLimits() {
  const UNLIMITED = CONFIG.UNLIMITED_SENTINEL || 999999;
  const c = (v) => clampAgeLimit(v, UNLIMITED);
  return {
    UNLIMITED,
    defAgeF: c(CONFIG.DEFENSE_AGE_FRIENDLY),
    defAgeE: c(CONFIG.DEFENSE_AGE_ENEMY),
    defAgeN: c(CONFIG.DEFENSE_AGE_NEUTRAL),
    missAgeF: c(CONFIG.MISSILE_AGE_FRIENDLY),
    missAgeE: c(CONFIG.MISSILE_AGE_ENEMY),
    missAgeN: c(CONFIG.MISSILE_AGE_NEUTRAL),
    rearDeadZone: c(CONFIG.REAR_DEAD_ZONE_AGE_LIMIT != null ? CONFIG.REAR_DEAD_ZONE_AGE_LIMIT : 10),
  };
}

/**
 * Compute the enemy region's max-Y row from CONFIG. Used by both
 * tick paths to decide which age limit applies at a given row.
 */
export function computeEnemyRegionMaxY(h) {
  const topDeadMax = Math.min(h - 1, CONFIG.RETURN_FIRE_ZONE_MAX_Y | 0);
  const baseZoneH = Math.max(0, CONFIG.BASE_ZONE_HEIGHT | 0);
  return Math.min(h - 1, topDeadMax + baseZoneH);
}

/**
 * Pick the effective age limit for a cell given its Y coordinate,
 * type, and the precomputed region boundaries / limits.
 *
 * dzMinYBoundary: minimum Y of the friendly draw zone.
 * enemyRegionMaxY: maximum Y of the enemy region (base zone bottom).
 * rearDeadZoneMinY: minimum Y of the rear dead zone (optional). Any
 *   cell at or below this row uses the short rear-dead-zone limit so
 *   stray cells in the rear zone expire quickly and don't fire
 *   breach/return events repeatedly.
 */
export function effectiveAgeLimit(
  y,
  type,
  limits,
  dzMinYBoundary,
  enemyRegionMaxY,
  rearDeadZoneMinY
) {
  // Rear dead zone takes priority over normal region selection so
  // both enemy missile cells and stray defense cells that drift
  // into the rear strip die off quickly regardless of region.
  if (rearDeadZoneMinY !== undefined && rearDeadZoneMinY !== null && y >= rearDeadZoneMinY) {
    return limits.rearDeadZone;
  }
  if (type === CELL_TYPE.MISSILE) {
    if (y >= dzMinYBoundary) return limits.missAgeF;
    if (y <= enemyRegionMaxY) return limits.missAgeE;
    return limits.missAgeN;
  }
  // DEFENSE.
  if (y >= dzMinYBoundary) return limits.defAgeF;
  if (y <= enemyRegionMaxY) return limits.defAgeE;
  return limits.defAgeN;
}

/**
 * Apply the standard "anchor + survival + age limit" decision to a
 * single cell, writing the result into the next-state buffers.
 *
 * Anchor semantics: an anchored cell is immortal until it would die
 * at least once (from Life rules OR age expiry). The first time it
 * would die, the anchor clears and the cell survives that one tick
 * with age reset to 1; on subsequent ticks it follows normal rules.
 *
 * Parameters:
 *   ctx       - { next, nextAge, nextColor, nextDir, nextAnchor,
 *                 anchor, age, color, cellDir }
 *   i         - flat cell index
 *   type      - CELL_TYPE.MISSILE or CELL_TYPE.DEFENSE (what to
 *               write into next[i] if the cell survives)
 *   survives  - boolean: does the Life rule say this cell survives?
 *   effLimit  - effective age limit for this cell's region/type
 *   unlimited - the UNLIMITED sentinel value
 *   dir       - direction byte to write for new births / survivors;
 *               omit/undefined to copy from cellDir.
 */
export function applyCellLifeDecision(ctx, i, type, survives, effLimit, unlimited, dir) {
  const currentAge = ctx.age[i];
  const ageUnlimited = effLimit >= unlimited;
  const isAnchored = ctx.anchor[i] === 1;
  const ageOk = ageUnlimited || currentAge < effLimit || isAnchored;
  const wouldDie = !survives || !ageOk;
  const writeDir = dir !== undefined ? dir : ctx.cellDir[i];

  if (isAnchored && wouldDie) {
    // Anchored cell would die — keep it alive but CLEAR the anchor
    // so this protection only fires once. Reset age to 1 so the
    // freshly-cleared anchor doesn't immediately re-trigger the
    // death condition.
    ctx.next[i] = type;
    ctx.nextAge[i] = 1;
    ctx.nextColor[i] = ctx.color[i];
    ctx.nextDir[i] = writeDir;
    ctx.nextAnchor[i] = 0;
    return;
  }
  if (survives && ageOk) {
    ctx.next[i] = type;
    // While anchored, do not accumulate age.
    if (isAnchored) {
      ctx.nextAge[i] = 1;
    } else {
      ctx.nextAge[i] = currentAge < 255 ? currentAge + 1 : 255;
    }
    ctx.nextColor[i] = ctx.color[i];
    ctx.nextDir[i] = writeDir;
    ctx.nextAnchor[i] = ctx.anchor[i];
    return;
  }
  ctx.next[i] = CELL_TYPE.EMPTY;
  ctx.nextAge[i] = 0;
  ctx.nextAnchor[i] = 0;
}

/**
 * Swap the simulation's double-buffered grid arrays. Both tick
 * paths end with the same five-buffer swap; this hides it behind
 * a single call.
 */
export function swapTickBuffers(sim) {
  const g = sim.grid;
  const tmp = g.cells;
  g.cells = sim.next;
  sim.next = tmp;

  const tmpAge = g.cellAge;
  g.cellAge = sim.nextAge;
  sim.nextAge = tmpAge;

  const tmpColor = g.cellColor;
  g.cellColor = sim.nextColor;
  sim.nextColor = tmpColor;

  const tmpDir = g.cellDir;
  g.cellDir = sim.nextDir;
  sim.nextDir = tmpDir;

  const tmpAnchor = sim._anchor;
  sim._anchor = sim._nextAnchor;
  sim._nextAnchor = tmpAnchor;
}

/**
 * Build a "ctx" object suitable for applyCellLifeDecision from a
 * Simulation instance. Pulled out so callers don't repeat the
 * field-list at every call site.
 */
export function makeLifeCtx(sim) {
  const g = sim.grid;
  return {
    next: sim.next,
    nextAge: sim.nextAge,
    nextColor: sim.nextColor,
    nextDir: sim.nextDir,
    nextAnchor: sim._nextAnchor,
    anchor: sim._anchor,
    age: g.cellAge,
    color: g.cellColor,
    cellDir: g.cellDir,
  };
}
