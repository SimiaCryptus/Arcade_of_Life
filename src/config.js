// Tunable game constants
export const CONFIG = {
  // Grid
  GRID_WIDTH: 120,
  GRID_HEIGHT: 80,
  CELL_SIZE: 8,

  // Simulation
  TICK_RATE: 100, // ms per simulation step (10 ticks/sec)
  SPEED_MULTIPLIER: 1.0, // 0 = paused, 1 = normal, >1 = faster
  // Timestep ratio: M defender ticks per N attacker ticks.
  // E.g. DEFENDER_TICKS=2, ATTACKER_TICKS=1 means defenses evolve twice
  // as fast as missiles. Both must be positive integers.
  DEFENDER_TICKS: 1,
  ATTACKER_TICKS: 1,

  // Ink
  INITIAL_INK: 200,
  MAX_INK: 300,
  INK_REGEN_RATE: 0.5, // per simulation tick

  // Missiles
  MISSILE_SPAWN_INTERVAL: 800, // ms between spawns at start
  MISSILE_SPAWN_MIN: 300, // minimum interval as waves progress
  MISSILE_SPAWN_DECREMENT: 75, // ms reduction per wave
  MISSILES_PER_WAVE_BASE: 8,
  MISSILES_PER_WAVE_INC: 3,
  // Region-specific age limits. The grid is divided into two regions by
  // the draw-zone boundary: "friendly region" (draw zone, bottom) and
  // "enemy region" (above draw zone, top). Each cell type can have a
  // different max age in each region. Set to UNLIMITED_SENTINEL
  // (999999) for effectively infinite lifespan.
  // Matrix layout (rows=cell type, cols=region):
  //                  Friendly Region    Enemy Region
  //   DEFENSE cells: DEFENSE_AGE_F      DEFENSE_AGE_E
  //   MISSILE cells: MISSILE_AGE_F      MISSILE_AGE_E
  DEFENSE_AGE_FRIENDLY: 999999,
  DEFENSE_AGE_ENEMY: 999999,
  DEFENSE_AGE_NEUTRAL: 999999,
  MISSILE_AGE_FRIENDLY: 999999,
  MISSILE_AGE_ENEMY: 999999,
  MISSILE_AGE_NEUTRAL: 999999,
  MISSILE_CASCADE_TICKS: 20, // ~2 seconds at TICK_RATE=100ms
  // Death contagion: when a cell expires (from age or annihilation),
  // increment the age of each of its neighbors by this amount. Above 0
  // this creates a "decay spreads" effect: loss-tolerant patterns
  // (oscillators, spaceships) can no longer persist indefinitely because
  // each death accelerates aging of nearby cells. Set to 0 to disable.
  // Applies to both DEFENSE and MISSILE cells.
  AGE_CONTAGION_AMOUNT: 0,

  // Cities
  CITY_COUNT: 5,
  CITY_WIDTH: 5,
  CITY_HEIGHT: 3,

  // Glider types enabled for missile spawning.
  // At least one must be true; if all are false, defaults to SE_GLIDER.
  GLIDER_SE: true, // R-type: classic SE-moving Conway glider
  GLIDER_SW: true, // L-type: mirrored SW-moving Conway glider
  GLIDER_HEAVY: false, // Target Emplacements: stationary spawners (destroy to clear!)
  GLIDER_LWSS: false, // Lightweight Spaceship: fast diagonal spaceship
  GLIDER_MWSS: false, // Middleweight Spaceship: larger, more durable
  GLIDER_TWIN: false, // Twin glider: two gliders in formation
  GLIDER_GUN: false, // Gosper Glider Gun: spawns a glider factory (RARE & DEADLY)

  // Drawing
  DRAW_LINE_THICKNESS: 1,
  // Ink drying time: number of simulation ticks pending cells must "dry"
  // before they become active defense cells. Visual feedback shows drying progress.
  INK_DRY_TICKS: 5,
  // Return-fire dead zone: rows near the top where nothing is ever spawned
  // by the game. Missiles spawn at y = RETURN_FIRE_ZONE_MAX_Y + 1 (see
  // missiles.js), and defenses can only be painted in the bottom half.
  // If MISSILE cells appear in this range [MIN, MAX] inclusive, they must
  // have arrived via Game-of-Life evolution from below — i.e. "return fire".
  RETURN_FIRE_ZONE_MIN_Y: 0,
  RETURN_FIRE_ZONE_MAX_Y: 4,
  // Player-side rear dead zone: rows near the BOTTOM where nothing is
  // spawned and the player cannot draw. If MISSILE cells appear in this
  // range, they slipped past defenses without hitting a city — registers
  // as "BREACH!" event. Measured in rows from the very bottom of the
  // grid (0 = no rear zone). Default 2 rows.
  REAR_DEAD_ZONE_HEIGHT: 2,
  // Age limit (in simulation ticks) for ANY cell that lands inside
  // the rear dead zone. The rear zone is the strip of rows directly
  // below the player's draw area used for breach detection; cells
  // that slip into it should be short-lived so they don't accumulate
  // and re-fire breach/return-fire events forever. Applies to both
  // MISSILE and DEFENSE cells regardless of region age settings.
  REAR_DEAD_ZONE_AGE_LIMIT: 10,
  // Base spawning zone: a band of rows BELOW the top dead zone but ABOVE
  // the regular missile spawn line, where static "bases" and horizontal
  // spaceships can spawn. Bases persist until the player destroys them.
  // Wave is not complete until all bases are cleared.
  BASE_ZONE_HEIGHT: 12, // rows in the base zone (larger = more buffer from glider spawn)
  BASE_SPAWN_ENABLED: true, // master toggle for base spawning
  BASE_SPAWN_COUNT_BASE: 1, // bases per wave at wave 1
  BASE_SPAWN_COUNT_INC: 0.5, // additional bases per wave (rounded)
  BASE_SPAWN_MAX: 6, // hard cap on simultaneous bases
  // Per-base-type spawn weights. Higher = more common. Set to 0 to disable.
  BASE_TYPE_FORTRESS: 1.0, // static block emplacement (emits gliders)
  BASE_TYPE_BUNKER: 0.8, // smaller static block
  BASE_TYPE_CRUISER_E: 0.7, // spaceship moving east (horizontal only)
  BASE_TYPE_CRUISER_W: 0.7, // spaceship moving west (horizontal only)
  // Hardcore mode: when enabled, the player's own defense cells damage cities
  // on contact, just like missiles do.
  HARDCORE_MODE: false,
  // Drawable area: fraction of grid height from bottom that the player can
  // draw defenses in. 0.5 = bottom half (default). Range: 0.2 .. 0.8.
  DRAW_ZONE_FRACTION: 0.5,
  // Whether to render a visible boundary line at the top of the draw zone.
  SHOW_DRAW_ZONE: true,
  // Event detection toggles. When false, the corresponding event will not fire
  // (no floater, no sound, no shockwave, no score change). Used by the level
  // designer to disable specific event types per-level.
  EVENT_RETURN_FIRE: true,
  EVENT_RICOCHET: true,
  EVENT_BREACH: true,
  EVENT_CITY_HIT: true,
  EVENT_ANNIHILATION: true,
  // Victory / defeat thresholds based on cell counts.
  // VICTORY_ENEMY_THRESHOLD: max enemy (MISSILE) cells in the enemy region
  //   for victory to trigger. 0 = strict (must eliminate all enemy cells +
  //   all structural threats). Higher values let the player win even with
  //   some lingering enemy presence.
  // DEFEAT_CITY_THRESHOLD: minimum city cells the player must keep alive.
  //   Game over triggers when total city cell count drops to/below this
  //   value. 0 = classic (must lose all cities). Higher = harder.
  // Counts are summed across the relevant region of the grid.
  VICTORY_ENEMY_THRESHOLD: 0,
  DEFEAT_CITY_THRESHOLD: 0,
  // Default starting speed multiplier when a game begins. The game still
  // begins paused — this is the speed it resumes to when the player
  // presses Space or moves the slider for the first time.
  STARTING_SPEED: 1.0,
  // Enabled abilities (which abilities can appear as perk choices in story mode).
  // All default to true so the existing story experience is unchanged.
  ABILITY_DOUBLE_SCORE: true,
  ABILITY_NO_DRY: true,
  ABILITY_WAVE_BONUS: true,
  ABILITY_SAFE_ZONE: true,
  ABILITY_SLOW_MISSILES: true,
  ABILITY_EMP_BURST: true,
  ABILITY_INK_SURGE: true,
  ABILITY_FREEZE: true,
  // Fraction of ink refunded when using the "Clear Defenses" button (0..1).
  CLEAR_REFUND_FRACTION: 0.5,
  // Simulation backend selection: 'auto' | 'cpu' | 'gpu'.
  // - 'auto' picks GPU for grids >= 200x200 if WebGL2 is available.
  // - 'cpu' forces the bitpacked CPU path (best for tiny grids and debugging).
  // - 'gpu' forces WebGL2; throws & falls back if unsupported.
  SIM_BACKEND: 'auto',
  // Hashlife memoization cache for pure-defense regions.
  // Speeds up large boards with static defense lattices. Disable for debugging.
  SIM_HASHLIFE_ENABLED: true,
  // Active cellular automaton ruleset id. Determines birth/survival rules.
  // See src/rules/ruleset.js and src/rules/extraRulesets.js for available ids.
  ACTIVE_RULESET: 'conway',
  // Asymmetric rulesets: when ENEMY_RULESET is set (non-null), enemy
  // missile cells evolve under this ruleset while defenses use
  // ACTIVE_RULESET. When null, both use ACTIVE_RULESET (symmetric).
  ENEMY_RULESET: null,
  // Allow opening the Settings panel during active gameplay (via S hotkey
  // or the in-game gear button). When true, opening Settings mid-game
  // pauses the simulation; closing resumes it. When false, Settings is
  // only accessible from the main menu / game over screen.
  IN_PLAY_SETTINGS_ENABLED: true,
  // Visual effects toggles. Disabling reduces GPU/CPU load on slow devices.
  VFX_PARTICLES: true, // particle bursts (explosions, plumes, sparks)
  VFX_SHOCKWAVES: true, // expanding ring shockwaves
  VFX_FLOATERS: true, // floating text labels (RETURN FIRE!, CITY HIT!, etc.)
  VFX_SCREEN_SHAKE: true, // screen shake on impacts
  VFX_CELL_GLOW: true, // per-cell glow on missile cells
  VFX_DRAW_ZONE_TINT: true, // draw-zone background tint & boundary line
  // Minimum buffer rows between the base zone bottom and the glider spawn row.
  // Increase this if bases and gliders are colliding on spawn.
  BASE_GLIDER_BUFFER: 4,

  // Any value >= this threshold is treated as unlimited in the simulation.
  UNLIMITED_SENTINEL: 999999,

  // Colors
  COLORS: {
    BACKGROUND: '#000010',
    GRID: '#0a0a20',
    MIDLINE: '#2a2a5a',
    CELL_ALIVE: '#00ff88',
    CELL_PENDING: 'rgba(0, 255, 136, 0.4)',
    CELL_MISSILE: '#ff00aa',
    CELL_CITY: '#ffff60',
    CELL_EXPLOSION: '#ff8800',
    CELL_BARRIER: '#a0a0a0',
    CELL_FIRE: '#ff6622',
    HUD_TEXT: '#e0e0ff',
    INK_BAR: '#00ffff',
    INK_BAR_BG: '#1a1a3a',
    // Variant palettes for visual dynamism. One is chosen randomly per cell.
    // Defenses are cool greens/cyans (player). Missiles are their direct
    // color complement — hot reds/oranges/magentas — so on the dark grid
    // friend vs. foe is unambiguous at a glance. The two palettes are
    // intentionally chosen to be opposite hues on the color wheel.
    DEFENSE_VARIANTS: ['#00ff88', '#33ffaa', '#00ddaa', '#66ffcc', '#00ffcc'],
    MISSILE_VARIANTS: ['#ff0055', '#ff2233', '#ff3300', '#ff1144', '#ff4422', '#ff0033'],
    RETURN_FIRE_TEXT: '#00ffff',
    RICOCHET_TEXT: '#ffaa00',
    DRAW_ZONE_BOUNDARY: 'rgba(0, 255, 200, 0.35)',
    DRAW_ZONE_TINT: 'rgba(0, 255, 136, 0.04)',
  },

  // HUD
  HUD_HEIGHT: 40,
};

// Resolution presets. Current (120x80 @ 8px) is the minimum.
export const RESOLUTION_PRESETS = [
  { name: 'Auto (fit window)', width: 0, height: 0, auto: true },
  { name: 'Small (120x80)', width: 120, height: 80 },
  { name: 'Medium (160x100)', width: 160, height: 100 },
  { name: 'Large (200x130)', width: 200, height: 130 },
  { name: 'XL (240x160)', width: 240, height: 160 },
  { name: 'XXL (320x200)', width: 320, height: 200 },
  { name: 'Ultra (400x250)', width: 400, height: 250 },
  { name: 'Custom', width: 0, height: 0, custom: true },
];

// Speed presets accessible via hotkeys / slider.
export const SPEED_PRESETS = [
  { name: 'Paused', value: 0.0 },
  { name: '0.25x', value: 0.25 },
  { name: '0.5x', value: 0.5 },
  { name: '1x', value: 1.0 },
  { name: '2x', value: 2.0 },
  { name: '4x', value: 4.0 },
  { name: '8x', value: 8.0 },
  { name: 'Hyper 16x', value: 16.0 },
  { name: 'Hyper 32x', value: 32.0 },
  { name: 'Hyper 64x', value: 64.0 },
  { name: 'Ultra 128x', value: 128.0 },
  { name: 'Ultra 256x', value: 256.0 },
];

// Cell type constants
export const CELL_TYPE = {
  EMPTY: 0,
  DEFENSE: 1,
  MISSILE: 2,
  CITY: 3,
  EXPLOSION: 4,
  PENDING: 5,
  BARRIER: 6,
  FIRE: 7,
};
/**
 * Preset game modes. Each entry patches a subset of CONFIG keys.
 * Applied via Settings.applyGameMode(id).
 *
 * Keys not listed in a preset are left at their current values so
 * presets can be layered on top of custom settings.
 */
export const GAME_MODE_PRESETS = [
  {
    id: 'custom',
    name: '— Custom —',
    desc: 'Your current settings (no preset applied).',
    patch: null,
  },
  {
    id: 'tutorial',
    name: '🌱 Tutorial',
    desc: 'Very slow, generous ink, few enemies. Classic Conway rules. Great for learning.',
    patch: {
      ACTIVE_RULESET: 'conway',
      INITIAL_INK: 400,
      MAX_INK: 500,
      INK_REGEN_RATE: 1.2,
      MISSILES_PER_WAVE_BASE: 2,
      MISSILES_PER_WAVE_INC: 1,
      MISSILE_SPAWN_INTERVAL: 2200,
      MISSILE_SPAWN_MIN: 1200,
      MISSILE_SPAWN_DECREMENT: 20,
      GLIDER_SE: true,
      GLIDER_SW: false,
      GLIDER_HEAVY: false,
      GLIDER_LWSS: false,
      GLIDER_MWSS: false,
      GLIDER_TWIN: false,
      GLIDER_GUN: false,
      INK_DRY_TICKS: 2,
      HARDCORE_MODE: false,
      BASE_SPAWN_ENABLED: false,
      CITY_COUNT: 5,
      DEFENDER_TICKS: 1,
      ATTACKER_TICKS: 1,
      DRAW_ZONE_FRACTION: 0.6,
      REAR_DEAD_ZONE_HEIGHT: 2,
      CLEAR_REFUND_FRACTION: 0.75,
      ABILITY_DOUBLE_SCORE: false,
      ABILITY_NO_DRY: false,
      ABILITY_WAVE_BONUS: true,
      ABILITY_SAFE_ZONE: true,
      ABILITY_SLOW_MISSILES: false,
      ABILITY_EMP_BURST: false,
      ABILITY_INK_SURGE: true,
      ABILITY_FREEZE: true,
    },
  },
  {
    id: 'classic',
    name: '🎮 Classic',
    desc: 'Balanced default experience. Conway rules, SE + SW gliders, moderate pace.',
    patch: {
      ACTIVE_RULESET: 'conway',
      INITIAL_INK: 200,
      MAX_INK: 300,
      INK_REGEN_RATE: 0.5,
      MISSILES_PER_WAVE_BASE: 8,
      MISSILES_PER_WAVE_INC: 3,
      MISSILE_SPAWN_INTERVAL: 800,
      MISSILE_SPAWN_MIN: 300,
      MISSILE_SPAWN_DECREMENT: 75,
      GLIDER_SE: true,
      GLIDER_SW: true,
      GLIDER_HEAVY: false,
      GLIDER_LWSS: false,
      GLIDER_MWSS: false,
      GLIDER_TWIN: false,
      GLIDER_GUN: false,
      INK_DRY_TICKS: 5,
      HARDCORE_MODE: false,
      BASE_SPAWN_ENABLED: true,
      BASE_SPAWN_COUNT_BASE: 1,
      BASE_SPAWN_COUNT_INC: 0.5,
      CITY_COUNT: 5,
      DEFENDER_TICKS: 1,
      ATTACKER_TICKS: 1,
      DRAW_ZONE_FRACTION: 0.5,
      REAR_DEAD_ZONE_HEIGHT: 2,
      CLEAR_REFUND_FRACTION: 0.5,
    },
  },
  {
    id: 'blitz',
    name: '⚡ Blitz',
    desc: 'Fast spawns, short-lived cells, high pressure. DryLife rules add extra births. Reflexes required.',
    patch: {
      ACTIVE_RULESET: 'dry_life',
      INITIAL_INK: 250,
      MAX_INK: 400,
      INK_REGEN_RATE: 1.6,
      MISSILES_PER_WAVE_BASE: 12,
      MISSILES_PER_WAVE_INC: 4,
      MISSILE_SPAWN_INTERVAL: 500,
      MISSILE_SPAWN_MIN: 200,
      MISSILE_SPAWN_DECREMENT: 60,
      GLIDER_SE: true,
      GLIDER_SW: true,
      GLIDER_HEAVY: true,
      GLIDER_LWSS: false,
      GLIDER_MWSS: false,
      GLIDER_TWIN: true,
      GLIDER_GUN: false,
      INK_DRY_TICKS: 2,
      HARDCORE_MODE: false,
      BASE_SPAWN_ENABLED: true,
      BASE_SPAWN_COUNT_BASE: 2,
      BASE_SPAWN_COUNT_INC: 0.75,
      CITY_COUNT: 5,
      DEFENDER_TICKS: 2,
      ATTACKER_TICKS: 1,
      DRAW_ZONE_FRACTION: 0.5,
      REAR_DEAD_ZONE_HEIGHT: 2,
      CLEAR_REFUND_FRACTION: 0.4,
      ABILITY_EMP_BURST: true,
      ABILITY_FREEZE: true,
      ABILITY_INK_SURGE: true,
      ABILITY_NO_DRY: true,
    },
  },
  {
    id: 'armada',
    name: '🛸 Armada',
    desc: 'Spaceships and twin formations. HighLife rules support replicators. Bigger patterns, more ink.',
    patch: {
      ACTIVE_RULESET: 'highlife',
      INITIAL_INK: 300,
      MAX_INK: 500,
      INK_REGEN_RATE: 1.0,
      MISSILES_PER_WAVE_BASE: 6,
      MISSILES_PER_WAVE_INC: 2,
      MISSILE_SPAWN_INTERVAL: 900,
      MISSILE_SPAWN_MIN: 400,
      MISSILE_SPAWN_DECREMENT: 50,
      GLIDER_SE: false,
      GLIDER_SW: false,
      GLIDER_HEAVY: false,
      GLIDER_LWSS: true,
      GLIDER_MWSS: true,
      GLIDER_TWIN: true,
      GLIDER_GUN: false,
      INK_DRY_TICKS: 4,
      HARDCORE_MODE: false,
      BASE_SPAWN_ENABLED: true,
      BASE_SPAWN_COUNT_BASE: 1,
      BASE_SPAWN_COUNT_INC: 0.5,
      CITY_COUNT: 5,
      DEFENDER_TICKS: 1,
      ATTACKER_TICKS: 1,
      DRAW_ZONE_FRACTION: 0.55,
      REAR_DEAD_ZONE_HEIGHT: 3,
      CLEAR_REFUND_FRACTION: 0.5,
      BASE_TYPE_CRUISER_E: 1.2,
      BASE_TYPE_CRUISER_W: 1.2,
      BASE_TYPE_FORTRESS: 0.5,
      BASE_TYPE_BUNKER: 0.5,
    },
  },
  {
    id: 'siege',
    name: '🏰 Siege',
    desc: 'Heavy bases dominate the battlefield. Maze rules create defensive corridors. Destroy bases or be overwhelmed.',
    patch: {
      ACTIVE_RULESET: 'maze',
      INITIAL_INK: 350,
      MAX_INK: 550,
      INK_REGEN_RATE: 1.3,
      MISSILES_PER_WAVE_BASE: 5,
      MISSILES_PER_WAVE_INC: 2,
      MISSILE_SPAWN_INTERVAL: 1000,
      MISSILE_SPAWN_MIN: 500,
      MISSILE_SPAWN_DECREMENT: 40,
      GLIDER_SE: true,
      GLIDER_SW: true,
      GLIDER_HEAVY: true,
      GLIDER_LWSS: false,
      GLIDER_MWSS: false,
      GLIDER_TWIN: false,
      GLIDER_GUN: false,
      INK_DRY_TICKS: 4,
      HARDCORE_MODE: false,
      BASE_SPAWN_ENABLED: true,
      BASE_SPAWN_COUNT_BASE: 3,
      BASE_SPAWN_COUNT_INC: 1.0,
      BASE_SPAWN_MAX: 8,
      CITY_COUNT: 5,
      DEFENDER_TICKS: 1,
      ATTACKER_TICKS: 1,
      DRAW_ZONE_FRACTION: 0.5,
      REAR_DEAD_ZONE_HEIGHT: 2,
      CLEAR_REFUND_FRACTION: 0.6,
      BASE_TYPE_FORTRESS: 1.5,
      BASE_TYPE_BUNKER: 1.2,
      BASE_TYPE_CRUISER_E: 0.4,
      BASE_TYPE_CRUISER_W: 0.4,
      ABILITY_EMP_BURST: true,
      ABILITY_INK_SURGE: true,
    },
  },
  {
    id: 'hardcore',
    name: '💀 Hardcore',
    desc: 'Friendly fire ON. Your defenses can kill your own cities. Conway rules, fast attackers. Be precise.',
    patch: {
      ACTIVE_RULESET: 'conway',
      INITIAL_INK: 180,
      MAX_INK: 280,
      INK_REGEN_RATE: 0.6,
      MISSILES_PER_WAVE_BASE: 10,
      MISSILES_PER_WAVE_INC: 3,
      MISSILE_SPAWN_INTERVAL: 700,
      MISSILE_SPAWN_MIN: 300,
      MISSILE_SPAWN_DECREMENT: 60,
      GLIDER_SE: true,
      GLIDER_SW: true,
      GLIDER_HEAVY: true,
      GLIDER_LWSS: false,
      GLIDER_MWSS: false,
      GLIDER_TWIN: false,
      GLIDER_GUN: false,
      INK_DRY_TICKS: 4,
      HARDCORE_MODE: true,
      BASE_SPAWN_ENABLED: true,
      BASE_SPAWN_COUNT_BASE: 2,
      BASE_SPAWN_COUNT_INC: 0.75,
      CITY_COUNT: 4,
      DEFENDER_TICKS: 1,
      ATTACKER_TICKS: 1,
      DRAW_ZONE_FRACTION: 0.45,
      REAR_DEAD_ZONE_HEIGHT: 3,
      CLEAR_REFUND_FRACTION: 0.3,
      ABILITY_DOUBLE_SCORE: true,
      ABILITY_SAFE_ZONE: false,
      ABILITY_NO_DRY: false,
    },
  },
  {
    id: 'pacifist',
    name: '🕊 Pacifist',
    desc: 'Slow and contemplative. Long Life rules let patterns evolve gracefully. Minimal pressure.',
    patch: {
      ACTIVE_RULESET: 'long_life',
      INITIAL_INK: 500,
      MAX_INK: 700,
      INK_REGEN_RATE: 2.0,
      MISSILES_PER_WAVE_BASE: 3,
      MISSILES_PER_WAVE_INC: 1,
      MISSILE_SPAWN_INTERVAL: 2000,
      MISSILE_SPAWN_MIN: 1000,
      MISSILE_SPAWN_DECREMENT: 15,
      GLIDER_SE: true,
      GLIDER_SW: true,
      GLIDER_HEAVY: false,
      GLIDER_LWSS: false,
      GLIDER_MWSS: false,
      GLIDER_TWIN: false,
      GLIDER_GUN: false,
      INK_DRY_TICKS: 1,
      HARDCORE_MODE: false,
      BASE_SPAWN_ENABLED: false,
      CITY_COUNT: 6,
      DEFENDER_TICKS: 1,
      ATTACKER_TICKS: 1,
      DRAW_ZONE_FRACTION: 0.65,
      REAR_DEAD_ZONE_HEIGHT: 2,
      CLEAR_REFUND_FRACTION: 0.9,
      ABILITY_SAFE_ZONE: true,
      ABILITY_SLOW_MISSILES: true,
      ABILITY_WAVE_BONUS: true,
      ABILITY_INK_SURGE: true,
      ABILITY_FREEZE: true,
    },
  },
  {
    id: 'chaos',
    name: '🌀 Chaos',
    desc: 'Everything enabled. Glider guns, spaceships, bases. HighLife replicators. Pure mayhem.',
    patch: {
      ACTIVE_RULESET: 'highlife',
      INITIAL_INK: 400,
      MAX_INK: 700,
      INK_REGEN_RATE: 2.0,
      MISSILES_PER_WAVE_BASE: 15,
      MISSILES_PER_WAVE_INC: 5,
      MISSILE_SPAWN_INTERVAL: 500,
      MISSILE_SPAWN_MIN: 200,
      MISSILE_SPAWN_DECREMENT: 80,
      GLIDER_SE: true,
      GLIDER_SW: true,
      GLIDER_HEAVY: true,
      GLIDER_LWSS: true,
      GLIDER_MWSS: true,
      GLIDER_TWIN: true,
      GLIDER_GUN: true,
      INK_DRY_TICKS: 2,
      HARDCORE_MODE: false,
      BASE_SPAWN_ENABLED: true,
      BASE_SPAWN_COUNT_BASE: 3,
      BASE_SPAWN_COUNT_INC: 1.0,
      BASE_SPAWN_MAX: 8,
      CITY_COUNT: 5,
      DEFENDER_TICKS: 2,
      ATTACKER_TICKS: 1,
      DRAW_ZONE_FRACTION: 0.5,
      REAR_DEAD_ZONE_HEIGHT: 2,
      CLEAR_REFUND_FRACTION: 0.5,
      ABILITY_EMP_BURST: true,
      ABILITY_FREEZE: true,
      ABILITY_INK_SURGE: true,
      ABILITY_NO_DRY: true,
      ABILITY_DOUBLE_SCORE: true,
    },
  },
  {
    id: 'maze_runner',
    name: '🧩 Maze Runner',
    desc: 'Mazectric rules: thin corridors form naturally. Slow attackers, strategic positioning.',
    patch: {
      ACTIVE_RULESET: 'mazectric',
      INITIAL_INK: 350,
      MAX_INK: 500,
      INK_REGEN_RATE: 1.0,
      MISSILES_PER_WAVE_BASE: 5,
      MISSILES_PER_WAVE_INC: 2,
      MISSILE_SPAWN_INTERVAL: 1400,
      MISSILE_SPAWN_MIN: 600,
      MISSILE_SPAWN_DECREMENT: 40,
      GLIDER_SE: true,
      GLIDER_SW: true,
      GLIDER_HEAVY: false,
      GLIDER_LWSS: false,
      GLIDER_MWSS: false,
      GLIDER_TWIN: false,
      GLIDER_GUN: false,
      INK_DRY_TICKS: 3,
      HARDCORE_MODE: false,
      BASE_SPAWN_ENABLED: true,
      BASE_SPAWN_COUNT_BASE: 1,
      BASE_SPAWN_COUNT_INC: 0.5,
      CITY_COUNT: 5,
      DEFENDER_TICKS: 1,
      ATTACKER_TICKS: 1,
      DRAW_ZONE_FRACTION: 0.55,
      REAR_DEAD_ZONE_HEIGHT: 2,
      CLEAR_REFUND_FRACTION: 0.6,
      ABILITY_NO_DRY: true,
      ABILITY_WAVE_BONUS: true,
    },
  },
  {
    id: 'apocalypse',
    name: '☄️ Apocalypse',
    desc: 'Seeds rule: every cell dies each tick. Patterns explode into chaos. Very short cell lifespans.',
    patch: {
      ACTIVE_RULESET: 'seeds',
      INITIAL_INK: 600,
      MAX_INK: 800,
      INK_REGEN_RATE: 3.0,
      MISSILES_PER_WAVE_BASE: 4,
      MISSILES_PER_WAVE_INC: 2,
      MISSILE_SPAWN_INTERVAL: 1200,
      MISSILE_SPAWN_MIN: 500,
      MISSILE_SPAWN_DECREMENT: 50,
      GLIDER_SE: true,
      GLIDER_SW: true,
      GLIDER_HEAVY: false,
      GLIDER_LWSS: false,
      GLIDER_MWSS: false,
      GLIDER_TWIN: false,
      GLIDER_GUN: false,
      INK_DRY_TICKS: 1,
      HARDCORE_MODE: false,
      BASE_SPAWN_ENABLED: false,
      CITY_COUNT: 4,
      DEFENDER_TICKS: 1,
      ATTACKER_TICKS: 1,
      DRAW_ZONE_FRACTION: 0.6,
      REAR_DEAD_ZONE_HEIGHT: 2,
      CLEAR_REFUND_FRACTION: 0.8,
      ABILITY_INK_SURGE: true,
      ABILITY_NO_DRY: true,
      ABILITY_FREEZE: true,
    },
  },
  {
    id: 'fortress',
    name: '🛡️ Fortress',
    desc: 'Life Without Death: your defenses are permanent. Build carefully — cells never die.',
    patch: {
      ACTIVE_RULESET: 'life_without_death',
      INITIAL_INK: 150,
      MAX_INK: 250,
      INK_REGEN_RATE: 0.4,
      MISSILES_PER_WAVE_BASE: 8,
      MISSILES_PER_WAVE_INC: 3,
      MISSILE_SPAWN_INTERVAL: 900,
      MISSILE_SPAWN_MIN: 400,
      MISSILE_SPAWN_DECREMENT: 60,
      GLIDER_SE: true,
      GLIDER_SW: true,
      GLIDER_HEAVY: false,
      GLIDER_LWSS: false,
      GLIDER_MWSS: false,
      GLIDER_TWIN: false,
      GLIDER_GUN: false,
      INK_DRY_TICKS: 6,
      HARDCORE_MODE: false,
      BASE_SPAWN_ENABLED: true,
      BASE_SPAWN_COUNT_BASE: 2,
      BASE_SPAWN_COUNT_INC: 0.5,
      CITY_COUNT: 5,
      DEFENDER_TICKS: 1,
      ATTACKER_TICKS: 1,
      DRAW_ZONE_FRACTION: 0.5,
      REAR_DEAD_ZONE_HEIGHT: 2,
      CLEAR_REFUND_FRACTION: 0.2,
      ABILITY_WAVE_BONUS: true,
      ABILITY_EMP_BURST: true,
      ABILITY_DOUBLE_SCORE: true,
    },
  },
  {
    id: 'replicators',
    name: '🔁 Replicators',
    desc: 'HighLife with glider guns enabled. Replicator patterns can copy themselves. Asymmetric warfare.',
    patch: {
      ACTIVE_RULESET: 'highlife',
      INITIAL_INK: 280,
      MAX_INK: 450,
      INK_REGEN_RATE: 1.2,
      MISSILES_PER_WAVE_BASE: 6,
      MISSILES_PER_WAVE_INC: 2,
      MISSILE_SPAWN_INTERVAL: 850,
      MISSILE_SPAWN_MIN: 350,
      MISSILE_SPAWN_DECREMENT: 65,
      GLIDER_SE: true,
      GLIDER_SW: true,
      GLIDER_HEAVY: false,
      GLIDER_LWSS: false,
      GLIDER_MWSS: false,
      GLIDER_TWIN: false,
      GLIDER_GUN: true,
      INK_DRY_TICKS: 3,
      HARDCORE_MODE: false,
      BASE_SPAWN_ENABLED: true,
      BASE_SPAWN_COUNT_BASE: 1,
      BASE_SPAWN_COUNT_INC: 0.4,
      CITY_COUNT: 5,
      DEFENDER_TICKS: 1,
      ATTACKER_TICKS: 1,
      DRAW_ZONE_FRACTION: 0.5,
      REAR_DEAD_ZONE_HEIGHT: 2,
      CLEAR_REFUND_FRACTION: 0.5,
      ABILITY_EMP_BURST: true,
      ABILITY_DOUBLE_SCORE: true,
      ABILITY_NO_DRY: true,
    },
  },
  {
    id: 'turtle',
    name: '🐢 Turtle',
    desc: 'Defender-favored timestep (3:1). Your cells evolve 3x faster than enemies. Strategic mastermind mode.',
    patch: {
      ACTIVE_RULESET: 'conway',
      INITIAL_INK: 300,
      MAX_INK: 450,
      INK_REGEN_RATE: 0.8,
      MISSILES_PER_WAVE_BASE: 8,
      MISSILES_PER_WAVE_INC: 3,
      MISSILE_SPAWN_INTERVAL: 1000,
      MISSILE_SPAWN_MIN: 400,
      MISSILE_SPAWN_DECREMENT: 70,
      GLIDER_SE: true,
      GLIDER_SW: true,
      GLIDER_HEAVY: false,
      GLIDER_LWSS: true,
      GLIDER_MWSS: false,
      GLIDER_TWIN: false,
      GLIDER_GUN: false,
      INK_DRY_TICKS: 4,
      HARDCORE_MODE: false,
      BASE_SPAWN_ENABLED: true,
      BASE_SPAWN_COUNT_BASE: 1,
      BASE_SPAWN_COUNT_INC: 0.5,
      CITY_COUNT: 5,
      DEFENDER_TICKS: 3,
      ATTACKER_TICKS: 1,
      DRAW_ZONE_FRACTION: 0.5,
      REAR_DEAD_ZONE_HEIGHT: 2,
      CLEAR_REFUND_FRACTION: 0.5,
      ABILITY_WAVE_BONUS: true,
      ABILITY_FREEZE: true,
    },
  },
  {
    id: 'lightning',
    name: '⚡⚡ Lightning',
    desc: 'Attacker-favored timestep (1:3). Enemies evolve 3x faster. Brutal speed test.',
    patch: {
      ACTIVE_RULESET: 'conway',
      INITIAL_INK: 350,
      MAX_INK: 550,
      INK_REGEN_RATE: 2.5,
      MISSILES_PER_WAVE_BASE: 6,
      MISSILES_PER_WAVE_INC: 2,
      MISSILE_SPAWN_INTERVAL: 1100,
      MISSILE_SPAWN_MIN: 500,
      MISSILE_SPAWN_DECREMENT: 50,
      GLIDER_SE: true,
      GLIDER_SW: true,
      GLIDER_HEAVY: false,
      GLIDER_LWSS: false,
      GLIDER_MWSS: false,
      GLIDER_TWIN: true,
      GLIDER_GUN: false,
      INK_DRY_TICKS: 1,
      HARDCORE_MODE: false,
      BASE_SPAWN_ENABLED: true,
      BASE_SPAWN_COUNT_BASE: 1,
      BASE_SPAWN_COUNT_INC: 0.4,
      CITY_COUNT: 5,
      DEFENDER_TICKS: 1,
      ATTACKER_TICKS: 3,
      DRAW_ZONE_FRACTION: 0.55,
      REAR_DEAD_ZONE_HEIGHT: 3,
      CLEAR_REFUND_FRACTION: 0.6,
      ABILITY_NO_DRY: true,
      ABILITY_EMP_BURST: true,
      ABILITY_FREEZE: true,
      ABILITY_INK_SURGE: true,
    },
  },
];
