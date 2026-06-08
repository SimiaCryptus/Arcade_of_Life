// Theme panel: lets the user override CONFIG.COLORS keys for a level.

export const THEME_DEFS = [
  { key: 'BACKGROUND', label: 'Background', default: '#000010' },
  { key: 'GRID', label: 'Grid lines', default: '#0a0a20' },
  { key: 'MIDLINE', label: 'Draw-zone midline', default: '#2a2a5a' },
  { key: 'CELL_CITY', label: 'City cells', default: '#ffff60' },
  { key: 'CELL_ENEMY', label: 'Enemy cells', default: '#ff3344' },
  { key: 'CELL_EXPLOSION', label: 'Explosion cells', default: '#ff8800' },
  { key: 'CELL_FIRE', label: 'Fire cells', default: '#ff6622' },
  { key: 'HUD_TEXT', label: 'HUD text', default: '#e0e0ff' },
  { key: 'INK_BAR', label: 'Ink bar', default: '#00ffff' },
  { key: 'INK_BAR_BG', label: 'Ink bar bg', default: '#1a1a3a' },
  { key: 'RETURN_FIRE_TEXT', label: 'Return-fire text', default: '#00ffff' },
  { key: 'RICOCHET_TEXT', label: 'Ricochet text', default: '#ffaa00' },
  {
    key: 'DRAW_ZONE_BOUNDARY',
    label: 'Draw-zone boundary',
    default: 'rgba(0, 255, 200, 0.35)',
  },
  { key: 'DRAW_ZONE_TINT', label: 'Draw-zone tint', default: 'rgba(0, 255, 136, 0.04)' },
];

/**
 * Build the theme tab UI inside the designer overlay.
 * Returns a controller object with .syncFromState() to push state into UI.
 */
export function buildThemePanel(d) {
  const container = d.overlay.querySelector('#ld-theme-list');
  if (!container) return null;
  container.innerHTML = '';
  const themeInputs = {};
  for (const def of THEME_DEFS) {
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
    container.appendChild(row);
    themeInputs[def.key] = { colorInput, textInput, swatch, def };
  }
  const resetBtn = d.overlay.querySelector('#ld-theme-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (!confirm('Reset all color theme overrides?')) return;
      d.colorTheme = {};
      syncThemePanelFromState(d, themeInputs);
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
  return {
    themeInputs,
    syncFromState: () => syncThemePanelFromState(d, themeInputs),
  };
}

export function syncThemePanelFromState(d, themeInputs) {
  if (!themeInputs) return;
  for (const [key, entry] of Object.entries(themeInputs)) {
    const val = d.colorTheme[key] || '';
    entry.textInput.value = val;
    setSwatchAndColor(entry.colorInput, entry.swatch, val || entry.def.default || '');
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
  d.colorTheme.CELL_CITY = hslHex(hueBase + 180, 80, 65);
  d.colorTheme.CELL_EXPLOSION = hslHex((hueBase + 30) % 360, 90, 55);
  d.colorTheme.HUD_TEXT = hslHex(hueBase + 60, 30, 90);
  d.colorTheme.INK_BAR = hslHex(hueBase + 90, 80, 55);
  d.colorTheme.INK_BAR_BG = hslHex(hueBase + 90, 40, 15);
  d.colorTheme.RETURN_FIRE_TEXT = hslHex(hueBase + 120, 70, 60);
  d.colorTheme.RICOCHET_TEXT = hslHex(hueBase + 60, 90, 60);
  d.colorTheme.DRAW_ZONE_BOUNDARY = hsl(hueBase + 150, 70, 50, 0.4);
  d.colorTheme.DRAW_ZONE_TINT = hsl(hueBase + 150, 60, 40, 0.05);
}
