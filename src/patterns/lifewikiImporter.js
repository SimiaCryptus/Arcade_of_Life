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
import {
  inferPatternMetadata,
  RULE_RESOLUTION_STATS,
  resetRuleResolutionStats,
} from './inferMetadata.js';
import { normalizeCells } from './library.js';
import { CATEGORY } from './categories.js';
import { listRulesets, formatBSNotation } from '../rules/ruleset.js';
// Side-effect import to ensure extra rulesets (HighLife, Day & Night,
// Move, DryLife, etc.) are registered before we try to resolve rules.
import '../rules/index.js';

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
 * Format preference for dedup: lower number = preferred.
 * RLE is preferred because it carries richer metadata (name, author, rule, comments).
 */
const FORMAT_PRIORITY = {
  '.rle': 0,
  '.cells': 1,
};
/**
 * Compute a normalization key for a file path used to detect duplicates
 * that differ only by extension and/or case.
 * @param {string} filename
 * @returns {string}
 */
export function dedupKey(filename) {
  const base = path.basename(filename).replace(/\.(rle|cells)$/i, '');
  return base
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}
/**
 * Given a list of files, drop those whose normalized basenames collide,
 * keeping the one with the best (lowest) format priority. Ties broken
 * by lexicographic path order for determinism.
 * @param {string[]} files
 * @param {{verbose?: boolean}} [opts]
 * @returns {{kept: string[], droppedCount: number}}
 */
export function dedupFilesByBaseName(files, opts = {}) {
  const best = new Map(); // key → file path
  let droppedCount = 0;
  for (const f of files) {
    const key = dedupKey(f);
    if (!key) continue;
    const ext = path.extname(f).toLowerCase();
    const prio = FORMAT_PRIORITY[ext] ?? 99;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, { file: f, prio });
    } else {
      droppedCount++;
      if (prio < prev.prio || (prio === prev.prio && f < prev.file)) {
        if (opts.verbose) console.warn(`  dedup: prefer ${f} over ${prev.file}`);
        best.set(key, { file: f, prio });
      } else if (opts.verbose) {
        console.warn(`  dedup: skip ${f} (kept ${prev.file})`);
      }
    }
  }
  const kept = Array.from(best.values())
    .map((v) => v.file)
    .sort();
  return { kept, droppedCount };
}
/**
 * Compute a canonical fingerprint for a set of live cells so that
 * patterns differing only in translation produce the same hash.
 * @param {Array<[number,number]>} cells
 * @returns {string}
 */
export function cellsFingerprint(cells) {
  if (!cells || cells.length === 0) return 'empty';
  const { cells: norm } = normalizeCells(cells);
  const sorted = norm.map(([x, y]) => `${x},${y}`).sort();
  return `${sorted.length}:${sorted.join(';')}`;
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
  if (inferred.unbounded) tags.push('unbounded');
  if (inferred.extinct) tags.push('extinct');
  if (meta.author) tags.push(`author:${meta.author.toLowerCase().replace(/\s+/g, '_')}`);
  // Separate URLs from prose in the comments. LifeWiki RLE files
  // typically include a wiki link as one of the #C lines (often
  // bare, like "www.conwaylife.com/wiki/..." or "https://...").
  const rawComments = (meta.comments || []).filter(Boolean);
  const urlRegex = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/i;
  const links = [];
  const proseParts = [];
  for (const c of rawComments) {
    const m = c.match(urlRegex);
    if (m) {
      let url = m[1];
      // Normalize bare "www." URLs to https://.
      if (/^www\./i.test(url)) url = 'https://' + url;
      // Strip trailing punctuation that's likely not part of the URL.
      url = url.replace(/[.,;:)\]}>]+$/g, '');
      if (!links.includes(url)) links.push(url);
      // Remove the URL from the prose portion of this comment.
      const remainder = c.replace(urlRegex, '').trim();
      if (remainder) proseParts.push(remainder);
    } else {
      proseParts.push(c);
    }
  }
  const description = proseParts.join(' ').trim().slice(0, 600);
  // Prefer the first link as the primary wiki link; expose all in tags.
  const link = links.length > 0 ? links[0] : null;
  const extraLinks = links.length > 1 ? links.slice(1) : [];
  return {
    id,
    name: meta.name || baseName,
    category: inferred.category,
    cells: normCells,
    period: inferred.period,
    rulesets: [inferred.rulesetId],
    description,
    link,
    extraLinks,
    author: meta.author || null,
    tags,
    direction: inferred.direction || null,
    source: `lifewiki:${path.basename(filename)}`,
    maxBounds: inferred.maxBounds || null,
    maxPopulation: inferred.maxPopulation,
    finalPopulation: inferred.finalPopulation,
    stabilizedAt: inferred.stabilizedAt,
    extinct: !!inferred.extinct,
    unbounded: !!inferred.unbounded,
  };
}

/**
 * Pretty-print a multi-section summary of import statistics.
 * @param {object} stats
 * @param {string|number} elapsed seconds (already formatted)
 */
export function printSummaryReport(stats, elapsed) {
  const totalSkipped =
    stats.skippedTooLarge + stats.skippedEmpty + stats.skippedParseFail + stats.skippedDuplicate;
  const totalConsidered = stats.imported + totalSkipped;
  const pct = (n, d) => (d > 0 ? ((n / d) * 100).toFixed(1) + '%' : '—');

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Import summary  (elapsed: ${elapsed}s)`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Scanned:   ${stats.scanned}`);
  console.log(`  Imported:  ${stats.imported}  (${pct(stats.imported, totalConsidered)})`);
  console.log(`  Skipped:   ${totalSkipped}`);
  console.log(`    • too large : ${stats.skippedTooLarge}`);
  console.log(`    • empty     : ${stats.skippedEmpty}`);
  console.log(`    • parse fail: ${stats.skippedParseFail}`);
  console.log(`    • duplicate : ${stats.skippedDuplicate}`);
  console.log('');
  console.log('  Characterization:');
  console.log(`    • unbounded   : ${stats.unboundedCount || 0}`);
  console.log(`    • extinct     : ${stats.extinctCount || 0}`);
  console.log(`    • stabilized  : ${stats.stabilizedCount || 0}`);
  console.log('');
  console.log('  Parse breakdown:');
  if (stats.parsesByExt) {
    console.log(`    • .rle    : ${stats.parsesByExt['.rle'] || 0}`);
    console.log(`    • .cells  : ${stats.parsesByExt['.cells'] || 0}`);
    if (stats.parsesByExt.other) console.log(`    • other   : ${stats.parsesByExt.other}`);
  }
  console.log(`  Files with no rule header: ${stats.filesWithNoRule || 0}`);
  console.log(`  Files with topology suffix: ${stats.filesWithTopology || 0}`);

  console.log('');
  console.log('  By category:');
  const catEntries = Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]);
  if (catEntries.length === 0) {
    console.log('    (none)');
  } else {
    const catWidth = Math.max(...catEntries.map(([k]) => k.length));
    for (const [cat, n] of catEntries) {
      console.log(
        `    ${cat.padEnd(catWidth)}  ${String(n).padStart(5)}  (${pct(n, stats.imported)})`
      );
    }
  }

  console.log('');
  console.log('  By ruleset:');
  const ruleEntries = Object.entries(stats.byRuleset || {}).sort((a, b) => b[1] - a[1]);
  if (ruleEntries.length === 0) {
    console.log('    (none)');
  } else {
    const ruleWidth = Math.max(...ruleEntries.map(([k]) => k.length));
    for (const [rs, n] of ruleEntries) {
      console.log(
        `    ${rs.padEnd(ruleWidth)}  ${String(n).padStart(5)}  (${pct(n, stats.imported)})`
      );
    }
  }
  // Rule resolution diagnostics: show exactly how rules were resolved
  // and which raw rule strings appeared. This is invaluable for
  // diagnosing "everything is conway" type problems.
  if (stats.ruleResolution) {
    const rr = stats.ruleResolution;
    console.log('');
    console.log('  Rule resolution path:');
    console.log(`    • matched by id        : ${rr.matchedById}`);
    console.log(`    • matched by B/S       : ${rr.matchedByNotation}`);
    console.log(`    • custom (anon B/S)    : ${rr.customAnonymous}`);
    console.log(`    • unparseable          : ${rr.unparseable}`);
    console.log(`    • missing (defaulted)  : ${rr.missing}`);
    console.log(`    • topology stripped    : ${rr.stripped}`);
    // Top raw rule inputs seen (this is what came out of parsePatternFile).
    const rawEntries = Object.entries(rr.byRawInput).sort((a, b) => b[1] - a[1]);
    if (rawEntries.length > 0) {
      console.log('');
      console.log('  Raw rule strings (as seen by resolveRule), top 30:');
      const top = rawEntries.slice(0, 30);
      const rawWidth = Math.max(...top.map(([k]) => k.length), 10);
      for (const [r, n] of top) {
        console.log(`    ${r.padEnd(rawWidth)}  ${String(n).padStart(5)}`);
      }
      if (rawEntries.length > 30) {
        console.log(`    ... and ${rawEntries.length - 30} more distinct values`);
      }
    }
    if (rr.sampleUnparseable && rr.sampleUnparseable.length > 0) {
      console.log('');
      console.log('  Sample unparseable rule strings:');
      for (const s of rr.sampleUnparseable) {
        console.log(`    • "${s}"`);
      }
    }
  }
  // Raw rule strings as observed by the *parser* (before resolveRule).
  // This will differ from byRawInput if/when the importer pre-processes
  // the rule before resolution.
  const rawHeaderEntries = Object.entries(stats.byRawRuleHeader || {}).sort((a, b) => b[1] - a[1]);
  if (rawHeaderEntries.length > 0) {
    console.log('');
    console.log('  Raw rule headers from file parsers, top 30:');
    const top = rawHeaderEntries.slice(0, 30);
    const w = Math.max(...top.map(([k]) => k.length), 10);
    for (const [r, n] of top) {
      console.log(`    ${r.padEnd(w)}  ${String(n).padStart(5)}`);
    }
    if (rawHeaderEntries.length > 30) {
      console.log(`    ... and ${rawHeaderEntries.length - 30} more distinct values`);
    }
  } else if (stats.filesWithNoRule === stats.imported && stats.imported > 0) {
    console.log('');
    console.log('  ⚠ NO rule headers were parsed from any file.');
    console.log('    This usually indicates a parser bug: .rle files should');
    console.log('    contain "rule = ..." in their x/y header line, and');
    console.log('    .cells files default to Conway. Check parsers.js.');
  }
  // Per-ruleset sample patterns (helps spot mis-classification quickly).
  if (stats.sampleByRuleset) {
    const sampleEntries = Object.entries(stats.sampleByRuleset).sort(
      (a, b) => (stats.byRuleset[b[0]] || 0) - (stats.byRuleset[a[0]] || 0)
    );
    if (sampleEntries.length > 0) {
      console.log('');
      console.log('  Sample patterns per resolved ruleset:');
      for (const [rs, samples] of sampleEntries) {
        console.log(`    [${rs}]  (${stats.byRuleset[rs] || 0} total)`);
        for (const s of samples) {
          console.log(`      • ${s.id}  [${s.file}]  rawRule="${s.rawRule}"`);
        }
      }
    }
  }

  const undef = stats.undefinedRuleset;
  if (undef && undef.count > 0) {
    console.log('');
    console.log(`  ⚠ Undefined / unrecognized ruleset: ${undef.count} pattern(s)`);
    const rawEntries = Object.entries(undef.byRawRule).sort((a, b) => b[1] - a[1]);
    console.log('    Raw rule strings encountered:');
    const rawWidth = Math.max(...rawEntries.map(([k]) => k.length), 10);
    for (const [rule, n] of rawEntries) {
      console.log(`      ${rule.padEnd(rawWidth)}  ${String(n).padStart(5)}`);
    }
    if (undef.samples && undef.samples.length > 0) {
      console.log('    Sample patterns (up to 20):');
      for (const s of undef.samples) {
        console.log(`      • ${s.id}  [${s.file}]  rule=${s.rawRule}`);
      }
    }
  } else {
    console.log('');
    console.log('  ✓ All imported patterns matched a known ruleset.');
  }
  console.log('═══════════════════════════════════════════════════════════════');
}

/**
 * Run the importer.
 * @param {object} opts
 */
export async function runImport(opts) {
  const t0 = Date.now();
  // Sanity-check: log the registered rulesets so we can verify the
  // resolver has access to the full set (HighLife, Day & Night, ...).
  const allRulesets = listRulesets();
  console.log(`Registered rulesets at import time (${allRulesets.length}):`);
  for (const r of allRulesets) {
    const canonical = formatBSNotation(r.birth, r.survival);
    console.log(`  • ${r.id.padEnd(20)} ${canonical}`);
  }
  if (allRulesets.length < 2) {
    console.warn(
      '⚠ Only Conway is registered. Imports may misclassify all patterns.\n' +
        '   Check that src/rules/index.js is being imported.'
    );
  }
  console.log(`Scanning ${opts.input} ...`);
  const rawFiles = collectFiles(opts.input);
  console.log(`Found ${rawFiles.length} candidate files`);
  const { kept: files, droppedCount } = dedupFilesByBaseName(rawFiles, {
    verbose: opts.verbose,
  });
  if (droppedCount > 0) {
    console.log(
      `Filename dedup: kept ${files.length}, dropped ${droppedCount} duplicate format/case variants`
    );
  }
  const usedIds = new Set();
  const seenFingerprints = new Map(); // fingerprint → entry id
  const patterns = [];
  resetRuleResolutionStats();
  const stats = {
    scanned: 0,
    imported: 0,
    skippedTooLarge: 0,
    skippedEmpty: 0,
    skippedParseFail: 0,
    skippedDuplicate: 0,
    byCategory: {},
    byRuleset: {},
    byRawRuleHeader: {}, // raw meta.rule string → count (post-parse)
    filesWithNoRule: 0,
    filesWithTopology: 0,
    parsesByExt: { '.rle': 0, '.cells': 0, other: 0 },
    unboundedCount: 0,
    extinctCount: 0,
    stabilizedCount: 0,
    undefinedRuleset: {
      count: 0,
      byRawRule: {}, // raw rule string → count
      samples: [], // up to N example entries
    },
    sampleByRuleset: {}, // resolved ruleset id → [up to 5 sample entries]
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
    // Track parse format and rule header capture rate.
    const ext = path.extname(file).toLowerCase();
    if (ext === '.rle') stats.parsesByExt['.rle']++;
    else if (ext === '.cells') stats.parsesByExt['.cells']++;
    else stats.parsesByExt.other++;
    const rawRule = parsed.meta && parsed.meta.rule ? parsed.meta.rule : null;
    if (!rawRule) {
      stats.filesWithNoRule++;
    } else {
      stats.byRawRuleHeader[rawRule] = (stats.byRawRuleHeader[rawRule] || 0) + 1;
      if (rawRule.includes(':')) stats.filesWithTopology++;
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
    // Content-based dedup: identical cell layouts (up to translation) collapse.
    const fp = cellsFingerprint(parsed.cells);
    if (seenFingerprints.has(fp)) {
      stats.skippedDuplicate++;
      if (opts.verbose) {
        console.warn(`  duplicate content ${file} (matches ${seenFingerprints.get(fp)})`);
      }
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
    seenFingerprints.set(fp, entry.id);
    stats.imported++;
    stats.byCategory[entry.category] = (stats.byCategory[entry.category] || 0) + 1;
    const rulesetKey = entry.rulesets && entry.rulesets[0] ? entry.rulesets[0] : '<none>';
    stats.byRuleset[rulesetKey] = (stats.byRuleset[rulesetKey] || 0) + 1;
    if (entry.unbounded) stats.unboundedCount++;
    if (entry.extinct) stats.extinctCount++;
    if (entry.stabilizedAt != null) stats.stabilizedCount++;
    if (!stats.sampleByRuleset[rulesetKey]) stats.sampleByRuleset[rulesetKey] = [];
    if (stats.sampleByRuleset[rulesetKey].length < 5) {
      stats.sampleByRuleset[rulesetKey].push({
        id: entry.id,
        file: path.basename(file),
        rawRule: rawRule || '<none>',
      });
    }
    if (!inferred.rulesetId) {
      stats.undefinedRuleset.count++;
      const rawRule = parsed.meta && parsed.meta.rule ? parsed.meta.rule : '<unspecified>';
      stats.undefinedRuleset.byRawRule[rawRule] =
        (stats.undefinedRuleset.byRawRule[rawRule] || 0) + 1;
      if (stats.undefinedRuleset.samples.length < 20) {
        stats.undefinedRuleset.samples.push({
          id: entry.id,
          file: path.basename(file),
          rawRule,
        });
      }
    }
    if (opts.verbose) {
      const bb = entry.maxBounds;
      const bbStr = bb ? (bb.width === -1 ? ' bbox=∞' : ` bbox=${bb.width}x${bb.height}`) : '';
      console.log(
        `  [${stats.imported}/${limit}] ${entry.id} → ${entry.category}` +
          (entry.period ? ` p${entry.period}` : '') +
          (entry.direction ? ` ${entry.direction}` : '') +
          bbStr +
          `  [rule="${rawRule || '<none>'}" → ${rulesetKey}]`
      );
    } else if (stats.imported % 50 === 0) {
      process.stdout.write(`\r  imported ${stats.imported} / scanned ${stats.scanned}`);
    }
  }
  if (!opts.verbose) process.stdout.write('\n');
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  // Attach rule-resolution diagnostic snapshot to stats so the report
  // (and any downstream consumers) can see exactly how each rule was
  // categorized by resolveRule().
  stats.ruleResolution = {
    matchedById: RULE_RESOLUTION_STATS.matchedById,
    matchedByNotation: RULE_RESOLUTION_STATS.matchedByNotation,
    customAnonymous: RULE_RESOLUTION_STATS.customAnonymous,
    unparseable: RULE_RESOLUTION_STATS.unparseable,
    missing: RULE_RESOLUTION_STATS.missing,
    stripped: RULE_RESOLUTION_STATS.stripped,
    byRawInput: { ...RULE_RESOLUTION_STATS.byRawInput },
    byResolvedId: { ...RULE_RESOLUTION_STATS.byResolvedId },
    sampleUnparseable: [...RULE_RESOLUTION_STATS.sampleUnparseable],
  };
  printSummaryReport(stats, elapsed);
  if (!opts.dryRun) {
    const outDoc = {
      generatedAt: new Date().toISOString(),
      source: opts.input,
      count: patterns.length,
      patterns,
      stats,
    };
    fs.mkdirSync(path.dirname(opts.output), { recursive: true });
    fs.writeFileSync(opts.output, JSON.stringify(outDoc, null, 2));
    console.log(`Wrote ${patterns.length} patterns to ${opts.output}`);
    // Final concise per-ruleset recap (helps when the verbose summary
    // above scrolls off the top of the terminal).
    const ruleEntries = Object.entries(stats.byRuleset || {}).sort((a, b) => b[1] - a[1]);
    if (ruleEntries.length > 0) {
      console.log('');
      console.log('Per-ruleset load counts:');
      for (const [rs, n] of ruleEntries) {
        console.log(`  ${rs}: ${n}`);
      }
    }
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
