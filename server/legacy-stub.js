// Minimal in-memory leaderboard server for local dev.
// Verifies wallet signatures on submitted scores, stores best-per-wallet-per-season.
// Swap this for a Cloudflare Worker + KV before deploying.

import http from 'node:http';
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';

const PORT = Number(process.env.PORT ?? 8787);
const ROUND_MS = 30_000;

// Map<seasonId, Map<wallet, { score, hits, misses, rounds }>>
const seasons = new Map();
// Set<`${seasonId}:${wallet}:${nonce}`> for replay protection.
const usedNonces = new Set();

function getSeason(id) {
  let m = seasons.get(id);
  if (!m) {
    m = new Map();
    seasons.set(id, m);
  }
  return m;
}

function rebuildMessage(p) {
  return (
    `tapclash/v1\n` +
    `wallet=${p.wallet}\n` +
    `season=${p.seasonId}\n` +
    `score=${p.score}\n` +
    `hits=${p.hits}\n` +
    `misses=${p.misses}\n` +
    `dur=${p.durationMs}\n` +
    `nonce=${p.nonce}`
  );
}

function rankedEntries(seasonId) {
  const m = getSeason(seasonId);
  const rows = [...m.entries()].map(([wallet, v]) => ({ wallet, ...v }));
  rows.sort((a, b) => b.score - a.score);
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  // POST /scores
  if (req.method === 'POST' && req.url === '/scores') {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: 'invalid_json' });
    }

    const required = ['wallet', 'seasonId', 'score', 'hits', 'misses', 'durationMs', 'nonce', 'signature'];
    for (const k of required) {
      if (body[k] === undefined || body[k] === null) return send(res, 400, { error: `missing_${k}` });
    }

    // Sanity bounds — server-side floor that catches blatantly fake clients.
    if (body.durationMs !== ROUND_MS) return send(res, 400, { error: 'bad_duration' });
    if (body.score < 0 || body.score > 50_000) return send(res, 400, { error: 'bad_score_range' });
    if (body.hits < 0 || body.misses < 0) return send(res, 400, { error: 'bad_counts' });
    if (body.hits > 200) return send(res, 400, { error: 'impossible_hits' });

    // Verify signature
    let pubkeyBytes;
    try {
      pubkeyBytes = new PublicKey(body.wallet).toBytes();
    } catch {
      return send(res, 400, { error: 'bad_wallet' });
    }
    const msg = new TextEncoder().encode(rebuildMessage(body));
    const sig = Buffer.from(body.signature, 'base64');
    if (sig.length !== 64) return send(res, 400, { error: 'bad_signature_len' });
    const ok = nacl.sign.detached.verify(msg, sig, pubkeyBytes);
    if (!ok) return send(res, 401, { error: 'signature_invalid' });

    // Replay protection
    const replayKey = `${body.seasonId}:${body.wallet}:${body.nonce}`;
    if (usedNonces.has(replayKey)) return send(res, 409, { error: 'nonce_used' });
    usedNonces.add(replayKey);

    // Store best-per-wallet for this season.
    const season = getSeason(body.seasonId);
    const cur = season.get(body.wallet) ?? { score: 0, hits: 0, misses: 0, rounds: 0 };
    season.set(body.wallet, {
      score: Math.max(cur.score, body.score),
      hits: cur.hits + body.hits,
      misses: cur.misses + body.misses,
      rounds: cur.rounds + 1,
    });

    const ranked = rankedEntries(body.seasonId);
    const me = ranked.find((r) => r.wallet === body.wallet);
    return send(res, 200, { ok: true, rank: me?.rank ?? null });
  }

  // GET /leaderboard/:seasonId
  const lbMatch = req.url?.match(/^\/leaderboard\/(\d+)$/);
  if (req.method === 'GET' && lbMatch) {
    const id = Number(lbMatch[1]);
    const entries = rankedEntries(id).slice(0, 100);
    return send(res, 200, { entries });
  }

  // GET /players/:seasonId/:wallet
  const pMatch = req.url?.match(/^\/players\/(\d+)\/([A-Za-z0-9]+)$/);
  if (req.method === 'GET' && pMatch) {
    const id = Number(pMatch[1]);
    const wallet = pMatch[2];
    const entry = getSeason(id).get(wallet);
    if (!entry) return send(res, 200, { bestScore: 0, rank: null, rounds: 0 });
    const ranked = rankedEntries(id);
    const me = ranked.find((r) => r.wallet === wallet);
    return send(res, 200, { bestScore: entry.score, rank: me?.rank ?? null, rounds: entry.rounds });
  }

  send(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`tapclash leaderboard listening on http://localhost:${PORT}`);
});
