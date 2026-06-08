// Shared constants for the LevelDesigner and its sub-modules.

export const DESIGNER_MODE = {
  CITY: 'city',
  DEFENSE: 'defense',
  BASE: 'base',
  PATTERN: 'pattern',
  SPAWNER: 'spawner',
  LINE: 'line',
  FILL: 'fill',
};

// Preview RGB tuples keyed by paint-target id.
export const PREVIEW_RGB_BY_TARGET = {
  defense: '0, 255, 200',
  enemy: '255, 60, 80',
  barrier: '180, 180, 180',
  fire: '255, 120, 40',
  erase: '255, 80, 80',
};

// Map a numeric setting key → its "UNLIMITED_*" boolean toggle key.
export const UNLIMITED_KEY_MAP = {
  MAX_INK: 'UNLIMITED_MAX_INK',
  INK_REGEN_RATE: 'UNLIMITED_INK_REGEN',
  MISSILE_CASCADE_TICKS: 'UNLIMITED_MISSILE_CASCADE',
  DEFENSE_AGE_FRIENDLY: 'UNLIMITED_DEF_AGE_FRIENDLY',
  DEFENSE_AGE_ENEMY: 'UNLIMITED_DEF_AGE_ENEMY',
  DEFENSE_AGE_NEUTRAL: 'UNLIMITED_DEF_AGE_NEUTRAL',
  MISSILE_AGE_FRIENDLY: 'UNLIMITED_MISS_AGE_FRIENDLY',
  MISSILE_AGE_ENEMY: 'UNLIMITED_MISS_AGE_ENEMY',
  MISSILE_AGE_NEUTRAL: 'UNLIMITED_MISS_AGE_NEUTRAL',
};
