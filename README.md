# [The Arcade of Life](https://aol.cognotik.com/)

A frantic, cerebral arcade game where Conway's **Game of Life** is the
physics engine, your **ink** is your brush, and every cell you draw is both a
weapon and a liability. Paint living structures across the lower half of the
screen, watch them evolve under Life's rules, and engineer collisions that
annihilate the gliders descending toward your cities.

> **Genre:** Action / Puzzle / Strategy
> **Engine:** Pure HTML5 Canvas + ES Modules — no frameworks, no dependencies.
> **Sim Backends:** CPU (bitpacked) or GPU (WebGL2) — auto-selected by grid size.

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

The grid is divided into **two halves**:

- The **upper half** belongs to the enemy. Hostile patterns spawn here as
  gliders and descend toward your cities. You cannot draw here.
- The **lower half** is yours to paint. Anything you draw becomes part of
  the same Game of Life simulation — your cells evolve, reproduce, and die
  under Conway's rules just like the enemy patterns do.

When a **hostile cell** (red/orange) and a **defense cell** (green/cyan)
end up adjacent in the same tick, they **annihilate** each other in a
small explosion. Your job is to engineer those collisions before missiles
reach your **cities** (yellow blocks at the bottom).

But the simulation doesn't care who you are. A poorly-placed defense will
die of loneliness on the next tick. A dense cluster will overpopulate and
collapse. A glider you accidentally created will sail into your own cities
in Hardcore Mode. You aren't just a defender — you're a **cellular
engineer**, and the puzzle is figuring out which shapes survive and which
ones kill.

---

## How to Play

1. **Click Start Game** from the main menu (or **Story Mode** for the
   narrative campaign).
2. **Click and drag** in the bottom half of the screen to paint defensive
   ink. The dotted boundary line shows where you're allowed to draw.
3. **Release the mouse** to commit your ink. It will briefly _dry_
   (deepening green) before becoming an active defense cell.
4. **Watch the simulation evolve.** Your defenses will reproduce, decay,
   or stabilize based on Conway's rules.
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

- **Draw Zone** (subtle green tint, bottom) — Where you paint defenses.
- **Top sliver** — Enemy spawn line. Hostile patterns appear here.
- **Base Zone** (amber tint, top) — Static enemy bases and horizontal
  cruisers spawn here. Bases must be destroyed to clear the wave.
- **Middle** — Neutral combat zone. Enemy patterns descend; defenses cannot
  be drawn here. Most explosions happen here.
  A pulsing dashed cyan line marks the top boundary; a dashed red line
  marks the rear dead zone above the cities.
- **Cities** (yellow blocks) — Your win condition. Lose them all and the
  game ends.
- **Rear Dead Zone** (red tint, very bottom) — If a hostile cell slips into
  this strip, it counts as a **BREACH!** — you lose score and the
  cell explodes.

Visual feedback is everywhere:

- **Wet ink** (translucent green) → freshly drawn, still drying.
- **Drying ink** (darkening green) → committing in real time.
- **Active defenses** (bright green/cyan) → alive and evolving.
- **Explosions** (orange flash) → annihilation events.
- **Particles, shockwaves, screen shake** → fire feedback for impacts,
- **Enemy cells** (red/orange with glow) → hostile patterns, descending.
  ricochets, and base destruction.
- **Floating text** ("RETURN FIRE!", "RICOCHET!", "CITY HIT!") →
  narrates significant events as they happen.

### 3. Speed Control Bar

Just below the canvas, a control strip with:

- **Speed slider** (0× paused → 16× hyper) with named presets.
- **Clear Defenses** button — wipes your defenses for a 50% ink refund.
- **Settings (⚙)** — opens the in-play settings menu (pauses the game).
- **Guide** — opens the Console Hacking Guide.
- **Ability buttons** — active abilities (EMP Burst, Ink Surge, Time
  Stop, etc.) appear here when equipped, with cooldown indicators.

### 4. Drawing Tools Bar

Below the speed bar, your painting toolkit:

- **Mode buttons** — Freehand, Line, Pattern.
- **Line tools** — Width slider (1–8 cells) and dash pattern selector
  (solid / dashed / dotted / sparse).
- **Pattern editor** — A 12×12 mini-canvas where you can hand-draw a
  custom pattern, or load presets (Glider, Pulsar, Gosper Gun, etc.)
  from a dropdown.

---

## Game Mechanics

### The Grid & Zones

The grid is a 2D array of cells (default 120×80, resizable up to 400×250
or "Auto Fit Window"). Horizontally, the world **wraps around** like a
cylinder — cells at the right edge are neighbors of cells at the left
edge. Vertically, the top and bottom are hard boundaries.

Each row of the grid has a specific role:

| Zone                  | Default Rows     | Behavior                                           |
| --------------------- | ---------------- | -------------------------------------------------- |
| **Top Dead Zone**     | 0–4              | Nothing spawns here. Used to detect "return fire". |
| **Base Zone**         | 5–12             | Enemy bases & horizontal cruisers spawn here.      |
| **Missile Spawn Row** | 13               | Where new gliders are launched downward.           |
| **Neutral Combat**    | 14 to draw-zone  | Combat happens here. No one can place new cells.   |
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

### Conway's Rules in Combat

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
cell ages:

- **Defense cells** die after **200 ticks** (~20 seconds at default speed).
- **Enemy cells** die after **150 ticks** (~15 seconds).
- **Cascade despawn**: when an enemy cell expires, any neighboring enemy
  cell within **20 ticks** of its own expiry _also_ despawns. This
  creates dramatic chain reactions when you bait enemy formations into
  tangling with each other.

Cells visibly never change color due to age — the timer is silent — but
you can feel the rhythm: defenses you draw won't last forever, so you
must keep painting and reinforcing.

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

A hidden lever for advanced play: configure how often **defenders**
tick vs. **attackers**.

- Default is `1:1` — both tick together.
- `DEFENDER_TICKS = 2, ATTACKER_TICKS = 1` → your defenses evolve
  **twice as fast** as the enemy patterns. Easier game.
- `DEFENDER_TICKS = 1, ATTACKER_TICKS = 2` → enemy patterns evolve
  twice as fast. Brutal.

Settable in the Settings panel.

---

## Drawing Tools

Three drawing modes, switchable on the toolbar or via hotkeys:

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

- The 12×12 **pattern editor** lets you click cells to toggle and
  design your own custom pattern.
- **Preset dropdown** offers Game-of-Life classics:
  - **Still lifes**: Block, Beacon.
  - **Oscillators**: Blinker, Toad, Pulsar, Penta-Decathlon.
  - **Spaceships**: Glider (4 directions), LWSS, MWSS, HWSS, Copperhead.
  - **Methuselahs**: R-Pentomino, Acorn, Diehard.
  - **Glider guns**: ★ Gosper Glider Gun (the legendary infinite weapon).

Press **R** to rotate the pattern 90°, **X** to mirror it. Stamping
aims pieces at the cursor (centered on bounding box).

Pattern mode is the **highest-skill** option: a well-placed glider stamp
can be fired upward as a counter-attack, while a stamped pulsar acts
as a long-lived defensive wall.

---

## Game Modes

### Free-Play

The default mode. Press **Start Game** for endless waves.

- All glider types you've enabled in Settings appear.
- All drawing tools and patterns are unlocked from the start.
- All abilities enabled in Settings install automatically.
- Difficulty scales smoothly: more missiles per wave, faster spawns.
- High score persists across runs.

### Story Mode

Click **Story Mode** from the main menu for a 12-chapter narrative
campaign with:

- **Themed chapters** — each with a unique visual palette and mechanical
  twist (Frostbite slows everything down, Inferno speeds it up, Toxic
  Bloom cascades, Crimson is hardcore mode, etc.).
- **Dialogue** from Cmdr. Vance, Dr. Hale, and other characters between
  chapters, telling a story of escalating threat.
- **Perk selection** between chapters — choose 1 of 3 cards:
  - **STAT** perks (permanent buffs: +ink, +regen, +cell longevity).
  - **PATTERN** perks (unlock new stamps: Pulsar, Acorn, Gosper Gun…).
  - **ABILITY** perks (passive or active powers — see below).
- **Adaptive difficulty** — if you're struggling, the game eases the
  pressure; if you're dominating, it ramps up.
- **Tool unlocks** — Story Mode starts with only Freehand. Line mode
  unlocks in Chapter 2, Pattern mode in Chapter 3.
- **Pattern locks** — only patterns you've explicitly unlocked via
  perks appear in the dropdown during Story Mode.

Story Mode is the recommended first experience — it teaches the
mechanics gradually through tutorials and themed challenges.

---

## Abilities

Some abilities are **passive** (always-on once acquired), others are
**active** (have a cooldown and a button + hotkey to trigger).

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
timers. Click or press the corresponding hotkey (**Q**, **W**, **E** in
free-play; **A** in story mode) to trigger.

| Icon | Name      | Cooldown | Effect                                                          |
| ---- | --------- | -------- | --------------------------------------------------------------- |
| 💥   | EMP Burst | 30s      | Vaporize all enemy missile cells + active targets.              |
| 🎁   | Ink Surge | 20s      | Instantly refill +200 ink.                                      |
| ⏱    | Time Stop | 45s      | Freeze enemy missiles for 5 seconds. Your defenses keep moving! |

Active abilities are the **panic buttons** of the game. Time Stop in
particular is a god-tier ability — freezing missile evolution while
your defenses continue lets you reshape the entire battlefield in
seconds.

In Free-Play, **all enabled abilities** install simultaneously. In Story
Mode, you pick one per chapter via perks — making each run feel unique.

---

## Keyboard Shortcuts

Press **?** or **H** in-game to bring up the full hotkey overlay.

### Simulation

| Key     | Action                         |
| ------- | ------------------------------ |
| `Space` | Pause / resume                 |
| `[` `,` | Slower (previous speed preset) |
| `]` `.` | Faster (next speed preset)     |
| `0`–`7` | Jump to speed preset by index  |

### Drawing

| Key                 | Action                        |
| ------------------- | ----------------------------- |
| `F`                 | Freehand mode                 |
| `L`                 | Line mode                     |
| `P`                 | Pattern mode                  |
| `Tab` / `Shift+Tab` | Cycle modes                   |
| `R`                 | Rotate pattern (Pattern mode) |
| `X`                 | Mirror pattern horizontally   |
| `+` / `=`           | Increase brush width          |
| `-` / `_`           | Decrease brush width          |
| `Shift+1`–`8`       | Load pattern preset by index  |

### Actions

| Key             | Action                                        |
| --------------- | --------------------------------------------- |
| `Z`             | Undo last stroke (refunds ink)                |
| `C`             | Clear all defenses (50% refund)               |
| `Esc`           | Cancel current draw / close menu              |
| `Q` / `W` / `E` | Trigger ability slot 1 / 2 / 3 (free-play)    |
| `A`             | Trigger ability (story mode, or slot 1 alias) |

### Menus

| Key        | Action                           |
| ---------- | -------------------------------- |
| `Enter`    | Start game from menu / game over |
| `S`        | Open settings (during play)      |
| `M`        | Mute / unmute audio              |
| `G` / `F1` | Open Console Hacking Guide       |
| `?` / `H`  | Open hotkey help overlay         |

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
```

See the in-game **Console Hacking Guide** (press G or F1) for the
complete reference, including how to write your own auto-pilot scripts,
swap simulation backends, hook the game's event callbacks, and more.

---

## Settings

Open Settings from the main menu, or with the **⚙ Settings** button /
**S** hotkey during play (auto-pauses).

Tunable parameters include:

- **Resolution** — Auto-fit, fixed presets, or custom (60×40 to 800×600).
- **Starting Ink / Max Ink / Regen Rate** — your economy.
- **Tick Rate** — 40 to 300 ms per simulation step.
- **Defender/Attacker Ticks** — the M:N timestep ratio.
- **Missiles per Wave + scaling** — wave intensity.
- **Missile Spawn Interval + decrement** — how fast they come.
- **Cell & Missile Max Age** — longevity tuning.
- **City Count** — how many cities to defend.
- **Clear Refund Fraction** — penalty for hitting Clear.
- **Ink Drying Time** — how long pending cells take to set.
- **Draw Zone Size** — how much of the board you control.
- **Rear Dead Zone / Base Zone Height** — battlefield geometry.
- **Enabled Glider Types** — pick your enemy roster.
- **Hardcore Mode (Friendly Fire)**.
- **Enabled Abilities** — which abilities can appear / install.
- **Show Draw Zone Indicator** — visual aid toggle.

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
  then speed up (2×, 4×) to grind ink and score.

### Intermediate

- **Cell aging matters.** Don't paint a wall on wave 1 and expect it
  to last to wave 5. Reinforce constantly.
- **Bait cascades.** If you can get an enemy glider cluster to
  tangle, the cascade despawn rule clears huge swaths at once.
- **Use undo (Z) liberally.** Misplaced a stamp? Undo refunds the full
  pending ink — no waste.
- **Learn the Block stamp.** A pattern-mode Block stamp is a perfect
  4-cell still-life that never dies, for the same ink cost as 4
  freehand cells but with guaranteed stability.

### Advanced

- **Counter-attack with gliders.** Stamp a glider pointed _upward_
  (rotate with R until it heads north) and watch it sail into the
  enemy spawn line for a Ricochet bonus + base destruction.
- **Plant a Gosper Gun in your draw zone.** Once unlocked, it's a
  permanent glider factory firing toward the enemy. Massive risk
  (eats huge ink, can be destroyed) but enormous reward.
- **Use Time Stop strategically.** Freeze the enemy, then _carefully_
  reshape your defenses to plug gaps. Your cells keep evolving — but
  no missiles will arrive while you work.
- **Tune the M:N ratio.** Set defenders to 2× attacker speed in
  Settings for a more puzzle-y, less reflexive experience.
- **Hardcore + Glider Gun is the ultimate challenge.** Your own
  ammunition can kill your cities. May the rules be ever in your
  favor.

---

## Credits & Acknowledgments

Built with vanilla HTML5 Canvas and ES Modules. Conway's Game of Life
invented by John Horton Conway, 1970. Famous Life patterns (Gosper Gun,
Pulsar, LWSS, Diehard, Acorn, R-Pentomino) are part of the public
cellular automaton canon.

Synthesized SFX via Web Audio API — no external assets.

---

**Now stop reading. The grid is alive. Go draw.**
