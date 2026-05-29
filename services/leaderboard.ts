import { LEADERBOARD_URL } from '../constants/config';

export type LeaderboardEntry = {
  rank: number;
  wallet: string;
  score: number;
  rounds: number;
};

export type SubmitPayload = {
  wallet: string;
  seasonId: number;
  // v2: the leaderboard category (game-mode slug). Omitted ⇒ v1 ⇒ "classic" bucket.
  category?: string;
  score: number;
  hits: number;
  misses: number;
  accuracy: number;
  durationMs: number;
  nonce: string;
  // base64 signature of the canonical message produced by buildScoreMessage().
  signature: string;
};

// Canonical message format used for signing. The backend recomputes the same
// string from the submitted fields and verifies the signature against the wallet.
// v2 (with `category`) binds the category into the signature so a score signed
// for one mode can't be replayed into another; v1 (no category) is unchanged and
// stays valid forever (legacy + the "classic" bucket).
export function buildScoreMessage(p: {
  wallet: string;
  seasonId: number;
  category?: string;
  score: number;
  hits: number;
  misses: number;
  durationMs: number;
  nonce: string;
}): Uint8Array {
  const canonical = p.category
    ? `tapclash/v2\n` +
      `wallet=${p.wallet}\n` +
      `season=${p.seasonId}\n` +
      `category=${p.category}\n` +
      `score=${p.score}\n` +
      `hits=${p.hits}\n` +
      `misses=${p.misses}\n` +
      `dur=${p.durationMs}\n` +
      `nonce=${p.nonce}`
    : `tapclash/v1\n` +
      `wallet=${p.wallet}\n` +
      `season=${p.seasonId}\n` +
      `score=${p.score}\n` +
      `hits=${p.hits}\n` +
      `misses=${p.misses}\n` +
      `dur=${p.durationMs}\n` +
      `nonce=${p.nonce}`;
  return new TextEncoder().encode(canonical);
}

export type SubmitResponse =
  | { ok: true; rank?: number }
  // retryable=true → transient (network / 5xx), worth queuing for a later flush.
  // retryable=false → server rejected it permanently (4xx: bad data, bad sig,
  // or 409 nonce already counted) — never queue, it will never succeed.
  | { ok: false; retryable: boolean; error?: string };

// fetch() has no timeout in React Native, so an unreachable or slow backend
// would otherwise hang a request forever (e.g. the "Submitting score…" banner
// never resolving). Abort after a bounded wait so callers fall back gracefully
// to the offline retry queue instead of getting stuck.
const REQUEST_TIMEOUT_MS = 8000;

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function submitScore(payload: SubmitPayload): Promise<SubmitResponse> {
  if (!LEADERBOARD_URL) return { ok: false, retryable: true, error: 'no_backend_configured' };
  try {
    const res = await fetchWithTimeout(`${LEADERBOARD_URL}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const body = await res.json();
      return { ok: true, rank: body.rank };
    }
    let error: string | undefined;
    try {
      error = (await res.json())?.error;
    } catch {
      // non-JSON error body
    }
    return { ok: false, retryable: res.status >= 500, error };
  } catch (e) {
    console.warn('submitScore failed:', e);
    return { ok: false, retryable: true };
  }
}

// Returns null on failure (offline / backend unreachable) so callers can tell a
// genuinely empty season from a network error. An empty array means "no scores".
export async function fetchLeaderboard(seasonId: number, category?: string): Promise<LeaderboardEntry[] | null> {
  if (!LEADERBOARD_URL) return null;
  // v2 routes to the per-category board; omit ⇒ legacy "classic" board (v1 route).
  const path = category ? `/leaderboard/${seasonId}/${category}` : `/leaderboard/${seasonId}`;
  try {
    const res = await fetchWithTimeout(`${LEADERBOARD_URL}${path}`);
    if (!res.ok) return null;
    const body = await res.json();
    return body.entries ?? [];
  } catch (e) {
    console.warn('fetchLeaderboard failed:', e);
    return null;
  }
}

export async function fetchPlayerStats(
  seasonId: number,
  wallet: string,
  category?: string
): Promise<{ bestScore: number; rank: number | null; rounds: number } | null> {
  if (!LEADERBOARD_URL) return null;
  const path = category ? `/players/${seasonId}/${category}/${wallet}` : `/players/${seasonId}/${wallet}`;
  try {
    const res = await fetchWithTimeout(`${LEADERBOARD_URL}${path}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}
