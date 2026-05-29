// Manual devnet end-to-end for the v2 paid-pool flow. NOT a unit test — it
// spends devnet SOL and hits the live leaderboard Worker. Run:
//   npx tsx oracle/e2e-devnet.ts
// Funds ephemeral players from the devnet wallet, has them enter, submits signed
// scores to the live Worker, runs the oracle `finalize`, then claims — asserting
// the on-chain payouts. Network calls are retried (public devnet RPC is flaky).

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  type TransactionInstruction,
} from '@solana/web3.js';
import { createPrivateKey, sign as edSignRaw } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  initSeasonIx,
  enterIx,
  claimIx,
  seasonAddress,
  vaultAddress,
  decodeSeason,
  payoutFor,
} from '../src/index';

const RPC = clusterApiUrl('devnet');
const LB = 'https://tapclash-leaderboard.twigzzz28.workers.dev';
const FEE_SOL = 0.02;
const FEE = BigInt(Math.round(FEE_SOL * LAMPORTS_PER_SOL));
const PAYOUT = [6000, 4000]; // 2 paying ranks
const SEASON = 210000 + (Math.floor(Date.now() / 1000) % 80000); // unique-ish u32, not a real YYYYMM

const connection = new Connection(RPC, 'confirmed');
const authority = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/devnet-wallet.json`, 'utf8'))),
);

async function retry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw new Error(`${label} failed after ${attempts}: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

const getBalance = (pk: PublicKey) => retry('getBalance', () => connection.getBalance(pk));
const sendTx = (ixs: TransactionInstruction[], signers: Keypair[]) =>
  retry('sendTx', () => sendAndConfirmTransaction(connection, new Transaction().add(...ixs), signers, { commitment: 'confirmed' }));

function edSign(secretKey: Uint8Array, msg: string): Buffer {
  const der = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'), // PKCS8 ed25519 prefix
    Buffer.from(secretKey.slice(0, 32)),
  ]);
  return edSignRaw(null, Buffer.from(msg), createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }));
}

async function submitScore(player: Keypair, score: number, hits: number, misses: number) {
  const wallet = player.publicKey.toBase58();
  const nonce = 'e2e' + Math.floor(Math.random() * 1e9).toString(16);
  const msg = `tapclash/v1\nwallet=${wallet}\nseason=${SEASON}\nscore=${score}\nhits=${hits}\nmisses=${misses}\ndur=30000\nnonce=${nonce}`;
  const signature = edSign(player.secretKey, msg).toString('base64');
  return retry('submitScore', async () => {
    const res = await fetch(`${LB}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, seasonId: SEASON, score, hits, misses, accuracy: hits / (hits + misses), durationMs: 30000, nonce, signature }),
    });
    const body = await res.json();
    if (res.status !== 200) throw new Error(`score rejected: ${res.status} ${JSON.stringify(body)}`);
    return body;
  });
}

async function main() {
  console.log(`== devnet e2e, season ${SEASON}, authority ${authority.publicKey.toBase58()} ==`);
  console.log(`authority balance: ${(await getBalance(authority.publicKey)) / LAMPORTS_PER_SOL} SOL`);

  // 1) open the paid season
  await sendTx([initSeasonIx({ authority: authority.publicKey, seasonId: SEASON, entryFee: FEE, payoutBps: PAYOUT })], [authority]);
  console.log(`1) opened season ${SEASON} (fee ${FEE_SOL} SOL)`);

  // 2) fund two ephemeral players from the authority
  const p1 = Keypair.generate();
  const p2 = Keypair.generate();
  await sendTx(
    [
      SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: p1.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }),
      SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: p2.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }),
    ],
    [authority],
  );
  console.log('2) funded 2 players');

  // 3) both enter (player-signed)
  await sendTx([enterIx({ player: p1.publicKey, seasonId: SEASON })], [p1]);
  await sendTx([enterIx({ player: p2.publicKey, seasonId: SEASON })], [p2]);
  console.log(`3) both entered; vault holds ${(await getBalance(vaultAddress(SEASON))) / LAMPORTS_PER_SOL} SOL`);

  // 4) submit signed scores to the LIVE leaderboard (p1 > p2)
  console.log('4) submit scores:', await submitScore(p1, 9000, 50, 10), await submitScore(p2, 3000, 20, 5));

  // 5) run the oracle finalize (subprocess — exercises the real CLI)
  console.log('5) oracle finalize:');
  console.log(execSync(`npx tsx oracle/oracle.ts finalize --season ${SEASON}`, { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }));

  // 6) verify on-chain winners + claim
  const acc = await retry('getAccountInfo', () => connection.getAccountInfo(seasonAddress(SEASON)));
  const season = decodeSeason(Uint8Array.from(acc!.data));
  if (!season.finalized) throw new Error('season not finalized');
  const pool = season.finalPool;
  console.log(`6) finalized: pool ${Number(pool) / LAMPORTS_PER_SOL} SOL, winners ${season.winners.slice(0, season.numWinners).map((w) => w.toBase58())}`);

  for (const [label, p, bps] of [['p1', p1, PAYOUT[0]], ['p2', p2, PAYOUT[1]]] as const) {
    const before = await getBalance(p.publicKey);
    const vaultBefore = await getBalance(vaultAddress(SEASON));
    await sendTx([claimIx({ player: p.publicKey, seasonId: SEASON })], [p]);
    const vaultDelta = BigInt(vaultBefore - (await getBalance(vaultAddress(SEASON))));
    const expected = payoutFor(pool, bps);
    const gained = (await getBalance(p.publicKey)) - before;
    const ok = vaultDelta === expected;
    console.log(`   ${label} claimed: vault −${Number(vaultDelta) / LAMPORTS_PER_SOL} (expected −${Number(expected) / LAMPORTS_PER_SOL}) ${ok ? 'OK' : 'MISMATCH'}; player net +${gained / LAMPORTS_PER_SOL} SOL (after fee)`);
    if (!ok) throw new Error(`payout mismatch for ${label}`);
  }
  console.log('\n✅ devnet e2e PASSED — init → enter → score → finalize → claim, payouts exact.');
}

main().catch((e) => {
  console.error('e2e FAILED:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
