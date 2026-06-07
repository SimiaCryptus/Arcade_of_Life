# 🕹️ The Arcade of Life

A browser-based **missile defense game powered by Conway's Game of Life** — and 50+ other cellular automaton rulesets. Draw defensive patterns to evolve into intercepting structures, while waves of glider-based "missiles" descend on your cities.

---

## 🎯 How to Play

### The Goal

Defend your **cities** (yellow blocks at the bottom) from waves of **enemy gliders** (red/orange Conway patterns) descending from above. Use your **ink supply** to draw living patterns that evolve to intercept the threats.

### Core Mechanics

- **Draw defenses** in the bottom half of the grid (the cyan-tinted "draw zone")
- Cells **evolve via Conway's Game of Life** (or whatever ruleset you select)
- Defense cells (cyan/green) **annihilate** missile cells (red/orange) on contact — both explode
- Cities are **immune to Life rules** but die when hit by missiles
- Survive each wave to advance; lose all cities = game over

### Controls

#### Mouse / Touch

- **Left-click + drag**: Draw defensive cells in the bottom half
- **Click on existing cell**: Toggle it off (refunds ink)
- **Click outside draw zone**: No effect (red preview indicator)

#### Drawing Tools (toolbar buttons)

| Tool        | Hotkey | Description                             |
| ----------- | ------ | --------------------------------------- |
| ✏️ Freehand | `F`    | Free-form drawing                       |
| 📏 Line     | `L`    | Straight line with width & dash pattern |
| 🧬 Pattern  | `P`    | Stamp pre-built Life patterns           |
| 🪣 Fill     | `B`    | Region fill with pattern overlay        |

#### Pattern Mode

- **R** — Rotate pattern 90° CW (Shift+R for CCW)
- **X** — Flip horizontally
- **Y** — Flip vertically
- **Shift+1..8** — Quick-load pattern from dropdown
- **✏ Edit Pattern** button — Opens full pattern editor overlay

#### Simulation Speed

- **Space** — Pause / resume
- **N** — Step forward one tick (when paused)
- **[** / **,** — Slower
- **]** / **.** — Faster
- **0-9** — Jump to speed preset (0=paused, 7=hyper)

#### Drawing Controls

- **+** / **=** — Wider brush
- **-** — Narrower brush
- **C** — Clear all defenses (50% ink refund)
- **Ctrl+Z** — Undo last stroke
- **Tab** — Cycle through drawing modes
- **Esc** — Cancel current drawing
- **Shift+C** — Toggle pattern capture mode

#### Game Controls

- **Enter** — Start game (from menu/game-over screen)
- **F11** — Toggle fullscreen
- **M** — Toggle mute
- **R** — Restart current level (with confirmation)

#### Navigation

- **H** — Open How-to-Play guide
- **G** / **F1** — Open Console Hacking Guide
- **Z** — Open Pattern Zoo
- **D** — Open Level Designer
- **S** — In-game Settings (when enabled)
- **?** — Show hotkey help overlay

#### Abilities (when equipped)

- **Q** / **W** / **E** — Trigger ability slots 1-3
- **A** — Trigger first ability slot (alias)

#### Panning

- **Shift + ←** / **→** — Pan view horizontally
- **Alt + drag** — Pan with mouse

---

## 🎨 Drawing Tactics

### Effective Patterns

**Walls** create temporary barriers but die fast under Conway rules. Use them for emergency blocking.

**Gliders** can be aimed to intercept incoming threats. Stamp them with the Pattern tool.

**Oscillators** like blinkers and toads provide repeating defensive coverage in small areas.

**Spaceships** (LWSS, MWSS, HWSS) travel across the board and can reach distant threats.

**Guns** (Gosper glider gun!) are powerful but expensive — only stable in non-wrapping configurations.

### Strategic Tips

- **Watch the ink bar** — drawing costs ink, which regenerates slowly
- **Clean up dead structures** — leftover defense cells can become enemy fuel
- **Use pause + step** — analyze evolution patterns before committing
- **Layer patterns** — combine still lifes with moving spaceships
- **Mind the dry time** — cells need a few ticks to "set" before becoming active defenses

---

## 🦓 Pattern Zoo

Access via **Z** key or the 🦓 Zoo button in the main menu.

The Pattern Zoo is a searchable library of **600+ patterns** including:

- **Still lifes** — block, beehive, loaf, boat, eaters
- **Oscillators** — blinker, toad, beacon, pulsar, penta-decathlon
- **Spaceships** — glider, LWSS, MWSS, HWSS, copperhead, weekender
- **Guns** — Gosper glider gun, period-30 guns, p120 guns
- **Methuselahs** — R-pentomino, acorn, diehard
- **Puffers, breeders, replicators** — and much more

Each pattern includes:

- Live animated preview at multiple speeds
- Compatibility metadata (which rulesets it works in)
- Period, direction, and category info
- Characterization data (max bounds, extinction, unbounded growth)
- One-click "Use" button to load into the game

### Custom Patterns

Capture your own patterns from the game grid:

1. Press **Shift+C** or click ◧ Capture Pattern
2. Drag-select a region containing your design
3. Name it — saved patterns appear in the Zoo with a ★ badge
4. Edit, rename, or delete via the Zoo's detail view

Or use the **Pattern Editor** (✏ Edit Pattern button) to draw patterns cell-by-cell with metadata fields and JSON import/export.

---

## 🛠 Level Designer

Press **D** or click 🛠 Designer in the menu to craft custom scenarios.

### Designer Features

**Map tab** — Visual grid editor with multiple tools:

- **Draw** — Paint cells (defense, barrier, or fire)
- **Line** — Straight lines with dash patterns
- **Fill** — Region fill with selectable patterns
- **City** — Place city blocks (with optional zoo-pattern shapes)
- **Pattern** — Stamp patterns as defense cells
- **Base** — Place enemy bases (zoo patterns as MISSILE cells)
- **Spawner** — Place emission points for missile waves
- **Erase** — Remove anything

**Cell types**:

- 🟢 **Defense** — Living cells that follow CA rules
- 🧱 **Barrier** — Static walls that block missiles, never change
- 🔥 **Fire** — Static "live neighbor" tiles that destroy missiles on contact

**Tools & Patterns tab** — Restrict which tools/patterns the player can use.

**Color Theme tab** — Override background, grid, city, and effect colors.

**Settings tab** — Full CONFIG snapshot baked into the level. Adjust:

- Gameplay (game mode, ruleset, victory/defeat thresholds)
- Enemy pacing (cascade, age contagion)
- Region-specific aging matrix
- Abilities available
- VFX toggles

### Sharing Levels

- **Export JSON** — Copy level definition to clipboard
- **Import JSON** — Paste levels from others
- **Share URL** — Generate a `?level=<hosted-url>` link that auto-loads when opened (host the JSON yourself on GitHub Gist, Pastebin, etc.)

### Curated Levels

The `levels/` directory contains shipped scenarios accessible from the main menu:

- **Pillbox** — Defend within a diamond formation of barriers
- **SpaceInvaders** — Heavy spaceship invasion from above
- **Firewalls** — Use fire tiles to channel enemy gliders
- **Mothership** — Boss-style level with a massive enemy structure

---

## 📖 Story Mode

A chapter-based campaign mode (click 📖 Story Mode in the menu) featuring:

- **Narrative dialogue** between characters
- **Difficulty progression** across chapters
- **Perk selection** after each chapter — choose between stat boosts, new patterns, or active abilities
- **Tool unlocks** — start with freehand only, earn line/pattern/fill via story progress
- **Pattern unlocks** — gradually expand your pattern library
- **Mood-based gameplay** — each chapter modifies game parameters

---

## ⚙️ Settings & Customization

Access via the ⚙ Settings button in the menu or **S** in-game.

### Tabs

- **🎮 Gameplay** — Game mode presets, ruleset selection, resolution, victory thresholds
- **🚀 Enemies** — Glider types, wave pacing, base spawning
- **✏️ Drawing** — Ink economy, drying time, draw zone size
- **⏳ Aging Matrix** — Region-specific cell lifespans (friendly/enemy/neutral × defense/missile)
- **⚡ Abilities** — Toggle passive and active ability availability
- **🖥️ Display** — Resolution preset, visual effect toggles
- **⚙️ Advanced** — Tick rate, M:N timestep ratio, simulation backend, hashlife cache
- **💾 Profiles** — Save/load configuration profiles, import/export JSON

### Game Mode Presets

Pre-configured experiences:

- **🌱 Tutorial** — Slow, generous ink, classic Conway
- **🎮 Classic** — Balanced default experience
- **⚡ Blitz** — Fast spawns, short-lived cells, DryLife rules
- **🛸 Armada** — Spaceships and twin formations, HighLife
- **🏰 Siege** — Heavy bases, Maze rules
- **💀 Hardcore** — Friendly fire ON, fast attackers
- **🕊 Pacifist** — Slow and contemplative, Long Life rules
- **🌀 Chaos** — Everything enabled, pure mayhem
- **🧩 Maze Runner** — Mazectric corridors
- **☄️ Apocalypse** — Seeds rule, explosive
- **🛡️ Fortress** — Life Without Death, permanent defenses
- **🔁 Replicators** — HighLife with glider guns
- **🐢 Turtle** — 3:1 defender timestep advantage
- **⚡⚡ Lightning** — 1:3 attacker timestep advantage

### Rulesets

The game supports **50+ cellular automaton rulesets** organized by category:

**Standard (Square Grid)**:

- Conway's Game of Life (B3/S23)
- HighLife (B36/S23)
- Day & Night (B3678/S34678)
- Seeds (B2/S)
- Life Without Death (B3/S012345678)
- Maze, Mazectric, Replicator, 2x2
- DryLife, Pedestrian Life, Move/Morley
- Coral, Anneal, Diamoeba, Stains, Flock, Gnarl, Long Life

**Hexagonal Grid** (6 edge neighbors):

- HexLife (B2/S34), Hex B24/S35
- Hex Replicator, Hex Snowflakes, Hex Maze

**Triangular Grid** (12 vertex+edge neighbors):

- TriLife (B45/S456), Tri B4/S345
- Tri Maze, Tri Coral, Tri Edge

**Exotic Neighborhoods**:

- Euclidean radii (r=1.9, 2.0, 2.236, 2.6, 3.0)
- Anisotropic transforms (horizontal/vertical stretch, shear, rotated)
- Custom builder in Settings → Gameplay

**Exotic Engines** (paradigm-shifting):

- **🧠 Teleological CA (TCA)** — Multi-proposal lookahead with objective functions
- **⏳ Time-Integrated** — Weighted history window creates momentum/inertia
- **🌌 Fractional Lightcone** — Continuous spatial+temporal influence kernels

### Asymmetric Rulesets

Set a separate **Enemy Ruleset** so defenses and missiles evolve under different rules — creates fascinating asymmetric gameplay.

---

## 💻 Console API & Cheats

Open browser DevTools (F12) to access the full game state:

```javascript
// Live game instance
window.game;

// Mutate config at runtime
CONFIG.SPEED_MULTIPLIER = 4;
CONFIG.MAX_INK = 9999;

// Cheats
cheats.help(); // List all available cheats
cheats.infiniteInk(); // Max ink, max regen
cheats.killAllMissiles(); // Vaporize enemies
cheats.reviveCities(); // Resurrect destroyed cities
cheats.skipWave(3); // Jump 3 waves forward
cheats.godMode(); // Toggle immortality + ink refill
cheats.gosperGun(); // Drop a Gosper glider gun
cheats.dump(); // Print live stats table

// Inspect rulesets
listRulesets();
setActiveRuleset('highlife');

// Spawn custom patterns
cheats.spawnPattern(50, 60, [
  [0, 0],
  [1, 0],
  [0, 1],
]);
```

See `console_guide.md` (press **G** in-game) for the full hacking guide.

---

## 🙏 Acknowledgments

- **John Conway** for the Game of Life (1970)
- **Bill Gosper** for the glider gun (1970)
- **LifeWiki** community for documenting thousands of patterns
- **Mirek Wójtowicz** for cataloguing exotic rulesets
- Built with ❤️ as a love letter to cellular automata

---

**Have fun! And remember: every defense pattern you draw is alive. Treat it well.** 🌱
