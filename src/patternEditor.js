import { Logger } from './logger.js';
import { normalizeCells } from './patterns/library.js';
import { listRulesets, getRuleset, CompiledRuleset, CONWAY } from './rules/ruleset.js';
import { CONFIG } from './config.js';
import { parsePatternFile } from './patterns/parsers.js';
import { inferPatternMetadata } from './patterns/inferMetadata.js';

/**
 * PatternEditor — extracted from drawTools.js.
 *
 * Responsibilities:
 *  - Manage the editor grid (16x16 by default), cell toggling, transforms.
 *  - Render a time-simulated preview of the current pattern using the
 *    selected ruleset.
 *  - Save/update custom patterns; built-in (library) patterns can be
 *    loaded for editing but cannot be overwritten — the user must
 *    choose a new name (save-as).
 *
 * Wiring:
 *  - Constructed by DrawToolsPanel, which passes:
 *      - input: the InputManager (for setPattern, transforms)
 *      - patternCapture: the PatternCapture instance (save/list/delete)
 *      - onChange: optional callback whenever editor cells change
 *      - onOpen / onClose: lifecycle hooks
 */

const EDITOR_MIN_SIZE = 3;
const EDITOR_MAX_SIZE = 64;
const PREVIEW_GRID_SIZE = 32; // default grid size; auto-grows for larger patterns
const PREVIEW_MIN_GRID_SIZE = 16;
const PREVIEW_MAX_GRID_SIZE = 128;
const PREVIEW_CANVAS_BASE = 240; // base canvas pixel size
const PREVIEW_CANVAS_MAX = 480; // max canvas pixel size for very large patterns
const PREVIEW_DEFAULT_SPEED = 8; // ticks/sec

// Tiny toroidal Life sim used only by the editor preview.
class EditorPreviewSim {
  constructor(size, rule) {
    this.size = size;
    this.rule = rule;
    this.cells = new Uint8Array(size * size);
    this.next = new Uint8Array(size * size);
    this.generation = 0;
  }
  setRule(rule) {
    this.rule = rule;
  }
  clear() {
    this.cells.fill(0);
    this.generation = 0;
  }
  stampCentered(coords) {
    this.clear();
    if (!coords || coords.length === 0) return;
    let maxX = 0,
      maxY = 0;
    for (const [x, y] of coords) {
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const pw = maxX + 1;
    const ph = maxY + 1;
    const offX = Math.floor((this.size - pw) / 2);
    const offY = Math.floor((this.size - ph) / 2);
    for (const [x, y] of coords) {
      const px = (((x + offX) % this.size) + this.size) % this.size;
      const py = (((y + offY) % this.size) + this.size) % this.size;
      this.cells[py * this.size + px] = 1;
    }
  }
  tick() {
    const s = this.size;
    const cells = this.cells;
    const next = this.next;
    const rule = this.rule;
    for (let y = 0; y < s; y++) {
      const yUp = (y - 1 + s) % s;
      const yDn = (y + 1) % s;
      for (let x = 0; x < s; x++) {
        const xLt = (x - 1 + s) % s;
        const xRt = (x + 1) % s;
        const n =
          cells[yUp * s + xLt] +
          cells[yUp * s + x] +
          cells[yUp * s + xRt] +
          cells[y * s + xLt] +
          cells[y * s + xRt] +
          cells[yDn * s + xLt] +
          cells[yDn * s + x] +
          cells[yDn * s + xRt];
        const alive = cells[y * s + x];
        let nv;
        if (alive) nv = rule.shouldSurvive(n) ? 1 : 0;
        else nv = rule.shouldBirth(n) ? 1 : 0;
        next[y * s + x] = nv;
      }
    }
    const tmp = this.cells;
    this.cells = next;
    this.next = tmp;
    this.generation++;
  }
  population() {
    let n = 0;
    for (let i = 0; i < this.cells.length; i++) n += this.cells[i];
    return n;
  }
}
/**
 * Sparse, dynamically-expanding Life preview. Uses a Set of "x,y"
 * keys so the pattern can grow arbitrarily without a fixed grid
 * size. Mirrors the simulation strategy used by inferPatternMetadata
 * so what you see in the preview matches what inference observes.
 */
class SparsePreviewSim {
  constructor(rule) {
    this.rule = rule;
    this.live = new Set();
    this.generation = 0;
    this.bounds = null; // {minX, minY, maxX, maxY}
  }
  setRule(rule) {
    this.rule = rule;
  }
  clear() {
    this.live.clear();
    this.generation = 0;
    this.bounds = null;
  }
  stampCentered(coords) {
    this.clear();
    if (!coords || coords.length === 0) return;
    for (const [x, y] of coords) {
      this.live.add(`${x},${y}`);
    }
    this._recomputeBounds();
  }
  _recomputeBounds() {
    if (this.live.size === 0) {
      this.bounds = null;
      return;
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const k of this.live) {
      const [x, y] = k.split(',').map(Number);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    this.bounds = { minX, minY, maxX, maxY };
  }
  tick() {
    // Use Moore neighborhood — matches the preview's tiny ruleset usage.
    const counts = new Map();
    for (const k of this.live) {
      const [x, y] = k.split(',').map(Number);
      if (!counts.has(k)) counts.set(k, 0);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nk = `${x + dx},${y + dy}`;
          counts.set(nk, (counts.get(nk) || 0) + 1);
        }
      }
    }
    const next = new Set();
    const rule = this.rule;
    for (const [k, n] of counts) {
      const alive = this.live.has(k);
      if (alive ? rule.shouldSurvive(n) : rule.shouldBirth(n)) {
        next.add(k);
      }
    }
    this.live = next;
    this.generation++;
    this._recomputeBounds();
  }
  population() {
    return this.live.size;
  }
}

export class PatternEditor {
  constructor({ input, patternCapture, onChange, onOpen, onClose } = {}) {
    this.input = input;
    this.patternCapture = patternCapture;
    this.onChange = typeof onChange === 'function' ? onChange : null;
    this.onOpen = typeof onOpen === 'function' ? onOpen : null;
    this.onClose = typeof onClose === 'function' ? onClose : null;

    // Dynamic grid dimensions — grow/shrink with pattern.
    this.editorWidth = EDITOR_MIN_SIZE;
    this.editorHeight = EDITOR_MIN_SIZE;
    this.editorCells = new Set(); // "x,y" strings

    // Mode tracking:
    //   - 'view' : stamping built-in pattern; saving => new custom pattern
    //   - 'new'  : creating a fresh pattern
    //   - 'edit' : editing existing CUSTOM pattern; can update in-place
    //   - 'library' : editing a BUILT-IN pattern; cannot overwrite, must rename
    this._editorMode = 'view';
    this._editorEditingName = null;
    this._sourceLibraryId = null; // id of library pattern being edited (if 'library')

    this._editorPanelOpen = false;
    this._activePresetName = '';
    this._editorDirty = false;

    // Preview state.
    this._previewSim = null;
    this._sparsePreviewSim = null;
    // When true, preview uses the sparse, auto-expanding simulator
    // (matching what metadata inference does). Default ON.
    this._previewSparse = true;
    this._previewGridSize = PREVIEW_GRID_SIZE;
    this._previewRulesetId = CONFIG.ACTIVE_RULESET || 'conway';
    this._previewSpeed = PREVIEW_DEFAULT_SPEED;
    this._previewPaused = false;
    this._previewAccumMs = 0;
    this._previewLastTs = 0;
    this._previewRaf = null;
    // Inference configuration (mirrors inferPatternMetadata opts).
    this._inferConfig = {
      maxPeriod: 60,
      methuselahGens: 200,
      populationCap: 100000,
      methuselahPopRatio: 3,
      methuselahPopAbsolute: 20,
      unboundedWidthRatio: 3,
      unboundedHeightRatio: 3,
      unboundedPadding: 10,
      sustainedGrowthPeakLateFrac: 0.75,
      sustainedGrowthFinalNearPeakFrac: 0.9,
      sustainedGrowthPopRatio: 3,
      sustainedGrowthPopAbsolute: 10,
    };

    // Status timers.
    this._saveStatusTimer = null;
    this._jsonStatusTimer = null;

    this._initDom();
    this._initEditorCanvas();
    this._initTransformHints();
    this._initGridCollapse();
    this._initTabbedSections();
    this._initPreviewControls();
    this._wireToggleAndClose();
  }

  // ─────────────────────────────────────────────────────────────
  // DOM lookup / initialization
  // ─────────────────────────────────────────────────────────────
  _initDom() {
    this.overlayEl = document.getElementById('pattern-editor-overlay');
    this.panelEl = document.getElementById('pattern-editor-panel');
    this.toggleBtn = document.getElementById('pattern-editor-toggle');
    this.closeBtn = document.getElementById('pattern-editor-close');
    this.canvasEl = document.getElementById('pattern-editor');
    this.clearBtn = document.getElementById('pattern-clear');

    if (!this.overlayEl || !this.panelEl || !this.canvasEl) {
      Logger.error('[PatternEditor] Required DOM elements missing.');
      return;
    }
    // Inject a primary Save button next to the Close button in the footer.
    if (this.closeBtn && !document.getElementById('editor-save-btn')) {
      const saveBtn = document.createElement('button');
      saveBtn.id = 'editor-save-btn';
      saveBtn.type = 'button';
      saveBtn.className = 'editor-action-btn editor-action-primary';
      saveBtn.textContent = '💾 Save Pattern';
      saveBtn.style.cssText = 'margin-right:8px;';
      this.closeBtn.parentNode.insertBefore(saveBtn, this.closeBtn);
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Grid collapse/expand toggle
  // ─────────────────────────────────────────────────────────────
  _initGridCollapse() {
    if (!this.panelEl || !this.canvasEl) return;
    if (document.getElementById('pattern-editor-collapse-btn')) return;
    // Restore collapsed state from localStorage.
    let collapsed = false;
    try {
      collapsed = localStorage.getItem('patternEditor.gridCollapsed') === '1';
    } catch (_e) {
      // ignore
    }
    this._gridCollapsed = collapsed;
    // Build a header bar that sits above the canvas with a collapse toggle.
    const header = document.createElement('div');
    header.id = 'pattern-editor-grid-header';
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      max-width: 540px;
      margin-bottom: 6px;
      padding: 4px 2px;
      border-bottom: 1px dashed #2a2a5a;
    `;
    header.innerHTML = `
      <span style="font-size:12px;color:#88ddff;font-weight:bold;letter-spacing:1px;">
        ▦ DRAWING GRID
      </span>
      <button id="pattern-editor-collapse-btn" type="button"
        class="editor-action-btn"
        title="Collapse / expand the drawing grid (saves vertical space)"
        style="font-size:11px;padding:3px 10px;">
        ${collapsed ? '▸ Expand Grid' : '▾ Collapse Grid'}
      </button>
    `;
    // Insert header before the canvas in the panel.
    this.panelEl.insertBefore(header, this.canvasEl);
    // Apply initial collapsed state.
    this._applyGridCollapsed(collapsed);
    const btn = header.querySelector('#pattern-editor-collapse-btn');
    btn.addEventListener('click', () => {
      this._gridCollapsed = !this._gridCollapsed;
      this._applyGridCollapsed(this._gridCollapsed);
      btn.textContent = this._gridCollapsed ? '▸ Expand Grid' : '▾ Collapse Grid';
      try {
        localStorage.setItem('patternEditor.gridCollapsed', this._gridCollapsed ? '1' : '0');
      } catch (_e) {
        // ignore
      }
    });
  }
  _applyGridCollapsed(collapsed) {
    if (!this.canvasEl) return;
    if (collapsed) {
      this.canvasEl.style.display = 'none';
      // Also hide the transform hints row since it operates on the grid.
      const hints = document.querySelector('.pattern-editor-hints');
      if (hints) hints.style.display = 'none';
      const clearBtn = document.getElementById('pattern-clear');
      if (clearBtn) clearBtn.style.display = 'none';
    } else {
      this.canvasEl.style.display = '';
      const hints = document.querySelector('.pattern-editor-hints');
      if (hints) hints.style.display = '';
      const clearBtn = document.getElementById('pattern-clear');
      if (clearBtn) clearBtn.style.display = '';
      // Redraw in case the canvas was hidden during a state change.
      requestAnimationFrame(() => this._drawEditor());
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Tabbed sections (Preview / Metadata / JSON)
  // ─────────────────────────────────────────────────────────────
  _initTabbedSections() {
    if (!this.panelEl) return;
    if (document.getElementById('editor-tabs-container')) return;

    const container = document.createElement('div');
    container.id = 'editor-tabs-container';
    container.className = 'editor-tabs-container';
    container.style.cssText = `
       margin-top: 14px;
       width: 100%;
       max-width: 540px;
     `;
    container.innerHTML = `
       <div id="editor-tabs" style="
         display: flex;
         gap: 4px;
         border-bottom: 2px solid #2a2a5a;
         padding-bottom: 4px;
         margin-bottom: 10px;
       ">
         <button class="editor-tab active" data-tab="preview" type="button">▶ Preview</button>
         <button class="editor-tab" data-tab="metadata" type="button">📝 Metadata</button>
          <button class="editor-tab" data-tab="inference" type="button">🔍 Inference</button>
         <button class="editor-tab" data-tab="io" type="button">📋 Import/Export</button>
       </div>
       <div id="editor-tab-panels"></div>
     `;
    this.panelEl.appendChild(container);

    // Inject tab styles once.
    this._injectTabStyles();

    const panelsHost = container.querySelector('#editor-tab-panels');
    panelsHost.appendChild(this._buildPreviewPanel());
    panelsHost.appendChild(this._buildMetadataPanel());
    panelsHost.appendChild(this._buildInferencePanel());
    panelsHost.appendChild(this._buildIOPanel());

    // Wire tab switching.
    const tabs = container.querySelectorAll('.editor-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        tabs.forEach((t) => t.classList.toggle('active', t === tab));
        panelsHost.querySelectorAll('.editor-tab-panel').forEach((p) => {
          p.style.display = p.dataset.tab === targetTab ? 'block' : 'none';
        });
      });
    });

    // Populate ruleset selects and wire actions.
    this._populateRulesetSelect();
    this._wireSaveControls();
    this._wireJsonIO();
    this._wireFileImport();
    this._wireReinferButton();
    this._wireInferenceConfig();
  }

  _injectTabStyles() {
    if (document.getElementById('editor-tab-styles')) return;
    const style = document.createElement('style');
    style.id = 'editor-tab-styles';
    style.textContent = `
       .editor-tab {
         background: transparent;
         color: #8080c0;
         border: 1px solid #2a2a5a;
         padding: 6px 14px;
         font-family: inherit;
         font-size: 12px;
         cursor: pointer;
         border-radius: 4px 4px 0 0;
         transition: all 0.15s;
         font-weight: bold;
         letter-spacing: 0.5px;
       }
       .editor-tab:hover {
         color: #c0c0e0;
         border-color: #4040a0;
         background: rgba(64, 64, 160, 0.15);
       }
       .editor-tab.active {
         background: rgba(0, 255, 255, 0.12);
         color: #00ffff;
         border-color: #00ffff;
         border-bottom-color: transparent;
         box-shadow: 0 0 8px rgba(0, 255, 255, 0.25);
       }
       .editor-tab-panel {
         padding: 12px;
         background: rgba(20, 20, 60, 0.4);
         border: 1px solid #4040a0;
         border-radius: 0 4px 4px 4px;
         min-height: 200px;
       }
     `;
    document.head.appendChild(style);
  }

  _buildPreviewPanel() {
    const panel = document.createElement('div');
    panel.className = 'editor-tab-panel';
    panel.dataset.tab = 'preview';
    panel.style.display = 'block';
    panel.innerHTML = `
       <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
         <strong style="color:#66ccff;">▶ Live Preview</strong>
         <span id="editor-preview-info" style="font-size:11px;color:#a0a0c0;font-style:italic;margin-left:auto;">
           gen 0 · pop 0
         </span>
       </div>
       <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;">
         <canvas id="editor-preview-canvas" width="240" height="240"
           style="border:1px solid #4040a0;background:#000010;image-rendering:pixelated;"></canvas>
         <div style="flex:1;min-width:180px;display:flex;flex-direction:column;gap:8px;">
           <label style="font-size:11px;color:#c0c0d0;">
             Speed:
             <input id="editor-preview-speed" type="range" min="0" max="60" step="1"
               value="${PREVIEW_DEFAULT_SPEED}" style="width:100%;accent-color:#00ffff;">
             <span id="editor-preview-speed-label" style="color:#00ffff;font-weight:bold;">
               ${PREVIEW_DEFAULT_SPEED}/s
             </span>
           </label>
           <label style="font-size:11px;color:#c0c0d0;">
             Preview Ruleset:
             <select id="editor-preview-ruleset" class="setting-select" style="width:100%;"></select>
           </label>
            <label style="font-size:11px;color:#c0c0d0;display:flex;align-items:center;gap:6px;">
              <input id="editor-preview-sparse" type="checkbox" checked
                style="accent-color:#00ffff;">
              <span>Sparse / auto-expanding grid <span style="color:#8080a0;font-style:italic;">(matches inference)</span></span>
            </label>
           <div style="display:flex;gap:6px;flex-wrap:wrap;">
             <button id="editor-preview-reset" class="editor-action-btn" type="button">↺ Reset</button>
             <button id="editor-preview-pause" class="editor-action-btn" type="button">⏸ Pause</button>
             <button id="editor-preview-step" class="editor-action-btn" type="button">▷ Step</button>
           </div>
           <p style="font-size:10px;color:#8080a0;font-style:italic;margin:0;">
             Edits to the grid are mirrored into the preview automatically.
              In sparse mode, the view auto-zooms as the pattern grows.
           </p>
         </div>
       </div>
     `;
    return panel;
  }

  _buildMetadataPanel() {
    const panel = document.createElement('div');
    panel.className = 'editor-tab-panel';
    panel.dataset.tab = 'metadata';
    panel.style.display = 'none';
    panel.innerHTML = `
       <div class="editor-save-header" style="margin-bottom:10px;">💾 Save / Metadata</div>
       <div class="editor-meta-grid">
         <label class="editor-meta-row">
           <span>Name:</span>
           <input id="editor-meta-name" type="text" placeholder="my pattern" maxlength="40" />
         </label>
         <label class="editor-meta-row">
           <span>Category:</span>
           <select id="editor-meta-category">
             <option value="misc">Misc</option>
             <option value="still_life">Still Life</option>
             <option value="oscillator">Oscillator</option>
             <option value="spaceship">Spaceship</option>
             <option value="gun">Gun</option>
             <option value="methuselah">Methuselah</option>
             <option value="puffer">Puffer</option>
           </select>
         </label>
         <label class="editor-meta-row">
           <span>Period:</span>
           <input id="editor-meta-period" type="number" min="0" max="9999" step="1" value="1" />
         </label>
         <label class="editor-meta-row">
           <span>Direction:</span>
           <select id="editor-meta-direction">
             <option value="">(none)</option>
             <option value="N">North</option>
             <option value="S">South</option>
             <option value="E">East</option>
             <option value="W">West</option>
             <option value="NE">NE</option>
             <option value="NW">NW</option>
             <option value="SE">SE</option>
             <option value="SW">SW</option>
           </select>
         </label>
         <label class="editor-meta-row editor-meta-row-wide">
           <span>Ruleset:</span>
           <select id="editor-meta-ruleset" title="Ruleset this pattern is designed for"></select>
         </label>
         <label class="editor-meta-row editor-meta-row-wide">
           <span>Tags:</span>
           <input id="editor-meta-tags" type="text" placeholder="custom, my-tag, ..." />
         </label>
         <label class="editor-meta-row editor-meta-row-wide">
           <span>Description:</span>
           <input id="editor-meta-desc" type="text" placeholder="A pattern I made..." maxlength="200" />
         </label>
       </div>
       <div class="editor-save-buttons" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <span id="editor-meta-status" class="editor-save-status"></span>
       </div>
        <p style="font-size:11px;color:#8080a0;font-style:italic;margin-top:8px;">
          Tip: use the <strong>🔍 Inference</strong> tab to auto-detect category,
          period, direction, and detailed statistics.
        </p>
     `;
    return panel;
  }
  _buildInferencePanel() {
    const panel = document.createElement('div');
    panel.className = 'editor-tab-panel';
    panel.dataset.tab = 'inference';
    panel.style.display = 'none';
    const cfg = this._inferConfig;
    panel.innerHTML = `
       <div style="font-size:13px;font-weight:bold;color:#88ddff;margin-bottom:10px;letter-spacing:1px;">
         🔍 METADATA INFERENCE
       </div>
       <p style="font-size:11px;color:#a0a0c0;margin:0 0 12px;">
         Run a sparse, auto-expanding simulation to characterize the pattern. Results
         are written back into the Metadata tab.
       </p>
       <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
         <button id="editor-reinfer-btn" class="editor-action-btn editor-action-primary" type="button"
           title="Re-run simulation to auto-detect category, period, direction, etc.">
           🔍 Run Inference
         </button>
         <button id="editor-infer-reset-defaults" class="editor-action-btn" type="button"
           title="Reset inference parameters to defaults">
           ↺ Reset Defaults
         </button>
         <span id="editor-infer-status" style="font-size:11px;color:#a0a0c0;font-style:italic;"></span>
       </div>
       <details style="margin-bottom:12px;">
         <summary style="cursor:pointer;color:#ffcc44;font-size:12px;font-weight:bold;
           padding:4px 0;">⚙ Inference Parameters</summary>
         <div style="
           margin-top:8px;padding:8px 10px;
           background:rgba(10,10,30,0.4);
           border:1px dashed #4040a0;border-radius:3px;
           display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;
           font-size:11px;color:#c0c0d0;
         ">
           <label>Max period search:
             <input id="cfg-maxPeriod" type="number" min="1" max="10000" step="1"
               value="${cfg.maxPeriod}" style="width:100%;">
           </label>
           <label>Methuselah generations:
             <input id="cfg-methuselahGens" type="number" min="10" max="100000" step="10"
               value="${cfg.methuselahGens}" style="width:100%;">
           </label>
           <label>Population cap:
             <input id="cfg-populationCap" type="number" min="100" max="10000000" step="100"
               value="${cfg.populationCap}" style="width:100%;">
           </label>
           <label>Methuselah pop ratio:
             <input id="cfg-methuselahPopRatio" type="number" min="1" max="100" step="0.1"
               value="${cfg.methuselahPopRatio}" style="width:100%;">
           </label>
           <label>Methuselah pop absolute:
             <input id="cfg-methuselahPopAbsolute" type="number" min="0" max="10000" step="1"
               value="${cfg.methuselahPopAbsolute}" style="width:100%;">
           </label>
           <label>Unbounded width ratio:
             <input id="cfg-unboundedWidthRatio" type="number" min="1" max="100" step="0.1"
               value="${cfg.unboundedWidthRatio}" style="width:100%;">
           </label>
           <label>Unbounded height ratio:
             <input id="cfg-unboundedHeightRatio" type="number" min="1" max="100" step="0.1"
               value="${cfg.unboundedHeightRatio}" style="width:100%;">
           </label>
           <label>Unbounded padding:
             <input id="cfg-unboundedPadding" type="number" min="0" max="1000" step="1"
               value="${cfg.unboundedPadding}" style="width:100%;">
           </label>
           <label>Sustained growth: peak-late frac:
             <input id="cfg-sustainedGrowthPeakLateFrac" type="number" min="0" max="1" step="0.05"
               value="${cfg.sustainedGrowthPeakLateFrac}" style="width:100%;">
           </label>
           <label>Sustained growth: final/peak:
             <input id="cfg-sustainedGrowthFinalNearPeakFrac" type="number" min="0" max="1" step="0.05"
               value="${cfg.sustainedGrowthFinalNearPeakFrac}" style="width:100%;">
           </label>
           <label>Sustained growth: pop ratio:
             <input id="cfg-sustainedGrowthPopRatio" type="number" min="1" max="100" step="0.1"
               value="${cfg.sustainedGrowthPopRatio}" style="width:100%;">
           </label>
           <label>Sustained growth: pop absolute:
             <input id="cfg-sustainedGrowthPopAbsolute" type="number" min="0" max="10000" step="1"
               value="${cfg.sustainedGrowthPopAbsolute}" style="width:100%;">
           </label>
         </div>
       </details>
       <div id="editor-reinfer-result" style="
         padding: 10px 12px;
         background: rgba(10, 10, 30, 0.6);
         border: 1px dashed #4040a0;
         border-radius: 3px;
         font-size: 11px;
         color: #a0a0c0;
         display: none;
         font-family: 'Courier New', monospace;
         line-height: 1.6;
         white-space: pre-wrap;
         max-height: 360px;
         overflow-y: auto;
       "></div>
     `;
    return panel;
  }
  _wireInferenceConfig() {
    const cfgKeys = Object.keys(this._inferConfig);
    for (const key of cfgKeys) {
      const el = document.getElementById(`cfg-${key}`);
      if (!el) continue;
      el.addEventListener('change', () => {
        const v = parseFloat(el.value);
        if (Number.isFinite(v)) this._inferConfig[key] = v;
      });
    }
    const resetBtn = document.getElementById('editor-infer-reset-defaults');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this._inferConfig = {
          maxPeriod: 60,
          methuselahGens: 200,
          populationCap: 100000,
          methuselahPopRatio: 3,
          methuselahPopAbsolute: 20,
          unboundedWidthRatio: 3,
          unboundedHeightRatio: 3,
          unboundedPadding: 10,
          sustainedGrowthPeakLateFrac: 0.75,
          sustainedGrowthFinalNearPeakFrac: 0.9,
          sustainedGrowthPopRatio: 3,
          sustainedGrowthPopAbsolute: 10,
        };
        for (const key of Object.keys(this._inferConfig)) {
          const el = document.getElementById(`cfg-${key}`);
          if (el) el.value = this._inferConfig[key];
        }
        const statusEl = document.getElementById('editor-infer-status');
        if (statusEl) {
          statusEl.textContent = 'Defaults restored.';
          statusEl.style.color = '#88ff88';
          setTimeout(() => {
            if (statusEl) statusEl.textContent = '';
          }, 2000);
        }
      });
    }
  }

  _buildIOPanel() {
    const panel = document.createElement('div');
    panel.className = 'editor-tab-panel';
    panel.dataset.tab = 'io';
    panel.style.display = 'none';
    panel.innerHTML = `
       <div class="editor-json-header" style="
         font-size:13px;font-weight:bold;color:#88ddff;
         padding: 0 0 10px 0; letter-spacing: 1px;
       ">📋 Import / Export</div>

       <div style="margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px dashed #2a2a5a;">
         <div style="font-size:11px;color:#ffcc44;font-weight:bold;margin-bottom:6px;letter-spacing:1px;">
           📂 IMPORT FROM FILE
         </div>
         <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
           <input id="editor-file-input" type="file" accept=".rle,.cells,.txt"
             style="display:none;" />
           <button id="editor-file-import-btn" class="editor-action-btn editor-action-primary" type="button"
             title="Import .rle or .cells file from disk">
             📂 Choose File...
           </button>
           <span id="editor-file-status" style="font-size:11px;color:#a0a0c0;font-style:italic;"></span>
         </div>
         <p style="font-size:10px;color:#8080a0;font-style:italic;margin:6px 0 0;">
           Supports <code style="color:#ffcc44;">.rle</code> (Run-Length Encoded) and
           <code style="color:#ffcc44;">.cells</code> (plaintext) formats.
         </p>
       </div>

       <div style="font-size:11px;color:#88ddff;font-weight:bold;margin-bottom:6px;letter-spacing:1px;">
         📋 IMPORT / EXPORT
       </div>
       <div class="editor-json-buttons" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">
         <button id="editor-json-export" class="editor-action-btn" type="button">📤 Export Current</button>
         <button id="editor-json-copy" class="editor-action-btn editor-action-primary" type="button">📋 Copy to Clipboard</button>
         <button id="editor-json-import" class="editor-action-btn editor-action-primary" type="button">📥 Import from Box</button>
         <span id="editor-json-status" class="editor-save-status"></span>
       </div>
       <textarea id="editor-json-textarea" class="editor-json-textarea"
         rows="10"
         placeholder='Click "Export Current" to dump cells + metadata as JSON, or paste a JSON / RLE / .cells pattern here and click "Import from Box" (format is auto-detected).'
       ></textarea>
       <p class="editor-json-hint">
         Supports auto-detected <strong>JSON</strong>, <strong>RLE</strong>, and <strong>.cells</strong> formats.<br>
         JSON schema: <code>{ "name": "...", "cells": [[x,y],...], "meta": { "category", "period", "direction", "description", "tags", "rulesets" } }</code>
       </p>
     `;
    return panel;
  }

  // ─────────────────────────────────────────────────────────────
  // Editor canvas (grid editing)
  // ─────────────────────────────────────────────────────────────
  _initEditorCanvas() {
    if (!this.canvasEl) return;
    this.editorCtx = this.canvasEl.getContext('2d');
    if (!this.editorCtx) {
      Logger.warn('[PatternEditor] no 2D context on editor canvas.');
      return;
    }
    this._drawEditor();

    const handle = (e) => {
      const rect = this.canvasEl.getBoundingClientRect();
      const scaleX = this.canvasEl.width / rect.width;
      const scaleY = this.canvasEl.height / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top) * scaleY;
      const csX = this.canvasEl.width / this.editorWidth;
      const csY = this.canvasEl.height / this.editorHeight;
      const x = Math.floor(px / csX);
      const y = Math.floor(py / csY);
      if (x < 0 || x >= this.editorWidth || y < 0 || y >= this.editorHeight) return;
      const key = `${x},${y}`;
      if (this.editorCells.has(key)) {
        this.editorCells.delete(key);
        // Removed a cell — auto-trim/recenter.
        this._autoFitGrid();
      } else {
        this.editorCells.add(key);
        // Added a cell — may need to grow if on border.
        this._autoFitGrid();
      }
      this._editorDirty = true;
      this._activePresetName = '';
      this._syncPresetCombobox();
      this._syncPatternToInput();
      this._drawEditor();
      this._refreshPreview();
    };
    this.canvasEl.addEventListener('mousedown', handle);

    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', () => {
        this.editorCells.clear();
        this.editorWidth = EDITOR_MIN_SIZE;
        this.editorHeight = EDITOR_MIN_SIZE;
        this._editorDirty = true;
        this._activePresetName = '';
        this._syncPresetCombobox();
        this._syncPatternToInput();
        this._drawEditor();
        this._refreshPreview();
      });
    }
  }

  _drawEditor() {
    if (!this.editorCtx) return;
    const ctx = this.editorCtx;
    const w = this.canvasEl.width;
    const h = this.canvasEl.height;
    const csX = w / this.editorWidth;
    const csY = h / this.editorHeight;
    ctx.fillStyle = '#000010';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1a1a3a';
    ctx.lineWidth = 1;
    for (let i = 0; i <= this.editorWidth; i++) {
      const px = i * csX + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
    for (let i = 0; i <= this.editorHeight; i++) {
      const py = i * csY + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }
    ctx.fillStyle = '#00ff88';
    for (const key of this.editorCells) {
      const [x, y] = key.split(',').map(Number);
      ctx.fillRect(x * csX + 1, y * csY + 1, csX - 2, csY - 2);
    }
    // Show size indicator in corner.
    ctx.fillStyle = 'rgba(136,221,255,0.6)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${this.editorWidth}×${this.editorHeight}`, 4, 4);
  }
  /**
   * Auto-fit the grid to the current cell set:
   *  - Compute bounding box of live cells.
   *  - Target size = bbox + 3-cell border on each side (min 3×3).
   *  - Width and height are kept equal (square grid).
   *  - Recenter cells inside the new grid.
   *  - Capped at EDITOR_MAX_SIZE.
   */
  _autoFitGrid() {
    if (this.editorCells.size === 0) {
      this.editorWidth = EDITOR_MIN_SIZE;
      this.editorHeight = EDITOR_MIN_SIZE;
      return;
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const key of this.editorCells) {
      const [x, y] = key.split(',').map(Number);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    // Target grid: bbox + 3 border each side = bbox + 6; min 3.
    // Keep width and height equal (square grid).
    let targetW = Math.max(EDITOR_MIN_SIZE, bw + 6);
    let targetH = Math.max(EDITOR_MIN_SIZE, bh + 6);
    let target = Math.max(targetW, targetH);
    if (target > EDITOR_MAX_SIZE) target = EDITOR_MAX_SIZE;
    targetW = target;
    targetH = target;
    // New origin: center bbox inside the square grid.
    const offX = Math.floor((targetW - bw) / 2) - minX;
    const offY = Math.floor((targetH - bh) / 2) - minY;
    const newCells = new Set();
    for (const key of this.editorCells) {
      const [x, y] = key.split(',').map(Number);
      const nx = x + offX;
      const ny = y + offY;
      if (nx >= 0 && nx < targetW && ny >= 0 && ny < targetH) {
        newCells.add(`${nx},${ny}`);
      }
    }
    this.editorCells = newCells;
    this.editorWidth = targetW;
    this.editorHeight = targetH;
  }

  // ─────────────────────────────────────────────────────────────
  // Transforms (rotate, flip)
  // ─────────────────────────────────────────────────────────────
  _initTransformHints() {
    const hintsContainer = document.querySelector('.pattern-editor-hints');
    if (!hintsContainer) return;
    const rows = hintsContainer.querySelectorAll('div');
    if (rows.length < 3) return;
    const wireRow = (row, handler, title) => {
      row.classList.add('pattern-editor-hint-clickable');
      row.title = title;
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handler();
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handler();
        }
      });
    };
    wireRow(rows[0], () => this.transformRotate(), 'Click to rotate pattern 90° CW');
    wireRow(rows[1], () => this.transformFlipH(), 'Click to flip pattern horizontally');
    wireRow(rows[2], () => this.transformFlipV(), 'Click to flip pattern vertically');
  }

  transformRotate() {
    if (this.editorCells.size === 0) return;
    const cells = [...this.editorCells].map((k) => k.split(',').map(Number));
    const rotated = cells.map(([x, y]) => [y, -x]);
    this._replaceEditorCells(rotated);
  }
  transformFlipH() {
    if (this.editorCells.size === 0) return;
    const cells = [...this.editorCells].map((k) => k.split(',').map(Number));
    const flipped = cells.map(([x, y]) => [-x, y]);
    this._replaceEditorCells(flipped);
  }
  transformFlipV() {
    if (this.editorCells.size === 0) return;
    const cells = [...this.editorCells].map((k) => k.split(',').map(Number));
    const flipped = cells.map(([x, y]) => [x, -y]);
    this._replaceEditorCells(flipped);
  }

  _replaceEditorCells(coords) {
    if (coords.length === 0) return;
    this.editorCells.clear();
    for (const [x, y] of coords) {
      this.editorCells.add(`${x},${y}`);
    }
    this._autoFitGrid();
    if (this.input) {
      this.input.patternRotation = 0;
      this.input.patternFlipH = false;
      this.input.patternFlipV = false;
    }
    this._editorDirty = true;
    this._activePresetName = '';
    this._syncPresetCombobox();
    this._syncPatternToInput();
    this._drawEditor();
    this._refreshPreview();
  }

  // ─────────────────────────────────────────────────────────────
  // Open/close lifecycle
  // ─────────────────────────────────────────────────────────────
  _wireToggleAndClose() {
    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', () => {
        if (this._editorPanelOpen) this.close();
        else this.open();
      });
    }
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.close());
    }
    if (this.overlayEl) {
      this.overlayEl.addEventListener('click', (e) => {
        if (e.target === this.overlayEl) this.close();
      });
    }
    window.addEventListener('keydown', (e) => {
      if (this._editorPanelOpen && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
  }

  isOpen() {
    return this._editorPanelOpen;
  }

  open() {
    if (!this.overlayEl) return;
    this._editorPanelOpen = true;
    this.overlayEl.classList.remove('hidden');
    if (this.toggleBtn) {
      this.toggleBtn.classList.add('active');
      this.toggleBtn.textContent = '✏ Close Editor';
    }
    this._updateSaveUI();
    requestAnimationFrame(() => {
      this._drawEditor();
      this._ensurePreviewReady();
      this._refreshPreview();
    });
    this._startPreviewLoop();
    if (this.onOpen) {
      try {
        this.onOpen();
      } catch (e) {
        Logger.error('[PatternEditor] onOpen failed', e);
      }
    }
    Logger.info('[PatternEditor] Opened.');
  }

  close() {
    if (!this._editorPanelOpen) return;
    this._editorPanelOpen = false;
    if (this.overlayEl) this.overlayEl.classList.add('hidden');
    if (this.toggleBtn) {
      this.toggleBtn.classList.remove('active');
      this.toggleBtn.textContent = '✏ Edit Pattern';
    }
    this._editorMode = 'view';
    this._editorEditingName = null;
    this._sourceLibraryId = null;
    this._stopPreviewLoop();
    if (this.onClose) {
      try {
        this.onClose();
      } catch (e) {
        Logger.error('[PatternEditor] onClose failed', e);
      }
    }
    Logger.info('[PatternEditor] Closed.');
  }

  // ─────────────────────────────────────────────────────────────
  // Public API: load patterns into the editor
  //
  // mode:
  //   'view'    - stamping built-in (save creates new custom)
  //   'new'     - blank / fresh
  //   'edit'    - editing existing CUSTOM pattern (overwrite allowed)
  //   'library' - editing built-in LIBRARY pattern (must rename to save)
  // ─────────────────────────────────────────────────────────────
  loadPattern(cells, customName = null, mode = 'view', libraryId = null) {
    this.editorCells = new Set();
    this._editorMode = mode;
    this._editorEditingName = customName;
    this._sourceLibraryId = libraryId;
    if (cells && cells.length > 0) {
      const norm = normalizeCells(cells);
      for (const [x, y] of norm.cells) {
        this.editorCells.add(`${x},${y}`);
      }
      this._autoFitGrid();
    } else {
      this.editorWidth = EDITOR_MIN_SIZE;
      this.editorHeight = EDITOR_MIN_SIZE;
    }
    this._activePresetName = customName || libraryId || '';
    this._editorDirty = false;
    this._syncPresetCombobox();
    this._syncPatternToInput();
    this._drawEditor();
    this._syncMetaFieldsFromCustom(customName);
    this._updateSaveUI();
    this._refreshPreview();
  }

  // For DrawTools backwards-compat: old method name.
  loadPatternIntoEditor(cells, customName = null, mode = 'view', libraryId = null) {
    this.loadPattern(cells, customName, mode, libraryId);
  }

  // Cell access for hotkey-triggered transforms in DrawToolsPanel.
  get cells() {
    return this.editorCells;
  }

  markDirty() {
    this._editorDirty = true;
    this._activePresetName = '';
    this._syncPresetCombobox();
    this._refreshPreview();
  }

  redraw() {
    this._drawEditor();
    this._refreshPreview();
  }

  // ─────────────────────────────────────────────────────────────
  // Sync helpers
  // ─────────────────────────────────────────────────────────────
  _collectCellsArray() {
    const cells = [];
    for (const key of this.editorCells) {
      const [x, y] = key.split(',').map(Number);
      cells.push([x, y]);
    }
    return cells;
  }

  _syncPatternToInput() {
    if (!this.input) return;
    this.input.setPattern(this._collectCellsArray());
    if (this.onChange) {
      try {
        this.onChange();
      } catch (e) {
        Logger.error('[PatternEditor] onChange failed', e);
      }
    }
  }

  _syncPresetCombobox() {
    const sel = document.getElementById('pattern-presets');
    if (!sel) return;
    if (this._activePresetName && !this._editorDirty) {
      const exists = Array.from(sel.options).some((o) => o.value === this._activePresetName);
      sel.value = exists ? this._activePresetName : '';
    } else {
      sel.value = '';
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Preview (time-simulated)
  // ─────────────────────────────────────────────────────────────
  _initPreviewControls() {
    // Populate ruleset select.
    const sel = document.getElementById('editor-preview-ruleset');
    if (sel) {
      sel.innerHTML = '';
      for (const def of listRulesets()) {
        const opt = document.createElement('option');
        opt.value = def.id;
        opt.textContent = `${def.name}${def.notation ? ` (${def.notation})` : ''}`;
        sel.appendChild(opt);
      }
      sel.value = this._previewRulesetId;
      sel.addEventListener('change', () => {
        this._previewRulesetId = sel.value;
        this._ensurePreviewReady(true);
        this._refreshPreview();
      });
    }

    const speedSlider = document.getElementById('editor-preview-speed');
    const speedLabel = document.getElementById('editor-preview-speed-label');
    if (speedSlider && speedLabel) {
      speedSlider.addEventListener('input', () => {
        this._previewSpeed = parseInt(speedSlider.value, 10) || 0;
        speedLabel.textContent = this._previewSpeed === 0 ? 'Paused' : `${this._previewSpeed}/s`;
      });
    }
    const sparseToggle = document.getElementById('editor-preview-sparse');
    if (sparseToggle) {
      sparseToggle.checked = this._previewSparse;
      sparseToggle.addEventListener('change', () => {
        this._previewSparse = sparseToggle.checked;
        // Force reinit so the right sim type is in place.
        this._previewSim = null;
        this._sparsePreviewSim = null;
        this._ensurePreviewReady(true);
        this._refreshPreview();
      });
    }

    const resetBtn = document.getElementById('editor-preview-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => this._refreshPreview());

    const pauseBtn = document.getElementById('editor-preview-pause');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        this._previewPaused = !this._previewPaused;
        pauseBtn.textContent = this._previewPaused ? '▶ Resume' : '⏸ Pause';
      });
    }

    const stepBtn = document.getElementById('editor-preview-step');
    if (stepBtn) {
      stepBtn.addEventListener('click', () => {
        this._ensurePreviewReady();
        const sim = this._activePreviewSim();
        if (sim) {
          sim.tick();
          this._drawPreview();
          this._updatePreviewInfo();
        }
      });
    }
  }
  _activePreviewSim() {
    return this._previewSparse ? this._sparsePreviewSim : this._previewSim;
  }

  _compilePreviewRule() {
    const def = getRuleset(this._previewRulesetId) || CONWAY;
    // Exotic rules: fall back to Conway for the preview since the tiny
    // sim only knows Moore neighborhoods. Good enough for editor preview.
    if (def._exoticType && def._exoticCompiled) {
      return new CompiledRuleset(CONWAY);
    }
    try {
      return new CompiledRuleset(def);
    } catch (_e) {
      return new CompiledRuleset(CONWAY);
    }
  }
  /**
   * Compute a suitable preview grid size for the current pattern.
   * Gives the pattern at least 2x its bbox plus padding so evolution
   * (especially for spaceships / methuselahs) has room to breathe.
   */
  _computePreviewGridSize() {
    const cells = this._collectCellsArray();
    if (cells.length === 0) return PREVIEW_GRID_SIZE;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [x, y] of cells) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const maxDim = Math.max(bw, bh);
    // Target: pattern fills ~40% of preview grid, with at least 8 cells of
    // padding on every side so evolution has somewhere to go.
    let target = Math.max(maxDim * 2 + 16, PREVIEW_GRID_SIZE);
    // Round up to a clean even number.
    target = Math.ceil(target / 2) * 2;
    if (target < PREVIEW_MIN_GRID_SIZE) target = PREVIEW_MIN_GRID_SIZE;
    if (target > PREVIEW_MAX_GRID_SIZE) target = PREVIEW_MAX_GRID_SIZE;
    return target;
  }
  /**
   * Resize the preview canvas pixel dimensions so that each cell stays
   * reasonably visible for the chosen grid size.
   */
  _resizePreviewCanvas(gridSize) {
    const canvas = document.getElementById('editor-preview-canvas');
    if (!canvas) return;
    // Aim for ~7-8 pixels per cell at default, scaling up the canvas
    // for larger grids so cells don't get unreadable.
    let pxPerCell = Math.max(4, Math.floor(PREVIEW_CANVAS_BASE / gridSize));
    let canvasSize = pxPerCell * gridSize;
    if (canvasSize < PREVIEW_CANVAS_BASE) canvasSize = PREVIEW_CANVAS_BASE;
    if (canvasSize > PREVIEW_CANVAS_MAX) canvasSize = PREVIEW_CANVAS_MAX;
    if (canvas.width !== canvasSize || canvas.height !== canvasSize) {
      canvas.width = canvasSize;
      canvas.height = canvasSize;
      // Keep CSS size in sync (so it doesn't get stretched by the
      // inline width="240" / height="240" attributes from buildPreviewPanel).
      canvas.style.width = `${canvasSize}px`;
      canvas.style.height = `${canvasSize}px`;
    }
  }

  _ensurePreviewReady(forceRuleRefresh = false) {
    if (this._previewSparse) {
      const rule = this._compilePreviewRule();
      if (!this._sparsePreviewSim) {
        this._sparsePreviewSim = new SparsePreviewSim(rule);
      } else if (forceRuleRefresh) {
        this._sparsePreviewSim.setRule(rule);
      }
      // Make sure canvas has a reasonable size for sparse display.
      const canvas = document.getElementById('editor-preview-canvas');
      if (
        canvas &&
        (canvas.width !== PREVIEW_CANVAS_BASE || canvas.height !== PREVIEW_CANVAS_BASE)
      ) {
        canvas.width = PREVIEW_CANVAS_BASE;
        canvas.height = PREVIEW_CANVAS_BASE;
        canvas.style.width = `${PREVIEW_CANVAS_BASE}px`;
        canvas.style.height = `${PREVIEW_CANVAS_BASE}px`;
      }
      return;
    }
    const desiredSize = this._computePreviewGridSize();
    if (!this._previewSim) {
      this._previewSim = new EditorPreviewSim(desiredSize, this._compilePreviewRule());
      this._previewGridSize = desiredSize;
      this._resizePreviewCanvas(desiredSize);
    } else if (desiredSize !== this._previewGridSize) {
      // Pattern grew/shrank — rebuild sim at the new size.
      this._previewSim = new EditorPreviewSim(desiredSize, this._compilePreviewRule());
      this._previewGridSize = desiredSize;
      this._resizePreviewCanvas(desiredSize);
    } else if (forceRuleRefresh) {
      this._previewSim.setRule(this._compilePreviewRule());
    }
  }

  _refreshPreview() {
    if (!this._editorPanelOpen) return;
    this._ensurePreviewReady();
    const sim = this._activePreviewSim();
    if (!sim) return;
    sim.stampCentered(this._collectCellsArray());
    this._previewAccumMs = 0;
    this._drawPreview();
    this._updatePreviewInfo();
  }

  _startPreviewLoop() {
    if (this._previewRaf) return;
    this._previewLastTs = performance.now();
    const loop = (ts) => {
      if (!this._editorPanelOpen) {
        this._previewRaf = null;
        return;
      }
      const dt = ts - this._previewLastTs;
      this._previewLastTs = ts;
      const sim = this._activePreviewSim();
      if (sim && !this._previewPaused && this._previewSpeed > 0) {
        this._previewAccumMs += dt;
        const period = 1000 / this._previewSpeed;
        let ticks = 0;
        while (this._previewAccumMs >= period && ticks < 8) {
          sim.tick();
          this._previewAccumMs -= period;
          ticks++;
        }
        if (ticks > 0) {
          this._drawPreview();
          this._updatePreviewInfo();
        }
      }
      this._previewRaf = requestAnimationFrame(loop);
    };
    this._previewRaf = requestAnimationFrame(loop);
  }

  _stopPreviewLoop() {
    if (this._previewRaf) {
      cancelAnimationFrame(this._previewRaf);
      this._previewRaf = null;
    }
  }

  _drawPreview() {
    const canvas = document.getElementById('editor-preview-canvas');
    if (!canvas) return;
    const sim = this._activePreviewSim();
    if (!sim) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    if (this._previewSparse) {
      this._drawPreviewSparse(ctx, w, h, sim);
      return;
    }
    const size = this._previewSim.size;
    const cs = w / size;
    ctx.fillStyle = '#000010';
    ctx.fillRect(0, 0, w, h);
    // Light grid for readability when cells are big enough.
    if (cs >= 5) {
      ctx.strokeStyle = 'rgba(64,64,160,0.15)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= size; i++) {
        const p = i * cs + 0.5;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(w, p);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#00ff88';
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = Math.max(2, cs * 0.5);
    const cells = this._previewSim.cells;
    const inset = cs < 4 ? 0 : 0.5;
    const ds = cs < 4 ? Math.max(1, cs) : cs - 1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (cells[y * size + x]) {
          ctx.fillRect(x * cs + inset, y * cs + inset, ds, ds);
        }
      }
    }
    ctx.shadowBlur = 0;
  }
  /**
   * Render the sparse preview by auto-fitting to the pattern's
   * current bounding box (with padding) and scaling cells to fill
   * the canvas. The view always shows everything that's alive plus
   * a small border for context.
   */
  _drawPreviewSparse(ctx, w, h, sim) {
    ctx.fillStyle = '#000010';
    ctx.fillRect(0, 0, w, h);
    const bb = sim.bounds;
    if (!bb) return;
    // Pad bbox a little so the pattern doesn't kiss the edge.
    const padCells = 2;
    const bw = bb.maxX - bb.minX + 1 + padCells * 2;
    const bh = bb.maxY - bb.minY + 1 + padCells * 2;
    // Keep aspect square so cells don't get squashed.
    const span = Math.max(bw, bh, 8);
    const cs = Math.max(1, Math.floor(Math.min(w, h) / span));
    // Center the visible region in the canvas.
    const usedW = cs * span;
    const usedH = cs * span;
    const offX = Math.floor((w - usedW) / 2);
    const offY = Math.floor((h - usedH) / 2);
    // Origin in cell-coords that maps to (offX, offY) in pixels.
    const originX = bb.minX - padCells - Math.floor((span - bw) / 2);
    const originY = bb.minY - padCells - Math.floor((span - bh) / 2);
    // Light grid for orientation when cells are big enough.
    if (cs >= 6) {
      ctx.strokeStyle = 'rgba(64,64,160,0.12)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= span; i++) {
        const p = offX + i * cs + 0.5;
        ctx.beginPath();
        ctx.moveTo(p, offY);
        ctx.lineTo(p, offY + usedH);
        ctx.stroke();
        const q = offY + i * cs + 0.5;
        ctx.beginPath();
        ctx.moveTo(offX, q);
        ctx.lineTo(offX + usedW, q);
        ctx.stroke();
      }
    }
    // Origin marker (faint crosshair at world origin) for context.
    ctx.strokeStyle = 'rgba(120,80,40,0.25)';
    const ox = offX + (0 - originX) * cs;
    const oy = offY + (0 - originY) * cs;
    if (ox >= offX && ox <= offX + usedW && oy >= offY && oy <= offY + usedH) {
      ctx.beginPath();
      ctx.moveTo(ox + 0.5, offY);
      ctx.lineTo(ox + 0.5, offY + usedH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(offX, oy + 0.5);
      ctx.lineTo(offX + usedW, oy + 0.5);
      ctx.stroke();
    }
    ctx.fillStyle = '#00ff88';
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = Math.max(2, cs * 0.5);
    const inset = cs < 3 ? 0 : 0.5;
    const ds = cs < 3 ? Math.max(1, cs) : cs - 1;
    for (const k of sim.live) {
      const [x, y] = k.split(',').map(Number);
      const px = offX + (x - originX) * cs + inset;
      const py = offY + (y - originY) * cs + inset;
      if (px < offX - cs || py < offY - cs || px > offX + usedW || py > offY + usedH) continue;
      ctx.fillRect(px, py, ds, ds);
    }
    ctx.shadowBlur = 0;
    // Footer text: span info.
    ctx.fillStyle = 'rgba(160,160,200,0.7)';
    ctx.font = '10px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(
      `bbox ${bb.maxX - bb.minX + 1}×${bb.maxY - bb.minY + 1} · view ${span}×${span}`,
      4,
      4
    );
  }

  _updatePreviewInfo() {
    const el = document.getElementById('editor-preview-info');
    if (!el) return;
    const sim = this._activePreviewSim();
    if (!sim) return;
    const modeTag = this._previewSparse ? '∞ sparse' : `${this._previewGridSize}² torus`;
    el.textContent = `gen ${sim.generation} · pop ${sim.population()} · ${modeTag}`;
  }

  // ─────────────────────────────────────────────────────────────
  // Save / metadata UI
  // ─────────────────────────────────────────────────────────────
  _wireSaveControls() {
    const saveBtn = document.getElementById('editor-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', () => this._save(false));
  }

  _populateRulesetSelect() {
    const sel = document.getElementById('editor-meta-ruleset');
    if (!sel) return;
    sel.innerHTML = '';
    const optAny = document.createElement('option');
    optAny.value = '*';
    optAny.textContent = 'Any (universal)';
    sel.appendChild(optAny);
    for (const def of listRulesets()) {
      const opt = document.createElement('option');
      opt.value = def.id;
      opt.textContent = `${def.name}${def.notation ? ` (${def.notation})` : ''}`;
      opt.title = def.description || '';
      sel.appendChild(opt);
    }
    sel.value = CONFIG.ACTIVE_RULESET || 'conway';
  }

  _syncMetaFieldsFromCustom(name) {
    const nameEl = document.getElementById('editor-meta-name');
    const descEl = document.getElementById('editor-meta-desc');
    const tagsEl = document.getElementById('editor-meta-tags');
    const catEl = document.getElementById('editor-meta-category');
    const periodEl = document.getElementById('editor-meta-period');
    const dirEl = document.getElementById('editor-meta-direction');
    const rulesetEl = document.getElementById('editor-meta-ruleset');
    if (!nameEl) return;
    if (name && this.patternCapture) {
      const saved = this.patternCapture.getSaved(name);
      const m = (saved && saved.meta) || {};
      nameEl.value = name;
      if (descEl) descEl.value = m.description || '';
      if (tagsEl) tagsEl.value = Array.isArray(m.tags) ? m.tags.join(', ') : '';
      if (catEl) catEl.value = m.category || 'misc';
      if (periodEl) periodEl.value = m.period != null ? m.period : 1;
      if (dirEl) dirEl.value = m.direction || '';
      if (rulesetEl) {
        const capturedRule =
          m.capturedRuleset || (Array.isArray(m.rulesets) ? m.rulesets[0] : null);
        rulesetEl.value = capturedRule || CONFIG.ACTIVE_RULESET || 'conway';
      }
    } else {
      // For library mode, pre-fill name with a derivative suggestion.
      if (this._editorMode === 'library' && this._sourceLibraryId) {
        nameEl.value = `${this._sourceLibraryId} (edit)`;
      } else {
        nameEl.value = '';
      }
      if (descEl) descEl.value = '';
      if (tagsEl) tagsEl.value = '';
      if (catEl) catEl.value = 'misc';
      if (periodEl) periodEl.value = 1;
      if (dirEl) dirEl.value = '';
      if (rulesetEl) rulesetEl.value = CONFIG.ACTIVE_RULESET || 'conway';
    }
  }

  _updateSaveUI() {
    const saveBtn = document.getElementById('editor-save-btn');
    const statusEl = document.getElementById('editor-save-status');
    if (!saveBtn) return;
    if (this._editorMode === 'edit' && this._editorEditingName) {
      saveBtn.textContent = `💾 Update "${this._editorEditingName}"`;
      if (statusEl) {
        statusEl.textContent = `Editing "${this._editorEditingName}".`;
        statusEl.style.color = '#ffcc44';
      }
    } else if (this._editorMode === 'library') {
      saveBtn.textContent = '💾 Save as New Pattern';
      if (statusEl) {
        statusEl.textContent = `🔒 Library pattern "${this._sourceLibraryId}" is read-only. Choose a new name to save your changes.`;
        statusEl.style.color = '#ffaa44';
      }
    } else if (this._editorMode === 'new') {
      saveBtn.textContent = '💾 Save as New Pattern';
      if (statusEl) {
        statusEl.textContent = 'Creating a new custom pattern.';
        statusEl.style.color = '#88ff88';
      }
    } else {
      saveBtn.textContent = '💾 Save as New Pattern';
      if (statusEl) statusEl.textContent = '';
    }
  }

  _collectMeta() {
    const descEl = document.getElementById('editor-meta-desc');
    const tagsEl = document.getElementById('editor-meta-tags');
    const catEl = document.getElementById('editor-meta-category');
    const periodEl = document.getElementById('editor-meta-period');
    const dirEl = document.getElementById('editor-meta-direction');
    const rulesetEl = document.getElementById('editor-meta-ruleset');
    const tagsRaw = (tagsEl && tagsEl.value) || '';
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (!tags.includes('custom')) tags.unshift('custom');
    const rulesetId = (rulesetEl && rulesetEl.value) || '*';
    const rulesets = rulesetId === '*' ? ['*'] : [rulesetId];
    if (rulesetId !== '*' && !tags.includes(`rule:${rulesetId}`)) {
      tags.push(`rule:${rulesetId}`);
    }
    // If this came from a library pattern, leave a breadcrumb.
    const meta = {
      category: (catEl && catEl.value) || 'misc',
      period: periodEl ? Math.max(0, parseInt(periodEl.value, 10) || 1) : 1,
      direction: (dirEl && dirEl.value) || null,
      description: (descEl && descEl.value) || '',
      tags,
      rulesets,
      capturedRuleset: rulesetId === '*' ? null : rulesetId,
      createdAt: Date.now(),
    };
    if (this._sourceLibraryId) {
      meta.derivedFrom = this._sourceLibraryId;
      if (!meta.tags.includes(`derived:${this._sourceLibraryId}`)) {
        meta.tags.push(`derived:${this._sourceLibraryId}`);
      }
    }
    return meta;
  }

  _save(forceSaveAs = false) {
    if (!this.patternCapture) {
      Logger.warn('[PatternEditor] No patternCapture reference; cannot save.');
      return;
    }
    const cells = this._collectCellsArray();
    if (cells.length === 0) {
      this._setSaveStatus('Cannot save empty pattern.', 'err');
      return;
    }
    const norm = normalizeCells(cells);
    const cellsForSave = norm.cells;
    const nameEl = document.getElementById('editor-meta-name');
    let name = ((nameEl && nameEl.value) || '').trim();
    const meta = this._collectMeta();

    // In library mode, saving NEVER overwrites the built-in. The name
    // must be different from the source library id and the user must
    // provide one explicitly.
    if (this._editorMode === 'library') {
      if (!name) {
        this._setSaveStatus('Library patterns are read-only. Please enter a new name.', 'err');
        if (nameEl) nameEl.focus();
        return;
      }
      if (this._sourceLibraryId && name === this._sourceLibraryId) {
        this._setSaveStatus(
          `Cannot overwrite built-in pattern "${this._sourceLibraryId}". Choose a different name.`,
          'err'
        );
        if (nameEl) nameEl.focus();
        return;
      }
      const existing = this.patternCapture.listSaved().map((p) => p.name);
      if (existing.includes(name)) {
        if (!window.confirm(`A custom pattern named "${name}" already exists. Overwrite?`)) {
          this._setSaveStatus('Choose a different name.', 'err');
          return;
        }
        this.patternCapture.deleteSaved(name);
      }
      this.patternCapture.savePatternExternal(name, cellsForSave, meta);
      // Transition into "edit" mode on the newly created custom pattern.
      this._editorMode = 'edit';
      this._editorEditingName = name;
      this._sourceLibraryId = null;
      this._setSaveStatus(
        `✓ Saved "${name}" (derived from library pattern). Subsequent saves will update this custom pattern.`,
        'ok'
      );
      this._updateSaveUI();
      return;
    }

    const isUpdate = !forceSaveAs && this._editorMode === 'edit' && this._editorEditingName;
    if (isUpdate) {
      const oldName = this._editorEditingName;
      if (name && name !== oldName) {
        const renamed = this.patternCapture.renamePattern(oldName, name);
        if (!renamed) {
          this._setSaveStatus(`Could not rename — "${name}" may already exist.`, 'err');
          return;
        }
        this._editorEditingName = name;
      } else {
        name = oldName;
      }
      this.patternCapture.savePatternExternal(name, cellsForSave, meta);
      this._setSaveStatus(`✓ Updated "${name}".`, 'ok');
      return;
    }

    if (!name) {
      this._setSaveStatus('Please enter a name first.', 'err');
      if (nameEl) nameEl.focus();
      return;
    }
    const existing = this.patternCapture.listSaved().map((p) => p.name);
    if (existing.includes(name)) {
      if (!window.confirm(`A pattern named "${name}" already exists. Overwrite?`)) {
        this._setSaveStatus('Choose a different name.', 'err');
        return;
      }
      this.patternCapture.deleteSaved(name);
    }
    this.patternCapture.savePatternExternal(name, cellsForSave, meta);
    this._editorMode = 'edit';
    this._editorEditingName = name;
    this._setSaveStatus(`✓ Saved "${name}" as new custom pattern.`, 'ok');
    this._updateSaveUI();
  }

  _setSaveStatus(msg, kind) {
    const el = document.getElementById('editor-save-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = kind === 'ok' ? '#88ff88' : '#ff8888';
    if (this._saveStatusTimer) clearTimeout(this._saveStatusTimer);
    this._saveStatusTimer = setTimeout(() => {
      if (el && this._editorMode === 'edit') {
        this._updateSaveUI();
      } else if (el && this._editorMode === 'library') {
        this._updateSaveUI();
      } else if (el) {
        el.textContent = '';
      }
    }, 4000);
  }

  // ─────────────────────────────────────────────────────────────
  // JSON I/O
  // ─────────────────────────────────────────────────────────────
  _wireJsonIO() {
    const exportBtn = document.getElementById('editor-json-export');
    const copyBtn = document.getElementById('editor-json-copy');
    const importBtn = document.getElementById('editor-json-import');
    if (exportBtn) exportBtn.addEventListener('click', () => this._exportJSON());
    if (copyBtn) copyBtn.addEventListener('click', () => this._copyJSON());
    if (importBtn) importBtn.addEventListener('click', () => this._importJSON());
  }

  // ─────────────────────────────────────────────────────────────
  // File import (RLE / .cells)
  // ─────────────────────────────────────────────────────────────
  _wireFileImport() {
    const btn = document.getElementById('editor-file-import-btn');
    const input = document.getElementById('editor-file-input');
    if (!btn || !input) return;
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        this._importFromFileText(file.name, text);
      } catch (err) {
        this._setFileStatus(`✗ Read failed: ${err.message}`, 'err');
      }
      // Reset so picking the same file again still fires change.
      input.value = '';
    });
  }

  _importFromFileText(filename, text) {
    let parsed;
    try {
      parsed = parsePatternFile(filename, text);
    } catch (e) {
      this._setFileStatus(`✗ Parse failed: ${e.message}`, 'err');
      return;
    }
    if (!parsed || !parsed.cells || parsed.cells.length === 0) {
      this._setFileStatus(`✗ No cells found in "${filename}".`, 'err');
      return;
    }
    const { cells, meta } = parsed;
    const { cells: normCells, width, height } = normalizeCells(cells);
    // Check if pattern fits in the editor grid.
    if (width > this.editorSize || height > this.editorSize) {
      const proceed = window.confirm(
        `Pattern is ${width}×${height} but editor grid is ${this.editorSize}×${this.editorSize}. ` +
          `Only the top-left portion will be loaded. Continue?`
      );
      if (!proceed) {
        this._setFileStatus('Import cancelled.', 'err');
        return;
      }
    }
    // Derive a name from filename if metadata doesn't supply one.
    const baseName = filename.replace(/\.(rle|cells|txt)$/i, '');
    const derivedName = meta.name || baseName;
    // Load into editor in "new" mode (creates a new custom pattern on save).
    this.loadPattern(normCells, derivedName, 'new', null);
    // Populate metadata fields from parsed meta.
    const nameEl = document.getElementById('editor-meta-name');
    const descEl = document.getElementById('editor-meta-desc');
    const tagsEl = document.getElementById('editor-meta-tags');
    const rulesetEl = document.getElementById('editor-meta-ruleset');
    if (nameEl) nameEl.value = derivedName;
    if (descEl) {
      const descParts = [];
      if (meta.author) descParts.push(`by ${meta.author}`);
      if (meta.comments && meta.comments.length > 0) descParts.push(meta.comments.join(' '));
      descEl.value = descParts.join(' — ').slice(0, 200);
    }
    if (tagsEl) {
      const tags = ['imported'];
      if (filename.toLowerCase().endsWith('.rle')) tags.push('rle');
      if (filename.toLowerCase().endsWith('.cells')) tags.push('cells');
      if (meta.author) tags.push(`author:${meta.author.toLowerCase().replace(/\s+/g, '_')}`);
      tagsEl.value = tags.join(', ');
    }
    // Try to map the parsed rule to a registered ruleset id.
    if (rulesetEl && meta.rule) {
      const ruleLower = meta.rule.toLowerCase().split(':')[0].trim();
      const direct = getRuleset(ruleLower);
      if (direct) {
        rulesetEl.value = direct.id;
      } else {
        // Try matching by B/S notation against registered rulesets.
        for (const def of listRulesets()) {
          if (def.notation && def.notation.toLowerCase() === ruleLower) {
            rulesetEl.value = def.id;
            break;
          }
        }
      }
    }
    this._setFileStatus(
      `✓ Imported "${derivedName}" (${normCells.length} cells, ${width}×${height})`,
      'ok'
    );
    // Auto-run re-infer to populate category/period/direction.
    this._reinferMetadata({ silent: true });
  }

  _setFileStatus(msg, kind) {
    const el = document.getElementById('editor-file-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = kind === 'ok' ? '#88ff88' : '#ff8888';
    setTimeout(() => {
      if (el.textContent === msg) el.textContent = '';
    }, 6000);
  }

  // ─────────────────────────────────────────────────────────────
  // Metadata re-inference
  // ─────────────────────────────────────────────────────────────
  _wireReinferButton() {
    const btn = document.getElementById('editor-reinfer-btn');
    if (!btn) return;
    btn.addEventListener('click', () => this._reinferMetadata({ silent: false }));
  }

  _reinferMetadata({ silent = false } = {}) {
    const cells = this._collectCellsArray();
    const resultEl = document.getElementById('editor-reinfer-result');
    const statusEl = document.getElementById('editor-infer-status');
    if (cells.length === 0) {
      if (resultEl) {
        resultEl.style.display = 'block';
        resultEl.style.color = '#ff8888';
        resultEl.textContent = '✗ Cannot infer metadata from empty pattern.';
      }
      return;
    }
    // Use the currently selected metadata ruleset as the simulation rule.
    const rulesetEl = document.getElementById('editor-meta-ruleset');
    const ruleId =
      (rulesetEl && rulesetEl.value && rulesetEl.value !== '*' && rulesetEl.value) ||
      CONFIG.ACTIVE_RULESET ||
      'conway';
    let inferred;
    try {
      inferred = inferPatternMetadata(cells, { rule: ruleId, ...this._inferConfig });
    } catch (e) {
      if (resultEl) {
        resultEl.style.display = 'block';
        resultEl.style.color = '#ff8888';
        resultEl.textContent = `✗ Inference failed: ${e.message}`;
      }
      Logger.error('[PatternEditor] Re-infer failed', e);
      return;
    }
    // Apply inferred fields to the metadata form.
    const catEl = document.getElementById('editor-meta-category');
    const periodEl = document.getElementById('editor-meta-period');
    const dirEl = document.getElementById('editor-meta-direction');
    if (catEl && inferred.category) catEl.value = inferred.category;
    if (periodEl && inferred.period != null) periodEl.value = inferred.period;
    if (dirEl) dirEl.value = inferred.direction || '';
    if (!silent && resultEl) {
      const lines = [];
      lines.push(`✓ Inferred via ${inferred.rulesetId}`);
      lines.push('');
      lines.push('— CLASSIFICATION —');
      lines.push(`  category        : ${inferred.category}`);
      lines.push(`  period (initial): ${inferred.period}`);
      if (inferred.finalPeriod != null) {
        lines.push(`  final period    : ${inferred.finalPeriod}`);
      }
      if (inferred.direction) lines.push(`  direction       : ${inferred.direction}`);
      if (inferred.displacement && (inferred.displacement[0] || inferred.displacement[1])) {
        lines.push(
          `  displacement    : (${inferred.displacement[0]}, ${inferred.displacement[1]})`
        );
      }
      lines.push('');
      lines.push('— TIMING —');
      if (inferred.timeToOscillation != null) {
        lines.push(`  time → cycle    : gen ${inferred.timeToOscillation}`);
      } else if (inferred.period > 0) {
        lines.push(`  time → cycle    : immediate (initial state)`);
      } else {
        lines.push(`  time → cycle    : never within observation window`);
      }
      if (inferred.stabilizedAt != null) {
        lines.push(`  stabilized at   : gen ${inferred.stabilizedAt}`);
      }
      if (inferred.extinct) lines.push(`  ⚠ extinction    : pattern dies out`);
      if (inferred.unbounded) lines.push(`  ⚠ unbounded     : sustained growth`);
      lines.push('');
      lines.push('— BOUNDS —');
      if (inferred.maxBounds) {
        const bb = inferred.maxBounds;
        const bbStr = bb.width === -1 ? '∞ (unbounded)' : `${bb.width}×${bb.height}`;
        lines.push(`  max bounds      : ${bbStr}`);
      }
      lines.push('');
      lines.push('— POPULATION —');
      lines.push(`  initial         : ${inferred.popHistory ? inferred.popHistory[0] : '?'}`);
      lines.push(`  max             : ${inferred.maxPopulation}`);
      if (inferred.minPopulation != null) {
        lines.push(`  min (after init): ${inferred.minPopulation}`);
      }
      lines.push(`  final           : ${inferred.finalPopulation}`);
      if (inferred.initPhaseStats && inferred.initPhaseStats.count > 0) {
        const s = inferred.initPhaseStats;
        lines.push(
          `  init phase      : ${s.count} gens, pop min/avg/max ` +
            `= ${s.min}/${s.avg.toFixed(1)}/${s.max}`
        );
      }
      if (inferred.periodicPhaseStats && inferred.periodicPhaseStats.count > 0) {
        const s = inferred.periodicPhaseStats;
        lines.push(
          `  periodic phase  : ${s.count} gens, pop min/avg/max ` +
            `= ${s.min}/${s.avg.toFixed(1)}/${s.max}`
        );
      }
      if (inferred.exotic) {
        lines.push('');
        lines.push('  (exotic rule — limited analysis)');
      }
      if (inferred.notes && inferred.notes.length > 0) {
        lines.push('');
        lines.push('— NOTES —');
        for (const note of inferred.notes) lines.push(`  • ${note}`);
      }
      resultEl.style.display = 'block';
      resultEl.style.color = '#88ff88';
      resultEl.textContent = lines.join('\n');
      resultEl.style.whiteSpace = 'pre-wrap';
      if (statusEl) {
        statusEl.textContent = `✓ Done (${inferred.category}${inferred.period ? `, p${inferred.period}` : ''})`;
        statusEl.style.color = '#88ff88';
        setTimeout(() => {
          if (statusEl) statusEl.textContent = '';
        }, 4000);
      }
    }
    this._editorDirty = true;
    this._activePresetName = '';
    this._syncPresetCombobox();
  }

  _buildJSON() {
    const cells = this._collectCellsArray();
    const norm = normalizeCells(cells);
    const meta = this._collectMeta();
    const nameEl = document.getElementById('editor-meta-name');
    const name = ((nameEl && nameEl.value) || '').trim() || 'untitled';
    return { name, cells: norm.cells, width: norm.width, height: norm.height, meta };
  }

  _exportJSON() {
    const ta = document.getElementById('editor-json-textarea');
    if (!ta) return;
    ta.value = JSON.stringify(this._buildJSON(), null, 2);
    this._setJsonStatus('Pattern + metadata exported below.', 'ok');
  }

  async _copyJSON() {
    const ta = document.getElementById('editor-json-textarea');
    if (!ta) return;
    const json = JSON.stringify(this._buildJSON(), null, 2);
    ta.value = json;
    try {
      await navigator.clipboard.writeText(json);
      this._setJsonStatus('✓ Copied to clipboard!', 'ok');
    } catch (e) {
      ta.select();
      document.execCommand('copy');
      this._setJsonStatus('✓ Copied (fallback method).', 'ok');
    }
  }

  _importJSON() {
    const ta = document.getElementById('editor-json-textarea');
    if (!ta) return;
    const txt = (ta.value || '').trim();
    if (!txt) {
      this._setJsonStatus('Paste JSON, RLE, or .cells content into the box first.', 'err');
      return;
    }
    // Autodetect format: JSON, RLE, or plaintext (.cells).
    const format = this._detectPastedFormat(txt);
    if (format === 'rle' || format === 'cells') {
      this._importFromPastedText(txt, format);
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch (e) {
      this._setJsonStatus(
        `✗ Unrecognized format. Expected JSON, RLE, or .cells. (JSON parse error: ${e.message})`,
        'err'
      );
      this._setJsonStatus(
        `✗ Unrecognized format. Expected JSON, RLE, or .cells. (JSON parse error: ${e.message})`,
        'err'
      );
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      this._setJsonStatus('✗ JSON must be an object.', 'err');
      return;
    }
    const cells = parsed.cells;
    if (!Array.isArray(cells)) {
      this._setJsonStatus('✗ JSON missing "cells" array.', 'err');
      return;
    }
    for (const c of cells) {
      if (
        !Array.isArray(c) ||
        c.length !== 2 ||
        !Number.isInteger(c[0]) ||
        !Number.isInteger(c[1])
      ) {
        this._setJsonStatus('✗ Bad cell format. Expected [[x,y],...].', 'err');
        return;
      }
    }
    const name = parsed.name && typeof parsed.name === 'string' ? parsed.name : null;
    let mode = 'new';
    if (name && this.patternCapture) {
      const existing = this.patternCapture.listSaved().map((p) => p.name);
      if (existing.includes(name)) mode = 'edit';
    }
    this.loadPattern(cells, mode === 'edit' ? name : null, mode, null);
    const meta = parsed.meta || {};
    const nameEl = document.getElementById('editor-meta-name');
    const descEl = document.getElementById('editor-meta-desc');
    const tagsEl = document.getElementById('editor-meta-tags');
    const catEl = document.getElementById('editor-meta-category');
    const periodEl = document.getElementById('editor-meta-period');
    const dirEl = document.getElementById('editor-meta-direction');
    if (nameEl && name) nameEl.value = name;
    if (descEl && meta.description) descEl.value = meta.description;
    if (tagsEl && Array.isArray(meta.tags)) tagsEl.value = meta.tags.join(', ');
    if (catEl && meta.category) catEl.value = meta.category;
    if (periodEl && meta.period != null) periodEl.value = meta.period;
    if (dirEl) dirEl.value = meta.direction || '';
    this._setJsonStatus(
      `✓ Imported ${cells.length} cell(s) from JSON. Click Save to persist.`,
      'ok'
    );
    this._updateSaveUI();
  }
  /**
   * Autodetect the format of pasted text.
   * Returns 'json', 'rle', or 'cells'.
   */
  _detectPastedFormat(txt) {
    const trimmed = txt.trim();
    // JSON: starts with { or [
    if (/^[[{]/.test(trimmed)) return 'json';
    // RLE: has an "x = N, y = N" header line, or contains $ / ! terminators
    // typical of RLE encoding.
    const lines = trimmed.split(/\r?\n/);
    const hasRleHeader = lines.some((l) => /^\s*x\s*=\s*\d+\s*,\s*y\s*=\s*\d+/i.test(l));
    if (hasRleHeader) return 'rle';
    // RLE body heuristic: contains $ or ! and digits/b/o tokens, no JSON braces.
    if (/[!$]/.test(trimmed) && /[bo]/i.test(trimmed) && !/[{}]/.test(trimmed)) {
      return 'rle';
    }
    // .cells (plaintext): lines made of only . O * o and whitespace, or
    // comment lines starting with !.
    const isCellsLine = (l) => {
      const s = l.replace(/\s+/g, '');
      if (s.length === 0) return true;
      if (l.startsWith('!')) return true;
      return /^[.OXo*]+$/.test(s);
    };
    if (lines.every(isCellsLine) && lines.some((l) => /[OX*o]/.test(l))) {
      return 'cells';
    }
    return 'unknown';
  }
  /**
   * Import RLE or .cells content pasted directly into the textarea.
   * Reuses the same logic as file-based import.
   */
  _importFromPastedText(text, format) {
    const fakeFilename = format === 'rle' ? 'pasted.rle' : 'pasted.cells';
    let parsed;
    try {
      parsed = parsePatternFile(fakeFilename, text);
    } catch (e) {
      this._setJsonStatus(`✗ ${format.toUpperCase()} parse failed: ${e.message}`, 'err');
      return;
    }
    if (!parsed || !parsed.cells || parsed.cells.length === 0) {
      this._setJsonStatus(`✗ No cells found in pasted ${format.toUpperCase()}.`, 'err');
      return;
    }
    const { cells, meta } = parsed;
    const { cells: normCells, width, height } = normalizeCells(cells);
    if (width > this.editorSize || height > this.editorSize) {
      const proceed = window.confirm(
        `Pattern is ${width}×${height} but editor grid is ${this.editorSize}×${this.editorSize}. ` +
          `Only the top-left portion will be loaded. Continue?`
      );
      if (!proceed) {
        this._setJsonStatus('Import cancelled.', 'err');
        return;
      }
    }
    const derivedName = meta.name || (format === 'rle' ? 'pasted_rle' : 'pasted_cells');
    let mode = 'new';
    if (this.patternCapture) {
      const existing = this.patternCapture.listSaved().map((p) => p.name);
      if (existing.includes(derivedName)) mode = 'edit';
    }
    this.loadPattern(normCells, mode === 'edit' ? derivedName : null, mode, null);
    const nameEl = document.getElementById('editor-meta-name');
    const descEl = document.getElementById('editor-meta-desc');
    const tagsEl = document.getElementById('editor-meta-tags');
    const rulesetEl = document.getElementById('editor-meta-ruleset');
    if (nameEl) nameEl.value = derivedName;
    if (descEl) {
      const descParts = [];
      if (meta.author) descParts.push(`by ${meta.author}`);
      if (meta.comments && meta.comments.length > 0) descParts.push(meta.comments.join(' '));
      descEl.value = descParts.join(' — ').slice(0, 200);
    }
    if (tagsEl) {
      const tags = ['imported', 'pasted'];
      if (format === 'rle') tags.push('rle');
      if (format === 'cells') tags.push('cells');
      if (meta.author) tags.push(`author:${meta.author.toLowerCase().replace(/\s+/g, '_')}`);
      tagsEl.value = tags.join(', ');
    }
    if (rulesetEl && meta.rule) {
      const ruleLower = meta.rule.toLowerCase().split(':')[0].trim();
      const direct = getRuleset(ruleLower);
      if (direct) {
        rulesetEl.value = direct.id;
      } else {
        for (const def of listRulesets()) {
          if (def.notation && def.notation.toLowerCase() === ruleLower) {
            rulesetEl.value = def.id;
            break;
          }
        }
      }
    }
    this._setJsonStatus(
      `✓ Imported ${normCells.length} cell(s) from pasted ${format.toUpperCase()} (${width}×${height}).`,
      'ok'
    );
    this._updateSaveUI();
    // Auto-run re-infer to populate category/period/direction.
    this._reinferMetadata({ silent: true });
  }

  _setJsonStatus(msg, kind) {
    const el = document.getElementById('editor-json-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = kind === 'ok' ? '#88ff88' : '#ff8888';
    if (this._jsonStatusTimer) clearTimeout(this._jsonStatusTimer);
    this._jsonStatusTimer = setTimeout(() => {
      if (el) el.textContent = '';
    }, 4000);
  }
}
