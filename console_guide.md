# 🔧 Console Hacking Guide

Welcome to the **Arcade of Life** developer console! This game is fully hackable from your browser's DevTools. Everything from the live game state to simulation internals is exposed for inspection and mutation.

> **Open DevTools**: F12 (Windows/Linux) or Cmd+Option+I (Mac)

---

## 🎯 Quick Start

Once the game is loaded, try these in the console:

```javascript
cheats.help(); // List all cheats
cheats.dump(); // Print live game stats
cheats.infiniteInk(); // Cheat #1: never run out of ink
cheats.godMode(); // Cheat #2: full immortality
CONFIG.SPEED_MULTIPLIER = 8; // Cheat #3: hyperspeed
```

That's it. You're hacking the game.

---

## 🌍 Global Handles

The game exposes these top-level globals for easy console access:

| Global                      | Description                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `window.game`               | Live Game instance — everything is reachable from here                                               |
| `window.CONFIG`             | Live configuration object (mutate to tune)                                                           |
| `window.CELL_TYPE`          | Cell type enum: `{EMPTY:0, DEFENSE:1, MISSILE:2, CITY:3, EXPLOSION:4, PENDING:5, BARRIER:6, FIRE:7}` |
| `window.SPEED_PRESETS`      | List of speed preset configs                                                                         |
| `window.cheats`             | Cheat shortcuts (call `cheats.help()`)                                                               |
| `window.MD`                 | Namespaced bundle: `{game, CONFIG, CELL_TYPE, classes, Logger, ...}`                                 |
| `window.ArcadeOfLifeLogger` | Logger for debugging output                                                                          |
| `window.Sfx`                | Sound effects engine                                                                                 |

---

## 🎮 Cheats Reference

All cheats are accessed via `window.cheats.*`. They return descriptive values where applicable.

### Resource Cheats

```javascript
cheats.infiniteInk(); // Max ink (9999), max regen (100/tick)
cheats.refillInk(); // Top up to current max ink
cheats.addScore(1000); // Add bonus score
```

### Combat Cheats

```javascript
cheats.killAllMissiles(); // Vaporize every missile cell (returns count)
cheats.clearDefenses(); // Clear all defense cells (full refund)
cheats.reviveCities(); // Resurrect destroyed cities
cheats.freezeMissiles(); // Toggle missile spawning (good for screenshots)
cheats.godMode(); // Toggle immortality + auto-revive + full ink
```

### Wave & Score Manipulation

```javascript
cheats.skipWave(3); // Jump forward 3 waves
cheats.setWave(15); // Jump directly to wave 15
cheats.setSpeed(4); // Set speed multiplier (e.g. 0=pause, 1=normal, 8=hyper)
```

### Pattern Spawning

```javascript
// Spawn a glider at (50, 60)
cheats.spawnPattern(50, 60, [
  [1, 0],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
]);

// Spawn a Gosper glider gun (creates infinite gliders!)
cheats.gosperGun(5, 45);

// Spawn into missile layer instead of defense
cheats.spawnPattern(
  80,
  20,
  [
    [0, 0],
    [1, 0],
    [2, 0],
  ],
  CELL_TYPE.MISSILE
);
```

### Game Mode & Mode Configuration

```javascript
cheats.listModes(); // Show all game mode presets
cheats.setMode('chaos'); // Apply Chaos mode (everything enabled)
cheats.setMode('siege'); // Apply Siege mode (heavy bases)
cheats.setMode('classic'); // Reset to balanced default
```

### Visual Effects

```javascript
cheats.setVfx(false); // Disable all VFX (good for slow devices)
cheats.setVfx(true); // Re-enable all VFX

cheats.vfxStats(); // Show active count + dropped count + drop rate
cheats.resetVfxStats(); // Reset drop counters
```

### Custom Patterns

```javascript
cheats.listPatterns(); // List saved custom patterns
cheats.deletePattern('myname'); // Delete a saved pattern
cheats.clearPatterns(); // Delete ALL saved patterns
cheats.captureMode(); // Toggle pattern-capture mode
```

### Diagnostics

```javascript
cheats.dump(); // Print full game state table
cheats.resetHighScore(); // Clear saved high score
```

---

## 🔬 Live Game State

The `window.game` object is the root of everything. Explore it:

```javascript
// Top-level subsystems
game.grid; // The cell grid (cells, pending, ages, colors, dirs)
game.simulation; // The simulation engine
game.renderer; // Canvas renderer + VFX system
game.hud; // HUD state (score, wave, ink, etc.)
game.cities; // City placement + tracking
game.missiles; // Missile spawning + bases + spawners
game.defenses; // Ink management
game.input; // Drawing input manager
game.gameState; // State machine
game.settings; // Settings + persistence
game.story; // Story mode engine
game.patternZoo; // Pattern browser
game.levelDesigner; // Level editor
game.audio; // Sound effects (also at window.Sfx)
```

### Inspecting Cells

```javascript
// Cell types at position (x, y)
game.grid.get(50, 70); // Returns CELL_TYPE value
game.grid.cells[70 * game.grid.width + 50]; // Direct array access

// Cell metadata
game.grid.cellAge[i]; // Age in ticks (0-255, saturating)
game.grid.cellColor[i]; // Color variant index
game.grid.cellDir[i]; // Direction (0=unknown, 1=down, 2=up, 3=east, 4=west)

// Pending (newly-drawn, drying) cells
game.grid.pending[i]; // 1 = pending, 0 = empty
game.grid.pendingDry[i]; // Remaining dry ticks

// Set a cell directly
game.grid.set(50, 70, CELL_TYPE.DEFENSE);
```

### Counting Things

```javascript
// Count cells of each type
let counts = { defense: 0, missile: 0, city: 0 };
for (let i = 0; i < game.grid.cells.length; i++) {
  if (game.grid.cells[i] === CELL_TYPE.DEFENSE) counts.defense++;
  else if (game.grid.cells[i] === CELL_TYPE.MISSILE) counts.missile++;
  else if (game.grid.cells[i] === CELL_TYPE.CITY) counts.city++;
}
console.table(counts);

// Or use the built-in counter
import { countCells } from './src/sim/cellCounts.js';
countCells(game.grid);
```

---

## ⚙️ Live Configuration

All of `CONFIG` is live — changes apply immediately:

### Common Tuning

```javascript
// Pacing
CONFIG.SPEED_MULTIPLIER = 2.0; // 0=paused, 1=normal, up to 256
CONFIG.TICK_RATE = 50; // ms per simulation tick (lower = faster)
CONFIG.DEFENDER_TICKS = 2; // M in M:N timestep
CONFIG.ATTACKER_TICKS = 1; // N in M:N timestep

// Ink economy
CONFIG.INITIAL_INK = 500;
CONFIG.MAX_INK = 1000;
CONFIG.INK_REGEN_RATE = 2.0;
CONFIG.INK_DRY_TICKS = 0; // Instant commit (no drying delay)

// Waves
CONFIG.MISSILES_PER_WAVE_BASE = 20;
CONFIG.MISSILE_SPAWN_INTERVAL = 200; // Faster missile spawns
CONFIG.MISSILE_SPAWN_MIN = 100; // Minimum spawn delay

// Friendly fire mode
CONFIG.HARDCORE_MODE = true; // Your defenses can hurt your cities!

// Draw zone
CONFIG.DRAW_ZONE_FRACTION = 0.7; // Bigger drawable area
CONFIG.SHOW_DRAW_ZONE = false; // Hide zone indicator

// Visual effects
CONFIG.VFX_PARTICLES = false; // Disable particles
CONFIG.VFX_SCREEN_SHAKE = false; // Disable screen shake
CONFIG.VFX_FLOATERS = false; // Disable floating text
```

### Glider Types

Enable/disable specific enemy glider types:

```javascript
CONFIG.GLIDER_SE = true; // R-glider (SE direction)
CONFIG.GLIDER_SW = true; // L-glider (SW direction)
CONFIG.GLIDER_HEAVY = false; // Target emplacements
CONFIG.GLIDER_LWSS = true; // Lightweight spaceship
CONFIG.GLIDER_MWSS = false; // Middleweight spaceship
CONFIG.GLIDER_TWIN = true; // Twin formation
CONFIG.GLIDER_GUN = false; // Gosper glider gun (RARE & DEADLY)
```

### Age Limits (Region × Cell Type Matrix)

Set how long cells live in each region. Sentinel value `999999` = unlimited.

```javascript
// Friendly region (player's draw zone)
CONFIG.DEFENSE_AGE_FRIENDLY = 200;
CONFIG.MISSILE_AGE_FRIENDLY = 50; // Missiles age fast in friendly territory

// Enemy region (top of screen)
CONFIG.DEFENSE_AGE_ENEMY = 30; // Defenses don't last long in enemy zone
CONFIG.MISSILE_AGE_ENEMY = 999999; // Missiles immortal in their home

// Neutral region (middle band)
CONFIG.DEFENSE_AGE_NEUTRAL = 100;
CONFIG.MISSILE_AGE_NEUTRAL = 100;

// Rear dead zone (below draw zone)
CONFIG.REAR_DEAD_ZONE_AGE_LIMIT = 10; // Everything dies fast back here

// Age contagion (death spreads)
CONFIG.AGE_CONTAGION_AMOUNT = 5; // When a cell dies, neighbors age by 5
```

### Rulesets

```javascript
CONFIG.ACTIVE_RULESET = 'highlife'; // Switch to HighLife rules
CONFIG.ENEMY_RULESET = 'seeds'; // Asymmetric: enemies use Seeds

// Or via the imports
import { setActiveRuleset, listRulesets } from './src/rules/index.js';
setActiveRuleset('day_night');

// List available
listRulesets().forEach((r) => console.log(r.id, r.name, r.notation));
```

### Reload World

After major config changes, rebuild the world:

```javascript
CONFIG.GRID_WIDTH = 200;
CONFIG.GRID_HEIGHT = 150;
game.rebuildWorld(); // Apply new grid size
```

---

## 🧬 Working with Patterns

### Stamp Custom Patterns

```javascript
// Define a pattern as [[dx, dy], ...]
const blinker = [
  [0, 0],
  [1, 0],
  [2, 0],
];
const acorn = [
  [1, 0],
  [3, 1],
  [0, 2],
  [1, 2],
  [4, 2],
  [5, 2],
  [6, 2],
];

// Stamp at (x, y) as defense cells
cheats.spawnPattern(50, 60, acorn);

// Stamp as missile cells
cheats.spawnPattern(80, 20, blinker, CELL_TYPE.MISSILE);
```

### Pre-built Famous Patterns

```javascript
// Gosper glider gun (emits gliders forever)
cheats.gosperGun(5, 30);

// R-pentomino (chaotic methuselah)
cheats.spawnPattern(60, 60, [
  [1, 0],
  [2, 0],
  [0, 1],
  [1, 1],
  [1, 2],
]);

// Diehard (survives exactly 130 generations)
cheats.spawnPattern(60, 60, [
  [6, 0],
  [0, 1],
  [1, 1],
  [1, 2],
  [5, 2],
  [6, 2],
  [7, 2],
]);

// Lightweight spaceship
cheats.spawnPattern(60, 60, [
  [1, 0],
  [4, 0],
  [0, 1],
  [0, 2],
  [4, 2],
  [0, 3],
  [1, 3],
  [2, 3],
  [3, 3],
]);
```

### Access Pattern Library

```javascript
import { listPatterns, getPattern, clonePatternCells } from './src/patterns/index.js';

// List all patterns
listPatterns().forEach((p) => console.log(p.id, p.name, p.category));

// Filter by category
listPatterns({ category: 'spaceship' });
listPatterns({ ruleset: 'conway' });
listPatterns({ tag: 'gun' });

// Get a specific pattern
const glider = getPattern('glider');
console.log(glider.cells); // [[1,0],[2,1],[0,2],[1,2],[2,2]]

// Get a mutable copy
const cells = clonePatternCells('gosper_gun');
cheats.spawnPattern(10, 20, cells);
```

---

## 🎨 Visual Effects API

Trigger VFX manually from the console:

```javascript
const r = game.renderer;

// Particle burst at grid (x, y)
r.addParticleBurst(50, 60, {
  count: 30,
  colors: ['#ff00ff', '#00ffff', '#ffff00'],
  speed: 2.5,
  ttl: 50,
  size: 3,
  glow: 12,
  gravity: 0.05,
});

// Expanding shockwave ring
r.addShockwave(50, 60, {
  maxRadius: 80,
  color: '#ffff44',
  ttl: 40,
  width: 3,
});

// Floating text
r.addFloater(50, 60, 'HELLO!', '#00ffff');
r.addBigFloater(50, 60, 'EPIC!', '#ff00ff', 2.0);

// Screen shake (intensity, duration in ticks)
r.addShake(5, 30);

// VFX statistics
cheats.vfxStats(); // Shows active counts + drop rates
```

---

## 🔊 Audio Control

```javascript
// Mute control
Sfx.toggleMute(); // Toggle (returns new state)
Sfx.setMuted(true); // Mute
Sfx.setMuted(false); // Unmute
Sfx.setVolume(0.5); // 0.0 to 1.0

// Trigger specific sounds manually
Sfx.cityHit();
Sfx.annihilation();
Sfx.returnFire();
Sfx.ricochet();
Sfx.waveStart();
Sfx.gameOver();
Sfx.missileSpawn();
Sfx.inkPlace();
```

---

## 🛠 Advanced Hacking

### Custom Cheat Functions

Add your own:

```javascript
// Add to the cheats object on the fly
cheats.megaBomb = function () {
  const cx = game.grid.width / 2;
  const cy = game.grid.height / 2;
  game.renderer.addShockwave(cx, cy, {
    maxRadius: 200,
    color: '#ff0000',
    ttl: 80,
    width: 6,
  });
  game.renderer.addParticleBurst(cx, cy, {
    count: 200,
    colors: ['#ff0000', '#ffff00'],
    speed: 5,
    ttl: 100,
    size: 4,
  });
  cheats.killAllMissiles();
  game.renderer.addShake(20, 60);
};

cheats.megaBomb(); // 💥
```

### Simulation Backends

Force a specific simulation backend:

```javascript
CONFIG.SIM_BACKEND = 'gpu'; // Use WebGL2 (large grids only)
CONFIG.SIM_BACKEND = 'cpu'; // Use bitpacked CPU
CONFIG.SIM_BACKEND = 'auto'; // Auto-select based on grid size
game.rebuildWorld(); // Apply

// Inspect current backend
console.log(game.simulation.backend.constructor.name);
```

### Hashlife Cache

```javascript
CONFIG.SIM_HASHLIFE_ENABLED = false; // Disable for debugging

// Inspect cache stats
game.simulation.hashlife.stats();
// → { size: 1234, hits: 5678, misses: 234, hitRate: '0.960' }

game.simulation.hashlife.clear(); // Reset
```

### Logger

Control verbosity:

```javascript
ArcadeOfLifeLogger.setLevel('debug'); // Most verbose
ArcadeOfLifeLogger.setLevel('info'); // Default
ArcadeOfLifeLogger.setLevel('warn'); // Warnings only
ArcadeOfLifeLogger.setLevel('error'); // Errors only
ArcadeOfLifeLogger.setLevel('silent'); // Nothing

// Direct logging
ArcadeOfLifeLogger.info('Hello from the console!');
ArcadeOfLifeLogger.debug('Detailed debug info');
```

### Inspect Sim Internals

```javascript
// Current tick count
game.simulation.tickCount;

// Per-cell anchor flags (1 = immortal until first natural death)
game.simulation._anchor;

// Return-fire detection state
game.simulation.returnFireFired;

// Breach detection state
game.simulation.breachFired;

// Force-trigger return-fire detection
game.simulation._detectReturnFire(0, 4);
```

### Manipulate Missiles

```javascript
// Force-complete the current wave's spawning
game.missiles.forceCompleteSpawning();

// Spawn a custom designed base (zoo pattern)
game.missiles.setCustomBases([
  {
    patternId: 'gosper_gun',
    name: 'Custom Gun',
    x: 50,
    y: 10,
    width: 36,
    height: 9,
    cells: clonePatternCells('gosper_gun'),
  },
]);
game.missiles.startWave(0);

// Disable missile movement entirely
game.missiles.frozen = true;
game.simulation.freezeEnemies = true;
```

---

## 🐛 Debugging Tools

### Dump Game State

```javascript
cheats.dump();
// ┌─────────────┬──────────────┐
// │   (index)   │    Values    │
// ├─────────────┼──────────────┤
// │    state    │  'playing'   │
// │    wave     │      5       │
// │    score    │    12450     │
// │  highScore  │    18900     │
// │     ink     │    245       │
// │   maxInk    │    300       │
// │    speed    │      2       │
// │    grid     │  '120x80'    │
// │    cells    │     ...      │
// │ citiesAlive │      4       │
// │  tickCount  │     873      │
// └─────────────┴──────────────┘
```

### Inspect Frame Errors

```javascript
game._frameErrorCount; // Consecutive frame errors
game._MAX_FRAME_ERRORS; // Threshold for halting
```

### Monitor Simulation Hot Loop

```javascript
// Time a single tick
console.time('tick');
game.simulation.tick();
console.timeEnd('tick');

// Time 100 ticks
console.time('100ticks');
for (let i = 0; i < 100; i++) game.simulation.tick();
console.timeEnd('100ticks');
```

### Track Pattern Evolution

```javascript
// Spawn an R-pentomino and watch population over time
cheats.spawnPattern(60, 60, [
  [1, 0],
  [2, 0],
  [0, 1],
  [1, 1],
  [1, 2],
]);

let counts = [];
for (let i = 0; i < 200; i++) {
  game.simulation.tick();
  let n = 0;
  for (let c of game.grid.cells) if (c === 1) n++;
  counts.push(n);
}
console.log(counts.join(','));
```

---

## 🎓 Learning Resources

### Conway's Game of Life

The classic ruleset is **B3/S23**:

- A dead cell with exactly 3 live neighbors becomes alive (Birth)
- A live cell with 2 or 3 live neighbors stays alive (Survival)
- All other cells die or stay dead

### Pattern Categories

| Category       | Behavior                                              |
| -------------- | ----------------------------------------------------- |
| **Still life** | Stable; never changes                                 |
| **Oscillator** | Returns to itself after `period` generations          |
| **Spaceship**  | Returns to itself, translated (moves across the grid) |
| **Gun**        | Periodically emits other patterns (usually gliders)   |
| **Methuselah** | Small starting pattern with long, chaotic evolution   |
| **Puffer**     | Moves and emits debris behind it                      |

### B/S Notation

Other notable rulesets:

- **B36/S23** — HighLife (has replicators)
- **B3678/S34678** — Day & Night (color-invariant)
- **B2/S** — Seeds (everything dies each tick)
- **B3/S012345678** — Life Without Death (cells are permanent)
- **B3/S12345** — Maze (forms maze corridors)

Each ruleset profoundly changes pattern behavior. Experiment!

---

## 💡 Fun Experiments

### "What if defenses never died?"

```javascript
CONFIG.ACTIVE_RULESET = 'life_without_death';
cheats.infiniteInk();
```

### "What if everything was lightning fast?"

```javascript
CONFIG.SPEED_MULTIPLIER = 16;
CONFIG.TICK_RATE = 40;
CONFIG.MISSILE_SPAWN_INTERVAL = 100;
```

### "Asymmetric warfare"

```javascript
CONFIG.ACTIVE_RULESET = 'maze'; // Defenses build mazes
CONFIG.ENEMY_RULESET = 'highlife'; // Enemies use HighLife
```

### "Glider rain"

```javascript
CONFIG.GLIDER_GUN = true;
CONFIG.BASE_SPAWN_COUNT_BASE = 5;
CONFIG.BASE_SPAWN_MAX = 12;
cheats.setMode('chaos');
```

### "Cinematic slow motion"

```javascript
CONFIG.SPEED_MULTIPLIER = 0.25;
CONFIG.VFX_PARTICLES = true;
CONFIG.VFX_SHOCKWAVES = true;
CONFIG.VFX_SCREEN_SHAKE = true;
```

### "Build a glider factory"

```javascript
// Spawn 4 Gosper guns aimed at the center
cheats.gosperGun(5, 10);
cheats.gosperGun(80, 10);
cheats.gosperGun(5, 60);
cheats.gosperGun(80, 60);
cheats.infiniteInk();
CONFIG.SPEED_MULTIPLIER = 4;
```

---

## 🚀 Power User Tips

1. **Use the Logger** — Set `ArcadeOfLifeLogger.setLevel('debug')` to see what's happening internally
2. **Profile with Performance tab** — Chrome's Performance recorder works great
3. **Save your favorite configs** — Use Settings → Profiles or export JSON
4. **Capture chaos** — Use ◧ Capture Pattern to save interesting evolutionary results
5. **Make levels** — The Level Designer (D) saves levels as JSON you can share
6. **Test rulesets** — Pattern Zoo (Z) previews patterns under different rules
7. **Console history** — Use ↑ arrow to recall previous commands

---

## ❓ FAQ

**Q: Will cheats persist after page reload?**  
 A: Most don't. Settings/config changes persist via localStorage (in Settings panel). Cheat function calls are one-shot.

**Q: Can I save my hacked game state?**  
 A: Not directly, but you can: (1) screenshot, (2) use Level Designer to recreate, (3) export settings JSON.

**Q: Why doesn't `CONFIG.GRID_WIDTH = 500` work immediately?**  
 A: Grid size changes require `game.rebuildWorld()` to take effect.

**Q: How do I make my own ruleset?**  
 A: Either via Settings → Gameplay → Build Custom Neighborhood, or programmatically:

```javascript
import { registerRuleset, setActiveRuleset } from './src/rules/index.js';
registerRuleset({
  id: 'my_rule',
  name: 'My Rule',
  notation: 'B237/S345',
  birth: [2, 3, 7],
  survival: [3, 4, 5],
  description: 'My custom ruleset',
});
setActiveRuleset('my_rule');
```

**Q: Can I run the simulation without rendering?**  
 A: Yes — set `CONFIG.SPEED_MULTIPLIER = 0` and call `game.simulation.tick()` in a loop. Use the test/sim infrastructure for headless evolution analysis.

**Q: How do I report a bug I found via console hacking?**  
 A: Open a GitHub issue with your steps to reproduce. Include `cheats.dump()` output and `ArcadeOfLifeLogger` history.

---

## 🎉 Have Fun!

The Arcade of Life is meant to be **explored, broken, and rebuilt**. Every system is exposed because cellular automata are inherently about discovering emergent behavior.

Some of the best discoveries come from typing random things into the console and seeing what happens. Don't be afraid to experiment!

> "Any pattern is a thought. Every game is a universe." — Probably nobody, but it sounds good.

Happy hacking! 🌱✨
