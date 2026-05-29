// Account decoders for tapclash_pools. Hand-rolled against the fixed Borsh
// layouts (verified by the LiteSVM tests), so reading on-chain state needs no
// Anchor runtime in the app. Each decoder checks the 8-byte account
// discriminator from the IDL before deserializing.

import idl from '../idl/tapclash_pools.json';
import { Reader } from './borsh';
import { MAX_WINNERS, type SeasonAccount, type EntryAccount, type VaultAccount } from './types';

function discriminatorFor(accountName: string): Uint8Array {
  const acc = (idl.accounts as Array<{ name: string; discriminator: number[] }>).find(
    (a) => a.name === accountName,
  );
  if (!acc) throw new Error(`unknown account ${accountName}`);
  return Uint8Array.from(acc.discriminator);
}

function checkDiscriminator(data: Uint8Array, accountName: string): void {
  const expected = discriminatorFor(accountName);
  for (let i = 0; i < 8; i++) {
    if (data[i] !== expected[i]) throw new Error(`not a ${accountName} account (discriminator mismatch)`);
  }
}

export function decodeSeason(data: Uint8Array): SeasonAccount {
  checkDiscriminator(data, 'Season');
  const r = new Reader(data).skip(8);
  const authority = r.pubkey();
  const seasonId = r.u32();
  const entryFee = r.u64();
  const poolTotal = r.u64();
  const finalPool = r.u64();
  const entrants = r.u32();
  const numWinners = r.u8();
  const finalized = r.bool();
  const swept = r.bool();
  const payoutBps: number[] = [];
  for (let i = 0; i < MAX_WINNERS; i++) payoutBps.push(r.u16());
  const winners = [];
  for (let i = 0; i < MAX_WINNERS; i++) winners.push(r.pubkey());
  const bump = r.u8();
  const vaultBump = r.u8();
  return {
    authority,
    seasonId,
    entryFee,
    poolTotal,
    finalPool,
    entrants,
    numWinners,
    finalized,
    swept,
    payoutBps,
    winners,
    bump,
    vaultBump,
  };
}

export function decodeEntry(data: Uint8Array): EntryAccount {
  checkDiscriminator(data, 'Entry');
  const r = new Reader(data).skip(8);
  return {
    player: r.pubkey(),
    seasonId: r.u32(),
    bestScore: r.u64(),
    paid: r.bool(),
    claimed: r.bool(),
    bump: r.u8(),
  };
}

export function decodeVault(data: Uint8Array): VaultAccount {
  checkDiscriminator(data, 'Vault');
  const r = new Reader(data).skip(8);
  return {
    seasonId: r.u32(),
    bump: r.u8(),
  };
}
