import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { rebuildMessage, ROUND_MS } from '../src/contract';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = 'https://lb.test';
let nonceCounter = 0;
const freshNonce = () => `n${(nonceCounter++).toString(16).padStart(8, '0')}`;

type Fields = {
  wallet: string;
  seasonId: number;
  score: number;
  hits: number;
  misses: number;
  durationMs: number;
  nonce: string;
};

// Build a correctly-signed /scores body. `over` patches the SIGNED fields before
// signing, so the signature always matches what's sent (unless caller tampers).
function signed(over: Partial<Fields> & { seasonId?: number } = {}) {
  const kp = nacl.sign.keyPair();
  const wallet = over.wallet ?? bs58.encode(kp.publicKey);
  const fields: Fields = {
    wallet,
    seasonId: 202605,
    score: 1000,
    hits: 10,
    misses: 2,
    durationMs: ROUND_MS,
    nonce: freshNonce(),
    ...over,
  };
  const msg = new TextEncoder().encode(rebuildMessage(fields));
  const sig = nacl.sign.detached(msg, kp.secretKey);
  const body: Record<string, unknown> = {
    ...fields,
    accuracy: fields.hits / Math.max(1, fields.hits + fields.misses),
    signature: Buffer.from(sig).toString('base64'),
  };
  return { kp, wallet, body };
}

function postScore(body: unknown) {
  return SELF.fetch(`${BASE}/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const getLeaderboard = (s: number) => SELF.fetch(`${BASE}/leaderboard/${s}`);
const getPlayer = (s: number, w: string) => SELF.fetch(`${BASE}/players/${s}/${w}`);

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('POST /scores — happy path', () => {
  it('accepts a valid signed score and returns rank 1', async () => {
    const { body } = signed({ score: 5000 });
    const res = await postScore(body);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.json()).toEqual({ ok: true, rank: 1 });
  });

  it('omitting the optional accuracy field still succeeds', async () => {
    const { body } = signed();
    delete (body as Record<string, unknown>).accuracy;
    const res = await postScore(body);
    expect(res.status).toBe(200);
    expect((await res.json() as { ok: boolean }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Storage semantics: best-score, accumulation, ranking
// ---------------------------------------------------------------------------

describe('storage semantics', () => {
  it('keeps best score but accumulates hits/misses/rounds', async () => {
    const s = 300001;
    const first = signed({ seasonId: s, score: 1000, hits: 10, misses: 5 });
    await postScore(first.body);

    // Second round, same wallet, lower score, new nonce.
    const lower = signed({
      wallet: first.wallet, seasonId: s, score: 400, hits: 4, misses: 1, nonce: freshNonce(),
    });
    // re-sign with the same keypair as `first`
    const msg = new TextEncoder().encode(rebuildMessage({
      wallet: first.wallet, seasonId: s, score: 400, hits: 4, misses: 1,
      durationMs: ROUND_MS, nonce: lower.body.nonce as string,
    }));
    lower.body.signature = Buffer.from(nacl.sign.detached(msg, first.kp.secretKey)).toString('base64');
    const r2 = await postScore(lower.body);
    expect(r2.status).toBe(200);

    const player = await (await getPlayer(s, first.wallet)).json() as { bestScore: number; rounds: number; rank: number };
    expect(player.bestScore).toBe(1000); // best, not last
    expect(player.rounds).toBe(2); // accumulated
    expect(player.rank).toBe(1);
  });

  it('updates best score when a higher score arrives', async () => {
    const s = 300002;
    const a = signed({ seasonId: s, score: 800 });
    await postScore(a.body);
    const msg = new TextEncoder().encode(rebuildMessage({
      wallet: a.wallet, seasonId: s, score: 9000, hits: 20, misses: 0,
      durationMs: ROUND_MS, nonce: freshNonce(),
    }));
    const nonce = 'higher-nonce-1';
    const msg2 = new TextEncoder().encode(rebuildMessage({
      wallet: a.wallet, seasonId: s, score: 9000, hits: 20, misses: 0, durationMs: ROUND_MS, nonce,
    }));
    void msg;
    await postScore({
      wallet: a.wallet, seasonId: s, score: 9000, hits: 20, misses: 0,
      durationMs: ROUND_MS, nonce, accuracy: 1,
      signature: Buffer.from(nacl.sign.detached(msg2, a.kp.secretKey)).toString('base64'),
    });
    const player = await (await getPlayer(s, a.wallet)).json() as { bestScore: number };
    expect(player.bestScore).toBe(9000);
  });

  it('ranks higher scores first and returns a top-100 board', async () => {
    const s = 300003;
    const low = signed({ seasonId: s, score: 100 });
    const high = signed({ seasonId: s, score: 9999 });
    await postScore(low.body);
    await postScore(high.body);
    const { entries } = await (await getLeaderboard(s)).json() as {
      entries: Array<{ rank: number; wallet: string; score: number; rounds: number }>;
    };
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ rank: 1, wallet: high.wallet, score: 9999, rounds: 1 });
    expect(entries[1]).toMatchObject({ rank: 2, wallet: low.wallet, score: 100 });
  });

  it('returns zeros for an unknown player', async () => {
    const res = await getPlayer(300004, bs58.encode(nacl.sign.keyPair().publicKey));
    expect(await res.json()).toEqual({ bestScore: 0, rank: null, rounds: 0 });
  });
});

// ---------------------------------------------------------------------------
// Replay protection (per-season nonce)
// ---------------------------------------------------------------------------

describe('replay protection', () => {
  it('rejects a replayed (wallet, nonce) with 409 nonce_used', async () => {
    const s = 300010;
    const { body } = signed({ seasonId: s });
    expect((await postScore(body)).status).toBe(200);
    const replay = await postScore(body);
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: 'nonce_used' });
  });

  it('allows the same nonce in a different season', async () => {
    const a = signed({ seasonId: 300011, nonce: 'shared-nonce' });
    expect((await postScore(a.body)).status).toBe(200);
    // Same keypair + same nonce but a different season → fresh replay namespace.
    const nonce = 'shared-nonce';
    const seasonId = 300012;
    const msg = new TextEncoder().encode(rebuildMessage({
      wallet: a.wallet, seasonId, score: 1000, hits: 10, misses: 2, durationMs: ROUND_MS, nonce,
    }));
    const res = await postScore({
      wallet: a.wallet, seasonId, score: 1000, hits: 10, misses: 2,
      durationMs: ROUND_MS, nonce, accuracy: 0.8,
      signature: Buffer.from(nacl.sign.detached(msg, a.kp.secretKey)).toString('base64'),
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Validation floor — every frozen error code
// ---------------------------------------------------------------------------

describe('validation floor', () => {
  it('400 missing_<field> for each required field', async () => {
    for (const field of ['wallet', 'seasonId', 'score', 'hits', 'misses', 'durationMs', 'nonce', 'signature']) {
      const { body } = signed();
      delete (body as Record<string, unknown>)[field];
      const res = await postScore(body);
      expect(res.status, field).toBe(400);
      expect((await res.json() as { error: string }).error).toBe(`missing_${field}`);
    }
  });

  it('400 bad_duration when durationMs !== 30000', async () => {
    const { body } = signed({ durationMs: 29999 });
    const res = await postScore(body);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('bad_duration');
  });

  it('400 bad_score_range for score > 50000 and score < 0', async () => {
    for (const score of [50001, -1]) {
      const { body } = signed({ score });
      const res = await postScore(body);
      expect(res.status).toBe(400);
      expect((await res.json() as { error: string }).error).toBe('bad_score_range');
    }
  });

  it('400 bad_counts for negative hits or misses', async () => {
    for (const over of [{ hits: -1 }, { misses: -1 }]) {
      const { body } = signed(over);
      const res = await postScore(body);
      expect(res.status).toBe(400);
      expect((await res.json() as { error: string }).error).toBe('bad_counts');
    }
  });

  it('400 impossible_hits for hits > 200', async () => {
    const { body } = signed({ hits: 201 });
    const res = await postScore(body);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('impossible_hits');
  });

  it('400 bad_wallet for non-base58 / over-length wallet', async () => {
    const { body } = signed();
    body.wallet = '0OIl-not-base58!!'; // contains chars outside the base58 alphabet
    const res = await postScore(body);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('bad_wallet');
  });

  it('400 bad_signature_len when signature is not 64 bytes', async () => {
    const { body } = signed();
    body.signature = Buffer.from(new Uint8Array(32)).toString('base64');
    const res = await postScore(body);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('bad_signature_len');
  });

  it('401 signature_invalid when a signed field is tampered', async () => {
    const { body } = signed({ score: 1000 });
    body.score = 2000; // changed after signing → signature no longer matches
    const res = await postScore(body);
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toBe('signature_invalid');
  });

  it('401 signature_invalid when signing with the wrong key', async () => {
    const { body } = signed();
    const wrong = nacl.sign.keyPair();
    const msg = new TextEncoder().encode(rebuildMessage(body as never));
    body.signature = Buffer.from(nacl.sign.detached(msg, wrong.secretKey)).toString('base64');
    const res = await postScore(body);
    expect(res.status).toBe(401);
  });

  it('400 invalid_json for a malformed body', async () => {
    const res = await postScore('{not json');
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('invalid_json');
  });
});

// ---------------------------------------------------------------------------
// CORS + routing
// ---------------------------------------------------------------------------

// Sign a body with a SPECIFIC keypair (for multi-round / same-wallet scenarios).
function signWith(kp: ReturnType<typeof nacl.sign.keyPair>, fields: Fields) {
  const msg = new TextEncoder().encode(rebuildMessage(fields));
  return {
    ...fields,
    accuracy: fields.hits / Math.max(1, fields.hits + fields.misses),
    signature: Buffer.from(nacl.sign.detached(msg, kp.secretKey)).toString('base64'),
  };
}

describe('regression — audit follow-ups', () => {
  it('accumulates hits/misses/rounds across 3+ rounds, keeping the best score', async () => {
    const s = 400100;
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const rounds = [
      { score: 1000, hits: 10, misses: 2 },
      { score: 3000, hits: 20, misses: 1 }, // new best
      { score: 500, hits: 5, misses: 5 },
    ];
    for (const r of rounds) {
      const body = signWith(kp, { wallet, seasonId: s, durationMs: ROUND_MS, nonce: freshNonce(), ...r });
      expect((await postScore(body)).status).toBe(200);
    }
    const player = await (await getPlayer(s, wallet)).json() as { bestScore: number; rounds: number };
    expect(player.bestScore).toBe(3000);
    expect(player.rounds).toBe(3);
  });

  it('breaks score ties by arrival order (first submitter ranks higher)', async () => {
    const s = 400200;
    const first = signed({ seasonId: s, score: 5000 });
    const second = signed({ seasonId: s, score: 5000 });
    expect((await postScore(first.body)).status).toBe(200);
    expect((await postScore(second.body)).status).toBe(200);

    const { entries } = await (await getLeaderboard(s)).json() as {
      entries: Array<{ rank: number; wallet: string }>;
    };
    expect(entries.map((e) => e.wallet)).toEqual([first.wallet, second.wallet]);
    const firstRank = await (await getPlayer(s, first.wallet)).json() as { rank: number };
    const secondRank = await (await getPlayer(s, second.wallet)).json() as { rank: number };
    expect(firstRank.rank).toBe(1);
    expect(secondRank.rank).toBe(2);
  });

  it('empty request body → 400 missing_wallet (not invalid_json)', async () => {
    const res = await SELF.fetch(`${BASE}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('missing_wallet');
  });

  it('valid base58 that decodes to fewer than 32 bytes → 400 bad_wallet', async () => {
    const { body } = signed();
    body.wallet = bs58.encode(Uint8Array.from([1, 2, 3, 4, 5])); // 5 bytes, valid base58
    const res = await postScore(body);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('bad_wallet');
  });
});

describe('CORS and routing', () => {
  it('OPTIONS preflight → 204 with CORS headers', async () => {
    const res = await SELF.fetch(`${BASE}/scores`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,OPTIONS');
  });

  it('unknown route → 404 not_found', async () => {
    const res = await SELF.fetch(`${BASE}/nope`);
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toBe('not_found');
  });

  it('GET endpoints carry CORS headers', async () => {
    const res = await getLeaderboard(300099);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
