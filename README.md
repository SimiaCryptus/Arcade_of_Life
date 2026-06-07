# 🕹️ The Arcade of Life

A browser-based **missile defense game powered by Conway's Game of Life** — and 50+ other cellular automaton rulesets. Draw defensive patterns to evolve into intercepting structures, while waves of glider-based "missiles" descend on your cities.

> **No build step. No dependencies. Just open `index.html` and play.**

![Arcade of Life Screenshot](screenshots/gameplay.png)

---

## 🎮 Quick Start

### Play in Browser

Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge). That's it.

A hosted version is available at [https://aol.cognotik.com](https://aol.cognotik.com)

### Install as PWA

The game works offline as a Progressive Web App:

1. Open in Chrome/Edge/Safari
2. Click the install icon in the address bar (or "Add to Home Screen" on mobile)
3. Launch from your desktop/home screen like any native app

### Local Development Server

For best results (service worker, fetch APIs):

```bash
npm run serve
# → http://localhost:8080
```

---

## 🏗 Architecture

```
src/
  main.js              Game orchestrator + console API
  config.js            All tunable constants + game mode presets
  grid.js              Cell storage + draw-zone helpers
  simulation.js        Conway logic + collision + age + return-fire
  renderer.js          Canvas rendering + VFX (particles, shockwaves, floaters)
  input.js             Mouse/touch with line width + dash + ink drying
  hud.js               Score, wave, ink, high score
  gameState.js         State machine
  settings.js          Settings panel + persistence + profiles
  audio.js             Procedural synth SFX (Web Audio API)
  drawTools.js         Tool switcher + pattern editor overlay
  pwa.js               Service worker + install prompt + offline support
  story.js             Story mode engine
  patternZoo.js        Pattern library browser
  patternCapture.js    Capture grid regions as patterns
  levelDesigner.js     Custom level editor
  levels.js            Level storage
  levelCatalog.js      Curated level loader
  topology.js          Square / hex / tri grid topologies
  abilities.js         Free-play ability manager
  logger.js            Centralized leveled logger
  storage.js           localStorage safety wrappers
  guide.js             Markdown guide overlay (renders this README!)

  rules/
    ruleset.js         CA rule registry, B/S parser, compiler
    neighborhoods.js   Custom neighborhood definitions
    extraRulesets.js   Built-in rule library (Conway, HighLife, etc.)
    exoticEngines.js   TCA, time-integrated, fractional lightcone
    exoticRulesets.js  Pre-built exotic rule definitions
    index.js           Aggregator + auto-registration

  patterns/
    library.js         Pattern registry with metadata
    index.js           Public API + legacy preset map
    categories.js      CATEGORY constants
    parsers.js         RLE / .cells file format parsers
    inferMetadata.js   Auto-classify patterns via simulation
    lifewikiImporter.js Bulk-import LifeWiki datasets

  sim/
    cpuBackend.js      Tight CPU neighbor-counting backend
    gpuBackend.js      WebGL2 backend for very large grids
    hashlife.js        Memoization for static defense regions
    cellCounts.js      Region-aware cell counting
    tickHelpers.js     Shared tick logic (age limits, anchors, swaps)
    lifeSim.js         Pure sparse-set Life simulator for patterns

  entities/
    cities.js          City placement and tracking
    missiles.js        Wave spawning + designed bases/spawners
    defenses.js        Ink management

test/                  Test suites (node-based, no framework needed)
  run-all.js           Runs all suites
  patterns/, rules/, sim/, *.test.js

sw.js                  Service worker (caching strategy)
manifest.json          PWA manifest
icons/                 PWA icons (auto-generated)
levels/                Shipped curated levels (JSON)
```

### Design Principles

- **Zero dependencies**: pure ES6 modules, no build step needed
- **Modular**: each subsystem owns its state and exposes a focused API
- **Hackable**: live config, console cheats, runtime ruleset switching
- **Topology-agnostic**: square, hex, and triangular grids supported
- **Backend-pluggable**: CPU (default) or WebGL2 simulation
- **Defensive**: errors in one subsystem don't crash the game
- **Offline-first**: full PWA with service worker caching

---

## 🧪 Testing

Run all test suites:

```bash
npm test
```

Individual suites:

```bash
npm run test:patterns       # Pattern library
npm run test:rules          # Ruleset parsing & compilation
npm run test:neighborhoods  # Custom neighborhoods
npm run test:exotic         # Exotic engines
npm run test:simulation     # Pattern evolution
npm run test:sim-engine     # CPU backend & hashlife
npm run test:wrap           # Toroidal wrap shift
npm run test:grid           # Grid utilities
npm run test:topology       # Hex/tri topologies
npm run test:parsers        # RLE/cells file parsers
npm run test:infer          # Metadata inference
```

Tests use plain Node.js `assert` — no framework required.

### Linting & Formatting

```bash
npm run lint          # ESLint
npm run lint:fix      # Auto-fix issues
npm run format        # Prettier
npm run format:check  # Check without writing
npm run validate      # lint + format:check + test
```

---

## 🎨 Visual Effects

The renderer includes a rich set of VFX (all toggleable in Settings → Advanced):

- **Particle bursts** — explosions, plumes, missile launches
- **Shockwave rings** — expanding circles on impacts
- **Floating text** — "RETURN FIRE!", "CITY HIT!", "RICOCHET!", combat banners
- **Screen shake** — intensity-based impact feedback
- **Cell glow** — neon-style missile cell rendering
- **Draw-zone tint** — subtle highlight of the playable region
- **Wave announcement banners** — dramatic chapter intros

All effects are **rate-limited** with adaptive throttling to keep frame rates smooth even during chaos. Hit limits visible via `cheats.vfxStats()`.

---

## 🌐 Browser Compatibility

Tested in:

- ✅ Chrome / Edge (recommended)
- ✅ Firefox
- ✅ Safari (desktop & iOS)
- ✅ Chrome Mobile (Android)

Requires:

- ES6 modules
- Canvas 2D API
- localStorage
- WebGL2 (optional, for GPU backend on large grids)
- Web Audio API (optional, for SFX)
- Service Worker (optional, for offline PWA)

---

## 🤝 Contributing

Contributions welcome! The codebase is intentionally hackable:

1. **Add a ruleset**: edit `src/rules/extraRulesets.js` and call `registerRuleset(...)`
2. **Add a pattern**: edit `src/patterns/library.js` and call `registerPattern(...)`
3. **Add a game mode**: extend `GAME_MODE_PRESETS` in `src/config.js`
4. **Add a cheat**: extend `_makeCheats()` in `src/main.js`
5. **Add a level**: design in-game and save the JSON to `levels/`

Open a PR with tests for new features.
