// Theme panel: lets the user override CONFIG.COLORS keys for a level.

export const THEME_DEFS = [
  // ── Backgrounds & structure ──────────────────────────────────
  { key: 'BACKGROUND', label: 'Background', default: '#000010', group: 'World' },
  { key: 'GRID', label: 'Grid lines', default: '#0a0a20', group: 'World' },
  { key: 'MIDLINE', label: 'Draw-zone midline', default: '#2a2a5a', group: 'World' },
  {
    key: 'DRAW_ZONE_BOUNDARY',
    label: 'Draw-zone boundary line',
    default: 'rgba(0, 255, 200, 0.35)',
    group: 'World',
  },
  {
    key: 'DRAW_ZONE_TINT',
    label: 'Draw-zone background tint',
    default: 'rgba(0, 255, 136, 0.04)',
    group: 'World',
  },
  // ── Cells (the big visual drivers) ───────────────────────────
  {
    key: 'CELL_ALIVE',
    label: 'Defense base color',
    default: '#00ff88',
    group: 'Cells',
  },
  {
    key: 'CELL_PENDING',
    label: 'Pending (wet) ink',
    default: 'rgba(0, 255, 136, 0.4)',
    group: 'Cells',
  },
  {
    key: 'CELL_MISSILE',
    label: 'Missile base color',
    default: '#ff00aa',
    group: 'Cells',
  },
  { key: 'CELL_CITY', label: 'City cells', default: '#ffff60', group: 'Cells' },
  {
    key: 'CELL_EXPLOSION',
    label: 'Explosion cells',
    default: '#ff8800',
    group: 'Cells',
  },
  {
    key: 'CELL_BARRIER',
    label: 'Barrier (wall) cells',
    default: '#a0a0a0',
    group: 'Cells',
  },
  { key: 'CELL_FIRE', label: 'Fire (hazard) cells', default: '#ff6622', group: 'Cells' },
  // ── Defense / missile color variants (palette swatches) ──────
  // These are stored as arrays. The theme panel renders them as
  // a compact multi-swatch row when group === 'Palette'.
  {
    key: 'DEFENSE_VARIANTS',
    label: 'Defense palette (5 swatches)',
    default: ['#00ff88', '#33ffaa', '#00ddaa', '#66ffcc', '#00ffcc'],
    group: 'Palette',
    type: 'palette',
    size: 5,
  },
  {
    key: 'MISSILE_VARIANTS',
    label: 'Missile palette (6 swatches)',
    default: ['#ff0055', '#ff2233', '#ff3300', '#ff1144', '#ff4422', '#ff0033'],
    group: 'Palette',
    type: 'palette',
    size: 6,
  },
  // ── HUD & UI ─────────────────────────────────────────────────
  { key: 'HUD_TEXT', label: 'HUD text', default: '#e0e0ff', group: 'HUD' },
  { key: 'INK_BAR', label: 'Ink bar fill', default: '#00ffff', group: 'HUD' },
  { key: 'INK_BAR_BG', label: 'Ink bar background', default: '#1a1a3a', group: 'HUD' },
  {
    key: 'RETURN_FIRE_TEXT',
    label: 'Return-fire text',
    default: '#00ffff',
    group: 'HUD',
  },
  {
    key: 'RICOCHET_TEXT',
    label: 'Ricochet text',
    default: '#ffaa00',
    group: 'HUD',
  },
];

/**
 * Curated theme presets. Each one rewrites the most visually
 * impactful colors so the level gets a strong, cohesive look.
 */
export const THEME_PRESETS = [
  {
    id: 'default',
    name: '⚪ Default',
    desc: 'Restore all colors to defaults.',
    colors: {}, // empty = clear all overrides
  },
  {
    id: 'neon',
    name: '💜 Neon Dream',
    desc: 'Deep purple void with hot pink defenses and cyan threats.',
    colors: {
      BACKGROUND: '#0a001a',
      GRID: '#1a0a3a',
      MIDLINE: '#4a1a7a',
      CELL_ALIVE: '#ff00ff',
      CELL_MISSILE: '#00ffff',
      CELL_CITY: '#ffff00',
      CELL_EXPLOSION: '#ff66ff',
      CELL_BARRIER: '#6644aa',
      CELL_FIRE: '#ff44dd',
      CELL_PENDING: 'rgba(255, 0, 255, 0.4)',
      DEFENSE_VARIANTS: ['#ff00ff', '#ff44ff', '#cc00ff', '#ff66ff', '#ee00cc'],
      MISSILE_VARIANTS: ['#00ffff', '#00ccff', '#44ffff', '#00aaff', '#66ffff', '#0099ff'],
      HUD_TEXT: '#ffccff',
      INK_BAR: '#ff00ff',
      INK_BAR_BG: '#2a0a4a',
      RETURN_FIRE_TEXT: '#00ffff',
      RICOCHET_TEXT: '#ffff00',
      DRAW_ZONE_BOUNDARY: 'rgba(255, 0, 255, 0.45)',
      DRAW_ZONE_TINT: 'rgba(255, 0, 255, 0.06)',
    },
  },
  {
    id: 'inferno',
    name: '🔥 Inferno',
    desc: 'Smoldering reds and oranges — a battlefield in flames.',
    colors: {
      BACKGROUND: '#1a0500',
      GRID: '#3a1000',
      MIDLINE: '#6a2400',
      CELL_ALIVE: '#ffaa44',
      CELL_MISSILE: '#ff2200',
      CELL_CITY: '#ffee88',
      CELL_EXPLOSION: '#ffff00',
      CELL_BARRIER: '#884422',
      CELL_FIRE: '#ff4400',
      CELL_PENDING: 'rgba(255, 170, 68, 0.4)',
      DEFENSE_VARIANTS: ['#ffaa44', '#ffcc66', '#ff9922', '#ffbb55', '#ffdd77'],
      MISSILE_VARIANTS: ['#ff2200', '#ff4400', '#dd1100', '#ff5511', '#cc0000', '#ff3322'],
      HUD_TEXT: '#ffddaa',
      INK_BAR: '#ffaa44',
      INK_BAR_BG: '#3a1500',
      RETURN_FIRE_TEXT: '#ffff44',
      RICOCHET_TEXT: '#ff8800',
      DRAW_ZONE_BOUNDARY: 'rgba(255, 170, 68, 0.45)',
      DRAW_ZONE_TINT: 'rgba(255, 100, 0, 0.06)',
    },
  },
  {
    id: 'arctic',
    name: '❄ Arctic',
    desc: 'Icy blues and whites — a frozen wasteland.',
    colors: {
      BACKGROUND: '#000a1a',
      GRID: '#0a1a3a',
      MIDLINE: '#2a4a7a',
      CELL_ALIVE: '#88ccff',
      CELL_MISSILE: '#ff4488',
      CELL_CITY: '#ffffff',
      CELL_EXPLOSION: '#aaeeff',
      CELL_BARRIER: '#4488cc',
      CELL_FIRE: '#ff6688',
      CELL_PENDING: 'rgba(136, 204, 255, 0.4)',
      DEFENSE_VARIANTS: ['#88ccff', '#aaddff', '#66bbff', '#cceeff', '#99ccff'],
      MISSILE_VARIANTS: ['#ff4488', '#ff6699', '#ee3377', '#ff5599', '#cc2266', '#ff77aa'],
      HUD_TEXT: '#ddeeff',
      INK_BAR: '#88ccff',
      INK_BAR_BG: '#1a2a4a',
      RETURN_FIRE_TEXT: '#aaeeff',
      RICOCHET_TEXT: '#ffccff',
      DRAW_ZONE_BOUNDARY: 'rgba(136, 204, 255, 0.45)',
      DRAW_ZONE_TINT: 'rgba(136, 204, 255, 0.06)',
    },
  },
  {
    id: 'matrix',
    name: '💚 Matrix',
    desc: 'Pure green-on-black terminal aesthetic.',
    colors: {
      BACKGROUND: '#000000',
      GRID: '#001a00',
      MIDLINE: '#003a00',
      CELL_ALIVE: '#00ff00',
      CELL_MISSILE: '#aaff00',
      CELL_CITY: '#ffffff',
      CELL_EXPLOSION: '#ccff00',
      CELL_BARRIER: '#226622',
      CELL_FIRE: '#88ff00',
      CELL_PENDING: 'rgba(0, 255, 0, 0.4)',
      DEFENSE_VARIANTS: ['#00ff00', '#22ff22', '#00cc00', '#44ff44', '#00aa00'],
      MISSILE_VARIANTS: ['#aaff00', '#ccff00', '#88dd00', '#bbff22', '#99ee00', '#aaff44'],
      HUD_TEXT: '#00ff00',
      INK_BAR: '#00ff00',
      INK_BAR_BG: '#002200',
      RETURN_FIRE_TEXT: '#ccff00',
      RICOCHET_TEXT: '#ffff00',
      DRAW_ZONE_BOUNDARY: 'rgba(0, 255, 0, 0.5)',
      DRAW_ZONE_TINT: 'rgba(0, 255, 0, 0.05)',
    },
  },
  {
    id: 'synthwave',
    name: '🌆 Synthwave',
    desc: 'Sunset purples, magentas, and cyans — 80s vibes.',
    colors: {
      BACKGROUND: '#0a0020',
      GRID: '#1a0a3a',
      MIDLINE: '#3a1a5a',
      CELL_ALIVE: '#ff44cc',
      CELL_MISSILE: '#44ffff',
      CELL_CITY: '#ffaa44',
      CELL_EXPLOSION: '#ff88ff',
      CELL_BARRIER: '#5544aa',
      CELL_FIRE: '#ff66aa',
      CELL_PENDING: 'rgba(255, 68, 204, 0.4)',
      DEFENSE_VARIANTS: ['#ff44cc', '#ff66dd', '#cc3399', '#ff88ee', '#dd55bb'],
      MISSILE_VARIANTS: ['#44ffff', '#66ffff', '#22ddee', '#88ffff', '#00ccdd', '#55eeff'],
      HUD_TEXT: '#ffccff',
      INK_BAR: '#ff44cc',
      INK_BAR_BG: '#2a0a4a',
      RETURN_FIRE_TEXT: '#44ffff',
      RICOCHET_TEXT: '#ffaa44',
      DRAW_ZONE_BOUNDARY: 'rgba(255, 68, 204, 0.45)',
      DRAW_ZONE_TINT: 'rgba(255, 68, 204, 0.06)',
    },
  },
  {
    id: 'mono',
    name: '◐ Monochrome',
    desc: 'Black and white only — pure form, no color.',
    colors: {
      BACKGROUND: '#000000',
      GRID: '#1a1a1a',
      MIDLINE: '#444444',
      CELL_ALIVE: '#ffffff',
      CELL_MISSILE: '#888888',
      CELL_CITY: '#cccccc',
      CELL_EXPLOSION: '#aaaaaa',
      CELL_BARRIER: '#666666',
      CELL_FIRE: '#999999',
      CELL_PENDING: 'rgba(255, 255, 255, 0.4)',
      DEFENSE_VARIANTS: ['#ffffff', '#eeeeee', '#dddddd', '#f5f5f5', '#cccccc'],
      MISSILE_VARIANTS: ['#888888', '#999999', '#777777', '#aaaaaa', '#666666', '#bbbbbb'],
      HUD_TEXT: '#ffffff',
      INK_BAR: '#ffffff',
      INK_BAR_BG: '#222222',
      RETURN_FIRE_TEXT: '#ffffff',
      RICOCHET_TEXT: '#cccccc',
      DRAW_ZONE_BOUNDARY: 'rgba(255, 255, 255, 0.4)',
      DRAW_ZONE_TINT: 'rgba(255, 255, 255, 0.04)',
    },
  },
  {
    id: 'blood',
    name: '🩸 Blood Moon',
    desc: 'Crimson and bone — gothic horror.',
    colors: {
      BACKGROUND: '#100000',
      GRID: '#2a0808',
      MIDLINE: '#551111',
      CELL_ALIVE: '#ffeecc',
      CELL_MISSILE: '#cc0011',
      CELL_CITY: '#ffddaa',
      CELL_EXPLOSION: '#ff3322',
      CELL_BARRIER: '#553333',
      CELL_FIRE: '#aa0022',
      CELL_PENDING: 'rgba(255, 238, 204, 0.4)',
      DEFENSE_VARIANTS: ['#ffeecc', '#ffddaa', '#eeccaa', '#ffe8c0', '#ddbb99'],
      MISSILE_VARIANTS: ['#cc0011', '#dd1122', '#aa0011', '#ee2233', '#990011', '#bb1122'],
      HUD_TEXT: '#ffccaa',
      INK_BAR: '#ffeecc',
      INK_BAR_BG: '#3a0808',
      RETURN_FIRE_TEXT: '#ffddaa',
      RICOCHET_TEXT: '#ff8866',
      DRAW_ZONE_BOUNDARY: 'rgba(255, 238, 204, 0.4)',
      DRAW_ZONE_TINT: 'rgba(204, 0, 17, 0.06)',
    },
  },
  {
    id: 'toxic',
    name: '☢ Toxic',
    desc: 'Radioactive green and yellow — biohazard zone.',
    colors: {
      BACKGROUND: '#0a1500',
      GRID: '#1a2a00',
      MIDLINE: '#3a5500',
      CELL_ALIVE: '#aaff00',
      CELL_MISSILE: '#ff00ff',
      CELL_CITY: '#ffff00',
      CELL_EXPLOSION: '#ddff44',
      CELL_BARRIER: '#446600',
      CELL_FIRE: '#ccff00',
      CELL_PENDING: 'rgba(170, 255, 0, 0.4)',
      DEFENSE_VARIANTS: ['#aaff00', '#ccff22', '#88dd00', '#bbff44', '#99ee11'],
      MISSILE_VARIANTS: ['#ff00ff', '#ee22ee', '#cc00cc', '#ff44ff', '#dd00dd', '#ff66ff'],
      HUD_TEXT: '#ddffaa',
      INK_BAR: '#aaff00',
      INK_BAR_BG: '#2a4a00',
      RETURN_FIRE_TEXT: '#ffff00',
      RICOCHET_TEXT: '#ff00ff',
      DRAW_ZONE_BOUNDARY: 'rgba(170, 255, 0, 0.5)',
      DRAW_ZONE_TINT: 'rgba(170, 255, 0, 0.06)',
    },
  },
  {
    id: 'deepsea',
    name: '🌊 Deep Sea',
    desc: 'Bioluminescent abyss — teal life, amber predators.',
    colors: {
      BACKGROUND: '#001020',
      GRID: '#002040',
      MIDLINE: '#004060',
      CELL_ALIVE: '#00ddcc',
      CELL_MISSILE: '#ffaa00',
      CELL_CITY: '#aaffff',
      CELL_EXPLOSION: '#ffdd44',
      CELL_BARRIER: '#226677',
      CELL_FIRE: '#ff7700',
      CELL_PENDING: 'rgba(0, 221, 204, 0.4)',
      DEFENSE_VARIANTS: ['#00ddcc', '#22eedd', '#00bbaa', '#44ffee', '#00ccbb'],
      MISSILE_VARIANTS: ['#ffaa00', '#ffbb22', '#ee9900', '#ffcc44', '#dd8800', '#ffaa33'],
      HUD_TEXT: '#aaeeff',
      INK_BAR: '#00ddcc',
      INK_BAR_BG: '#003040',
      RETURN_FIRE_TEXT: '#aaffff',
      RICOCHET_TEXT: '#ffdd44',
      DRAW_ZONE_BOUNDARY: 'rgba(0, 221, 204, 0.45)',
      DRAW_ZONE_TINT: 'rgba(0, 221, 204, 0.05)',
    },
  },
];

/**
 * Build the theme tab UI inside the designer overlay.
 * Returns a controller object with .syncFromState() to push state into UI.
 */
export function buildThemePanel(d) {
  const container = d.overlay.querySelector('#ld-theme-list');
  if (!container) return null;
  container.innerHTML = '';
  // ── Preset picker ──────────────────────────────────────────
  const presetSection = document.createElement('div');
  presetSection.className = 'ld-theme-preset-section';
  presetSection.innerHTML = `
        <div class="ld-theme-preset-header">🎨 Preset Themes</div>
        <p class="ld-theme-preset-hint">
          Apply a curated color palette in one click. Then fine-tune individual
          colors below.
        </p>
      `;
  const presetGrid = document.createElement('div');
  presetGrid.className = 'ld-theme-preset-grid';
  for (const preset of THEME_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ld-theme-preset-btn';
    btn.title = preset.desc;
    btn.innerHTML = `
          <div class="ld-theme-preset-swatches">
            ${buildPresetSwatchPreview(preset.colors)}
          </div>
          <div class="ld-theme-preset-name">${preset.name}</div>
        `;
    btn.addEventListener('click', () => {
      applyPreset(d, preset);
      if (themeInputs) syncThemePanelFromState(d, themeInputs);
      d._draw();
      d._setStatus(`Applied "${preset.name}" theme.`, 'ok');
    });
    presetGrid.appendChild(btn);
  }
  presetSection.appendChild(presetGrid);
  container.appendChild(presetSection);
  // ── Individual color overrides ─────────────────────────────
  const themeInputs = {};
  const groups = {};
  for (const def of THEME_DEFS) {
    const groupName = def.group || 'Other';
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(def);
  }
  for (const [groupName, defs] of Object.entries(groups)) {
    const groupHeader = document.createElement('div');
    groupHeader.className = 'ld-theme-group-header';
    groupHeader.textContent = groupName;
    container.appendChild(groupHeader);
    for (const def of defs) {
      if (def.type === 'palette') {
        const row = buildPaletteRow(d, def, themeInputs);
        container.appendChild(row);
      } else {
        const row = buildColorRow(d, def, themeInputs);
        container.appendChild(row);
      }
    }
  }
  const resetBtn = d.overlay.querySelector('#ld-theme-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (!confirm('Reset all color theme overrides?')) return;
      d.colorTheme = {};
      syncThemePanelFromState(d, themeInputs);
      d._draw();
      d._setStatus('Theme reset to defaults.', 'ok');
    });
  }
  const previewBtn = d.overlay.querySelector('#ld-theme-preview');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      d._draw();
      d._setStatus('Theme preview applied to map canvas.', 'ok');
    });
  }
  const randomizeBtn = d.overlay.querySelector('#ld-theme-randomize');
  if (randomizeBtn) {
    randomizeBtn.addEventListener('click', () => {
      randomizeColorTheme(d);
      syncThemePanelFromState(d, themeInputs);
      d._draw();
      d._setStatus('🎲 Color theme randomized!', 'ok');
    });
  }
  injectThemePanelStyles();
  return {
    themeInputs,
    syncFromState: () => syncThemePanelFromState(d, themeInputs),
  };
}

function buildPresetSwatchPreview(colors) {
  const keys = ['BACKGROUND', 'CELL_ALIVE', 'CELL_MISSILE', 'CELL_CITY', 'CELL_EXPLOSION'];
  return keys
    .map((k) => {
      const c = colors[k] || '#444';
      return `<span class="ld-theme-preset-swatch" style="background:${c};"></span>`;
    })
    .join('');
}

function applyPreset(d, preset) {
  // Empty colors object = reset all.
  if (!preset.colors || Object.keys(preset.colors).length === 0) {
    d.colorTheme = {};
    return;
  }
  // Replace the entire theme with the preset (don't merge — presets
  // are meant to be a complete cohesive look).
  d.colorTheme = {};
  for (const [k, v] of Object.entries(preset.colors)) {
    d.colorTheme[k] = Array.isArray(v) ? v.slice() : v;
  }
}

function buildColorRow(d, def, themeInputs) {
  const row = document.createElement('div');
  row.className = 'ld-theme-row';
  const label = document.createElement('label');
  label.textContent = def.label;
  label.htmlFor = `ld-theme-${def.key}`;
  const swatch = document.createElement('span');
  swatch.className = 'ld-theme-swatch';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.id = `ld-theme-${def.key}`;
  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.className = 'ld-theme-text';
  textInput.placeholder = def.default || '';
  const initial = d.colorTheme[def.key] != null ? d.colorTheme[def.key] : def.default || '';
  textInput.value = d.colorTheme[def.key] || '';
  setSwatchAndColor(colorInput, swatch, initial);
  const apply = (val) => {
    if (val == null || val === '') {
      delete d.colorTheme[def.key];
      textInput.value = '';
      setSwatchAndColor(colorInput, swatch, def.default || '#000010');
    } else {
      d.colorTheme[def.key] = val;
      setSwatchAndColor(colorInput, swatch, val);
    }
    d._draw();
  };
  colorInput.addEventListener('input', () => {
    apply(colorInput.value);
    textInput.value = colorInput.value;
  });
  textInput.addEventListener('change', () => apply(textInput.value.trim()));
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'ld-theme-clear';
  clearBtn.title = 'Reset to default';
  clearBtn.textContent = '✕';
  clearBtn.addEventListener('click', () => apply(''));
  row.appendChild(label);
  row.appendChild(swatch);
  row.appendChild(colorInput);
  row.appendChild(textInput);
  row.appendChild(clearBtn);
  themeInputs[def.key] = { colorInput, textInput, swatch, def, row };
  return row;
}

function buildPaletteRow(d, def, themeInputs) {
  const row = document.createElement('div');
  row.className = 'ld-theme-palette-row';
  const label = document.createElement('label');
  label.textContent = def.label;
  label.className = 'ld-theme-palette-label';
  const swatches = document.createElement('div');
  swatches.className = 'ld-theme-palette-swatches';
  const inputs = [];
  const currentArr =
    Array.isArray(d.colorTheme[def.key]) && d.colorTheme[def.key].length === def.size
      ? d.colorTheme[def.key]
      : def.default;
  for (let i = 0; i < def.size; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'ld-theme-palette-swatch-wrap';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'ld-theme-palette-color';
    colorInput.value = normalizeToHex(currentArr[i] || def.default[i]);
    colorInput.title = `Swatch ${i + 1}`;
    colorInput.addEventListener('input', () => {
      const arr = Array.isArray(d.colorTheme[def.key])
        ? d.colorTheme[def.key].slice()
        : def.default.slice();
      arr[i] = colorInput.value;
      d.colorTheme[def.key] = arr;
      d._draw();
    });
    wrap.appendChild(colorInput);
    swatches.appendChild(wrap);
    inputs.push(colorInput);
  }
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'ld-theme-clear';
  clearBtn.title = 'Reset palette to default';
  clearBtn.textContent = '✕';
  clearBtn.addEventListener('click', () => {
    delete d.colorTheme[def.key];
    for (let i = 0; i < inputs.length; i++) {
      inputs[i].value = normalizeToHex(def.default[i]);
    }
    d._draw();
  });
  row.appendChild(label);
  row.appendChild(swatches);
  row.appendChild(clearBtn);
  themeInputs[def.key] = { paletteInputs: inputs, def, row };
  return row;
}

export function syncThemePanelFromState(d, themeInputs) {
  if (!themeInputs) return;
  for (const [key, entry] of Object.entries(themeInputs)) {
    if (entry.paletteInputs) {
      const arr = Array.isArray(d.colorTheme[key]) ? d.colorTheme[key] : entry.def.default;
      for (let i = 0; i < entry.paletteInputs.length; i++) {
        entry.paletteInputs[i].value = normalizeToHex(arr[i] || entry.def.default[i]);
      }
    } else {
      const val = d.colorTheme[key] || '';
      entry.textInput.value = val;
      setSwatchAndColor(entry.colorInput, entry.swatch, val || entry.def.default || '');
    }
  }
}

function setSwatchAndColor(colorInput, swatch, value) {
  swatch.style.background = value || 'transparent';
  try {
    const probe = document.createElement('div');
    probe.style.color = value;
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    document.body.removeChild(probe);
    const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      const r = parseInt(m[1], 10);
      const g = parseInt(m[2], 10);
      const b = parseInt(m[3], 10);
      const hex = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
      colorInput.value = hex;
    }
  } catch (_e) {
    // ignore — leave color input unchanged
  }
}

function normalizeToHex(value) {
  if (!value) return '#000000';
  if (value.startsWith('#') && (value.length === 7 || value.length === 4)) {
    if (value.length === 4) {
      // #rgb -> #rrggbb
      return (
        '#' +
        value
          .slice(1)
          .split('')
          .map((c) => c + c)
          .join('')
      );
    }
    return value;
  }
  try {
    const probe = document.createElement('div');
    probe.style.color = value;
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    document.body.removeChild(probe);
    const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      const r = parseInt(m[1], 10);
      const g = parseInt(m[2], 10);
      const b = parseInt(m[3], 10);
      return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
    }
  } catch (_e) {
    // ignore
  }
  return '#000000';
}

function randomizeColorTheme(d) {
  const hueBase = Math.random() * 360;
  const hsl = (h, s, l, a = 1) =>
    a < 1 ? `hsla(${h % 360}, ${s}%, ${l}%, ${a})` : `hsl(${h % 360}, ${s}%, ${l}%)`;
  const hslHex = (h, s, l) => {
    h = (h % 360) / 360;
    s = s / 100;
    l = l / 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h * 12) % 12;
      const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(c * 255)
        .toString(16)
        .padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  d.colorTheme.BACKGROUND = hslHex(hueBase, 60, 5);
  d.colorTheme.GRID = hslHex(hueBase + 20, 40, 10);
  d.colorTheme.MIDLINE = hslHex(hueBase + 40, 50, 20);
  // Cells: defenders use the "primary" hue, attackers use the complement.
  const defHue = (hueBase + 90) % 360;
  const attHue = (defHue + 180) % 360;
  d.colorTheme.CELL_ALIVE = hslHex(defHue, 80, 55);
  d.colorTheme.CELL_MISSILE = hslHex(attHue, 85, 50);
  d.colorTheme.CELL_CITY = hslHex((hueBase + 180) % 360, 80, 65);
  d.colorTheme.CELL_EXPLOSION = hslHex((hueBase + 30) % 360, 90, 55);
  d.colorTheme.CELL_BARRIER = hslHex(hueBase, 20, 45);
  d.colorTheme.CELL_FIRE = hslHex((attHue + 20) % 360, 90, 50);
  d.colorTheme.CELL_PENDING = hsl(defHue, 80, 55, 0.4);
  // Defense palette: 5 swatches in a tight band around defHue.
  d.colorTheme.DEFENSE_VARIANTS = [
    hslHex(defHue, 85, 55),
    hslHex(defHue + 10, 80, 60),
    hslHex(defHue - 10, 80, 50),
    hslHex(defHue + 20, 75, 65),
    hslHex(defHue, 90, 50),
  ];
  // Missile palette: 6 swatches around attHue.
  d.colorTheme.MISSILE_VARIANTS = [
    hslHex(attHue, 85, 50),
    hslHex(attHue + 8, 90, 55),
    hslHex(attHue - 8, 80, 45),
    hslHex(attHue + 16, 85, 55),
    hslHex(attHue, 95, 45),
    hslHex(attHue - 16, 80, 55),
  ];
  d.colorTheme.HUD_TEXT = hslHex(hueBase + 60, 30, 90);
  d.colorTheme.INK_BAR = hslHex(defHue, 80, 55);
  d.colorTheme.INK_BAR_BG = hslHex(hueBase + 90, 40, 15);
  d.colorTheme.RETURN_FIRE_TEXT = hslHex(hueBase + 120, 70, 60);
  d.colorTheme.RICOCHET_TEXT = hslHex(hueBase + 60, 90, 60);
  d.colorTheme.DRAW_ZONE_BOUNDARY = hsl(defHue, 70, 50, 0.4);
  d.colorTheme.DRAW_ZONE_TINT = hsl(defHue, 60, 40, 0.05);
}

function injectThemePanelStyles() {
  if (document.getElementById('ld-theme-extra-styles')) return;
  const style = document.createElement('style');
  style.id = 'ld-theme-extra-styles';
  style.textContent = `
        .ld-theme-preset-section {
          background: rgba(20, 20, 50, 0.6);
          border: 1px solid #ffcc44;
          border-radius: 6px;
          padding: 12px 14px;
          margin-bottom: 16px;
        }
        .ld-theme-preset-header {
          font-size: 13px;
          font-weight: bold;
          color: #ffcc44;
          letter-spacing: 1px;
          margin-bottom: 6px;
        }
        .ld-theme-preset-hint {
          font-size: 11px;
          color: #a0a0c0;
          font-style: italic;
          margin: 0 0 10px;
          line-height: 1.4;
        }
        .ld-theme-preset-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: 8px;
        }
        .ld-theme-preset-btn {
          background: rgba(10, 10, 30, 0.8);
          border: 1px solid #4040a0;
          border-radius: 4px;
          padding: 8px 6px;
          cursor: pointer;
          transition: all 0.18s ease;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          color: #c0c0d0;
          font-family: inherit;
        }
        .ld-theme-preset-btn:hover {
          border-color: #ffcc44;
          background: rgba(40, 30, 10, 0.85);
          box-shadow: 0 0 10px rgba(255, 204, 68, 0.4);
          transform: translateY(-2px);
        }
        .ld-theme-preset-swatches {
          display: flex;
          gap: 2px;
          height: 18px;
        }
        .ld-theme-preset-swatch {
          width: 12px;
          height: 18px;
          border: 1px solid #2a2a5a;
          border-radius: 2px;
          display: inline-block;
        }
        .ld-theme-preset-name {
          font-size: 11px;
          font-weight: bold;
          text-align: center;
          letter-spacing: 0.3px;
        }
        .ld-theme-group-header {
          font-size: 10px;
          font-weight: bold;
          color: #ffcc44;
          letter-spacing: 2px;
          text-transform: uppercase;
          margin: 14px 0 4px;
          padding-bottom: 3px;
          border-bottom: 1px dashed #4040a0;
        }
        .ld-theme-group-header:first-of-type {
          margin-top: 4px;
        }
        .ld-theme-palette-row {
          display: grid;
          grid-template-columns: 1fr auto 32px;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          background: rgba(20, 20, 50, 0.6);
          border: 1px solid #2a2a5a;
          border-radius: 3px;
          font-size: 12px;
          margin-bottom: 4px;
        }
        .ld-theme-palette-label {
          color: #c0c0d0;
          cursor: default;
        }
        .ld-theme-palette-swatches {
          display: flex;
          gap: 3px;
        }
        .ld-theme-palette-swatch-wrap {
          position: relative;
        }
        .ld-theme-palette-color {
          width: 28px;
          height: 24px;
          border: 1px solid #4040a0;
          background: #0a0a20;
          cursor: pointer;
          padding: 0;
          border-radius: 3px;
        }
        .ld-theme-palette-color:hover {
          border-color: #ffcc44;
          box-shadow: 0 0 4px rgba(255, 204, 68, 0.5);
        }
      `;
  document.head.appendChild(style);
}
