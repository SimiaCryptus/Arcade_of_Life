// Console-friendly cheats API extracted from main.js.
// Returns a cheats object bound to a Game instance.
import { CONFIG, GAME_MODE_PRESETS, CELL_TYPE } from './config.js';
import { Logger } from './logger.js';

export function makeCheats(self) {
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
    setComboMult(m) {
      if (self.score) {
        self.score.setGlobalMultiplier(m);
        Logger.info(`Cheat: global score multiplier = ${m}.`);
      }
    },
    setSpeed(mult) {
      CONFIG.SPEED_MULTIPLIER = +mult;
      if (self.speedLabel) self.speedLabel.textContent = `${mult}x`;
    },
    freezeMissiles(force) {
      const v = force === undefined ? !self._missilesFrozen : !!force;
      self._missilesFrozen = v;
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
