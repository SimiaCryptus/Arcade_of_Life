import { Logger } from './logger.js';

/**
 * Synth-based sound effects using the Web Audio API.
 *
 * All sounds are procedurally generated — no audio assets required.
 * Audio context is lazily created on first user interaction (to comply
 * with browser autoplay policies) and reused thereafter.
 *
 * Categories:
 *   - missileSpawn   short downward swoop, hot/buzzy
 *   - annihilation   short white-noise burst with low thump
 *   - cityHit        deep boom + low rumble
 *   - friendlyFire   sour detuned dyad (warning)
 *   - returnFire     bright rising sine pulse
 *   - ricochet       bright zap with quick pitch fall
 *   - uiClick        short click
 *   - waveStart      triumphant two-note rise
 *   - gameOver       descending sad triad
 */

class SfxEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.muted = false;
    this.volume = 0.35;
    this._lastPlayTime = new Map(); // throttle by sound key
    this._unlocked = false;
    this._bindUnlock();
    // Periodically clean stale throttle entries to prevent unbounded growth.
    if (typeof setInterval === 'function') {
      this._cleanupTimer = setInterval(() => this._cleanupThrottleMap(), 30000);
      // Don't keep the Node event loop alive in test environments.
      if (this._cleanupTimer && typeof this._cleanupTimer.unref === 'function') {
        this._cleanupTimer.unref();
      }
    }
  }
  /**
   * Tear down the engine. Stops the cleanup timer and closes the
   * AudioContext. Safe to call multiple times.
   */
  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    if (this.ctx && typeof this.ctx.close === 'function') {
      try {
        this.ctx.close();
      } catch (_e) {
        /* ignore */
      }
    }
    this.ctx = null;
    this.masterGain = null;
    this._lastPlayTime.clear();
  }

  _bindUnlock() {
    const unlock = () => {
      this._ensureCtx();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      this._unlocked = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    window.addEventListener('touchstart', unlock, { once: false });
  }

  _ensureCtx() {
    if (this.ctx) return this.ctx;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        Logger.warn('AudioContext not supported; sound disabled.');
        return null;
      }
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
    } catch (e) {
      Logger.warn('Failed to create AudioContext.', e);
      this.ctx = null;
    }
    return this.ctx;
  }

  setMuted(m) {
    this.muted = !!m;
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) this.masterGain.gain.value = this.volume;
  }

  // Throttle so we don't pile up dozens of simultaneous identical sounds.
  _throttle(key, minIntervalMs) {
    const now = performance.now();
    const last = this._lastPlayTime.get(key) || 0;
    if (now - last < minIntervalMs) return false;
    this._lastPlayTime.set(key, now);
    return true;
  }
  /**
   * Periodically clean up the throttle map so it doesn't grow unbounded.
   * Called automatically every ~30 seconds.
   */
  _cleanupThrottleMap() {
    const now = performance.now();
    const STALE_MS = 60000;
    for (const [key, time] of this._lastPlayTime.entries()) {
      if (now - time > STALE_MS) {
        this._lastPlayTime.delete(key);
      }
    }
  }

  // ---------- Synth primitives ----------

  _envGain(t0, attack, decay, sustain, sustainLevel, release, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.linearRampToValueAtTime(sustainLevel * peak, t0 + attack + decay);
    g.gain.setValueAtTime(sustainLevel * peak, t0 + attack + decay + sustain);
    g.gain.linearRampToValueAtTime(0, t0 + attack + decay + sustain + release);
    return g;
  }

  _noiseBuffer(duration) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  // ---------- Sound effects ----------

  missileSpawn() {
    if (this.muted) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    if (!this._throttle('missileSpawn', 60)) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, t0);
    osc.frequency.exponentialRampToValueAtTime(120, t0 + 0.18);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(2000, t0);
    filt.frequency.exponentialRampToValueAtTime(500, t0 + 0.18);
    const gain = this._envGain(t0, 0.005, 0.05, 0.0, 0.4, 0.13, 0.18);
    osc.connect(filt).connect(gain).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.22);
  }

  annihilation() {
    if (this.muted) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    if (!this._throttle('annihilation', 30)) return;
    const t0 = ctx.currentTime;
    // Noise burst
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(0.18);
    const nFilt = ctx.createBiquadFilter();
    nFilt.type = 'bandpass';
    nFilt.frequency.value = 1800;
    nFilt.Q.value = 1.5;
    const nGain = this._envGain(t0, 0.002, 0.04, 0, 0.3, 0.1, 0.22);
    noise.connect(nFilt).connect(nGain).connect(this.masterGain);
    noise.start(t0);
    noise.stop(t0 + 0.2);
    // Low thump
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t0);
    osc.frequency.exponentialRampToValueAtTime(50, t0 + 0.12);
    const oGain = this._envGain(t0, 0.002, 0.04, 0, 0.5, 0.08, 0.22);
    osc.connect(oGain).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.16);
  }

  cityHit() {
    if (this.muted) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    if (!this._throttle('cityHit', 100)) return;
    const t0 = ctx.currentTime;
    // Deep boom
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t0);
    osc.frequency.exponentialRampToValueAtTime(35, t0 + 0.6);
    const oGain = this._envGain(t0, 0.005, 0.1, 0.2, 0.7, 0.4, 0.5);
    osc.connect(oGain).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.75);
    // Rumble noise
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(0.5);
    const nFilt = ctx.createBiquadFilter();
    nFilt.type = 'lowpass';
    nFilt.frequency.setValueAtTime(400, t0);
    nFilt.frequency.exponentialRampToValueAtTime(80, t0 + 0.5);
    const nGain = this._envGain(t0, 0.005, 0.1, 0.2, 0.5, 0.3, 0.35);
    noise.connect(nFilt).connect(nGain).connect(this.masterGain);
    noise.start(t0);
    noise.stop(t0 + 0.55);
  }

  friendlyFire() {
    if (this.muted) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    if (!this._throttle('friendlyFire', 100)) return;
    const t0 = ctx.currentTime;
    // Sour minor-second dyad
    const freqs = [220, 233];
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.linearRampToValueAtTime(f * 0.7, t0 + 0.35);
      const g = this._envGain(t0, 0.01, 0.05, 0.15, 0.4, 0.2, 0.18);
      osc.connect(g).connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + 0.45);
    }
  }

  returnFire() {
    if (this.muted) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    if (!this._throttle('returnFire', 80)) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, t0);
    osc.frequency.exponentialRampToValueAtTime(1320, t0 + 0.18);
    const g = this._envGain(t0, 0.005, 0.05, 0.05, 0.5, 0.12, 0.3);
    osc.connect(g).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.25);
  }

  ricochet() {
    if (this.muted) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    if (!this._throttle('ricochet', 80)) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1800, t0);
    osc.frequency.exponentialRampToValueAtTime(300, t0 + 0.22);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 1200;
    filt.Q.value = 4;
    const g = this._envGain(t0, 0.002, 0.04, 0.05, 0.6, 0.15, 0.35);
    osc.connect(filt).connect(g).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.28);
  }

  inkPlace() {
    if (this.muted) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    if (!this._throttle('inkPlace', 40)) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t0);
    osc.frequency.exponentialRampToValueAtTime(660, t0 + 0.05);
    const g = this._envGain(t0, 0.002, 0.02, 0, 0.3, 0.04, 0.08);
    osc.connect(g).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.08);
  }

  uiClick() {
    if (this.muted) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(660, t0);
    osc.frequency.exponentialRampToValueAtTime(440, t0 + 0.05);
    const g = this._envGain(t0, 0.001, 0.01, 0, 0.4, 0.04, 0.12);
    osc.connect(g).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.08);
  }

  waveStart() {
    if (this.muted) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const notes = [440, 660]; // A4, E5
    notes.forEach((f, i) => {
      const ts = t0 + i * 0.12;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, ts);
      const g = this._envGain(ts, 0.01, 0.05, 0.05, 0.5, 0.2, 0.25);
      osc.connect(g).connect(this.masterGain);
      osc.start(ts);
      osc.stop(ts + 0.35);
    });
  }

  gameOver() {
    if (this.muted) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const notes = [440, 349, 262]; // A4, F4, C4 — descending
    notes.forEach((f, i) => {
      const ts = t0 + i * 0.2;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, ts);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 1200;
      const g = this._envGain(ts, 0.02, 0.08, 0.1, 0.4, 0.3, 0.2);
      osc.connect(filt).connect(g).connect(this.masterGain);
      osc.start(ts);
      osc.stop(ts + 0.5);
    });
  }
}

export const Sfx = new SfxEngine();

// Expose for console debugging / mute toggling.
if (typeof window !== 'undefined') {
  window.Sfx = Sfx;
}
