export const STATE = {
  MENU: 'menu',
  PLAYING: 'playing',
  WAVE_TRANSITION: 'wave_transition',
  GAME_OVER: 'game_over',
};

export class GameState {
  constructor() {
    this.state = STATE.MENU;
    this.transitionTimer = 0;
  }

  set(s) {
    this.state = s;
  }

  is(s) {
    return this.state === s;
  }
}
