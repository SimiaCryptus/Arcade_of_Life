import { CONFIG, CELL_TYPE } from './config.js';
import { Logger } from './logger.js';
import { loadJSON, saveJSON } from './storage.js';

/**
 * Story Mode v2: themed chapters with coherent visual + functional identities,
 * plus a choice-based level-up system between chapters.
 *
 * Each chapter has a single THEME that drives BOTH its visual mood
 * (palette, dialogue color, body background tint) AND its mechanical
 * twist (config patch). For example "Frostbite" is icy blue and slows
 * everything down; "Inferno" is red-orange and accelerates the descent.
 *
 * Between chapters, the player picks 1 of 3 perks. Perks come in three
 * flavors:
 *   STAT   - permanent CONFIG buff (ink regen, max ink, etc.)
 *   PATTERN- unlocks a new pattern preset in the drawing tools
 *   ABILITY- toggles a special game ability (auto-clear, double score, etc.)
 *
 * Trigger conditions advance the chapter:
 *   - wave: hud.wave >= N
 *   - score: hud.score >= N
 *   - cityLost: any city died this chapter
 *   - kills: missiles destroyed since chapter start
 *   - immediate: right after dialogue closes
 */

const STORAGE_KEY = 'missileDefenseStoryProgress';

// ============================================================
// THEMES — visual + mechanical identities used by chapters.
// ============================================================
export const THEMES = {
  // Opening: peaceful, slow, generous. Tutorial vibe.
  dawn: {
    name: 'Dawn',
    background: '#0a0820',
    midline: '#3a3a7a',
    // Defense = mint green; missile = direct complement (red-pink).
    defense: ['#88ffcc', '#aaffdd', '#66ffbb', '#99ffcc'],
    missile: ['#ff5577', '#ff7799', '#ff3366', '#ff88aa'],
    dialogBorder: '#ffcc88',
    dialogText: '#ffeecc',
    nameColor: '#ffcc88',
    bodyBg: '#0a0820',
  },
  // Cold: slow missiles, slow ink, defenses live longer.
  frostbite: {
    name: 'Frostbite',
    background: '#001020',
    midline: '#1a3a6a',
    // Defense = cold blue; missile = direct complement (warm orange).
    defense: ['#66ccff', '#88ddff', '#aaeeff', '#44bbff'],
    missile: ['#ff9933', '#ffaa44', '#ff7722', '#ffbb55'],
    dialogBorder: '#88ccff',
    dialogText: '#ddeeff',
    nameColor: '#88ccff',
    bodyBg: '#001020',
  },
  // Fire: fast missiles, fast ink regen, short cell lifespans.
  inferno: {
    name: 'Inferno',
    background: '#1a0500',
    midline: '#6a2a0a',
    // Defense = warm orange/yellow; missile = direct complement (cyan/blue).
    defense: ['#ffcc44', '#ffdd66', '#ffaa22', '#ffee88'],
    missile: ['#00aaff', '#22ccff', '#0088dd', '#44ddff'],
    dialogBorder: '#ff8844',
    dialogText: '#ffddbb',
    nameColor: '#ff8844',
    bodyBg: '#1a0500',
  },
  // Toxic: drying takes longer, but missiles are fragile.
  toxic: {
    name: 'Toxic',
    background: '#0a1a00',
    midline: '#3a5a1a',
    // Defense = bright green; missile = direct complement (magenta).
    defense: ['#aaff44', '#ccff66', '#88dd33', '#bbff55'],
    missile: ['#ff44aa', '#ff66cc', '#dd33aa', '#ff55bb'],
    dialogBorder: '#aaff44',
    dialogText: '#eeffcc',
    nameColor: '#aaff44',
    bodyBg: '#0a1a00',
  },
  // Void: mystical, expensive but powerful.
  voidspace: {
    name: 'The Void',
    background: '#080018',
    midline: '#3a1a5a',
    // Defense = purple; missile = direct complement (yellow-green).
    defense: ['#bb88ff', '#cc99ff', '#aa66ff', '#dd99ff'],
    missile: ['#ccff44', '#aaff22', '#ddff66', '#99dd11'],
    dialogBorder: '#cc88ff',
    dialogText: '#eedfff',
    nameColor: '#cc88ff',
    bodyBg: '#080018',
  },
  // Storm: chaotic, lots of missiles, lots of ink.
  tempest: {
    name: 'Tempest',
    background: '#001a1a',
    midline: '#1a5a5a',
    // Defense = cyan; missile = direct complement (red-orange).
    defense: ['#66ffff', '#88ffff', '#aaffff', '#44eeee'],
    missile: ['#ff6644', '#ff8866', '#ff4422', '#ffaa88'],
    dialogBorder: '#66ffff',
    dialogText: '#ccffff',
    nameColor: '#66ffff',
    bodyBg: '#001a1a',
  },
  // Blood: hardcore mode, friendly-fire risk.
  crimson: {
    name: 'Crimson',
    background: '#1a0008',
    midline: '#5a1a2a',
    // Defense = pink-red; missile = direct complement (teal-green).
    defense: ['#ff6688', '#ff8899', '#dd4466', '#ffaabb'],
    missile: ['#22ddaa', '#44ffcc', '#11bb88', '#66ffdd'],
    dialogBorder: '#ff4466',
    dialogText: '#ffcccc',
    nameColor: '#ff4466',
    bodyBg: '#1a0008',
  },
  // Golden: triumphant, abundant.
  dawnbreak: {
    name: 'Dawnbreak',
    background: '#0a1a00',
    midline: '#5a5a1a',
    // Defense = gold/yellow; missile = direct complement (blue/violet).
    defense: ['#ffff66', '#ffee88', '#ffcc44', '#ffffaa'],
    missile: ['#6666ff', '#8888ff', '#4444dd', '#aaaaff'],
    dialogBorder: '#ffff66',
    dialogText: '#ffffcc',
    nameColor: '#ffff66',
    bodyBg: '#0a1a00',
  },
  // Final: white-hot, everything turned up.
  ascendant: {
    name: 'Ascendant',
    background: '#101020',
    midline: '#6a6aaa',
    // Defense = white/cyan-white; missile = pure black-red (max contrast).
    defense: ['#ffffff', '#ddddff', '#bbffff', '#ffffcc'],
    missile: ['#ff0000', '#ff2200', '#dd0033', '#ff3322'],
    dialogBorder: '#ffffff',
    dialogText: '#ffffff',
    nameColor: '#ffffff',
    bodyBg: '#101020',
  },
};

// Speaker portraits / colors.
export const SPEAKERS = {
  COMMANDER: { name: 'Cmdr. Vance', color: '#ffaa00' },
  DR_HALE: { name: 'Dr. Hale', color: '#00ffff' },
  OPS: { name: 'Ops Channel', color: '#88ff88' },
  ENEMY: { name: '???', color: '#ff4040' },
  NARRATOR: { name: '', color: '#aaaaff' },
  CONWAY: { name: 'The Pattern', color: '#cc88ff' },
};

// ============================================================
// PATTERNS unlockable via the perk system.
// ============================================================
export const STORY_PATTERNS = {
  pulsar: [
    [2, 0],
    [3, 0],
    [4, 0],
    [8, 0],
    [9, 0],
    [10, 0],
    [0, 2],
    [5, 2],
    [7, 2],
    [12, 2],
    [0, 3],
    [5, 3],
    [7, 3],
    [12, 3],
    [0, 4],
    [5, 4],
    [7, 4],
    [12, 4],
    [2, 5],
    [3, 5],
    [4, 5],
    [8, 5],
    [9, 5],
    [10, 5],
    [2, 7],
    [3, 7],
    [4, 7],
    [8, 7],
    [9, 7],
    [10, 7],
    [0, 8],
    [5, 8],
    [7, 8],
    [12, 8],
    [0, 9],
    [5, 9],
    [7, 9],
    [12, 9],
    [0, 10],
    [5, 10],
    [7, 10],
    [12, 10],
    [2, 12],
    [3, 12],
    [4, 12],
    [8, 12],
    [9, 12],
    [10, 12],
  ],
  ship_mwss: [
    [0, 0],
    [3, 0],
    [4, 1],
    [0, 2],
    [4, 2],
    [1, 3],
    [2, 3],
    [3, 3],
    [4, 3],
  ],
  ship_hwss: [
    [0, 0],
    [1, 0],
    [4, 0],
    [5, 0],
    [6, 1],
    [0, 2],
    [6, 2],
    [1, 3],
    [2, 3],
    [3, 3],
    [4, 3],
    [5, 3],
    [6, 3],
  ],
  diehard: [
    [6, 0],
    [0, 1],
    [1, 1],
    [1, 2],
    [5, 2],
    [6, 2],
    [7, 2],
  ],
  gosper_gun: [
    [24, 0],
    [22, 1],
    [24, 1],
    [12, 2],
    [13, 2],
    [20, 2],
    [21, 2],
    [34, 2],
    [35, 2],
    [11, 3],
    [15, 3],
    [20, 3],
    [21, 3],
    [34, 3],
    [35, 3],
    [0, 4],
    [1, 4],
    [10, 4],
    [16, 4],
    [20, 4],
    [21, 4],
    [0, 5],
    [1, 5],
    [10, 5],
    [14, 5],
    [16, 5],
    [17, 5],
    [22, 5],
    [24, 5],
    [10, 6],
    [16, 6],
    [24, 6],
    [11, 7],
    [15, 7],
    [12, 8],
    [13, 8],
  ],
  penta_decathlon: [
    [1, 0],
    [1, 1],
    [0, 2],
    [2, 2],
    [1, 3],
    [1, 4],
    [1, 5],
    [1, 6],
    [0, 7],
    [2, 7],
    [1, 8],
    [1, 9],
  ],
  copperhead: [
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [0, 1],
    [4, 1],
    [4, 2],
    [0, 3],
    [3, 3],
    [1, 4],
    [2, 4],
  ],
};

// Pretty display names for patterns.
const PATTERN_NAMES = {
  glider: 'Glider',
  blinker: 'Blinker',
  block: 'Block',
  lwss: 'LWSS',
  rpentomino: 'R-Pentomino',
  acorn: 'Acorn',
  toad: 'Toad',
  beacon: 'Beacon',
  pulsar: 'Pulsar',
  ship_mwss: 'MWSS',
  ship_hwss: 'HWSS',
  diehard: 'Diehard',
  gosper_gun: 'Gosper Glider Gun',
  penta_decathlon: 'Penta-Decathlon',
  copperhead: 'Copperhead',
};

// ============================================================
// PERKS — choice-based level-up system.
// Each perk has: id, type, name, description, icon, apply(engine)
// Active abilities are special: they install an activatable function
// on engine.activeAbility instead of being permanent.
// ============================================================
export const PERKS = {
  // ---- STAT perks ----
  ink_capacity: {
    id: 'ink_capacity',
    type: 'STAT',
    name: 'Reinforced Reservoir',
    icon: '🛢',
    desc: '+100 Max Ink permanently.',
    apply: (eng) => {
      CONFIG.MAX_INK += 100;
      eng.game.defenses.maxInk = CONFIG.MAX_INK;
    },
  },
  ink_regen: {
    id: 'ink_regen',
    type: 'STAT',
    name: 'Pressure Pumps',
    icon: '💧',
    desc: '+0.3 Ink Regen per tick.',
    apply: () => {
      CONFIG.INK_REGEN_RATE += 0.3;
    },
  },
  defense_age: {
    id: 'defense_age',
    type: 'STAT',
    name: 'Lattice Anchors',
    icon: '⚓',
    desc: 'Defenses live +80 ticks longer.',
    apply: () => {
      CONFIG.CELL_MAX_AGE_TICKS += 80; // TODO: Update this with new config system.
    },
  },
  missile_fragile: {
    id: 'missile_fragile',
    type: 'STAT',
    name: 'Targeted Decay',
    icon: '🎯',
    desc: 'Missiles die 50 ticks sooner.',
    apply: () => {
      CONFIG.MISSILE_MAX_AGE_TICKS = Math.max(40, CONFIG.MISSILE_MAX_AGE_TICKS - 50);
    },
  },
  cascade_boost: {
    id: 'cascade_boost',
    type: 'STAT',
    name: 'Chain Reaction',
    icon: '⛓',
    desc: 'Missile cascade window +15 ticks.',
    apply: () => {
      CONFIG.MISSILE_CASCADE_TICKS += 15;
    },
  },
  faster_dry: {
    id: 'faster_dry',
    type: 'STAT',
    name: 'Quick-Dry Catalyst',
    icon: '⏱',
    desc: 'Ink dries 2 ticks faster.',
    apply: () => {
      CONFIG.INK_DRY_TICKS = Math.max(0, CONFIG.INK_DRY_TICKS - 2);
    },
  },
  refund_boost: {
    id: 'refund_boost',
    type: 'STAT',
    name: 'Salvage Protocol',
    icon: '♻',
    desc: 'Clear/undo refunds +25% more ink.',
    apply: () => {
      CONFIG.CLEAR_REFUND_FRACTION = Math.min(1, CONFIG.CLEAR_REFUND_FRACTION + 0.25);
    },
  },
  city_extra: {
    id: 'city_extra',
    type: 'STAT',
    name: 'Civilian Evacuation',
    icon: '🏛',
    desc: 'Revive 1 destroyed city (if any).',
    apply: (eng) => {
      const g = eng.game.grid;
      const dead = eng.game.cities.cities.find((c) => !c.alive);
      if (dead) {
        dead.alive = true;
        for (let dy = 0; dy < dead.height; dy++) {
          for (let dx = 0; dx < dead.width; dx++) {
            g.set(dead.x + dx, dead.y + dy, CELL_TYPE.CITY);
          }
        }
      }
    },
  },

  // ---- PATTERN perks ----
  pat_blinker: {
    id: 'pat_blinker',
    type: 'PATTERN',
    name: 'Blinker',
    icon: '✦',
    desc: 'Unlock Blinker oscillator preset.',
    apply: (eng) => eng.unlockPattern('blinker'),
  },
  pat_block: {
    id: 'pat_block',
    type: 'PATTERN',
    name: 'Block',
    icon: '▣',
    desc: 'Unlock Block still-life preset.',
    apply: (eng) => eng.unlockPattern('block'),
  },
  pat_toad: {
    id: 'pat_toad',
    type: 'PATTERN',
    name: 'Toad',
    icon: '🐸',
    desc: 'Unlock Toad oscillator preset.',
    apply: (eng) => eng.unlockPattern('toad'),
  },
  pat_beacon: {
    id: 'pat_beacon',
    type: 'PATTERN',
    name: 'Beacon',
    icon: '🔆',
    desc: 'Unlock Beacon oscillator preset.',
    apply: (eng) => eng.unlockPattern('beacon'),
  },
  pat_lwss: {
    id: 'pat_lwss',
    type: 'PATTERN',
    name: 'Lightweight Spaceship',
    icon: '🚀',
    desc: 'Unlock LWSS — a traveling glider.',
    apply: (eng) => eng.unlockPattern('lwss'),
  },
  pat_mwss: {
    id: 'pat_mwss',
    type: 'PATTERN',
    name: 'Middleweight Spaceship',
    icon: '🛸',
    desc: 'Unlock MWSS — bigger, slower.',
    apply: (eng) => eng.unlockPattern('ship_mwss'),
  },
  pat_hwss: {
    id: 'pat_hwss',
    type: 'PATTERN',
    name: 'Heavyweight Spaceship',
    icon: '🛰',
    desc: 'Unlock HWSS — massive traveler.',
    apply: (eng) => eng.unlockPattern('ship_hwss'),
  },
  pat_pulsar: {
    id: 'pat_pulsar',
    type: 'PATTERN',
    name: 'Pulsar',
    icon: '✺',
    desc: 'Unlock Pulsar — large oscillator.',
    apply: (eng) => eng.unlockPattern('pulsar'),
  },
  pat_rpent: {
    id: 'pat_rpent',
    type: 'PATTERN',
    name: 'R-Pentomino',
    icon: '⚛',
    desc: 'Unlock R-Pentomino — chaos engine.',
    apply: (eng) => eng.unlockPattern('rpentomino'),
  },
  pat_acorn: {
    id: 'pat_acorn',
    type: 'PATTERN',
    name: 'Acorn',
    icon: '🌰',
    desc: 'Unlock Acorn — long-lived methuselah.',
    apply: (eng) => eng.unlockPattern('acorn'),
  },
  pat_diehard: {
    id: 'pat_diehard',
    type: 'PATTERN',
    name: 'Diehard',
    icon: '💀',
    desc: 'Unlock Diehard — vanishes after 130 generations.',
    apply: (eng) => eng.unlockPattern('diehard'),
  },
  pat_pentadeca: {
    id: 'pat_pentadeca',
    type: 'PATTERN',
    name: 'Penta-Decathlon',
    icon: '🎭',
    desc: 'Unlock Penta-Decathlon — period-15 oscillator.',
    apply: (eng) => eng.unlockPattern('penta_decathlon'),
  },
  pat_copperhead: {
    id: 'pat_copperhead',
    type: 'PATTERN',
    name: 'Copperhead',
    icon: '🐍',
    desc: 'Unlock Copperhead — slow spaceship.',
    apply: (eng) => eng.unlockPattern('copperhead'),
  },
  pat_gun: {
    id: 'pat_gun',
    type: 'PATTERN',
    name: 'Gosper Glider Gun',
    icon: '⚙',
    desc: 'Unlock the legendary glider factory.',
    apply: (eng) => eng.unlockPattern('gosper_gun'),
  },

  // ---- ABILITY perks ----
  // PASSIVE abilities (auto-on, no button).
  ab_double_score: {
    id: 'ab_double_score',
    type: 'ABILITY',
    name: 'Combat Bonuses',
    icon: '⭐',
    desc: 'Passive: +50% score from all kills.',
    apply: (eng) => {
      eng.abilities.scoreMult = (eng.abilities.scoreMult || 1) * 1.5;
    },
  },
  ab_no_dry: {
    id: 'ab_no_dry',
    type: 'ABILITY',
    name: 'Instant Set',
    icon: '⚡',
    desc: 'Passive: ink commits instantly — no drying.',
    apply: () => {
      CONFIG.INK_DRY_TICKS = 0;
    },
  },
  ab_wave_bonus: {
    id: 'ab_wave_bonus',
    type: 'ABILITY',
    name: 'Veteran Pay',
    icon: '💰',
    desc: 'Passive: +30 ink at the start of each wave.',
    apply: (eng) => {
      eng.abilities.waveInkBonus = (eng.abilities.waveInkBonus || 0) + 30;
    },
  },
  ab_safe_zone: {
    id: 'ab_safe_zone',
    type: 'ABILITY',
    name: 'Demilitarized Zone',
    icon: '🛡',
    desc: 'Passive: disables hardcore friendly-fire.',
    apply: () => {
      CONFIG.HARDCORE_MODE = false;
    },
  },
  ab_slow_missiles: {
    id: 'ab_slow_missiles',
    type: 'ABILITY',
    name: 'Atmospheric Drag',
    icon: '🐢',
    desc: 'Passive: missile spawns 20% slower this run.',
    apply: () => {
      CONFIG.MISSILE_SPAWN_INTERVAL = Math.round(CONFIG.MISSILE_SPAWN_INTERVAL * 1.2);
    },
  },
  // ACTIVE abilities — installable to engine.activeAbility,
  // triggered by the player via button or A hotkey. They have a
  // cooldown (in seconds). Calling apply() registers them.
  ab_emp_burst: {
    id: 'ab_emp_burst',
    type: 'ACTIVE',
    name: 'EMP Burst',
    icon: '💥',
    desc: 'ACTIVE [A]: Vaporize all enemy missile cells. 30s cooldown.',
    apply: (eng) => {
      eng.setActiveAbility({
        id: 'ab_emp_burst',
        name: 'EMP Burst',
        icon: '💥',
        cooldown: 30,
        trigger: () => {
          const g = eng.game.grid;
          let n = 0;
          for (let i = 0; i < g.cells.length; i++) {
            if (g.cells[i] === CELL_TYPE.MISSILE) {
              g.cells[i] = CELL_TYPE.EXPLOSION;
              g.explosionTimers[i] = 6;
              n++;
            }
          }
          // Also wipe out active targets.
          for (const t of eng.game.missiles.targets) t.alive = false;
          eng.game.missiles.targets = [];
          if (eng.game.renderer) {
            eng.game.renderer.addShake(6, 25);
          }
          return n > 0;
        },
      });
    },
  },
  ab_ink_surge: {
    id: 'ab_ink_surge',
    type: 'ACTIVE',
    name: 'Ink Surge',
    icon: '🎁',
    desc: 'ACTIVE [A]: Instantly refill +200 ink. 20s cooldown.',
    apply: (eng) => {
      eng.setActiveAbility({
        id: 'ab_ink_surge',
        name: 'Ink Surge',
        icon: '🎁',
        cooldown: 20,
        trigger: () => {
          eng.game.defenses.refill(200);
          return true;
        },
      });
    },
  },
  ab_freeze: {
    id: 'ab_freeze',
    type: 'ACTIVE',
    name: 'Time Stop',
    icon: '⏱',
    desc: 'ACTIVE [A]: Freeze enemy missiles for 5s. Your defenses keep moving! 45s cooldown.',
    apply: (eng) => {
      eng.setActiveAbility({
        id: 'ab_freeze',
        name: 'Time Stop',
        icon: '⏱',
        cooldown: 45,
        trigger: () => {
          eng.beginTimeStop(5);
          return true;
        },
      });
    },
  },
};

// Helper to build perk pools per chapter (themed picks + stat staples).
function pickPerks(themedPatternIds, extraIds = []) {
  const statPool = [
    'ink_capacity',
    'ink_regen',
    'defense_age',
    'missile_fragile',
    'cascade_boost',
    'faster_dry',
    'refund_boost',
    'city_extra',
  ];
  const abilityPool = [
    'ab_double_score',
    'ab_wave_bonus',
    'ab_slow_missiles',
    'ab_emp_burst',
    'ab_ink_surge',
    'ab_freeze',
  ];
  return {
    patterns: themedPatternIds,
    stats: statPool,
    abilities: abilityPool.concat(extraIds),
  };
}

// ============================================================
// CHAPTERS — each has a coherent theme tying visuals + mechanics.
// ============================================================
export const CHAPTERS = [
  {
    id: 'ch1_dawn',
    title: 'Chapter 1: First Light',
    theme: 'dawn',
    configPatch: {
      // Tutorial: very generous. Few enemies, slow spawn, abundant ink.
      INITIAL_INK: 400,
      MAX_INK: 500,
      INK_REGEN_RATE: 1.2,
      MISSILES_PER_WAVE_BASE: 2,
      MISSILES_PER_WAVE_INC: 1,
      MISSILE_SPAWN_INTERVAL: 2200,
      MISSILE_SPAWN_MIN: 1200,
      MISSILE_SPAWN_DECREMENT: 20,
      GLIDER_SE: true,
      GLIDER_SW: false,
      GLIDER_HEAVY: false,
      GLIDER_LWSS: false,
      GLIDER_MWSS: false,
      GLIDER_TWIN: false,
      GLIDER_GUN: false,
      MISSILE_MAX_AGE_TICKS: 180,
      INK_DRY_TICKS: 2,
      HARDCORE_MODE: false,
      SPEED_MULTIPLIER: 1.0,
    },
    perkChoices: pickPerks(['pat_blinker', 'pat_block', 'pat_toad']),
    dialogues: [
      { speaker: 'NARRATOR', text: 'Year 2089. First light over the silos.' },
      { speaker: 'COMMANDER', text: 'Operator, welcome aboard. Cmdr. Vance speaking.' },
      {
        speaker: 'DR_HALE',
        text: "I'm Dr. Hale, lead engineer. Let's get you trained up before the real fight starts.",
      },
      {
        speaker: 'DR_HALE',
        text: 'TUTORIAL: Hold the left mouse button on the BOTTOM HALF of the grid and drag to paint defenses (green).',
      },
      {
        speaker: 'DR_HALE',
        text: 'TUTORIAL: When you release the mouse, your ink "dries" and becomes active defenses.',
      },
      { speaker: 'OPS', text: 'Incoming! Just two slow gliders — practice on them.' },
      {
        speaker: 'DR_HALE',
        text: 'TIP: Defenses are GREEN. Enemies are RED. If a red cell touches green, BOTH die in a small explosion.',
      },
      {
        speaker: 'COMMANDER',
        text: "Just paint a horizontal line above your cities. That's all you need.",
      },
    ],
    trigger: { wave: 3 },
  },

  {
    id: 'ch2_basics',
    title: 'Chapter 2: The Rules of Life',
    theme: 'dawn',
    configPatch: {
      INK_REGEN_RATE: 1.0,
      MISSILES_PER_WAVE_BASE: 3,
      MISSILES_PER_WAVE_INC: 1,
      MISSILE_SPAWN_INTERVAL: 1800,
      MISSILE_SPAWN_MIN: 1000,
      MISSILE_SPAWN_DECREMENT: 30,
      GLIDER_SE: true,
      GLIDER_SW: true,
      MISSILE_MAX_AGE_TICKS: 170,
    },
    perkChoices: pickPerks(['pat_block', 'pat_blinker', 'pat_beacon']),
    dialogues: [
      {
        speaker: 'DR_HALE',
        text: "Good work. Now let's talk about Conway's rules — they govern everything here.",
      },
      {
        speaker: 'DR_HALE',
        text: 'RULE 1: A live cell with 2 or 3 live neighbors survives the next tick.',
      },
      {
        speaker: 'DR_HALE',
        text: 'RULE 2: A dead cell with EXACTLY 3 live neighbors springs to life.',
      },
      { speaker: 'DR_HALE', text: 'RULE 3: Anything else dies of loneliness or overcrowding.' },
      {
        speaker: 'DR_HALE',
        text: 'TIP: A lone defense cell will DIE immediately. Always draw in clusters!',
      },
      { speaker: 'OPS', text: 'New contacts — gliders coming from BOTH sides now.' },
      {
        speaker: 'COMMANDER',
        text: 'Thicker walls, operator. Two or three cells deep at minimum.',
      },
    ],
    trigger: { wave: 5 },
  },

  {
    id: 'ch3_tools',
    title: 'Chapter 3: Tools of the Trade',
    theme: 'dawn',
    configPatch: {
      MISSILES_PER_WAVE_BASE: 4,
      MISSILES_PER_WAVE_INC: 1,
      MISSILE_SPAWN_INTERVAL: 1500,
    },
    perkChoices: pickPerks(['pat_block', 'pat_lwss', 'pat_rpent']),
    dialogues: [
      { speaker: 'DR_HALE', text: 'Time to learn your drawing tools. Look at the bottom toolbar.' },
      {
        speaker: 'DR_HALE',
        text: 'TOOL 1 (F): Freehand — just drag to draw. Good for organic walls.',
      },
      {
        speaker: 'DR_HALE',
        text: 'TOOL 2 (L): Line — click and drag for a perfectly straight line.',
      },
      {
        speaker: 'DR_HALE',
        text: 'TOOL 3 (P): Pattern — pick a preset (Block, Glider, etc.) and click to stamp it.',
      },
      {
        speaker: 'DR_HALE',
        text: 'HOTKEY: Press F, L, or P to switch instantly. R rotates patterns. Z undoes.',
      },
      {
        speaker: 'COMMANDER',
        text: 'Press C to wipe all defenses and get a 50% ink refund. Useful when you mess up.',
      },
      {
        speaker: 'OPS',
        text: 'And press SPACE to pause. The simulation stops, but you can still draw.',
      },
    ],
    trigger: { wave: 7 },
  },

  {
    id: 'ch4_frostbite',
    title: 'Chapter 4: Frostbite',
    theme: 'frostbite',
    configPatch: {
      // Cold = everything slows down. Missiles are slow & long-lived;
      // defenses persist longer; ink regen drops.
      INK_REGEN_RATE: 0.6,
      MISSILES_PER_WAVE_BASE: 5,
      MISSILES_PER_WAVE_INC: 1,
      MISSILE_SPAWN_INTERVAL: 1700,
      MISSILE_SPAWN_MIN: 900,
      MISSILE_SPAWN_DECREMENT: 30,
      INK_DRY_TICKS: 6, // ink freezes slowly
      GLIDER_SW: true,
    },
    perkChoices: pickPerks(['pat_block', 'pat_pulsar', 'pat_pentadeca']),
    dialogues: [
      { speaker: 'NARRATOR', text: 'The sky turns cold blue. The temperature plummets.' },
      {
        speaker: 'OPS',
        text: "Temperature is dropping. They're slower now... but they don't die.",
      },
      {
        speaker: 'DR_HALE',
        text: 'Cold patterns. Long-lived. Conserve your ink — every drop matters.',
      },
      {
        speaker: 'DR_HALE',
        text: 'TIP: Frostbite ink takes 6 ticks to dry. Watch the green flash darken — only then is your wall live.',
      },
      { speaker: 'COMMANDER', text: "Build walls. They'll last in this air." },
    ],
    trigger: { wave: 10 },
  },

  {
    id: 'ch5_targets',
    title: 'Chapter 5: Target Practice',
    theme: 'frostbite',
    configPatch: {
      INK_REGEN_RATE: 1.4,
      MAX_INK: 500,
      MISSILES_PER_WAVE_BASE: 4,
      MISSILES_PER_WAVE_INC: 1,
      MISSILE_SPAWN_INTERVAL: 1400,
      GLIDER_HEAVY: true, // ENABLE TARGET EMPLACEMENTS!
      INK_DRY_TICKS: 3,
    },
    perkChoices: pickPerks(['pat_lwss', 'pat_pulsar', 'pat_acorn']),
    dialogues: [
      {
        speaker: 'OPS',
        text: 'New threat detected — stationary RED EMPLACEMENTS at the top of the field!',
      },
      {
        speaker: 'DR_HALE',
        text: "TARGETS: They don't move. They WON'T despawn on their own. They keep spawning gliders until you destroy them.",
      },
      {
        speaker: 'COMMANDER',
        text: 'You need to reach them. Launch a glider of your own — a Lightweight Spaceship, an R-Pentomino, anything that travels UP.',
      },
      {
        speaker: 'DR_HALE',
        text: 'TIP: A glider stamp aimed upward will eventually slam into the target. Bonus points if it RICOCHETS.',
      },
      { speaker: 'OPS', text: "You'll know a target is dead when it explodes in a big flash." },
    ],
    trigger: { wave: 13 },
  },

  {
    id: 'ch6_inferno',
    title: 'Chapter 6: Inferno',
    theme: 'inferno',
    configPatch: {
      // Fire = everything is fast and short-lived.
      INK_REGEN_RATE: 1.6,
      MAX_INK: 450,
      MISSILES_PER_WAVE_BASE: 8,
      MISSILES_PER_WAVE_INC: 2,
      MISSILE_SPAWN_INTERVAL: 750,
      MISSILE_SPAWN_MIN: 400,
      MISSILE_SPAWN_DECREMENT: 50,
      INK_DRY_TICKS: 2, // ink flash-dries
      GLIDER_HEAVY: true,
    },
    perkChoices: pickPerks(['pat_lwss', 'pat_rpent', 'pat_acorn']),
    dialogues: [
      { speaker: 'OPS', text: "They're burning hot — fast descenders! Targets on the horizon!" },
      { speaker: 'DR_HALE', text: "Defenses won't last long here. Draw fast, draw often." },
      { speaker: 'DR_HALE', text: 'TIP: Use your ABILITY (button or A hotkey) when overwhelmed.' },
      { speaker: 'COMMANDER', text: 'Lightweight Spaceship if you can — counterattack!' },
    ],
    trigger: { wave: 16 },
  },

  {
    id: 'ch7_toxic',
    title: 'Chapter 7: Toxic Bloom',
    theme: 'toxic',
    configPatch: {
      // Poison = missiles are fragile, but ink is slow to set.
      INK_REGEN_RATE: 1.1,
      MAX_INK: 500,
      MISSILES_PER_WAVE_BASE: 9,
      MISSILES_PER_WAVE_INC: 2,
      MISSILE_SPAWN_INTERVAL: 900,
      MISSILE_MAX_AGE_TICKS: 70, // intentionally fragile
      MISSILE_CASCADE_TICKS: 40, // big chain reactions
      INK_DRY_TICKS: 8, // toxic glue
    },
    perkChoices: pickPerks(['pat_diehard', 'pat_toad', 'pat_beacon']),
    dialogues: [
      { speaker: 'DR_HALE', text: 'The air is toxic. Their patterns dissolve in chains.' },
      { speaker: 'OPS', text: 'Cascade detection online. Trigger one, you trigger many.' },
      { speaker: 'COMMANDER', text: 'Use it. Bait their formations into each other.' },
    ],
    trigger: { wave: 19 },
  },

  {
    id: 'ch8_void',
    title: 'Chapter 8: The Void',
    theme: 'voidspace',
    configPatch: {
      // Mystical = expensive but powerful, with R-Pentomino + LWSS chaos.
      INK_REGEN_RATE: 0.9,
      MAX_INK: 550,
      MISSILES_PER_WAVE_BASE: 10,
      MISSILE_SPAWN_INTERVAL: 800,
      GLIDER_LWSS: true,
      GLIDER_TWIN: true,
      INK_DRY_TICKS: 4,
    },
    perkChoices: pickPerks(['pat_pulsar', 'pat_mwss', 'pat_diehard']),
    dialogues: [
      { speaker: 'DR_HALE', text: "I'm intercepting voices. Inside the descent." },
      { speaker: 'ENEMY', text: '...do you compute, operator?' },
      { speaker: 'CONWAY', text: 'Three is the number. Two is the rest. The grid remembers.' },
      { speaker: 'COMMANDER', text: 'What in the hell.' },
    ],
    trigger: { wave: 22 },
  },

  {
    id: 'ch9_tempest',
    title: 'Chapter 9: Tempest',
    theme: 'tempest',
    configPatch: {
      // Storm = lots of everything. Ink flows free, missiles swarm.
      INK_REGEN_RATE: 1.8,
      MAX_INK: 650,
      MISSILES_PER_WAVE_BASE: 13,
      MISSILES_PER_WAVE_INC: 3,
      MISSILE_SPAWN_INTERVAL: 600,
      MISSILE_SPAWN_MIN: 300,
      MISSILE_SPAWN_DECREMENT: 60,
      GLIDER_MWSS: true,
      INK_DRY_TICKS: 3,
    },
    perkChoices: pickPerks(['pat_hwss', 'pat_copperhead', 'pat_acorn']),
    dialogues: [
      { speaker: 'OPS', text: 'Storm contacts! Wide front! All sectors!' },
      { speaker: 'COMMANDER', text: 'Plenty of ink, plenty of fire. Spread out.' },
      { speaker: 'DR_HALE', text: 'Heavyweight ships now. They travel. Aim true.' },
    ],
    trigger: { wave: 25 },
  },

  {
    id: 'ch10_crimson',
    title: 'Chapter 10: Crimson Protocol',
    theme: 'crimson',
    configPatch: {
      // Blood = hardcore. Your own defenses can wreck cities.
      HARDCORE_MODE: true,
      INK_REGEN_RATE: 1.4,
      MAX_INK: 550,
      MISSILES_PER_WAVE_BASE: 14,
      MISSILE_SPAWN_INTERVAL: 700,
      INK_DRY_TICKS: 4,
    },
    // Offer Safe Zone as a possible ability!
    perkChoices: {
      patterns: ['pat_pulsar', 'pat_diehard', 'pat_pentadeca'],
      stats: ['ink_capacity', 'defense_age', 'refund_boost', 'city_extra'],
      abilities: ['ab_safe_zone', 'ab_double_score', 'ab_emp_burst', 'ab_ink_surge'],
    },
    dialogues: [
      { speaker: 'OPS', text: 'CRIMSON PROTOCOL: field instability. Own cells striking cities!' },
      { speaker: 'COMMANDER', text: 'Friendly fire active. Mind your borders.' },
      { speaker: 'DR_HALE', text: "I'm sorry — the grid is destabilizing. Operator: be careful." },
    ],
    trigger: { cityLost: true, wave: 28 },
  },

  {
    id: 'ch11_dawnbreak',
    title: 'Chapter 11: Dawnbreak',
    theme: 'dawnbreak',
    configPatch: {
      // Recovery: turn off hardcore (story relief), abundance returns.
      HARDCORE_MODE: false,
      INK_REGEN_RATE: 2.0,
      MAX_INK: 700,
      INITIAL_INK: 400,
      MISSILES_PER_WAVE_BASE: 15,
      MISSILE_SPAWN_INTERVAL: 650,
      INK_DRY_TICKS: 2,
    },
    perkChoices: pickPerks(['pat_gun', 'pat_hwss', 'pat_pulsar']),
    dialogues: [
      { speaker: 'DR_HALE', text: 'I have it. The schematic. The Gosper Glider Gun.' },
      { speaker: 'COMMANDER', text: "A weapon that prints weapons. You can't be serious." },
      { speaker: 'DR_HALE', text: 'Plant it. Aim it. Let the rules do the work.' },
      { speaker: 'NARRATOR', text: 'For the first time in weeks, the sky shows blue.' },
    ],
    trigger: { wave: 31 },
  },

  {
    id: 'ch12_ascendant',
    title: 'Chapter 12: Ascendant',
    theme: 'ascendant',
    configPatch: {
      // Final: everything turned up. Maximum chaos & beauty.
      MISSILES_PER_WAVE_BASE: 20,
      MISSILES_PER_WAVE_INC: 4,
      MISSILE_SPAWN_INTERVAL: 500,
      MISSILE_SPAWN_MIN: 200,
      MISSILE_SPAWN_DECREMENT: 80,
      MAX_INK: 800,
      INK_REGEN_RATE: 2.5,
      INK_DRY_TICKS: 1,
      GLIDER_SE: true,
      GLIDER_SW: true,
      GLIDER_HEAVY: true,
      GLIDER_LWSS: true,
      GLIDER_MWSS: true,
      GLIDER_TWIN: true,
    },
    perkChoices: {
      patterns: ['pat_gun', 'pat_copperhead', 'pat_hwss'],
      stats: ['ink_capacity', 'ink_regen', 'defense_age', 'refund_boost'],
      abilities: ['ab_double_score', 'ab_emp_burst', 'ab_freeze', 'ab_no_dry'],
    },
    dialogues: [
      { speaker: 'OPS', text: 'COMMANDER — massed signature, ALL sectors!' },
      { speaker: 'COMMANDER', text: 'This is it. Every preset. Every trick.' },
      { speaker: 'CONWAY', text: 'Three neighbors give life. The pattern endures.' },
      { speaker: 'DR_HALE', text: 'Operator — whatever happens, thank you.' },
    ],
    trigger: { wave: 36 },
  },

  {
    id: 'ch_epilogue',
    title: 'Epilogue',
    theme: 'dawnbreak',
    configPatch: {},
    perkChoices: null,
    dialogues: [
      { speaker: 'NARRATOR', text: 'The descent stopped. No-one knows why.' },
      { speaker: 'DR_HALE', text: "Some cities still stand. That's enough." },
      { speaker: 'COMMANDER', text: 'Good work, operator. The grid is yours.' },
      { speaker: 'CONWAY', text: 'Three is the number. Always.' },
      { speaker: 'NARRATOR', text: '— END OF STORY MODE —' },
    ],
    trigger: { immediate: true },
  },
];

/**
 * StoryEngine — drives chapter progression, dialogue UI, perk selection,
 * theme application, and ability tracking.
 */
export class StoryEngine {
  constructor({ game, settings, drawTools }) {
    this.game = game;
    this.settings = settings;
    this.drawTools = drawTools;

    this.enabled = false;
    this.chapterIndex = -1;
    this.chapter = null;
    this.chapterStartTime = 0;
    this.chapterStartScore = 0;
    this.chapterStartCities = 0;
    this.chapterStartWave = 0;
    this.unlockedPatterns = new Set(['glider']);
    this.acquiredPerks = []; // history of perk ids
    // Tool-mode unlocks for story mode. Free-play has all tools.
    // Story starts with only freehand drawing; line & pattern unlock later.
    this.unlockedTools = new Set(['freehand']);
    this.abilities = {
      scoreMult: 1,
      waveInkBonus: 0,
    };
    // Currently equipped active ability:
    // { id, name, icon, cooldown, trigger(), _cdRemaining }
    this.activeAbility = null;
    // Time-stop state.
    this._timeStopUntil = 0;
    this._timeStopStashSpeed = null;
    this.dialogueQueue = [];
    this.currentDialogue = null;
    this.pausedForDialogue = false;
    this._stashedSpeed = null;
    this._origColors = JSON.parse(JSON.stringify(CONFIG.COLORS));
    this._perkSelectionOpen = false;

    // Performance tracking
    this.perf = {
      missilesDestroyed: 0,
      missilesDestroyedThisChapter: 0,
      citiesLostThisChapter: 0,
      lastAdaptCheck: 0,
    };

    this._loadProgress();
    this._buildUI();
    this._wireHooks();
  }

  _buildUI() {
    const container = document.getElementById('game-container');

    // Dialogue box.
    if (!document.getElementById('story-dialogue')) {
      const dlg = document.createElement('div');
      dlg.id = 'story-dialogue';
      dlg.className = 'story-dialogue hidden';
      dlg.innerHTML = `
                <div class="story-dlg-inner">
                  <div class="story-dlg-name"></div>
                  <div class="story-dlg-text"></div>
                  <div class="story-dlg-hint">▸ click or press SPACE/ENTER</div>
                </div>`;
      container.appendChild(dlg);
      dlg.addEventListener('click', () => this.advanceDialogue());
    }
    this.dlgEl = document.getElementById('story-dialogue');
    this.dlgNameEl = this.dlgEl.querySelector('.story-dlg-name');
    this.dlgTextEl = this.dlgEl.querySelector('.story-dlg-text');

    // Chapter banner.
    if (!document.getElementById('story-banner')) {
      const banner = document.createElement('div');
      banner.id = 'story-banner';
      banner.className = 'story-banner hidden';
      container.appendChild(banner);
    }
    this.bannerEl = document.getElementById('story-banner');

    // Perk selection overlay.
    if (!document.getElementById('perk-overlay')) {
      const perkO = document.createElement('div');
      perkO.id = 'perk-overlay';
      perkO.className = 'overlay hidden';
      perkO.innerHTML = `
                <div id="perk-content">
                  <h1 id="perk-title">LEVEL UP — Choose Your Path</h1>
                  <p id="perk-subtitle">Select one perk to apply to your campaign.</p>
                  <div id="perk-cards"></div>
                  <div class="perk-skip">
                    <button id="perk-skip-button">Skip (no perk)</button>
                  </div>
                </div>`;
      container.appendChild(perkO);
      document
        .getElementById('perk-skip-button')
        .addEventListener('click', () => this._onPerkPicked(null));
    }
    this.perkOverlay = document.getElementById('perk-overlay');
    this.perkCardsEl = document.getElementById('perk-cards');

    // Story progress badge (top-right corner during play).
    if (!document.getElementById('story-progress')) {
      const sp = document.createElement('div');
      sp.id = 'story-progress';
      sp.className = 'story-progress hidden';
      container.appendChild(sp);
    }
    this.progressEl = document.getElementById('story-progress');
    // Active ability button (in speed-control bar).
    const speedCtrl = document.getElementById('speed-control');
    if (speedCtrl && !document.getElementById('ability-button')) {
      const btn = document.createElement('button');
      btn.id = 'ability-button';
      btn.style.cssText =
        'background:transparent;color:#ffcc44;border:1px solid #ffcc44;padding:4px 12px;font-size:12px;font-family:inherit;cursor:pointer;border-radius:3px;font-weight:bold;display:none;';
      btn.title = 'Trigger active ability [A]';
      // Insert before the exit button if present (so ability button sits
      // among the other controls), otherwise just append. The
      // clear-defenses-button used to live here but was moved to the
      // draw-tools row, so we can't reference it as an anchor anymore.
      const anchor = document.getElementById('exit-to-menu-button');
      if (anchor && anchor.parentNode === speedCtrl) {
        speedCtrl.insertBefore(btn, anchor);
      } else {
        speedCtrl.appendChild(btn);
      }
      btn.addEventListener('click', () => this.triggerActiveAbility());
    }
    // 'A' hotkey to trigger active ability.
    window.addEventListener('keydown', (e) => {
      if (!this.activeAbility) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        this.triggerActiveAbility();
      }
    });

    // Story start button on main menu.
    const overlayContent = document.getElementById('overlay-content');
    if (overlayContent && !document.getElementById('story-button')) {
      const btn = document.createElement('button');
      btn.id = 'story-button';
      btn.textContent = 'Story Mode';
      btn.title = 'Begin the narrative campaign';
      const settingsBtn = document.getElementById('howtoplay-button');
      if (settingsBtn) {
        settingsBtn.parentNode.insertBefore(btn, settingsBtn);
      } else {
        overlayContent.appendChild(btn);
      }
      btn.addEventListener('click', () => this.startStory());
    }

    // Keyboard advance.
    window.addEventListener('keydown', (e) => {
      if (!this.currentDialogue) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        this.advanceDialogue();
      }
    });
  }

  _wireHooks() {
    const sim = this.game.simulation;
    const origDestroy = sim.onMissileDestroyed;
    sim.onMissileDestroyed = () => {
      this.perf.missilesDestroyed++;
      this.perf.missilesDestroyedThisChapter++;
      // Apply score multiplier ability.
      if (this.enabled && this.abilities.scoreMult > 1) {
        // The default onMissileDestroyed adds 10; we'll add the bonus.
        const bonus = Math.round(10 * (this.abilities.scoreMult - 1));
        this.game.hud.addScore(bonus);
      }
      if (origDestroy) origDestroy();
    };
    const origCity = sim.onCityHit;
    sim.onCityHit = (x, y, attacker) => {
      this.perf.citiesLostThisChapter++;
      if (origCity) origCity(x, y, attacker);
    };
    // Also boost return-fire scoring if ability is active.
    const origRet = sim.onMissileReturn;
    sim.onMissileReturn = (x, y, kind) => {
      if (this.enabled && this.abilities.scoreMult > 1) {
        const base = kind === 'ricochet' ? 50 : 20;
        const bonus = Math.round(base * (this.abilities.scoreMult - 1));
        this.game.hud.addScore(bonus);
      }
      if (origRet) origRet(x, y, kind);
    };
  }

  _loadProgress() {
    // Story unlocks are session-only by default (don't persist between
    // story runs, since perks define the run). We still expose a slot.
    const saved = loadJSON(STORAGE_KEY, null);
    if (saved && saved.lastCompletedChapter != null) {
      this.lastCompletedChapter = saved.lastCompletedChapter;
    }
  }

  _saveProgress() {
    saveJSON(STORAGE_KEY, {
      lastCompletedChapter: this.chapterIndex,
    });
  }

  isActive() {
    return this.enabled;
  }

  startStory() {
    Logger.info('Story: starting story mode.');
    this.enabled = true;
    this.chapterIndex = -1;
    this.unlockedPatterns = new Set(['glider']);
    // Reset tool unlocks: story mode starts with only freehand.
    this.unlockedTools = new Set(['freehand']);
    this.acquiredPerks = [];
    this.abilities = { scoreMult: 1, waveInkBonus: 0 };
    this.activeAbility = null;
    this._updateAbilityButton();
    this.perf.missilesDestroyed = 0;
    this.perf.missilesDestroyedThisChapter = 0;
    this.perf.citiesLostThisChapter = 0;

    // Reset pattern dropdown to base presets.
    this._resetPatternDropdown();
    // Refresh DOM tool-lock state.
    if (this.drawTools && this.drawTools.refreshToolLockState) {
      this.drawTools.storyEngine = this;
      this.drawTools.refreshToolLockState();
      if (this.drawTools.refreshPatternLockState) {
        this.drawTools.refreshPatternLockState();
      }
    }

    this.game.startGame();
    if (this.progressEl) this.progressEl.classList.remove('hidden');
    this._enterChapter(0);
  }

  stopStory() {
    this.enabled = false;
    this.chapter = null;
    this.chapterIndex = -1;
    this.dialogueQueue = [];
    this._hideDialogue();
    this._restoreColors();
    if (this.progressEl) this.progressEl.classList.add('hidden');
    if (this.drawTools && this.drawTools.refreshToolLockState) {
      this.drawTools.refreshToolLockState();
      if (this.drawTools.refreshPatternLockState) {
        this.drawTools.refreshPatternLockState();
      }
    }
  }

  _enterChapter(idx) {
    if (idx >= CHAPTERS.length) {
      Logger.info('Story: completed all chapters.');
      this.stopStory();
      this.game.gameOver();
      return;
    }
    this.chapterIndex = idx;
    this.chapter = CHAPTERS[idx];
    this.chapterStartTime = performance.now();
    this.chapterStartScore = this.game.hud.score;
    this.chapterStartCities = this.game.cities.aliveCount();
    this.chapterStartWave = this.game.hud.wave;
    this.perf.citiesLostThisChapter = 0;
    this.perf.missilesDestroyedThisChapter = 0;
    Logger.info(`Story: entering "${this.chapter.title}".`);
    // Tool unlocks by chapter index:
    //   Ch1 (idx 0): freehand only
    //   Ch2 (idx 1): + line
    //   Ch3+ (idx 2+): + pattern
    if (idx >= 0) this.unlockedTools.add('freehand');
    if (idx >= 1) this.unlockedTools.add('line');
    if (idx >= 2) this.unlockedTools.add('pattern');
    if (this.drawTools && this.drawTools.refreshToolLockState) {
      this.drawTools.refreshToolLockState();
    }

    // Apply config patch.
    if (this.chapter.configPatch) {
      for (const [k, v] of Object.entries(this.chapter.configPatch)) {
        CONFIG[k] = v;
      }
    }
    // Apply theme.
    this._applyTheme(this.chapter.theme);
    // Apply wave-start ink bonus from abilities.
    if (this.abilities.waveInkBonus > 0) {
      this.game.defenses.refill(this.abilities.waveInkBonus);
    }
    this._saveProgress();
    this._updateProgressBadge();

    this._showBanner(this.chapter.title);
    this.dialogueQueue = [...this.chapter.dialogues];
    setTimeout(() => this.advanceDialogue(), 700);
  }

  _applyTheme(themeName) {
    const t = THEMES[themeName] || THEMES.dawn;
    CONFIG.COLORS.BACKGROUND = t.background;
    CONFIG.COLORS.MIDLINE = t.midline;
    CONFIG.COLORS.DEFENSE_VARIANTS = [...t.defense];
    CONFIG.COLORS.MISSILE_VARIANTS = [...t.missile];
    document.body.style.backgroundColor = t.bodyBg;
    const gc = document.getElementById('game-container');
    if (gc) gc.style.boxShadow = `0 0 30px ${t.dialogBorder}66`;
    if (this.dlgEl) {
      this.dlgEl.style.borderColor = t.dialogBorder;
      this.dlgEl.style.boxShadow = `0 0 25px ${t.dialogBorder}66`;
      this.dlgEl.style.color = t.dialogText;
    }
    if (this.bannerEl) {
      this.bannerEl.style.color = t.dialogBorder;
      this.bannerEl.style.borderColor = t.dialogBorder;
      this.bannerEl.style.textShadow = `0 0 10px ${t.dialogBorder}`;
    }
  }

  _restoreColors() {
    CONFIG.COLORS = JSON.parse(JSON.stringify(this._origColors));
    document.body.style.backgroundColor = '';
    const gc = document.getElementById('game-container');
    if (gc) gc.style.boxShadow = '';
  }

  unlockPattern(name) {
    if (this.unlockedPatterns.has(name)) return false;
    this.unlockedPatterns.add(name);
    // Inject pattern data if from STORY_PATTERNS.
    if (STORY_PATTERNS[name] && this.drawTools) {
      const ref = this.drawTools.constructor.PATTERN_PRESETS_REF;
      if (ref && !ref[name]) ref[name] = STORY_PATTERNS[name];
    }
    // Unlocking any pattern implies pattern mode is also available.
    this.unlockedTools.add('pattern');
    if (this.drawTools && this.drawTools.refreshToolLockState) {
      this.drawTools.refreshToolLockState();
    }
    this._refreshPatternDropdown();
    return true;
  }

  _resetPatternDropdown() {
    const sel = document.getElementById('pattern-presets');
    if (!sel) return;
    // Remove story-marked options (starting with ★).
    for (let i = sel.options.length - 1; i >= 0; i--) {
      if (sel.options[i].textContent.startsWith('★')) {
        sel.remove(i);
      }
    }
  }

  _refreshPatternDropdown() {
    const sel = document.getElementById('pattern-presets');
    if (!sel) return;
    const existing = new Set();
    for (const opt of sel.options) existing.add(opt.value);
    for (const name of this.unlockedPatterns) {
      if (!existing.has(name)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = '★ ' + (PATTERN_NAMES[name] || name);
        sel.appendChild(opt);
      }
    }
    // Re-sync the combobox display in case the active preset was just added.
    if (this.drawTools && this.drawTools._syncPresetCombobox) {
      this.drawTools._syncPresetCombobox();
    }
  }

  advanceDialogue() {
    if (this.currentDialogue) {
      this._hideDialogue();
      this.currentDialogue = null;
    }
    if (this.dialogueQueue.length === 0) {
      this._resumeFromDialogue();
      return;
    }
    const next = this.dialogueQueue.shift();
    this._showDialogue(next);
  }

  _showDialogue(d) {
    if (!this.dlgEl) return;
    this.currentDialogue = d;
    const sp = SPEAKERS[d.speaker] || SPEAKERS.NARRATOR;
    this.dlgNameEl.textContent = sp.name || '';
    this.dlgNameEl.style.color = sp.color;
    this.dlgTextEl.textContent = d.text;
    this.dlgEl.classList.remove('hidden');
    if (!this.pausedForDialogue) {
      this._stashedSpeed = CONFIG.SPEED_MULTIPLIER;
      CONFIG.SPEED_MULTIPLIER = 0;
      this.pausedForDialogue = true;
    }
  }

  _hideDialogue() {
    if (this.dlgEl) this.dlgEl.classList.add('hidden');
  }

  _resumeFromDialogue() {
    if (this.pausedForDialogue) {
      CONFIG.SPEED_MULTIPLIER = this._stashedSpeed != null ? this._stashedSpeed : 1.0;
      this.pausedForDialogue = false;
      this._stashedSpeed = null;
    }
  }

  _showBanner(text) {
    if (!this.bannerEl) return;
    this.bannerEl.textContent = text;
    this.bannerEl.classList.remove('hidden');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => {
      this.bannerEl.classList.add('hidden');
    }, 3500);
  }

  _updateProgressBadge() {
    if (!this.progressEl) return;
    const ch = this.chapter ? this.chapter.title : '';
    const theme = this.chapter ? THEMES[this.chapter.theme] || THEMES.dawn : THEMES.dawn;
    const perkList = this.acquiredPerks.length
      ? this.acquiredPerks.map((id) => (PERKS[id] && PERKS[id].icon) || '•').join(' ')
      : '—';
    this.progressEl.innerHTML = `
            <div class="sp-chap">${ch}</div>
            <div class="sp-perks" title="Acquired perks">${perkList}</div>`;
    this.progressEl.style.borderColor = theme.dialogBorder;
    this.progressEl.style.color = theme.dialogText;
  }

  // ---------------- PERK SELECTION ----------------

  _offerPerks() {
    if (this._perkSelectionOpen) return;
    if (!this.chapter || !this.chapter.perkChoices) {
      // No perks for this chapter — just advance.
      this._enterChapter(this.chapterIndex + 1);
      return;
    }
    this._perkSelectionOpen = true;
    // Pause game.
    this._perkStashedSpeed = CONFIG.SPEED_MULTIPLIER;
    CONFIG.SPEED_MULTIPLIER = 0;

    // Pick 3 random perks from the chapter pool (one per category if possible).
    const pool = this.chapter.perkChoices;
    const picks = [];
    const tryPick = (list) => {
      const filtered = list.filter((id) => {
        const p = PERKS[id];
        if (!p) return false;
        if (p.type === 'PATTERN') {
          // Pattern name from id: pat_xxx → unlockPattern logic uses STORY_PATTERNS
          // We need to check based on the apply target; we'll just allow re-picks.
          return !this._patternPerkAlreadyOwned(id);
        }
        return true;
      });
      if (filtered.length === 0) return null;
      return filtered[Math.floor(Math.random() * filtered.length)];
    };
    const used = new Set();
    // Try one from each category for variety.
    for (const cat of ['patterns', 'abilities', 'stats']) {
      const list = (pool[cat] || []).filter((id) => !used.has(id));
      const id = tryPick(list);
      if (id) {
        picks.push(id);
        used.add(id);
      }
    }
    // Fill to 3 from any pool if some categories were exhausted.
    while (picks.length < 3) {
      const all = [
        ...(pool.patterns || []),
        ...(pool.stats || []),
        ...(pool.abilities || []),
      ].filter((id) => !used.has(id));
      const id = tryPick(all);
      if (!id) break;
      picks.push(id);
      used.add(id);
    }

    if (picks.length === 0) {
      // Nothing to offer.
      this._perkSelectionOpen = false;
      CONFIG.SPEED_MULTIPLIER = this._perkStashedSpeed || 1.0;
      this._enterChapter(this.chapterIndex + 1);
      return;
    }

    this._renderPerkCards(picks);
    this.perkOverlay.classList.remove('hidden');
  }

  _patternPerkAlreadyOwned(perkId) {
    // Map perk id -> pattern name by inspecting apply() — simpler: maintain a table.
    const map = {
      pat_blinker: 'blinker',
      pat_block: 'block',
      pat_toad: 'toad',
      pat_beacon: 'beacon',
      pat_lwss: 'lwss',
      pat_mwss: 'ship_mwss',
      pat_hwss: 'ship_hwss',
      pat_pulsar: 'pulsar',
      pat_rpent: 'rpentomino',
      pat_acorn: 'acorn',
      pat_diehard: 'diehard',
      pat_pentadeca: 'penta_decathlon',
      pat_copperhead: 'copperhead',
      pat_gun: 'gosper_gun',
    };
    const n = map[perkId];
    return n && this.unlockedPatterns.has(n);
  }

  // Check if a given ability perk id is enabled in settings.
  _isAbilityEnabled(perkId) {
    const map = {
      ab_double_score: 'ABILITY_DOUBLE_SCORE',
      ab_no_dry: 'ABILITY_NO_DRY',
      ab_wave_bonus: 'ABILITY_WAVE_BONUS',
      ab_safe_zone: 'ABILITY_SAFE_ZONE',
      ab_slow_missiles: 'ABILITY_SLOW_MISSILES',
      ab_emp_burst: 'ABILITY_EMP_BURST',
      ab_ink_surge: 'ABILITY_INK_SURGE',
      ab_freeze: 'ABILITY_FREEZE',
    };
    const cfgKey = map[perkId];
    if (!cfgKey) return true; // unknown ability — leave enabled
    return CONFIG[cfgKey] !== false;
  }

  _renderPerkCards(perkIds) {
    this.perkCardsEl.innerHTML = '';
    const theme = this.chapter ? THEMES[this.chapter.theme] || THEMES.dawn : THEMES.dawn;
    for (const pid of perkIds) {
      const p = PERKS[pid];
      if (!p) continue;
      const card = document.createElement('div');
      card.className = `perk-card perk-${p.type.toLowerCase()}`;
      card.style.borderColor = theme.dialogBorder;
      card.innerHTML = `
                <div class="perk-icon">${p.icon}</div>
                <div class="perk-type">${p.type}</div>
                <div class="perk-name">${p.name}</div>
                <div class="perk-desc">${p.desc}</div>`;
      card.addEventListener('click', () => this._onPerkPicked(pid));
      this.perkCardsEl.appendChild(card);
    }
  }

  _onPerkPicked(perkId) {
    if (!this._perkSelectionOpen) return;
    this._perkSelectionOpen = false;
    this.perkOverlay.classList.add('hidden');
    if (perkId) {
      const p = PERKS[perkId];
      if (p) {
        Logger.info(`Story: perk acquired: ${p.name}`);
        try {
          p.apply(this);
        } catch (e) {
          Logger.error('Perk apply failed', e);
        }
        this.acquiredPerks.push(perkId);
        this._updateProgressBadge();
        // Floater on-screen.
        if (this.game.renderer) {
          this.game.renderer.addBigFloater(
            Math.floor(this.game.grid.width / 2),
            Math.floor(this.game.grid.height / 3),
            `${p.icon} ${p.name}`,
            THEMES[this.chapter.theme]?.dialogBorder || '#ffcc44',
            1.6
          );
        }
      }
    }
    // Restore speed and advance.
    CONFIG.SPEED_MULTIPLIER = this._perkStashedSpeed != null ? this._perkStashedSpeed : 1.0;
    this._perkStashedSpeed = null;
    this._enterChapter(this.chapterIndex + 1);
  }

  // ---------------- ACTIVE ABILITY MANAGEMENT ----------------

  setActiveAbility(ab) {
    this.activeAbility = { ...ab, _cdRemaining: 0 };
    this._updateAbilityButton();
  }

  triggerActiveAbility() {
    if (!this.activeAbility) return false;
    if (this.activeAbility._cdRemaining > 0) {
      if (this.game.renderer) {
        this.game.renderer.addBigFloater(
          Math.floor(this.game.grid.width / 2),
          Math.floor(this.game.grid.height / 3),
          `COOLDOWN ${Math.ceil(this.activeAbility._cdRemaining)}s`,
          '#ff8888',
          1.2
        );
      }
      return false;
    }
    const ok = this.activeAbility.trigger();
    if (ok) {
      this.activeAbility._cdRemaining = this.activeAbility.cooldown;
      if (this.game.renderer) {
        this.game.renderer.addBigFloater(
          Math.floor(this.game.grid.width / 2),
          Math.floor(this.game.grid.height / 3),
          `${this.activeAbility.icon} ${this.activeAbility.name}`,
          '#ffcc44',
          1.6
        );
      }
      this._updateAbilityButton();
    }
    return ok;
  }

  beginTimeStop(seconds) {
    // Freeze only the enemy: missiles stop moving / aging / spawning.
    // Defenses continue to evolve so the player can still maneuver them.
    this._timeStopUntil = performance.now() + seconds * 1000;
    if (this.game.simulation) this.game.simulation.freezeEnemies = true;
    if (this.game.missiles) this.game.missiles.frozen = true;
    if (this.game.renderer) {
      this.game.renderer.addBigFloater(
        Math.floor(this.game.grid.width / 2),
        Math.floor(this.game.grid.height / 3),
        '⏱ ENEMIES FROZEN',
        '#88ccff',
        1.6
      );
    }
  }

  _updateAbilityButton() {
    const btn = document.getElementById('ability-button');
    if (!btn) return;
    if (!this.activeAbility) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = '';
    const cd = this.activeAbility._cdRemaining || 0;
    if (cd > 0) {
      btn.disabled = true;
      btn.textContent = `${this.activeAbility.icon} ${this.activeAbility.name} (${Math.ceil(cd)}s)`;
    } else {
      btn.disabled = false;
      btn.textContent = `${this.activeAbility.icon} ${this.activeAbility.name} [A]`;
    }
  }

  // ---------------- TICK / TRIGGERS ----------------

  update(dt) {
    if (!this.enabled || !this.chapter) return;
    // Tick active ability cooldown regardless of dialogue state.
    if (this.activeAbility && this.activeAbility._cdRemaining > 0) {
      this.activeAbility._cdRemaining = Math.max(0, this.activeAbility._cdRemaining - dt / 1000);
      this._updateAbilityButton();
    }
    // Handle time-stop expiration.
    if (this._timeStopUntil > 0 && performance.now() >= this._timeStopUntil) {
      this._timeStopUntil = 0;
      if (this.game.simulation) this.game.simulation.freezeEnemies = false;
      if (this.game.missiles) this.game.missiles.frozen = false;
      if (this.game.renderer) {
        this.game.renderer.addBigFloater(
          Math.floor(this.game.grid.width / 2),
          Math.floor(this.game.grid.height / 3),
          '⏱ TIME RESUMES',
          '#88ccff',
          1.4
        );
      }
    }
    if (this.currentDialogue || this.dialogueQueue.length > 0) return;
    if (this._perkSelectionOpen) return;

    const now = performance.now();
    if (now - this.perf.lastAdaptCheck > 3000) {
      this.perf.lastAdaptCheck = now;
      this._adaptDifficulty();
    }

    const t = this.chapter.trigger;
    const elapsed = now - this.chapterStartTime;
    let fire = false;
    if (t.immediate) fire = true;
    else if (t.wave != null && this.game.hud.wave >= t.wave) fire = true;
    else if (t.score != null && this.game.hud.score >= t.score) fire = true;
    else if (t.cityLost && this.perf.citiesLostThisChapter > 0) fire = true;
    else if (t.kills != null && this.perf.missilesDestroyedThisChapter >= t.kills) fire = true;
    else if (t.timer != null && elapsed >= t.timer) fire = true;

    if (fire) {
      // Clear trigger immediately so we don't re-fire while dialog plays.
      this.chapter = { ...this.chapter, trigger: {} };
      // After a short pause, offer perk selection (which then advances).
      setTimeout(() => this._offerPerks(), 500);
    }
  }

  _adaptDifficulty() {
    if (!this.chapter) return;
    const cities = this.game.cities.aliveCount();
    const startCities = this.chapterStartCities || 1;
    const cityRatio = cities / Math.max(1, startCities);
    const ink = this.game.defenses.ink;
    const inkRatio = ink / Math.max(1, CONFIG.MAX_INK);
    const wavesIn = this.game.hud.wave - this.chapterStartWave;

    const struggling = cityRatio < 0.6 || (inkRatio < 0.15 && wavesIn >= 1);
    const dominating = cityRatio >= 1.0 && inkRatio > 0.7 && wavesIn >= 2;

    if (struggling) {
      CONFIG.INK_REGEN_RATE = Math.min(3.0, CONFIG.INK_REGEN_RATE + 0.1);
      CONFIG.MISSILE_SPAWN_INTERVAL = Math.min(2500, CONFIG.MISSILE_SPAWN_INTERVAL + 40);
      CONFIG.MAX_INK = Math.min(800, CONFIG.MAX_INK + 10);
      Logger.debug(
        `Story: easing (cityRatio=${cityRatio.toFixed(2)}, ink=${inkRatio.toFixed(2)}).`
      );
    } else if (dominating) {
      CONFIG.INK_REGEN_RATE = Math.max(0.3, CONFIG.INK_REGEN_RATE - 0.05);
      CONFIG.MISSILE_SPAWN_INTERVAL = Math.max(
        CONFIG.MISSILE_SPAWN_MIN,
        CONFIG.MISSILE_SPAWN_INTERVAL - 30
      );
      CONFIG.MISSILES_PER_WAVE_INC = Math.min(8, CONFIG.MISSILES_PER_WAVE_INC + 1);
      Logger.debug(
        `Story: ramping (cityRatio=${cityRatio.toFixed(2)}, ink=${inkRatio.toFixed(2)}).`
      );
    }
  }
}
