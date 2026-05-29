// Seasons run calendar-month long. Season id = YYYYMM as integer.
// This lets every client agree on the current season without a server round-trip.

export type Season = {
  id: number;
  label: string;
  startMs: number;
  endMs: number;
};

export function currentSeason(now: Date = new Date()): Season {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed
  const start = Date.UTC(y, m, 1, 0, 0, 0, 0);
  const end = Date.UTC(y, m + 1, 1, 0, 0, 0, 0);
  const id = y * 100 + (m + 1);
  const label = now.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return { id, label, startMs: start, endMs: end };
}

export function msUntil(ts: number, now: number = Date.now()): number {
  return Math.max(0, ts - now);
}

export function formatCountdown(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

// Payout split for the top 10 finishers, in basis points of the pool
// (10000 bps = 100%). NOT percent — the v2 on-chain payout code must scale by
// bps/10000. e.g. rank 1 = 4000 bps = 40% of the pool.
export const PAYOUT_SPLIT_BPS = [4000, 2000, 1200, 800, 500, 400, 300, 300, 300, 200];

// Guard against the split silently drifting away from a full pool (and against a
// future edit reintroducing the percent-vs-bps confusion this comment fixes).
if (PAYOUT_SPLIT_BPS.reduce((a, b) => a + b, 0) !== 10000) {
  throw new Error('PAYOUT_SPLIT_BPS must sum to 10000 bps (100% of the pool)');
}
