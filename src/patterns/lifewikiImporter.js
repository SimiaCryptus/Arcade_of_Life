#!/usr/bin/env node
/**
 * LifeWiki dataset importer.
 *
 * Reads .rle and .cells files from a directory tree, parses them,
 * infers missing metadata via simulation, and emits a JSON pattern
 * library that can be loaded by src/patterns/library.js at runtime.
 *
 * Usage (from project root):
 *
 *   node src/patterns/lifewikiImporter.js [options]
 *
 * Options:
 *   --input  <dir>     Source directory (default: /home/andrew/Downloads/all)
 *   --output <file>    Output JSON file (default: src/patterns/lifewiki.generated.json)
 *   --limit  <N>       Stop after importing N files (debug aid)
 *   --max-period <N>   Max period to search during inference (default: 60)
 *   --methuselah-gens <N>
 *                      Generations to observe for methuselah detection (default: 200)
 *   --max-cells <N>    Skip patterns with more than N live cells (default: 5000)
 *   --max-dim <N>      Skip patterns with bounding-box width or height > N (default: 400)
 *   --verbose          Log per-file progress
 *   --dry-run          Parse + infer but do not write output file
 *
 * The generated JSON has the form:
 *   {
 *     "generatedAt": "...",
 *     "source": "...",
 *     "count": N,
 *     "patterns": [
 *       {
 *         "id": "...",
 *         "name": "...",
 *         "category": "oscillator",
 *         "cells": [[x, y], ...],
 *         "period": 2,
 *         "rulesets": ["conway"],
 *         "description": "...",
 *         "tags": ["imported", "lifewiki"],
 *         "direction": null,
 *         "source": "lifewiki:<filename>"
 *       },
 *       ...
 *     ]
 *   }
 */

import fs from 'node:fs';
import path from 'node:path';
import { parsePatternFile } from './parsers.js';
import { inferPatternMetadata } from './inferMetadata.js';
import { normalizeCells } from './library.js';
import { CATEGORY } from './categories.js';

const DEFAULT_INPUT = '/home/andrew/Downloads/all';
const DEFAULT_OUTPUT = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  'lifewiki.generated.json'
);

/**
 * Parse CLI arguments into an options object.
 */
export function parseArgs(argv) {
  const opts = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    limit: Infinity,
    maxPeriod: 60,
    methuselahGens: 200,
    maxCells: 5000,
    maxDim: 400,
    verbose: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--input':
        opts.input = argv[++i];
        break;
      case '--output':
        opts.output = argv[++i];
        break;
      case '--limit':
        opts.limit = parseInt(argv[++i], 10);
        break;
      case '--max-period':
        opts.maxPeriod = parseInt(argv[++i], 10);
        break;
      case '--methuselah-gens':
        opts.methuselahGens = parseInt(argv[++i], 10);
        break;
      case '--max-cells':
        opts.maxCells = parseInt(argv[++i], 10);
        break;
      case '--max-dim':
        opts.maxDim = parseInt(argv[++i], 10);
        break;
      case '--verbose':
      case '-v':
        opts.verbose = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${a}`);
        printHelp();
        process.exit(2);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node src/patterns/lifewikiImporter.js [options]

    Options:
      --input <dir>            Source directory (default: ${DEFAULT_INPUT})
      --output <file>          Output JSON file (default: lifewiki.generated.json)
      --limit <N>              Stop after importing N files
      --max-period <N>         Max period to search (default: 60)
      --methuselah-gens <N>    Gens to observe for methuselah (default: 200)
      --max-cells <N>          Skip patterns with > N live cells (default: 5000)
      --max-dim <N>            Skip patterns with bbox > N (default: 400)
      --verbose                Log per-file progress
      --dry-run                Don't write output
      --help                   Show this message
    `);
}

/**
 * Recursively collect candidate files under dir.
 * @param {string} dir
 * @returns {string[]}
 */
export function collectFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (e) {
      console.error(`Cannot read ${cur}: ${e.message}`);
      continue;
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile()) {
        const lower = ent.name.toLowerCase();
        if (lower.endsWith('.rle') || lower.endsWith('.cells')) {
          out.push(full);
        }
      }
    }
  }
  out.sort();
  return out;
}

/**
 * Generate a stable, slug-like id from a filename.
 * @param {string} filename
 * @returns {string}
 */
export function slugify(filename) {
  const base = path.basename(filename).replace(/\.(rle|cells)$/i, '');
  const slug = base
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  return slug || 'pattern';
}

/**
 * Convert a parsed pattern + inferred metadata to a registry-ready object.
 * @param {string} filename       absolute path
 * @param {object} parsed         { cells, meta }
 * @param {object} inferred       result from inferPatternMetadata()
 * @param {Set<string>} usedIds   for de-duplication
 * @returns {object}
 */
export function buildPatternEntry(filename, parsed, inferred, usedIds) {
  const baseName = path.basename(filename).replace(/\.(rle|cells)$/i, '');
  let id = slugify(filename);
  // Disambiguate id collisions.
  if (usedIds.has(id)) {
    let n = 2;
    while (usedIds.has(`${id}_${n}`)) n++;
    id = `${id}_${n}`;
  }
  usedIds.add(id);
  const { cells, meta } = parsed;
  const { cells: normCells } = normalizeCells(cells);
  const tags = ['imported', 'lifewiki'];
  if (inferred.category === CATEGORY.SPACESHIP) tags.push('spaceship');
  if (inferred.category === CATEGORY.OSCILLATOR) tags.push(`p${inferred.period}`);
  if (meta.author) tags.push(`author:${meta.author.toLowerCase().replace(/\s+/g, '_')}`);
  const description = (meta.comments || []).filter(Boolean).join(' ').slice(0, 400);
  return {
    id,
    name: meta.name || baseName,
    category: inferred.category,
    cells: normCells,
    period: inferred.period,
    rulesets: [inferred.rulesetId],
    description,
    tags,
    direction: inferred.direction || null,
    source: `lifewiki:${path.basename(filename)}`,
  };
}

/**
 * Run the importer.
 * @param {object} opts
 */
export async function runImport(opts) {
  const t0 = Date.now();
  console.log(`Scanning ${opts.input} ...`);
  const files = collectFiles(opts.input);
  console.log(`Found ${files.length} candidate files`);
  const usedIds = new Set();
  const patterns = [];
  const stats = {
    scanned: 0,
    imported: 0,
    skippedTooLarge: 0,
    skippedEmpty: 0,
    skippedParseFail: 0,
    byCategory: {},
  };
  const limit = Math.min(files.length, opts.limit);
  for (let i = 0; i < limit; i++) {
    const file = files[i];
    stats.scanned++;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (opts.verbose) console.warn(`  read fail ${file}: ${e.message}`);
      stats.skippedParseFail++;
      continue;
    }
    let parsed;
    try {
      parsed = parsePatternFile(file, text);
    } catch (e) {
      if (opts.verbose) console.warn(`  parse fail ${file}: ${e.message}`);
      stats.skippedParseFail++;
      continue;
    }
    if (!parsed || !parsed.cells || parsed.cells.length === 0) {
      stats.skippedEmpty++;
      if (opts.verbose) console.warn(`  empty ${file}`);
      continue;
    }
    if (parsed.cells.length > opts.maxCells) {
      stats.skippedTooLarge++;
      if (opts.verbose) console.warn(`  too large (${parsed.cells.length} cells) ${file}`);
      continue;
    }
    const { width, height } = normalizeCells(parsed.cells);
    if (width > opts.maxDim || height > opts.maxDim) {
      stats.skippedTooLarge++;
      if (opts.verbose) console.warn(`  too wide (${width}x${height}) ${file}`);
      continue;
    }
    let inferred;
    try {
      inferred = inferPatternMetadata(parsed.cells, {
        rule: parsed.meta.rule,
        maxPeriod: opts.maxPeriod,
        methuselahGens: opts.methuselahGens,
      });
    } catch (e) {
      if (opts.verbose) console.warn(`  infer fail ${file}: ${e.message}`);
      stats.skippedParseFail++;
      continue;
    }
    const entry = buildPatternEntry(file, parsed, inferred, usedIds);
    patterns.push(entry);
    stats.imported++;
    stats.byCategory[entry.category] = (stats.byCategory[entry.category] || 0) + 1;
    if (opts.verbose) {
      console.log(
        `  [${stats.imported}/${limit}] ${entry.id} → ${entry.category}` +
          (entry.period ? ` p${entry.period}` : '') +
          (entry.direction ? ` ${entry.direction}` : '')
      );
    } else if (stats.imported % 50 === 0) {
      process.stdout.write(`\r  imported ${stats.imported} / scanned ${stats.scanned}`);
    }
  }
  if (!opts.verbose) process.stdout.write('\n');
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `Done in ${elapsed}s — imported ${stats.imported}, ` +
      `skipped ${stats.skippedTooLarge + stats.skippedEmpty + stats.skippedParseFail} ` +
      `(${stats.skippedTooLarge} large, ${stats.skippedEmpty} empty, ${stats.skippedParseFail} parse).`
  );
  console.log('By category:');
  for (const [cat, n] of Object.entries(stats.byCategory)) {
    console.log(`  ${cat}: ${n}`);
  }
  if (!opts.dryRun) {
    const outDoc = {
      generatedAt: new Date().toISOString(),
      source: opts.input,
      count: patterns.length,
      patterns,
    };
    fs.mkdirSync(path.dirname(opts.output), { recursive: true });
    fs.writeFileSync(opts.output, JSON.stringify(outDoc, null, 2));
    console.log(`Wrote ${patterns.length} patterns to ${opts.output}`);
  } else {
    console.log('(dry-run; no output file written)');
  }
  return { patterns, stats };
}

/**
 * Load a generated JSON file produced by this importer and register
 * its patterns into the live library at runtime. Returns the number
 * of patterns registered.
 * @param {string} jsonPath
 * @returns {Promise<number>}
 */
export async function loadGeneratedLibrary(jsonPath) {
  const { registerPattern } = await import('./library.js');
  const text = fs.readFileSync(jsonPath, 'utf8');
  const doc = JSON.parse(text);
  let n = 0;
  for (const p of doc.patterns || []) {
    try {
      registerPattern(p);
      n++;
    } catch (e) {
      console.warn(`Skipped ${p.id}: ${e.message}`);
    }
  }
  return n;
}

// ─── CLI entry point ────────────────────────────────────────────────
const isMain = (() => {
  try {
    const thisFile = new URL(import.meta.url).pathname;
    const arg = process.argv[1] ? path.resolve(process.argv[1]) : '';
    return arg === thisFile;
  } catch {
    return false;
  }
})();

if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  runImport(opts).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
