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
  // Cell aging: cells of DEFENSE/MISSILE type that survive this many ticks
  // are automatically removed. At TICK_RATE=100ms, 200 ticks = 20 seconds.
  CELL_MAX_AGE_TICKS: 200,
  // Separate max age for missile cells. When a missile cell expires, it despawns
  // with 100% chance, and any neighboring missile cells within
  // MISSILE_CASCADE_TICKS of their own expiry also despawn.
  MISSILE_MAX_AGE_TICKS: 150,
  MISSILE_CASCADE_TICKS: 20, // ~2 seconds at TICK_RATE=100ms

  // Cities
  CITY_COUNT: 5,
  CITY_WIDTH: 5,
  CITY_HEIGHT: 3,

  // Glider types enabled for missile spawning.
  // At least one must be true; if all are false, defaults to SE_GLIDER.
  GLIDER_SE: true,   // R-type: classic SE-moving Conway glider
  GLIDER_SW: true,   // L-type: mirrored SW-moving Conway glider
  GLIDER_HEAVY: false, // Target Emplacements: stationary spawners (destroy to clear!)
  GLIDER_LWSS: false,  // Lightweight Spaceship: fast diagonal spaceship
  GLIDER_MWSS: false,  // Middleweight Spaceship: larger, more durable
  GLIDER_TWIN: false,  // Twin glider: two gliders in formation
  GLIDER_GUN: false,   // Gosper Glider Gun: spawns a glider factory (RARE & DEADLY)

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
  // Hardcore mode: when enabled, the player's own defense cells damage cities
  // on contact, just like missiles do.
  HARDCORE_MODE: false,
  // Drawable area: fraction of grid height from bottom that the player can
  // draw defenses in. 0.5 = bottom half (default). Range: 0.2 .. 0.8.
  DRAW_ZONE_FRACTION: 0.5,
  // Whether to render a visible boundary line at the top of the draw zone.
  SHOW_DRAW_ZONE: true,
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
  // Allow opening the Settings panel during active gameplay (via S hotkey
  // or the in-game gear button). When true, opening Settings mid-game
  // pauses the simulation; closing resumes it. When false, Settings is
  // only accessible from the main menu / game over screen.
  IN_PLAY_SETTINGS_ENABLED: true,


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
  {name: 'Auto (fit window)', width: 0, height: 0, auto: true},
  {name: 'Small (120x80)', width: 120, height: 80},
  {name: 'Medium (160x100)', width: 160, height: 100},
  {name: 'Large (200x130)', width: 200, height: 130},
  {name: 'XL (240x160)', width: 240, height: 160},
  {name: 'XXL (320x200)', width: 320, height: 200},
  {name: 'Ultra (400x250)', width: 400, height: 250},
  {name: 'Custom', width: 0, height: 0, custom: true},
];

// Speed presets accessible via hotkeys / slider.
export const SPEED_PRESETS = [
  {name: 'Paused', value: 0.0},
  {name: '0.25x', value: 0.25},
  {name: '0.5x', value: 0.5},
  {name: '1x', value: 1.0},
  {name: '2x', value: 2.0},
  {name: '4x', value: 4.0},
  {name: '8x', value: 8.0},
  {name: 'Hyper 16x', value: 16.0},
];

// Cell type constants
export const CELL_TYPE = {
  EMPTY: 0,
  DEFENSE: 1,
  MISSILE: 2,
  CITY: 3,
  EXPLOSION: 4,
  PENDING: 5,
};