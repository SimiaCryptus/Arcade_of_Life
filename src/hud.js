import { loadInt, saveString } from './storage.js';

/**
 * HUD data container.
 */
export class HUD {
  constructor() {
    this.score = 0;
    this.wave = 1;
    this.citiesAlive = 0;
    this.ink = 0;
    this.maxInk = 0;
    this.highScore = loadInt('missileDefenseHighScore', 0);
    // Throttle high-score writes: only save when score actually advances
    // past previously-saved value, and at most once per second.
    this._lastHighScoreSave = 0;
  }

  addScore(amount) {
    if (!Number.isFinite(amount)) return;
    this.score += amount;
    if (this.score > this.highScore) {
      this.highScore = this.score;
      // Throttle disk writes to avoid spamming localStorage during fast play.
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - this._lastHighScoreSave > 1000) {
        saveString('missileDefenseHighScore', this.highScore);
        this._lastHighScoreSave = now;
      }
    }
  }

  reset() {
    // Final flush of high score on reset, in case throttle skipped it.
    saveString('missileDefenseHighScore', this.highScore);
    this.score = 0;
    this.wave = 1;
    this.citiesAlive = 0;
  }
}
