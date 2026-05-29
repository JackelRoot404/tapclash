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
