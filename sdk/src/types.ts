// Shared types + constants for the tapclash_pools SDK.

import type { PublicKey } from '@solana/web3.js';

export const MAX_WINNERS = 10;
export const BPS_DENOMINATOR = 10_000;

export type SeasonAccount = {
  authority: PublicKey;
  seasonId: number;
  entryFee: bigint;
  poolTotal: bigint;
  finalPool: bigint;
  entrants: number;
  numWinners: number;
  finalized: boolean;
  swept: boolean;
  payoutBps: number[]; // length 10
  winners: PublicKey[]; // length 10 (default-keyed past numWinners)
  bump: number;
  vaultBump: number;
};

export type EntryAccount = {
  player: PublicKey;
  seasonId: number;
  bestScore: bigint;
  paid: boolean;
  claimed: boolean;
  bump: number;
};

export type VaultAccount = {
  seasonId: number;
  bump: number;
};

/** floor(pool * bps / 10000) — the exact lamport payout for a given rank's bps. */
export function payoutFor(pool: bigint, bps: number): bigint {
  return (pool * BigInt(bps)) / BigInt(BPS_DENOMINATOR);
}
