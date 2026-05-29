// v2 paid-pools on-chain reads + transaction prep. Thin wrapper over the
// tapclash_pools SDK (../sdk/src) + a web3.js Connection. Signing/sending is done
// by the wallet (useSeedVault.signAndSendTransaction); this module only reads
// state and assembles unsigned transactions.
import { Connection, PublicKey, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { RPC_ENDPOINT } from '../constants/config';
import {
  seasonAddress,
  entryAddress,
  decodeSeason,
  decodeEntry,
  type SeasonAccount,
  type EntryAccount,
} from '../sdk/src';

let conn: Connection | null = null;
export function getConnection(): Connection {
  if (!conn) conn = new Connection(RPC_ENDPOINT, 'confirmed');
  return conn;
}

export async function readSeason(seasonId: number): Promise<SeasonAccount | null> {
  try {
    const info = await getConnection().getAccountInfo(seasonAddress(seasonId));
    if (!info) return null;
    return decodeSeason(info.data);
  } catch (e) {
    console.warn('readSeason failed:', e);
    return null;
  }
}

export async function readEntry(seasonId: number, player: PublicKey): Promise<EntryAccount | null> {
  try {
    const info = await getConnection().getAccountInfo(entryAddress(seasonId, player));
    if (!info) return null;
    return decodeEntry(info.data);
  } catch (e) {
    console.warn('readEntry failed:', e);
    return null;
  }
}

// Build an unsigned tx ready for the wallet to sign+send (feePayer + blockhash set).
export async function prepareTx(ix: TransactionInstruction, feePayer: PublicKey): Promise<Transaction> {
  const { blockhash } = await getConnection().getLatestBlockhash('finalized');
  const tx = new Transaction().add(ix);
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  return tx;
}

const LAMPORTS_PER_SOL = 1_000_000_000;
export function lamportsToSol(lamports: bigint): string {
  const sol = Number(lamports) / LAMPORTS_PER_SOL;
  // Show enough precision for small devnet fees without trailing-zero noise.
  return sol.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
