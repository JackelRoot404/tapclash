// Program identity, PDA seeds, and address derivations for tapclash_pools.

import { PublicKey } from '@solana/web3.js';
import idl from '../idl/tapclash_pools.json';

/** Deployed program id (from the built IDL — devnet & localnet share it). */
export const PROGRAM_ID = new PublicKey(idl.address);

export const SEASON_SEED = Buffer.from('season');
export const VAULT_SEED = Buffer.from('vault');
export const ENTRY_SEED = Buffer.from('entry');

/** seasonId as a 4-byte little-endian buffer — matches `u32::to_le_bytes()`. */
export function seasonIdToBytes(seasonId: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(seasonId >>> 0, 0);
  return b;
}

export function seasonPda(seasonId: number, programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEASON_SEED, seasonIdToBytes(seasonId)], programId);
}

export function vaultPda(seasonId: number, programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([VAULT_SEED, seasonIdToBytes(seasonId)], programId);
}

export function entryPda(
  seasonId: number,
  player: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ENTRY_SEED, seasonIdToBytes(seasonId), player.toBuffer()],
    programId,
  );
}

/** Address-only convenience wrappers (drop the bump). */
export const seasonAddress = (s: number, p?: PublicKey) => seasonPda(s, p)[0];
export const vaultAddress = (s: number, p?: PublicKey) => vaultPda(s, p)[0];
export const entryAddress = (s: number, player: PublicKey, p?: PublicKey) => entryPda(s, player, p)[0];

/**
 * Default top-10 payout split in basis points (10000 = 100%). MUST stay in sync
 * with the app's `utils/season.ts → PAYOUT_SPLIT_BPS`. Re-exported here so the
 * SDK/tests are self-contained; the app passes its own array to initSeasonIx().
 */
export const DEFAULT_PAYOUT_BPS: number[] = [4000, 2000, 1200, 800, 500, 400, 300, 300, 300, 200];
