import { CONFIG, SPEED_PRESETS, RESOLUTION_PRESETS, GAME_MODE_PRESETS } from './config.js';
import { Grid } from './grid.js';
import { Simulation } from './simulation.js';
import { Cities } from './entities/cities.js';
import { Missiles } from './entities/missiles.js';
import { Defenses } from './entities/defenses.js';
import { InputManager } from './input.js';
import { Renderer } from './renderer.js';
import { HUD } from './hud.js';
import { GameState, STATE } from './gameState.js';
import { Settings, SettingsPanel, computeAutoGrid } from './settings.js';
import { GuidePanel } from './guide.js';
import { DrawToolsPanel } from './drawTools.js';
import { StoryEngine } from './story.js';
import { Logger } from './logger.js';
import { CELL_TYPE } from './config.js';
import { Sfx } from './audio.js';
// Import rules index so all built-in + extra rulesets are registered.
import './rules/index.js';
import { FreeplayAbilityManager } from './abilities.js';
import { PatternCapture } from './patternCapture.js';
import { PatternZoo } from './patternZoo.js';
import {
  registerServiceWorker,
  initInstallPrompt,
  initNetworkIndicator,
  checkAutoStart,
  requestWakeLock,
  releaseWakeLock,
  toggleFullscreen,
} from './pwa.js';

class Game {
  constructor() {
    Logger.info('Game initializing...');
    // Load and apply settings BEFORE constructing grid/renderer,
    // since CONFIG values are read during their construction.
    this.settings = new Settings();
    // Compute initial CELL_SIZE that fits the window.
    this._fitCellSize();

    this.canvas = document.getElementById('game-canvas');
    this.overlay = document.getElementById('overlay');
    this.overlayTitle = document.getElementById('overlay-title');
    this.overlayMessage = document.getElementById('overlay-message');
    this.startButton = document.getElementById('start-button');
    this.settingsButton = document.getElementById('settings-button');
    this.speedSlider = document.getElementById('speed-slider');
    this.speedLabel = document.getElementById('speed-label');
    this.clearDefensesButton = document.getElementById('clear-defenses-button');
    this.helpButton = document.getElementById('help-button');
    this.guideButton = document.getElementById('guide-button');
    this.ingameSettingsButton = document.getElementById('ingame-settings-button');
    this.howToPlayButton = document.getElementById('howtoplay-button');
    this.howToPlayIngameButton = document.getElementById('howtoplay-ingame-button');
    this.fullscreenButton = document.getElementById('fullscreen-button');
    this.patternZooButton = document.getElementById('pattern-zoo-button');
    this.patternZooIngameButton = document.getElementById('pattern-zoo-ingame-button');

    this._buildWorld();

    this.renderer = new Renderer(this.canvas, this.grid);
    this.renderer.setInput(this.input);
    this.hud = new HUD();
    this.gameState = new GameState();
    this.settingsPanel = new SettingsPanel(this.settings, {
      onClose: () => {
        if (this.gameState.is(STATE.MENU) || this.gameState.is(STATE.GAME_OVER)) {
          this.overlay.classList.remove('hidden');
        }
      },
      onResolutionChange: () => {
        // Rebuild world & canvas immediately when resolution preset changes.
        this._fitCellSize();
        this._buildWorld();
        this.renderer.setGrid(this.grid);
        // If we were mid-game, also re-place cities and clear waves.
        if (this.gameState.is(STATE.PLAYING)) {
          this.cities.place();
          this.missiles.startWave(Math.max(0, this.hud.wave - 1));
        }
      },
    });
    // Console hacking guide overlay. Pauses the game while open.
    this._guidePauseSpeed = null;
    this.guidePanel = new GuidePanel({
      overlayId: 'guide-overlay',
      bodyId: 'guide-body',
      closeId: 'guide-close-button',
      markdownUrl: '/console_guide.md',
      onOpen: () => {
        // Hide other overlays so the guide is unambiguous.
        this._guidePrevOverlayHidden = this.overlay.classList.contains('hidden');
        this.overlay.classList.add('hidden');
        // Pause the simulation by stashing and zeroing the speed multiplier.
        this._guidePauseSpeed = CONFIG.SPEED_MULTIPLIER;
        CONFIG.SPEED_MULTIPLIER = 0;
        if (this.speedLabel) this.speedLabel.textContent = 'PAUSED (guide)';
      },
      onClose: () => {
        // Restore previous speed.
        if (this._guidePauseSpeed != null) {
          CONFIG.SPEED_MULTIPLIER = this._guidePauseSpeed;
          this._guidePauseSpeed = null;
        }
        // Re-sync the speed slider label.
        if (this.speedSlider) this._applySpeedFromSlider();
        // Re-show the main menu overlay if we were on the menu/game-over.
        if (
          !this._guidePrevOverlayHidden &&
          (this.gameState.is(STATE.MENU) || this.gameState.is(STATE.GAME_OVER))
        ) {
          this.overlay.classList.remove('hidden');
        }
      },
    });
    // How-to-play guide overlay (README.md). Same pause behaviour.
    this._helpPanelPauseSpeed = null;
    this.helpGuidePanel = new GuidePanel({
      overlayId: 'help-overlay',
      bodyId: 'help-body',
      closeId: 'help-close-button',
      markdownUrl: '/README.md',
      onOpen: () => {
        this._helpPrevOverlayHidden = this.overlay.classList.contains('hidden');
        this.overlay.classList.add('hidden');
        this._helpPanelPauseSpeed = CONFIG.SPEED_MULTIPLIER;
        CONFIG.SPEED_MULTIPLIER = 0;
        if (this.speedLabel) this.speedLabel.textContent = 'PAUSED (help)';
      },
      onClose: () => {
        if (this._helpPanelPauseSpeed != null) {
          CONFIG.SPEED_MULTIPLIER = this._helpPanelPauseSpeed;
          this._helpPanelPauseSpeed = null;
        }
        if (this.speedSlider) this._applySpeedFromSlider();
        if (
          !this._helpPrevOverlayHidden &&
          (this.gameState.is(STATE.MENU) || this.gameState.is(STATE.GAME_OVER))
        ) {
          this.overlay.classList.remove('hidden');
        }
      },
    });
    // Drawing tools panel (mode switcher, line width/dash, pattern editor).
    this.drawTools = new DrawToolsPanel(this.input);
    // Pattern capture tool — drag-select regions of the grid and save them.
    this.patternCapture = new PatternCapture({
      game: this,
      canvas: this.canvas,
      drawTools: this.drawTools,
    });
    // Pattern Zoo — browse the pattern library with live previews.
    this.patternZoo = new PatternZoo({ game: this });
    // Auto-pause when pattern editor overlay opens; restore on close.
    this._editorPauseSpeed = null;
    this.drawTools.onEditorOpen = () => {
      this._editorPauseSpeed = CONFIG.SPEED_MULTIPLIER;
      CONFIG.SPEED_MULTIPLIER = 0;
      if (this.speedLabel) this.speedLabel.textContent = 'PAUSED (editor)';
    };
    this.drawTools.onEditorClose = () => {
      if (this._editorPauseSpeed != null) {
        CONFIG.SPEED_MULTIPLIER = this._editorPauseSpeed;
        this._editorPauseSpeed = null;
      }
      if (this.speedSlider) this._applySpeedFromSlider();
    };
    // Story engine. Adds Story Mode button to menu, runs chapters,
    // changes moods, unlocks presets, adapts difficulty.
    this.story = new StoryEngine({
      game: this,
      settings: this.settings,
      drawTools: this.drawTools,
    });
    // Cross-reference so drawTools can check story unlock state.
    this.drawTools.storyEngine = this.story;
    // Free-play ability manager. Installed when starting a non-story game.
    this.freeplayAbilities = new FreeplayAbilityManager(this);

    this.lastTime = 0;
    // M:N timestep accumulators (defender / attacker).
    this._defAccum = 0;
    this._attAccum = 0;
    // Track consecutive frame errors so we can self-disable on a runaway loop.
    this._frameErrorCount = 0;
    this._MAX_FRAME_ERRORS = 10;
    // God mode flag, toggleable via cheats.godMode().
    this._godMode = false;

    this._wireSimCallbacks();
    this._wireInput();

    this.startButton.addEventListener('click', () => this.startGame());
    this.settingsButton.addEventListener('click', () => this.openSettings());
    if (this.clearDefensesButton) {
      this.clearDefensesButton.addEventListener('click', () => this._onClearDefenses());
    }
    if (this.helpButton) {
      this.helpButton.addEventListener('click', () => this.openGuide());
    }
    if (this.guideButton) {
      this.guideButton.addEventListener('click', () => this.openGuide());
    }
    if (this.howToPlayButton) {
      this.howToPlayButton.addEventListener('click', () => this.openHelpGuide());
    }
    if (this.howToPlayIngameButton) {
      this.howToPlayIngameButton.addEventListener('click', () => this.openHelpGuide());
    }
    if (this.patternZooButton) {
      this.patternZooButton.addEventListener('click', () => this.openPatternZoo());
    }
    if (this.patternZooIngameButton) {
      this.patternZooIngameButton.addEventListener('click', () => this.openPatternZoo());
    }
    if (this.ingameSettingsButton) {
      this.ingameSettingsButton.addEventListener('click', () => this.openIngameSettings());
      this._updateIngameSettingsButton();
    }
    // Wire the pattern-capture button.
    this._wirePatternCaptureButton();
    // Wire the exit-to-menu button here as the primary handler.
    // (DrawToolsPanel previously bound this; centralizing in main.js
    // ensures it works even if DrawToolsPanel construction fails.)
    const exitBtn = document.getElementById('exit-to-menu-button');
    if (exitBtn) {
      exitBtn.addEventListener('click', (e) => {
        Logger.info('[Game] Exit button clicked.');
        e.preventDefault();
        e.stopPropagation();
        this.exitToMenu();
      });
    } else {
      Logger.error('[Game] exit-to-menu-button not found in DOM!');
    }
    // Fullscreen toggle button.
    if (this.fullscreenButton) {
      this.fullscreenButton.addEventListener('click', () => toggleFullscreen());
      document.addEventListener('fullscreenchange', () => {
        this.fullscreenButton.textContent = document.fullscreenElement ? '⛶' : '⛶';
        this.fullscreenButton.title = document.fullscreenElement
          ? 'Exit fullscreen [F11]'
          : 'Enter fullscreen [F11]';
      });
    }

    this._initSpeedControls();
    this._initKeyboardShortcuts();
    this._initHotkeyHelp();
    window.addEventListener('resize', () => this._onWindowResize());
    // Diagnostic: log any click that hits the exit/edit buttons or their parents.
    document.addEventListener(
      'click',
      (e) => {
        const target = e.target;
        if (!target || !target.id) return;
        if (target.id === 'exit-to-menu-button' || target.id === 'pattern-editor-toggle') {
          Logger.info(`[Diag] Global click captured on #${target.id}`, {
            defaultPrevented: e.defaultPrevented,
            eventPhase: e.eventPhase,
            bubbles: e.bubbles,
            target: target.tagName,
            disabled: target.disabled,
            offsetParent: !!target.offsetParent,
            rect: target.getBoundingClientRect(),
          });
        }
      },
      true
    ); // capture phase

    this.showOverlay(
      'The Arcade of Life',
      `Defend your cities from incoming missiles!<br>
                 Draw defensive patterns on the bottom half of the screen.<br>
                 Released cells evolve via Conway's Game of Life.<br><br>
                 <strong>Click and drag</strong> to draw defenses.<br>
                 Release to commit them to the simulation.<br><br>
                 <strong>Hotkeys:</strong> Space = pause/resume, [ / ] = slower/faster, 0-8 = speed preset<br><br>
                 High Score: ${this.hud.highScore}`,
      'Start Game'
    );
    Logger.info(
      `Game initialized. Grid ${CONFIG.GRID_WIDTH}x${CONFIG.GRID_HEIGHT}, cell ${CONFIG.CELL_SIZE}px.`
    );
    // Expose hackable handles on window for DevTools console access.
    this._exposeGlobals();
    this._printHackBanner();

    requestAnimationFrame(this._loop.bind(this));
  }

  // ---- Hackability: console-friendly globals & cheats ----------------------
  _exposeGlobals() {
    // Primary game handle. Everything else can be reached from here, but
    // we expose a few convenience aliases too.
    window.game = this;
    // Namespaced bundle, in case `game` is shadowed by something else.
    window.MD = {
      game: this,
      CONFIG,
      CELL_TYPE,
      SPEED_PRESETS,
      RESOLUTION_PRESETS,
      GAME_MODE_PRESETS,
      Logger,
      // Class references for advanced poking / subclassing.
      classes: { Grid, Simulation, Cities, Missiles, Defenses, Renderer, HUD },
    };
    // Also drop the most common ones at top level for zero-friction hacking.
    window.CONFIG = CONFIG;
    window.CELL_TYPE = CELL_TYPE;
    window.SPEED_PRESETS = SPEED_PRESETS;
    // Public cheats API on the game itself.
    this.cheats = this._makeCheats();
    window.cheats = this.cheats;
  }

  _printHackBanner() {
    // Use plain console so the banner is always visible regardless of log level.
    const css = 'color:#00ffff;font-weight:bold;';
    console.log('%c[ArcadeOfLife] Console API ready.', css);
    console.log('  window.game        - live Game instance');
    console.log('  window.CONFIG      - live config (mutate to tune)');
    console.log('  window.CELL_TYPE   - {EMPTY, DEFENSE, MISSILE, CITY, EXPLOSION}');
    console.log('  window.cheats      - cheat shortcuts (try cheats.help())');
    console.log('  window.MD          - namespaced bundle');
    console.log('  ArcadeOfLifeLogger.setLevel("debug") for verbose logs');
    // Diagnostic dump of button state on startup.
    setTimeout(() => {
      const exitBtn = document.getElementById('exit-to-menu-button');
      const editBtn = document.getElementById('pattern-editor-toggle');
      console.log('%c[ArcadeOfLife] Button diagnostics:', css);
      console.log(
        '  exit-to-menu-button:',
        exitBtn
          ? {
              exists: true,
              visible: !!exitBtn.offsetParent,
              disabled: exitBtn.disabled,
              rect: exitBtn.getBoundingClientRect(),
              computed: exitBtn.offsetParent
                ? window.getComputedStyle(exitBtn).pointerEvents
                : 'N/A',
            }
          : 'MISSING'
      );
      console.log(
        '  pattern-editor-toggle:',
        editBtn
          ? {
              exists: true,
              visible: !!editBtn.offsetParent,
              disabled: editBtn.disabled,
              rect: editBtn.getBoundingClientRect(),
              computed: editBtn.offsetParent
                ? window.getComputedStyle(editBtn).pointerEvents
                : 'N/A',
            }
          : 'MISSING'
      );
      console.log(
        '  drawTools instance:',
        window.game && window.game.drawTools ? 'CONSTRUCTED' : 'MISSING'
      );
    }, 100);
  }

  _makeCheats() {
    const self = this;
    return {
      help() {
        console.log(
          [
            'cheats.infiniteInk()         - max ink, max regen',
            'cheats.refillInk()           - top up ink now',
            'cheats.killAllMissiles()     - clear missile cells',
            'cheats.clearDefenses()       - clear defense cells (full refund)',
            'cheats.reviveCities()        - resurrect all cities',
            'cheats.skipWave(n=1)         - jump forward n waves',
            'cheats.setWave(n)            - jump to wave n',
            'cheats.addScore(n)           - add n to score',
            'cheats.setSpeed(mult)        - set speed multiplier directly',
            'cheats.freezeMissiles(bool?) - toggle/set missile spawning off',
            'cheats.godMode(bool?)        - toggle/set immortality + ink refill',
            'cheats.spawnPattern(x,y,pat,type?) - place [[dx,dy],...] pattern',
            'cheats.gosperGun(x=5,y=45)   - drop a Gosper glider gun',
            'cheats.dump()                - print live game stats',
            'cheats.resetHighScore()      - clear saved high score',
            'cheats.setMode(id)           - apply a game mode preset by id',
            'cheats.listModes()           - list available game mode preset ids',
            'cheats.setVfx(bool)          - enable/disable all visual effects at once',
            'cheats.listPatterns()        - list saved custom patterns',
            'cheats.deletePattern(name)   - delete a saved custom pattern',
            'cheats.clearPatterns()       - delete ALL saved custom patterns',
            'cheats.captureMode()         - toggle pattern capture mode',
            'cheats.vfxStats()            - show VFX throttling stats (active + dropped)',
            'cheats.resetVfxStats()       - reset VFX drop counters',
          ].join('\n')
        );
      },
      infiniteInk() {
        CONFIG.INITIAL_INK = 9999;
        CONFIG.MAX_INK = 9999;
        CONFIG.INK_REGEN_RATE = 100;
        self.defenses.maxInk = 9999;
        self.defenses.ink = 9999;
        Logger.info('Cheat: infinite ink enabled.');
      },
      refillInk() {
        self.defenses.ink = self.defenses.maxInk;
      },
      killAllMissiles() {
        const g = self.grid;
        let n = 0;
        for (let i = 0; i < g.cells.length; i++) {
          if (g.cells[i] === CELL_TYPE.MISSILE) {
            g.cells[i] = CELL_TYPE.EMPTY;
            g.cellAge[i] = 0;
            n++;
          }
        }
        Logger.info(`Cheat: killed ${n} missile cells.`);
        return n;
      },
      clearDefenses() {
        self._onClearDefenses();
      },
      reviveCities() {
        const g = self.grid;
        self.cities.cities.forEach((c) => {
          c.alive = true;
          for (let dy = 0; dy < c.height; dy++) {
            for (let dx = 0; dx < c.width; dx++) {
              g.set(c.x + dx, c.y + dy, CELL_TYPE.CITY);
            }
          }
        });
        Logger.info('Cheat: cities revived.');
      },
      skipWave(n = 1) {
        self.hud.wave += n;
        self.missiles.startWave(Math.max(0, self.hud.wave - 1));
        Logger.info(`Cheat: jumped to wave ${self.hud.wave}.`);
      },
      setWave(n) {
        self.hud.wave = Math.max(1, n | 0);
        self.missiles.startWave(self.hud.wave - 1);
        Logger.info(`Cheat: set wave to ${self.hud.wave}.`);
      },
      addScore(n) {
        self.hud.addScore(n | 0);
      },
      setSpeed(mult) {
        CONFIG.SPEED_MULTIPLIER = +mult;
        if (self.speedLabel) self.speedLabel.textContent = `${mult}x`;
      },
      freezeMissiles(force) {
        const v = force === undefined ? !self._missilesFrozen : !!force;
        self._missilesFrozen = v;
        // Patch missiles.update to no-op while frozen.
        if (v && !self._origMissilesUpdate) {
          self._origMissilesUpdate = self.missiles.update.bind(self.missiles);
          self.missiles.update = () => {};
        } else if (!v && self._origMissilesUpdate) {
          self.missiles.update = self._origMissilesUpdate;
          self._origMissilesUpdate = null;
        }
        Logger.info(`Cheat: missiles frozen = ${v}.`);
      },
      godMode(force) {
        const v = force === undefined ? !self._godMode : !!force;
        self._godMode = v;
        Logger.info(`Cheat: god mode = ${v}.`);
      },
      spawnPattern(x, y, pattern, type = CELL_TYPE.DEFENSE) {
        const g = self.grid;
        let n = 0;
        for (const [dx, dy] of pattern) {
          const px = x + dx,
            py = y + dy;
          if (g.inBounds(px, py)) {
            g.set(px, py, type);
            const i = py * g.width + g.wrapX(px);
            g.cellAge[i] = 1;
            g.cellColor[i] = (Math.random() * 5) | 0;
            n++;
          }
        }
        return n;
      },
      gosperGun(x = 5, y = 45) {
        const GUN = [
          [24, 0],
          [22, 1],
          [24, 1],
          [12, 2],
          [13, 2],
          [20, 2],
          [21, 2],
          [34, 2],
          [35, 2],
          [11, 3],
          [15, 3],
          [20, 3],
          [21, 3],
          [34, 3],
          [35, 3],
          [0, 4],
          [1, 4],
          [10, 4],
          [16, 4],
          [20, 4],
          [21, 4],
          [0, 5],
          [1, 5],
          [10, 5],
          [14, 5],
          [16, 5],
          [17, 5],
          [22, 5],
          [24, 5],
          [10, 6],
          [16, 6],
          [24, 6],
          [11, 7],
          [15, 7],
          [12, 8],
          [13, 8],
        ];
        return this.spawnPattern(x, y, GUN, CELL_TYPE.DEFENSE);
      },
      dump() {
        const g = self.grid;
        let defs = 0,
          miss = 0,
          cities = 0;
        for (let i = 0; i < g.cells.length; i++) {
          if (g.cells[i] === CELL_TYPE.DEFENSE) defs++;
          else if (g.cells[i] === CELL_TYPE.MISSILE) miss++;
          else if (g.cells[i] === CELL_TYPE.CITY) cities++;
        }
        const info = {
          state: self.gameState.state,
          wave: self.hud.wave,
          score: self.hud.score,
          highScore: self.hud.highScore,
          ink: self.defenses.ink,
          maxInk: self.defenses.maxInk,
          speed: CONFIG.SPEED_MULTIPLIER,
          grid: `${g.width}x${g.height}`,
          cells: { defense: defs, missile: miss, city: cities },
          citiesAlive: self.cities.aliveCount(),
          tickCount: self.simulation.tickCount,
        };
        console.table(info);
        return info;
      },
      resetHighScore() {
        try {
          localStorage.removeItem('missileDefenseHighScore');
          self.hud.highScore = 0;
          Logger.info('Cheat: high score reset.');
        } catch (e) {
          Logger.warn('Cheat: could not reset high score.', e);
        }
      },
      setMode(id) {
        if (self.settings) {
          self.settings.applyGameMode(id);
          Logger.info(`Cheat: game mode set to "${id}".`);
        }
      },
      listModes() {
        console.table(GAME_MODE_PRESETS.map((m) => ({ id: m.id, name: m.name, desc: m.desc })));
      },
      setVfx(enabled) {
        const v = !!enabled;
        CONFIG.VFX_PARTICLES = v;
        CONFIG.VFX_SHOCKWAVES = v;
        CONFIG.VFX_FLOATERS = v;
        CONFIG.VFX_SCREEN_SHAKE = v;
        CONFIG.VFX_CELL_GLOW = v;
        CONFIG.VFX_DRAW_ZONE_TINT = v;
        Logger.info(`Cheat: all VFX ${v ? 'enabled' : 'disabled'}.`);
      },
      listPatterns() {
        if (!self.patternCapture) return [];
        const list = self.patternCapture.listSaved();
        console.table(list);
        return list;
      },
      deletePattern(name) {
        if (!self.patternCapture) return false;
        const ok = self.patternCapture.deleteSaved(name);
        Logger.info(`Cheat: deletePattern("${name}") -> ${ok}`);
        return ok;
      },
      clearPatterns() {
        if (!self.patternCapture) return 0;
        const n = self.patternCapture.clearAllSaved();
        Logger.info(`Cheat: cleared ${n} saved pattern(s).`);
        return n;
      },
      captureMode() {
        if (!self.patternCapture) return;
        self.patternCapture.toggle();
      },
      vfxStats() {
        if (!self.renderer) return null;
        const s = self.renderer._vfxStats;
        const elapsedSec = (Date.now() - s.sinceMs) / 1000;
        const info = {
          active: {
            particles: self.renderer.particles.length,
            shockwaves: self.renderer.shockwaves.length,
            floaters: self.renderer.floaters.length,
          },
          droppedSinceReset: {
            particles: s.particlesDropped,
            shockwaves: s.shockwavesDropped,
            floaters: s.floatersDropped,
            floatersDeduped: s.floatersDeduped,
          },
          elapsedSec: elapsedSec.toFixed(1),
          dropRatePerSec: {
            particles: (s.particlesDropped / Math.max(0.1, elapsedSec)).toFixed(1),
            shockwaves: (s.shockwavesDropped / Math.max(0.1, elapsedSec)).toFixed(1),
            floaters: (s.floatersDropped / Math.max(0.1, elapsedSec)).toFixed(1),
          },
        };
        console.table(info.active);
        console.table(info.droppedSinceReset);
        console.log(`Elapsed: ${info.elapsedSec}s — drop rates per second:`);
        console.table(info.dropRatePerSec);
        return info;
      },
      resetVfxStats() {
        if (!self.renderer) return;
        self.renderer._vfxStats = {
          particlesDropped: 0,
          shockwavesDropped: 0,
          floatersDropped: 0,
          floatersDeduped: 0,
          sinceMs: Date.now(),
        };
        Logger.info('Cheat: VFX stats reset.');
      },
    };
  }

  // Public API for console: rebuild world after CONFIG.GRID_WIDTH/HEIGHT change.
  rebuildWorld() {
    this._fitCellSize();
    this._buildWorld();
    this.renderer.setGrid(this.grid);
    if (this.gameState.is(STATE.PLAYING)) {
      this.cities.place();
      this.missiles.startWave(Math.max(0, this.hud.wave - 1));
    }
    // Re-initialize speed controls so max scales with new board size.
    this._initSpeedControls();
    Logger.info(`World rebuilt: ${CONFIG.GRID_WIDTH}x${CONFIG.GRID_HEIGHT}.`);
  }

  _onClearDefenses() {
    // Cancel any in-progress drawing to avoid stale state.
    if (this.input) this.input.cancelDrawing();
    this.defenses.clearAll(this.grid);
  }
  _wirePatternCaptureButton() {
    const btn = document.getElementById('pattern-capture-button');
    if (!btn) {
      Logger.warn('[Game] pattern-capture-button not found in DOM.');
      return;
    }
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.patternCapture) return;
      this.patternCapture.toggle();
    });
    // Also bind a hotkey: Shift+C toggles capture mode.
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      // If a pattern-capture name dialog is open, let it handle keys.
      if (this.patternCapture && this.patternCapture._nameDialog) return;
      if (e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        this.patternCapture.toggle();
      }
    });
  }

  // (Re)construct grid + entities for current CONFIG resolution.
  _buildWorld() {
    this.grid = new Grid(CONFIG.GRID_WIDTH, CONFIG.GRID_HEIGHT);
    this.simulation = new Simulation(this.grid);
    this.cities = new Cities(this.grid);
    this.missiles = new Missiles(this.grid);
    // Preserve ink across rebuilds if defenses already exists; else create fresh.
    if (!this.defenses) this.defenses = new Defenses();
    else this.defenses.maxInk = CONFIG.MAX_INK;
    // Rebuild input manager to bind to new grid (canvas same).
    const prevInput = this.input;
    if (this.input) this.input.cancelDrawing();
    this.input = new InputManager(this.canvas, this.grid, this.defenses);
    // Carry over drawing mode/settings from previous input manager.
    if (prevInput) {
      this.input.setMode(prevInput.mode);
      this.input.setLineWidth(prevInput.lineWidth);
      this.input.setDashPattern(prevInput.dashPattern);
      this.input.pattern = new Set(prevInput.pattern);
      this.input.patternRotation = prevInput.patternRotation;
    }
    // Re-point renderer + drawTools at the new input.
    if (this.renderer) this.renderer.setInput(this.input);
    if (this.drawTools) this.drawTools.input = this.input;
    this._wireSimCallbacks();
    this._wireInput();
  }

  _wireSimCallbacks() {
    // Wrap callbacks defensively: an error inside a sim hook must not
    // abort the simulation tick.
    this.simulation.onMissileDestroyed = () => {
      try {
        this.hud.addScore(10);
      } catch (e) {
        Logger.error('onMissileDestroyed handler failed.', e);
      }
    };
    // Target FX hooks: dramatic spawn + destruction effects.
    this.missiles.onTargetSpawn = (cx, cy) => {
      try {
        if (!this.renderer) return;
        this.renderer.addShockwave(cx, cy, {
          maxRadius: 40,
          color: '#ff3333',
          ttl: 30,
          width: 3,
        });
        this.renderer.addBigFloater(cx, cy - 2, '⚠ TARGET DEPLOYED', '#ff3333', 1.4);
        this.renderer.addParticleBurst(cx, cy, {
          count: 20,
          colors: ['#ff0033', '#ff3300', '#ffaa00'],
          speed: 2.0,
          ttl: 35,
          size: 2.8,
          glow: 10,
        });
      } catch (e) {
        Logger.error('onTargetSpawn handler failed.', e);
      }
    };
    this.missiles.onTargetDestroyed = (cx, cy) => {
      try {
        this.hud.addScore(500);
        if (!this.renderer) return;
        this.renderer.addBigFloater(cx, cy, 'TARGET DOWN! +500', '#ffff44', 1.8);
        this.renderer.addShockwave(cx, cy, {
          maxRadius: 60,
          color: '#ffff44',
          ttl: 35,
          width: 3,
        });
        this.renderer.addParticleBurst(cx, cy, {
          count: 50,
          colors: ['#ffff66', '#ff8800', '#ffffff', '#ff0033'],
          speed: 3.5,
          ttl: 60,
          size: 3.2,
          glow: 12,
          gravity: 0.05,
        });
        this.renderer.addShake(6, 24);
      } catch (e) {
        Logger.error('onTargetDestroyed handler failed.', e);
      }
    };
    this.simulation.onCityDestroyed = (x, y) => {
      try {
        Logger.debug(`City cell destroyed at (${x},${y}).`);
      } catch (_e) {
        /* swallow */
      }
    };
    this.simulation.onAnnihilation = (x, y) => {
      try {
        Sfx.annihilation();
        if (!this.renderer) return;
        // Bright orange/yellow spark burst + a small shockwave.
        this.renderer.addParticleBurst(x, y, {
          count: 14,
          colors: ['#ffdd44', '#ff8800', '#ffffff', '#ff4400'],
          speed: 1.8,
          ttl: 22,
          size: 2.2,
          glow: 8,
          gravity: 0.04,
        });
        this.renderer.addShockwave(x, y, {
          maxRadius: 18,
          color: '#ffaa33',
          ttl: 14,
          width: 1.5,
        });
      } catch (e) {
        Logger.error('onAnnihilation handler failed.', e);
      }
    };
    this.simulation.onCityHit = (x, y, attacker) => {
      try {
        if (attacker === 'defense') Sfx.friendlyFire();
        else Sfx.cityHit();
        if (!this.renderer) return;
        const isFriendly = attacker === 'defense';
        // Color-code: red/orange for enemy missile fire, sickly green/yellow
        // for friendly fire (hardcore). Floater text reflects the source.
        const palette = isFriendly
          ? ['#88ff44', '#aaff66', '#ffff66', '#ffffff']
          : ['#ff3030', '#ff8800', '#ffff66', '#ffffff'];
        const ringColor = isFriendly ? '#aaff44' : '#ff4040';
        // Dense, slow-falling debris with gravity.
        this.renderer.addParticleBurst(x, y, {
          count: 28,
          colors: palette,
          speed: 2.6,
          spread: Math.PI * 2,
          ttl: 50,
          size: 2.8,
          glow: 10,
          gravity: 0.08,
        });
        // Upward smoke plume — somber, lingers.
        this.renderer.addParticleBurst(x, y, {
          count: 14,
          colors: isFriendly
            ? ['#446644', '#88aa88', '#225522']
            : ['#444444', '#886655', '#552222'],
          speed: 0.6,
          spread: Math.PI / 2,
          dir: -Math.PI / 2, // upward
          ttl: 80,
          size: 3.0,
          glow: 4,
          gravity: -0.02,
        });
        // Two concentric shockwaves for emphasis.
        this.renderer.addShockwave(x, y, {
          maxRadius: 36,
          color: ringColor,
          ttl: 28,
          width: 2.5,
        });
        this.renderer.addShockwave(x, y, {
          maxRadius: 60,
          color: isFriendly ? '#ffff80' : '#ffaa33',
          ttl: 40,
          width: 1.2,
        });
        // Big floater label.
        const label = isFriendly ? 'FRIENDLY FIRE!' : 'CITY HIT!';
        const labelColor = isFriendly ? '#aaff66' : '#ff5050';
        this.renderer.addBigFloater(x, y - 1, label, labelColor, 1.4);
        // Screen shake — bigger for enemy fire, milder for friendly.
        this.renderer.addShake(isFriendly ? 2 : 4, isFriendly ? 12 : 20);
      } catch (e) {
        Logger.error('onCityHit handler failed.', e);
      }
    };
    this.simulation.onMissileReturn = (x, y, kind) => {
      try {
        if (kind === 'ricochet') {
          Sfx.ricochet();
          this.hud.addScore(50);
          if (this.renderer) {
            this.renderer.addFloater(x, y, 'RICOCHET!', CONFIG.COLORS.RICOCHET_TEXT);
            this.renderer.addParticleBurst(x, y, {
              count: 16,
              colors: ['#ffaa00', '#ffff66', '#ffffff'],
              speed: 2.2,
              ttl: 30,
              size: 2.4,
              glow: 10,
              gravity: 0.02,
            });
            this.renderer.addShockwave(x, y, {
              maxRadius: 24,
              color: CONFIG.COLORS.RICOCHET_TEXT,
              ttl: 20,
            });
          }
        } else {
          Sfx.returnFire();
          this.hud.addScore(20);
          if (this.renderer) {
            this.renderer.addFloater(x, y, 'RETURN FIRE!', CONFIG.COLORS.RETURN_FIRE_TEXT);
            this.renderer.addParticleBurst(x, y, {
              count: 10,
              colors: ['#00ffff', '#80ffff', '#ffffff'],
              speed: 1.6,
              ttl: 24,
              size: 2.0,
              glow: 8,
            });
          }
        }
      } catch (e) {
        Logger.error('onMissileReturn handler failed.', e);
      }
    };
    // Missile spawn plumes: bright downward streak when a glider appears
    // at the top of the screen. Coords are grid-space center of the spawn.
    this.missiles.onMissileSpawn = (cx, cy, _pw, _ph) => {
      try {
        Sfx.missileSpawn();
        if (!this.renderer) return;
        // Bright launch flash.
        this.renderer.addShockwave(cx, cy, {
          maxRadius: 22,
          color: '#ff6060',
          ttl: 16,
          width: 2,
        });
        // Downward exhaust plume — fast, glowy, slight spread.
        this.renderer.addParticleBurst(cx, cy, {
          count: 22,
          colors: ['#ff6040', '#ffaa44', '#ffff88', '#ff2020', '#ffffff'],
          speed: 2.4,
          spread: Math.PI / 2.2,
          dir: Math.PI / 2, // downward
          ttl: 28,
          size: 2.6,
          glow: 10,
          gravity: 0.06,
          vy0: 0.8,
        });
        // Sideways smoke wisps.
        this.renderer.addParticleBurst(cx, cy, {
          count: 8,
          colors: ['#664444', '#886666', '#aa8888'],
          speed: 0.8,
          spread: Math.PI,
          dir: Math.PI / 2,
          ttl: 40,
          size: 2.4,
          glow: 2,
          gravity: 0.01,
        });
      } catch (e) {
        Logger.error('onMissileSpawn handler failed.', e);
      }
    };
    // Breach: missile entered the rear dead zone (slipped past defenses).
    this.simulation.onBreach = (x, y) => {
      try {
        Sfx.cityHit();
        if (this.renderer) {
          this.renderer.addBigFloater(x, y - 2, '⚠ BREACH!', '#ff8844', 1.4);
          this.renderer.addShockwave(x, y, {
            maxRadius: 30,
            color: '#ff8844',
            ttl: 24,
            width: 2,
          });
          this.renderer.addParticleBurst(x, y, {
            count: 18,
            colors: ['#ff8844', '#ffaa66', '#ffff88', '#ff4422'],
            speed: 2.0,
            ttl: 35,
            size: 2.6,
            glow: 10,
            gravity: 0.05,
          });
          this.renderer.addShake(3, 18);
        }
        // Slight score penalty — they got past your defenses.
        this.hud.addScore(-15);
      } catch (e) {
        Logger.error('onBreach handler failed.', e);
      }
    };
    // Base destroyed: nice reward.
    this.missiles.onBaseSpawn = (cx, cy, kind) => {
      try {
        if (!this.renderer) return;
        const colorMap = {
          fortress: '#ff3333',
          bunker: '#ff8833',
          cruiser_e: '#ff5555',
          cruiser_w: '#ff5555',
        };
        const color = colorMap[kind] || '#ff3333';
        this.renderer.addShockwave(cx, cy, {
          maxRadius: 40,
          color,
          ttl: 30,
          width: 3,
        });
        const labelMap = {
          fortress: '⚠ FORTRESS DEPLOYED',
          bunker: '⚠ BUNKER DEPLOYED',
          cruiser_e: '⚠ CRUISER (E) DEPLOYED',
          cruiser_w: '⚠ CRUISER (W) DEPLOYED',
        };
        this.renderer.addBigFloater(cx, cy - 2, labelMap[kind] || '⚠ BASE DEPLOYED', color, 1.3);
        this.renderer.addParticleBurst(cx, cy, {
          count: 18,
          colors: [color, '#ffaa00', '#ffffff'],
          speed: 1.8,
          ttl: 32,
          size: 2.6,
          glow: 10,
        });
      } catch (e) {
        Logger.error('onBaseSpawn handler failed.', e);
      }
    };
    this.missiles.onBaseDestroyed = (cx, cy, kind) => {
      try {
        const scoreMap = {
          fortress: 600,
          bunker: 350,
          cruiser_e: 450,
          cruiser_w: 450,
        };
        const score = scoreMap[kind] || 400;
        this.hud.addScore(score);
        if (!this.renderer) return;
        this.renderer.addBigFloater(cx, cy, `BASE DOWN! +${score}`, '#ffff44', 1.8);
        this.renderer.addShockwave(cx, cy, {
          maxRadius: 70,
          color: '#ffff44',
          ttl: 38,
          width: 3,
        });
        this.renderer.addParticleBurst(cx, cy, {
          count: 55,
          colors: ['#ffff66', '#ff8800', '#ffffff', '#ff0033'],
          speed: 3.5,
          ttl: 60,
          size: 3.2,
          glow: 12,
          gravity: 0.05,
        });
        this.renderer.addShake(7, 28);
      } catch (e) {
        Logger.error('onBaseDestroyed handler failed.', e);
      }
    };
  }

  _wireInput() {
    this.input.onCommit = (committed) => {
      if (committed > 0) Sfx.inkPlace();
    };
  }

  // Compute CELL_SIZE so the entire UI fits in the current viewport.
  _fitCellSize() {
    const w = CONFIG.GRID_WIDTH;
    const h = CONFIG.GRID_HEIGHT;
    // Reserve space for HUD, speed control bar, body padding, borders.
    const reservedH = CONFIG.HUD_HEIGHT + 200; // HUD + speed bar + draw tools + margins
    const reservedW = 24; // borders + padding
    const availW = Math.max(200, window.innerWidth - reservedW);
    const availH = Math.max(200, window.innerHeight - reservedH);
    const sizeByW = Math.floor(availW / w);
    const sizeByH = Math.floor(availH / h);
    let size = Math.min(sizeByW, sizeByH);
    // Clamp to reasonable bounds.
    if (size < 1) size = 1;
    if (size > 16) size = 16;
    CONFIG.CELL_SIZE = size;
  }

  _onWindowResize() {
    const old = CONFIG.CELL_SIZE;
    // If using auto-fit resolution, recompute grid dims too.
    const idx = this.settings.values.RESOLUTION_INDEX | 0;
    const preset = RESOLUTION_PRESETS[idx];
    if (preset && preset.auto) {
      const dims = computeAutoGrid();
      if (dims.width !== CONFIG.GRID_WIDTH || dims.height !== CONFIG.GRID_HEIGHT) {
        CONFIG.GRID_WIDTH = dims.width;
        CONFIG.GRID_HEIGHT = dims.height;
        this._fitCellSize();
        this._buildWorld();
        if (this.renderer) this.renderer.setGrid(this.grid);
        if (this.gameState.is(STATE.PLAYING)) {
          this.cities.place();
          this.missiles.startWave(Math.max(0, this.hud.wave - 1));
        }
        return;
      }
    }
    this._fitCellSize();
    if (CONFIG.CELL_SIZE !== old && this.renderer) {
      this.renderer.resize();
    }
  }

  _initSpeedControls() {
    if (!this.speedSlider) return;
    // Slider value is an index into SPEED_PRESETS.
    // Cap the max slider index based on grid size — small boards don't need
    // ultra-high speeds, large boards benefit from them.
    const cells = (CONFIG.GRID_WIDTH | 0) * (CONFIG.GRID_HEIGHT | 0);
    let maxIdx = SPEED_PRESETS.length - 1;
    if (cells < 12000) {
      // Small boards: cap at 16x (index of 'Hyper 16x').
      const idx16 = SPEED_PRESETS.findIndex((p) => p.value === 16.0);
      if (idx16 >= 0) maxIdx = idx16;
    } else if (cells < 30000) {
      // Medium boards: cap at 32x.
      const idx32 = SPEED_PRESETS.findIndex((p) => p.value === 32.0);
      if (idx32 >= 0) maxIdx = idx32;
    } else if (cells < 60000) {
      // Large boards: cap at 64x.
      const idx64 = SPEED_PRESETS.findIndex((p) => p.value === 64.0);
      if (idx64 >= 0) maxIdx = idx64;
    }
    // XL+ boards: full range.
    this._maxSpeedIdx = maxIdx;
    this.speedSlider.min = '0';
    this.speedSlider.max = String(maxIdx);
    this.speedSlider.step = '1';
    // Default to "1x" preset.
    const defaultIdx = SPEED_PRESETS.findIndex((p) => p.value === 1.0);
    this.speedSlider.value = String(defaultIdx >= 0 ? defaultIdx : 3);
    this._applySpeedFromSlider();
    this.speedSlider.addEventListener('input', () => this._applySpeedFromSlider());
  }

  _applySpeedFromSlider() {
    const maxIdx = this._maxSpeedIdx != null ? this._maxSpeedIdx : SPEED_PRESETS.length - 1;
    const idx = Math.max(0, Math.min(maxIdx, parseInt(this.speedSlider.value, 10) || 0));
    const preset = SPEED_PRESETS[idx];
    CONFIG.SPEED_MULTIPLIER = preset.value;
    if (this.speedLabel) this.speedLabel.textContent = preset.name;
  }

  _setSpeedIndex(idx) {
    if (!this.speedSlider) return;
    const maxIdx = this._maxSpeedIdx != null ? this._maxSpeedIdx : SPEED_PRESETS.length - 1;
    const clamped = Math.max(0, Math.min(maxIdx, idx));
    this.speedSlider.value = String(clamped);
    this._applySpeedFromSlider();
  }

  _initKeyboardShortcuts() {
    // Hotkeys: Space = toggle pause, [ = slower, ] = faster, digits = preset
    this._prePauseIdx = null;
    window.addEventListener('keydown', (e) => {
      // Ignore when typing in an input.
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // F1 or '?' opens/closes the guide.
      if (e.key === 'F1') {
        e.preventDefault();
        this.guidePanel.toggle();
        return;
      }
      // If the guide is open, swallow other game hotkeys.
      if (this.guidePanel && this.guidePanel.isVisible()) return;
      // If the help guide is open, swallow other game hotkeys.
      if (this.helpGuidePanel && this.helpGuidePanel.isVisible()) return;
      // If the pattern zoo is open, swallow other game hotkeys.
      if (this.patternZoo && this.patternZoo.isVisible()) return;
      // ESC: universal close/cancel — close settings, hide help overlay,
      // cancel an active draw, or close menu overlay if in-game.
      if (e.key === 'Escape') {
        if (this.hotkeyHelpVisible) {
          e.preventDefault();
          this._toggleHotkeyHelp(false);
          return;
        }
        if (this.settingsPanel && !this.settingsPanel.overlay.classList.contains('hidden')) {
          e.preventDefault();
          this.settingsPanel.hide();
          return;
        }
        if (this.helpGuidePanel && this.helpGuidePanel.isVisible()) {
          e.preventDefault();
          this.helpGuidePanel.hide();
          return;
        }
        if (this.input && this.input.drawing) {
          e.preventDefault();
          this.input.cancelDrawing();
          return;
        }
      }
      // ?: show/hide hotkey help overlay.
      if (e.key === '?') {
        e.preventDefault();
        this._toggleHotkeyHelp();
        return;
      }
      // If hotkey help is visible, only ESC/?/H close it (handled above).
      if (this.hotkeyHelpVisible) return;

      if (e.code === 'Space') {
        e.preventDefault();
        const curIdx = parseInt(this.speedSlider.value, 10) || 0;
        if (SPEED_PRESETS[curIdx].value === 0) {
          // Resume to previous speed or 1x.
          const restore =
            this._prePauseIdx != null
              ? this._prePauseIdx
              : SPEED_PRESETS.findIndex((p) => p.value === 1.0);
          this._setSpeedIndex(restore);
        } else {
          this._prePauseIdx = curIdx;
          this._setSpeedIndex(0); // paused preset
        }
        return;
      }
      if (e.key === '[' || e.key === ',') {
        const curIdx = parseInt(this.speedSlider.value, 10) || 0;
        this._setSpeedIndex(curIdx - 1);
        return;
      }
      if (e.key === ']' || e.key === '.') {
        const curIdx = parseInt(this.speedSlider.value, 10) || 0;
        this._setSpeedIndex(curIdx + 1);
        return;
      }
      // Digit hotkeys (no shift): 0..(N-1) map to speed preset index.
      if (!e.shiftKey && /^[0-9]$/.test(e.key)) {
        const digit = parseInt(e.key, 10);
        const maxIdx = this._maxSpeedIdx != null ? this._maxSpeedIdx : SPEED_PRESETS.length - 1;
        if (digit <= maxIdx) this._setSpeedIndex(digit);
        return;
      }
      // C: Clear defenses.
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        this._onClearDefenses();
        return;
      }
      // Z or Ctrl+Z: Undo last stroke.
      if ((e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        // Only treat as undo if Ctrl/Meta is held; bare Z opens the zoo.
        if (!e.ctrlKey && !e.metaKey) {
          // Already handled above.
          return;
        }
        e.preventDefault();
        if (this.input && this.input.undo) {
          const removed = this.input.undo();
          if (removed > 0 && this.renderer) {
            // Brief visual feedback at center of grid.
            this.renderer.addFloater(
              Math.floor(this.grid.width / 2),
              Math.floor(this.grid.height / 2),
              `UNDO (${removed})`,
              '#88ddff'
            );
          }
        }
        return;
      }
      // G: Toggle the console hacking guide.
      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        this.guidePanel.toggle();
        return;
      }
      // H: Toggle the how-to-play / README guide.
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        this.helpGuidePanel.toggle();
        return;
      }
      // Z: Toggle the pattern zoo.
      if (e.key === 'z' || e.key === 'Z') {
        // Don't conflict with Ctrl+Z undo (handled below).
        if (e.ctrlKey || e.metaKey) {
          // Fall through to undo handler.
        } else if (!e.shiftKey) {
          e.preventDefault();
          this.patternZoo.toggle();
          return;
        }
      }
      // S: Open in-play settings (when enabled).
      if (e.key === 's' || e.key === 'S') {
        if (
          CONFIG.IN_PLAY_SETTINGS_ENABLED &&
          (this.gameState.is(STATE.PLAYING) || this.gameState.is(STATE.WAVE_TRANSITION))
        ) {
          e.preventDefault();
          this.openIngameSettings();
          return;
        }
      }
      // M: Return to menu (when not actively playing or game over).
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        // Mute toggle.
        const muted = Sfx.toggleMute();
        if (this.renderer) {
          this.renderer.addBigFloater(
            Math.floor(this.grid.width / 2),
            Math.floor(this.grid.height / 3),
            muted ? '🔇 MUTED' : '🔊 SOUND ON',
            muted ? '#888888' : '#00ffff',
            1.4
          );
        }
        return;
      }
      // Enter: Start game from menu or game over screen.
      if (e.key === 'Enter') {
        if (this.gameState.is(STATE.MENU) || this.gameState.is(STATE.GAME_OVER)) {
          if (!this.overlay.classList.contains('hidden')) {
            e.preventDefault();
            this.startGame();
          }
        }
        return;
      }
      // F11: toggle fullscreen.
      if (e.key === 'F11') {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
    });
  }

  _initHotkeyHelp() {
    // Create the hotkey help overlay element on demand.
    this.hotkeyHelpVisible = false;
    if (document.getElementById('hotkey-help-overlay')) return;
    const div = document.createElement('div');
    div.id = 'hotkey-help-overlay';
    div.className = 'overlay hidden';
    div.innerHTML = `
     <div id="hotkey-help-content">
       <h2>Keyboard Shortcuts</h2>
       <div class="hk-grid">
         <div class="hk-col">
           <h3>Simulation</h3>
           <div class="hk-row"><kbd>Space</kbd><span>Pause / resume</span></div>
           <div class="hk-row"><kbd>[</kbd> <kbd>,</kbd><span>Slower</span></div>
           <div class="hk-row"><kbd>]</kbd> <kbd>.</kbd><span>Faster</span></div>
           <div class="hk-row"><kbd>0</kbd>–<kbd>7</kbd><span>Speed preset</span></div>
           <h3>Drawing</h3>
           <div class="hk-row"><kbd>F</kbd><span>Freehand mode</span></div>
           <div class="hk-row"><kbd>L</kbd><span>Line mode</span></div>
           <div class="hk-row"><kbd>P</kbd><span>Pattern mode</span></div>
           <div class="hk-row"><kbd>R</kbd><span>Rotate pattern</span></div>
           <div class="hk-row"><kbd>X</kbd><span>Flip pattern horizontally</span></div>
           <div class="hk-row"><kbd>Y</kbd><span>Flip pattern vertically</span></div>
           <div class="hk-row"><kbd>+</kbd> <kbd>=</kbd><span>Wider brush</span></div>
           <div class="hk-row"><kbd>-</kbd><span>Narrower brush</span></div>
         </div>
         <div class="hk-col">
           <h3>Actions</h3>
           <div class="hk-row"><kbd>Z</kbd><span>Undo last stroke</span></div>
           <div class="hk-row"><kbd>C</kbd><span>Clear all defenses</span></div>
           <div class="hk-row"><kbd>Tab</kbd><span>Cycle draw mode</span></div>
           <div class="hk-row"><kbd>Esc</kbd><span>Cancel draw / close menu</span></div>
           <h3>Abilities</h3>
           <div class="hk-row"><kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd><span>Trigger ability slots 1–3</span></div>
           <div class="hk-row"><kbd>A</kbd><span>Trigger ability slot 1 (alias)</span></div>
           <h3>Patterns</h3>
           <div class="hk-row"><kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>8</kbd><span>Load preset</span></div>
           <h3>Menus</h3>
           <div class="hk-row"><kbd>Enter</kbd><span>Start game (from menu)</span></div>
           <div class="hk-row"><kbd>G</kbd> <kbd>F1</kbd><span>Hacking guide</span></div>
          <div class="hk-row"><kbd>H</kbd><span>How to Play guide</span></div>
          <div class="hk-row"><kbd>?</kbd><span>This hotkey help</span></div>
         </div>
       </div>
       <p class="hk-hint">Press <kbd>?</kbd> or <kbd>Esc</kbd> to close.</p>
     </div>`;
    document.getElementById('game-container').appendChild(div);
    this.hotkeyHelpEl = div;
    div.addEventListener('click', (e) => {
      if (e.target === div) this._toggleHotkeyHelp(false);
    });
  }

  _toggleHotkeyHelp(force) {
    if (!this.hotkeyHelpEl) return;
    const show = force === undefined ? !this.hotkeyHelpVisible : !!force;
    this.hotkeyHelpVisible = show;
    if (show) {
      // Pause game while help is shown.
      this._helpPauseSpeed = CONFIG.SPEED_MULTIPLIER;
      CONFIG.SPEED_MULTIPLIER = 0;
      this.hotkeyHelpEl.classList.remove('hidden');
    } else {
      if (this._helpPauseSpeed != null) {
        CONFIG.SPEED_MULTIPLIER = this._helpPauseSpeed;
        this._helpPauseSpeed = null;
      }
      // Resync slider label.
      if (this.speedSlider) this._applySpeedFromSlider();
      this.hotkeyHelpEl.classList.add('hidden');
    }
  }

  showOverlay(title, message, buttonText) {
    this.overlayTitle.innerHTML = title;
    this.overlayMessage.innerHTML = message;
    this.startButton.textContent = buttonText;
    this.overlay.classList.remove('hidden');
  }

  hideOverlay() {
    this.overlay.classList.add('hidden');
  }

  openSettings() {
    this.overlay.classList.add('hidden');
    this.settingsPanel.show();
  }

  openGuide() {
    this.guidePanel.show();
  }
  openHelpGuide() {
    this.helpGuidePanel.show();
  }
  openPatternZoo() {
    if (!this.patternZoo) return;
    // Close the menu overlay if it's showing so the zoo is unambiguous.
    this._zooPrevOverlayHidden = this.overlay.classList.contains('hidden');
    this.overlay.classList.add('hidden');
    // Bind a one-shot listener so re-showing the overlay on hide is sane.
    const origHide = this.patternZoo.hide.bind(this.patternZoo);
    this.patternZoo.hide = () => {
      origHide();
      // Restore the patched method.
      this.patternZoo.hide = origHide;
      // Re-show menu overlay if we were on the menu/game-over.
      if (
        !this._zooPrevOverlayHidden &&
        (this.gameState.is(STATE.MENU) || this.gameState.is(STATE.GAME_OVER))
      ) {
        this.overlay.classList.remove('hidden');
      }
    };
    this.patternZoo.show();
  }

  // Open settings from within a running game. Pauses the simulation
  // while open; restores prior speed when closed.
  openIngameSettings() {
    if (!CONFIG.IN_PLAY_SETTINGS_ENABLED) {
      Logger.info('In-play settings are disabled via CONFIG.IN_PLAY_SETTINGS_ENABLED.');
      return;
    }
    // Only meaningful during PLAYING or WAVE_TRANSITION — otherwise the
    // regular menu Settings button does the same thing.
    if (this.gameState.is(STATE.MENU) || this.gameState.is(STATE.GAME_OVER)) {
      this.openSettings();
      return;
    }
    // Stash speed and pause.
    this._ingameSettingsStashedSpeed = CONFIG.SPEED_MULTIPLIER;
    CONFIG.SPEED_MULTIPLIER = 0;
    if (this.speedLabel) this.speedLabel.textContent = 'PAUSED (settings)';
    // Hook close to restore speed.
    const origOnClose = this.settingsPanel.onClose;
    this.settingsPanel.onClose = () => {
      // Restore speed.
      if (this._ingameSettingsStashedSpeed != null) {
        CONFIG.SPEED_MULTIPLIER = this._ingameSettingsStashedSpeed;
        this._ingameSettingsStashedSpeed = null;
      }
      if (this.speedSlider) this._applySpeedFromSlider();
      // Restore original onClose for next time.
      this.settingsPanel.onClose = origOnClose;
    };
    this.settingsPanel.show();
  }

  _updateIngameSettingsButton() {
    if (!this.ingameSettingsButton) return;
    this.ingameSettingsButton.style.display = CONFIG.IN_PLAY_SETTINGS_ENABLED ? '' : 'none';
  }
  // Return to the main menu from an active game (or anywhere else).
  // Prompts for confirmation if a game is in progress.
  exitToMenu() {
    // Only confirm if a game is actually in progress.
    const inGame = this.gameState.is(STATE.PLAYING) || this.gameState.is(STATE.WAVE_TRANSITION);
    if (inGame) {
      const confirmed = window.confirm('Exit to main menu? Your current game will be lost.');
      if (!confirmed) return;
    }
    Logger.info('Exiting to main menu.');
    // Stop story mode if active.
    if (this.story && this.story.isActive()) {
      this.story.stopStory();
    }
    // Uninstall free-play abilities so the legacy button hides.
    if (this.freeplayAbilities) {
      this.freeplayAbilities.uninstall();
    }
    // Release wake lock; the menu shouldn't keep the screen on.
    releaseWakeLock();
    // Cancel any in-progress drawing.
    if (this.input) this.input.cancelDrawing();
    // Reset speed to 1x so resuming doesn't start paused at weird speed.
    CONFIG.SPEED_MULTIPLIER = 1.0;
    if (this.speedSlider) {
      const idx = SPEED_PRESETS.findIndex((p) => p.value === 1.0);
      this.speedSlider.value = String(idx >= 0 ? idx : 3);
      this._applySpeedFromSlider();
    }
    // Clear board state so the next start is clean.
    if (this.grid) {
      this.grid.cells.fill(0);
      this.grid.pending.fill(0);
      this.grid.pendingDry.fill(0);
      this.grid.explosionTimers.fill(0);
      this.grid.cellAge.fill(0);
      this.grid.cellColor.fill(0);
      this.grid.cellDir.fill(0);
    }
    // Transition back to menu state.
    this.gameState.set(STATE.MENU);
    // Show the main menu overlay.
    this.showOverlay(
      'The Arcade of Life',
      `Defend your cities from incoming missiles!<br>
       Draw defensive patterns on the bottom half of the screen.<br>
       Released cells evolve via Conway's Game of Life.<br><br>
       <strong>Click and drag</strong> to draw defenses.<br>
       Release to commit them to the simulation.<br><br>
       <strong>Hotkeys:</strong> Space = pause/resume, [ / ] = slower/faster, 0-8 = speed preset<br><br>
       High Score: ${this.hud.highScore}`,
      'Start Game'
    );
  }

  startGame() {
    Logger.info('Starting game.');
    Sfx.waveStart();
    // Acquire wake lock so the screen stays on during gameplay.
    requestWakeLock();
    // Apply any pending settings (may have changed resolution / gliders).
    this.settings.apply();
    // If resolution changed since last build, rebuild world.
    if (this.grid.width !== CONFIG.GRID_WIDTH || this.grid.height !== CONFIG.GRID_HEIGHT) {
      Logger.info(
        `Resolution changed to ${CONFIG.GRID_WIDTH}x${CONFIG.GRID_HEIGHT}; rebuilding world.`
      );
      this._fitCellSize();
      this._buildWorld();
      this.renderer.setGrid(this.grid);
      // Re-init speed controls for the new board size.
      this._initSpeedControls();
    }
    this.defenses.maxInk = CONFIG.MAX_INK;
    this.grid.cells.fill(0);
    this.grid.pending.fill(0);
    this.grid.pendingDry.fill(0);
    this.grid.explosionTimers.fill(0);
    this.grid.cellAge.fill(0);
    this.grid.cellColor.fill(0);
    this.grid.cellDir.fill(0);
    if (this.simulation.returnFireFired) {
      this.simulation.returnFireFired.fill(0);
    }
    this.defenses.reset();
    this.hud.reset();
    this.cities.place();
    // Initial wave: also enforce draw-zone constraint.
    this._clearFriendlyOutsideDrawZone();
    this.missiles.startWave(0);
    this.gameState.set(STATE.PLAYING);
    this.hideOverlay();
    // Install/uninstall free-play abilities based on mode.
    if (this.story && this.story.isActive()) {
      // Story mode owns the ability button; ensure free-play is uninstalled.
      if (this.freeplayAbilities) this.freeplayAbilities.uninstall();
    } else {
      // Free-play: refresh tool lock state (all tools unlocked) and install
      // configured abilities.
      if (this.drawTools && this.drawTools.refreshToolLockState) {
        this.drawTools.refreshToolLockState();
        if (this.drawTools.refreshPatternLockState) {
          this.drawTools.refreshPatternLockState();
        }
      }
      if (this.freeplayAbilities) {
        this.freeplayAbilities.uninstall();
        this.freeplayAbilities.install();
      }
    }
    // Wire 'A' hotkey for free-play abilities (story engine has its own).
    // (Note: the FreeplayAbilityManager binds Q/W/E for individual slots;
    //  the legacy 'A' hotkey triggers slot 0 as a convenience.)
    if (!this._freeplayHotkeyBound) {
      this._freeplayHotkeyBound = true;
      window.addEventListener('keydown', (e) => {
        if (this.story && this.story.isActive()) return; // story owns A
        if (!this.freeplayAbilities || !this.freeplayAbilities.hasAnyActive()) return;
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          this.freeplayAbilities.trigger(0);
        }
      });
    }
  }

  nextWave() {
    this.hud.wave++;
    Logger.info(`Advancing to wave ${this.hud.wave}.`);
    Sfx.waveStart();
    this.hud.addScore(this.cities.aliveCount() * 100);
    this.hud.addScore((Math.floor(this.defenses.ink) * 0.5) | 0);
    this.defenses.refill(80);
    // Clear any friendly paint outside the drawable area before the next wave starts.
    this._clearFriendlyOutsideDrawZone();
    this.missiles.startWave(this.hud.wave - 1);
    this.gameState.set(STATE.PLAYING);
  }
  // Remove DEFENSE cells (and pending ink) that lie outside the current
  // drawable area. Called at the start of each new wave so stray paint
  // from previous waves doesn't accumulate in the enemy region.
  _clearFriendlyOutsideDrawZone() {
    const g = this.grid;
    if (!g) return;
    const dzMinY = g.drawZoneMinY();
    const dzMaxY = g.drawZoneMaxY();
    let cleared = 0;
    for (let y = 0; y < g.height; y++) {
      if (y >= dzMinY && y <= dzMaxY) continue;
      for (let x = 0; x < g.width; x++) {
        const i = y * g.width + x;
        if (g.cells[i] === CELL_TYPE.DEFENSE) {
          g.cells[i] = CELL_TYPE.EMPTY;
          g.cellAge[i] = 0;
          cleared++;
        }
        if (g.pending[i]) {
          g.pending[i] = 0;
          g.pendingDry[i] = 0;
        }
      }
    }
    if (cleared > 0) {
      Logger.info(`Cleared ${cleared} friendly cells outside draw zone.`);
    }
  }

  gameOver() {
    this.gameState.set(STATE.GAME_OVER);
    Sfx.gameOver();
    releaseWakeLock();
    Logger.info(
      `Game over. Score=${this.hud.score}, wave=${this.hud.wave}, high=${this.hud.highScore}.`
    );
    this.showOverlay(
      'Game Over',
      `All cities destroyed!<br><br>
                 Final Score: <strong>${this.hud.score}</strong><br>
                 Wave Reached: ${this.hud.wave}<br>
                 High Score: ${this.hud.highScore}`,
      'Play Again'
    );
  }

  _loop(time) {
    try {
      const dt = time - this.lastTime;
      this.lastTime = time;

      if (this.gameState.is(STATE.PLAYING)) {
        this._update(dt);
      }

      this.hud.citiesAlive = this.cities.aliveCount();
      this.hud.ink = this.defenses.ink;
      this.hud.maxInk = this.defenses.maxInk;
      // Drive story progression each frame.
      if (this.story) this.story.update(dt);
      // Tick free-play ability cooldowns.
      if (this.freeplayAbilities && !(this.story && this.story.isActive())) {
        this.freeplayAbilities.update(dt);
      }

      this.renderer.render(this.hud);
      // Successful frame: decay error count.
      if (this._frameErrorCount > 0) this._frameErrorCount--;
    } catch (e) {
      this._frameErrorCount++;
      Logger.error(`Frame error (${this._frameErrorCount}/${this._MAX_FRAME_ERRORS}).`, e);
      if (this._frameErrorCount >= this._MAX_FRAME_ERRORS) {
        Logger.error('Too many consecutive frame errors; halting render loop.');
        this.showOverlay(
          'Error',
          'The game encountered repeated errors and has stopped.<br>' +
            'Open the browser console for details, then reload to try again.',
          'Reload'
        );
        this.startButton.onclick = () => location.reload();
        return; // do not reschedule
      }
    }
    requestAnimationFrame(this._loop.bind(this));
  }

  _update(dt) {
    const speed = CONFIG.SPEED_MULTIPLIER;
    if (speed <= 0) {
      // Even when paused, advance pending-ink drying so the player can
      // draw precision defenses in pause mode and see them commit.
      this.grid.tickPendingDry();
      return;
    }

    // Scale dt by speed for both missile spawning and sim ticks.
    const scaledDt = dt * speed;

    // Missile spawning rate also follows the attacker tick rate: when
    // attackers tick at N/(M+N) of full speed, missile spawn rate scales
    // similarly. Ratio is N / max(M, N) so 1:1 stays 1.0x.
    const M_for_spawn = Math.max(1, CONFIG.DEFENDER_TICKS | 0);
    const N_for_spawn = Math.max(1, CONFIG.ATTACKER_TICKS | 0);
    const spawnDtScale = N_for_spawn / Math.max(M_for_spawn, N_for_spawn);
    this.missiles.update(scaledDt * spawnDtScale);

    // M:N timestep ratio. Each accumulator advances independently so
    // defenders and attackers can tick at different rates. Both default
    // to 1:1 (locked together).
    const M = Math.max(1, CONFIG.DEFENDER_TICKS | 0);
    const N = Math.max(1, CONFIG.ATTACKER_TICKS | 0);
    // Defender period: TICK_RATE / M  (defenders tick M times per TICK_RATE).
    // Attacker period: TICK_RATE / N.
    const defPeriod = CONFIG.TICK_RATE / M;
    const attPeriod = CONFIG.TICK_RATE / N;

    this._defAccum = (this._defAccum || 0) + scaledDt;
    this._attAccum = (this._attAccum || 0) + scaledDt;

    // Cap ticks per frame to avoid runaway at hyperspeeds.
    const MAX_TICKS_PER_FRAME = 64;
    let ticks = 0;
    while (ticks < MAX_TICKS_PER_FRAME) {
      const defDue = this._defAccum >= defPeriod;
      const attDue = this._attAccum >= attPeriod;
      if (!defDue && !attDue) break;
      // Determine which side(s) tick this step.
      // If both are due, prefer ticking both together (most natural).
      // Otherwise tick the one that's due, freezing the other.
      const tickDef = defDue;
      const tickAtt = attDue;

      // Dry pending cells one tick before stepping the simulation, so
      // newly-dried cells take part in this tick's Life rules.
      this.grid.tickPendingDry();

      // Configure simulation freeze flags for this step.
      // Combine M:N schedule with Time Stop ability state. Time Stop is
      // tracked via the ability's external state; we re-read it here so
      // we don't fight it.
      const timeStopActive =
        (this.story && this.story._timeStopUntil > 0) || this._freezeTimer != null;
      this.simulation.freezeEnemies = !tickAtt || timeStopActive;
      this.simulation.freezeDefenses = !tickDef;

      this.simulation.tick();
      this.cities.update();
      if (tickDef) this.defenses.regen(CONFIG.INK_REGEN_RATE);

      // Clear schedule-driven freeze flags so external systems see a
      // clean state between frames. Time Stop is re-applied below.
      this.simulation.freezeEnemies = timeStopActive;
      this.simulation.freezeDefenses = false;

      if (tickDef) this._defAccum -= defPeriod;
      if (tickAtt) this._attAccum -= attPeriod;
      ticks++;
    }
    // If we capped out, drain remaining accumulator to avoid death spiral.
    if (ticks >= MAX_TICKS_PER_FRAME) {
      this._defAccum = 0;
      this._attAccum = 0;
    }

    // God mode: revive any lost cities and refill ink every frame.
    if (this._godMode) {
      const g = this.grid;
      this.cities.cities.forEach((c) => {
        if (!c.alive) {
          c.alive = true;
          for (let dy = 0; dy < c.height; dy++) {
            for (let dx = 0; dx < c.width; dx++) {
              g.set(c.x + dx, c.y + dy, CELL_TYPE.CITY);
            }
          }
        }
      });
      this.defenses.ink = this.defenses.maxInk;
    }

    if (this.cities.aliveCount() === 0) {
      this.gameOver();
      return;
    }

    if (this.missiles.isWaveComplete()) {
      this.nextWave();
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  // PWA bootstrap (runs independently of game init).
  registerServiceWorker();
  initInstallPrompt();
  initNetworkIndicator();

  // Global error nets. Browsers will already log these, but routing them
  // through our logger keeps consistent formatting and lets us filter.
  window.addEventListener('error', (ev) => {
    Logger.error('Uncaught error:', ev.message, ev.error || '');
  });
  window.addEventListener('unhandledrejection', (ev) => {
    Logger.error('Unhandled promise rejection:', ev.reason);
  });
  try {
    new Game();
    // Auto-start if launched via shortcut (?autostart=1).
    checkAutoStart(() => {
      const btn = document.getElementById('start-button');
      if (btn) btn.click();
    });
  } catch (e) {
    Logger.error('Fatal error during Game construction.', e);
    const overlay = document.getElementById('overlay');
    const msg = document.getElementById('overlay-message');
    const title = document.getElementById('overlay-title');
    if (overlay && msg && title) {
      title.textContent = 'Startup Error';
      msg.innerHTML =
        'The game failed to start. ' + 'Open the browser console for details, then reload.';
      overlay.classList.remove('hidden');
    }
  }
});
