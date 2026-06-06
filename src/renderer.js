import { CONFIG, CELL_TYPE } from './config.js';
import { Logger } from './logger.js';
import { getTopology } from './topology.js';
// VFX rate-limit configuration. Tuned to keep the renderer responsive
// even under chaotic game modes (e.g. Chaos, Apocalypse) where dozens
// of collisions can occur per tick.
const VFX_LIMITS = {
  // Hard caps: once these are exceeded, new effects of that type are
  // dropped (or replace the oldest, for floaters).
  MAX_PARTICLES: 800,
  MAX_SHOCKWAVES: 40,
  MAX_FLOATERS: 30,
  // Per-frame spawn budgets. Reset each render() call. Once exceeded,
  // additional spawn requests are silently dropped.
  PARTICLES_PER_FRAME: 300,
  SHOCKWAVES_PER_FRAME: 12,
  FLOATERS_PER_FRAME: 8,
  // Adaptive throttling: when active particle count exceeds this
  // fraction of MAX_PARTICLES, randomly drop a fraction of new
  // particle spawn requests proportional to how overloaded we are.
  PARTICLE_THROTTLE_THRESHOLD: 0.6,
  // Floater deduplication: identical text at near-identical position
  // within this many pixels is treated as a duplicate.

  FLOATER_DEDUP_RADIUS: 24,
  // Maximum age (ms) of a floater that blocks duplicates from spawning.
  FLOATER_DEDUP_WINDOW_MS: 250,
  // Screen shake: ignore new shake requests if current shake is already
  // at or above this intensity (avoids stacking).
  SHAKE_STACK_THRESHOLD: 1.5,
};

/**
 * Renders the grid and HUD onto the canvas.
 */
export class Renderer {
  constructor(canvas, grid) {
    this.canvas = canvas;
    this.grid = grid;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) {
      Logger.error('Renderer: failed to acquire 2D canvas context.');
      throw new Error('Canvas 2D context unavailable.');
    }
    // Optional input manager for previewing pending stamps/lines.
    this.input = null;
    // Floating text effects (e.g. "RETURN FIRE!", "BOUNCE!").
    // Each: { x, y, text, color, ttl, maxTtl, scale? }
    this.floaters = [];
    // Particle effects (plumes, sparks, debris).
    // Each: { x, y, vx, vy, color, ttl, maxTtl, size, gravity, glow }
    this.particles = [];
    // Shockwaves (expanding rings). Each: { x, y, radius, maxRadius, color, ttl, maxTtl, width }
    this.shockwaves = [];
    // Screen shake state.
    this.shakeTime = 0;
    this.shakeIntensity = 0;
    // Per-frame spawn counters (reset in render()).
    this._frameParticleSpawns = 0;
    this._frameShockwaveSpawns = 0;
    this._frameFloaterSpawns = 0;
    // Drop counters for diagnostics (peek via window.MD.game.renderer._vfxStats).
    this._vfxStats = {
      particlesDropped: 0,
      shockwavesDropped: 0,
      floatersDropped: 0,
      floatersDeduped: 0,
      sinceMs: Date.now(),
    };
    this.resize();
  }

  // Recompute canvas size from current grid + CONFIG.
  // Call this after resolution changes or grid replacement.
  resize() {
    const topologyId = this.grid.topologyId || 'square';
    if (topologyId === 'square') {
      this.canvas.width = this.grid.width * CONFIG.CELL_SIZE;
      this.canvas.height = this.grid.height * CONFIG.CELL_SIZE + CONFIG.HUD_HEIGHT;
    } else {
      const topology = getTopology(topologyId);
      const dims = topology.canvasSize(this.grid.width, this.grid.height, CONFIG.CELL_SIZE);
      this.canvas.width = Math.ceil(dims.w);
      this.canvas.height = Math.ceil(dims.h) + CONFIG.HUD_HEIGHT;
    }
  }
  // Return whether a floater with the same text would be a duplicate
  // of a recently-spawned one nearby. Helps prevent floater spam when
  // many identical events fire in quick succession.
  _isDuplicateFloater(canvasX, canvasY, text) {
    const now = performance.now();
    const r2 = VFX_LIMITS.FLOATER_DEDUP_RADIUS * VFX_LIMITS.FLOATER_DEDUP_RADIUS;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      // Only check recently-born floaters.
      const ageMs = (f.maxTtl - f.ttl) * (1000 / 60); // approx (60fps assumed)
      if (ageMs > VFX_LIMITS.FLOATER_DEDUP_WINDOW_MS) continue;
      if (f.text !== text) continue;
      const dx = f.x - canvasX;
      const dy = f.y - canvasY;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  }
  // Convert grid coords (gx, gy) to absolute canvas pixel coords,
  // respecting the active grid topology (square / hex / tri).
  // Used by all VFX entry points so effects line up with the cells
  // they're depicting regardless of topology.
  _gridToCanvas(gx, gy) {
    const cs = CONFIG.CELL_SIZE;
    const topologyId = (this.grid && this.grid.topologyId) || 'square';
    if (topologyId === 'square') {
      return {
        x: gx * cs + cs / 2,
        y: gy * cs + CONFIG.HUD_HEIGHT + cs / 2,
      };
    }
    const topology = getTopology(topologyId);
    if (topologyId === 'tri') {
      const c = topology.cellCenter(gx, gy, cs, 0);
      return { x: c.px, y: c.py + CONFIG.HUD_HEIGHT };
    }
    // hex
    const c = topology.cellCenter(gx, gy, cs);
    return { x: c.px, y: c.py + CONFIG.HUD_HEIGHT };
  }

  addFloater(gx, gy, text, color) {
    if (CONFIG.VFX_FLOATERS === false) return;
    if (this._frameFloaterSpawns >= VFX_LIMITS.FLOATERS_PER_FRAME) {
      this._vfxStats.floatersDropped++;
      return;
    }
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) {
      Logger.warn('addFloater: invalid coordinates', { gx, gy });
      return;
    }
    const { x: canvasX, y: canvasY } = this._gridToCanvas(gx, gy);
    // Floaters anchor at the top edge of a cell so they appear above it.
    // _gridToCanvas returns center; subtract half-cell to get top edge.
    const cellH = CONFIG.CELL_SIZE / 2;
    const adjustedY = canvasY - cellH;
    if (this._isDuplicateFloater(canvasX, canvasY, text)) {
      this._vfxStats.floatersDeduped++;
      return;
    }
    // Hard cap: evict oldest floater if at max.
    if (this.floaters.length >= VFX_LIMITS.MAX_FLOATERS) {
      this.floaters.shift();
    }
    this.floaters.push({
      x: canvasX,
      y: adjustedY,
      text,
      color,
      ttl: 60,
      maxTtl: 60,
      scale: 1.0,
    });
    this._frameFloaterSpawns++;
  }

  addBigFloater(gx, gy, text, color, scale = 1.6) {
    if (CONFIG.VFX_FLOATERS === false) return;
    if (this._frameFloaterSpawns >= VFX_LIMITS.FLOATERS_PER_FRAME) {
      this._vfxStats.floatersDropped++;
      return;
    }
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) {
      Logger.warn('addBigFloater: invalid coordinates', { gx, gy });
      return;
    }
    const { x: canvasX, y: canvasY } = this._gridToCanvas(gx, gy);
    const cellH = CONFIG.CELL_SIZE / 2;
    const adjustedY = canvasY - cellH;
    if (this._isDuplicateFloater(canvasX, canvasY, text)) {
      this._vfxStats.floatersDeduped++;
      return;
    }
    if (this.floaters.length >= VFX_LIMITS.MAX_FLOATERS) {
      this.floaters.shift();
    }
    this.floaters.push({
      x: canvasX,
      y: adjustedY,
      text,
      color,
      ttl: 90,
      maxTtl: 90,
      scale,
    });
    this._frameFloaterSpawns++;
  }

  // Spawn a burst of particles centered on grid (gx, gy).
  // opts: { count, color(s), speed, spread, ttl, size, gravity, glow, vy0 }
  addParticleBurst(gx, gy, opts = {}) {
    if (CONFIG.VFX_PARTICLES === false) return;
    // Per-frame budget check.
    if (this._frameParticleSpawns >= VFX_LIMITS.PARTICLES_PER_FRAME) {
      this._vfxStats.particlesDropped += opts.count != null ? opts.count : 12;
      return;
    }
    // Hard cap check.
    if (this.particles.length >= VFX_LIMITS.MAX_PARTICLES) {
      this._vfxStats.particlesDropped += opts.count != null ? opts.count : 12;
      return;
    }
    // Validate grid coordinates to prevent NaN propagation.
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) {
      Logger.warn('addParticleBurst: invalid coordinates', { gx, gy });
      return;
    }
    // Adaptive throttling: if we're in the overload zone, scale down.
    const loadFrac = this.particles.length / VFX_LIMITS.MAX_PARTICLES;
    let countScale = 1;
    if (loadFrac > VFX_LIMITS.PARTICLE_THROTTLE_THRESHOLD) {
      // Linear ramp: at threshold -> 1.0, at max -> 0.2.
      const overload =
        (loadFrac - VFX_LIMITS.PARTICLE_THROTTLE_THRESHOLD) /
        (1 - VFX_LIMITS.PARTICLE_THROTTLE_THRESHOLD);
      countScale = Math.max(0.2, 1 - overload * 0.8);
    }
    const requestedCount = opts.count != null ? opts.count : 12;
    let count = Math.max(1, Math.round(requestedCount * countScale));
    // Also clamp by remaining per-frame and per-array budgets.
    const frameRemaining = VFX_LIMITS.PARTICLES_PER_FRAME - this._frameParticleSpawns;
    const arrayRemaining = VFX_LIMITS.MAX_PARTICLES - this.particles.length;
    count = Math.min(count, frameRemaining, arrayRemaining);
    if (count <= 0) {
      this._vfxStats.particlesDropped += requestedCount;
      return;
    }
    if (count < requestedCount) {
      this._vfxStats.particlesDropped += requestedCount - count;
    }
    const colors = Array.isArray(opts.colors)
      ? opts.colors
      : opts.color
        ? [opts.color]
        : ['#ffffff'];
    const speed = opts.speed != null ? opts.speed : 1.5;
    const spread = opts.spread != null ? opts.spread : Math.PI * 2;
    const dir = opts.dir != null ? opts.dir : 0;
    const ttl = opts.ttl != null ? opts.ttl : 30;
    const size = opts.size != null ? opts.size : 2;
    const gravity = opts.gravity != null ? opts.gravity : 0;
    const glow = opts.glow != null ? opts.glow : 6;
    const vy0 = opts.vy0 != null ? opts.vy0 : 0;
    const { x: cx, y: cy } = this._gridToCanvas(gx, gy);
    const cs = CONFIG.CELL_SIZE;
    for (let i = 0; i < count; i++) {
      const a = dir - spread / 2 + Math.random() * spread;
      const v = speed * (0.5 + Math.random());
      const lifeJitter = 0.6 + Math.random() * 0.6;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * cs * 0.6,
        y: cy + (Math.random() - 0.5) * cs * 0.6,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v + vy0,
        color: colors[(Math.random() * colors.length) | 0],
        ttl: ttl * lifeJitter,
        maxTtl: ttl * lifeJitter,
        size: size * (0.7 + Math.random() * 0.7),
        gravity,
        glow,
      });
    }
    this._frameParticleSpawns += count;
  }

  // Add an expanding shockwave ring.
  addShockwave(gx, gy, opts = {}) {
    if (CONFIG.VFX_SHOCKWAVES === false) return;
    if (this._frameShockwaveSpawns >= VFX_LIMITS.SHOCKWAVES_PER_FRAME) {
      this._vfxStats.shockwavesDropped++;
      return;
    }
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) {
      Logger.warn('addShockwave: invalid coordinates', { gx, gy });
      return;
    }
    if (this.shockwaves.length >= VFX_LIMITS.MAX_SHOCKWAVES) {
      // Drop the oldest to make room (rings fade quickly so this is fine).
      this.shockwaves.shift();
    }
    const { x: shockX, y: shockY } = this._gridToCanvas(gx, gy);
    this.shockwaves.push({
      x: shockX,
      y: shockY,
      radius: opts.startRadius != null ? opts.startRadius : 2,
      maxRadius: opts.maxRadius != null ? opts.maxRadius : 40,
      color: opts.color || '#ffffff',
      ttl: opts.ttl != null ? opts.ttl : 24,
      maxTtl: opts.ttl != null ? opts.ttl : 24,
      width: opts.width != null ? opts.width : 2,
    });
    this._frameShockwaveSpawns++;
  }

  // Trigger screen shake for `ticks` frames with given intensity in px.
  addShake(intensity, ticks) {
    if (CONFIG.VFX_SCREEN_SHAKE === false) return;
    // Don't allow shake to stack indefinitely: if current shake is
    // already strong enough, just refresh the duration.
    if (this.shakeIntensity >= VFX_LIMITS.SHAKE_STACK_THRESHOLD) {
      if (ticks > this.shakeTime) this.shakeTime = ticks;
      return;
    }
    if (intensity > this.shakeIntensity) this.shakeIntensity = intensity;
    if (ticks > this.shakeTime) this.shakeTime = ticks;
  }

  setInput(input) {
    this.input = input;
  }

  setGrid(grid) {
    this.grid = grid;
    this.resize();
  }

  render(hud) {
    // Reset per-frame VFX spawn budgets.
    this._frameParticleSpawns = 0;
    this._frameShockwaveSpawns = 0;
    this._frameFloaterSpawns = 0;
    const ctx = this.ctx;
    const cs = CONFIG.CELL_SIZE;
    const colors = CONFIG.COLORS;
    const defenseVariants = colors.DEFENSE_VARIANTS;
    const missileVariants = colors.MISSILE_VARIANTS;

    // Background
    ctx.fillStyle = colors.BACKGROUND;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Screen shake transform (only the play area, not HUD).
    let shakeX = 0,
      shakeY = 0;
    if (this.shakeTime > 0 && this.shakeIntensity > 0) {
      shakeX = (Math.random() - 0.5) * this.shakeIntensity * 2;
      shakeY = (Math.random() - 0.5) * this.shakeIntensity * 2;
      this.shakeTime--;
      if (this.shakeTime <= 0) {
        this.shakeIntensity = 0;
      } else {
        // Decay intensity over time.
        this.shakeIntensity *= 0.9;
      }
    }
    ctx.save();
    ctx.translate(shakeX, shakeY);

    const gridYOffset = CONFIG.HUD_HEIGHT;

    // Draw the draw-zone boundary + a subtle tint over the drawable area.
    const topologyId = this.grid.topologyId || 'square';
    const playfieldH = this.canvas.height - gridYOffset;
    let zoneRowToY;
    if (topologyId === 'square') {
      zoneRowToY = (row) => row * cs + gridYOffset;
    } else if (topologyId === 'hex') {
      const s = cs / 2;
      zoneRowToY = (row) => 1.5 * s * row + gridYOffset;
    } else if (topologyId === 'tri') {
      const triH = (cs * Math.sqrt(3)) / 2;
      zoneRowToY = (row) => row * triH + gridYOffset;
    } else {
      zoneRowToY = (row) => row * cs + gridYOffset;
    }
    const dzMinY = this.grid.drawZoneMinY();
    const midY = zoneRowToY(dzMinY);
    const rearY = zoneRowToY(this.grid.rearDeadZoneMinY());
    const playfieldBottom = gridYOffset + playfieldH;
    // Base zone band (between top dead zone and missile spawn line).
    const bz = this.grid.baseZoneBounds();
    if (CONFIG.SHOW_DRAW_ZONE !== false && CONFIG.VFX_DRAW_ZONE_TINT !== false) {
      // Subtle background tint for the drawable region.
      ctx.fillStyle = colors.DRAW_ZONE_TINT || 'rgba(0,255,136,0.04)';
      ctx.fillRect(0, midY, this.canvas.width, rearY - midY);
      // Rear dead zone tint (red-ish "no man's land").
      if (rearY < playfieldBottom) {
        ctx.fillStyle = 'rgba(255, 80, 80, 0.06)';
        ctx.fillRect(0, rearY, this.canvas.width, playfieldBottom - rearY);
      }
      // Base zone tint (subtle amber).
      if (bz) {
        const bzY = zoneRowToY(bz.minY);
        const bzH = zoneRowToY(bz.maxY + 1) - bzY;
        ctx.fillStyle = 'rgba(255, 180, 60, 0.05)';
        ctx.fillRect(0, bzY, this.canvas.width, bzH);
      }
      // Pulsing boundary line.
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 400);
      ctx.save();
      ctx.strokeStyle = colors.DRAW_ZONE_BOUNDARY || 'rgba(0,255,200,0.35)';
      ctx.globalAlpha = pulse;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(0, midY + 0.5);
      ctx.lineTo(this.canvas.width, midY + 0.5);
      ctx.stroke();
      // Rear dead zone boundary line (red).
      if (rearY < playfieldBottom) {
        ctx.strokeStyle = 'rgba(255, 80, 80, 0.5)';
        ctx.beginPath();
        ctx.moveTo(0, rearY + 0.5);
        ctx.lineTo(this.canvas.width, rearY + 0.5);
        ctx.stroke();
      }
      // Base zone boundary lines (amber, no dashes for differentiation).
      if (bz) {
        ctx.strokeStyle = 'rgba(255, 180, 60, 0.4)';
        ctx.setLineDash([4, 4]);
        const bzTop = zoneRowToY(bz.minY);
        const bzBot = zoneRowToY(bz.maxY + 1);
        ctx.beginPath();
        ctx.moveTo(0, bzTop + 0.5);
        ctx.lineTo(this.canvas.width, bzTop + 0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, bzBot + 0.5);
        ctx.lineTo(this.canvas.width, bzBot + 0.5);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
      // Small label on the left edge.
      ctx.save();
      ctx.fillStyle = colors.DRAW_ZONE_BOUNDARY || 'rgba(0,255,200,0.6)';
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'left';
      ctx.fillText('▼ DRAW ZONE', 4, midY - 2);
      if (bz) {
        ctx.fillStyle = 'rgba(255, 180, 60, 0.7)';
        ctx.fillText('◆ BASE ZONE', 4, zoneRowToY(bz.minY) - 2);
      }
      if (rearY < playfieldBottom) {
        ctx.fillStyle = 'rgba(255, 100, 100, 0.7)';
        ctx.fillText('▲ REAR DEAD ZONE', 4, rearY - 2);
      }
      ctx.restore();
    } else {
      // Fallback: just the old midline.
      ctx.strokeStyle = colors.MIDLINE;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(this.canvas.width, midY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw cells — dispatch on topology.
    if (topologyId === 'hex') {
      this._renderCellsHex(gridYOffset);
    } else if (topologyId === 'tri') {
      this._renderCellsTri(gridYOffset);
    } else {
      this._renderCellsSquare(gridYOffset);
    }

    // Draw pending cells (translucent, with drying progress shading)
    const pendingDry = this.grid.pendingDry;
    const dryMax = Math.max(1, CONFIG.INK_DRY_TICKS | 0);
    this._renderPendingCells(gridYOffset, pendingDry, dryMax);
    // Draw preview overlay (pattern stamp hover / line drag preview).
    this._renderPreview(gridYOffset);
    // Render particles & shockwaves over cells but under floaters.
    if (CONFIG.VFX_SHOCKWAVES !== false) this._renderShockwaves();
    if (CONFIG.VFX_PARTICLES !== false) this._renderParticles();
    // Update + draw floaters (rising, fading text effects).
    if (CONFIG.VFX_FLOATERS !== false) this._renderFloaters();
    else this._tickFloatersOnly(); // still age them out even if not drawn
    ctx.restore();

    // Draw HUD
    this._renderHUD(hud);
  }

  _renderCellsSquare(gridYOffset) {
    const ctx = this.ctx;
    const cs = CONFIG.CELL_SIZE;
    const colors = CONFIG.COLORS;
    const defenseVariants = colors.DEFENSE_VARIANTS;
    const missileVariants = colors.MISSILE_VARIANTS;
    const cells = this.grid.cells;
    const cellColor = this.grid.cellColor;
    const panOffset = this.grid.panOffset || 0;
    const w = this.grid.width;
    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * this.grid.width + x;
        const t = cells[i];
        if (t === CELL_TYPE.EMPTY) continue;
        const color = this._cellColorFor(t, cellColor[i], defenseVariants, missileVariants, colors);
        // Apply pan: display column = (x - panOffset) mod w
        const displayX = (((x - panOffset) % w) + w) % w;
        if (t === CELL_TYPE.MISSILE && cs >= 4 && CONFIG.VFX_CELL_GLOW !== false) {
          ctx.save();
          ctx.shadowColor = color;
          ctx.shadowBlur = Math.min(8, cs);
          ctx.fillStyle = color;
          ctx.fillRect(displayX * cs, y * cs + gridYOffset, cs, cs);
          ctx.restore();
        } else {
          ctx.fillStyle = color;
          ctx.fillRect(displayX * cs, y * cs + gridYOffset, cs, cs);
        }
      }
    }
  }

  _renderCellsHex(gridYOffset) {
    const ctx = this.ctx;
    const cs = CONFIG.CELL_SIZE;
    const colors = CONFIG.COLORS;
    const defenseVariants = colors.DEFENSE_VARIANTS;
    const missileVariants = colors.MISSILE_VARIANTS;
    const cells = this.grid.cells;
    const cellColor = this.grid.cellColor;
    const topology = getTopology('hex');
    const w = this.grid.width;
    for (let r = 0; r < this.grid.height; r++) {
      for (let q = 0; q < w; q++) {
        const i = r * w + q;
        const t = cells[i];
        if (t === CELL_TYPE.EMPTY) continue;
        const color = this._cellColorFor(t, cellColor[i], defenseVariants, missileVariants, colors);
        const verts = topology.cellPolygon(q, r, cs);
        const useGlow = t === CELL_TYPE.MISSILE && cs >= 4 && CONFIG.VFX_CELL_GLOW !== false;
        if (useGlow) {
          ctx.save();
          ctx.shadowColor = color;
          ctx.shadowBlur = Math.min(8, cs);
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(verts[0][0], verts[0][1] + gridYOffset);
        for (let v = 1; v < verts.length; v++) {
          ctx.lineTo(verts[v][0], verts[v][1] + gridYOffset);
        }
        ctx.closePath();
        ctx.fill();
        if (useGlow) ctx.restore();
      }
    }
  }

  _renderCellsTri(gridYOffset) {
    const ctx = this.ctx;
    const cs = CONFIG.CELL_SIZE;
    const colors = CONFIG.COLORS;
    const defenseVariants = colors.DEFENSE_VARIANTS;
    const missileVariants = colors.MISSILE_VARIANTS;
    const cells = this.grid.cells;
    const cellColor = this.grid.cellColor;
    const topology = getTopology('tri');
    const w = this.grid.width;
    const stride = 2 * w;
    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < w; x++) {
        for (let o = 0; o < 2; o++) {
          const i = y * stride + 2 * x + o;
          const t = cells[i];
          if (t === CELL_TYPE.EMPTY) continue;
          const color = this._cellColorFor(
            t,
            cellColor[i],
            defenseVariants,
            missileVariants,
            colors
          );
          const verts = topology.cellPolygon(x, y, cs, o);
          const useGlow = t === CELL_TYPE.MISSILE && cs >= 4 && CONFIG.VFX_CELL_GLOW !== false;
          if (useGlow) {
            ctx.save();
            ctx.shadowColor = color;
            ctx.shadowBlur = Math.min(8, cs);
          }
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(verts[0][0], verts[0][1] + gridYOffset);
          for (let v = 1; v < verts.length; v++) {
            ctx.lineTo(verts[v][0], verts[v][1] + gridYOffset);
          }
          ctx.closePath();
          ctx.fill();
          if (useGlow) ctx.restore();
        }
      }
    }
  }

  _cellColorFor(t, colorIdx, defenseVariants, missileVariants, colors) {
    switch (t) {
      case CELL_TYPE.DEFENSE:
        return defenseVariants[colorIdx % defenseVariants.length];
      case CELL_TYPE.MISSILE:
        return missileVariants[colorIdx % missileVariants.length];
      case CELL_TYPE.CITY:
        return colors.CELL_CITY;
      case CELL_TYPE.EXPLOSION:
        return colors.CELL_EXPLOSION;
      default:
        return '#ffffff';
    }
  }

  _renderPendingCells(gridYOffset, pendingDry, dryMax) {
    const ctx = this.ctx;
    const cs = CONFIG.CELL_SIZE;
    const topologyId = this.grid.topologyId || 'square';
    const w = this.grid.width;
    const pending = this.grid.pending;
    const panOffset = this.grid.panOffset || 0;
    const computeAlpha = (i) => {
      const dryRemain = pendingDry[i];
      if (dryRemain === 0) return 0.35;
      const progress = 1 - dryRemain / dryMax;
      return 0.35 + progress * 0.45;
    };
    if (topologyId === 'square') {
      for (let y = 0; y < this.grid.height; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (pending[i]) {
            ctx.fillStyle = `rgba(0, 255, 136, ${computeAlpha(i)})`;
            const displayX = (((x - panOffset) % w) + w) % w;
            ctx.fillRect(displayX * cs, y * cs + gridYOffset, cs, cs);
          }
        }
      }
      return;
    }
    if (topologyId === 'hex') {
      const topology = getTopology('hex');
      for (let r = 0; r < this.grid.height; r++) {
        for (let q = 0; q < w; q++) {
          const i = r * w + q;
          if (pending[i]) {
            ctx.fillStyle = `rgba(0, 255, 136, ${computeAlpha(i)})`;
            const verts = topology.cellPolygon(q, r, cs);
            ctx.beginPath();
            ctx.moveTo(verts[0][0], verts[0][1] + gridYOffset);
            for (let v = 1; v < verts.length; v++) {
              ctx.lineTo(verts[v][0], verts[v][1] + gridYOffset);
            }
            ctx.closePath();
            ctx.fill();
          }
        }
      }
      return;
    }
    if (topologyId === 'tri') {
      const topology = getTopology('tri');
      const stride = 2 * w;
      for (let y = 0; y < this.grid.height; y++) {
        for (let x = 0; x < w; x++) {
          for (let o = 0; o < 2; o++) {
            const i = y * stride + 2 * x + o;
            if (pending[i]) {
              ctx.fillStyle = `rgba(0, 255, 136, ${computeAlpha(i)})`;
              const verts = topology.cellPolygon(x, y, cs, o);
              ctx.beginPath();
              ctx.moveTo(verts[0][0], verts[0][1] + gridYOffset);
              for (let v = 1; v < verts.length; v++) {
                ctx.lineTo(verts[v][0], verts[v][1] + gridYOffset);
              }
              ctx.closePath();
              ctx.fill();
            }
          }
        }
      }
    }
  }

  _renderPreview(gridYOffset) {
    if (!this.input) return;
    const cells = this.input.getPreviewCells();
    if (!cells || cells.length === 0) return;
    const ctx = this.ctx;
    const cs = CONFIG.CELL_SIZE;
    const dzMinY = this.grid.drawZoneMinY();
    // Pulse the alpha slightly so the preview is visually distinct.
    const pulse = 0.55 + 0.15 * Math.sin(performance.now() / 200);
    for (const c of cells) {
      const x = c.x;
      const y = c.y;
      if (y < 0 || y >= this.grid.height) continue;
      const wx = this.grid.wrapX(x);
      const inDrawZone = y >= dzMinY;
      const i = y * this.grid.width + wx;
      const occupied = this.grid.cells[i] !== CELL_TYPE.EMPTY || this.grid.pending[i] !== 0;
      let color;
      if (!inDrawZone) {
        color = `rgba(255, 80, 80, ${pulse * 0.6})`; // out-of-zone = red
      } else if (occupied) {
        color = `rgba(255, 200, 80, ${pulse * 0.7})`; // blocked = amber
      } else {
        color = `rgba(0, 255, 200, ${pulse})`; // ok = cyan
      }
      ctx.fillStyle = color;
      ctx.fillRect(wx * cs, y * cs + gridYOffset, cs, cs);
      // Outline for clarity.
      ctx.strokeStyle = `rgba(255, 255, 255, ${pulse * 0.4})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(wx * cs + 0.5, y * cs + gridYOffset + 0.5, cs - 1, cs - 1);
    }
  }

  _renderParticles() {
    const ctx = this.ctx;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.ttl--;
      if (p.ttl <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      // Slight air drag.
      p.vx *= 0.97;
      p.vy *= 0.99;
      const t = p.ttl / p.maxTtl;
      const alpha = Math.min(1, t * 1.6);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (p.glow > 0) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = p.glow;
      }
      const s = p.size * (0.5 + t * 0.5);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      ctx.restore();
    }
  }

  _renderShockwaves() {
    const ctx = this.ctx;
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.ttl--;
      if (s.ttl <= 0) {
        this.shockwaves.splice(i, 1);
        continue;
      }
      const t = 1 - s.ttl / s.maxTtl; // 0 -> 1
      s.radius = 2 + t * s.maxRadius;
      const alpha = (1 - t) * 0.9;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  _renderFloaters() {
    const ctx = this.ctx;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.ttl--;
      if (f.ttl <= 0) {
        this.floaters.splice(i, 1);
        continue;
      }
      // (rendering code below)
      const t = f.ttl / f.maxTtl; // 1 -> 0
      const alpha = Math.min(1, t * 1.5);
      const yOff = (1 - t) * 30;
      const scale = f.scale != null ? f.scale : 1.0;
      // Pop-in effect: scale up briefly at birth.
      const popPhase = Math.max(0, Math.min(1, (f.maxTtl - (f.maxTtl - f.ttl)) / f.maxTtl));
      const birthScale = 1 + Math.max(0, 1 - popPhase * 4) * 0.4;
      const fontPx = Math.round(16 * scale * birthScale);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = f.color;
      ctx.font = `bold ${fontPx}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 8 + scale * 6;
      ctx.fillText(f.text, f.x, f.y - yOff);
      ctx.restore();
    }
  }
  // Age out floaters without drawing them (used when VFX_FLOATERS is off).
  _tickFloatersOnly() {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      this.floaters[i].ttl--;
      if (this.floaters[i].ttl <= 0) this.floaters.splice(i, 1);
    }
  }

  _renderHUD(hud) {
    const ctx = this.ctx;
    const colors = CONFIG.COLORS;
    const w = this.canvas.width;

    ctx.fillStyle = '#050514';
    ctx.fillRect(0, 0, w, CONFIG.HUD_HEIGHT);

    ctx.fillStyle = colors.HUD_TEXT;
    ctx.font = '14px "Courier New", monospace';
    ctx.textBaseline = 'middle';

    // Score
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE: ${hud.score}`, 10, CONFIG.HUD_HEIGHT / 2);

    // Wave
    ctx.fillText(`WAVE: ${hud.wave}`, 140, CONFIG.HUD_HEIGHT / 2);

    // Cities
    ctx.fillText(`CITIES: ${hud.citiesAlive}`, 230, CONFIG.HUD_HEIGHT / 2);

    // Ink bar
    const inkBarX = 340;
    const inkBarY = 12;
    const inkBarW = 160;
    const inkBarH = 16;
    ctx.fillStyle = colors.INK_BAR_BG;
    ctx.fillRect(inkBarX, inkBarY, inkBarW, inkBarH);
    ctx.fillStyle = colors.INK_BAR;
    const inkPct = hud.maxInk > 0 ? hud.ink / hud.maxInk : 0;
    ctx.fillRect(inkBarX, inkBarY, inkBarW * inkPct, inkBarH);
    ctx.strokeStyle = colors.HUD_TEXT;
    ctx.strokeRect(inkBarX, inkBarY, inkBarW, inkBarH);
    ctx.fillStyle = colors.HUD_TEXT;
    ctx.textAlign = 'left';
    ctx.fillText('INK', inkBarX - 30, CONFIG.HUD_HEIGHT / 2);
    // Numeric ink readout centered over the bar. Outlined for legibility
    // regardless of how full the colored fill is.
    const UNLIMITED = CONFIG.UNLIMITED_SENTINEL || 999999;
    const isUnlimited = hud.maxInk >= UNLIMITED;
    const inkInt = Math.floor(hud.ink);
    const inkLabel = isUnlimited ? `${inkInt} / ∞` : `${inkInt} / ${Math.floor(hud.maxInk)}`;
    ctx.save();
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 24, 0.85)';
    ctx.strokeText(inkLabel, inkBarX + inkBarW / 2, inkBarY + inkBarH / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(inkLabel, inkBarX + inkBarW / 2, inkBarY + inkBarH / 2);
    ctx.restore();
    ctx.save();
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Outline for legibility regardless of bar color.
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 24, 0.85)';
    ctx.strokeText(inkLabel, inkBarX + inkBarW / 2, inkBarY + inkBarH / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(inkLabel, inkBarX + inkBarW / 2, inkBarY + inkBarH / 2);
    ctx.restore();
    ctx.save();
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Outline for legibility regardless of bar color.
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 24, 0.85)';
    ctx.strokeText(inkLabel, inkBarX + inkBarW / 2, inkBarY + inkBarH / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(inkLabel, inkBarX + inkBarW / 2, inkBarY + inkBarH / 2);
    ctx.restore();

    // Speed indicator
    const speed = CONFIG.SPEED_MULTIPLIER;
    let speedLabel;
    if (speed === 0) speedLabel = 'PAUSED';
    else if (speed >= 8) speedLabel = `HYPER ${speed}x`;
    else speedLabel = `${speed}x`;
    ctx.textAlign = 'left';
    ctx.fillStyle = speed === 0 ? '#ffaa00' : speed > 1 ? '#ff60ff' : colors.HUD_TEXT;
    ctx.fillText(`SPD: ${speedLabel}`, inkBarX + inkBarW + 20, CONFIG.HUD_HEIGHT / 2);

    // High score
    ctx.textAlign = 'right';
    ctx.fillStyle = colors.HUD_TEXT;
    ctx.fillText(`HI: ${hud.highScore}`, w - 10, CONFIG.HUD_HEIGHT / 2);
  }
}
