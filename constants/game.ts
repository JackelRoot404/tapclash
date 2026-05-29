// Round duration in milliseconds.
export const ROUND_MS = 30_000;

// How long a target stays on screen before it disappears (counts as a miss).
export const TARGET_LIFETIME_MS = 1100;

// Minimum gap between target spawns. Difficulty ramps down over the round.
export const SPAWN_INTERVAL_START_MS = 700;
export const SPAWN_INTERVAL_END_MS = 280;

// Target visuals
export const TARGET_RADIUS = 38;
export const TARGET_EDGE_PADDING = 16;

// Scoring
export const HIT_POINTS = 100;
export const PERFECT_BONUS = 50; // tapped within first 250ms of appearing
export const PERFECT_WINDOW_MS = 250;
export const MISS_PENALTY = 30;
export const COMBO_STEP_BONUS = 10; // per consecutive hit
export const COMBO_MAX_BONUS = 200;

// Accuracy multiplier applied to base points at end of round:
//   final = base * (0.5 + accuracy)  -> 100% accuracy = 1.5x, 0% = 0.5x
export const ACCURACY_MIN_MULT = 0.5;
export const ACCURACY_RANGE = 1.0;

// ── Feature push: target variety + game modes ───────────────────────────────
// FROZEN-CONTRACT GUARD: the signed-score backend rejects score > 50000 and
// requires dur === 30000. Every mode/target mix below must keep the round at
// ROUND_MS and the final score within [0, MAX_SCORE]. finalScore() clamps to
// MAX_SCORE so no target combination can ever exceed it. Do NOT raise this
// without an SP3 sign-off from Agent B.
export const MAX_SCORE = 50_000;

export type TargetKind = 'normal' | 'bonus' | 'bomb' | 'mini';

export type KindConfig = {
  radius: number; // px
  lifetimeMult: number; // multiplies the active mode's baseLifetimeMs
  points: number; // clean-hit award (before perfect/combo); bomb uses BOMB_TAP_PENALTY instead
  isPenalty: boolean; // bomb: tapping it is a mistake, not a hit
  countsForAccuracy: boolean; // bombs are excluded from hits/misses
};

// Visual mapping (color/glyph) lives in components/Target.tsx — this stays pure
// gameplay numbers.
export const TARGET_KINDS: Record<TargetKind, KindConfig> = {
  normal: { radius: 38, lifetimeMult: 1.0, points: HIT_POINTS, isPenalty: false, countsForAccuracy: true },
  bonus: { radius: 33, lifetimeMult: 0.72, points: 250, isPenalty: false, countsForAccuracy: true },
  mini: { radius: 23, lifetimeMult: 1.0, points: 180, isPenalty: false, countsForAccuracy: true },
  bomb: { radius: 40, lifetimeMult: 1.15, points: 0, isPenalty: true, countsForAccuracy: false },
};

// Points lost for tapping a bomb (also resets combo; ends the round in Sudden Death).
export const BOMB_TAP_PENALTY = 160;

export type GameMode = 'classic' | 'frenzy' | 'precision' | 'sudden';

export type ModeConfig = {
  key: GameMode;
  label: string;
  blurb: string;
  spawnStartMs: number; // spawn gap at round start
  spawnEndMs: number; // spawn gap at round end (ramps between)
  baseLifetimeMs: number; // base target lifetime (× kind.lifetimeMult)
  weights: Partial<Record<TargetKind, number>>; // relative spawn weights
  perfectBonus: number; // bonus for tapping within PERFECT_WINDOW_MS
  missPenalty: number; // points lost when a good target vanishes
  suddenDeath: boolean; // a miss or a bomb tap ends the round immediately
};

export const MODES: Record<GameMode, ModeConfig> = {
  classic: {
    key: 'classic',
    label: 'Classic',
    blurb: 'The original. Tap the dots before they vanish and build combos.',
    spawnStartMs: 700,
    spawnEndMs: 280,
    baseLifetimeMs: 1100,
    weights: { normal: 78, bonus: 14, mini: 8 },
    perfectBonus: 50,
    missPenalty: 30,
    suddenDeath: false,
  },
  frenzy: {
    key: 'frenzy',
    label: 'Frenzy',
    blurb: 'Dense and fast — more targets, gold bonuses, and bombs to dodge.',
    spawnStartMs: 470,
    spawnEndMs: 165,
    baseLifetimeMs: 820,
    weights: { normal: 62, bonus: 18, mini: 12, bomb: 8 },
    perfectBonus: 50,
    missPenalty: 20,
    suddenDeath: false,
  },
  precision: {
    key: 'precision',
    label: 'Precision',
    blurb: 'Small targets, fewer of them. Accuracy and perfect taps are everything.',
    spawnStartMs: 820,
    spawnEndMs: 470,
    baseLifetimeMs: 1300,
    weights: { mini: 68, normal: 20, bonus: 12 },
    perfectBonus: 95,
    missPenalty: 60,
    suddenDeath: false,
  },
  sudden: {
    key: 'sudden',
    label: 'Sudden Death',
    blurb: 'One miss — or one bomb tap — ends the round. How long can you last?',
    spawnStartMs: 640,
    spawnEndMs: 300,
    baseLifetimeMs: 1150,
    weights: { normal: 74, bonus: 13, bomb: 13 },
    perfectBonus: 50,
    missPenalty: 0,
    suddenDeath: true,
  },
};

export const MODE_ORDER: GameMode[] = ['classic', 'frenzy', 'precision', 'sudden'];

// Weighted random pick of a target kind for a mode. `r` is a [0,1) roll.
export function pickKind(mode: ModeConfig, r: number): TargetKind {
  const entries = Object.entries(mode.weights) as [TargetKind, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = r * total;
  for (const [kind, w] of entries) {
    roll -= w;
    if (roll <= 0) return kind;
  }
  return entries[0][0];
}
