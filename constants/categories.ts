// Leaderboard categories (v2). A "category" is one independent leaderboard
// within a season. Today there's a 1:1 mapping category ⇄ game mode, so the slug
// is the mode key. Slugs MUST match the `category=` line in the tapclash/v2
// signed message and the server bucket, and satisfy the server's
// ^[a-z0-9_-]{1,32}$ rule (the mode keys do).
import { MODES, MODE_ORDER, type GameMode } from './game';

export type CategorySlug = GameMode;

export const CATEGORIES: { slug: CategorySlug; label: string }[] = MODE_ORDER.map((m) => ({
  slug: m,
  label: MODES[m].label,
}));

// The default / legacy bucket. v1 (pre-categories) scores AND Classic-mode v2
// scores both unify here, so the existing Classic board is never split.
export const DEFAULT_CATEGORY: CategorySlug = 'classic';

export function categoryForMode(mode: GameMode): CategorySlug {
  return mode;
}

export function labelForCategory(slug: string): string {
  return (MODES as Record<string, { label: string }>)[slug]?.label ?? slug;
}
