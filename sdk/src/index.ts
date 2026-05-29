// @tapclash/pools-sdk — RN-safe client for the tapclash_pools v2 program.
//
// Usage (app side, at SP2): build an instruction, drop it into a Transaction,
// sign + send via Mobile Wallet Adapter. Read state with the decoders.
//
//   import { enterIx, claimIx, seasonAddress, decodeSeason } from '../sdk/src';
//   const ix = enterIx({ player: wallet, seasonId: 202606 });
//   const tx = new Transaction().add(ix);
//   // ...recentBlockhash + feePayer, then wallet.signAndSendTransactions([tx])
//
// All builders accept an optional trailing `programId` to target a specific
// deployment; they default to PROGRAM_ID (the built/devnet id).

export { default as IDL } from '../idl/tapclash_pools.json';

export {
  PROGRAM_ID,
  SEASON_SEED,
  VAULT_SEED,
  ENTRY_SEED,
  seasonIdToBytes,
  seasonPda,
  vaultPda,
  entryPda,
  seasonAddress,
  vaultAddress,
  entryAddress,
  DEFAULT_PAYOUT_BPS,
} from './program';

export {
  initSeasonIx,
  enterIx,
  submitScoreIx,
  finalizeSeasonIx,
  claimIx,
  withdrawUnallocatedIx,
  type InitSeasonArgs,
  type EnterArgs,
  type SubmitScoreArgs,
  type FinalizeSeasonArgs,
  type ClaimArgs,
  type WithdrawUnallocatedArgs,
} from './instructions';

export { decodeSeason, decodeEntry, decodeVault } from './accounts';

export { isOpenForEntry, winnerRank, claimableLamports, hasPendingClaim } from './claim';

export {
  MAX_WINNERS,
  BPS_DENOMINATOR,
  payoutFor,
  type SeasonAccount,
  type EntryAccount,
  type VaultAccount,
} from './types';

export { Reader, Writer } from './borsh';
