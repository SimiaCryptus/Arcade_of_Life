/**
 * Icon generator — run once with Node.js + canvas package to produce
* the PWA icon set from a source icon image.
 *
 * Usage:  node generate-icons.js
* Requires: npm install canvas  (only needed at build time)
* Source: ../icon.png
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const { Image } = require('canvas');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const ICO_SIZES = [16, 32, 48];
const APPLE_SIZES = [120, 152, 167, 180];
const OUT_DIR = path.join(__dirname, '..', 'icons');
const ICON_SRC = path.join(__dirname, '..', 'icon.png');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function drawIcon(size, sourceImage) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');






  // Draw the source image scaled to the target size
  ctx.drawImage(sourceImage, 0, 0, size, size);


  return canvas;
}
/**
* Create a multi-resolution ICO file from multiple canvas objects
* @param {Array} canvases - Array of canvas objects in order: 16x16, 32x32, 48x48
* @returns {Buffer} ICO file buffer
*/
function createICO(canvases) {
  // ICO file structure:
  // Header (6 bytes) + Directory entries (16 bytes each) + Image data
  const numImages = canvases.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = headerSize + numImages * dirEntrySize;
  // Convert canvases to BMP data
  const imageDataArray = canvases.map((canvas, idx) => {
    const size = ICO_SIZES[idx];
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, size, size);
    return { size, data: imageData };
  });
  // Calculate offsets and total size
  let offset = dirSize;
  const dirEntries = [];
  const imageBuffers = [];
  imageDataArray.forEach(({ size, data }) => {
    const bmpBuffer = createBMP(size, data);
    imageBuffers.push(bmpBuffer);
    dirEntries.push({ offset, size: bmpBuffer.length, width: size, height: size });
    offset += bmpBuffer.length;
  });
  // Create ICO header
  const icoBuffer = Buffer.alloc(offset);
  let pos = 0;
  // ICO header
  icoBuffer.writeUInt16LE(0, pos); // Reserved
  pos += 2;
  icoBuffer.writeUInt16LE(1, pos); // Type (1 = ICO)
  pos += 2;
  icoBuffer.writeUInt16LE(numImages, pos); // Number of images
  pos += 2;
  // Directory entries
  dirEntries.forEach((entry) => {
    icoBuffer.writeUInt8(entry.width, pos++); // Width
    icoBuffer.writeUInt8(entry.height, pos++); // Height
    icoBuffer.writeUInt8(0, pos++); // Color palette (0 = no palette)
    icoBuffer.writeUInt8(0, pos++); // Reserved
    icoBuffer.writeUInt16LE(1, pos); // Color planes
    pos += 2;
    icoBuffer.writeUInt16LE(32, pos); // Bits per pixel
    pos += 2;
    icoBuffer.writeUInt32LE(entry.size, pos); // Image size
    pos += 4;
    icoBuffer.writeUInt32LE(entry.offset, pos); // Image offset
    pos += 4;
  });
  // Copy image data
  imageBuffers.forEach((buf) => {
    buf.copy(icoBuffer, pos);
    pos += buf.length;
  });
  return icoBuffer;
}
/**
* Create a BMP buffer from canvas image data
* @param {number} size - Canvas size (square)
* @param {ImageData} imageData - Canvas image data
* @returns {Buffer} BMP file buffer
*/
function createBMP(size, imageData) {
  const width = size;
  const height = size;
  const pixelDataSize = width * height * 4;
  const bmpHeaderSize = 40;
  const totalSize = bmpHeaderSize + pixelDataSize;
  const buffer = Buffer.alloc(totalSize);
  let pos = 0;
  // BMP Info Header
  buffer.writeUInt32LE(bmpHeaderSize, pos); // Header size
  pos += 4;
  buffer.writeInt32LE(width, pos); // Width
  pos += 4;
  buffer.writeInt32LE(height * 2, pos); // Height (doubled for ICO format)
  pos += 4;
  buffer.writeUInt16LE(1, pos); // Planes
  pos += 2;
  buffer.writeUInt16LE(32, pos); // Bits per pixel
  pos += 2;
  buffer.writeUInt32LE(0, pos); // Compression (0 = none)
  pos += 4;
  buffer.writeUInt32LE(pixelDataSize, pos); // Image size
  pos += 4;
  buffer.writeInt32LE(0, pos); // X pixels per meter
  pos += 4;
  buffer.writeInt32LE(0, pos); // Y pixels per meter
  pos += 4;
  buffer.writeUInt32LE(0, pos); // Colors used
  pos += 4;
  buffer.writeUInt32LE(0, pos); // Important colors
  pos += 4;
  // Pixel data (BGRA format, bottom-up)
  const data = imageData.data;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      buffer[pos++] = data[idx + 2]; // B
      buffer[pos++] = data[idx + 1]; // G
      buffer[pos++] = data[idx]; // R
      buffer[pos++] = data[idx + 3]; // A
    }
  }
  return buffer;
}


// Load the source icon image
const iconBuffer = fs.readFileSync(ICON_SRC);
const sourceImage = new Image();
sourceImage.src = iconBuffer;
// Generate standard PNG icons

for (const size of SIZES) {
  const canvas = drawIcon(size, sourceImage);
  const outPath = path.join(OUT_DIR, `icon-${size}.png`);
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buf);
  console.log(`Generated ${outPath}`);
}
// Generate Apple touch icons
for (const size of APPLE_SIZES) {
  const canvas = drawIcon(size, sourceImage);
  const outPath = path.join(OUT_DIR, `apple-touch-icon-${size}.png`);
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buf);
  console.log(`Generated ${outPath}`);
}
// Generate favicon.ico (multi-resolution)
const icoCanvases = ICO_SIZES.map(size => drawIcon(size, sourceImage));
const icoBuffer = createICO(icoCanvases);
const icoPath = path.join(OUT_DIR, 'favicon.ico');
fs.writeFileSync(icoPath, icoBuffer);
console.log(`Generated ${icoPath}`);
// Generate favicon.png (32x32 as fallback)
const faviconCanvas = drawIcon(32, sourceImage);
const faviconPath = path.join(OUT_DIR, 'favicon.png');
const faviconBuf = faviconCanvas.toBuffer('image/png');
fs.writeFileSync(faviconPath, faviconBuf);
console.log(`Generated ${faviconPath}`);


console.log('Done! Icons written to /icons/');