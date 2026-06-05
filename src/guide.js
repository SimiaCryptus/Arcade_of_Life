import {Logger} from './logger.js';

// Inline copy of the console hacking guide. We bundle the markdown
// directly so the guide works under file:// without fetch.
const GUIDE_MARKDOWN = `# Console Hacking Guide: Missile Defense

A guide to bending Missile Defense to your will via the browser DevTools console. All of these work by poking at the game's live state — no save files, no patching required.

Open DevTools (F12 or Ctrl+Shift+I / Cmd+Opt+I), switch to the **Console** tab, and have fun.

---

## 1. Getting a Handle on the Game

The game exposes itself on \`window\` automatically. No setup required:

\`\`\`js
game        // the live Game instance
CONFIG      // live config object — mutate freely
CELL_TYPE   // {EMPTY:0, DEFENSE:1, MISSILE:2, CITY:3, EXPLOSION:4}
cheats      // cheat shortcuts (call cheats.help())
MD          // namespaced bundle: {game, CONFIG, CELL_TYPE, classes, ...}
\`\`\`

A startup banner in the console reminds you of these. The \`cheats\` object is the fast path:

\`\`\`js
cheats.help();             // list all shortcuts
cheats.infiniteInk();      // max ink + regen
cheats.godMode();          // toggle immortal cities + ink refill every frame
cheats.killAllMissiles();  // panic button
cheats.skipWave(5);        // jump ahead
cheats.gosperGun(10, 50);  // drop a glider gun
cheats.dump();             // print a snapshot of game state
\`\`\`

### The Logger (always available)

\`\`\`js
// Set log level — try 'debug' for verbose internal events
MissileDefenseLogger.setLevel('debug');
MissileDefenseLogger.setLevel('silent');  // shut it up
\`\`\`

---

## 2. Hacking CONFIG

\`CONFIG\` is already on \`window\`. It's read live every tick, so mutations take effect immediately.

### Infinite Ink

\`\`\`js
CONFIG.INITIAL_INK = 9999;
CONFIG.MAX_INK = 9999;
CONFIG.INK_REGEN_RATE = 100;  // refills instantly every tick
\`\`\`
Or just: \`cheats.infiniteInk()\`.

### Skip the Drying Wait

\`\`\`js
CONFIG.INK_DRY_TICKS = 0;  // defenses commit immediately on release
\`\`\`

### Free Defense Clears

\`\`\`js
CONFIG.CLEAR_REFUND_FRACTION = 1.0;  // 100% refund on Clear Defenses
\`\`\`

### Slow Missile Waves

\`\`\`js
CONFIG.MISSILES_PER_WAVE_BASE = 1;
CONFIG.MISSILES_PER_WAVE_INC = 0;
CONFIG.MISSILE_SPAWN_INTERVAL = 5000;
CONFIG.MISSILE_SPAWN_MIN = 5000;
CONFIG.MISSILE_SPAWN_DECREMENT = 0;
\`\`\`
Or freeze missile spawning entirely: \`cheats.freezeMissiles(true)\`.

### Make Defenses Immortal

\`\`\`js
CONFIG.CELL_MAX_AGE_TICKS = 100000;
\`\`\`

### Make Missiles Fragile

\`\`\`js
CONFIG.MISSILE_MAX_AGE_TICKS = 30;     // missiles die of old age fast
CONFIG.MISSILE_CASCADE_TICKS = 100;    // entire formations evaporate together
\`\`\`

### Disable Hardcore Mode Mid-Game

\`\`\`js
CONFIG.HARDCORE_MODE = false;
\`\`\`

### Change Speed Beyond the Slider

\`\`\`js
CONFIG.SPEED_MULTIPLIER = 32;   // ludicrous speed
CONFIG.SPEED_MULTIPLIER = 0.05; // bullet-time
CONFIG.SPEED_MULTIPLIER = 0;    // freeze frame
\`\`\`
Or: \`cheats.setSpeed(32)\`.
### Change Resolution at Runtime
\`\`\`js
CONFIG.GRID_WIDTH = 240;
CONFIG.GRID_HEIGHT = 160;
game.rebuildWorld();   // applies the new size cleanly
\`\`\`

---

## 3. Direct Grid Manipulation

You can edit the grid cell-by-cell. It's a flat \`Uint8Array\` indexed by \`y * width + x\`.

### Spawn a city anywhere

\`\`\`js
const g = game.grid;
function setCity(x, y) {
  g.cells[y * g.width + x] = CELL_TYPE.CITY;
}
// Build a city wall along row 40
for (let x = 0; x < g.width; x++) setCity(x, 40);
\`\`\`

### Vaporize all incoming missiles

\`\`\`js
cheats.killAllMissiles();
\`\`\`

### Carpet the entire battlefield with defenses

\`\`\`js
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
\`\`\`

### Resurrect dead cities

\`\`\`js
cheats.reviveCities();
\`\`\`

---

## 4. Stat Hacks

### Set Your Score

\`\`\`js
game.hud.score = 999999;
game.hud.highScore = 999999;
\`\`\`

### Skip to Wave N

\`\`\`js
cheats.setWave(50);
\`\`\`

### Top Up Ink Mid-Game

\`\`\`js
cheats.refillInk();
\`\`\`

### Reset High Score

\`\`\`js
cheats.resetHighScore();
\`\`\`

---

## 5. Spawning Famous Game-of-Life Patterns

Defenses follow Conway's rules, so any classic pattern works. Use \`cheats.spawnPattern(x, y, pattern, type?)\`:

### Blinker (oscillator)

\`\`\`js
cheats.spawnPattern(10, 60, [[0,0],[1,0],[2,0]]);  // horizontal blinker
\`\`\`

### Upward-moving missile glider (triggers RETURN FIRE!)

\`\`\`js
const NW_GLIDER = [[1,2],[2,1],[0,0],[1,0],[2,0]];
cheats.spawnPattern(30, 10, NW_GLIDER, CELL_TYPE.MISSILE);
\`\`\`

### Gosper Glider Gun (defense factory)

\`\`\`js
cheats.gosperGun(5, 45);
\`\`\`

Watch your defenses replicate indefinitely.

---

## 6. Disabling Game Over

Easiest:

\`\`\`js
cheats.godMode();   // toggles; revives cities + refills ink every frame
\`\`\`
Or patch directly:
\`\`\`js
game.gameOver = () => { console.log('nope'); cheats.reviveCities(); };
\`\`\`

---

## 7. Sim Callback Hooks (Custom Effects)

The simulation exposes three callbacks you can override:

\`\`\`js
// Bonus +1000 per missile destroyed
game.simulation.onMissileDestroyed = () => game.hud.addScore(1000);

// Confetti every time a city dies
game.simulation.onCityDestroyed = (x, y) => {
  console.log(\`💀 City cell at (\${x},\${y})\`);
  game.renderer.addFloater(x, y, 'OOF', '#ff00ff');
};

// Mega-bonus on return fire
game.simulation.onMissileReturn = (x, y, kind) => {
  game.hud.addScore(kind === 'return' ? 5000 : 500);
  game.renderer.addFloater(x, y, kind === 'return' ? 'JACKPOT!' : 'ping', '#ffff00');
};
\`\`\`

---

## 8. Floating Text Spam (for fun)

\`\`\`js
// Print your name across the sky
setInterval(() => {
  game.renderer.addFloater(
    Math.random() * game.grid.width | 0,
    Math.random() * game.grid.height | 0,
    'PWNED',
    \`hsl(\${Math.random()*360},100%,60%)\`
  );
}, 100);
\`\`\`

---

## 9. Save Your Cheats Persistently

Settings persist via localStorage. You can preload cheats:

\`\`\`js
const cheats = {
  INITIAL_INK: 9999,
  MAX_INK: 9999,
  INK_REGEN_RATE: 50,
  CELL_MAX_AGE_TICKS: 100000,
  INK_DRY_TICKS: 0,
  CLEAR_REFUND_FRACTION: 1,
  MISSILES_PER_WAVE_BASE: 1,
  MISSILES_PER_WAVE_INC: 0,
  RESOLUTION_INDEX: 4,  // XXL
  GLIDER_SE: true, GLIDER_SW: false, GLIDER_HEAVY: false,
  HARDCORE_MODE: false,
};
localStorage.setItem('missileDefenseSettings', JSON.stringify(cheats));
location.reload();
\`\`\`

The values are clamped at game-start to the slider's \`min\`/\`max\` *only when you open the settings panel*, but \`Settings.load()\` accepts them as-is, so out-of-range cheats survive until you visit the settings menu.

---

## 10. The Nuclear Option

\`\`\`js
cheats.godMode(true);
cheats.freezeMissiles(true);
cheats.infiniteInk();
setInterval(() => game.hud.addScore(1), 16);   // brrr
\`\`\`

Sit back and watch the score number go brrr.

---

## Notes & Gotchas

- **\`CELL_TYPE.EMPTY = 0\`, \`DEFENSE = 1\`, \`MISSILE = 2\`, \`CITY = 3\`, \`EXPLOSION = 4\`** — useful if you don't have the import.
- The grid wraps horizontally but not vertically (\`grid.inBounds\` only checks \`y\`).
- Direct cell writes don't go through \`inBounds\`, so off-grid \`cells[i]\` writes can corrupt adjacent cells — use \`g.set()\` or stay in bounds.
- High-score writes are throttled (1/sec) — if you slam \`hud.score\`, force a flush via \`saveString('missileDefenseHighScore', game.hud.highScore)\` (you'd need to import \`./src/storage.js\`).
- Mutating \`CONFIG.GRID_WIDTH\` / \`GRID_HEIGHT\` at runtime does **not** rebuild the grid automatically; call \`game.rebuildWorld()\` afterwards.
- All cheats are also reachable via \`MD.game.cheats\` if \`window.cheats\` gets clobbered.

Happy hacking. May your gliders forever return fire.
`;

/**
 * Renders the Console Hacking Guide as an in-game overlay.
 * While shown, the game is paused (speed forced to 0) and restored on close.
 */
export class GuidePanel {
  constructor({onOpen, onClose} = {}) {
    this.overlay = document.getElementById('guide-overlay');
    this.body = document.getElementById('guide-body');
    this.closeButton = document.getElementById('guide-close-button');
    this.onOpen = onOpen;
    this.onClose = onClose;
    this._rendered = false;
    this._visible = false;

    if (this.closeButton) {
      this.closeButton.addEventListener('click', () => this.hide());
    }
    // Click outside content closes it too.
    if (this.overlay) {
      this.overlay.addEventListener('click', (e) => {
        if (e.target === this.overlay) this.hide();
      });
    }
    // ESC closes.
    window.addEventListener('keydown', (e) => {
      if (!this._visible) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
    });
  }

  _render() {
    if (this._rendered) return;
    if (!this.body) return;
    try {
      // marked is loaded via index.html as UMD; it attaches to window.
      const marked = (typeof window !== 'undefined') ? window.marked : null;
      if (marked && typeof marked.parse === 'function') {
        this.body.innerHTML = marked.parse(GUIDE_MARKDOWN);
      } else if (marked && typeof marked === 'function') {
        this.body.innerHTML = marked(GUIDE_MARKDOWN);
      } else {
        // Fallback: render as preformatted text if marked isn't available.
        Logger.warn('GuidePanel: marked.js not found; rendering as plain text.');
        const pre = document.createElement('pre');
        pre.textContent = GUIDE_MARKDOWN;
        this.body.innerHTML = '';
        this.body.appendChild(pre);
      }
      this._rendered = true;
    } catch (e) {
      Logger.error('GuidePanel: failed to render markdown.', e);
      const pre = document.createElement('pre');
      pre.textContent = GUIDE_MARKDOWN;
      this.body.innerHTML = '';
      this.body.appendChild(pre);
      this._rendered = true;
    }
  }

  isVisible() {
    return this._visible;
  }

  show() {
    if (!this.overlay) return;
    this._render();
    this.overlay.classList.remove('hidden');
    this.overlay.removeAttribute('aria-hidden');
    this._visible = true;
    if (this.body) this.body.scrollTop = 0;
    if (this.onOpen) this.onOpen();
  }

  hide() {
    if (!this.overlay) return;
    this.overlay.classList.add('hidden');
    this.overlay.setAttribute('aria-hidden', 'true');
    this._visible = false;
    if (this.onClose) this.onClose();
  }

  toggle() {
    if (this._visible) this.hide();
    else this.show();
  }
}