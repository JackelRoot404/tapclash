// TapClash v2 oracle CLI.
//
// The off-chain operator tool that bridges the signed-score leaderboard to the
// on-chain pool program. Scores are computed/verified off-chain, so a trusted
// authority must attest the standings on-chain. This CLI is that authority.
//
//   npx tsx oracle/oracle.ts init-season --season 202606 --fee 0.05
//   npx tsx oracle/oracle.ts status       --season 202606
//   npx tsx oracle/oracle.ts finalize     --season 202606 [--dry-run]
//
// Flags: --url devnet|mainnet|localnet|<rpc>  (default devnet)
//        --keypair <path>                     (default ~/.config/solana/devnet-wallet.json)
//        --leaderboard <url>                  (default the deployed Worker)
//        --bps 4000,2000,...                  (init-season; default DEFAULT_PAYOUT_BPS)
//        --yes-mainnet                        (required to touch mainnet — spends real SOL)
//
// Devnet is the default and the only cluster this should hit autonomously.
// Mainnet is GUARDRAILED: it requires --yes-mainnet and spends real SOL.

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  type TransactionInstruction,
} from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  PROGRAM_ID,
  initSeasonIx,
  submitScoreIx,
  finalizeSeasonIx,
  withdrawUnallocatedIx,
  seasonAddress,
  vaultAddress,
  decodeSeason,
  decodeEntry,
  payoutFor,
  DEFAULT_PAYOUT_BPS,
  type EntryAccount,
} from '../src/index';

const LB_DEFAULT = 'https://tapclash-leaderboard.twigzzz28.workers.dev';
const KEYPAIR_DEFAULT = `${homedir()}/.config/solana/devnet-wallet.json`;
const ENTRY_SIZE = 55; // 8 disc + 32 player + 4 season + 8 score + 1 paid + 1 claimed + 1 bump

// ---- args ----------------------------------------------------------------
function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string | boolean> } {
  const [cmd = 'help', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) continue;
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  return { cmd, flags };
}

function rpcUrl(flag: unknown): string {
  const v = typeof flag === 'string' ? flag : '';
  if (!v || v === 'devnet') return clusterApiUrl('devnet');
  if (v === 'mainnet' || v === 'mainnet-beta') return clusterApiUrl('mainnet-beta');
  if (v === 'localnet' || v === 'local') return 'http://127.0.0.1:8899';
  return v; // custom RPC URL
}

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(readFileSync(path, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function reqNum(flags: Record<string, string | boolean>, key: string): number {
  const v = flags[key];
  if (typeof v !== 'string' || v.trim() === '' || Number.isNaN(Number(v))) {
    throw new Error(`missing/invalid --${key}`);
  }
  return Number(v);
}

// Public devnet RPC is flaky; retry transient network errors with backoff.
async function retry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

async function send(
  connection: Connection,
  ixs: TransactionInstruction[],
  signers: Keypair[],
): Promise<string> {
  return retry('sendTransaction', () =>
    sendAndConfirmTransaction(connection, new Transaction().add(...ixs), signers, { commitment: 'confirmed' }),
  );
}

async function getPaidEntries(connection: Connection, seasonId: number): Promise<EntryAccount[]> {
  const accs = await retry('getProgramAccounts', () =>
    connection.getProgramAccounts(PROGRAM_ID, { filters: [{ dataSize: ENTRY_SIZE }] }),
  );
  const out: EntryAccount[] = [];
  for (const { account } of accs) {
    try {
      const e = decodeEntry(Uint8Array.from(account.data));
      if (e.seasonId === seasonId && e.paid) out.push(e);
    } catch {
      /* not an Entry for us */
    }
  }
  return out;
}

async function fetchLeaderboard(
  lbUrl: string,
  seasonId: number,
): Promise<Array<{ wallet: string; score: number }>> {
  const body = await retry('leaderboard fetch', async () => {
    const res = await fetch(`${lbUrl}/leaderboard/${seasonId}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    return (await res.json()) as { entries?: Array<{ wallet: string; score: number }> };
  });
  return body.entries ?? [];
}

// ---- commands ------------------------------------------------------------
async function cmdInitSeason(connection: Connection, authority: Keypair, flags: Record<string, string | boolean>) {
  const seasonId = reqNum(flags, 'season');
  const feeSol = reqNum(flags, 'fee');
  const entryFee = BigInt(Math.round(feeSol * LAMPORTS_PER_SOL));
  const payoutBps =
    typeof flags.bps === 'string' ? flags.bps.split(',').map((s) => Number(s.trim())) : DEFAULT_PAYOUT_BPS;

  const ix = initSeasonIx({ authority: authority.publicKey, seasonId, entryFee, payoutBps });
  const sig = await send(connection, [ix], [authority]);
  console.log(`✓ opened season ${seasonId}: fee=${feeSol} SOL, ${payoutBps.filter((b) => b > 0).length} paying ranks`);
  console.log(`  season PDA: ${seasonAddress(seasonId).toBase58()}`);
  console.log(`  vault  PDA: ${vaultAddress(seasonId).toBase58()}`);
  console.log(`  sig: ${sig}`);
}

async function cmdStatus(connection: Connection, flags: Record<string, string | boolean>) {
  const seasonId = reqNum(flags, 'season');
  const acc = await retry('getAccountInfo(season)', () => connection.getAccountInfo(seasonAddress(seasonId)));
  if (!acc) {
    console.log(`season ${seasonId}: not found`);
    return;
  }
  const s = decodeSeason(Uint8Array.from(acc.data));
  const paid = await getPaidEntries(connection, seasonId);
  console.log(`season ${seasonId}`);
  console.log(`  authority : ${s.authority.toBase58()}`);
  console.log(`  entry fee : ${Number(s.entryFee) / LAMPORTS_PER_SOL} SOL`);
  console.log(`  pool      : ${Number(s.poolTotal) / LAMPORTS_PER_SOL} SOL  (final ${Number(s.finalPool) / LAMPORTS_PER_SOL})`);
  console.log(`  entrants  : ${s.entrants}  (paid Entry PDAs found: ${paid.length})`);
  console.log(`  payout bps: [${s.payoutBps.filter((b) => b > 0).join(', ')}]`);
  console.log(`  finalized : ${s.finalized}  swept: ${s.swept}  winners: ${s.numWinners}`);
  if (s.finalized) {
    for (let i = 0; i < s.numWinners; i++) {
      console.log(`    #${i + 1} ${s.winners[i].toBase58()} → ${Number(payoutFor(s.finalPool, s.payoutBps[i])) / LAMPORTS_PER_SOL} SOL`);
    }
  }
}

async function cmdFinalize(connection: Connection, authority: Keypair, flags: Record<string, string | boolean>) {
  const seasonId = reqNum(flags, 'season');
  const lbUrl = typeof flags.leaderboard === 'string' ? flags.leaderboard : LB_DEFAULT;
  const dryRun = flags['dry-run'] === true;

  const acc = await retry('getAccountInfo(season)', () => connection.getAccountInfo(seasonAddress(seasonId)));
  if (!acc) throw new Error(`season ${seasonId} not found`);
  const season = decodeSeason(Uint8Array.from(acc.data));
  if (season.finalized) throw new Error(`season ${seasonId} already finalized`);

  const paid = await getPaidEntries(connection, seasonId);
  const lb = await fetchLeaderboard(lbUrl, seasonId);

  const paidSet = new Set(paid.map((e) => e.player.toBase58()));
  // Off-chain leaderboard is already score-desc; keep only paid entrants.
  const scored = lb.filter((e) => paidSet.has(e.wallet)).map((e) => ({ wallet: e.wallet, score: e.score }));
  const scoredSet = new Set(scored.map((e) => e.wallet));
  // Paid entrants with no off-chain score rank last at score 0 (so the winner set
  // can still fill every paying rank the field supports).
  const unscored = paid
    .filter((e) => !scoredSet.has(e.player.toBase58()))
    .map((e) => ({ wallet: e.player.toBase58(), score: 0 }));
  const fullRanking = [...scored, ...unscored];

  const payingRanks = season.payoutBps.filter((b) => b > 0).length;
  const required = Math.min(season.entrants, payingRanks);
  const winners = fullRanking.slice(0, required);

  if (paid.length !== season.entrants) {
    console.warn(`⚠ on-chain entrants=${season.entrants} but found ${paid.length} paid Entry PDAs`);
  }
  console.log(`finalize season ${seasonId}: ${season.entrants} entrants, ${payingRanks} paying ranks → ${winners.length} winners`);
  winners.forEach((w, i) =>
    console.log(`  #${i + 1} ${w.wallet}  score=${w.score} → ${Number(payoutFor(season.finalPool || season.poolTotal, season.payoutBps[i])) / LAMPORTS_PER_SOL} SOL`),
  );
  if (winners.length !== required) {
    throw new Error(`have ${winners.length} winners but need exactly ${required} — aborting (would fail IncompleteWinnerSet)`);
  }
  if (dryRun) {
    console.log('dry-run: no transactions sent.');
    return;
  }

  // Attest each winner's best score on-chain (monotonic), chunked.
  const submitIxs = winners.map((w) =>
    submitScoreIx({ authority: authority.publicKey, seasonId, player: new PublicKey(w.wallet), score: BigInt(w.score) }),
  );
  for (let i = 0; i < submitIxs.length; i += 5) {
    const chunk = submitIxs.slice(i, i + 5);
    if (chunk.length) {
      const sig = await send(connection, chunk, [authority]);
      console.log(`  submit_score [${i}..${i + chunk.length - 1}] sig ${sig}`);
    }
  }

  const finIx = finalizeSeasonIx({
    authority: authority.publicKey,
    seasonId,
    winners: winners.map((w) => new PublicKey(w.wallet)),
  });
  const sig = await send(connection, [finIx], [authority]);
  console.log(`✓ finalized season ${seasonId} — sig ${sig}`);
  console.log('  winners can now claim via the app (claimIx).');
}

// Authority reclaims the provably-unallocated remainder (unfilled ranks + dust)
// of a finalized season. Never touches a winner's earmarked share.
async function cmdWithdraw(connection: Connection, authority: Keypair, flags: Record<string, string | boolean>) {
  const seasonId = reqNum(flags, 'season');
  const before = await retry('getBalance(vault)', () => connection.getBalance(vaultAddress(seasonId)));
  const ix = withdrawUnallocatedIx({ authority: authority.publicKey, seasonId });
  const sig = await send(connection, [ix], [authority]);
  const after = await retry('getBalance(vault)', () => connection.getBalance(vaultAddress(seasonId)));
  console.log(`✓ swept season ${seasonId} unallocated remainder: vault ${(before - after) / 1e9} SOL → authority`);
  console.log(`  sig: ${sig}`);
}

function usage() {
  console.log(`tapclash oracle
  init-season          --season <id> --fee <SOL> [--bps a,b,...]
  status               --season <id>
  finalize             --season <id> [--dry-run]
  withdraw-unallocated --season <id>
common: [--url devnet|mainnet|localnet|<rpc>] [--keypair <path>] [--leaderboard <url>] [--yes-mainnet]`);
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  if (cmd === 'help' || flags.help) return usage();

  const url = rpcUrl(flags.url);
  if (url.includes('mainnet') && flags['yes-mainnet'] !== true) {
    console.error('Refusing to run against mainnet without --yes-mainnet (spends real SOL). Devnet is the default.');
    process.exit(1);
  }
  const connection = new Connection(url, 'confirmed');
  const keypairPath = typeof flags.keypair === 'string' ? flags.keypair : KEYPAIR_DEFAULT;

  switch (cmd) {
    case 'init-season':
      return cmdInitSeason(connection, loadKeypair(keypairPath), flags);
    case 'status':
      return cmdStatus(connection, flags);
    case 'finalize':
      return cmdFinalize(connection, loadKeypair(keypairPath), flags);
    case 'withdraw-unallocated':
    case 'withdraw':
      return cmdWithdraw(connection, loadKeypair(keypairPath), flags);
    default:
      usage();
      process.exit(1);
  }
}

main().catch((e) => {
  console.error('oracle error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
