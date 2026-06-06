# [The Arcade of Life](https://aol.cognotik.com/)

A frantic, cerebral arcade game where Conway's **Game of Life** is the
physics engine, your **ink** is your brush, and every cell you draw is both a
weapon and a liability. Paint living structures across the lower half of the
screen, watch them evolve under Life's rules, and engineer collisions that
annihilate the gliders descending toward your cities.

> **Genre:** Action / Puzzle / Strategy
> **Engine:** Pure HTML5 Canvas + ES Modules — no frameworks, no dependencies.
> **Sim Backends:** CPU (bitpacked) or GPU (WebGL2) — auto-selected by grid size.
> **Rulesets:** 30+ cellular automaton rules including Conway, HighLife, exotic
> neighborhoods (hex, triangular, Euclidean radius), TCA (teleological CA),
> time-integrated rules, and fractional lightcones.

---

## Introduction

The grid is alive — and so is the threat. In **The Arcade of Life**,
enemy patterns aren't dumb projectiles; they're **gliders**, **spaceships**,
and **glider guns** straight out of Conway's cellular automaton, evolving and
descending inexorably toward the cities you've sworn to protect.

Your only tool is **ink**. Drag your cursor across the bottom half of the
grid to paint living cells. When you release the mouse, your ink _dries_
into active structures that obey the same Life rules as the incoming threats.
A lone cell dies of loneliness. A square of four cells will sit forever like
a stone wall. A glider you stamp upward will fly into the enemy's spawn line
and detonate their formations.

Every cell is both **creation and consequence**. Every stroke is a tradeoff
between coverage and chaos. Master the rules — or watch your cities burn.

---

## Core Concept

The grid is divided into **zones**:

- The **top dead zone** (rows 0–4) — Nothing spawns here. Used to detect
  "return fire" when your defenses send cells back upward.
- The **base zone** (amber tint) — Where static enemy bases and horizontal
  cruisers spawn. Bases must be destroyed to clear the wave.
- The **missile spawn line** — Where new gliders are launched downward.
- The **neutral combat zone** — Where enemy patterns descend and combat
  happens. You cannot draw here.
- The **draw zone** (green tint, bottom half by default) — Where you paint
  defenses. The dotted boundary line shows where you're allowed to draw.
- The **rear dead zone** (red tint, very bottom) — If a hostile cell slips
  into this strip, it counts as a **BREACH!** — score penalty + explosion.
- **Cities** (yellow blocks) — Your win condition. Lose them all and the
  game ends.

When a **hostile cell** (red/orange) and a **defense cell** (green/cyan)
end up adjacent in the same tick, they **annihilate** each other in a
small explosion. Your job is to engineer those collisions before missiles
reach your cities.

But the simulation doesn't care who you are. A poorly-placed defense will
die of loneliness on the next tick. A dense cluster will overpopulate and
collapse. A glider you accidentally created will sail into your own cities
in Hardcore Mode. You aren't just a defender — you're a **cellular
engineer**, and the puzzle is figuring out which shapes survive and which
ones kill.

---

## How to Play

1. **Click Start Game** from the main menu, or explore the side options:
   - **🦓 Pattern Zoo** — Browse the full pattern library with live previews
   - **🛠 Level Designer** — Craft custom scenarios with designer-placed bases
   - **How to Play** — This guide
   - **Console Hacking Guide** — DevTools cheats and API reference
2. **Click and drag** in the bottom half of the screen to paint defensive
   ink. The dotted boundary line shows where you're allowed to draw.
3. **Release the mouse** to commit your ink. It will briefly _dry_
   (deepening green) before becoming an active defense cell.
4. **Watch the simulation evolve.** Your defenses will reproduce, decay,
   or stabilize based on the active ruleset (Conway by default).
5. **Engineer collisions.** When red enemy cells touch your green cells,
   both die in an explosion.
6. **Protect your cities.** If even one missile cell touches a city, you
   lose part of that city. Lose all your cities and the game ends.
7. **Survive waves.** Each wave brings more hostile patterns, faster spawns,
   and (eventually) deadlier formations like glider guns.

---

## The User Interface

The screen is divided into four major regions:

### 1. HUD (Top Bar)

A single dark strip across the top displays your vital stats:

| Element       | Meaning                                              |
| ------------- | ---------------------------------------------------- |
| **SCORE**     | Total points earned this run.                        |
| **WAVE**      | Current wave number.                                 |
| **CITIES**    | How many of your cities are still alive.             |
| **INK** + bar | Cyan progress bar showing remaining ink (your ammo). |
| **SPD**       | Current speed multiplier (or "PAUSED").              |
| **HI**        | Persistent high score across runs.                   |

### 2. Play Field (Center)

The main grid where the game happens. Visual zones are clearly marked:

- **Top dead zone** (subtle gray tint) — Nothing spawns here. Return-fire
  detection zone.
- **Base zone** (amber tint) — Static enemy bases and horizontal cruisers
  spawn here.
- **Missile spawn line** — Where new gliders are launched downward.
- **Neutral combat zone** — Enemy patterns descend; defenses cannot
  be drawn here. Most explosions happen here.
- **Draw zone** (green tint, bottom) — Where you paint defenses. A
  pulsing dashed cyan line marks the top boundary.
- **Cities** (yellow blocks) — Your win condition.
- **Rear dead zone** (red tint, very bottom) — If a hostile cell slips
  into this strip, it counts as a **BREACH!**

Visual feedback is everywhere:

- **Wet ink** (translucent green) → freshly drawn, still drying.
- **Drying ink** (darkening green) → committing in real time.
- **Active defenses** (bright green/cyan) → alive and evolving.
- **Explosions** (orange flash) → annihilation events.
- **Enemy cells** (red/orange with glow) → hostile patterns, descending.
- **Particles, shockwaves, screen shake** → fire feedback for impacts,
  ricochets, and base destruction.
- **Floating text** ("RETURN FIRE!", "RICOCHET!", "CITY HIT!") →
  narrates significant events as they happen.

### 3. Speed Control Bar

Just below the canvas, a control strip with:

- **Speed slider** (0× paused → 256× ultra) with named presets.
- **Step button** (⏭) — Advance simulation by one tick when paused.
- **Settings (⚙)** — opens the in-play settings menu (pauses the game).
- **Help** — opens the How to Play guide.
- **🦓 Zoo** — opens the Pattern Zoo browser.
- **🛠 Designer** — opens the Level Designer.
- **Guide** — opens the Console Hacking Guide.
- **⛶** — Toggles fullscreen.
- **✕ Exit** — Returns to main menu.

### 4. Drawing Tools Bar

Below the speed bar, your painting toolkit:

- **Mode buttons** — Freehand, Line, Pattern, Fill.
- **Line tools** — Width slider (1–8 cells) and dash pattern selector
  (solid / dashed / dotted / sparse).
- **Pattern preset** — Dropdown to load classic patterns.
- **✏ Edit Pattern** — Opens the pattern editor overlay with a 16×16
  grid where you can hand-draw a custom pattern, save it with metadata,
  and import/export as JSON.
- **Fill tools** — Pattern selector for region fills (solid, checker,
  stripes, diagonal, dots, grid, cross, random).
- **Clear Defenses** button — wipes your defenses for a 50% ink refund.
- **◧ Capture Pattern** — Drag-select a region of the grid to save as
  a reusable custom pattern.
- **Ability buttons** — active abilities (EMP Burst, Ink Surge, Time
  Stop, etc.) appear here when enabled, with cooldown indicators.

---

## Game Mechanics

### The Grid & Zones

The grid is a 2D array of cells (default 120×80, resizable up to 800×600
or "Auto Fit Window"). Horizontally, the world **wraps around** like a
cylinder — cells at the right edge are neighbors of cells at the left
edge. Vertically, the top and bottom are hard boundaries.

Each row of the grid has a specific role:

| Zone                  | Default Rows     | Behavior                                           |
| --------------------- | ---------------- | -------------------------------------------------- |
| **Top Dead Zone**     | 0–4              | Nothing spawns here. Used to detect "return fire". |
| **Base Zone**         | 5–16             | Enemy bases & horizontal cruisers spawn here.      |
| **Missile Spawn Row** | 17               | Where new gliders are launched downward.           |
| **Neutral Combat**    | 18 to draw-zone  | Combat happens here. No one can place new cells.   |
| **Draw Zone**         | bottom half      | Where you paint defenses.                          |
| **Rear Dead Zone**    | bottom 2 rows    | No-man's land. Missiles here = BREACH.             |
| **Cities**            | within draw zone | Yellow blocks you must protect.                    |

All of these are tunable in **Settings** if you want a different feel.

### Ink: Your Lifeblood

- You start with **200 ink** (default), capped at **300**.
- Every cell you paint costs **1 ink**.
- Ink **regenerates** at 0.5 per simulation tick (~5 per second at
  default speed).
- You also get a **regen boost** at the start of each new wave.
- Clearing your defenses gives a partial **refund** (50% default), and
  undoing a stroke refunds the full ink cost.
- **Unlimited ink toggle** — In Settings, you can mark ink and regen as
  "∞" for unlimited supply.

Running out of ink mid-stroke isn't lethal — you just can't draw more
until it regenerates. But timing matters: a wave of hostile patterns can
overwhelm you while your reservoir refills.

### Drawing & Drying

When you click-drag in the draw zone:

1. Each cell you touch becomes **pending** (translucent green).
2. Pending cells **do not participate** in the Game of Life — they're
   inert ink waiting to set.
3. When you **release the mouse**, all pending cells start a **drying
   timer** (default 5 ticks, ~0.5 seconds).
4. Cells visibly darken as they dry. Once dry, they become live
   **defense cells** and immediately join the next simulation tick.

Drying matters strategically. You can plan a complex pattern at full
leisure (even while paused), then release and watch it commit _all at
once_ into a single coordinated structure. Pending cells take up no
Conway-neighbor space, so a half-drawn glider won't get killed by Life
rules before it's complete.

### Conway's Rules in Combat (Default)

The Game of Life has just three rules:

1. **Survival.** A living cell with **2 or 3** living neighbors survives
   to the next tick.
2. **Birth.** A dead cell with **exactly 3** living neighbors comes
   alive.
3. **Death.** Anything else dies — of loneliness (<2) or overcrowding
   (>3).

These rules apply to **both your defenses and the enemy patterns**.
Internalize them or perish:

- A single isolated cell dies on the next tick. **Always draw in clusters.**
- A 2×2 square (a "block") is a stable still-life. **Perfect tiny walls.**
- A 3-cell row (a "blinker") oscillates between horizontal and
  vertical. **Annoying but defensive.**
- A diagonal line of 3 cells becomes a "blinker" that immediately stops.
- A glider pattern travels across the grid. **You can shoot back!**

### Alternative Rulesets

The game supports **30+ cellular automaton rulesets** beyond Conway,
selectable in Settings → CA Ruleset:

**Standard square-grid rules:**

- **Conway** (B3/S23) — The classic
- **HighLife** (B36/S23) — Contains a replicator
- **Day & Night** (B3678/S34678) — Symmetric on/off behavior
- **Seeds** (B2/S) — No survival, explosive chaos
- **Life Without Death** (B3/S012345678) — Cells never die
- **Maze**, **Mazectric** — Forms maze-like corridors
- **Replicator** — Every pattern replicates itself
- **DryLife**, **Pedestrian Life**, **Move/Morley**, **Coral**,
  **Anneal**, **Diamoeba**, **Stains**, **Flock**, **Gnarl**, **Long Life**

**Hexagonal grid rules** (6 edge neighbors):

- **HexLife** (B2/S34), **Hex B24/S35**, **Hex Replicator**,
  **Hex Snowflakes**, **Hex Maze**

**Triangular grid rules** (12 vertex+edge neighbors):

- **TriLife** (B45/S456), **Tri B4/S345**, **Tri Maze**, **Tri Coral**,
  **Tri Edge**

**Exotic Euclidean-radius rules** (fractional neighborhood radii):

- **Conway (r=2.0, 12-cell)** — Smoother, more circular fronts
- **Isotropic Life (r=3)** — PDE-like wave propagation
- **Bugs (r=√5)** — Wandering bug-like creatures
- **Globe (r=2.6)** — Pulsing cellular blobs

**Anisotropic rules** (transformed neighborhoods):

- **Wind** (horizontal stretch), **Gravity** (vertical stretch),
  **Current** (sheared), **Diagonal Drift** (rotated)

**Teleological CA (TCA)** — Multi-proposal rules with lookahead scoring:

- **TCA: Survivor** — Picks variant that maximizes survival
- **TCA: Aesthetic** — Drifts toward symmetric configurations
- **TCA: Glider Seeker** — Rewards small moving clusters
- **TCA: Minimal Entropy** — Collapses toward ordered structures

**Time-Integrated rules** — Cells remember past states:

- **Momentum**, **Persistence**, **Drag**

**Fractional Lightcone rules** — Continuous spatial+temporal decay:

- **Relativistic**, **Diffusive**, **Compact**

**Custom neighborhoods** — Build your own with the in-Settings
neighborhood builder (Euclidean, ellipse, rotated, shear).

⚠ Non-Conway rulesets change how all cells evolve. Some patterns may
behave unexpectedly. Hex/Tri topologies use entirely different grid
geometries — the game rebuilds the world when you switch.

### Collisions & Annihilation

Whenever a **hostile cell** is adjacent (8-neighborhood) to a **defense
cell** at the start of a tick:

- **Both cells are destroyed** and become explosions (which last a few
  ticks before fading).
- A particle burst and small shockwave fire visually.
- The player **scores +10** for the kill.
- If the hostile cell was _also_ adjacent to a city, the **city cell** is
  destroyed too.

City cells follow special rules:

- They are **immune to Life rules** (no death by loneliness/overcrowding).
- They are destroyed _only_ by missile contact (or, in Hardcore mode, by
  defense contact).
- When a city loses all its cells, it's marked dead. Lose all cities →
  game over.

### Cell Aging & Cascades

To prevent permanent "fortress" walls and endless missile clouds, every
cell can age:

- **Defense cells** can die after a configurable number of ticks
  (default unlimited).
- **Enemy cells** can die after a configurable number of ticks
  (default unlimited).
- **Region-specific aging** — Set different max ages for friendly vs.
  enemy regions, separately for defense and missile cells. Configurable
  in Settings → Aging Matrix tab.
- **Cascade despawn**: when an enemy cell expires, any neighboring enemy
  cell within `MISSILE_CASCADE_TICKS` of its own expiry _also_ despawns.
  This creates dramatic chain reactions when you bait enemy formations
  into tangling with each other.

Cells visibly never change color due to age — the timer is silent — but
you can feel the rhythm: if aging is enabled, defenses you draw won't
last forever, so you must keep painting and reinforcing.

### Return Fire & Ricochets

If a **hostile cell** somehow ends up in the top dead zone (rows 0–4)
via Life evolution — for example, because your defenses bounced a
glider's trajectory upward — that's called **return fire** or a
**ricochet**:

- **Return Fire** (a single cell drifts up): **+20 score**, blue
  "RETURN FIRE!" floater.
- **Ricochet** (a dense cluster reflects): **+50 score**, orange
  "RICOCHET!" floater, screen shake, and the entire cluster detonates
  in a chain.
- **Defense cells** that reach the top dead zone are also counted as
  ricochets — **you successfully launched a counter-attack!**

This is the deepest layer of skill expression. By shaping your defenses
deliberately, you can **launch your own gliders upward** to plow
through enemy formations from below, score huge bonuses, and even
destroy stationary enemy bases.

### Enemy Threats

The enemy pattern roster, in roughly increasing difficulty:

| Pattern                           | Behavior                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| **R-Glider (SE)**                 | Classic Conway glider, descends southeast.                                                      |
| **L-Glider (SW)**                 | Mirrored, descends southwest.                                                                   |
| **Target Emplacement**            | Stationary 4×4 block that periodically _emits_ gliders. Must be destroyed by counter-attack!    |
| **Lightweight Spaceship (LWSS)**  | Fast, large, durable.                                                                           |
| **Middleweight Spaceship (MWSS)** | Bigger, more menacing.                                                                          |
| **Twin Glider**                   | Two gliders in formation — collide together for chaos.                                          |
| **Gosper Glider Gun**             | Plants itself near the top and produces a glider every 30 ticks. **Devastating** if left alive. |
| **Fortress** (base zone)          | Static, re-imprints itself, emits gliders.                                                      |
| **Bunker** (base zone)            | Smaller fortress variant.                                                                       |
| **Cruiser (E/W)**                 | Horizontal spaceships sweeping the base zone.                                                   |

Bases (fortresses, bunkers, cruisers) **must be destroyed** before a
wave is complete. They show as red/amber emplacements in the base zone,
and only counter-attacks (your gliders reaching them) can take them out.

### Hardcore Mode

Toggle in Settings. When enabled:

- **Your own defense cells damage cities** on contact.
- A poorly-placed wall, a glider that wandered into your own town, or
  an exploding ricochet can wreck your civilians.
- Friendly fire shows distinct green-yellow particle FX and the
  "FRIENDLY FIRE!" label.

Recommended for veterans only. Not the default.

### M:N Timestep Ratio

A configurable lever for advanced play: how often **defenders** tick
vs. **attackers**.

- Default is `1:1` — both tick together.
- `DEFENDER_TICKS = 2, ATTACKER_TICKS = 1` → your defenses evolve
  **twice as fast** as the enemy patterns. Easier game.
- `DEFENDER_TICKS = 1, ATTACKER_TICKS = 2` → enemy patterns evolve
  twice as fast. Brutal.

Settable in the Settings panel → Advanced tab.

---

## Game Mode Presets

The Settings panel includes 15+ preset game modes that patch multiple
config values at once:

| Mode               | Description                                                       |
| ------------------ | ----------------------------------------------------------------- |
| **Custom**         | Your current settings (no preset applied).                        |
| **🌱 Tutorial**    | Very slow, generous ink, few enemies. Conway rules.               |
| **🎮 Classic**     | Balanced default. Conway, SE + SW gliders, moderate pace.         |
| **⚡ Blitz**       | Fast spawns, short-lived cells, DryLife rules. Reflexes required. |
| **🛸 Armada**      | Spaceships and twin formations. HighLife rules, replicators.      |
| **🏰 Siege**       | Heavy bases dominate. Maze rules create defensive corridors.      |
| **💀 Hardcore**    | Friendly fire ON. Be precise.                                     |
| **🕊 Pacifist**    | Slow and contemplative. Long Life rules.                          |
| **🌀 Chaos**       | Everything enabled. Glider guns, spaceships, bases. Pure mayhem.  |
| **🧩 Maze Runner** | Mazectric rules. Strategic positioning.                           |
| **☄️ Apocalypse**  | Seeds rule. Every cell dies each tick. Very short lifespans.      |
| **🛡️ Fortress**    | Life Without Death. Your defenses are permanent.                  |
| **🔁 Replicators** | HighLife with glider guns. Asymmetric warfare.                    |
| **🐢 Turtle**      | Defender-favored timestep (3:1). Strategic mastermind mode.       |
| **⚡⚡ Lightning** | Attacker-favored timestep (1:3). Brutal speed test.               |

---

## Drawing Tools

Four drawing modes, switchable on the toolbar or via hotkeys:

### Freehand Mode (F)

Click and drag to paint a continuous line. Width and dash pattern apply.

- **Brush width** (1–8 cells): scales the brush as a square stamp.
- **Dash pattern** (solid / dashed / dotted / sparse): emits brushes
  at intervals along your stroke. Dash spacing scales with brush width
  so dotted lines stay visible even with thick brushes.

Great for organic walls, blanket coverage, and quick reactions.

### Line Mode (L)

Click to set a start point, drag to preview a straight line, release to
commit. Honors width and dash settings.

- **Preview** is rendered live as you drag (cyan if valid, red if
  out-of-zone, amber if blocked).
- Perfect for surgical horizontal walls, vertical pylons, and diagonal
  sweeps.

### Pattern Mode (P)

Click anywhere in the draw zone to **stamp** a pre-designed pattern.

- The **Pattern Editor** overlay (✏ Edit Pattern button) provides a
  16×16 mini-canvas where you can hand-draw a custom pattern, with full
  metadata support (name, category, period, direction, tags, description).
- Patterns can be saved as custom patterns or exported as JSON.
- **Preset dropdown** offers Game-of-Life classics:
  - **Still lifes**: Block, Beacon.
  - **Oscillators**: Blinker, Toad, Pulsar, Penta-Decathlon.
  - **Spaceships**: Glider, LWSS, MWSS, HWSS, Copperhead.
  - **Methuselahs**: R-Pentomino, Acorn, Diehard.
  - **Glider guns**: ★ Gosper Glider Gun (the legendary infinite weapon).

Press **R** to rotate the pattern 90°, **X** to mirror it horizontally,
**Y** to mirror vertically. Stamping aims pieces at the cursor (centered
on bounding box).

Pattern mode is the **highest-skill** option: a well-placed glider stamp
can be fired upward as a counter-attack, while a stamped pulsar acts
as a long-lived defensive wall.

### Fill Mode (B)

Click and drag to draw a rectangle that gets filled with a pattern:

- **Solid** — Every cell in the rectangle.
- **Checker** — Alternating cells.
- **Stripes (h/v)** — Horizontal or vertical stripes.
- **Diagonal** — Diagonal stripe pattern.
- **Dots (sparse/dense)** — Dotted patterns at varying density.
- **Grid** — Grid lines.
- **Cross** — Cross intersection pattern.
- **Random 50% / 25%** — Stochastic fills.

Useful for creating starting configurations for cellular automaton
experiments or quick-fill defenses.

---

## Pattern Zoo

Press **Z** or click **🦓 Pattern Zoo** from the main menu (or in-game)
to browse the entire pattern library:

- **Filter** by category, ruleset, tag, or source (built-in vs. custom).
- **Search** by name, id, or tag.
- **Live previews** — Each card runs a tiny toroidal simulation showing
  the pattern in action.
- **Per-card controls** — Speed, reset, pause individual previews.
- **Detail view** — Click any pattern for a larger preview with stats:
  generation count, population, max bounds, period, direction, etc.
- **Place in Game** — Load a pattern directly into the pattern editor
  for stamping.
- **Custom patterns** — Edit, rename, or delete your saved patterns.
- **New Pattern** — Open the editor to create one from scratch.

The zoo includes **1800+ patterns** when the LifeWiki dataset is
imported (see `npm run import:lifewiki`). Patterns are characterized
automatically — category, period, direction, stabilization point, etc.

---

## Level Designer

Press **D** or click **🛠 Level Designer** to craft custom scenarios:

**Modes:**

- **🏙 City** — Place city blocks
- **✏ Defense** — Paint pre-placed defense cells
- **📏 Line** — Straight line with width/dash options
- **🪣 Fill** — Region fill with pattern selector
- **🧬 Pattern** — Stamp any zoo pattern as defenses
- **⚔ Base** — Stamp zoo patterns as enemy bases
- **🚀 Spawner** — Place missile spawn points (limited to spaceships)
- **🧹 Erase** — Remove anything

**Settings tab** lets you override the full CONFIG for the level:
grid size, ruleset, wave config, glider types, abilities, aging,
base spawning, etc.

**Save/Load:**

- Save levels by name to local storage.
- Export/import as JSON for sharing.
- **Save & Play** — Launch the level immediately (paused for inspection).

Custom levels with designed bases and spawners completely override the
default per-wave base spawning and glider waves, giving you full
creative control.

---

## Pattern Capture

Press **Shift+C** or click **◧ Capture Pattern** to drag-select a
region of the live grid and save it as a reusable pattern:

1. Capture mode pauses the game and shows a dashed amber overlay.
2. Drag to draw a selection rectangle.
3. Release to capture all DEFENSE cells (and pending ink) in the region.
4. Enter a name and save — the pattern is added to the dropdown and the
   Pattern Zoo.
5. Captured patterns are automatically characterized (category, period,
   direction) and flagged as duplicates of built-in patterns if they match.

Captured patterns are saved to localStorage and persist across sessions.

---

## Abilities

Some abilities are **passive** (always-on once enabled in settings),
others are **active** (have a cooldown and a button + hotkey to trigger).

### Passive Abilities

| Icon | Name               | Effect                                 |
| ---- | ------------------ | -------------------------------------- |
| ⭐   | Combat Bonuses     | +50% score from all kills.             |
| ⚡   | Instant Set        | Ink commits instantly (no drying).     |
| 💰   | Veteran Pay        | +30 ink at start of each wave.         |
| 🛡   | Demilitarized Zone | Disables friendly fire (Hardcore off). |
| 🐢   | Atmospheric Drag   | Missiles spawn 20% slower.             |

### Active Abilities

Active abilities show as buttons in the speed control bar with cooldown
timers. Click or press the corresponding hotkey (**Q**, **W**, **E**) to
trigger.

| Icon | Name      | Cooldown | Effect                                                          |
| ---- | --------- | -------- | --------------------------------------------------------------- |
| 💥   | EMP Burst | 30s      | Vaporize all enemy missile cells + active targets.              |
| 🎁   | Ink Surge | 20s      | Instantly refill +200 ink.                                      |
| ⏱    | Time Stop | 45s      | Freeze enemy missiles for 5 seconds. Your defenses keep moving! |

Active abilities are the **panic buttons** of the game. Time Stop in
particular is a god-tier ability — freezing missile evolution while
your defenses continue lets you reshape the entire battlefield in
seconds.

All enabled abilities install simultaneously. Toggle individual
abilities on/off in Settings → Abilities tab.

---

## Keyboard Shortcuts

Press **?** in-game to bring up the full hotkey overlay.

### Simulation

| Key     | Action                         |
| ------- | ------------------------------ |
| `Space` | Pause / resume                 |
| `N`     | Step forward one tick (paused) |
| `[` `,` | Slower (previous speed preset) |
| `]` `.` | Faster (next speed preset)     |
| `0`–`9` | Jump to speed preset by index  |

### Drawing

| Key                 | Action                        |
| ------------------- | ----------------------------- |
| `F`                 | Freehand mode                 |
| `L`                 | Line mode                     |
| `P`                 | Pattern mode                  |
| `B`                 | Fill mode                     |
| `Tab` / `Shift+Tab` | Cycle modes                   |
| `R`                 | Rotate pattern (Pattern mode) |
| `X`                 | Mirror pattern horizontally   |
| `Y`                 | Mirror pattern vertically     |
| `+` / `=`           | Increase brush width          |
| `-` / `_`           | Decrease brush width          |
| `Shift+1`–`8`       | Load pattern preset by index  |

### Actions

| Key             | Action                           |
| --------------- | -------------------------------- |
| `Ctrl+Z`        | Undo last stroke (refunds ink)   |
| `C`             | Clear all defenses (50% refund)  |
| `Shift+C`       | Toggle pattern capture mode      |
| `Esc`           | Cancel current draw / close menu |
| `Q` / `W` / `E` | Trigger ability slot 1 / 2 / 3   |
| `A`             | Trigger ability slot 1 (alias)   |

### Menus & Tools

| Key        | Action                           |
| ---------- | -------------------------------- |
| `Enter`    | Start game from menu / game over |
| `S`        | Open settings (during play)      |
| `Z`        | Open Pattern Zoo                 |
| `D`        | Open Level Designer              |
| `M`        | Mute / unmute audio              |
| `H`        | Open How to Play guide           |
| `G` / `F1` | Open Console Hacking Guide       |
| `F11`      | Toggle fullscreen                |
| `?`        | Open hotkey help overlay         |

---

## Console Hacking

Open your browser's DevTools console (F12) and you'll find a full
**Console API** exposed:

```js
window.game; // live Game instance
window.CONFIG; // live config (mutate to tune)
window.CELL_TYPE; // {EMPTY, DEFENSE, MISSILE, CITY, EXPLOSION}
window.cheats; // cheat shortcuts (try cheats.help())
window.MD; // namespaced bundle
```

Quick cheats include:

```js
cheats.infiniteInk(); // max ink + max regen
cheats.killAllMissiles(); // clear all missile cells
cheats.skipWave(5); // jump forward 5 waves
cheats.godMode(true); // immortality + ink refill
cheats.gosperGun(20, 30); // stamp a Gosper gun on the field
cheats.spawnPattern(x, y, [
  [0, 0],
  [1, 0],
  [2, 0],
]);
cheats.dump(); // print live game stats
cheats.setMode('chaos'); // apply a game mode preset
cheats.vfxStats(); // VFX throttling diagnostics
```

See the in-game **Console Hacking Guide** (press G or F1) for the
complete reference, including how to write your own auto-pilot scripts,
swap simulation backends, hook the game's event callbacks, and more.

---

## Settings

Open Settings from the main menu, or with the **⚙ Settings** button /
**S** hotkey during play (auto-pauses).

Settings are organized into tabs:

### 🎮 Gameplay

- Game mode preset selector
- CA Ruleset (with custom neighborhood builder)
- Resolution preset (Auto-fit, presets, or custom)
- City count, starting ink, max ink, ink regen
- Clear refund fraction, hardcore mode

### 🚀 Enemies

- Enabled glider types (SE, SW, targets, LWSS, MWSS, twin, gun)
- Missiles per wave (base + increment)
- Spawn interval, decrement per wave, minimum interval
- Missile max age, cascade window
- Base spawning: enabled, zone height, count, max

### ✏️ Drawing

- Ink drying time
- Draw zone size, rear dead zone height
- Defense cell max age
- Draw zone display toggle

### ⏳ Aging Matrix

- Region-specific aging: friendly vs. enemy region × defense vs. missile
- Each cell has independent max age + ∞ unlimited toggle

### ⚡ Abilities

- Passive abilities (Combat Bonuses, Instant Set, Veteran Pay,
  Demilitarized Zone, Atmospheric Drag)
- Active abilities (EMP Burst, Ink Surge, Time Stop)

### 🖥️ Display

- Resolution preset (mirrored)
- Show draw zone indicator

### ⚙️ Advanced

- Tick rate (40–300 ms)
- Defender/Attacker ticks (M:N timestep ratio)
- Cell max age (mirrored)
- Hashlife cache toggle
- Base↔glider buffer
- Visual effects toggles (particles, shockwaves, floaters, screen
  shake, cell glow, draw zone tint)

### 💾 Profiles

- Save named configuration profiles
- Load/delete saved profiles
- Import/export full config as JSON

All settings persist in `localStorage` and apply immediately. The
"Reset to Defaults" button restores factory values.

---

## Tips & Strategy

### Beginner

- **Always draw in clusters.** Single cells die instantly.
- **A 2×3 horizontal block** is the cheapest stable wall — 6 ink for a
  permanent obstacle.
- **Watch where missiles spawn.** Walls placed _under_ spawn columns
  are vastly more effective than walls everywhere.
- **Use the speed slider.** Slow down (0.5×) to study enemy patterns,
  then speed up (2×, 4×) to grind ink and score. Press **N** to step
  one tick at a time when paused.

### Intermediate

- **Cell aging matters.** If enabled, don't paint a wall on wave 1 and
  expect it to last to wave 5. Reinforce constantly.
- **Bait cascades.** If you can get an enemy glider cluster to
  tangle, the cascade despawn rule clears huge swaths at once.
- **Use undo (Ctrl+Z) liberally.** Misplaced a stamp? Undo refunds the
  full pending ink — no waste.
- **Learn the Block stamp.** A pattern-mode Block stamp is a perfect
  4-cell still-life that never dies, for the same ink cost as 4
  freehand cells but with guaranteed stability.
- **Capture patterns** that work well in your gameplay so you can
  stamp them later.

### Advanced

- **Counter-attack with gliders.** Stamp a glider pointed _upward_
  (rotate with R until it heads north) and watch it sail into the
  enemy spawn line for a Ricochet bonus + base destruction.
- **Plant a Gosper Gun in your draw zone.** Once available, it's a
  permanent glider factory firing toward the enemy. Massive risk
  (eats huge ink, can be destroyed) but enormous reward.
- **Use Time Stop strategically.** Freeze the enemy, then _carefully_
  reshape your defenses to plug gaps. Your cells keep evolving — but
  no missiles will arrive while you work.
- **Tune the M:N ratio.** Set defenders to 2× attacker speed in
  Settings for a more puzzle-y, less reflexive experience.
- **Experiment with rulesets.** HighLife adds replicators. Maze
  builds corridors automatically. Each ruleset is a different game.
- **Design your own levels** with the Level Designer for custom
  challenges — share JSON exports with friends.
- **Hardcore + Glider Gun is the ultimate challenge.** Your own
  ammunition can kill your cities. May the rules be ever in your
  favor.

---

## Credits & Acknowledgments

Built with vanilla HTML5 Canvas and ES Modules. Conway's Game of Life
invented by John Horton Conway, 1970. Famous Life patterns (Gosper Gun,
Pulsar, LWSS, Diehard, Acorn, R-Pentomino, Copperhead) are part of the
public cellular automaton canon.

Pattern library can be augmented with the **LifeWiki** dataset
(1800+ patterns) via the importer script. See `docs/lifewiki-import.md`.

Exotic ruleset categories (TCA, time-integrated, fractional lightcones,
hex/triangular topologies, anisotropic neighborhoods) extend the
classical CA framework into new territory.

Synthesized SFX via Web Audio API — no external assets.

Source code: https://github.com/SimiaCryptus/Arcade_of_Life

---

**Now stop reading. The grid is alive. Go draw.**
