/**
 * Parsers for common Life pattern file formats.
 *
 * Supports:
 *   - RLE (.rle)   - Run-length encoded format used by LifeWiki/Golly
 *   - Cells (.cells) - Plaintext format using '.' for dead and 'O' for live
 *
 * Each parser returns:
 *   {
 *     cells: [[x, y], ...],
 *     meta: {
 *       name?: string,
 *       author?: string,
 *       comments: string[],
 *       rule?: string,         // e.g. "B3/S23"
 *       width?: number,
 *       height?: number,
 *     }
 *   }
 */

/**
 * Parse a Life 1.05/1.06-style plaintext .cells file.
 *
 * Format:
 *   - Lines starting with '!' are comments. The first '!Name:' line
 *     (if present) gives the pattern name; '!Author:' the author.
 *   - Other lines are the grid: 'O' (capital O) or '*' = live, '.' = dead.
 *
 * @param {string} text
 * @returns {{cells: [number, number][], meta: object}}
 */
export function parseCells(text) {
  const lines = text.split(/\r?\n/);
  const meta = { comments: [] };
  const gridRows = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.startsWith('!')) {
      const body = line.slice(1).trim();
      if (/^name\s*:/i.test(body)) {
        meta.name = body.replace(/^name\s*:\s*/i, '').trim();
      } else if (/^author\s*:/i.test(body)) {
        meta.author = body.replace(/^author\s*:\s*/i, '').trim();
      } else {
        meta.comments.push(body);
      }
      continue;
    }
    if (line.length === 0 && gridRows.length === 0) continue;
    gridRows.push(line);
  }
  // Trim trailing empty rows.
  while (gridRows.length > 0 && /^\s*$/.test(gridRows[gridRows.length - 1])) {
    gridRows.pop();
  }
  const cells = [];
  let maxLen = 0;
  for (let y = 0; y < gridRows.length; y++) {
    const row = gridRows[y];
    if (row.length > maxLen) maxLen = row.length;
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === 'O' || ch === '*' || ch === 'o') {
        cells.push([x, y]);
      }
    }
  }
  meta.width = maxLen;
  meta.height = gridRows.length;
  return { cells, meta };
}

/**
 * Parse an RLE (Run-Length Encoded) Life pattern file.
 *
 * Format:
 *   - '#' lines are metadata (#N name, #O author/origin, #C comment, #r rule, ...)
 *   - A header line: x = W, y = H[, rule = B3/S23]
 *   - The body uses tags: 'b' = dead, 'o' = live, '$' = end of row, '!' = end of pattern.
 *     Numbers prefix the next tag for run lengths.
 *
 * @param {string} text
 * @returns {{cells: [number, number][], meta: object}}
 */
export function parseRLE(text) {
  const meta = { comments: [] };
  const lines = text.split(/\r?\n/);
  let bodyStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#')) {
      const tag = line[1];
      const body = line.slice(2).trim();
      switch (tag) {
        case 'N':
          meta.name = body;
          break;
        case 'O':
          meta.author = body;
          break;
        case 'C':
        case 'c':
          meta.comments.push(body);
          break;
        case 'r':
        case 'R':
          meta.rule = body;
          break;
        case 'P':
        case 'p':
          meta.position = body;
          break;
        default:
          meta.comments.push(line.slice(1).trim());
      }
      continue;
    }
    if (/^\s*x\s*=/i.test(line)) {
      const m = line.match(/x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)(?:\s*,\s*rule\s*=\s*([^,\s]+))?/i);
      if (m) {
        meta.width = parseInt(m[1], 10);
        meta.height = parseInt(m[2], 10);
        if (m[3]) meta.rule = m[3];
      }
      bodyStart = i + 1;
      break;
    }
  }
  if (bodyStart < 0) {
    // No header — treat the whole thing as body.
    bodyStart = 0;
  }
  const body = lines.slice(bodyStart).join('').replace(/\s+/g, '');
  const cells = [];
  let x = 0;
  let y = 0;
  let runLen = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch >= '0' && ch <= '9') {
      runLen = runLen * 10 + (ch.charCodeAt(0) - 48);
      continue;
    }
    const n = runLen === 0 ? 1 : runLen;
    runLen = 0;
    if (ch === 'b') {
      x += n;
    } else if (ch === 'o') {
      for (let k = 0; k < n; k++) cells.push([x + k, y]);
      x += n;
    } else if (ch === '$') {
      y += n;
      x = 0;
    } else if (ch === '!') {
      break;
    } else {
      // Unknown character — be lenient.
    }
  }
  return { cells, meta };
}

/**
 * Dispatch parser based on file extension or content sniffing.
 * @param {string} filename
 * @param {string} text
 * @returns {{cells: [number, number][], meta: object} | null}
 */
export function parsePatternFile(filename, text) {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.rle')) return parseRLE(text);
  if (lower.endsWith('.cells')) return parseCells(text);
  // Sniff: presence of '!' header alone is ambiguous; RLE always has 'x = N, y = N'.
  if (/^\s*x\s*=\s*\d+\s*,\s*y\s*=\s*\d+/im.test(text)) return parseRLE(text);
  if (/^!/m.test(text)) return parseCells(text);
  return null;
}
