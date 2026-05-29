// Read-side helpers for the app's v2 Entry/Claim/pool UI. Pure functions over
// decoded account state — no RPC, no signing. Pair with decodeSeason/decodeEntry.

import type { PublicKey } from '@solana/web3.js';
import { payoutFor, type SeasonAccount, type EntryAccount } from './types';

/** True while the season still accepts entries (not yet finalized). */
export function isOpenForEntry(season: SeasonAccount): boolean {
  return !season.finalized;
}

/** 0-based rank of `wallet` in the finalized winner list, or null if not a winner. */
export function winnerRank(season: SeasonAccount, wallet: PublicKey): number | null {
  for (let i = 0; i < season.numWinners; i++) {
    if (season.winners[i].equals(wallet)) return i;
  }
  return null;
}

/**
 * Lamports the player can claim right now — 0 unless the season is finalized,
 * the player is a recorded winner, and they have not already claimed. Drives the
 * Profile "Claim" button: show it iff this returns > 0.
 */
export function claimableLamports(season: SeasonAccount, entry: EntryAccount): bigint {
  if (!season.finalized || entry.claimed) return 0n;
  const rank = winnerRank(season, entry.player);
  if (rank === null) return 0n;
  return payoutFor(season.finalPool, season.payoutBps[rank]);
}

/** Whether this entry has a pending (unclaimed) win in a finalized season. */
export function hasPendingClaim(season: SeasonAccount, entry: EntryAccount): boolean {
  return claimableLamports(season, entry) > 0n;
}
