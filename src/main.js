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
import { LevelDesigner } from './levelDesigner.js';
import { getLevel } from './levels.js';
import { initLevelCatalog } from './levelCatalog.js';
import {
  registerServiceWorker,
  initInstallPrompt,
  initNetworkIndicator,
  checkAutoStart,
  checkLevelUrlParam,
  requestWakeLock,
  releaseWakeLock,
  toggleFullscreen,
} from './pwa.js';
import { getRuleset, getNeighborhood } from './rules/index.js';

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
    this.stepForwardButton = document.getElementById('step-forward-button');
    this.restartLevelButton = document.getElementById('restart-level-button');
    this.restartLevelButton = document.getElementById('restart-level-button');
    this.patternZooButton = document.getElementById('pattern-zoo-button');
    this.patternZooIngameButton = document.getElementById('pattern-zoo-ingame-button');
    this.levelDesignerButton = document.getElementById('level-designer-button');
    this.levelDesignerIngameButton = document.getElementById('level-designer-ingame-button');

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
        // If topology changed, rebuild world.
        try {
          const ruleDef = getRuleset(CONFIG.ACTIVE_RULESET || 'conway');
          const newNbhd =
            ruleDef && ruleDef.neighborhood ? getNeighborhood(ruleDef.neighborhood) : null;
          const newTopology = newNbhd && newNbhd.topology ? newNbhd.topology : 'square';
          if (newTopology !== (this.grid.topologyId || 'square')) {
            Logger.info(`Topology changed to "${newTopology}"; rebuilding world.`);
            this._buildWorld();
            this.renderer.setGrid(this.grid);
          }
        } catch (e) {
          Logger.warn('Topology check failed on settings close', e);
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
      markdownUrl: './console_guide.md',
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
      markdownUrl: './README.md',
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
    // Cross-reference so the editor can save/update custom patterns directly.
    this.drawTools.patternCapture = this.patternCapture;
    // Pattern Zoo — browse the pattern library with live previews.
    this.patternZoo = new PatternZoo({ game: this });
    // Level Designer — craft custom scenarios.
    this.levelDesigner = new LevelDesigner({ game: this });
    // Currently-loaded custom level (null = standard game).
    this._activeCustomLevel = null;
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
    if (this.levelDesignerButton) {
      this.levelDesignerButton.addEventListener('click', () => this.openLevelDesigner());
    }
    if (this.levelDesignerIngameButton) {
      this.levelDesignerIngameButton.addEventListener('click', () => this.openLevelDesigner());
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
    // Step-forward button: advance one simulation tick when paused.
    if (this.stepForwardButton) {
      this.stepForwardButton.addEventListener('click', () => this.stepForward());
    }
    // Restart-level button: re-run the current level (with confirmation).
    if (this.restartLevelButton) {
      this.restartLevelButton.addEventListener('click', () => this.restartLevel());
    }

    this._initSpeedControls();
    this._initKeyboardShortcuts();
    this._initHotkeyHelp();
    this._initPanControls();
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
    // Prefetch and render the curated level catalog on the main menu.
    initLevelCatalog();
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
      // Don't trigger while other overlays are open.
      if (this.guidePanel && this.guidePanel.isVisible()) return;
      if (this.helpGuidePanel && this.helpGuidePanel.isVisible()) return;
      if (this.patternZoo && this.patternZoo.isVisible()) return;
      if (this.levelDesigner && this.levelDesigner.isVisible()) return;
      if (e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        this.patternCapture.toggle();
      }
    });
  }

  // (Re)construct grid + entities for current CONFIG resolution.
  _buildWorld() {
    // Determine topology from the active ruleset's neighborhood.
    let topologyId = 'square';
    try {
      const ruleDef = getRuleset(CONFIG.ACTIVE_RULESET || 'conway');
      // Skip topology lookup for exotic rules — they don't expose a
      // neighborhood field in the canonical form.
      const nbhd =
        ruleDef && ruleDef.neighborhood && !ruleDef._exoticType
          ? getNeighborhood(ruleDef.neighborhood)
          : null;
      if (nbhd && nbhd.topology) topologyId = nbhd.topology;
    } catch (e) {
      Logger.warn('Failed to determine topology; defaulting to square.', e);
    }
    Logger.info(`[Game] Building world with topology: ${topologyId}`);
    this.grid = new Grid(CONFIG.GRID_WIDTH, CONFIG.GRID_HEIGHT, topologyId);
    // Apply any pre-staged wrap vertical shift BEFORE constructing the
    // simulation, so the backend selection (CPU vs GPU) sees it.
    if (this._pendingWrapVerticalShift) {
      this.grid.wrapVerticalShift = this._pendingWrapVerticalShift | 0;
      Logger.info(
        `[Game] _buildWorld: applied pre-staged wrapVerticalShift=` +
          `${this.grid.wrapVerticalShift} to grid before Simulation init.`
      );
      this._pendingWrapVerticalShift = null;
    }
    this.simulation = new Simulation(this.grid);
    this.cities = new Cities(this.grid);
    this.missiles = new Missiles(this.grid);
    // Preserve ink across rebuilds if defenses already exists; else create fresh.
    if (!this.defenses) this.defenses = new Defenses();
    else this.defenses.maxInk = CONFIG.MAX_INK;
    // Rebuild input manager to bind to new grid (canvas same).
    const prevInput = this.input;
    if (this.input) {
      this.input.cancelDrawing();
      // Detach old listeners if the InputManager supports it. This
      // prevents the old manager from continuing to receive canvas
      // events (which would double-charge ink on subsequent strokes).
      if (typeof this.input.destroy === 'function') {
        try {
          this.input.destroy();
        } catch (e) {
          Logger.warn('[Game] InputManager.destroy() failed', e);
        }
      }
    }
    this.input = new InputManager(this.canvas, this.grid, this.defenses);
    // Carry over drawing mode/settings from previous input manager.
    if (prevInput) {
      this.input.setMode(prevInput.mode);
      this.input.setLineWidth(prevInput.lineWidth);
      this.input.setDashPattern(prevInput.dashPattern);
      this.input.pattern = new Set(prevInput.pattern);
      this.input.patternRotation = prevInput.patternRotation;
      this.input.patternFlipH = prevInput.patternFlipH;
      this.input.patternFlipV = prevInput.patternFlipV;
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
      } catch {
        /* swallow */
      }
    };
    this.simulation.onAnnihilation = (x, y) => {
      try {
        if (!CONFIG.EVENT_ANNIHILATION) return;
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
        if (!CONFIG.EVENT_CITY_HIT) return;
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
    // Determine topology to size cells correctly.
    let topologyId = 'square';
    try {
      const ruleDef = getRuleset(CONFIG.ACTIVE_RULESET || 'conway');
      const nbhd =
        ruleDef && ruleDef.neighborhood && !ruleDef._exoticType
          ? getNeighborhood(ruleDef.neighborhood)
          : null;
      if (nbhd && nbhd.topology) topologyId = nbhd.topology;
    } catch (_e) {
      // default square
    }
    let sizeByW, sizeByH;
    if (topologyId === 'hex') {
      // Pointy-top hex: width = √3*s where s = cs/2, so horizontal stride
      // per column is (√3/2)*cs. Total width with odd-row offset is
      // w*(√3/2)*cs + (√3/4)*cs. Vertical stride is 0.75*cs, total height
      // is 0.75*cs*(h-1) + cs.
      const SQRT3 = Math.sqrt(3);
      sizeByW = Math.floor(availW / ((SQRT3 / 2) * (w + 0.5)));
      sizeByH = Math.floor(availH / (0.75 * (h - 1) + 1));
    } else if (topologyId === 'tri') {
      sizeByW = Math.floor(availW / (w * 0.5 + 0.5));
      sizeByH = Math.floor((availH * 2) / (h * Math.sqrt(3)));
    } else {
      sizeByW = Math.floor(availW / w);
      sizeByH = Math.floor(availH / h);
    }
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
        // Preserve grid state across rebuild so a window resize (or
        // fullscreen toggle) doesn't wipe the player's painted defenses.
        const oldGrid = this.grid;
        const oldW = oldGrid.width;
        const oldH = oldGrid.height;
        // Preserve ink state across rebuild — _buildWorld would
        // otherwise leave this.defenses intact but the InputManager
        // rebuild can double-charge ink for in-flight strokes.
        // Cancel any in-progress drawing so ink isn't double-charged.
        if (this.input) this.input.cancelDrawing();
        CONFIG.GRID_WIDTH = dims.width;
        CONFIG.GRID_HEIGHT = dims.height;
        this._fitCellSize();
        this._buildWorld();
        // Copy over as much of the old grid as fits into the new one,
        // anchored to bottom-left so cities and defenses stay near the
        // bottom where the player drew them.
        const newW = this.grid.width;
        const newH = this.grid.height;
        const copyW = Math.min(oldW, newW);
        const copyH = Math.min(oldH, newH);
        const srcYOff = oldH - copyH;
        const dstYOff = newH - copyH;
        // Guard against topology mismatch (e.g. hex vs square)
        // which would corrupt the buffer copy.
        const sameTopology = oldGrid.topologyId === this.grid.topologyId;
        if (!sameTopology) {
          Logger.warn('Topology changed during resize; skipping state copy.');
          if (this.renderer) this.renderer.setGrid(this.grid);
          return;
        }
        // For triangular grids the stride is 2*w, so the basic row-by-row
        // copy would be incorrect. Skip state copy in that case.
        if (this.grid.topologyId === 'tri') {
          Logger.warn('Tri topology resize: skipping state copy.');
          if (this.renderer) this.renderer.setGrid(this.grid);
          return;
        }
        for (let y = 0; y < copyH; y++) {
          for (let x = 0; x < copyW; x++) {
            const si = (y + srcYOff) * oldW + x;
            const di = (y + dstYOff) * newW + x;
            this.grid.cells[di] = oldGrid.cells[si];
            this.grid.pending[di] = oldGrid.pending[si];
            this.grid.pendingDry[di] = oldGrid.pendingDry[si];
            this.grid.cellAge[di] = oldGrid.cellAge[si];
            this.grid.cellColor[di] = oldGrid.cellColor[si];
            this.grid.cellDir[di] = oldGrid.cellDir[si];
            this.grid.explosionTimers[di] = oldGrid.explosionTimers[si];
          }
        }
        if (this.renderer) this.renderer.setGrid(this.grid);
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
    // Update step button enabled state — only useful when paused.
    if (this.stepForwardButton) {
      this.stepForwardButton.disabled = preset.value > 0;
    }
  }
  // Advance the simulation by exactly one tick. Only meaningful when
  // the game is paused (speed = 0). Performs the full tick cycle:
  // missile spawning, defender/attacker simulation step, city update,
  // ink regen, and accumulator bookkeeping.
  stepForward() {
    // Only valid during active gameplay.
    if (!this.gameState.is(STATE.PLAYING) && !this.gameState.is(STATE.WAVE_TRANSITION)) {
      return;
    }
    if (CONFIG.SPEED_MULTIPLIER > 0) {
      Logger.info('Step-forward requested but game is not paused; ignoring.');
      return;
    }
    // Use a synthetic dt large enough to trigger one full tick.
    const syntheticDt = CONFIG.TICK_RATE;
    // Temporarily set speed to 1x to satisfy the speed gate in _update.
    CONFIG.SPEED_MULTIPLIER = 1.0;
    // Run missile spawning + sim ticks for one full simulation step.
    this.missiles.update(syntheticDt);
    // Dry pending cells once.
    this.grid.tickPendingDry();
    // One simulation tick (both defenders and attackers).
    this.simulation.freezeEnemies = false;
    this.simulation.freezeDefenses = false;
    this.simulation.tick();
    this.cities.update();
    this.defenses.regen(CONFIG.INK_REGEN_RATE);
    // Check end conditions just like in _update.
    if (this.cities.aliveCount() === 0) {
      this.gameOver();
    } else if (this.missiles.isWaveComplete()) {
      this.nextWave();
    }
    // Restore paused state.
    CONFIG.SPEED_MULTIPLIER = 0;
    if (this.speedLabel) this.speedLabel.textContent = 'Paused';
    // Show a small floater so the user gets visual feedback.
    if (this.renderer && this.grid) {
      this.renderer.addFloater(
        Math.floor(this.grid.width / 2),
        Math.floor(this.grid.height / 3),
        '⏭ STEP',
        '#ffcc44'
      );
    }
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
      // N: Step forward one tick (only when paused & playing).
      if (e.key === 'n' || e.key === 'N') {
        if (
          (this.gameState.is(STATE.PLAYING) || this.gameState.is(STATE.WAVE_TRANSITION)) &&
          CONFIG.SPEED_MULTIPLIER === 0
        ) {
          e.preventDefault();
          this.stepForward();
          return;
        }
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
      // D: Toggle the level designer (when not actively playing).
      if (e.key === 'd' || e.key === 'D') {
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        e.preventDefault();
        this.levelDesigner.toggle();
        return;
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
           <div class="hk-row"><kbd>N</kbd><span>Step forward one tick (when paused)</span></div>
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
  _initPanControls() {
    // Shift+arrow keys pan the view horizontally during gameplay.
    // Also Shift+drag with middle mouse button or Alt+drag.
    window.addEventListener('keydown', (e) => {
      if (!this.gameState.is(STATE.PLAYING) && !this.gameState.is(STATE.WAVE_TRANSITION)) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!this.grid) return;
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const step = e.ctrlKey ? 10 : 2;
        const delta = e.key === 'ArrowLeft' ? -step : step;
        const w = this.grid.width;
        this.grid.panOffset = (((this.grid.panOffset + delta) % w) + w) % w;
        if (this.renderer) {
          this.renderer.addFloater(
            Math.floor(w / 2),
            Math.floor(this.grid.height / 2),
            `↔ Pan: ${this.grid.panOffset}`,
            '#88ddff'
          );
        }
      }
    });
    // Alt+drag pan with mouse.
    if (this.canvas) {
      let panning = false;
      let lastX = 0;
      let accumulator = 0;
      this.canvas.addEventListener('mousedown', (e) => {
        if (!e.altKey) return;
        if (!this.gameState.is(STATE.PLAYING) && !this.gameState.is(STATE.WAVE_TRANSITION)) return;
        e.preventDefault();
        panning = true;
        lastX = e.clientX;
        accumulator = 0;
      });
      window.addEventListener('mousemove', (e) => {
        if (!panning) return;
        const dx = e.clientX - lastX;
        lastX = e.clientX;
        accumulator += dx;
        const cs = CONFIG.CELL_SIZE > 0 ? CONFIG.CELL_SIZE : 1;
        const cellsMoved = Math.trunc(accumulator / cs);
        if (cellsMoved !== 0 && this.grid) {
          const w = this.grid.width;
          this.grid.panOffset = (((this.grid.panOffset - cellsMoved) % w) + w) % w;
          accumulator -= cellsMoved * cs;
        }
      });
      window.addEventListener('mouseup', () => {
        panning = false;
      });
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
  openLevelDesigner() {
    if (!this.levelDesigner) return;
    this.levelDesigner.show();
  }
  /**
   * Restart the current level (or default game) from scratch. Prompts
   * for confirmation. If a custom level is active, re-launches it;
   * otherwise starts a fresh default game.
   */
  restartLevel() {
    const inGame =
      this.gameState.is(STATE.PLAYING) ||
      this.gameState.is(STATE.WAVE_TRANSITION) ||
      this.gameState.is(STATE.GAME_OVER);
    if (!inGame) {
      Logger.info('Restart requested but no game is active.');
      return;
    }
    const levelName = this._activeCustomLevel ? this._activeCustomLevel.name : null;
    const label = levelName ? `level "${levelName}"` : 'the current game';
    const confirmed = window.confirm(`Restart ${label}? Your current progress will be lost.`);
    if (!confirmed) return;
    Logger.info(`Restarting ${label}.`);
    if (this.input) this.input.cancelDrawing();
    if (levelName) {
      this.startCustomLevel(levelName);
    } else {
      this.startGame();
    }
  }
  /**
   * Start a game using a saved custom level. Applies the level's
   * grid size, ruleset, wave config, cities, defenses, and bases,
   * then begins playing.
   * @param {string} levelName
   */
  startCustomLevel(levelName) {
    const level = getLevel(levelName);
    if (!level) {
      Logger.warn(`[Game] Custom level "${levelName}" not found.`);
      return false;
    }
    Logger.info(`[Game] Starting custom level "${levelName}".`);
    Logger.info(
      `[Game] Level fields: wrapVerticalShift=${level.wrapVerticalShift} ` +
        `(type=${typeof level.wrapVerticalShift}), ` +
        `gridWidth=${level.gridWidth}, gridHeight=${level.gridHeight}, ` +
        `ruleset=${level.ruleset}, ` +
        `keys=[${Object.keys(level).join(', ')}]`
    );
    this._activeCustomLevel = level;
    this._customVictoryShown = false;
    // Diagnostic: dump age-related settings from the loaded level.
    if (level.settings) {
      const s = level.settings;
      Logger.info(
        `[Game] startCustomLevel "${levelName}" — incoming age settings: ` +
          `UNLIMITED_CELL_AGE=${s.UNLIMITED_CELL_AGE}, ` +
          `DEFENSE_AGE_FRIENDLY=${s.DEFENSE_AGE_FRIENDLY}, ` +
          `UNLIMITED_DEF_AGE_FRIENDLY=${s.UNLIMITED_DEF_AGE_FRIENDLY}, ` +
          `DEFENSE_AGE_ENEMY=${s.DEFENSE_AGE_ENEMY}, ` +
          `UNLIMITED_DEF_AGE_ENEMY=${s.UNLIMITED_DEF_AGE_ENEMY}, ` +
          `MISSILE_AGE_FRIENDLY=${s.MISSILE_AGE_FRIENDLY}, ` +
          `UNLIMITED_MISS_AGE_FRIENDLY=${s.UNLIMITED_MISS_AGE_FRIENDLY}, ` +
          `MISSILE_AGE_ENEMY=${s.MISSILE_AGE_ENEMY}, ` +
          `UNLIMITED_MISS_AGE_ENEMY=${s.UNLIMITED_MISS_AGE_ENEMY}`
      );
      Logger.info(
        `[Game] CONFIG age values BEFORE level apply: ` +
          `DEFENSE_AGE_FRIENDLY=${CONFIG.DEFENSE_AGE_FRIENDLY}, ` +
          `DEFENSE_AGE_ENEMY=${CONFIG.DEFENSE_AGE_ENEMY}, ` +
          `MISSILE_AGE_FRIENDLY=${CONFIG.MISSILE_AGE_FRIENDLY}, ` +
          `MISSILE_AGE_ENEMY=${CONFIG.MISSILE_AGE_ENEMY}`
      );
    }
    // Apply full settings snapshot first (if present) so that downstream
    // overrides like waveConfig and ruleset still take precedence.
    if (level.settings && typeof level.settings === 'object') {
      for (const [k, v] of Object.entries(level.settings)) {
        // Only copy known CONFIG keys to avoid pollution.
        if (k in CONFIG) CONFIG[k] = v;
      }
      Logger.info(`[Game] Applied ${Object.keys(level.settings).length} setting overrides.`);
      // Also sync the level's settings into this.settings.values so the
      // Settings panel reflects the level's state and any subsequent
      // settings.apply() call (e.g. from opening the in-game settings
      // panel) won't clobber CONFIG with the user's persistent values.
      // This is especially important for the UNLIMITED_* flags which
      // live only in settings.values (not CONFIG) and would otherwise
      // re-apply their sentinel values on the next apply().
      if (this.settings && this.settings.values) {
        for (const [k, v] of Object.entries(level.settings)) {
          // Only sync keys that the Settings system already knows about.
          if (k in this.settings.values) {
            this.settings.values[k] = v;
          }
        }
        Logger.info(
          `[Game] Synced level settings into Settings.values: ` +
            `UNLIMITED_DEF_AGE_FRIENDLY=${this.settings.values.UNLIMITED_DEF_AGE_FRIENDLY}, ` +
            `UNLIMITED_DEF_AGE_ENEMY=${this.settings.values.UNLIMITED_DEF_AGE_ENEMY}, ` +
            `UNLIMITED_MISS_AGE_FRIENDLY=${this.settings.values.UNLIMITED_MISS_AGE_FRIENDLY}, ` +
            `UNLIMITED_MISS_AGE_ENEMY=${this.settings.values.UNLIMITED_MISS_AGE_ENEMY}, ` +
            `UNLIMITED_CELL_AGE=${this.settings.values.UNLIMITED_CELL_AGE}`
        );
      }
    }
    // Apply unlimited-toggle sentinels from the level's settings snapshot.
    const UNLIMITED = CONFIG.UNLIMITED_SENTINEL || 999999;
    const unlimitedMap = {
      UNLIMITED_MAX_INK: ['MAX_INK', 'INITIAL_INK'],
      UNLIMITED_INK_REGEN: ['INK_REGEN_RATE'],
      UNLIMITED_MISSILE_CASCADE: ['MISSILE_CASCADE_TICKS'],
      UNLIMITED_DEF_AGE_FRIENDLY: ['DEFENSE_AGE_FRIENDLY'],
      UNLIMITED_DEF_AGE_ENEMY: ['DEFENSE_AGE_ENEMY'],
      UNLIMITED_DEF_AGE_NEUTRAL: ['DEFENSE_AGE_NEUTRAL'],
      UNLIMITED_MISS_AGE_FRIENDLY: ['MISSILE_AGE_FRIENDLY'],
      UNLIMITED_MISS_AGE_ENEMY: ['MISSILE_AGE_ENEMY'],
      UNLIMITED_MISS_AGE_NEUTRAL: ['MISSILE_AGE_NEUTRAL'],
    };
    if (level.settings) {
      const regionKeys = [
        'DEFENSE_AGE_FRIENDLY',
        'DEFENSE_AGE_ENEMY',
        'MISSILE_AGE_FRIENDLY',
        'MISSILE_AGE_ENEMY',
      ];

      const regionValues = regionKeys.map((k) => level.settings[k]);

      if (level.settings.UNLIMITED_CELL_AGE) {
        const regionFlags = [
          ['UNLIMITED_DEF_AGE_FRIENDLY', 'DEFENSE_AGE_FRIENDLY'],
          ['UNLIMITED_DEF_AGE_ENEMY', 'DEFENSE_AGE_ENEMY'],
          ['UNLIMITED_DEF_AGE_NEUTRAL', 'DEFENSE_AGE_NEUTRAL'],
          ['UNLIMITED_MISS_AGE_FRIENDLY', 'MISSILE_AGE_FRIENDLY'],
          ['UNLIMITED_MISS_AGE_ENEMY', 'MISSILE_AGE_ENEMY'],
          ['UNLIMITED_MISS_AGE_NEUTRAL', 'MISSILE_AGE_NEUTRAL'],
        ];
        // If no region unlimited flag is set, propagate ∞ to all.
        const anyRegionUnlimited = regionFlags.some(([flag]) => level.settings[flag]);
        // Also skip propagation if any region key has an explicit finite
        // value in the level settings — that's a clear designer override.
        const anyRegionFinite = regionFlags.some(
          ([, key]) => typeof level.settings[key] === 'number' && level.settings[key] < UNLIMITED
        );
        if (!anyRegionUnlimited && !anyRegionFinite) {
          for (const [, key] of regionFlags) {
            CONFIG[key] = UNLIMITED;
            Logger.info(`[Game] Legacy UNLIMITED_CELL_AGE → CONFIG.${key} = ∞`);
          }
        } else if (anyRegionFinite) {
          Logger.info(
            `[Game] Legacy UNLIMITED_CELL_AGE NOT propagated; ` +
              `level has explicit finite region ages.`
          );
        }
      }
      for (const [flag, keys] of Object.entries(unlimitedMap)) {
        if (level.settings[flag]) {
          for (const k of keys) CONFIG[k] = UNLIMITED;
          Logger.info(`[Game] Unlimited flag ${flag} → ${keys.join(', ')} = ∞`);
        }
      }
      // Diagnostic: final CONFIG age values after all translations.
      Logger.info(
        `[Game] CONFIG age values AFTER level apply: ` +
          `DEFENSE_AGE_FRIENDLY=${CONFIG.DEFENSE_AGE_FRIENDLY}, ` +
          `DEFENSE_AGE_ENEMY=${CONFIG.DEFENSE_AGE_ENEMY}, ` +
          `MISSILE_AGE_FRIENDLY=${CONFIG.MISSILE_AGE_FRIENDLY}, ` +
          `MISSILE_AGE_ENEMY=${CONFIG.MISSILE_AGE_ENEMY}, ` +
          `MISSILE_CASCADE_TICKS=${CONFIG.MISSILE_CASCADE_TICKS}`
      );
    }
    // Apply color theme overrides on top of the loaded settings.
    if (level.colorTheme && typeof level.colorTheme === 'object') {
      // Stash defaults so we can restore on exit.
      if (!this._defaultColors) {
        this._defaultColors = { ...CONFIG.COLORS };
      }
      const themeKeys = Object.keys(level.colorTheme);
      let appliedCount = 0;
      Logger.info(`[Game] Color theme has ${themeKeys.length} key(s): ${themeKeys.join(', ')}`);
      for (const [k, v] of Object.entries(level.colorTheme)) {
        // Apply even if the key isn't in CONFIG.COLORS by default — the
        // level theme may introduce new keys, and `in` checks own+inherited.
        // We trust the designer's set of keys.
        CONFIG.COLORS[k] = v;
        appliedCount++;
      }
      Logger.info(`[Game] Applied ${appliedCount}/${themeKeys.length} color theme overrides.`);
      Logger.info(
        `[Game] CONFIG.COLORS.BACKGROUND now = ${CONFIG.COLORS.BACKGROUND}, ` +
          `CELL_CITY = ${CONFIG.COLORS.CELL_CITY}`
      );
    }
    // Apply level config overrides.
    CONFIG.GRID_WIDTH = level.gridWidth || CONFIG.GRID_WIDTH;
    CONFIG.GRID_HEIGHT = level.gridHeight || CONFIG.GRID_HEIGHT;
    if (level.ruleset) CONFIG.ACTIVE_RULESET = level.ruleset;
    // Custom levels use ONLY the designed bases & spawners. Disable the
    // default per-wave base spawning and default missile spawning if the
    // level has its own. The presence of designed spawners completely
    // replaces the default glider waves; the presence of designed bases
    // replaces the default base spawning.
    const hasCustomBases = Array.isArray(level.bases) && level.bases.length > 0;
    const hasCustomSpawners = Array.isArray(level.spawners) && level.spawners.length > 0;
    if (hasCustomBases || hasCustomSpawners) {
      // Disable default base spawning — designed bases take over.
      CONFIG.BASE_SPAWN_ENABLED = false;
    }
    if (hasCustomSpawners) {
      // Disable default missile spawning — designed spawners take over.
      CONFIG.MISSILES_PER_WAVE_BASE = 0;
      CONFIG.MISSILES_PER_WAVE_INC = 0;
    }
    // Acquire wake lock.
    requestWakeLock();
    // Rebuild world for new grid size.
    this._fitCellSize();
    // Pre-stage the wrap vertical shift so _buildWorld → _initBackend
    // can see it during backend selection. We set it on a stash field
    // that _buildWorld reads when constructing the grid.
    this._pendingWrapVerticalShift =
      typeof level.wrapVerticalShift === 'number' ? level.wrapVerticalShift | 0 : 0;
    Logger.info(
      `[Game] Pre-staged wrapVerticalShift=${this._pendingWrapVerticalShift} ` +
        `before _buildWorld (level.wrapVerticalShift=${level.wrapVerticalShift}, ` +
        `typeof=${typeof level.wrapVerticalShift}).`
    );
    this._buildWorld();
    // Apply wrap vertical shift to the new grid.
    if (this.grid && typeof level.wrapVerticalShift === 'number') {
      this.grid.wrapVerticalShift = level.wrapVerticalShift | 0;
      Logger.info(
        `[Game] Applied wrapVerticalShift=${this.grid.wrapVerticalShift} to grid ` +
          `(level.wrapVerticalShift=${level.wrapVerticalShift}, ` +
          `grid.topologyId=${this.grid.topologyId}).`
      );
      // Force backend re-init now that wrap shift is set, so GPU→CPU
      // switch happens up-front rather than on first tick.
      if (this.simulation && this.simulation._initBackend) {
        Logger.info(
          `[Game] Forcing simulation backend re-init after wrap shift. ` +
            `Current backend=${this.simulation.backend.constructor.name}, ` +
            `grid.wrapVerticalShift=${this.grid.wrapVerticalShift}`
        );
        this.simulation._initBackend();
        this.simulation._syncWrapShiftToBackend();
        Logger.info(
          `[Game] Re-init complete: ` +
            `backend=${this.simulation.backend.constructor.name}, ` +
            `backend._wrapVerticalShift=${this.simulation.backend._wrapVerticalShift}, ` +
            `grid.wrapVerticalShift=${this.grid.wrapVerticalShift}`
        );
      }
    } else {
      Logger.info(
        `[Game] No wrapVerticalShift in level (type=${typeof level.wrapVerticalShift}, ` +
          `value=${level.wrapVerticalShift}).`
      );
    }
    this.renderer.setGrid(this.grid);
    this._initSpeedControls();
    this.defenses.maxInk = CONFIG.MAX_INK;
    this.defenses.reset();
    this.hud.reset();
    // Clear grid.
    this.grid.cells.fill(0);
    this.grid.pending.fill(0);
    this.grid.pendingDry.fill(0);
    this.grid.explosionTimers.fill(0);
    this.grid.cellAge.fill(0);
    this.grid.cellColor.fill(0);
    this.grid.cellDir.fill(0);
    if (this.simulation.returnFireFired) this.simulation.returnFireFired.fill(0);
    // Place custom cities (override default placement).
    this.cities.cities = [];
    this.grid.clearPending();
    for (const c of level.cities || []) {
      const city = { x: c.x, y: c.y, width: c.width, height: c.height, alive: true };
      this.cities.cities.push(city);
      for (let dy = 0; dy < city.height; dy++) {
        for (let dx = 0; dx < city.width; dx++) {
          this.grid.set(city.x + dx, city.y + dy, CELL_TYPE.CITY);
        }
      }
    }
    // Place custom defense cells.
    const defenseVariants = CONFIG.COLORS.DEFENSE_VARIANTS.length;
    for (const [x, y] of level.defenses || []) {
      if (this.grid.inBounds(x, y) && this.grid.get(x, y) === CELL_TYPE.EMPTY) {
        this.grid.set(x, y, CELL_TYPE.DEFENSE);
        const i = y * this.grid.width + this.grid.wrapX(x);
        this.grid.cellAge[i] = 1;
        this.grid.cellColor[i] = (Math.random() * defenseVariants) | 0;
      }
    }
    // Place custom barrier cells (static tiles, immune to Life rules).
    for (const [x, y] of level.barriers || []) {
      if (this.grid.inBounds(x, y) && this.grid.get(x, y) === CELL_TYPE.EMPTY) {
        this.grid.set(x, y, CELL_TYPE.BARRIER);
        const i = y * this.grid.width + this.grid.wrapX(x);
        this.grid.cellAge[i] = 0;
        this.grid.cellColor[i] = 0;
      }
    }
    // Place custom FIRE cells (static activated tiles — act as live
    // neighbors for Life rules, destroy missiles on contact, persist
    // forever).
    for (const [x, y] of level.fire || []) {
      if (this.grid.inBounds(x, y) && this.grid.get(x, y) === CELL_TYPE.EMPTY) {
        this.grid.set(x, y, CELL_TYPE.FIRE);
        const i = y * this.grid.width + this.grid.wrapX(x);
        this.grid.cellAge[i] = 0;
        this.grid.cellColor[i] = 0;
      }
    }
    // Inject custom-designed bases & spawners into the missiles module.
    this.missiles.setCustomBases(level.bases || []);
    this.missiles.setCustomSpawners(level.spawners || []);
    // Apply tool restrictions.
    if (this.drawTools) {
      if (level.allowedTools && typeof level.allowedTools === 'object') {
        this.drawTools.setLevelToolRestriction(level.allowedTools);
      } else {
        this.drawTools.setLevelToolRestriction(null);
      }
      if (Array.isArray(level.allowedPatterns) && level.allowedPatterns.length > 0) {
        this.drawTools.setLevelPatternRestriction(new Set(level.allowedPatterns));
      } else {
        this.drawTools.setLevelPatternRestriction(null);
      }
      // Auto-select the first enabled drawing tool.
      if (level.allowedTools) {
        const toolOrder = ['freehand', 'line', 'pattern', 'fill'];
        const firstEnabled = toolOrder.find((t) => level.allowedTools[t]);
        if (firstEnabled) {
          this.drawTools.setMode(firstEnabled);
        }
      }
      // Auto-select the first enabled pattern.
      if (Array.isArray(level.allowedPatterns) && level.allowedPatterns.length > 0) {
        const presetSelect = document.getElementById('pattern-presets');
        if (presetSelect) {
          const firstAllowed = level.allowedPatterns[0];
          // Verify it exists in the dropdown.
          const found = Array.from(presetSelect.options).some((o) => o.value === firstAllowed);
          if (found) {
            presetSelect.value = firstAllowed;
            presetSelect.dispatchEvent(new Event('change'));
          }
        }
      }
    }
    // Start wave 0. If the level has custom spawners, no default gliders
    // will spawn; otherwise default wave behavior takes over.
    this.missiles.startWave(0);
    this._announceWave(1);
    this.gameState.set(STATE.PLAYING);
    this.hideOverlay();
    // Show a banner indicating custom level is active.
    if (this.renderer && this.grid) {
      this.renderer.addBigFloater(
        Math.floor(this.grid.width / 2),
        Math.floor(this.grid.height / 3),
        `🛠 LEVEL: ${level.name}`,
        '#ffcc44',
        1.6
      );
    }
    // Install/uninstall abilities.
    if (this.freeplayAbilities) {
      this.freeplayAbilities.uninstall();
      this.freeplayAbilities.install();
    }
    Sfx.waveStart();
    // Apply starting speed from the level's settings snapshot. The level
    // may have a STARTING_SPEED value baked into its settings snapshot.
    // If absent, fall back to whatever CONFIG.STARTING_SPEED is (which
    // was just set when level.settings was applied above).
    let startSpeed = 1.0;
    if (level.settings && typeof level.settings.STARTING_SPEED === 'number') {
      startSpeed = level.settings.STARTING_SPEED;
      Logger.info(`[Game] Using STARTING_SPEED from level.settings: ${startSpeed}x`);
    } else if (typeof CONFIG.STARTING_SPEED === 'number') {
      startSpeed = CONFIG.STARTING_SPEED;
      Logger.info(`[Game] Using STARTING_SPEED from CONFIG fallback: ${startSpeed}x`);
    }
    // CRITICAL: write to CONFIG so the slider sync reads the correct value.
    CONFIG.SPEED_MULTIPLIER = startSpeed;
    Logger.info(
      `[Game] Custom level "${level.name}" starting speed: ${startSpeed}x ` +
        `(from ${level.settings && level.settings.STARTING_SPEED != null ? 'level' : 'fallback'})`
    );
    if (this.speedSlider) {
      const startIdx = SPEED_PRESETS.findIndex((p) => p.value === startSpeed);
      // If exact speed not in presets, pick the closest one.
      let idx;
      if (startIdx >= 0) {
        idx = startIdx;
      } else {
        // Find closest preset to startSpeed.
        let bestIdx = SPEED_PRESETS.findIndex((p) => p.value === 1.0);
        let bestDiff = Infinity;
        SPEED_PRESETS.forEach((p, i) => {
          const diff = Math.abs(p.value - startSpeed);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
          }
        });
        idx = bestIdx;
      }
      this.speedSlider.value = String(idx);
      this._applySpeedFromSlider();
      // The slider may snap to a preset value that differs from
      // the requested startSpeed. Force CONFIG.SPEED_MULTIPLIER back
      // to the exact requested value, overriding _applySpeedFromSlider.
      CONFIG.SPEED_MULTIPLIER = startSpeed;
      if (this.speedLabel) {
        const matched = SPEED_PRESETS[idx];
        if (matched && matched.value === startSpeed) {
          this.speedLabel.textContent = matched.name;
        } else {
          this.speedLabel.textContent = startSpeed === 0 ? 'Paused' : `${startSpeed}x (custom)`;
        }
      }
      // If starting paused, remember 1x so Space resumes to normal speed.
      if (startSpeed === 0) {
        this._prePauseIdx = SPEED_PRESETS.findIndex((p) => p.value === 1.0);
      }
      Logger.info(
        `[Game] Speed slider set to idx=${idx}, label="${SPEED_PRESETS[idx].name}", ` +
          `final CONFIG.SPEED_MULTIPLIER=${CONFIG.SPEED_MULTIPLIER}x`
      );
    }
    return true;
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
    this._customVictoryShown = false;
    // Strip any ?level= / ?autostart= query params from the URL so a
    // reload from the menu doesn't re-enter the level the user just
    // exited from.
    try {
      const url = new URL(window.location.href);
      let changed = false;
      if (url.searchParams.has('level')) {
        url.searchParams.delete('level');
        changed = true;
      }
      if (url.searchParams.has('autostart')) {
        url.searchParams.delete('autostart');
        changed = true;
      }
      if (changed) {
        const newHref = url.pathname + (url.search ? url.search : '') + url.hash;
        window.history.replaceState({}, '', newHref);
        Logger.info('Cleared level/autostart query params from URL.');
      }
    } catch (e) {
      Logger.warn('Failed to clean URL on exit:', e);
    }
    // Strip any ?level= (and ?autostart=) query param from the URL so a
    // page reload from the menu doesn't immediately re-enter the level.
    try {
      const url = new URL(window.location.href);
      let changed = false;
      if (url.searchParams.has('level')) {
        url.searchParams.delete('level');
        changed = true;
      }
      if (url.searchParams.has('autostart')) {
        url.searchParams.delete('autostart');
        changed = true;
      }
      if (changed) {
        const newHref = url.pathname + (url.search ? url.search : '') + url.hash;
        window.history.replaceState({}, '', newHref);
        Logger.info('Cleared level/autostart query params from URL.');
      }
    } catch (e) {
      Logger.warn('Failed to clean URL on exit:', e);
    }
    // Restore default colors if a custom level was active.
    if (this._defaultColors) {
      Object.assign(CONFIG.COLORS, this._defaultColors);
      this._defaultColors = null;
    }
    // Clear any level-imposed tool/pattern restrictions.
    if (this.drawTools) {
      this.drawTools.setLevelToolRestriction(null);
      this.drawTools.setLevelPatternRestriction(null);
    }
    this._activeCustomLevel = null;
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
    // Re-render the curated level list (overlay content was rewritten).
    initLevelCatalog();
  }

  startGame() {
    Logger.info('Starting game.');
    Sfx.waveStart();
    // Clear any active custom level state — default game mode is starting.
    this._activeCustomLevel = null;
    this._customVictoryShown = false;
    // Restore default colors if a custom level had overridden them.
    if (this._defaultColors) {
      Object.assign(CONFIG.COLORS, this._defaultColors);
      this._defaultColors = null;
    }
    // Clear level-imposed tool/pattern restrictions.
    if (this.drawTools) {
      this.drawTools.setLevelToolRestriction(null);
      this.drawTools.setLevelPatternRestriction(null);
    }
    // Clear custom bases/spawners from missiles module.
    if (this.missiles) {
      this.missiles.setCustomBases([]);
      this.missiles.setCustomSpawners([]);
    }
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
    this._announceWave(1);
    this.gameState.set(STATE.PLAYING);
    this.hideOverlay();
    // Apply starting speed from CONFIG.STARTING_SPEED. This must happen AFTER
    // settings.apply() above, so it picks up any user-configured starting speed.
    const startSpeed = CONFIG.STARTING_SPEED != null ? CONFIG.STARTING_SPEED : 1.0;
    CONFIG.SPEED_MULTIPLIER = startSpeed;
    Logger.info(`[Game] Default game starting speed: ${startSpeed}x`);
    if (this.speedSlider) {
      const startIdx = SPEED_PRESETS.findIndex((p) => p.value === startSpeed);
      let idx;
      if (startIdx >= 0) {
        idx = startIdx;
      } else {
        // Find closest preset.
        let bestIdx = SPEED_PRESETS.findIndex((p) => p.value === 1.0);
        let bestDiff = Infinity;
        SPEED_PRESETS.forEach((p, i) => {
          const diff = Math.abs(p.value - startSpeed);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
          }
        });
        idx = bestIdx;
      }
      this.speedSlider.value = String(idx);
      this._applySpeedFromSlider();
      if (startSpeed === 0) {
        this._prePauseIdx = SPEED_PRESETS.findIndex((p) => p.value === 1.0);
      }
      Logger.info(
        `[Game] Speed slider set to idx=${idx} (${SPEED_PRESETS[idx].name}), ` +
          `CONFIG.SPEED_MULTIPLIER=${CONFIG.SPEED_MULTIPLIER}x`
      );
    }
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
    this._announceWave(this.hud.wave);
    this.gameState.set(STATE.PLAYING);
  }
  // Show a dramatic floater banner announcing the start of a wave.
  _announceWave(waveNum) {
    if (!this.renderer || !this.grid) return;
    const cx = Math.floor(this.grid.width / 2);
    const cy = Math.floor(this.grid.height / 4);
    // Pick a color that escalates with wave number.
    const colors = ['#00ffff', '#00ffaa', '#88ff44', '#ffcc44', '#ff8844', '#ff4444', '#ff44ff'];
    const color = colors[Math.min(waveNum - 1, colors.length - 1)];
    this.renderer.addBigFloater(cx, cy - 3, `◆ WAVE ${waveNum} ◆`, color, 2.4);
    this.renderer.addBigFloater(cx, cy, 'INCOMING!', color, 1.6);
    // Add a dramatic shockwave ring.
    this.renderer.addShockwave(cx, cy - 1, {
      maxRadius: 120,
      color,
      ttl: 50,
      width: 4,
    });
    // Particle burst.
    this.renderer.addParticleBurst(cx, cy, {
      count: 40,
      colors: [color, '#ffffff', '#ffcc44'],
      speed: 3.0,
      ttl: 60,
      size: 3.0,
      glow: 14,
    });
    this.renderer.addShake(3, 18);
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
    // If this was a custom level, override "Play Again" to replay the level
    // rather than fall back to the default game mode.
    const wasCustomLevel = this._activeCustomLevel;
    const customLevelName = wasCustomLevel ? wasCustomLevel.name : null;
    this.showOverlay(
      'Game Over',
      `All cities destroyed!<br><br>
                 Final Score: <strong>${this.hud.score}</strong><br>
                 Wave Reached: ${this.hud.wave}<br>
                 High Score: ${this.hud.highScore}`,
      'Play Again'
    );
    if (customLevelName) {
      // Replace the start button handler temporarily to replay the level.
      const btn = this.startButton;
      const origHandler = btn.onclick;
      btn.onclick = () => {
        btn.onclick = origHandler;
        this.startCustomLevel(customLevelName);
      };
    }
  }

  _loop(time) {
    try {
      const dt = time - this.lastTime;
      this.lastTime = time;
      // Guard against pathological dt values (e.g. tab backgrounding can
      // produce huge gaps that would cause hundreds of sim ticks to run).
      const safeDt = Math.max(0, Math.min(dt, 500));

      if (this.gameState.is(STATE.PLAYING)) {
        this._update(safeDt);
      }

      this.hud.citiesAlive = this.cities.aliveCount();
      this.hud.ink = this.defenses.ink;
      this.hud.maxInk = this.defenses.maxInk;
      // Drive story progression each frame.
      if (this.story) this.story.update(safeDt);
      // Tick free-play ability cooldowns.
      if (this.freeplayAbilities && !(this.story && this.story.isActive())) {
        this.freeplayAbilities.update(safeDt);
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
      // Custom levels: when all designed threats are eliminated, show
      // a victory banner instead of looping forever through empty waves.
      if (this._activeCustomLevel) {
        this._customLevelVictory();
      } else {
        this.nextWave();
      }
    }
  }
  _customLevelVictory() {
    if (this._customVictoryShown) return;
    this._customVictoryShown = true;
    Logger.info('[Game] Custom level victory!');
    Sfx.waveStart();
    // Bonus score for surviving cities + remaining ink.
    this.hud.addScore(this.cities.aliveCount() * 500);
    this.hud.addScore((Math.floor(this.defenses.ink) * 1.0) | 0);
    releaseWakeLock();
    this.gameState.set(STATE.GAME_OVER);
    const levelName = this._activeCustomLevel.name || 'Custom Level';
    const customLevelToReplay = this._activeCustomLevel.name;
    this.showOverlay(
      '🏆 VICTORY!',
      `You completed <strong>${levelName}</strong>!<br><br>
       All enemy structures destroyed.<br><br>
       Cities saved: <strong>${this.cities.aliveCount()}</strong><br>
       Final Score: <strong>${this.hud.score}</strong><br>
       High Score: ${this.hud.highScore}`,
      'Play Again'
    );
    // Replace start button handler to replay the same custom level.
    const btn = this.startButton;
    const origHandler = btn.onclick;
    btn.onclick = () => {
      btn.onclick = origHandler;
      this._customVictoryShown = false;
      if (customLevelToReplay) {
        this.startCustomLevel(customLevelToReplay);
      } else {
        this.exitToMenu();
      }
    };
    // Add a secondary "Back to Menu" link in the overlay message.
    setTimeout(() => {
      const msg = this.overlayMessage;
      if (msg && !msg.querySelector('.victory-menu-link')) {
        const link = document.createElement('div');
        link.className = 'victory-menu-link';
        link.style.cssText = 'margin-top:16px;';
        link.innerHTML =
          '<a href="#" style="color:#88aaff;text-decoration:underline;font-size:13px;">← Back to Main Menu</a>';
        link.querySelector('a').addEventListener('click', (e) => {
          e.preventDefault();
          btn.onclick = origHandler;
          this._customVictoryShown = false;
          this.exitToMenu();
        });
        msg.appendChild(link);
      }
    }, 0);
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
    // Load level from URL param (?level=<encoded-url>) if present.
    checkLevelUrlParam((levelName) => {
      if (window.game && window.game.startCustomLevel) {
        window.game.startCustomLevel(levelName);
      }
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
