/**
 * URL parameter navigation shortcuts.
 *
 * Centralised handler for query-string driven navigation, mode selection,
 * panel opening, and configuration overrides. Runs after the Game
 * instance is fully initialised.
 *
 * Supported parameters (all optional, processed in defined order):
 *
 *   ?autostart=1
 *       Start the default Missile Defender game immediately.
 *
 *   ?mode=<defender|invaders|story|freeplay|sandbox|designer|zoo>
 *       Start the specified game mode after load. Takes precedence
 *       over ?autostart when both are present.
 *
 *   ?level=<name-or-url>
 *       If value is a URL (http/https or relative), fetch + import
 *       the JSON, then start the level. If value matches a known
 *       built-in or saved level name, start that level directly.
 *       Multiple levels can be queued with comma separation:
 *         ?level=intro,combat,boss
 *
 *   ?panel=<settings|guide|help|zoo|designer|hotkeys|abilities>
 *       Open the specified panel on top of the menu (or in-game).
 *       Multiple panels can be opened in sequence (comma-separated).
 *
 *   ?tab=<play|library|...>
 *       Activate the named tab on the menu overlay.
 *
 *   ?ruleset=<id>
 *       Switch active ruleset (e.g. conway, highlife, daynight).
 *       Applied before any mode/level start.
 *
 *   ?enemyRuleset=<id>
 *       Set asymmetric enemy ruleset (CONFIG.ENEMY_RULESET).
 *       Use "null" or "none" to clear (symmetric play).
 *
 *   ?speed=<float>
 *       Set CONFIG.SPEED_MULTIPLIER on load (e.g. 0, 0.5, 1, 2, 4).
 *
 *   ?grid=<WxH>
 *       Override grid dimensions (e.g. 120x80). Must be applied
 *       before world build; we trigger a rebuild after parsing.
 *
 *   ?cellSize=<px>
 *       Override CELL_SIZE (1..32). Triggers a renderer resize.
 *
 *   ?preset=<id>
 *       Apply a GAME_MODE_PRESETS preset by id
 *       (e.g. classic, blitz, armada, hardcore, chaos).
 *
 *   ?ink=<n>
 *       Set initial ink and current ink to n.
 *
 *   ?maxInk=<n>
 *       Set CONFIG.MAX_INK (and defenses.maxInk) to n.
 *
 *   ?regen=<float>
 *       Set CONFIG.INK_REGEN_RATE.
 *
 *   ?wave=<n>
 *       Jump to wave n after start (uses cheats.setWave).
 *
 *   ?cities=<n>
 *       Set CONFIG.CITY_COUNT (rebuilds world).
 *
 *   ?hardcore=<0|1>
 *       Toggle CONFIG.HARDCORE_MODE.
 *
 *   ?god=<0|1>
 *       Enable god mode (cities revive, ink unlimited).
 *
 *   ?nodry=<0|1>
 *       Set CONFIG.INK_DRY_TICKS to 0 (instant defenses) when 1.
 *
 *   ?fullscreen=1
 *       Request fullscreen after first user interaction (browsers
 *       require a gesture; we wire it to the next click/key).
 *
 *   ?mute=<0|1>
 *       Mute or unmute SFX (window.Sfx).
 *
 *   ?volume=<0..1>
 *       Set SFX volume (if supported).
 *
 *   ?theme=<dark|light|retro>
 *       Apply a body className theme hook (CSS-driven).
 *
 *   ?seed=<n>
 *       Override Math.random with a seeded RNG for reproducible
 *       runs (mulberry32). Logged for debugging.
 *
 *   ?paused=1
 *       Force paused state on start (SPEED_MULTIPLIER=0).
 *
 *   ?tool=<freehand|line|pattern|brush|...>
 *       Pre-select an input drawing tool/mode.
 *
 *   ?pattern=<name>
 *       Load a named pattern from the pattern zoo into the input
 *       brush for pattern-stamp mode.
 *
 *   ?vfx=<0|1>
 *       Bulk-enable/disable all visual effects.
 *
 *   ?log=<level>
 *       Set logger level (error|warn|info|debug|trace).
 *
 *   ?debug=1
 *       Set the logger level to "debug".
 *
 *   ?cheats=1
 *       Print cheat help banner and enable god mode.
 *
 *   ?nomotd=1
 *       Suppress the MOTD line in the overlay.
 *
 *   ?share=1
 *       Open a "share this link" prompt with the current URL.
 *
 *   ?clean=1
 *       After processing, strip URL params (replaceState) so a
 *       refresh / share doesn't re-apply them.
 *
 * Examples:
 *   ?mode=invaders&speed=2
 *   ?level=levels/invaders.json&autostart=1
 *   ?panel=guide
 *   ?ruleset=highlife&grid=160x100
 *   ?debug=1&cheats=1
 *   ?preset=chaos&ink=500&wave=5
 *   ?mode=defender&god=1&nodry=1&speed=4
 *   ?seed=42&autostart=1
 *   ?level=intro,combat,boss        (queue multiple levels)
 */

import { CONFIG, SPEED_PRESETS, GAME_MODE_PRESETS } from './config.js';
import { Logger } from './logger.js';
import { importLevelJSON, getLevel, listLevels } from './levels.js';
import { activateMenuTab } from './menuOverlay.js';
import { toggleFullscreen } from './pwa.js';

/**
 * Process all URL parameters against the live Game instance.
 * Safe to call once after Game construction. Logs every action.
 *
 * @param {Object} game  The Game instance.
 */
export function processUrlParams(game) {
  const params = new URLSearchParams(window.location.search);
  if ([...params.keys()].length === 0) return;

  Logger.info(
    `[URL] Processing ${[...params.keys()].length} URL parameter(s): ` +
      `${[...params.keys()].join(', ')}`
  );

  // 1. Logger level (debug or explicit log=).
  const logLevel = params.get('log');
  if (logLevel) {
    try {
      if (window.ArcadeOfLifeLogger && window.ArcadeOfLifeLogger.setLevel) {
        window.ArcadeOfLifeLogger.setLevel(String(logLevel).toLowerCase());
        Logger.info(`[URL] Logger level set to "${logLevel}".`);
      }
    } catch (e) {
      Logger.warn('[URL] Failed to set log level', e);
    }
  }
  if (params.get('debug') === '1') {
    try {
      if (window.ArcadeOfLifeLogger && window.ArcadeOfLifeLogger.setLevel) {
        window.ArcadeOfLifeLogger.setLevel('debug');
        Logger.info('[URL] Debug logging enabled.');
      }
    } catch (e) {
      Logger.warn('[URL] Failed to set debug log level', e);
    }
  }

  // 2. Seeded RNG (do this early so anything else is reproducible).
  const seedRaw = params.get('seed');
  if (seedRaw != null) {
    const seed = parseInt(seedRaw, 10) | 0;
    if (Number.isFinite(seed)) {
      installSeededRandom(seed);
      Logger.info(`[URL] Seeded RNG installed with seed=${seed}.`);
    } else {
      Logger.warn(`[URL] Invalid seed: "${seedRaw}".`);
    }
  }

  // 3. nomotd: suppress motd before any overlay refresh.
  if (params.get('nomotd') === '1') {
    game.motd = '';
    try {
      const msg = document.getElementById('overlay-message');
      if (msg) msg.textContent = '';
    } catch (_e) {
      /* ignore */
    }
    Logger.info('[URL] MOTD suppressed.');
  }

  // 4. Theme.
  const theme = params.get('theme');
  if (theme) {
    try {
      const t = String(theme).trim().toLowerCase();
      document.body.classList.remove('theme-dark', 'theme-light', 'theme-retro');
      document.body.classList.add(`theme-${t}`);
      Logger.info(`[URL] Theme set to "${t}".`);
    } catch (e) {
      Logger.warn('[URL] Failed to apply theme', e);
    }
  }

  // 5. Preset (must come before individual overrides so individual
  //    settings can layer on top of the preset).
  const preset = params.get('preset');
  if (preset) {
    const id = String(preset).trim().toLowerCase();
    const match = GAME_MODE_PRESETS.find((p) => p.id === id);
    if (match) {
      try {
        if (game.settings && typeof game.settings.applyGameMode === 'function') {
          game.settings.applyGameMode(id);
        }
        Logger.info(`[URL] Applied preset "${id}" (${match.name}).`);
      } catch (e) {
        Logger.warn(`[URL] Failed to apply preset "${id}"`, e);
      }
    } else {
      Logger.warn(
        `[URL] Unknown preset "${preset}". Known: ` + GAME_MODE_PRESETS.map((p) => p.id).join(', ')
      );
    }
  }

  // 6. Grid size override (before any world rebuild from other params).
  const grid = params.get('grid');
  if (grid) {
    const m = /^(\d{1,4})x(\d{1,4})$/i.exec(grid.trim());
    if (m) {
      const w = Math.max(8, Math.min(512, parseInt(m[1], 10) | 0));
      const h = Math.max(8, Math.min(512, parseInt(m[2], 10) | 0));
      if (w > 0 && h > 0) {
        CONFIG.GRID_WIDTH = w;
        CONFIG.GRID_HEIGHT = h;
        Logger.info(`[URL] Grid override: ${w}x${h}`);
        try {
          game.rebuildWorld();
        } catch (e) {
          Logger.warn('[URL] rebuildWorld failed', e);
        }
      }
    } else {
      Logger.warn(`[URL] Invalid grid format: "${grid}". Expected WxH.`);
    }
  }

  // 7. Cell size override.
  const cellSize = params.get('cellSize') || params.get('cellsize');
  if (cellSize != null) {
    const v = parseInt(cellSize, 10) | 0;
    if (v >= 1 && v <= 32) {
      CONFIG.CELL_SIZE = v;
      try {
        if (game.renderer && game.renderer.resize) game.renderer.resize();
      } catch (e) {
        Logger.warn('[URL] renderer.resize failed', e);
      }
      Logger.info(`[URL] CELL_SIZE set to ${v}px.`);
    } else {
      Logger.warn(`[URL] Invalid cellSize "${cellSize}" (1..32).`);
    }
  }

  // 8. Cities count.
  const cities = params.get('cities');
  if (cities != null) {
    const v = parseInt(cities, 10) | 0;
    if (v >= 1 && v <= 20) {
      CONFIG.CITY_COUNT = v;
      Logger.info(`[URL] CITY_COUNT set to ${v}.`);
    } else {
      Logger.warn(`[URL] Invalid cities "${cities}" (1..20).`);
    }
  }

  // 9. Ruleset override (player / defenses).
  const ruleset = params.get('ruleset');
  if (ruleset) {
    const id = String(ruleset).trim().toLowerCase();
    CONFIG.ACTIVE_RULESET = id;
    if (game.settings && game.settings.values) {
      game.settings.values.ACTIVE_RULESET = id;
      try {
        game.settings.save?.();
      } catch (_e) {
        /* ignore */
      }
    }
    Logger.info(`[URL] Ruleset set to "${id}".`);
    try {
      game.rebuildWorld();
    } catch (e) {
      Logger.warn('[URL] rebuildWorld after ruleset change failed', e);
    }
  }

  // 10. Enemy ruleset (asymmetric).
  const enemyRuleset = params.get('enemyRuleset') || params.get('enemyruleset');
  if (enemyRuleset != null) {
    const raw = String(enemyRuleset).trim().toLowerCase();
    if (raw === 'null' || raw === 'none' || raw === '') {
      CONFIG.ENEMY_RULESET = null;
      Logger.info('[URL] ENEMY_RULESET cleared (symmetric play).');
    } else {
      CONFIG.ENEMY_RULESET = raw;
      Logger.info(`[URL] ENEMY_RULESET set to "${raw}".`);
    }
  }

  // 11. Speed override.
  const speedRaw = params.get('speed');
  if (speedRaw != null) {
    const v = parseFloat(speedRaw);
    if (Number.isFinite(v) && v >= 0 && v <= 256) {
      CONFIG.SPEED_MULTIPLIER = v;
      if (game.speedSlider) {
        const idx = SPEED_PRESETS.findIndex((p) => Math.abs(p.value - v) < 0.01);
        if (idx >= 0) {
          game.speedSlider.value = String(idx);
          try {
            game._applySpeedFromSlider();
          } catch (_e) {
            /* ignore */
          }
        }
      }
      if (game.speedLabel) {
        game.speedLabel.textContent = v === 0 ? 'Paused' : `${v}x`;
      }
      Logger.info(`[URL] Speed set to ${v}x.`);
    } else {
      Logger.warn(`[URL] Invalid speed: "${speedRaw}".`);
    }
  }

  // 12. Paused override (always wins after speed).
  if (params.get('paused') === '1') {
    CONFIG.SPEED_MULTIPLIER = 0;
    if (game.speedLabel) game.speedLabel.textContent = 'Paused';
    Logger.info('[URL] Forced paused state.');
  }

  // 13. Ink / regen overrides.
  const inkRaw = params.get('ink');
  if (inkRaw != null) {
    const v = parseInt(inkRaw, 10) | 0;
    if (v >= 0 && v <= 99999) {
      CONFIG.INITIAL_INK = v;
      try {
        if (game.defenses) game.defenses.ink = v;
      } catch (_e) {
        /* ignore */
      }
      Logger.info(`[URL] Ink set to ${v}.`);
    }
  }
  const maxInkRaw = params.get('maxInk') || params.get('maxink');
  if (maxInkRaw != null) {
    const v = parseInt(maxInkRaw, 10) | 0;
    if (v >= 1 && v <= 99999) {
      CONFIG.MAX_INK = v;
      try {
        if (game.defenses) game.defenses.maxInk = v;
      } catch (_e) {
        /* ignore */
      }
      Logger.info(`[URL] Max ink set to ${v}.`);
    }
  }
  const regenRaw = params.get('regen');
  if (regenRaw != null) {
    const v = parseFloat(regenRaw);
    if (Number.isFinite(v) && v >= 0 && v <= 100) {
      CONFIG.INK_REGEN_RATE = v;
      Logger.info(`[URL] Ink regen rate set to ${v}.`);
    }
  }

  // 14. Hardcore toggle.
  const hardcore = params.get('hardcore');
  if (hardcore != null) {
    CONFIG.HARDCORE_MODE = hardcore === '1' || hardcore === 'true';
    Logger.info(`[URL] HARDCORE_MODE = ${CONFIG.HARDCORE_MODE}.`);
  }

  // 15. nodry toggle.
  const nodry = params.get('nodry');
  if (nodry != null) {
    if (nodry === '1' || nodry === 'true') {
      CONFIG.INK_DRY_TICKS = 0;
      Logger.info('[URL] Instant defense placement enabled (INK_DRY_TICKS=0).');
    }
  }

  // 16. VFX bulk toggle.
  const vfx = params.get('vfx');
  if (vfx != null) {
    const on = vfx === '1' || vfx === 'true';
    CONFIG.VFX_PARTICLES = on;
    CONFIG.VFX_SHOCKWAVES = on;
    CONFIG.VFX_FLOATERS = on;
    CONFIG.VFX_SCREEN_SHAKE = on;
    CONFIG.VFX_CELL_GLOW = on;
    CONFIG.VFX_DRAW_ZONE_TINT = on;
    Logger.info(`[URL] All VFX ${on ? 'enabled' : 'disabled'}.`);
  }

  // 17. Audio: mute / volume.
  const mute = params.get('mute');
  if (mute != null) {
    try {
      const on = mute === '1' || mute === 'true';
      if (window.Sfx && typeof window.Sfx.setMuted === 'function') {
        window.Sfx.setMuted(on);
      } else if (window.Sfx) {
        window.Sfx.muted = on;
      }
      Logger.info(`[URL] Audio ${on ? 'muted' : 'unmuted'}.`);
    } catch (e) {
      Logger.warn('[URL] Mute toggle failed', e);
    }
  }
  const volume = params.get('volume') || params.get('vol');
  if (volume != null) {
    const v = parseFloat(volume);
    if (Number.isFinite(v) && v >= 0 && v <= 1) {
      try {
        if (window.Sfx && typeof window.Sfx.setVolume === 'function') {
          window.Sfx.setVolume(v);
        } else if (window.Sfx) {
          window.Sfx.volume = v;
        }
        Logger.info(`[URL] Volume set to ${v}.`);
      } catch (e) {
        Logger.warn('[URL] Volume set failed', e);
      }
    }
  }

  // 18. God mode flag.
  if (params.get('god') === '1' || params.get('god') === 'true') {
    try {
      game._godMode = true;
      Logger.info('[URL] God mode enabled.');
    } catch (e) {
      Logger.warn('[URL] God mode toggle failed', e);
    }
  }

  // 19. Cheats flag.
  if (params.get('cheats') === '1') {
    try {
      if (game.cheats && typeof game.cheats.help === 'function') {
        game.cheats.help();
      }
      game._godMode = true;
      Logger.info('[URL] God mode enabled, cheats banner printed.');
    } catch (e) {
      Logger.warn('[URL] Failed to enable cheats', e);
    }
  }

  // 20. Tool / drawing mode preselect.
  const tool = params.get('tool');
  if (tool) {
    try {
      if (game.input && typeof game.input.setMode === 'function') {
        game.input.setMode(String(tool).trim().toLowerCase());
        Logger.info(`[URL] Input tool set to "${tool}".`);
      }
    } catch (e) {
      Logger.warn(`[URL] Failed to set tool "${tool}"`, e);
    }
  }

  // 21. Pattern preload (for pattern-stamp brush).
  const pattern = params.get('pattern');
  if (pattern) {
    try {
      if (game.patternZoo && typeof game.patternZoo.selectPatternByName === 'function') {
        game.patternZoo.selectPatternByName(pattern);
      } else if (game.input && game.input.loadPatternByName) {
        game.input.loadPatternByName(pattern);
      }
      Logger.info(`[URL] Pattern "${pattern}" preloaded into brush.`);
    } catch (e) {
      Logger.warn(`[URL] Failed to load pattern "${pattern}"`, e);
    }
  }

  // 22. Tab activation (only meaningful on the menu).
  const tab = params.get('tab');
  if (tab) {
    try {
      activateMenuTab(String(tab).trim().toLowerCase());
      Logger.info(`[URL] Activated menu tab "${tab}".`);
    } catch (e) {
      Logger.warn(`[URL] Failed to activate tab "${tab}"`, e);
    }
  }

  // 23. Panel opening (supports comma-separated multi-open).
  const panel = params.get('panel');
  if (panel) {
    const names = String(panel)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    names.forEach((n, i) => {
      // Stagger to give panels a chance to mount.
      setTimeout(() => openPanelByName(game, n), i * 200);
    });
  }

  // 24. Fullscreen (requires user gesture in most browsers).
  if (params.get('fullscreen') === '1') {
    Logger.info('[URL] Fullscreen requested; will activate on first input.');
    const handler = () => {
      try {
        toggleFullscreen();
      } catch (e) {
        Logger.warn('[URL] toggleFullscreen failed', e);
      }
      window.removeEventListener('click', handler, true);
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('touchstart', handler, true);
    };
    window.addEventListener('click', handler, true);
    window.addEventListener('keydown', handler, true);
    window.addEventListener('touchstart', handler, true);
  }

  // 25. Share helper.
  if (params.get('share') === '1') {
    try {
      const url = window.location.href;
      if (navigator.share) {
        navigator
          .share({ title: 'Arcade of Life', url })
          .catch((e) => Logger.warn('[URL] navigator.share failed', e));
      } else {
        window.prompt('Share this URL:', url);
      }
    } catch (e) {
      Logger.warn('[URL] Share failed', e);
    }
  }

  // 26. Level — handle name(s) or URL(s) (comma-separated queue).
  const levelParam = params.get('level');
  const handleLevel = () => {
    if (!levelParam) return Promise.resolve(false);
    const items = String(levelParam)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) return Promise.resolve(false);
    // For multiple levels: load the first, queue the rest.
    if (items.length > 1) {
      try {
        game._urlLevelQueue = items.slice(1);
        Logger.info(`[URL] Queued ${items.length - 1} additional level(s) for sequential play.`);
      } catch (_e) {
        /* ignore */
      }
    }
    return resolveAndStartLevel(game, items[0]);
  };

  // 27. Mode — start a specific mode unless level handles it.
  const mode = params.get('mode');
  const autostart = params.get('autostart') === '1';

  // 28. Wave jump (applied after start).
  const waveRaw = params.get('wave');

  // Sequence: level (if any) -> mode (if any) -> autostart -> wave jump.
  handleLevel().then((levelStarted) => {
    const postStart = () => {
      if (waveRaw != null) {
        const w = parseInt(waveRaw, 10) | 0;
        if (w >= 1 && w <= 999) {
          setTimeout(() => {
            try {
              if (game.cheats && typeof game.cheats.setWave === 'function') {
                game.cheats.setWave(w);
                Logger.info(`[URL] Jumped to wave ${w}.`);
              }
            } catch (e) {
              Logger.warn(`[URL] setWave(${w}) failed`, e);
            }
          }, 500);
        }
      }
      // 29. Clean URL after applying (if requested).
      if (params.get('clean') === '1') {
        setTimeout(() => cleanUrl(), 600);
      }
    };

    if (levelStarted) {
      postStart();
      return;
    }
    if (mode) {
      startModeByName(game, String(mode).trim().toLowerCase());
      postStart();
      return;
    }
    if (autostart) {
      Logger.info('[URL] autostart=1 → starting default mode.');
      setTimeout(() => {
        try {
          game.startGame();
        } catch (e) {
          Logger.warn('[URL] startGame failed', e);
        }
        postStart();
      }, 100);
      return;
    }
    postStart();
  });
}

function openPanelByName(game, name) {
  const map = {
    settings: () => game.openSettings(),
    guide: () => game.openGuide(),
    help: () => game.openHelpGuide(),
    howtoplay: () => game.openHelpGuide(),
    zoo: () => game.openPatternZoo(),
    patternzoo: () => game.openPatternZoo(),
    designer: () => game.openLevelDesigner(),
    leveldesigner: () => game.openLevelDesigner(),
    hotkeys: () => game._toggleHotkeyHelp(true),
    keys: () => game._toggleHotkeyHelp(true),
    abilities: () => {
      if (game.abilitiesMenu && typeof game.abilitiesMenu.show === 'function') {
        game.abilitiesMenu.show();
      } else {
        Logger.warn('[URL] Abilities menu not available.');
      }
    },
  };
  const fn = map[name];
  if (!fn) {
    Logger.warn(`[URL] Unknown panel "${name}". Known: ${Object.keys(map).join(', ')}`);
    return;
  }
  try {
    fn();
    Logger.info(`[URL] Opened panel "${name}".`);
  } catch (e) {
    Logger.warn(`[URL] Failed to open panel "${name}"`, e);
  }
}

function startModeByName(game, name) {
  const aliases = {
    defender: 'defender',
    missiledefender: 'defender',
    md: 'defender',
    invaders: 'invaders',
    spaceinvaders: 'invaders',
    si: 'invaders',
    story: 'story',
    campaign: 'story',
    freeplay: 'freeplay',
    sandbox: 'freeplay',
    designer: 'designer',
    leveldesigner: 'designer',
    zoo: 'zoo',
    patternzoo: 'zoo',
  };
  const mode = aliases[name];
  if (!mode) {
    Logger.warn(
      `[URL] Unknown mode "${name}". Known: defender, invaders, story, ` +
        `freeplay, designer, zoo.`
    );
    return;
  }
  // Defer slightly so UI is ready.
  setTimeout(() => {
    try {
      if (mode === 'defender') {
        Logger.info('[URL] Starting Missile Defender mode.');
        game.startGame();
      } else if (mode === 'invaders') {
        if (game.spaceInvadersMode) {
          Logger.info('[URL] Starting Space Invaders mode.');
          game.spaceInvadersMode.start();
        } else {
          Logger.warn('[URL] Space Invaders mode not available.');
        }
      } else if (mode === 'story') {
        if (game.story && typeof game.story.startStory === 'function') {
          Logger.info('[URL] Starting Story mode.');
          game.story.startStory();
        } else {
          Logger.warn('[URL] Story engine not available.');
        }
      } else if (mode === 'freeplay') {
        if (game.freeplayAbilities) {
          Logger.info('[URL] Entering Freeplay mode.');
          game.hideOverlay();
          try {
            game.freeplayAbilities.install?.();
          } catch (_e) {
            /* ignore */
          }
        } else {
          Logger.warn('[URL] Freeplay abilities not available.');
        }
      } else if (mode === 'designer') {
        Logger.info('[URL] Opening Level Designer.');
        game.openLevelDesigner();
      } else if (mode === 'zoo') {
        Logger.info('[URL] Opening Pattern Zoo.');
        game.openPatternZoo();
      }
    } catch (e) {
      Logger.warn(`[URL] startMode("${mode}") failed`, e);
    }
  }, 120);
}

/**
 * Resolve a `?level=` value as either a known level name or a URL,
 * then start it. Returns a Promise<boolean> indicating whether a
 * level was queued for start.
 */
function resolveAndStartLevel(game, raw) {
  const value = String(raw).trim();
  if (!value) return Promise.resolve(false);

  const looksLikeUrl =
    /^https?:\/\//i.test(value) ||
    value.endsWith('.json') ||
    value.includes('/') ||
    /%2f/i.test(value);

  if (!looksLikeUrl) {
    // Try as a built-in or saved level name.
    try {
      const levels = listLevels ? listLevels() : [];
      const match = levels.find((n) => String(n).toLowerCase() === value.toLowerCase());
      const resolvedName = match || value;
      if (getLevel(resolvedName)) {
        Logger.info(`[URL] Starting level by name: "${resolvedName}".`);
        setTimeout(() => {
          try {
            game.startCustomLevel(resolvedName);
          } catch (e) {
            Logger.warn('[URL] startCustomLevel failed', e);
          }
        }, 150);
        return Promise.resolve(true);
      }
      Logger.warn(`[URL] No level found by name "${value}".`);
      return Promise.resolve(false);
    } catch (e) {
      Logger.warn('[URL] Level name resolution failed', e);
      return Promise.resolve(false);
    }
  }

  // Treat as URL: decode if needed, resolve relative, fetch + import.
  let url = value;
  try {
    if (/%2f/i.test(url) || url.startsWith('https%3A')) url = decodeURIComponent(url);
  } catch (_e) {
    /* ignore */
  }
  try {
    url = new URL(url, window.location.href).href;
  } catch (e) {
    Logger.warn(`[URL] Invalid level URL "${value}"`, e);
    return Promise.resolve(false);
  }
  Logger.info(`[URL] Fetching level JSON from ${url}`);
  return fetch(url, { mode: 'cors', credentials: 'omit' })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    })
    .then((text) => {
      const result = importLevelJSON(text);
      if (!result.ok) throw new Error(result.error || 'invalid JSON');
      setTimeout(() => {
        try {
          game.startCustomLevel(result.name);
        } catch (e) {
          Logger.warn('[URL] startCustomLevel failed', e);
        }
      }, 200);
      return true;
    })
    .catch((e) => {
      Logger.warn(`[URL] Failed to load level from ${url}: ${e.message}`);
      return false;
    });
}

/**
 * Strip query parameters from the current URL without reloading.
 * Useful when ?clean=1 is set to avoid re-applying params on refresh.
 */
function cleanUrl() {
  try {
    const url = new URL(window.location.href);
    const cleaned = url.pathname + url.hash;
    window.history.replaceState({}, '', cleaned);
    Logger.info('[URL] URL params stripped (clean=1).');
  } catch (e) {
    Logger.warn('[URL] cleanUrl failed', e);
  }
}

/**
 * Install a seeded RNG over Math.random() using mulberry32.
 * Reproducible across reloads for the same seed value.
 */
function installSeededRandom(seed) {
  let a = seed >>> 0;
  const mulberry32 = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    // Save original for potential restoration.
    if (!window._originalMathRandom) {
      window._originalMathRandom = Math.random;
    }
    Math.random = mulberry32;
    window._seededRandomSeed = seed;
  } catch (e) {
    Logger.warn('[URL] Failed to install seeded RNG', e);
  }
}
