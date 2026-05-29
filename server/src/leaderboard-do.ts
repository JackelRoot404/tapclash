// Per-season leaderboard store, backed by a SQLite Durable Object.
//
// Why a DO (not bare KV): the frozen contract requires (a) atomic nonce-replay
// rejection, (b) best-score-per-wallet with hits/misses/rounds accumulation, and
// (c) a score-desc ranking. A DO is single-threaded and strongly consistent, so
// the read-modify-write in submit() is race-free, and SQLite gives us native
// `ORDER BY score DESC` ranking — neither of which KV can guarantee. One DO
// instance per seasonId (routed via idFromName(String(seasonId))).

import { DurableObject } from 'cloudflare:workers';

export type SubmitInput = {
  wallet: string;
  score: number;
  hits: number;
  misses: number;
  nonce: string;
};

export type SubmitResult =
  | { ok: true; rank: number }
  | { error: 'nonce_used' };

export type LeaderboardRow = { rank: number; wallet: string; score: number; rounds: number };
export type PlayerResult = { bestScore: number; rank: number | null; rounds: number };

export class LeaderboardSeason extends DurableObject {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.sql = ctx.storage.sql;
    // blockConcurrencyWhile guarantees the schema exists before any request is
    // served on a freshly-created instance.
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS players (
           wallet     TEXT PRIMARY KEY,
           score      INTEGER NOT NULL DEFAULT 0,
           hits       INTEGER NOT NULL DEFAULT 0,
           misses     INTEGER NOT NULL DEFAULT 0,
           rounds     INTEGER NOT NULL DEFAULT 0,
           first_seen INTEGER NOT NULL DEFAULT 0
         );`,
      );
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS nonces (
           key     TEXT PRIMARY KEY,
           used_at INTEGER NOT NULL
         );`,
      );
      // Ties at equal score break by arrival order (the wallet that first reached
      // that season ranks higher) — matching the legacy stub's stable-insertion
      // sort, and fairer than an arbitrary lexicographic wallet order when ties
      // decide a v2 prize rank.
      this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_players_score ON players (score DESC, first_seen ASC);`);
    });
  }

  // Atomic: reject a replayed (wallet, nonce), else record the nonce, fold the
  // round into the player's best/accumulated row, and return the new rank.
  async submit(p: SubmitInput): Promise<SubmitResult> {
    const key = `${p.wallet}:${p.nonce}`;
    const seen = this.sql.exec('SELECT 1 FROM nonces WHERE key = ?', key).toArray();
    if (seen.length > 0) return { error: 'nonce_used' };

    this.sql.exec('INSERT INTO nonces (key, used_at) VALUES (?, ?)', key, Date.now());

    // first_seen is a strictly-increasing arrival counter, assigned only on the
    // wallet's first submission (the subquery sees the pre-insert table state;
    // ON CONFLICT leaves it untouched). Single-threaded DO → no races.
    this.sql.exec(
      `INSERT INTO players (wallet, score, hits, misses, rounds, first_seen)
         VALUES (?1, ?2, ?3, ?4, 1, (SELECT COALESCE(MAX(first_seen), 0) + 1 FROM players))
       ON CONFLICT(wallet) DO UPDATE SET
         score  = MAX(players.score, ?2),
         hits   = players.hits + ?3,
         misses = players.misses + ?4,
         rounds = players.rounds + 1`,
      p.wallet,
      p.score,
      p.hits,
      p.misses,
    );

    return { ok: true, rank: this.rankOf(p.wallet)! };
  }

  async leaderboard(): Promise<{ entries: LeaderboardRow[] }> {
    const rows = this.sql
      .exec('SELECT wallet, score, rounds FROM players ORDER BY score DESC, first_seen ASC LIMIT 100')
      .toArray() as Array<{ wallet: string; score: number; rounds: number }>;
    return {
      entries: rows.map((r, i) => ({
        rank: i + 1,
        wallet: r.wallet,
        score: Number(r.score),
        rounds: Number(r.rounds),
      })),
    };
  }

  async player(wallet: string): Promise<PlayerResult> {
    const row = this.sql
      .exec('SELECT score, rounds FROM players WHERE wallet = ?', wallet)
      .toArray()[0] as { score: number; rounds: number } | undefined;
    if (!row) return { bestScore: 0, rank: null, rounds: 0 };
    return { bestScore: Number(row.score), rank: this.rankOf(wallet), rounds: Number(row.rounds) };
  }

  // Competition rank under the deterministic (score DESC, first_seen ASC)
  // ordering — matches each player's index in leaderboard(). Returns null if not
  // present.
  private rankOf(wallet: string): number | null {
    const me = this.sql
      .exec('SELECT score, first_seen FROM players WHERE wallet = ?', wallet)
      .toArray()[0] as { score: number; first_seen: number } | undefined;
    if (!me) return null;
    const above = this.sql
      .exec(
        'SELECT COUNT(*) AS c FROM players WHERE score > ?1 OR (score = ?1 AND first_seen < ?2)',
        me.score,
        me.first_seen,
      )
      .toArray()[0] as { c: number };
    return Number(above.c) + 1;
  }
}
