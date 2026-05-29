import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { LiteSVM, FailedTransactionMetadata } from 'litesvm';
import {
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  PROGRAM_ID,
  initSeasonIx,
  enterIx,
  submitScoreIx,
  finalizeSeasonIx,
  claimIx,
  withdrawUnallocatedIx,
  seasonAddress,
  vaultAddress,
  entryAddress,
  decodeSeason,
  decodeEntry,
  decodeVault,
  payoutFor,
  DEFAULT_PAYOUT_BPS,
  winnerRank,
  claimableLamports,
  hasPendingClaim,
  isOpenForEntry,
} from '../src/index';

const SO_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../programs/target/deploy/tapclash_pools.so',
);

const FEE = 100_000_000n; // 0.1 SOL entry fee
const ONE_SOL = 1_000_000_000n;

type SendResult = { ok: boolean; logs: string[]; err?: string };

function freshSvm(): LiteSVM {
  const svm = new LiteSVM();
  svm.addProgramFromFile(PROGRAM_ID, SO_PATH);
  return svm;
}

function fund(svm: LiteSVM, lamports = ONE_SOL): Keypair {
  const kp = Keypair.generate();
  svm.airdrop(kp.publicKey, lamports);
  return kp;
}

function send(svm: LiteSVM, ix: TransactionInstruction, signers: Keypair[]): SendResult {
  const tx = new Transaction();
  tx.recentBlockhash = svm.latestBlockhash();
  tx.feePayer = signers[0].publicKey;
  tx.add(ix);
  tx.sign(...signers);
  const res = svm.sendTransaction(tx);
  svm.expireBlockhash(); // advance so the next tx isn't a duplicate blockhash
  if (res instanceof FailedTransactionMetadata) {
    return { ok: false, logs: res.meta().logs(), err: res.err().toString() };
  }
  return { ok: true, logs: res.logs() };
}

function failsWith(r: SendResult, errName: string) {
  expect(r.ok, `expected failure (${errName}) but tx succeeded`).toBe(false);
  const blob = (r.logs.join('\n') + '\n' + (r.err ?? '')).toLowerCase();
  expect(blob, `error ${errName} not found in: ${r.logs.join(' | ')} | ${r.err}`).toContain(
    errName.toLowerCase(),
  );
}

function balance(svm: LiteSVM, k: PublicKey): bigint {
  return svm.getBalance(k) ?? 0n;
}

function seasonState(svm: LiteSVM, seasonId: number) {
  const acc = svm.getAccount(seasonAddress(seasonId));
  if (!acc) throw new Error('season account missing');
  return decodeSeason(Uint8Array.from(acc.data));
}

function entryState(svm: LiteSVM, seasonId: number, player: PublicKey) {
  const acc = svm.getAccount(entryAddress(seasonId, player));
  if (!acc) throw new Error('entry account missing');
  return decodeEntry(Uint8Array.from(acc.data));
}

beforeAll(() => {
  // Fail fast with a clear message if the program wasn't built.
  // (resolve() doesn't throw; addProgramFromFile will if the .so is missing.)
});

describe('tapclash_pools — full lifecycle', () => {
  it('init → enter → submit → finalize → claim distributes the pool exactly', () => {
    const svm = freshSvm();
    const seasonId = 202601;
    const authority = fund(svm);
    const payout = [5000, 3000, 2000]; // 3 ranks, sums to 10000

    expect(send(svm, initSeasonIx({ authority: authority.publicKey, seasonId, entryFee: FEE, payoutBps: payout }), [authority]).ok).toBe(true);

    let s = seasonState(svm, seasonId);
    expect(s.authority.equals(authority.publicKey)).toBe(true);
    expect(s.seasonId).toBe(seasonId);
    expect(s.entryFee).toBe(FEE);
    expect(s.finalized).toBe(false);
    expect(s.payoutBps.slice(0, 3)).toEqual([5000, 3000, 2000]);

    const v = decodeVault(Uint8Array.from(svm.getAccount(vaultAddress(seasonId))!.data));
    expect(v.seasonId).toBe(seasonId);

    // Three players enter.
    const players = [fund(svm), fund(svm), fund(svm)];
    const vaultBefore = balance(svm, vaultAddress(seasonId));
    for (const p of players) {
      expect(send(svm, enterIx({ player: p.publicKey, seasonId }), [p]).ok).toBe(true);
    }
    expect(balance(svm, vaultAddress(seasonId)) - vaultBefore).toBe(FEE * 3n);

    s = seasonState(svm, seasonId);
    expect(s.entrants).toBe(3);
    expect(s.poolTotal).toBe(FEE * 3n);
    players.forEach((p) => expect(entryState(svm, seasonId, p.publicKey).paid).toBe(true));

    // Oracle attests scores: p0 > p1 > p2.
    const scores = [300n, 200n, 100n];
    players.forEach((p, i) => {
      expect(send(svm, submitScoreIx({ authority: authority.publicKey, seasonId, player: p.publicKey, score: scores[i] }), [authority]).ok).toBe(true);
    });
    players.forEach((p, i) => expect(entryState(svm, seasonId, p.publicKey).bestScore).toBe(scores[i]));

    // submit_score is monotonic — a lower score doesn't reduce best.
    expect(send(svm, submitScoreIx({ authority: authority.publicKey, seasonId, player: players[0].publicKey, score: 50n }), [authority]).ok).toBe(true);
    expect(entryState(svm, seasonId, players[0].publicKey).bestScore).toBe(300n);

    // Finalize with winners in rank order.
    const winners = players.map((p) => p.publicKey);
    expect(send(svm, finalizeSeasonIx({ authority: authority.publicKey, seasonId, winners }), [authority]).ok).toBe(true);

    s = seasonState(svm, seasonId);
    expect(s.finalized).toBe(true);
    expect(s.numWinners).toBe(3);
    expect(s.finalPool).toBe(FEE * 3n);
    expect(s.winners.slice(0, 3).map((w) => w.toBase58())).toEqual(winners.map((w) => w.toBase58()));

    // Each winner claims exactly their bps share (assert via exact vault delta).
    const pool = FEE * 3n;
    const expected = payout.map((bps) => payoutFor(pool, bps));
    players.forEach((p, i) => {
      const vBefore = balance(svm, vaultAddress(seasonId));
      const r = send(svm, claimIx({ player: p.publicKey, seasonId }), [p]);
      expect(r.ok, `claim ${i} failed: ${r.err}`).toBe(true);
      expect(vBefore - balance(svm, vaultAddress(seasonId))).toBe(expected[i]);
      expect(entryState(svm, seasonId, p.publicKey).claimed).toBe(true);
    });

    // Full split → nothing left to sweep (remainder 0). Sweep should succeed but
    // move nothing, and the vault keeps only its rent reserve.
    expect(expected.reduce((a, b) => a + b, 0n)).toBe(pool);
    expect(send(svm, withdrawUnallocatedIx({ authority: authority.publicKey, seasonId }), [authority]).ok).toBe(true);
  });
});

describe('tapclash_pools — partial split + unallocated sweep', () => {
  it('reclaims the un-payable remainder to the authority, once', () => {
    const svm = freshSvm();
    const seasonId = 202602;
    const authority = fund(svm, 2n * ONE_SOL);

    send(svm, initSeasonIx({ authority: authority.publicKey, seasonId, entryFee: FEE, payoutBps: DEFAULT_PAYOUT_BPS }), [authority]);
    const players = [fund(svm), fund(svm), fund(svm)];
    players.forEach((p) => send(svm, enterIx({ player: p.publicKey, seasonId }), [p]));
    send(svm, finalizeSeasonIx({ authority: authority.publicKey, seasonId, winners: players.map((p) => p.publicKey) }), [authority]);

    const pool = FEE * 3n;
    const allocated = DEFAULT_PAYOUT_BPS.slice(0, 3).reduce((a, bps) => a + payoutFor(pool, bps), 0n);
    const remainder = pool - allocated;
    expect(remainder).toBeGreaterThan(0n);

    const authBefore = balance(svm, authority.publicKey);
    const vaultBefore = balance(svm, vaultAddress(seasonId));
    const r = send(svm, withdrawUnallocatedIx({ authority: authority.publicKey, seasonId }), [authority]);
    expect(r.ok).toBe(true);
    // Vault drops by exactly the remainder; authority gains it (minus tx fee).
    expect(vaultBefore - balance(svm, vaultAddress(seasonId))).toBe(remainder);
    expect(balance(svm, authority.publicKey)).toBeGreaterThan(authBefore - 100_000n);
    expect(seasonState(svm, seasonId).swept).toBe(true);

    // Second sweep rejected.
    failsWith(send(svm, withdrawUnallocatedIx({ authority: authority.publicKey, seasonId }), [authority]), 'AlreadySwept');

    // Winners can still claim their full bps share after the sweep.
    const vBefore = balance(svm, vaultAddress(seasonId));
    expect(send(svm, claimIx({ player: players[0].publicKey, seasonId }), [players[0]]).ok).toBe(true);
    expect(vBefore - balance(svm, vaultAddress(seasonId))).toBe(payoutFor(pool, DEFAULT_PAYOUT_BPS[0]));
  });
});

describe('tapclash_pools — guards', () => {
  it('rejects invalid payout splits at init', () => {
    const svm = freshSvm();
    const authority = fund(svm);
    // sum > 10000
    failsWith(send(svm, initSeasonIx({ authority: authority.publicKey, seasonId: 1, entryFee: FEE, payoutBps: [9000, 9000] }), [authority]), 'InvalidPayoutSplit');
    // sum == 0
    failsWith(send(svm, initSeasonIx({ authority: authority.publicKey, seasonId: 2, entryFee: FEE, payoutBps: [0, 0] }), [authority]), 'InvalidPayoutSplit');
  });

  it('rejects a second enter from the same wallet', () => {
    const svm = freshSvm();
    const seasonId = 10;
    const authority = fund(svm);
    send(svm, initSeasonIx({ authority: authority.publicKey, seasonId, entryFee: FEE, payoutBps: [10000] }), [authority]);
    const p = fund(svm);
    expect(send(svm, enterIx({ player: p.publicKey, seasonId }), [p]).ok).toBe(true);
    expect(send(svm, enterIx({ player: p.publicKey, seasonId }), [p]).ok).toBe(false); // entry PDA already in use
  });

  it('rejects submit_score from a non-authority signer', () => {
    const svm = freshSvm();
    const seasonId = 11;
    const authority = fund(svm);
    send(svm, initSeasonIx({ authority: authority.publicKey, seasonId, entryFee: FEE, payoutBps: [10000] }), [authority]);
    const p = fund(svm);
    send(svm, enterIx({ player: p.publicKey, seasonId }), [p]);
    const attacker = fund(svm);
    // attacker signs but passes themselves as `authority` — has_one mismatch.
    failsWith(send(svm, submitScoreIx({ authority: attacker.publicKey, seasonId, player: p.publicKey, score: 999n }), [attacker]), 'Unauthorized');
  });

  it('rejects finalize with winners out of score order, and duplicates', () => {
    const svm = freshSvm();
    const seasonId = 12;
    const authority = fund(svm);
    send(svm, initSeasonIx({ authority: authority.publicKey, seasonId, entryFee: FEE, payoutBps: [6000, 4000] }), [authority]);
    const a = fund(svm), b = fund(svm);
    send(svm, enterIx({ player: a.publicKey, seasonId }), [a]);
    send(svm, enterIx({ player: b.publicKey, seasonId }), [b]);
    send(svm, submitScoreIx({ authority: authority.publicKey, seasonId, player: a.publicKey, score: 100n }), [authority]);
    send(svm, submitScoreIx({ authority: authority.publicKey, seasonId, player: b.publicKey, score: 500n }), [authority]);
    // a(100) before b(500) is increasing → must be rejected.
    failsWith(send(svm, finalizeSeasonIx({ authority: authority.publicKey, seasonId, winners: [a.publicKey, b.publicKey] }), [authority]), 'WinnersNotSorted');
    // duplicate winner
    failsWith(send(svm, finalizeSeasonIx({ authority: authority.publicKey, seasonId, winners: [b.publicKey, b.publicKey] }), [authority]), 'DuplicateWinner');
    // correct order succeeds, and a second finalize is rejected
    expect(send(svm, finalizeSeasonIx({ authority: authority.publicKey, seasonId, winners: [b.publicKey, a.publicKey] }), [authority]).ok).toBe(true);
    failsWith(send(svm, finalizeSeasonIx({ authority: authority.publicKey, seasonId, winners: [b.publicKey, a.publicKey] }), [authority]), 'AlreadyFinalized');
  });

  it('rejects enter and submit_score after finalize', () => {
    const svm = freshSvm();
    const seasonId = 13;
    const authority = fund(svm);
    send(svm, initSeasonIx({ authority: authority.publicKey, seasonId, entryFee: FEE, payoutBps: [10000] }), [authority]);
    const a = fund(svm);
    send(svm, enterIx({ player: a.publicKey, seasonId }), [a]);
    send(svm, submitScoreIx({ authority: authority.publicKey, seasonId, player: a.publicKey, score: 10n }), [authority]);
    send(svm, finalizeSeasonIx({ authority: authority.publicKey, seasonId, winners: [a.publicKey] }), [authority]);
    const b = fund(svm);
    failsWith(send(svm, enterIx({ player: b.publicKey, seasonId }), [b]), 'SeasonFinalized');
    failsWith(send(svm, submitScoreIx({ authority: authority.publicKey, seasonId, player: a.publicKey, score: 999n }), [authority]), 'SeasonFinalized');
  });

  it('rejects claim before finalize, double claim, and non-winner claim', () => {
    const svm = freshSvm();
    const seasonId = 14;
    const authority = fund(svm);
    send(svm, initSeasonIx({ authority: authority.publicKey, seasonId, entryFee: FEE, payoutBps: [10000] }), [authority]);
    const winner = fund(svm), loser = fund(svm);
    send(svm, enterIx({ player: winner.publicKey, seasonId }), [winner]);
    send(svm, enterIx({ player: loser.publicKey, seasonId }), [loser]);
    send(svm, submitScoreIx({ authority: authority.publicKey, seasonId, player: winner.publicKey, score: 500n }), [authority]);
    send(svm, submitScoreIx({ authority: authority.publicKey, seasonId, player: loser.publicKey, score: 1n }), [authority]);

    // claim before finalize
    failsWith(send(svm, claimIx({ player: winner.publicKey, seasonId }), [winner]), 'NotFinalized');

    // only `winner` is recorded as a winner (1 payout rank)
    send(svm, finalizeSeasonIx({ authority: authority.publicKey, seasonId, winners: [winner.publicKey] }), [authority]);

    expect(send(svm, claimIx({ player: winner.publicKey, seasonId }), [winner]).ok).toBe(true);
    // double claim
    failsWith(send(svm, claimIx({ player: winner.publicKey, seasonId }), [winner]), 'AlreadyClaimed');
    // loser entered but isn't a recorded winner
    failsWith(send(svm, claimIx({ player: loser.publicKey, seasonId }), [loser]), 'NotAWinner');
  });
});

describe('tapclash_pools — audit hardening (anti-rug)', () => {
  it('rejects a non-front-loaded payout split at init', () => {
    const svm = freshSvm();
    const authority = fund(svm);
    failsWith(
      send(svm, initSeasonIx({ authority: authority.publicKey, seasonId: 20, entryFee: FEE, payoutBps: [4000, 0, 2000] }), [authority]),
      'InvalidPayoutSplit',
    );
  });

  it('rejects finalize that does not fill every paying rank (underbooked winner set)', () => {
    const svm = freshSvm();
    const seasonId = 21;
    const authority = fund(svm);
    send(svm, initSeasonIx({ authority: authority.publicKey, seasonId, entryFee: FEE, payoutBps: [6000, 4000] }), [authority]); // 2 paying ranks
    const a = fund(svm), b = fund(svm);
    send(svm, enterIx({ player: a.publicKey, seasonId }), [a]);
    send(svm, enterIx({ player: b.publicKey, seasonId }), [b]);
    send(svm, submitScoreIx({ authority: authority.publicKey, seasonId, player: a.publicKey, score: 500n }), [authority]);
    send(svm, submitScoreIx({ authority: authority.publicKey, seasonId, player: b.publicKey, score: 100n }), [authority]);
    // entrants=2, paying ranks=2 → exactly 2 winners required. Finalizing 1 (and
    // sweeping the rest) is the rug this guard blocks.
    failsWith(send(svm, finalizeSeasonIx({ authority: authority.publicKey, seasonId, winners: [a.publicKey] }), [authority]), 'IncompleteWinnerSet');
    expect(send(svm, finalizeSeasonIx({ authority: authority.publicKey, seasonId, winners: [a.publicKey, b.publicKey] }), [authority]).ok).toBe(true);
  });

  it('caps required winners at the paying-rank count when overbooked', () => {
    const svm = freshSvm();
    const seasonId = 22;
    const authority = fund(svm);
    send(svm, initSeasonIx({ authority: authority.publicKey, seasonId, entryFee: FEE, payoutBps: [10000] }), [authority]); // 1 paying rank
    const a = fund(svm), b = fund(svm), c = fund(svm);
    [a, b, c].forEach((p) => send(svm, enterIx({ player: p.publicKey, seasonId }), [p]));
    send(svm, submitScoreIx({ authority: authority.publicKey, seasonId, player: a.publicKey, score: 300n }), [authority]);
    send(svm, submitScoreIx({ authority: authority.publicKey, seasonId, player: b.publicKey, score: 200n }), [authority]);
    send(svm, submitScoreIx({ authority: authority.publicKey, seasonId, player: c.publicKey, score: 100n }), [authority]);
    // 3 entrants, 1 paying rank → required = 1; passing 2 must fail.
    failsWith(send(svm, finalizeSeasonIx({ authority: authority.publicKey, seasonId, winners: [a.publicKey, b.publicKey] }), [authority]), 'IncompleteWinnerSet');
    expect(send(svm, finalizeSeasonIx({ authority: authority.publicKey, seasonId, winners: [a.publicKey] }), [authority]).ok).toBe(true);
  });

  it('finalizes an empty season (0 entrants → 0 winners) and sweeps nothing', () => {
    const svm = freshSvm();
    const seasonId = 23;
    const authority = fund(svm);
    send(svm, initSeasonIx({ authority: authority.publicKey, seasonId, entryFee: FEE, payoutBps: [10000] }), [authority]);
    expect(send(svm, finalizeSeasonIx({ authority: authority.publicKey, seasonId, winners: [] }), [authority]).ok).toBe(true);
    expect(seasonState(svm, seasonId).finalized).toBe(true);
    expect(send(svm, withdrawUnallocatedIx({ authority: authority.publicKey, seasonId }), [authority]).ok).toBe(true);
  });

  it('rejects withdraw_unallocated before finalize', () => {
    const svm = freshSvm();
    const seasonId = 24;
    const authority = fund(svm);
    send(svm, initSeasonIx({ authority: authority.publicKey, seasonId, entryFee: FEE, payoutBps: [10000] }), [authority]);
    failsWith(send(svm, withdrawUnallocatedIx({ authority: authority.publicKey, seasonId }), [authority]), 'NotFinalized');
  });

  it('rejects submit_score for a player who never entered', () => {
    const svm = freshSvm();
    const seasonId = 25;
    const authority = fund(svm);
    send(svm, initSeasonIx({ authority: authority.publicKey, seasonId, entryFee: FEE, payoutBps: [10000] }), [authority]);
    const ghost = Keypair.generate();
    // Entry PDA does not exist → account validation fails before the body runs.
    expect(send(svm, submitScoreIx({ authority: authority.publicKey, seasonId, player: ghost.publicKey, score: 999n }), [authority]).ok).toBe(false);
  });
});

describe('SDK claim/read helpers (decoded state)', () => {
  it('winnerRank / claimableLamports / hasPendingClaim track on-chain state', () => {
    const svm = freshSvm();
    const seasonId = 26;
    const authority = fund(svm);
    const payout = [6000, 4000];
    send(svm, initSeasonIx({ authority: authority.publicKey, seasonId, entryFee: FEE, payoutBps: payout }), [authority]);

    const winner = fund(svm), runnerUp = fund(svm);
    send(svm, enterIx({ player: winner.publicKey, seasonId }), [winner]);
    send(svm, enterIx({ player: runnerUp.publicKey, seasonId }), [runnerUp]);

    // Before finalize: open for entry, nothing claimable.
    let season = seasonState(svm, seasonId);
    expect(isOpenForEntry(season)).toBe(true);
    expect(claimableLamports(season, entryState(svm, seasonId, winner.publicKey))).toBe(0n);

    send(svm, submitScoreIx({ authority: authority.publicKey, seasonId, player: winner.publicKey, score: 900n }), [authority]);
    send(svm, submitScoreIx({ authority: authority.publicKey, seasonId, player: runnerUp.publicKey, score: 100n }), [authority]);
    send(svm, finalizeSeasonIx({ authority: authority.publicKey, seasonId, winners: [winner.publicKey, runnerUp.publicKey] }), [authority]);

    season = seasonState(svm, seasonId);
    const pool = FEE * 2n;
    expect(isOpenForEntry(season)).toBe(false);
    expect(winnerRank(season, winner.publicKey)).toBe(0);
    expect(winnerRank(season, runnerUp.publicKey)).toBe(1);
    expect(winnerRank(season, Keypair.generate().publicKey)).toBeNull();

    const wEntry = entryState(svm, seasonId, winner.publicKey);
    expect(claimableLamports(season, wEntry)).toBe(payoutFor(pool, 6000));
    expect(hasPendingClaim(season, wEntry)).toBe(true);

    // After claiming, the helper reports 0 (entry.claimed flips).
    expect(send(svm, claimIx({ player: winner.publicKey, seasonId }), [winner]).ok).toBe(true);
    expect(claimableLamports(season, entryState(svm, seasonId, winner.publicKey))).toBe(0n);
    expect(hasPendingClaim(season, entryState(svm, seasonId, winner.publicKey))).toBe(false);
  });
});
