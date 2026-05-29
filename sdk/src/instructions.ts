// Instruction builders for tapclash_pools.
//
// Each returns a plain @solana/web3.js v1 `TransactionInstruction` so the RN app
// can drop it into a Transaction and sign/send via Mobile Wallet Adapter — no
// Anchor Provider or Wallet object required. Account ordering matches the
// program's #[derive(Accounts)] structs exactly (the program reads positionally).

import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from '@solana/web3.js';
import idl from '../idl/tapclash_pools.json';
import { Writer } from './borsh';
import { PROGRAM_ID, seasonPda, vaultPda, entryPda } from './program';
import { MAX_WINNERS } from './types';

function discriminator(name: string): Buffer {
  const ix = (idl.instructions as Array<{ name: string; discriminator: number[] }>).find(
    (i) => i.name === name,
  );
  if (!ix) throw new Error(`unknown instruction ${name}`);
  return Buffer.from(ix.discriminator);
}

function payoutBpsBytes(payoutBps: number[]): Buffer {
  if (payoutBps.length > MAX_WINNERS) throw new Error(`payoutBps must have at most ${MAX_WINNERS} entries`);
  const w = new Writer();
  for (let i = 0; i < MAX_WINNERS; i++) w.u16(payoutBps[i] ?? 0); // pad to fixed [u16; 10]
  return w.toBuffer();
}

const ro = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: false });
const rw = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: true });

export type InitSeasonArgs = {
  authority: PublicKey;
  seasonId: number;
  entryFee: bigint | number; // lamports
  payoutBps: number[]; // up to 10 entries, sum in (0, 10000]
};

export function initSeasonIx(args: InitSeasonArgs, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  const [season] = seasonPda(args.seasonId, programId);
  const [vault] = vaultPda(args.seasonId, programId);
  const data = Buffer.concat([
    discriminator('init_season'),
    new Writer().u32(args.seasonId).u64(args.entryFee).toBuffer(),
    payoutBpsBytes(args.payoutBps),
  ]);
  return new TransactionInstruction({
    programId,
    data,
    keys: [rw(args.authority, true), rw(season), rw(vault), ro(SystemProgram.programId)],
  });
}

export type EnterArgs = { player: PublicKey; seasonId: number };

export function enterIx(args: EnterArgs, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  const [season] = seasonPda(args.seasonId, programId);
  const [vault] = vaultPda(args.seasonId, programId);
  const [entry] = entryPda(args.seasonId, args.player, programId);
  const data = Buffer.concat([discriminator('enter'), new Writer().u32(args.seasonId).toBuffer()]);
  return new TransactionInstruction({
    programId,
    data,
    keys: [rw(args.player, true), rw(season), rw(vault), rw(entry), ro(SystemProgram.programId)],
  });
}

export type SubmitScoreArgs = {
  authority: PublicKey;
  seasonId: number;
  player: PublicKey; // whose entry to attest
  score: bigint | number;
};

export function submitScoreIx(args: SubmitScoreArgs, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  const [season] = seasonPda(args.seasonId, programId);
  const [entry] = entryPda(args.seasonId, args.player, programId);
  const data = Buffer.concat([
    discriminator('submit_score'),
    new Writer().u32(args.seasonId).u64(args.score).toBuffer(),
  ]);
  return new TransactionInstruction({
    programId,
    data,
    keys: [ro(args.authority, true), ro(season), rw(entry)],
  });
}

export type FinalizeSeasonArgs = {
  authority: PublicKey;
  seasonId: number;
  /** Winner *player* pubkeys in rank order (rank 1 first), non-increasing score. */
  winners: PublicKey[];
};

export function finalizeSeasonIx(
  args: FinalizeSeasonArgs,
  programId: PublicKey = PROGRAM_ID,
): TransactionInstruction {
  if (args.winners.length > MAX_WINNERS) throw new Error(`at most ${MAX_WINNERS} winners`);
  const [season] = seasonPda(args.seasonId, programId);
  const winnerEntries = args.winners.map((w) => ro(entryPda(args.seasonId, w, programId)[0]));
  const data = Buffer.concat([discriminator('finalize_season'), new Writer().u32(args.seasonId).toBuffer()]);
  return new TransactionInstruction({
    programId,
    data,
    keys: [ro(args.authority, true), rw(season), ...winnerEntries],
  });
}

export type ClaimArgs = { player: PublicKey; seasonId: number };

export function claimIx(args: ClaimArgs, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  const [season] = seasonPda(args.seasonId, programId);
  const [vault] = vaultPda(args.seasonId, programId);
  const [entry] = entryPda(args.seasonId, args.player, programId);
  const data = Buffer.concat([discriminator('claim'), new Writer().u32(args.seasonId).toBuffer()]);
  return new TransactionInstruction({
    programId,
    data,
    keys: [rw(args.player, true), ro(season), rw(vault), rw(entry)],
  });
}

export type WithdrawUnallocatedArgs = { authority: PublicKey; seasonId: number };

export function withdrawUnallocatedIx(
  args: WithdrawUnallocatedArgs,
  programId: PublicKey = PROGRAM_ID,
): TransactionInstruction {
  const [season] = seasonPda(args.seasonId, programId);
  const [vault] = vaultPda(args.seasonId, programId);
  const data = Buffer.concat([
    discriminator('withdraw_unallocated'),
    new Writer().u32(args.seasonId).toBuffer(),
  ]);
  return new TransactionInstruction({
    programId,
    data,
    keys: [rw(args.authority, true), rw(season), rw(vault)],
  });
}
