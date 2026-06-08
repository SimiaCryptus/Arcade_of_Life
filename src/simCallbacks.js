// Wires simulation/missiles event handlers to renderer VFX and SFX.
// Extracted from main.js _wireSimCallbacks().
import { CONFIG } from './config.js';
import { Logger } from './logger.js';
import { Sfx } from './audio.js';
import { SCORE_VALUES } from './scoring.js';

export function wireSimCallbacks(game) {
  game.simulation.onMissileDestroyed = () => {
    // Intentionally no score — see original comment.
  };
  game.missiles.onTargetSpawn = (cx, cy) => {
    try {
      if (!game.renderer) return;
      game.renderer.addShockwave(cx, cy, { maxRadius: 40, color: '#ff3333', ttl: 30, width: 3 });
      game.renderer.addBigFloater(cx, cy - 2, '⚠ TARGET DEPLOYED', '#ff3333', 1.4);
      game.renderer.addParticleBurst(cx, cy, {
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
  game.missiles.onTargetDestroyed = (cx, cy) => {
    try {
      game.score.awardKill('TARGET DOWN', SCORE_VALUES.TARGET_DESTROYED, cx, cy);
      if (!game.renderer) return;
      game.renderer.addShockwave(cx, cy, { maxRadius: 60, color: '#ffff44', ttl: 35, width: 3 });
      game.renderer.addParticleBurst(cx, cy, {
        count: 50,
        colors: ['#ffff66', '#ff8800', '#ffffff', '#ff0033'],
        speed: 3.5,
        ttl: 60,
        size: 3.2,
        glow: 12,
        gravity: 0.05,
      });
      game.renderer.addShake(6, 24);
    } catch (e) {
      Logger.error('onTargetDestroyed handler failed.', e);
    }
  };
  game.simulation.onCityDestroyed = (x, y) => {
    try {
      Logger.debug(`City cell destroyed at (${x},${y}).`);
    } catch {
      /* swallow */
    }
  };
  game.simulation.onAnnihilation = (x, y) => {
    try {
      if (!CONFIG.EVENT_ANNIHILATION) return;
      Sfx.annihilation();
      if (!game.renderer) return;
      game.renderer.addParticleBurst(x, y, {
        count: 14,
        colors: ['#ffdd44', '#ff8800', '#ffffff', '#ff4400'],
        speed: 1.8,
        ttl: 22,
        size: 2.2,
        glow: 8,
        gravity: 0.04,
      });
      game.renderer.addShockwave(x, y, { maxRadius: 18, color: '#ffaa33', ttl: 14, width: 1.5 });
    } catch (e) {
      Logger.error('onAnnihilation handler failed.', e);
    }
  };
  game.simulation.onCityHit = (x, y, attacker) => {
    try {
      if (!CONFIG.EVENT_CITY_HIT) return;
      if (attacker === 'defense') Sfx.friendlyFire();
      else Sfx.cityHit();
      const penalty =
        attacker === 'defense' ? SCORE_VALUES.FRIENDLY_FIRE_PENALTY : SCORE_VALUES.CITY_CELL_LOST;
      game.score.penalty(attacker === 'defense' ? 'FRIENDLY FIRE' : 'CITY HIT', penalty, x, y);
      if (!game.renderer) return;
      const isFriendly = attacker === 'defense';
      const palette = isFriendly
        ? ['#88ff44', '#aaff66', '#ffff66', '#ffffff']
        : ['#ff3030', '#ff8800', '#ffff66', '#ffffff'];
      const ringColor = isFriendly ? '#aaff44' : '#ff4040';
      game.renderer.addParticleBurst(x, y, {
        count: 28,
        colors: palette,
        speed: 2.6,
        spread: Math.PI * 2,
        ttl: 50,
        size: 2.8,
        glow: 10,
        gravity: 0.08,
      });
      game.renderer.addParticleBurst(x, y, {
        count: 14,
        colors: isFriendly ? ['#446644', '#88aa88', '#225522'] : ['#444444', '#886655', '#552222'],
        speed: 0.6,
        spread: Math.PI / 2,
        dir: -Math.PI / 2,
        ttl: 80,
        size: 3.0,
        glow: 4,
        gravity: -0.02,
      });
      game.renderer.addShockwave(x, y, { maxRadius: 36, color: ringColor, ttl: 28, width: 2.5 });
      game.renderer.addShockwave(x, y, {
        maxRadius: 60,
        color: isFriendly ? '#ffff80' : '#ffaa33',
        ttl: 40,
        width: 1.2,
      });
      const label = isFriendly ? 'FRIENDLY FIRE!' : 'CITY HIT!';
      const labelColor = isFriendly ? '#aaff66' : '#ff5050';
      game.renderer.addBigFloater(x, y - 1, label, labelColor, 1.4);
      game.renderer.addShake(isFriendly ? 2 : 4, isFriendly ? 12 : 20);
    } catch (e) {
      Logger.error('onCityHit handler failed.', e);
    }
  };
  game.simulation.onMissileReturn = (x, y, kind) => {
    try {
      if (kind === 'ricochet') {
        Sfx.ricochet();
        if (game.renderer) {
          game.renderer.addFloater(x, y, 'RICOCHET!', CONFIG.COLORS.RICOCHET_TEXT);
          game.renderer.addParticleBurst(x, y, {
            count: 16,
            colors: ['#ffaa00', '#ffff66', '#ffffff'],
            speed: 2.2,
            ttl: 30,
            size: 2.4,
            glow: 10,
            gravity: 0.02,
          });
          game.renderer.addShockwave(x, y, {
            maxRadius: 24,
            color: CONFIG.COLORS.RICOCHET_TEXT,
            ttl: 20,
          });
        }
      } else {
        Sfx.returnFire();
        if (game.renderer) {
          game.renderer.addFloater(x, y, 'RETURN FIRE!', CONFIG.COLORS.RETURN_FIRE_TEXT);
          game.renderer.addParticleBurst(x, y, {
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
  game.missiles.onMissileSpawn = (cx, cy /*, _pw, _ph */) => {
    try {
      Sfx.missileSpawn();
      if (!game.renderer) return;
      game.renderer.addShockwave(cx, cy, { maxRadius: 22, color: '#ff6060', ttl: 16, width: 2 });
      game.renderer.addParticleBurst(cx, cy, {
        count: 22,
        colors: ['#ff6040', '#ffaa44', '#ffff88', '#ff2020', '#ffffff'],
        speed: 2.4,
        spread: Math.PI / 2.2,
        dir: Math.PI / 2,
        ttl: 28,
        size: 2.6,
        glow: 10,
        gravity: 0.06,
        vy0: 0.8,
      });
      game.renderer.addParticleBurst(cx, cy, {
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
  game.simulation.onBreach = (x, y) => {
    try {
      Sfx.cityHit();
      if (game.renderer) {
        game.renderer.addBigFloater(x, y - 2, '⚠ BREACH!', '#ff8844', 1.4);
        game.renderer.addShockwave(x, y, { maxRadius: 30, color: '#ff8844', ttl: 24, width: 2 });
        game.renderer.addParticleBurst(x, y, {
          count: 18,
          colors: ['#ff8844', '#ffaa66', '#ffff88', '#ff4422'],
          speed: 2.0,
          ttl: 35,
          size: 2.6,
          glow: 10,
          gravity: 0.05,
        });
        game.renderer.addShake(3, 18);
      }
      game.score.penalty('BREACH', SCORE_VALUES.BREACH_PENALTY, x, y);
    } catch (e) {
      Logger.error('onBreach handler failed.', e);
    }
  };
  game.missiles.onBaseSpawn = (cx, cy, kind) => {
    try {
      if (!game.renderer) return;
      const colorMap = {
        fortress: '#ff3333',
        bunker: '#ff8833',
        cruiser_e: '#ff5555',
        cruiser_w: '#ff5555',
      };
      const color = colorMap[kind] || '#ff3333';
      game.renderer.addShockwave(cx, cy, { maxRadius: 40, color, ttl: 30, width: 3 });
      const labelMap = {
        fortress: '⚠ FORTRESS DEPLOYED',
        bunker: '⚠ BUNKER DEPLOYED',
        cruiser_e: '⚠ CRUISER (E) DEPLOYED',
        cruiser_w: '⚠ CRUISER (W) DEPLOYED',
      };
      game.renderer.addBigFloater(cx, cy - 2, labelMap[kind] || '⚠ BASE DEPLOYED', color, 1.3);
      game.renderer.addParticleBurst(cx, cy, {
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
  game.missiles.onBaseDestroyed = (cx, cy, kind) => {
    try {
      const valueMap = {
        fortress: SCORE_VALUES.FORTRESS_DESTROYED,
        bunker: SCORE_VALUES.BUNKER_DESTROYED,
        cruiser_e: SCORE_VALUES.CRUISER_DESTROYED,
        cruiser_w: SCORE_VALUES.CRUISER_DESTROYED,
      };
      const labelMap = {
        fortress: 'FORTRESS DOWN',
        bunker: 'BUNKER DOWN',
        cruiser_e: 'CRUISER DOWN',
        cruiser_w: 'CRUISER DOWN',
      };
      const basePts = valueMap[kind] || SCORE_VALUES.BUNKER_DESTROYED;
      const label = labelMap[kind] || 'BASE DOWN';
      game.score.awardKill(label, basePts, cx, cy);
      if (!game.renderer) return;
      game.renderer.addShockwave(cx, cy, { maxRadius: 70, color: '#ffff44', ttl: 38, width: 3 });
      game.renderer.addParticleBurst(cx, cy, {
        count: 55,
        colors: ['#ffff66', '#ff8800', '#ffffff', '#ff0033'],
        speed: 3.5,
        ttl: 60,
        size: 3.2,
        glow: 12,
        gravity: 0.05,
      });
      game.renderer.addShake(7, 28);
    } catch (e) {
      Logger.error('onBaseDestroyed handler failed.', e);
    }
  };
}
