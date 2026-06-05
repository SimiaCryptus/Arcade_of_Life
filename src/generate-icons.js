/**
 * Icon generator — run once with Node.js + canvas package to produce
 * the PWA icon set from a programmatic design.
 *
 * Usage:  node src/generate-icons.js
 * Requires: npm install canvas  (only needed at build time)
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const OUT_DIR = path.join(__dirname, '..', 'icons');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function drawIcon(size) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const s = size;

    // Background.
    ctx.fillStyle = '#000010';
    ctx.fillRect(0, 0, s, s);

    // Outer glow ring.
    const grad = ctx.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s * 0.5);
    grad.addColorStop(0, 'rgba(0,255,255,0.15)');
    grad.addColorStop(1, 'rgba(0,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    // Grid dots (Game of Life motif).
    const cols = 8, rows = 8;
    const cellW = s / cols, cellH = s / rows;
    // A glider pattern in the center.
    const glider = [
        [3, 2], [4, 3], [2, 4], [3, 4], [4, 4],
    ];
    ctx.fillStyle = '#00ffff';
    for (const [gx, gy] of glider) {
        const cx = (gx + 0.5) * cellW;
        const cy = (gy + 0.5) * cellH;
        const r = Math.max(1.5, cellW * 0.28);
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = r * 3;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.shadowBlur = 0;

    // City silhouette at the bottom.
    const cityY = s * 0.72;
    const cityH = s * 0.18;
    ctx.fillStyle = '#4040a0';
    // Three buildings.
    const buildings = [
        { x: 0.12, w: 0.18, h: 0.9 },
        { x: 0.38, w: 0.24, h: 1.0 },
        { x: 0.68, w: 0.20, h: 0.75 },
    ];
    for (const b of buildings) {
        ctx.fillRect(b.x * s, cityY + cityH * (1 - b.h), b.w * s, cityH * b.h);
    }

    // Missile (enemy glider) coming down — red.
    ctx.fillStyle = '#ff3333';
    ctx.shadowColor = '#ff3333';
    ctx.shadowBlur = Math.max(2, s * 0.02);
    const missileGlider = [[4, 1], [5, 2], [3, 3], [4, 3], [5, 3]];
    for (const [gx, gy] of missileGlider) {
        const cx = (gx + 0.5) * cellW;
        const cy = (gy + 0.5) * cellH;
        const r = Math.max(1.5, cellW * 0.22);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Border.
    ctx.strokeStyle = '#2a2a5a';
    ctx.lineWidth = Math.max(1, s * 0.015);
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2,
        s - ctx.lineWidth, s - ctx.lineWidth);

    return canvas;
}

for (const size of SIZES) {
    const canvas = drawIcon(size);
    const outPath = path.join(OUT_DIR, `icon-${size}.png`);
    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(outPath, buf);
    console.log(`Generated ${outPath}`);
}

console.log('Done! Icons written to /icons/');