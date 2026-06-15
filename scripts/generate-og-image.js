#!/usr/bin/env node
  /* ─────────────────────────────────────────────────────────────
       Generate og-image.png (1200x630) for social sharing.
       Uses the `canvas` dependency already in package.json.
       Usage: node scripts/generate-og-image.js
       ───────────────────────────────────────────────────────────── */

  import { createCanvas } from 'canvas';
  import { promises as fs } from 'fs';
  import path from 'path';
  import { fileURLToPath } from 'url';

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const ROOT = path.resolve(__dirname, '..');

  const W = 1200;
  const H = 630;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Dark gradient background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0a0a14');
  bg.addColorStop(0.5, '#10101f');
  bg.addColorStop(1, '#0a0a14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Aurora-ish blobs
  function blob(x, y, r, color) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  blob(220, 160, 360, 'rgba(70,120,255,0.35)');
  blob(980, 500, 420, 'rgba(150,80,255,0.30)');

  // ── Render a few evolving gliders on the right side as a CA motif ──
  const CELL = 26;
  const GAP = 4;
  const ORIGIN_X = 760;
  const ORIGIN_Y = 120;

  // A glider, plus a couple of offset copies, drawn as glowing cells.
  const glider = [
    [0, 1],
    [1, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ];

  function drawCells(cells, offX, offY, color, glow) {
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 18;
    ctx.fillStyle = color;
    for (const [r, c] of cells) {
      const x = ORIGIN_X + (offX + c) * (CELL + GAP);
      const y = ORIGIN_Y + (offY + r) * (CELL + GAP);
      ctx.fillRect(x, y, CELL, CELL);
    }
    ctx.restore();
  }

  drawCells(glider, 0, 0, '#9db4ff', 'rgba(120,150,255,0.9)');
  drawCells(glider, 4, 3, '#6cf0c0', 'rgba(80,240,180,0.9)');
  drawCells(glider, 8, 6, '#ff8a6c', 'rgba(255,120,90,0.9)');

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.font = 'bold 84px sans-serif';
  ctx.fillText('The Arcade', 90, 250);
  ctx.fillStyle = '#9db4ff';
  ctx.fillText('of Life', 90, 350);

  // Subtitle
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = '32px sans-serif';
  ctx.fillText("Conway's Game of Life arcade · runs in the browser", 92, 430);

  const out = path.join(ROOT, 'og-image.png');
  const buf = canvas.toBuffer('image/png');
  await fs.writeFile(out, buf);
  console.log(`✓ og-image.png written (${W}x${H})`);