# Console Hacking Guide: The Arcade of Life

A guide to bending The Arcade of Life to your will via the browser DevTools console.
All of these work by poking at the game's live state — no save files, no patching
required.

Open DevTools (F12 or Ctrl+Shift+I / Cmd+Opt+I), switch to the **Console** tab,
and have fun.

---

## 1. Getting a Handle on the Game

The game exposes itself on `window` automatically. No setup required:

```js
game; // the live Game instance
CONFIG; // live config object — mutate freely
CELL_TYPE; // {EMPTY:0, DEFENSE:1, MISSILE:2, CITY:3, EXPLOSION:4}
SPEED_PRESETS; // speed preset definitions
cheats; // cheat shortcuts (call cheats.help())
MD; // namespaced bundle: {game, CONFIG, CELL_TYPE, classes, ...}
```

A startup banner in the console reminds you of these. The `cheats` object is the
fast path:

```js
cheats.help(); // list all shortcuts
cheats.infiniteInk(); // max ink + regen
cheats.godMode(); // toggle immortal cities + ink refill every frame
cheats.killAllMissiles(); // panic button
cheats.skipWave(5); // jump ahead
cheats.gosperGun(10, 50); // drop a glider gun
cheats.dump(); // print a snapshot of game state
cheats.setMode('chaos'); // apply a game mode preset
cheats.listModes(); // see all available presets
```

### The Logger (always available)

```js
// Set log level — try 'debug' for verbose internal events
ArcadeOfLifeLogger.setLevel('debug');
ArcadeOfLifeLogger.setLevel('silent'); // shut it up
// Back-compat alias:
MissileDefenseLogger.setLevel('info');
```

---

## 2. Hacking CONFIG

`CONFIG` is already on `window`. It's read live every tick, so mutations take
effect immediately.

### Infinite Ink

```js
CONFIG.INITIAL_INK = 9999;
CONFIG.MAX_INK = 9999;
CONFIG.INK_REGEN_RATE = 100; // refills instantly every tick
```

Or just: `cheats.infiniteInk()`.

### Skip the Drying Wait

```js
CONFIG.INK_DRY_TICKS = 0; // defenses commit immediately on release
```

### Free Defense Clears

```js
CONFIG.CLEAR_REFUND_FRACTION = 1.0; // 100% refund on Clear Defenses
```

### Slow Missile Waves

```js
CONFIG.MISSILES_PER_WAVE_BASE = 1;
CONFIG.MISSILES_PER_WAVE_INC = 0;
CONFIG.MISSILE_SPAWN_INTERVAL = 5000;
CONFIG.MISSILE_SPAWN_MIN = 5000;
CONFIG.MISSILE_SPAWN_DECREMENT = 0;
```

Or freeze missile spawning entirely: `cheats.freezeMissiles(true)`.

### Make Defenses Immortal

```js
CONFIG.CELL_MAX_AGE_TICKS = 999999;
// Or per region:
CONFIG.DEFENSE_AGE_FRIENDLY = 999999;
CONFIG.DEFENSE_AGE_ENEMY = 999999;
```

### Make Missiles Fragile

```js
CONFIG.MISSILE_MAX_AGE_TICKS = 30; // missiles die of old age fast
CONFIG.MISSILE_CASCADE_TICKS = 100; // entire formations evaporate together
```

### Disable Hardcore Mode Mid-Game

```js
CONFIG.HARDCORE_MODE = false;
```

### Change Speed Beyond the Slider

```js
CONFIG.SPEED_MULTIPLIER = 32; // ludicrous speed
CONFIG.SPEED_MULTIPLIER = 0.05; // bullet-time
CONFIG.SPEED_MULTIPLIER = 0; // freeze frame
```

Or: `cheats.setSpeed(32)`.

### Change Resolution at Runtime

```js
CONFIG.GRID_WIDTH = 240;
CONFIG.GRID_HEIGHT = 160;
game.rebuildWorld(); // applies the new size cleanly
```

### Switch Rulesets at Runtime

```js
CONFIG.ACTIVE_RULESET = 'highlife'; // HighLife B36/S23
CONFIG.ACTIVE_RULESET = 'maze'; // Maze B3/S12345
CONFIG.ACTIVE_RULESET = 'tca_survivor'; // Teleological CA
CONFIG.ACTIVE_RULESET = 'hexlife'; // requires hex topology rebuild
game.rebuildWorld(); // if topology changed
```

Available rulesets:

```js
// Browse the registry
import('./src/rules/index.js').then((m) => console.table(m.listRulesets()));
```

### M:N Timestep Ratio

```js
CONFIG.DEFENDER_TICKS = 3; // defenders tick 3x per attacker tick
CONFIG.ATTACKER_TICKS = 1;
// Reverse: brutal mode
CONFIG.DEFENDER_TICKS = 1;
CONFIG.ATTACKER_TICKS = 3;
```

### VFX Toggles

```js
cheats.setVfx(false); // disable ALL visual effects
cheats.setVfx(true); // re-enable
// Or individually:
CONFIG.VFX_PARTICLES = false;
CONFIG.VFX_SHOCKWAVES = false;
CONFIG.VFX_FLOATERS = false;
CONFIG.VFX_SCREEN_SHAKE = false;
CONFIG.VFX_CELL_GLOW = false;
CONFIG.VFX_DRAW_ZONE_TINT = false;
```

---

## 3. Direct Grid Manipulation

You can edit the grid cell-by-cell. It's a flat `Uint8Array` indexed by
`y * width + x` (for square topology).

### Spawn a city anywhere

```js
const g = game.grid;

function setCity(x, y) {
  g.cells[y * g.width + x] = CELL_TYPE.CITY;
}

// Build a city wall along row 40
for (let x = 0; x < g.width; x++) setCity(x, 40);
```

### Vaporize all incoming missiles

```js
cheats.killAllMissiles();
```

### Carpet the entire battlefield with defenses

```js
const g = game.grid;
for (let y = 0; y < g.height; y++) {
  for (let x = 0; x < g.width; x++) {
    const i = y * g.width + x;
    if (g.cells[i] === CELL_TYPE.EMPTY) {
      g.cells[i] = CELL_TYPE.DEFENSE;
      g.cellAge[i] = 0;
      g.cellColor[i] = (Math.random() * 5) | 0;
    }
  }
}
```

### Resurrect dead cities

```js
cheats.reviveCities();
```

---

## 4. Stat Hacks

### Set Your Score

```js
game.hud.score = 999999;
game.hud.highScore = 999999;
```

### Skip to Wave N

```js
cheats.setWave(50);
```

### Top Up Ink Mid-Game

```js
cheats.refillInk();
```

### Reset High Score

```js
cheats.resetHighScore();
```

### Add Score

```js
cheats.addScore(1000);
```

---

## 5. Spawning Famous Game-of-Life Patterns

Defenses follow the active ruleset (Conway by default), so any classic pattern
works. Use `cheats.spawnPattern(x, y, pattern, type?)`:

### Blinker (oscillator)

```js
cheats.spawnPattern(10, 60, [
  [0, 0],
  [1, 0],
  [2, 0],
]); // horizontal blinker
```

### Upward-moving missile glider (triggers RETURN FIRE!)

```js
const NW_GLIDER = [
  [1, 2],
  [2, 1],
  [0, 0],
  [1, 0],
  [2, 0],
];
cheats.spawnPattern(30, 10, NW_GLIDER, CELL_TYPE.MISSILE);
```

### Gosper Glider Gun (defense factory)

```js
cheats.gosperGun(5, 45);
```

Watch your defenses replicate indefinitely.

### Spawn from the Pattern Library

```js
// Get any pattern from the library by id
import('./src/patterns/index.js').then(({ clonePatternCells }) => {
  const cells = clonePatternCells('pulsar');
  cheats.spawnPattern(50, 50, cells);
});
```

---

## 6. Disabling Game Over

Easiest:

```js
cheats.godMode(); // toggles; revives cities + refills ink every frame
```

Or patch directly:

```js
game.gameOver = () => {
  console.log('nope');
  cheats.reviveCities();
};
```

---

## 7. Sim Callback Hooks (Custom Effects)

The simulation exposes several callbacks you can override:

```js
// Bonus +1000 per missile destroyed
game.simulation.onMissileDestroyed = () => game.hud.addScore(1000);

// Confetti every time a city dies
game.simulation.onCityDestroyed = (x, y) => {
  console.log(`💀 City cell at (${x},${y})`);
  game.renderer.addFloater(x, y, 'OOF', '#ff00ff');
};

// Mega-bonus on return fire
game.simulation.onMissileReturn = (x, y, kind) => {
  game.hud.addScore(kind === 'return' ? 5000 : 500);
  game.renderer.addFloater(x, y, kind === 'return' ? 'JACKPOT!' : 'ping', '#ffff00');
};

// Custom annihilation effect
game.simulation.onAnnihilation = (x, y) => {
  console.log(`💥 collision at (${x},${y})`);
};

// City hit handler
game.simulation.onCityHit = (x, y, attacker) => {
  console.log(`${attacker} hit city cell at (${x},${y})`);
};

// Breach handler
game.simulation.onBreach = (x, y) => {
  console.log(`⚠ breach at (${x},${y})`);
};
```

Missile spawn / target / base callbacks:

```js
game.missiles.onMissileSpawn = (cx, cy, pw, ph) => {
  console.log(`missile spawned at (${cx},${cy})`);
};
game.missiles.onTargetSpawn = (cx, cy) => console.log('🎯 target deployed');
game.missiles.onTargetDestroyed = (cx, cy) => console.log('🎯 target down');
game.missiles.onBaseSpawn = (cx, cy, kind) => console.log(`⚔ ${kind} deployed`);
game.missiles.onBaseDestroyed = (cx, cy, kind) => console.log(`⚔ ${kind} destroyed`);
```

---

## 8. Floating Text Spam (for fun)

```js
// Print your name across the sky
setInterval(() => {
  game.renderer.addFloater(
    (Math.random() * game.grid.width) | 0,
    (Math.random() * game.grid.height) | 0,
    'PWNED',
    `hsl(${Math.random() * 360},100%,60%)`
  );
}, 100);
```

Add big floaters with scale:

```js
game.renderer.addBigFloater(40, 30, 'BOSS FIGHT!', '#ff0033', 2.5);
```

Add particles, shockwaves, screen shake:

```js
game.renderer.addParticleBurst(50, 50, {
  count: 50,
  colors: ['#ff0000', '#ffff00'],
  speed: 3,
  ttl: 60,
  glow: 12,
});
game.renderer.addShockwave(50, 50, {
  maxRadius: 60,
  color: '#00ffff',
  ttl: 30,
});
game.renderer.addShake(8, 30);
```

---

## 9. Pattern Capture & Management

List, delete, or capture patterns via cheats:

```js
cheats.listPatterns(); // print all saved custom patterns
cheats.deletePattern('mywall'); // remove one by name
cheats.clearPatterns(); // delete ALL saved patterns
cheats.captureMode(); // toggle drag-select capture mode
```

Access the full PatternCapture API:

```js
game.patternCapture.listSaved(); // detailed list
game.patternCapture.getSaved('mywall'); // get cells + meta
game.patternCapture.renamePattern('old', 'new');
game.patternCapture.savePatternExternal('autocannon', cells, {
  category: 'gun',
  period: 30,
  description: 'A custom gun I built',
  tags: ['custom', 'gun'],
});
```

---

## 10. Save Your Cheats Persistently

Settings persist via localStorage. You can preload cheats:

```js
const settings = {
  INITIAL_INK: 9999,
  MAX_INK: 9999,
  INK_REGEN_RATE: 50,
  CELL_MAX_AGE_TICKS: 999999,
  INK_DRY_TICKS: 0,
  CLEAR_REFUND_FRACTION: 1,
  MISSILES_PER_WAVE_BASE: 1,
  MISSILES_PER_WAVE_INC: 0,
  RESOLUTION_INDEX: 5, // XXL
  GLIDER_SE: true,
  GLIDER_SW: false,
  GLIDER_HEAVY: false,
  HARDCORE_MODE: false,
  ACTIVE_RULESET: 'conway',
};
localStorage.setItem('missileDefenseSettings', JSON.stringify(settings));
location.reload();
```

Or use the in-game Profiles tab (Settings → 💾 Profiles) to save named
configurations and import/export JSON.

---

## 11. The Nuclear Option

```js
cheats.godMode(true);
cheats.freezeMissiles(true);
cheats.infiniteInk();
cheats.setMode('chaos'); // maximum carnage settings
setInterval(() => game.hud.addScore(1), 16); // brrr
```

Sit back and watch the score number go brrr.

---

## 12. VFX Diagnostics

If the screen feels janky during chaotic scenes:

```js
cheats.vfxStats(); // show active counts + drop rates per second
cheats.resetVfxStats(); // reset counters
```

Drop rates indicate VFX throttling. You can adjust the per-frame budgets
by editing the `VFX_LIMITS` constants in `src/renderer.js`.

---

## 13. Notes & Gotchas

- **`CELL_TYPE.EMPTY = 0`, `DEFENSE = 1`, `MISSILE = 2`, `CITY = 3`, `EXPLOSION = 4`**
  — useful if you don't have the import.
- The grid wraps horizontally but not vertically (`grid.inBounds` only checks `y`).
- Direct cell writes don't go through `inBounds`, so off-grid `cells[i]` writes
  can corrupt adjacent cells — use `g.set()` or stay in bounds.
- High-score writes are throttled (1/sec) — if you slam `hud.score`, force a
  flush via `saveString('missileDefenseHighScore', game.hud.highScore)` (you'd
  need to import `./src/storage.js`).
- Mutating `CONFIG.GRID_WIDTH` / `GRID_HEIGHT` at runtime does **not** rebuild
  the grid automatically; call `game.rebuildWorld()` afterwards.
- Switching to a hex or triangular ruleset (e.g. `hexlife`, `trilife`) requires
  a topology rebuild — `game.rebuildWorld()` handles it, and the game does it
  automatically when you change rulesets in Settings.
- All cheats are also reachable via `MD.game.cheats` if `window.cheats` gets
  clobbered.
- The simulation supports **freeze flags** for Time Stop and M:N ticking:
  - `game.simulation.freezeEnemies = true` — freeze missile cells
  - `game.simulation.freezeDefenses = true` — freeze defense cells
  - `game.missiles.frozen = true` — also freeze missile spawning
- Free-play abilities install based on `CONFIG.ABILITY_*` toggles. The
  manager is on `game.freeplayAbilities`. You can call
  `game.freeplayAbilities.trigger(0)` to fire the first active ability.

---

## 14. Hidden Goodies

### Pattern Zoo from console

```js
game.patternZoo.show();
game.patternZoo.hide();
// Pick a pattern programmatically:
game.patternZoo.pickPattern({
  title: 'Choose your fighter',
  onPick: (pattern) => console.log('picked:', pattern),
});
```

### Level Designer from console

```js
game.levelDesigner.show();
game.startCustomLevel('myLevel'); // launch a saved level
```

### Story Mode (if available)

```js
game.story.startStory(); // begin the campaign
game.story.stopStory(); // bail out
```

### Inspect the active ruleset

```js
game.simulation._rule; // CompiledRuleset instance
game.simulation._rule.def; // raw definition
game.simulation._rule.neighborhood; // active neighborhood
```

### Apply a game mode preset

```js
game.settings.applyGameMode('blitz');
// Available preset ids:
cheats.listModes();
```

Happy hacking. May your gliders forever return fire.
