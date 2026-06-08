// Canvas rendering for the LevelDesigner. Encapsulates all draw
// operations into a single class that takes a designer reference
// (for access to state) and a 2D context.

import { CONFIG } from '../config.js';
import { getTopology } from '../topology.js';
import { PREVIEW_RGB_BY_TARGET } from './constants.js';

export class DesignerRenderer {
  constructor(designer) {
    this.d = designer;
  }

  get ctx() {
    return this.d.ctx;
  }

  // Resolve a theme color with overrides from the designer.
  _theme(k, fallback) {
    const d = this.d;
    if (d.colorTheme && d.colorTheme[k]) return d.colorTheme[k];
    return CONFIG.COLORS[k] || fallback;
  }

  draw() {
    const d = this.d;
    const ctx = this.ctx;
    const cs = d.cellSize;
    const w = d.canvas.width;
    const h = d.canvas.height;
    // Background.
    ctx.fillStyle = this._theme('BACKGROUND', '#000010');
    ctx.fillRect(0, 0, w, h);
    // Grid / topology outlines.
    if (cs >= 4) {
      if (d.topologyId === 'square') this._drawSquareGrid(ctx, w, h, cs);
      else this._drawTopologyGrid(ctx);
    }
    this._drawZones(ctx, w, h, cs);
    this._drawBarriers(ctx);
    this._drawFire(ctx);
    this._drawDefenseCells(ctx);
    this._drawEnemyCells(ctx);
    this._drawCities(ctx);
    this._drawBases(ctx, cs);
    this._drawSpawners(ctx, cs);
    this._drawPreviews();
  }

  _drawSquareGrid(ctx, w, h, cs) {
    const d = this.d;
    ctx.strokeStyle = 'rgba(64, 64, 160, 0.15)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= d.gridWidth; i++) {
      const x = i * cs + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let i = 0; i <= d.gridHeight; i++) {
      const y = i * cs + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  _drawZones(ctx, w, h, cs) {
    const d = this.d;
    const settings = d.levelSettings || {};
    const dzFrac =
      settings.DRAW_ZONE_FRACTION != null
        ? settings.DRAW_ZONE_FRACTION
        : CONFIG.DRAW_ZONE_FRACTION || 0.5;
    const rearH =
      settings.REAR_DEAD_ZONE_HEIGHT != null
        ? settings.REAR_DEAD_ZONE_HEIGHT
        : CONFIG.REAR_DEAD_ZONE_HEIGHT || 2;
    const baseZoneH =
      settings.BASE_ZONE_HEIGHT != null ? settings.BASE_ZONE_HEIGHT : CONFIG.BASE_ZONE_HEIGHT || 12;
    const topDeadMax =
      settings.RETURN_FIRE_ZONE_MAX_Y != null
        ? settings.RETURN_FIRE_ZONE_MAX_Y
        : CONFIG.RETURN_FIRE_ZONE_MAX_Y || 4;
    const dzMinY = Math.floor(d.gridHeight * (1 - dzFrac));
    const dzMaxY = d.gridHeight - rearH - 1;
    ctx.fillStyle = 'rgba(80, 80, 80, 0.10)';
    ctx.fillRect(0, 0, w, (topDeadMax + 1) * cs);
    const bzMinY = topDeadMax + 1;
    const bzMaxY = Math.min(bzMinY + baseZoneH - 1, dzMinY - 1);
    if (bzMaxY >= bzMinY) {
      ctx.fillStyle = 'rgba(255, 180, 60, 0.08)';
      ctx.fillRect(0, bzMinY * cs, w, (bzMaxY - bzMinY + 1) * cs);
    }
    ctx.fillStyle = 'rgba(0, 255, 136, 0.04)';
    ctx.fillRect(0, dzMinY * cs, w, (dzMaxY - dzMinY + 1) * cs);
    ctx.fillStyle = 'rgba(255, 80, 80, 0.06)';
    ctx.fillRect(0, (dzMaxY + 1) * cs, w, rearH * cs);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(120, 120, 120, 0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, (topDeadMax + 1) * cs + 0.5);
    ctx.lineTo(w, (topDeadMax + 1) * cs + 0.5);
    ctx.stroke();
    // Wrap shift indicator.
    if (d.wrapVerticalShift && d.wrapVerticalShift !== 0) {
      ctx.strokeStyle = 'rgba(255, 200, 80, 0.6)';
      ctx.setLineDash([2, 2]);
      const shiftPx = -d.wrapVerticalShift * cs;
      ctx.beginPath();
      ctx.moveTo(w - 4, (d.gridHeight * cs) / 2);
      ctx.lineTo(w - 4, (d.gridHeight * cs) / 2 + shiftPx);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 200, 80, 0.85)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`wrap +${d.wrapVerticalShift}`, w - 8, (d.gridHeight * cs) / 2 + shiftPx + 12);
      ctx.setLineDash([]);
    }
    if (bzMaxY >= bzMinY) {
      ctx.strokeStyle = 'rgba(255, 180, 60, 0.6)';
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(0, (bzMaxY + 1) * cs + 0.5);
      ctx.lineTo(w, (bzMaxY + 1) * cs + 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0, 255, 200, 0.6)';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, dzMinY * cs + 0.5);
    ctx.lineTo(w, dzMinY * cs + 0.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.6)';
    ctx.beginPath();
    ctx.moveTo(0, (dzMaxY + 1) * cs + 0.5);
    ctx.lineTo(w, (dzMaxY + 1) * cs + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    if (cs >= 3) {
      ctx.font = `bold ${Math.max(9, Math.min(12, cs * 1.4))}px monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(180, 180, 180, 0.7)';
      ctx.fillText('▲ TOP DEAD ZONE', 4, 2);
      if (bzMaxY >= bzMinY) {
        ctx.fillStyle = 'rgba(255, 180, 60, 0.85)';
        ctx.fillText('◆ BASE ZONE', 4, bzMinY * cs + 2);
      }
      ctx.fillStyle = 'rgba(0, 255, 200, 0.85)';
      ctx.fillText('▼ DRAW ZONE', 4, dzMinY * cs + 2);
      if (rearH > 0) {
        ctx.fillStyle = 'rgba(255, 100, 100, 0.85)';
        ctx.fillText('▲ REAR DEAD ZONE', 4, (dzMaxY + 1) * cs + 2);
      }
    }
  }

  _drawBarriers(ctx) {
    const d = this.d;
    const barrierColor = (d.colorTheme && d.colorTheme.CELL_BARRIER) || '#a0a0a0';
    for (const key of d.barrierCells) {
      const [x, y] = key.split(',').map(Number);
      this.fillCell(ctx, x, y, barrierColor);
    }
  }

  _drawFire(ctx) {
    const d = this.d;
    const fireColor = (d.colorTheme && d.colorTheme.CELL_FIRE) || '#ff6622';
    ctx.shadowColor = fireColor;
    ctx.shadowBlur = 5;
    for (const key of d.fireCells) {
      const [x, y] = key.split(',').map(Number);
      this.fillCell(ctx, x, y, fireColor);
    }
    ctx.shadowBlur = 0;
  }

  _drawDefenseCells(ctx) {
    const d = this.d;
    ctx.fillStyle = '#00ff88';
    for (const key of d.defenseCells) {
      const [x, y] = key.split(',').map(Number);
      this.fillCell(ctx, x, y, '#00ff88');
    }
  }

  _drawEnemyCells(ctx) {
    const d = this.d;
    const enemyColor = (d.colorTheme && d.colorTheme.CELL_ENEMY) || '#ff3344';
    ctx.shadowColor = enemyColor;
    ctx.shadowBlur = 4;
    for (const key of d.enemyCells) {
      const [x, y] = key.split(',').map(Number);
      this.fillCell(ctx, x, y, enemyColor);
    }
    ctx.shadowBlur = 0;
  }

  _drawCities(ctx) {
    const d = this.d;
    const cityColor = (d.colorTheme && d.colorTheme.CELL_CITY) || '#ffff60';
    ctx.shadowColor = cityColor;
    ctx.shadowBlur = 6;
    for (const c of d.cities) {
      if (c.cells && Array.isArray(c.cells)) {
        for (const [dx, dy] of c.cells) {
          this.fillCell(ctx, c.x + dx, c.y + dy, cityColor);
        }
      } else {
        for (let dy = 0; dy < c.height; dy++) {
          for (let dx = 0; dx < c.width; dx++) {
            this.fillCell(ctx, c.x + dx, c.y + dy, cityColor);
          }
        }
      }
    }
    ctx.shadowBlur = 0;
  }

  _drawBases(ctx, cs) {
    const d = this.d;
    for (const pb of d.bases) {
      if (d.topologyId === 'square') {
        ctx.strokeStyle = 'rgba(255, 120, 60, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(pb.x * cs, pb.y * cs, pb.width * cs, pb.height * cs);
        ctx.setLineDash([]);
      }
      ctx.shadowColor = '#ff7733';
      ctx.shadowBlur = 4;
      for (const [dx, dy] of pb.cells) {
        this.fillCell(ctx, pb.x + dx, pb.y + dy, '#ff7733');
      }
      ctx.shadowBlur = 0;
      if (cs >= 4 && pb.name) {
        ctx.fillStyle = '#ffaa66';
        ctx.font = `bold ${Math.max(8, Math.min(12, cs * 1.2))}px monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const labelPos = this.cellPixelPos(pb.x, pb.y);
        ctx.fillText(pb.name, labelPos.px + 2, labelPos.py - 1);
      }
    }
  }

  _drawSpawners(ctx, cs) {
    const d = this.d;
    for (const sp of d.spawners) {
      if (d.topologyId === 'square') {
        ctx.strokeStyle = 'rgba(255, 100, 220, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 2]);
        ctx.strokeRect(sp.x * cs, sp.y * cs, sp.width * cs, sp.height * cs);
        ctx.setLineDash([]);
      }
      ctx.shadowColor = '#ff66cc';
      ctx.shadowBlur = 5;
      for (const [dx, dy] of sp.cells) {
        this.fillCell(ctx, sp.x + dx, sp.y + dy, '#ff66cc');
      }
      ctx.shadowBlur = 0;
      if (cs >= 4 && sp.name) {
        ctx.fillStyle = '#ffaaee';
        ctx.font = `bold ${Math.max(8, Math.min(12, cs * 1.2))}px monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const labelPos = this.cellPixelPos(sp.x, sp.y);
        const limitStr = sp.emitLimit > 0 ? `×${sp.emitLimit}` : '∞';
        const intervalSec = ((sp.interval || 2000) / 1000).toFixed(1);
        const paddingStr = sp.padding != null && sp.padding !== 1 ? ` p${sp.padding}` : '';
        ctx.fillText(
          `🚀 ${sp.name} ${limitStr} @${intervalSec}s${paddingStr}`,
          labelPos.px + 2,
          labelPos.py - 1
        );
      }
    }
  }

  // Fill a single cell using the current topology.
  fillCell(ctx, x, y, color) {
    const d = this.d;
    const cs = d.cellSize;
    if (d.topologyId === 'square') {
      ctx.fillStyle = color;
      ctx.fillRect(x * cs + 1, y * cs + 1, Math.max(1, cs - 2), Math.max(1, cs - 2));
      return;
    }
    const topology = getTopology(d.topologyId);
    if (d.topologyId === 'tri') {
      for (let o = 0; o < 2; o++) {
        const verts = topology.cellPolygon(x, y, cs, o);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(verts[0][0], verts[0][1]);
        for (let v = 1; v < verts.length; v++) ctx.lineTo(verts[v][0], verts[v][1]);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    const verts = topology.cellPolygon(x, y, cs);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(verts[0][0], verts[0][1]);
    for (let v = 1; v < verts.length; v++) ctx.lineTo(verts[v][0], verts[v][1]);
    ctx.closePath();
    ctx.fill();
  }

  cellPixelPos(x, y) {
    const d = this.d;
    const cs = d.cellSize;
    if (d.topologyId === 'square') return { px: x * cs, py: y * cs };
    const topology = getTopology(d.topologyId);
    if (d.topologyId === 'tri') return topology.cellToPixel(x, y, cs, 0);
    return topology.cellToPixel(x, y, cs);
  }

  _drawTopologyGrid(ctx) {
    const d = this.d;
    const cs = d.cellSize;
    const topology = getTopology(d.topologyId);
    ctx.strokeStyle = 'rgba(64, 64, 160, 0.18)';
    ctx.lineWidth = 1;
    if (d.topologyId === 'hex') {
      for (let r = 0; r < d.gridHeight; r++) {
        for (let q = 0; q < d.gridWidth; q++) {
          const verts = topology.cellPolygon(q, r, cs);
          ctx.beginPath();
          ctx.moveTo(verts[0][0], verts[0][1]);
          for (let v = 1; v < verts.length; v++) ctx.lineTo(verts[v][0], verts[v][1]);
          ctx.closePath();
          ctx.stroke();
        }
      }
    } else if (d.topologyId === 'tri') {
      for (let y = 0; y < d.gridHeight; y++) {
        for (let x = 0; x < d.gridWidth; x++) {
          for (let o = 0; o < 2; o++) {
            const verts = topology.cellPolygon(x, y, cs, o);
            ctx.beginPath();
            ctx.moveTo(verts[0][0], verts[0][1]);
            for (let v = 1; v < verts.length; v++) ctx.lineTo(verts[v][0], verts[v][1]);
            ctx.closePath();
            ctx.stroke();
          }
        }
      }
    }
  }

  _drawPreviews() {
    const d = this.d;
    const ctx = this.ctx;
    const cs = d.cellSize;
    const hover = d._hoverCell;
    const pulse = 0.55 + 0.15 * Math.sin(performance.now() / 200);
    const cellPreviewRgb = PREVIEW_RGB_BY_TARGET[d.paintTarget] || PREVIEW_RGB_BY_TARGET.defense;
    const isErase = d.paintTarget === 'erase';
    // Line preview (during drag).
    if (d.mode === 'line' && d._linePreview && d._linePreview.length > 0) {
      for (const [x, y] of d._linePreview) {
        this.fillCell(ctx, x, y, `rgba(${cellPreviewRgb}, ${pulse})`);
      }
      return;
    }
    // Fill preview (during drag).
    if (d.mode === 'fill' && d._fillPreview && d._fillPreview.length > 0) {
      for (const [x, y] of d._fillPreview) {
        this.fillCell(ctx, x, y, `rgba(${cellPreviewRgb}, ${pulse * 0.8})`);
      }
      return;
    }
    if (!hover) return;
    if (d.mode === 'pattern' && d._stampPattern) {
      this._drawStampPreview(d._stampPattern, hover, cellPreviewRgb, pulse, cs);
      return;
    }
    if (d.mode === 'base' && d._basePattern) {
      this._drawBaseSpawnerPreview(
        d._basePattern,
        hover,
        '255, 119, 51',
        '255, 120, 60',
        [3, 3],
        1.5,
        pulse,
        cs
      );
      return;
    }
    if (d.mode === 'spawner' && d._spawnerPattern) {
      this._drawBaseSpawnerPreview(
        d._spawnerPattern,
        hover,
        '255, 102, 204',
        '255, 100, 220',
        [4, 2],
        2,
        pulse,
        cs
      );
      return;
    }
    if (d.mode === 'city') {
      this._drawCityPreview(hover, pulse, cs);
      return;
    }
    if (d.mode === 'defense') {
      this._drawBrushPreview(hover, cellPreviewRgb, isErase, pulse, cs);
    }
  }

  _drawStampPreview(stamp, hover, cellPreviewRgb, pulse, cs) {
    const d = this.d;
    const ctx = this.ctx;
    const offX = hover.x - Math.floor(stamp.width / 2);
    const offY = hover.y - Math.floor(stamp.height / 2);
    for (const [dx, dy] of stamp.cells) {
      const px = offX + dx;
      const py = offY + dy;
      if (px < 0 || px >= d.gridWidth || py < 0 || py >= d.gridHeight) continue;
      this.fillCell(ctx, px, py, `rgba(${cellPreviewRgb}, ${pulse})`);
    }
    if (d.topologyId === 'square') {
      ctx.strokeStyle = `rgba(${cellPreviewRgb}, ${pulse * 0.7})`;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(offX * cs, offY * cs, stamp.width * cs, stamp.height * cs);
      ctx.setLineDash([]);
    }
  }

  _drawBaseSpawnerPreview(stamp, hover, fillRgb, strokeRgb, dash, lineWidth, pulse, cs) {
    const d = this.d;
    const ctx = this.ctx;
    const offX = hover.x - Math.floor(stamp.width / 2);
    const offY = hover.y - Math.floor(stamp.height / 2);
    for (const [dx, dy] of stamp.cells) {
      const px = offX + dx;
      const py = offY + dy;
      if (px < 0 || px >= d.gridWidth || py < 0 || py >= d.gridHeight) continue;
      this.fillCell(ctx, px, py, `rgba(${fillRgb}, ${pulse})`);
    }
    if (d.topologyId === 'square') {
      ctx.strokeStyle = `rgba(${strokeRgb}, ${pulse * 0.8})`;
      ctx.setLineDash(dash);
      ctx.lineWidth = lineWidth;
      ctx.strokeRect(offX * cs, offY * cs, stamp.width * cs, stamp.height * cs);
      ctx.setLineDash([]);
    }
  }

  _drawCityPreview(hover, pulse, cs) {
    const d = this.d;
    const ctx = this.ctx;
    const pattern = d._cityPattern;
    const cw = pattern ? pattern.width : CONFIG.CITY_WIDTH || 5;
    const ch = pattern ? pattern.height : CONFIG.CITY_HEIGHT || 3;
    const cx = Math.max(0, Math.min(d.gridWidth - cw, hover.x - Math.floor(cw / 2)));
    const cy = Math.max(0, Math.min(d.gridHeight - ch, hover.y - Math.floor(ch / 2)));
    if (pattern && pattern.cells) {
      for (const [dx, dy] of pattern.cells) {
        this.fillCell(ctx, cx + dx, cy + dy, `rgba(255, 255, 96, ${pulse * 0.8})`);
      }
    } else {
      for (let dy = 0; dy < ch; dy++) {
        for (let dx = 0; dx < cw; dx++) {
          this.fillCell(ctx, cx + dx, cy + dy, `rgba(255, 255, 96, ${pulse * 0.6})`);
        }
      }
    }
    if (d.topologyId === 'square') {
      ctx.strokeStyle = `rgba(255, 255, 96, ${pulse})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx * cs, cy * cs, cw * cs, ch * cs);
    }
  }

  _drawBrushPreview(hover, cellPreviewRgb, isErase, pulse, cs) {
    const d = this.d;
    const ctx = this.ctx;
    const r = Math.floor(d.brushSize / 2);
    const alphaScale = isErase ? 1.0 : 0.6;
    if (d.topologyId === 'square') {
      ctx.strokeStyle = `rgba(${cellPreviewRgb}, ${pulse * alphaScale})`;
      ctx.lineWidth = isErase ? 1.5 : 1;
      ctx.strokeRect((hover.x - r) * cs, (hover.y - r) * cs, (r * 2 + 1) * cs, (r * 2 + 1) * cs);
    } else {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const px = hover.x + dx;
          const py = hover.y + dy;
          if (px < 0 || px >= d.gridWidth || py < 0 || py >= d.gridHeight) continue;
          this.fillCell(ctx, px, py, `rgba(${cellPreviewRgb}, ${pulse * 0.3})`);
        }
      }
    }
  }
}
