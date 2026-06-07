import { CONFIG, SPEED_PRESETS } from './config.js';
import { Logger } from './logger.js';

/**
 * Compact time control widget. Provides:
 *   - Play/Pause toggle
 *   - Step-forward (only when paused)
 *   - Slower / Faster buttons
 *   - Logarithmic speed slider (Paused → 64x)
 *   - Current speed display
 */
export class TimeControl {
  constructor(opts = {}) {
    this.container = opts.container;
    this.onStepForward = opts.onStepForward || (() => {});
    this.onSpeedChange = opts.onSpeedChange || (() => {});

    // Cap speed presets at 64x for the compact slider (drop Ultra 128x/256x).
    this._cap64Idx = SPEED_PRESETS.findIndex((p) => p.value === 64.0);
    if (this._cap64Idx < 0) this._cap64Idx = SPEED_PRESETS.length - 1;
    this._maxIdx = this._cap64Idx;

    // Pre-pause index for resume.
    this._prePauseIdx = SPEED_PRESETS.findIndex((p) => p.value === 1.0);

    this._build();
    this._wire();
    this._syncFromConfig();
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'time-control';
    root.className = 'time-control';
    root.innerHTML = `
          <button class="tc-btn tc-btn-icon" id="tc-pause" title="Play / Pause [Space]">⏸</button>
          <button class="tc-btn tc-btn-icon" id="tc-step" title="Step forward one tick [N]">⏭</button>
          <button class="tc-btn tc-btn-icon" id="tc-slower" title="Slower [[ or ,]">◀◀</button>
          <input type="range" id="tc-slider" class="tc-slider"
                 min="0" max="${this._maxIdx}" step="1" value="3"
                 title="Simulation speed" />
          <button class="tc-btn tc-btn-icon" id="tc-faster" title="Faster [] or .]">▶▶</button>
          <span class="tc-label" id="tc-label">1x</span>
        `;
    if (this.container) {
      this.container.appendChild(root);
    }
    this.root = root;
    this.pauseBtn = root.querySelector('#tc-pause');
    this.stepBtn = root.querySelector('#tc-step');
    this.slowerBtn = root.querySelector('#tc-slower');
    this.fasterBtn = root.querySelector('#tc-faster');
    this.slider = root.querySelector('#tc-slider');
    this.label = root.querySelector('#tc-label');
  }

  _wire() {
    this.pauseBtn.addEventListener('click', () => this.togglePause());
    this.stepBtn.addEventListener('click', () => {
      try {
        this.onStepForward();
      } catch (e) {
        Logger.error('TimeControl step handler failed', e);
      }
    });
    this.slowerBtn.addEventListener('click', () => this._nudge(-1));
    this.fasterBtn.addEventListener('click', () => this._nudge(+1));
    this.slider.addEventListener('input', () => this._applyFromSlider());
  }

  _nudge(delta) {
    const cur = parseInt(this.slider.value, 10) || 0;
    this.setIndex(cur + delta);
  }

  _applyFromSlider() {
    const idx = Math.max(0, Math.min(this._maxIdx, parseInt(this.slider.value, 10) || 0));
    const preset = SPEED_PRESETS[idx];
    CONFIG.SPEED_MULTIPLIER = preset.value;
    this._updateLabel(preset);
    this._updateButtons(preset);
    try {
      this.onSpeedChange(preset.value, idx);
    } catch (e) {
      Logger.error('TimeControl speed-change handler failed', e);
    }
  }

  _updateLabel(preset) {
    if (!this.label) return;
    this.label.textContent = preset.value === 0 ? '⏸' : preset.name;
    this.label.classList.toggle('tc-label-paused', preset.value === 0);
    this.label.classList.toggle('tc-label-hyper', preset.value >= 8);
  }

  _updateButtons(preset) {
    if (this.pauseBtn) {
      this.pauseBtn.textContent = preset.value === 0 ? '▶' : '⏸';
      this.pauseBtn.title = preset.value === 0 ? 'Resume [Space]' : 'Pause [Space]';
    }
    if (this.stepBtn) {
      this.stepBtn.disabled = preset.value > 0;
    }
  }

  _syncFromConfig() {
    const cur = CONFIG.SPEED_MULTIPLIER;
    let idx = SPEED_PRESETS.findIndex((p) => p.value === cur);
    if (idx < 0 || idx > this._maxIdx) {
      // Find closest preset within cap.
      let bestIdx = SPEED_PRESETS.findIndex((p) => p.value === 1.0);
      let bestDiff = Infinity;
      for (let i = 0; i <= this._maxIdx; i++) {
        const diff = Math.abs(SPEED_PRESETS[i].value - cur);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      idx = bestIdx;
    }
    this.slider.value = String(idx);
    const preset = SPEED_PRESETS[idx];
    this._updateLabel(preset);
    this._updateButtons(preset);
  }

  // ---- Public API ----

  setIndex(idx) {
    const clamped = Math.max(0, Math.min(this._maxIdx, idx | 0));
    this.slider.value = String(clamped);
    this._applyFromSlider();
  }

  getIndex() {
    return parseInt(this.slider.value, 10) || 0;
  }

  togglePause() {
    const curIdx = this.getIndex();
    if (SPEED_PRESETS[curIdx].value === 0) {
      const restore =
        this._prePauseIdx != null
          ? this._prePauseIdx
          : SPEED_PRESETS.findIndex((p) => p.value === 1.0);
      this.setIndex(restore);
    } else {
      this._prePauseIdx = curIdx;
      this.setIndex(0);
    }
  }

  setPausedLabel(text) {
    if (this.label) this.label.textContent = text;
  }

  // Re-cap the slider based on grid size, mirroring the old logic.
  recapForGrid(cells) {
    let maxIdx = SPEED_PRESETS.findIndex((p) => p.value === 64.0);
    if (maxIdx < 0) maxIdx = SPEED_PRESETS.length - 1;
    if (cells < 12000) {
      const idx16 = SPEED_PRESETS.findIndex((p) => p.value === 16.0);
      if (idx16 >= 0) maxIdx = idx16;
    } else if (cells < 30000) {
      const idx32 = SPEED_PRESETS.findIndex((p) => p.value === 32.0);
      if (idx32 >= 0) maxIdx = idx32;
    }
    this._maxIdx = maxIdx;
    this.slider.max = String(maxIdx);
    this._syncFromConfig();
  }

  // Apply the current speed value back to the UI (used after external mutation).
  refresh() {
    this._syncFromConfig();
  }

  // Get whether step button is currently enabled (i.e., paused).
  get isStepEnabled() {
    return !this.stepBtn.disabled;
  }
}
