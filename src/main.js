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
import { initLevelCatalog } from './levelCatalog.js';
import { countCells } from './sim/cellCounts.js';
import { AbilitiesMenu } from './abilitiesMenu.js';
import { ScoreManager } from './scoring.js';
import { MissileDefenderMode } from './game/missileDefender.js';
import { SpaceInvadersMode } from './game/spaceInvadersMode.js';
import { releaseWakeLock } from './pwa.js';
import { getRuleset, getNeighborhood } from './rules/index.js';

// Extracted helpers.
import { startCustomLevel as startCustomLevelImpl } from './customLevelLoader.js';
import { makeCheats } from './cheats.js';
import { installEpilepsyGate } from './bootstrap.js';
import {
  initKeyboardShortcuts,
  initHotkeyHelp,
  toggleHotkeyHelp,
  initPanControls,
} from './hotkeys.js';
import {
  initTimeControl,
  initGameMenu,
  initInlineZooButton,
  wirePatternModeZooVisibility,
} from './gameMenu.js';
import { wireMenuTabs, activateMenuTab, relocateLevelCatalog } from './menuOverlay.js';
import { wireSimCallbacks } from './simCallbacks.js';
import { processUrlParams } from './urlParams.js';

class Game {
  constructor() {
    Logger.info('Game initializing...');
    this.settings = new Settings();
    this._fitCellSize();

    this.canvas = document.getElementById('game-canvas');
    this.overlay = document.getElementById('overlay');
    this.overlayTitle = document.getElementById('overlay-title');
    this.overlayMessage = document.getElementById('overlay-message');
    this.startButton = document.getElementById('start-button');
    this.thresholdDisplay = document.getElementById('threshold-display');
    this.thresholdCityCount = document.getElementById('threshold-city-count');
    this.thresholdCityMin = document.getElementById('threshold-city-min');
    this.thresholdEnemyCount = document.getElementById('threshold-enemy-count');
    this.thresholdEnemyMax = document.getElementById('threshold-enemy-max');
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
    this.patternZooButton = document.getElementById('pattern-zoo-button');
    this.patternZooIngameButton = document.getElementById('pattern-zoo-ingame-button');
    this.levelDesignerButton = document.getElementById('level-designer-button');
    this.levelDesignerIngameButton = document.getElementById('level-designer-ingame-button');
    this.motd = 'Play The Game of Life like classic arcade games!';

    this._buildWorld();

    this.renderer = new Renderer(this.canvas, this.grid);
    this.renderer.setInput(this.input);
    this.hud = new HUD();
    this.score = new ScoreManager(this.hud, this.renderer, this.grid);
    this.gameState = new GameState();
    this.settingsPanel = new SettingsPanel(this.settings, {
      onClose: () => {
        if (this.gameState.is(STATE.MENU) || this.gameState.is(STATE.GAME_OVER)) {
          this.overlay.classList.remove('hidden');
        }
        try {
          const ruleDef = getRuleset(CONFIG.ACTIVE_RULESET || 'conway');
          const newNbhd =
            ruleDef && ruleDef.neighborhood ? getNeighborhood(ruleDef.neighborhood) : null;
          const newTopology = newNbhd && newNbhd.topology ? newNbhd.topology : 'square';
          if (newTopology !== (this.grid.topologyId || 'square')) {
            Logger.info(`Topology changed to "${newTopology}"; rebuilding world.`);
            this._buildWorld();
            this.renderer.setGrid(this.grid);
          } else if (this.simulation) {
            const desiredRuleId = CONFIG.ACTIVE_RULESET || 'conway';
            if (this.simulation._ruleId !== desiredRuleId) {
              Logger.info(
                `Ruleset changed to "${desiredRuleId}"; rebuilding world to force grid replacement.`
              );
              this._buildWorld();
              this.renderer.setGrid(this.grid);
              if (this.gameState.is(STATE.PLAYING)) {
                this.cities.place();
                this.missiles.startWave(Math.max(0, this.hud.wave - 1));
              }
            }
          }
        } catch (e) {
          Logger.warn('Topology check failed on settings close', e);
        }
      },
      onResolutionChange: () => {
        this._fitCellSize();
        this._buildWorld();
        this.renderer.setGrid(this.grid);
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
        this._guidePrevOverlayHidden = this.overlay.classList.contains('hidden');
        this.overlay.classList.add('hidden');
        this._guidePauseSpeed = CONFIG.SPEED_MULTIPLIER;
        CONFIG.SPEED_MULTIPLIER = 0;
        if (this.speedLabel) this.speedLabel.textContent = 'PAUSED (guide)';
      },
      onClose: () => {
        if (this._guidePauseSpeed != null) {
          CONFIG.SPEED_MULTIPLIER = this._guidePauseSpeed;
          this._guidePauseSpeed = null;
        }
        if (this.speedSlider) this._applySpeedFromSlider();
        if (
          !this._guidePrevOverlayHidden &&
          (this.gameState.is(STATE.MENU) || this.gameState.is(STATE.GAME_OVER))
        ) {
          this.overlay.classList.remove('hidden');
        }
      },
    });
    this._helpPanelPauseSpeed = null;
    this.helpGuidePanel = new GuidePanel({
      overlayId: 'help-overlay',
      bodyId: 'help-body',
      closeId: 'help-close-button',
      markdownUrl: './play_guide.md',
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

    this.drawTools = new DrawToolsPanel(this.input);
    this.patternCapture = new PatternCapture({
      game: this,
      canvas: this.canvas,
      drawTools: this.drawTools,
    });
    this.drawTools.patternCapture = this.patternCapture;
    this.patternZoo = new PatternZoo({ game: this });
    this.levelDesigner = new LevelDesigner({ game: this });
    this._activeCustomLevel = null;
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
    this.story = new StoryEngine({
      game: this,
      settings: this.settings,
      drawTools: this.drawTools,
    });
    this.drawTools.storyEngine = this.story;
    this.freeplayAbilities = new FreeplayAbilityManager(this);
    this.missileDefenderMode = new MissileDefenderMode(this);
    this.spaceInvadersMode = new SpaceInvadersMode(this);

    this.lastTime = 0;
    this._defAccum = 0;
    this._attAccum = 0;
    this._frameErrorCount = 0;
    this._MAX_FRAME_ERRORS = 10;
    this._godMode = false;

    this._wireSimCallbacks();
    this._wireInput();

    this.startButton.addEventListener('click', () => this.startGame());
    this.settingsButton.addEventListener('click', () => this.openSettings());
    if (this.clearDefensesButton) {
      this.clearDefensesButton.addEventListener('click', () => this._onClearDefenses());
    }
    if (this.helpButton) this.helpButton.addEventListener('click', () => this.openGuide());
    if (this.guideButton) this.guideButton.addEventListener('click', () => this.openGuide());
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
    this._wirePatternCaptureButton();

    initTimeControl(this);
    initGameMenu(this);
    this.abilitiesMenu = new AbilitiesMenu(this);
    initInlineZooButton(this);
    wirePatternModeZooVisibility(this);
    initKeyboardShortcuts(this);
    initHotkeyHelp(this);
    initPanControls(this);
    this._initThresholdSettingsInputs();
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
    );
    this.showOverlay('The Arcade of Life', this.motd, '🚀 Missile Defender');
    initLevelCatalog();
    this._relocateLevelCatalog();
    Logger.info(
      `Game initialized. Grid ${CONFIG.GRID_WIDTH}x${CONFIG.GRID_HEIGHT}, cell ${CONFIG.CELL_SIZE}px.`
    );
    this._exposeGlobals();
    this._printHackBanner();
    // Process URL parameters once everything is wired up. This may
    // open panels, switch modes, or start levels based on the query
    // string. Deferred slightly so DOM is fully ready.
    setTimeout(() => {
      try {
        processUrlParams(this);
      } catch (e) {
        Logger.warn('[Game] processUrlParams failed', e);
      }
    }, 50);

    requestAnimationFrame(this._loop.bind(this));
  }

  // ---- Hackability: console-friendly globals & cheats --------------------
  _exposeGlobals() {
    window.game = this;
    window.MD = {
      game: this,
      CONFIG,
      CELL_TYPE,
      SPEED_PRESETS,
      RESOLUTION_PRESETS,
      GAME_MODE_PRESETS,
      Logger,
      classes: { Grid, Simulation, Cities, Missiles, Defenses, Renderer, HUD },
    };
    if (this.missiles && this.simulation) {
      this.missiles.markAnchor = (x, y) => this.simulation.markAnchor(x, y);
      this.missiles.stampAnchoredCell = (x, y, type, colorIdx) =>
        this.simulation.stampAnchoredCell(x, y, type, colorIdx);
    }
    window.CONFIG = CONFIG;
    window.CELL_TYPE = CELL_TYPE;
    window.SPEED_PRESETS = SPEED_PRESETS;
    this.cheats = makeCheats(this);
    window.cheats = this.cheats;
  }

  _printHackBanner() {
    const css = 'color:#00ffff;font-weight:bold;';
    console.log('%c[ArcadeOfLife] Console API ready.', css);
    console.log('  window.game        - live Game instance');
    console.log('  window.CONFIG      - live config (mutate to tune)');
    console.log('  window.CELL_TYPE   - {EMPTY, DEFENSE, MISSILE, CITY, EXPLOSION}');
    console.log('  window.cheats      - cheat shortcuts (try cheats.help())');
    console.log('  window.MD          - namespaced bundle');
    console.log('  ArcadeOfLifeLogger.setLevel("debug") for verbose logs');
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
    this._initSpeedControls();
    Logger.info(`World rebuilt: ${CONFIG.GRID_WIDTH}x${CONFIG.GRID_HEIGHT}.`);
  }

  _initThresholdSettingsInputs() {
    const wire = (sliderId, valueId, configKey, fmt) => {
      const slider = document.getElementById(sliderId);
      const label = document.getElementById(valueId);
      if (!slider) return;
      slider.value = String(CONFIG[configKey] | 0);
      if (label) label.textContent = fmt(parseInt(slider.value, 10));
      slider.addEventListener('input', () => {
        const v = parseInt(slider.value, 10) | 0;
        CONFIG[configKey] = v;
        if (label) label.textContent = fmt(v);
        if (this.settings && this.settings.values) {
          this.settings.values[configKey] = v;
          if (this.settings.save) {
            try {
              this.settings.save();
            } catch (_e) {
              /* ignore */
            }
          }
        }
      });
    };
    wire(
      'setting-victory-threshold',
      'setting-victory-threshold-value',
      'VICTORY_ENEMY_THRESHOLD',
      (v) => `${v} cells`
    );
    wire(
      'setting-defeat-threshold',
      'setting-defeat-threshold-value',
      'DEFEAT_CITY_THRESHOLD',
      (v) => `${v} cells`
    );
  }

  _onClearDefenses() {
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
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (this.patternCapture && this.patternCapture._nameDialog) return;
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
    let topologyId = 'square';
    try {
      const ruleDef = getRuleset(CONFIG.ACTIVE_RULESET || 'conway');
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
    if (!this.defenses) this.defenses = new Defenses();
    else this.defenses.maxInk = CONFIG.MAX_INK;

    const prevInput = this.input;
    if (this.input) {
      this.input.cancelDrawing();
      if (typeof this.input.destroy === 'function') {
        try {
          this.input.destroy();
        } catch (e) {
          Logger.warn('[Game] InputManager.destroy() failed', e);
        }
      }
    }
    this.input = new InputManager(this.canvas, this.grid, this.defenses);
    if (prevInput) {
      this.input.setMode(prevInput.mode);
      this.input.setLineWidth(prevInput.lineWidth);
      this.input.setDashPattern(prevInput.dashPattern);
      this.input.pattern = new Set(prevInput.pattern);
      this.input.patternRotation = prevInput.patternRotation;
      this.input.patternFlipH = prevInput.patternFlipH;
      this.input.patternFlipV = prevInput.patternFlipV;
    }
    if (this.renderer) this.renderer.setInput(this.input);
    if (this.drawTools) this.drawTools.input = this.input;
    this._wireSimCallbacks();
    this._wireInput();
  }

  _wireSimCallbacks() {
    wireSimCallbacks(this);
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
    const reservedH = CONFIG.HUD_HEIGHT + 200;
    const reservedW = 24;
    const availW = Math.max(200, window.innerWidth - reservedW);
    const availH = Math.max(200, window.innerHeight - reservedH);
    let topologyId = 'square';
    try {
      const ruleDef = getRuleset(CONFIG.ACTIVE_RULESET || 'conway');
      const nbhd =
        ruleDef && ruleDef.neighborhood && !ruleDef._exoticType
          ? getNeighborhood(ruleDef.neighborhood)
          : null;
      if (nbhd && nbhd.topology) topologyId = nbhd.topology;
    } catch (_e) {
      /* default square */
    }
    let sizeByW, sizeByH;
    if (topologyId === 'hex') {
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
    if (size < 1) size = 1;
    if (size > 16) size = 16;
    CONFIG.CELL_SIZE = size;
  }

  _onWindowResize() {
    const old = CONFIG.CELL_SIZE;
    const idx = this.settings.values.RESOLUTION_INDEX | 0;
    const preset = RESOLUTION_PRESETS[idx];
    if (preset && preset.auto) {
      const dims = computeAutoGrid();
      if (dims.width !== CONFIG.GRID_WIDTH || dims.height !== CONFIG.GRID_HEIGHT) {
        const oldGrid = this.grid;
        const oldW = oldGrid.width;
        const oldH = oldGrid.height;
        if (this.input) this.input.cancelDrawing();
        CONFIG.GRID_WIDTH = dims.width;
        CONFIG.GRID_HEIGHT = dims.height;
        this._fitCellSize();
        this._buildWorld();
        const newW = this.grid.width;
        const newH = this.grid.height;
        const copyW = Math.min(oldW, newW);
        const copyH = Math.min(oldH, newH);
        const srcYOff = oldH - copyH;
        const dstYOff = newH - copyH;
        const sameTopology = oldGrid.topologyId === this.grid.topologyId;
        if (!sameTopology) {
          Logger.warn('Topology changed during resize; skipping state copy.');
          if (this.renderer) this.renderer.setGrid(this.grid);
          return;
        }
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
    if (this.timeControl) {
      const cells = (CONFIG.GRID_WIDTH | 0) * (CONFIG.GRID_HEIGHT | 0);
      this.timeControl.recapForGrid(cells);
    }
  }

  _applySpeedFromSlider() {
    if (this.timeControl) this.timeControl.refresh();
  }

  // Advance the simulation by exactly one tick. Only meaningful when paused.
  stepForward() {
    if (!this.gameState.is(STATE.PLAYING) && !this.gameState.is(STATE.WAVE_TRANSITION)) return;
    if (CONFIG.SPEED_MULTIPLIER > 0) {
      Logger.info('Step-forward requested but game is not paused; ignoring.');
      return;
    }
    const syntheticDt = CONFIG.TICK_RATE;
    CONFIG.SPEED_MULTIPLIER = 1.0;
    this.missiles.update(syntheticDt);
    this.grid.tickPendingDry();
    this.simulation.freezeEnemies = false;
    this.simulation.freezeDefenses = false;
    this.simulation.tick();
    this.cities.update();
    this.defenses.regen(CONFIG.INK_REGEN_RATE);
    if (this.cities.aliveCount() === 0) {
      this.gameOver();
    } else if (this.missiles.isWaveComplete()) {
      this.nextWave();
    }
    CONFIG.SPEED_MULTIPLIER = 0;
    if (this.speedLabel) this.speedLabel.textContent = 'Paused';
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
    if (this.timeControl) this.timeControl.setIndex(idx);
  }

  _toggleHotkeyHelp(force) {
    toggleHotkeyHelp(this, force);
  }

  showOverlay(title, message, buttonText) {
    this.overlayTitle.innerHTML = title;
    if (this.overlayMessage) this.overlayMessage.innerHTML = message;
    this.startButton.textContent = buttonText;
    this.overlay.classList.remove('hidden');
    wireMenuTabs(this);
    activateMenuTab('play');
  }

  _wireMenuTabs() {
    wireMenuTabs(this);
  }
  _activateMenuTab(id) {
    activateMenuTab(id);
  }
  _relocateLevelCatalog() {
    relocateLevelCatalog();
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
    this._zooPrevOverlayHidden = this.overlay.classList.contains('hidden');
    this.overlay.classList.add('hidden');
    const origHide = this.patternZoo.hide.bind(this.patternZoo);
    this.patternZoo.hide = () => {
      origHide();
      this.patternZoo.hide = origHide;
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
    if (levelName) this.startCustomLevel(levelName);
    else this.startGame();
  }

  startCustomLevel(levelName) {
    return startCustomLevelImpl(this, levelName);
  }

  openIngameSettings() {
    if (!CONFIG.IN_PLAY_SETTINGS_ENABLED) {
      Logger.info('In-play settings are disabled via CONFIG.IN_PLAY_SETTINGS_ENABLED.');
      return;
    }
    if (this.gameState.is(STATE.MENU) || this.gameState.is(STATE.GAME_OVER)) {
      this.openSettings();
      return;
    }
    this._ingameSettingsStashedSpeed = CONFIG.SPEED_MULTIPLIER;
    CONFIG.SPEED_MULTIPLIER = 0;
    if (this.speedLabel) this.speedLabel.textContent = 'PAUSED (settings)';
    const origOnClose = this.settingsPanel.onClose;
    this.settingsPanel.onClose = () => {
      if (this._ingameSettingsStashedSpeed != null) {
        CONFIG.SPEED_MULTIPLIER = this._ingameSettingsStashedSpeed;
        this._ingameSettingsStashedSpeed = null;
      }
      if (this.speedSlider) this._applySpeedFromSlider();
      this.settingsPanel.onClose = origOnClose;
    };
    this.settingsPanel.show();
  }

  _updateIngameSettingsButton() {
    if (!this.ingameSettingsButton) return;
    this.ingameSettingsButton.style.display = CONFIG.IN_PLAY_SETTINGS_ENABLED ? '' : 'none';
  }

  exitToMenu() {
    const inGame = this.gameState.is(STATE.PLAYING) || this.gameState.is(STATE.WAVE_TRANSITION);
    if (inGame) {
      const confirmed = window.confirm('Exit to main menu? Your current game will be lost.');
      if (!confirmed) return;
    }
    Logger.info('Exiting to main menu.');
    this._customVictoryShown = false;
    try {
      const url = new URL(window.location.href);
      let changed = false;
      if (url.searchParams.has('level')) {
        url.searchParams.delete('level');
        changed = true;
      }
      if (url.searchParams.has('mode')) {
        url.searchParams.delete('mode');
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
    if (this._defaultColors) {
      Object.assign(CONFIG.COLORS, this._defaultColors);
      this._defaultColors = null;
    }
    if (this.drawTools) {
      this.drawTools.setLevelToolRestriction(null);
      this.drawTools.setLevelPatternRestriction(null);
    }
    this._activeCustomLevel = null;
    if (this.story && this.story.isActive()) this.story.stopStory();
    if (this.spaceInvadersMode && this.spaceInvadersMode.active) this.spaceInvadersMode.stop();
    if (this.freeplayAbilities) this.freeplayAbilities.uninstall();
    releaseWakeLock();
    if (this.input) this.input.cancelDrawing();
    CONFIG.SPEED_MULTIPLIER = 1.0;
    if (this.speedSlider) {
      const idx = SPEED_PRESETS.findIndex((p) => p.value === 1.0);
      this.speedSlider.value = String(idx >= 0 ? idx : 3);
      this._applySpeedFromSlider();
    }
    if (this.grid) {
      this.grid.cells.fill(0);
      this.grid.pending.fill(0);
      this.grid.pendingDry.fill(0);
      this.grid.explosionTimers.fill(0);
      this.grid.cellAge.fill(0);
      this.grid.cellColor.fill(0);
      this.grid.cellDir.fill(0);
    }
    this.gameState.set(STATE.MENU);
    if (this.thresholdDisplay) this.thresholdDisplay.classList.add('hidden');
    document
      .querySelectorAll('#overlay-content > .level-catalog-section')
      .forEach((el) => el.remove());
    const mount = document.getElementById('menu-level-catalog-mount');
    if (mount) {
      while (mount.firstChild) mount.removeChild(mount.firstChild);
    }
    this.showOverlay('The Arcade of Life', this.motd, '🚀 Missile Defender');
    initLevelCatalog();
    this._relocateLevelCatalog();
  }

  startGame() {
    this.missileDefenderMode.start();
  }

  /**
   * If the current settings are non-standard (excluding board size),
   * prompt the user to choose: reset to defaults, keep current, or cancel.
   */
  _checkAndPromptForReset(modeName) {
    if (!this.settings) return true;
    if (this.startButton && this.startButton.textContent === 'Play Again') {
      Logger.info(
        '[Game] Detected "Play Again" state on start button, skipping reset prompt for custom level replay.'
      );
      return true;
    }
    const nonDefaults = this.settings.getNonDefaultKeys();
    if (nonDefaults.length === 0) return true;
    Logger.info(
      `[Game] ${modeName} requested with ${nonDefaults.length} non-default ` +
        `setting(s): ${nonDefaults.slice(0, 8).join(', ')}` +
        (nonDefaults.length > 8 ? `, +${nonDefaults.length - 8} more` : '')
    );
    const msg =
      `Your current configuration has ${nonDefaults.length} non-default ` +
      `setting(s) (game mode, ruleset, ink, waves, abilities, etc.).\n\n` +
      `Reset to default configuration before starting ${modeName}?\n\n` +
      `• OK    = Reset to defaults (board size preserved)\n` +
      `• Cancel = Keep current settings`;
    const shouldReset = window.confirm(msg);
    if (shouldReset) {
      Logger.info(`[Game] User chose to reset settings before ${modeName}.`);
      this.settings.resetExceptBoardSize();
      if (this.settingsPanel && this.settingsPanel._syncInputs) {
        try {
          this.settingsPanel._syncInputs();
          if (this.settingsPanel._syncGameModeSelect) this.settingsPanel._syncGameModeSelect();
          if (this.settingsPanel._syncUnlimitedCheckboxes) {
            this.settingsPanel._syncUnlimitedCheckboxes();
          }
        } catch (e) {
          Logger.warn('[Game] Settings panel re-sync failed after reset', e);
        }
      }
    } else {
      Logger.info(`[Game] User chose to keep current settings for ${modeName}.`);
      try {
        this.settings.apply();
        Logger.info('[Game] Re-applied current settings to CONFIG after keep choice.');
      } catch (e) {
        Logger.warn('[Game] settings.apply() failed in keep-current path', e);
      }
    }
    return true;
  }

  nextWave() {
    this.missileDefenderMode.nextWave();
  }
  _announceWave(waveNum) {
    this.missileDefenderMode.announceWave(waveNum);
  }
  _clearFriendlyOutsideDrawZone() {
    this.missileDefenderMode.clearFriendlyOutsideDrawZone();
  }
  gameOver() {
    this.missileDefenderMode.gameOver();
  }

  _loop(time) {
    try {
      const dt = time - this.lastTime;
      this.lastTime = time;
      const safeDt = Math.max(0, Math.min(dt, 500));

      if (this.gameState.is(STATE.PLAYING)) {
        this._update(safeDt);
      }

      this.hud.citiesAlive = this.cities.aliveCount();
      this.hud.ink = this.defenses.ink;
      this.hud.maxInk = this.defenses.maxInk;
      try {
        const counts = countCells(this.grid);
        this.hud.cityCellCount = counts.cityCells;
        this.hud.enemyCellCount = counts.enemyCellsInEnemyRegion;
        this._updateThresholdDisplay(counts);
      } catch (e) {
        Logger.warn('countCells failed', e);
      }
      if (this.story) this.story.update(safeDt);
      if (this.spaceInvadersMode && this.spaceInvadersMode.active) {
        this.spaceInvadersMode.update();
      }
      if (this.freeplayAbilities && !(this.story && this.story.isActive())) {
        this.freeplayAbilities.update(safeDt);
      }
      if (this.score) this.score.update(safeDt);

      this.renderer.render(this.hud);
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
        return;
      }
    }
    requestAnimationFrame(this._loop.bind(this));
  }

  _update(dt) {
    const speed = CONFIG.SPEED_MULTIPLIER;
    if (speed <= 0) {
      this.grid.tickPendingDry();
      if (this.spaceInvadersMode && this.spaceInvadersMode.active) {
        this.spaceInvadersMode.update();
      }
      return;
    }

    const scaledDt = dt * speed;

    const M_for_spawn = Math.max(1, CONFIG.DEFENDER_TICKS | 0);
    const N_for_spawn = Math.max(1, CONFIG.ATTACKER_TICKS | 0);
    const spawnDtScale = N_for_spawn / Math.max(M_for_spawn, N_for_spawn);
    this.missiles.update(scaledDt * spawnDtScale);

    const M = Math.max(1, CONFIG.DEFENDER_TICKS | 0);
    const N = Math.max(1, CONFIG.ATTACKER_TICKS | 0);
    const defPeriod = CONFIG.TICK_RATE / M;
    const attPeriod = CONFIG.TICK_RATE / N;

    this._defAccum = (this._defAccum || 0) + scaledDt;
    this._attAccum = (this._attAccum || 0) + scaledDt;

    const MAX_TICKS_PER_FRAME = 64;
    let ticks = 0;
    while (ticks < MAX_TICKS_PER_FRAME) {
      const defDue = this._defAccum >= defPeriod;
      const attDue = this._attAccum >= attPeriod;
      if (!defDue && !attDue) break;
      const tickDef = defDue;
      const tickAtt = attDue;

      this.grid.tickPendingDry();

      const timeStopActive =
        (this.story && this.story._timeStopUntil > 0) || this._freezeTimer != null;
      this.simulation.freezeEnemies = !tickAtt || timeStopActive;
      this.simulation.freezeDefenses = !tickDef;

      this.simulation.tick();
      this.cities.update();
      if (tickDef) this.defenses.regen(CONFIG.INK_REGEN_RATE);

      this.simulation.freezeEnemies = timeStopActive;
      this.simulation.freezeDefenses = false;

      if (tickDef) this._defAccum -= defPeriod;
      if (tickAtt) this._attAccum -= attPeriod;
      ticks++;
    }
    if (ticks >= MAX_TICKS_PER_FRAME) {
      this._defAccum = 0;
      this._attAccum = 0;
    }

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

    const counts = countCells(this.grid);
    const cityThreshold = Math.max(0, CONFIG.DEFEAT_CITY_THRESHOLD | 0);
    const enemyThreshold = Math.max(0, CONFIG.VICTORY_ENEMY_THRESHOLD | 0);

    const defeatTriggered = counts.cityCells <= cityThreshold && this.cities.aliveCount() === 0;
    const cellDefeat = cityThreshold > 0 && counts.cityCells <= cityThreshold;

    if (defeatTriggered || cellDefeat) {
      this.gameOver();
      return;
    }

    if (this.missiles.isWaveComplete()) {
      if (this._activeCustomLevel) {
        if (counts.enemyCellsInEnemyRegion <= enemyThreshold) {
          this._customLevelVictory();
        }
      } else if (this.spaceInvadersMode && this.spaceInvadersMode.active) {
        // SI mode drives its own progression.
      } else {
        this.nextWave();
      }
    } else if (
      this._activeCustomLevel &&
      enemyThreshold > 0 &&
      counts.enemyCellsInEnemyRegion <= enemyThreshold
    ) {
      this._customLevelVictory();
    }
  }

  _updateThresholdDisplay(counts) {
    if (!this.thresholdDisplay) return;
    const inGame =
      this.gameState &&
      (this.gameState.is(STATE.PLAYING) || this.gameState.is(STATE.WAVE_TRANSITION));
    const cityThresh = Math.max(0, CONFIG.DEFEAT_CITY_THRESHOLD | 0);
    const enemyThresh = Math.max(0, CONFIG.VICTORY_ENEMY_THRESHOLD | 0);
    const hasNonDefaultThresholds = cityThresh > 0 || enemyThresh > 0;
    if (!inGame || !hasNonDefaultThresholds) {
      this.thresholdDisplay.classList.add('hidden');
      return;
    }
    this.thresholdDisplay.classList.remove('hidden');
    if (this.thresholdCityCount) this.thresholdCityCount.textContent = String(counts.cityCells);
    if (this.thresholdCityMin) this.thresholdCityMin.textContent = String(cityThresh);
    if (this.thresholdEnemyCount) {
      this.thresholdEnemyCount.textContent = String(counts.enemyCellsInEnemyRegion);
    }
    if (this.thresholdEnemyMax) this.thresholdEnemyMax.textContent = String(enemyThresh);
    const cityRow = this.thresholdDisplay.querySelector('.threshold-row:first-child');
    const enemyRow = this.thresholdDisplay.querySelector('.threshold-row:nth-child(2)');
    if (cityRow) {
      cityRow.classList.remove('threshold-warning', 'threshold-safe');
      if (cityThresh > 0) {
        const margin = counts.cityCells - cityThresh;
        if (margin <= 3) cityRow.classList.add('threshold-warning');
        else if (margin > 10) cityRow.classList.add('threshold-safe');
      }
    }
    if (enemyRow) {
      enemyRow.classList.remove('threshold-warning', 'threshold-safe');
      const ec = counts.enemyCellsInEnemyRegion;
      if (ec <= enemyThresh) enemyRow.classList.add('threshold-safe');
      else if (ec > enemyThresh * 2) enemyRow.classList.add('threshold-warning');
    }
  }

  _customLevelVictory() {
    if (this._customVictoryShown) return;
    this._customVictoryShown = true;
    Logger.info('[Game] Custom level victory!');
    Sfx.waveStart();
    this.score.awardVictory(this.cities.aliveCount(), this.defenses.ink);
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
    const btn = this.startButton;
    const origHandler = btn.onclick;
    btn.onclick = () => {
      btn.onclick = origHandler;
      this._customVictoryShown = false;
      if (customLevelToReplay) {
        this._suppressNextStartGame = true;
        this.startCustomLevel(customLevelToReplay);
      } else {
        this.exitToMenu();
      }
    };
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
  installEpilepsyGate(Game);
});
