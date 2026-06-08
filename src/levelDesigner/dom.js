// HTML template & DOM construction for the LevelDesigner overlay.

export const LEVEL_DESIGNER_HTML = `
          <div id="level-designer-content">
            <div id="ld-header">
              <h1 id="ld-title">🛠 Level Designer</h1>
              <p id="ld-subtitle">Craft custom scenarios — place cities, defenses, and enemy bases.</p>
            </div>
            <div id="ld-tabs">
              <button class="ld-tab active" data-tab="map">🗺 Map</button>
              <button class="ld-tab" data-tab="tools">🛠 Tools & Patterns</button>
              <button class="ld-tab" data-tab="theme">🎨 Color Theme</button>
              <button class="ld-tab" data-tab="settings">⚙ Settings</button>
            </div>
            <div id="ld-tab-map" class="ld-tab-panel active">
            <div id="ld-toolbar">
              <div class="ld-tool-group">
                <label>Tool:</label>
                 <button class="ld-mode-btn active" data-mode="defense" title="Paint cells (defense or barrier — choose below)">✏ Draw</button>
                 <button class="ld-mode-btn" data-mode="line" title="Straight line">📏 Line</button>
                 <button class="ld-mode-btn" data-mode="fill" title="Region fill">🪣 Fill</button>
                  <button class="ld-mode-btn" data-mode="pattern" title="Stamp pattern from Zoo (uses selected ink type)">🧬 Pattern</button>
                  <button class="ld-mode-btn" data-mode="city" title="Place city">🏙 City</button>
                  <button class="ld-mode-btn" data-mode="base" title="Stamp pattern from Zoo as enemy base">⚔ Base</button>
                  <button class="ld-mode-btn" data-mode="spawner" title="Place missile spawn point (pattern from Zoo)">🚀 Spawner</button>
               </div>
                <div class="ld-tool-group" id="ld-paint-target-group">
                 <label>Ink:</label>
                 <div class="ld-target-switch">
                   <button class="ld-target-btn active" data-target="defense" title="Paint living defense cells (cyan) — follow the cellular automaton rules">
                     <span class="ld-target-icon">✏</span>
                     <span class="ld-target-label">
                       <span class="ld-target-name">Defense</span>
                       <span class="ld-target-desc">Living cells</span>
                     </span>
                   </button>
                    <button class="ld-target-btn" data-target="enemy" title="Paint enemy-aligned living cells (red) — follow the enemy ruleset">
                      <span class="ld-target-icon">☠</span>
                      <span class="ld-target-label">
                        <span class="ld-target-name">Enemy</span>
                        <span class="ld-target-desc">Hostile cells</span>
                      </span>
                    </button>
                   <button class="ld-target-btn" data-target="barrier" title="Paint static barrier tiles (gray) — never change, block missiles, partition the board">
                     <span class="ld-target-icon">🧱</span>
                     <span class="ld-target-label">
                       <span class="ld-target-name">Barrier</span>
                       <span class="ld-target-desc">Static walls</span>
                     </span>
                   </button>
                  <button class="ld-target-btn" data-target="fire" title="Paint static FIRE tiles (orange) — never change, destroy missiles, act as live neighbors for Life rules">
                    <span class="ld-target-icon">🔥</span>
                    <span class="ld-target-label">
                      <span class="ld-target-name">Fire</span>
                      <span class="ld-target-desc">Active static</span>
                    </span>
                  </button>
                   <button class="ld-target-btn" data-target="erase" title="Erase — remove any cells, barriers, fire, cities, bases, and spawners under the brush">
                     <span class="ld-target-icon">🧹</span>
                     <span class="ld-target-label">
                       <span class="ld-target-name">Erase</span>
                       <span class="ld-target-desc">Remove all</span>
                     </span>
                   </button>
                 </div>
               </div>
               <div class="ld-tool-group" id="ld-pattern-selector" style="display:none;">
                 <label>Stamp:</label>
                 <span id="ld-pattern-name" style="color:#00ffcc;font-weight:bold;min-width:120px;display:inline-block;">— none —</span>
                 <button id="ld-pick-pattern-btn" class="ld-btn">🦓 Pick from Zoo</button>
                 <button id="ld-rotate-pattern-btn" class="ld-btn" title="Rotate 90° CW">↻</button>
                 <button id="ld-flip-pattern-btn" class="ld-btn" title="Flip horizontally">⇋</button>
               </div>
                <div class="ld-tool-group" id="ld-base-selector" style="display:none;">
                  <label>Base:</label>
                  <span id="ld-base-name" style="color:#ff8888;font-weight:bold;min-width:120px;display:inline-block;">— none —</span>
                  <button id="ld-pick-base-btn" class="ld-btn">🦓 Pick from Zoo</button>
                  <button id="ld-rotate-base-btn" class="ld-btn" title="Rotate 90° CW">↻</button>
                  <button id="ld-flip-base-btn" class="ld-btn" title="Flip horizontally">⇋</button>
                </div>
                <div class="ld-tool-group" id="ld-spawner-selector" style="display:none;">
                  <label>Spawner:</label>
                  <span id="ld-spawner-name" style="color:#ffaa66;font-weight:bold;min-width:120px;display:inline-block;">— none —</span>
                  <button id="ld-pick-spawner-btn" class="ld-btn">🦓 Pick from Zoo</button>
                  <button id="ld-rotate-spawner-btn" class="ld-btn" title="Rotate 90° CW">↻</button>
                  <button id="ld-flip-spawner-btn" class="ld-btn" title="Flip horizontally">⇋</button>
                </div>
                <div class="ld-tool-group" id="ld-city-selector" style="display:none;">
                  <label>City:</label>
                  <span id="ld-city-name" style="color:#ffff88;font-weight:bold;min-width:120px;display:inline-block;">— default block —</span>
                  <button id="ld-pick-city-btn" class="ld-btn">🦓 Pick from Zoo</button>
                  <button id="ld-clear-city-btn" class="ld-btn" title="Reset to default rectangular city">↺ Default</button>
                </div>
                <div class="ld-tool-group" id="ld-line-tools" style="display:none;">
                  <label>Width:</label>
                  <input id="ld-line-width" type="range" min="1" max="8" step="1" value="1" />
                  <span id="ld-line-width-label">1</span>
                  <label>Dash:</label>
                  <select id="ld-line-dash">
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                    <option value="sparse">Sparse</option>
                  </select>
                </div>
                <div class="ld-tool-group" id="ld-fill-tools" style="display:none;">
                  <label>Fill:</label>
                  <select id="ld-fill-pattern">
                    <option value="solid">Solid</option>
                    <option value="checker">Checker</option>
                    <option value="stripes_h">Stripes (h)</option>
                    <option value="stripes_v">Stripes (v)</option>
                    <option value="diagonal">Diagonal</option>
                    <option value="dots_sparse">Dots (sparse)</option>
                    <option value="dots_dense">Dots (dense)</option>
                    <option value="grid">Grid</option>
                    <option value="cross">Cross</option>
                    <option value="random50">Random 50%</option>
                    <option value="random25">Random 25%</option>
                  </select>
               </div>
              <div class="ld-tool-group">
                <label>Brush:</label>
                <input id="ld-brush-size" type="range" min="1" max="8" step="1" value="1" />
                <span id="ld-brush-label">1</span>
              </div>
              <div class="ld-tool-group">
               <div class="ld-grid-size-wrap" style="position:relative;">
                 <button id="ld-grid-size-btn" class="ld-btn" title="Change grid size">
                   📐 <span id="ld-grid-size-label">120 × 80</span>
                 </button>
                 <div id="ld-grid-size-popover" class="ld-popover hidden">
                   <div class="ld-popover-title">Grid Size</div>
                   <div class="ld-popover-row">
                     <label>Width:
                       <input id="ld-grid-w" type="number" min="60" max="400" step="10" value="120" />
                     </label>
                     <label>Height:
                       <input id="ld-grid-h" type="number" min="40" max="300" step="10" value="80" />
                     </label>
                   </div>
                   <div class="ld-popover-title" style="margin-top:8px;">Presets</div>
                   <div class="ld-popover-presets">
                     <button class="ld-btn ld-grid-preset" data-w="80" data-h="60">Small (80×60)</button>
                     <button class="ld-btn ld-grid-preset" data-w="120" data-h="80">Medium (120×80)</button>
                     <button class="ld-btn ld-grid-preset" data-w="160" data-h="100">Large (160×100)</button>
                     <button class="ld-btn ld-grid-preset" data-w="200" data-h="120">XL (200×120)</button>
                     <button class="ld-btn ld-grid-preset" data-w="100" data-h="100">Square (100×100)</button>
                     <button class="ld-btn ld-grid-preset" data-w="240" data-h="80">Wide (240×80)</button>
                   </div>
                   <div class="ld-popover-actions">
                     <button id="ld-resize-btn" class="ld-btn ld-btn-primary">Apply</button>
                     <button id="ld-grid-size-cancel" class="ld-btn">Cancel</button>
                   </div>
                 </div>
               </div>
              </div>
              <div class="ld-tool-group">
                <button id="ld-clear-btn" class="ld-btn ld-btn-danger">Clear All</button>
              </div>
            </div>
            <div id="ld-main">
              <div id="ld-canvas-wrap">
                <canvas id="ld-canvas"></canvas>
              </div>
              <div id="ld-sidebar">
                <div class="ld-section">
                  <h3>📝 Metadata</h3>
                  <label>Name: <input id="ld-name" type="text" maxlength="40" placeholder="my level" /></label>
                  <label>Description:
                    <textarea id="ld-desc" rows="3" maxlength="200" placeholder="A custom scenario..."></textarea>
                  </label>
                  <label>Ruleset: <select id="ld-ruleset"></select></label>
                  <p id="ld-ruleset-desc" style="font-size:11px;color:#a0a0c0;font-style:italic;margin:4px 0 0;"></p>
                    <label>Enemy Ruleset:
                      <select id="ld-enemy-ruleset" title="Optional: separate ruleset for enemy missile cells (empty = symmetric with defender)"></select>
                    </label>
                    <p id="ld-enemy-ruleset-desc" style="font-size:11px;color:#ff8888;font-style:italic;margin:4px 0 0;">
                      When set, enemy missile cells evolve under this ruleset while defenses use the ruleset above.
                    </p>
                </div>
                <div class="ld-section">
                  <h3>🔄 Toroidal Wrap</h3>
                  <p style="font-size:11px;color:#a0a0c0;font-style:italic;margin:0 0 6px;">
                    Vertical shift applied when patterns wrap around the east/west edges. 
                    Set to 0 for a normal torus. Positive values offset wrapping cells downward,
                    negative upward. Useful for Klein-bottle-like topologies.
                  </p>
                  <label>Wrap Vertical Shift (cells):
                    <input id="ld-wrap-shift" type="number" min="-100" max="100" step="1" value="0" />
                  </label>
                </div>
                <div class="ld-section">
                  <h3>ℹ Spawning</h3>
                  <p style="font-size:11px;color:#a0a0c0;font-style:italic;margin:0;">
                    Place 🚀 Spawner markers on the map to define where missiles emit. 
                    Each spawner can use any pattern from the Pattern Zoo. Spawning
                    is fully driven by placed spawners — there are no default waves.
                  </p>
                  <div style="margin-top:8px;">
                    <label>Default interval (ms):
                      <input id="ld-spawner-interval" type="number" min="100" max="60000" step="100" value="2000" />
                    </label>
                    <label>Default emit limit (0 = ∞):
                      <input id="ld-spawner-emit-limit" type="number" min="0" max="9999" step="1" value="0" />
                    </label>
                    <label>Default initial delay (ms):
                      <input id="ld-spawner-initial-delay" type="number" min="0" max="60000" step="100" value="2000" />
                    </label>
                    <label title="Halo cells around spawn footprint that must be clear before next emission. Larger patterns (e.g. copperhead) need more clearance to avoid collisions with previous emissions.">Default padding (halo cells):
                      <input id="ld-spawner-padding" type="number" min="0" max="20" step="1" value="1" />
                    </label>
                    <p style="font-size:10px;color:#888;margin:4px 0 0;">
                      These values are applied to new spawners as you place them.
                      Existing spawners keep their original config.
                    </p>
                    <button id="ld-apply-spawner-defaults" class="ld-btn" style="margin-top:4px;">
                      Apply to All Existing Spawners
                    </button>
                  </div>
                </div>
                <div class="ld-section">
                  <h3>📊 Stats</h3>
                  <div class="ld-stats">
                    <div>Cities: <strong id="ld-stat-cities">0</strong></div>
                    <div>City cells: <strong id="ld-stat-city-cells">0</strong></div>
                    <div>Defense cells: <strong id="ld-stat-defense">0</strong></div>
                     <div>Enemy cells: <strong id="ld-stat-enemy">0</strong></div>
                     <div>Barriers: <strong id="ld-stat-barriers">0</strong></div>
                      <div>Fire: <strong id="ld-stat-fire">0</strong></div>
                    <div>Bases: <strong id="ld-stat-bases">0</strong></div>
                    <div>Spawners: <strong id="ld-stat-spawners">0</strong></div>
                     <div>Base cells: <strong id="ld-stat-enemy-cells">0</strong></div>
                  </div>
                  <div class="ld-thresholds-hint" style="margin-top:8px;font-size:11px;color:#a0a0c0;font-style:italic;">
                    Victory triggers when enemy cells ≤ <strong id="ld-stat-victory-thresh">0</strong>.<br>
                    Defeat triggers when city cells ≤ <strong id="ld-stat-defeat-thresh">0</strong>.
                  </div>
                </div>
                <div class="ld-section">
                  <h3>💾 Saved Levels</h3>
                  <select id="ld-level-select" size="6"></select>
                  <div class="ld-button-row">
                    <button id="ld-load-btn" class="ld-btn">Load</button>
                    <button id="ld-delete-btn" class="ld-btn ld-btn-danger">Delete</button>
                  </div>
                </div>
              </div>
            </div>
            </div>
            <div id="ld-tab-tools" class="ld-tab-panel">
              <div id="ld-tools-panel">
                <p class="ld-settings-intro">
                  Configure which drawing tools and patterns are available to the
                  player during this level. Useful for tutorials or challenges.
                </p>
                <div class="setting-section-header">Allowed Drawing Tools</div>
                <div id="ld-tool-toggle-list" class="ld-tool-toggle-list"></div>
                <div class="setting-section-header">Allowed Patterns</div>
                <p class="ld-settings-intro">
                  Select which patterns appear in the Pattern tool's preset dropdown.
                  Leave all unchecked to allow every pattern. Custom patterns are
                  always allowed.
                </p>
                <div class="ld-pattern-controls">
                  <button id="ld-pattern-allow-all" class="ld-btn">Allow All</button>
                  <button id="ld-pattern-allow-none" class="ld-btn">Clear Selection</button>
                  <input id="ld-pattern-filter" type="text" placeholder="filter by name..." />
                </div>
                <div id="ld-pattern-allow-list" class="ld-pattern-allow-list"></div>
              </div>
            </div>
            <div id="ld-tab-theme" class="ld-tab-panel">
              <div id="ld-theme-panel">
                <p class="ld-settings-intro">
                  Customize the visual theme of this level. Leave a field blank
                  (clear it) to use the default. Colors accept any valid CSS
                  color (hex like <code>#00ff88</code>, names like <code>cyan</code>,
                  or <code>rgba(...)</code>).
                </p>
                <div class="ld-settings-actions">
                  <button id="ld-theme-reset" class="ld-btn ld-btn-danger">↺ Reset Theme</button>
                  <button id="ld-theme-randomize" class="ld-btn" style="color:#ff80ff;border-color:#ff80ff;">🎲 Randomize</button>
                  <button id="ld-theme-preview" class="ld-btn">👁 Live Preview</button>
                </div>
                <div id="ld-theme-list"></div>
              </div>
            </div>
            <div id="ld-tab-settings" class="ld-tab-panel">
              <div id="ld-settings-panel">
                <p class="ld-settings-intro">
                  These settings override the global game configuration when this level is played.
                  All values are captured into the level file and applied at level start.
                </p>
                <div class="ld-settings-actions">
                  <button id="ld-settings-copy-current" class="ld-btn">📋 Copy Current Game Settings</button>
                  <button id="ld-settings-reset" class="ld-btn ld-btn-danger">↺ Reset to Defaults</button>
                </div>
                <div id="ld-settings-list"></div>
              </div>
            </div>
            <div id="ld-footer">
              <button id="ld-save-btn" class="ld-btn ld-btn-primary">💾 Save Level</button>
              <button id="ld-play-btn" class="ld-btn ld-btn-primary">▶ Save & Play</button>
              <button id="ld-export-btn" class="ld-btn">📤 Export JSON</button>
              <button id="ld-import-btn" class="ld-btn">📥 Import JSON</button>
              <button id="ld-close-btn" class="ld-btn">Close</button>
              <span id="ld-status"></span>
            </div>
          </div>
        `;

/**
 * Create the overlay element with the LevelDesigner markup and
 * append it to the given container (or document.body as fallback).
 * Returns the overlay element.
 */
export function createDesignerOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'level-designer-overlay';
  overlay.className = 'overlay hidden';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = LEVEL_DESIGNER_HTML;
  const container = document.getElementById('game-container') || document.body;
  container.appendChild(overlay);
  _injectPopoverStyles();
  return overlay;
}
function _injectPopoverStyles() {
  if (document.getElementById('ld-popover-styles')) return;
  const style = document.createElement('style');
  style.id = 'ld-popover-styles';
  style.textContent = `
     .ld-popover {
       position: absolute;
       top: calc(100% + 4px);
       left: 0;
       z-index: 100;
       background: #1a1a2e;
       border: 1px solid #4040a0;
       border-radius: 6px;
       padding: 10px;
       min-width: 240px;
       box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
     }
     .ld-popover.hidden { display: none; }
     .ld-popover-title {
       font-size: 11px;
       font-weight: bold;
       color: #a0a0c0;
       text-transform: uppercase;
       letter-spacing: 0.5px;
       margin-bottom: 6px;
     }
     .ld-popover-row {
       display: flex;
       gap: 8px;
     }
     .ld-popover-row label {
       display: flex;
       flex-direction: column;
       font-size: 11px;
       color: #c0c0e0;
       flex: 1;
     }
     .ld-popover-row input {
       margin-top: 2px;
       width: 100%;
       box-sizing: border-box;
     }
     .ld-popover-presets {
       display: grid;
       grid-template-columns: 1fr 1fr;
       gap: 4px;
     }
     .ld-popover-presets .ld-btn {
       font-size: 11px;
       padding: 4px 6px;
       text-align: left;
     }
     .ld-popover-actions {
       margin-top: 10px;
       display: flex;
       gap: 6px;
       justify-content: flex-end;
     }
   `;
  document.head.appendChild(style);
}
