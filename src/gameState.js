export const STATE = {
  MENU: 'menu',
  PLAYING: 'playing',
  WAVE_TRANSITION: 'wave_transition',
  GAME_OVER: 'game_over',
  PAUSED: 'paused',
};

export class GameState {
  constructor() {
    this.state = STATE.MENU;
    this.transitionTimer = 0;
    this._previousState = null;
    // Pub/sub listeners for state changes.
    this._listeners = new Set();
  }

  set(s) {
    if (!Object.values(STATE).includes(s)) {
      console.warn(`[GameState] Unknown state: ${s}`);
      return;
    }
    if (s !== this.state) {
      this._previousState = this.state;
      const old = this.state;
      this.state = s;
      for (const fn of this._listeners) {
        try {
          fn(s, old);
        } catch (e) {
          console.warn('[GameState] Listener failed:', e);
        }
      }
      return;
    }
    this.state = s;
  }

  is(s) {
    return this.state === s;
  }
  getPrevious() {
    return this._previousState;
  }
  /**
   * Subscribe to state changes. Callback receives (newState, oldState).
   * Returns an unsubscribe function.
   */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
}
