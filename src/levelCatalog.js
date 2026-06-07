// Level catalog: fetches a manifest of available level files and their
// metadata, then renders a list of clickable cards on the main menu.
//
// Each level link uses ?level=<path> so checkLevelUrlParam() in pwa.js
// can pick it up and auto-launch the level on page load.
import { Logger } from './logger.js';

const MANIFEST_URL = './levels/index.json';

/**
 * Fetch the level manifest, then prefetch each level file to extract
 * its name + description.
 * @returns {Promise<Array<{path:string,name:string,description:string,gridWidth:number,gridHeight:number,ruleset:string}>>}
 */
export async function loadLevelCatalog() {
  let manifest;
  try {
    const resp = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (!resp.ok) {
      Logger.warn(`[LevelCatalog] Manifest fetch failed: ${resp.status}`);
      return [];
    }
    manifest = await resp.json();
  } catch (e) {
    Logger.warn('[LevelCatalog] Could not load manifest.', e);
    return [];
  }
  const paths = Array.isArray(manifest.levels) ? manifest.levels : [];
  if (paths.length === 0) {
    Logger.info('[LevelCatalog] No levels in manifest.');
    return [];
  }
  // Fetch all level files in parallel. Failures are logged but skipped.
  const results = await Promise.all(
    paths.map(async (p) => {
      try {
        const r = await fetch(p, { cache: 'no-cache' });
        if (!r.ok) {
          Logger.warn(`[LevelCatalog] Skipping ${p}: HTTP ${r.status}`);
          return null;
        }
        const data = await r.json();
        return {
          path: p,
          name: data.name || p.replace(/^.*\//, '').replace(/\.json$/i, ''),
          description: data.description || '',
          gridWidth: data.gridWidth || 0,
          gridHeight: data.gridHeight || 0,
          ruleset: data.ruleset || 'conway',
          cities: Array.isArray(data.cities) ? data.cities.length : 0,
          bases: Array.isArray(data.bases) ? data.bases.length : 0,
          spawners: Array.isArray(data.spawners) ? data.spawners.length : 0,
        };
      } catch (e) {
        Logger.warn(`[LevelCatalog] Failed to load ${p}:`, e);
        return null;
      }
    })
  );
  return results.filter(Boolean);
}

/**
 * Render the catalog into the main menu overlay. Inserts a section
 * above the overlay footer (or appends to overlay content if no footer).
 * Each entry is a clickable card that navigates to ?level=<path>.
 * @param {Array} catalog
 */
export function renderLevelCatalog(catalog) {
  const content = document.getElementById('overlay-content');
  if (!content) {
    Logger.warn('[LevelCatalog] #overlay-content not found.');
    return;
  }
  // Remove any prior render so re-renders (e.g. after exit) work cleanly.
  const prior = content.querySelector('#level-catalog-section');
  if (prior) prior.remove();

  if (!catalog || catalog.length === 0) return;

  const section = document.createElement('div');
  section.id = 'level-catalog-section';
  section.className = 'level-catalog-section';

  const heading = document.createElement('h2');
  heading.className = 'level-catalog-heading';
  heading.textContent = '🎯 Curated Levels';
  section.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'level-catalog-list';

  for (const lvl of catalog) {
    const card = document.createElement('a');
    card.className = 'level-catalog-card';
    // Use ?level=<path> so checkLevelUrlParam() launches it on load.
    const url = new URL(window.location.href);
    url.searchParams.set('level', lvl.path);
    // Preserve any other params; drop fragment to avoid weirdness.
    card.href = url.pathname + '?' + url.searchParams.toString();

    const title = document.createElement('div');
    title.className = 'level-catalog-name';
    title.textContent = lvl.name;
    card.appendChild(title);

    if (lvl.description) {
      const desc = document.createElement('div');
      desc.className = 'level-catalog-desc';
      desc.textContent = lvl.description;
      card.appendChild(desc);
    }

    const meta = document.createElement('div');
    meta.className = 'level-catalog-meta';
    const bits = [];
    if (lvl.gridWidth && lvl.gridHeight) {
      bits.push(`${lvl.gridWidth}×${lvl.gridHeight}`);
    }
    if (lvl.ruleset && lvl.ruleset !== 'conway') {
      bits.push(`rule: ${lvl.ruleset}`);
    }
    if (lvl.cities) bits.push(`${lvl.cities} cit${lvl.cities === 1 ? 'y' : 'ies'}`);
    if (lvl.bases) bits.push(`${lvl.bases} base${lvl.bases === 1 ? '' : 's'}`);
    if (lvl.spawners) bits.push(`${lvl.spawners} spawner${lvl.spawners === 1 ? '' : 's'}`);
    meta.textContent = bits.join(' • ');
    card.appendChild(meta);

    list.appendChild(card);
  }
  section.appendChild(list);

  // Insert before the footer if it's a direct child of content, else append.
  // (With the tabbed menu layout, the footer lives inside a tab panel, so
  // insertBefore would throw. main.js#_relocateLevelCatalog() will move
  // this section into the Library tab afterwards anyway.)
  const footer = content.querySelector('.overlay-footer');
  if (footer && footer.parentNode === content) {
    content.insertBefore(section, footer);
  } else {
    content.appendChild(section);
  }
  Logger.info(`[LevelCatalog] Rendered ${catalog.length} level(s).`);
}

/**
 * Convenience: fetch + render in one call. Safe to call multiple times.
 */
export async function initLevelCatalog() {
  try {
    const catalog = await loadLevelCatalog();
    renderLevelCatalog(catalog);
  } catch (e) {
    Logger.warn('[LevelCatalog] init failed:', e);
  }
}
