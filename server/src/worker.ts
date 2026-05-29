// TapClash leaderboard — Cloudflare Worker front end.
//
// Stateless edge layer: CORS, routing, the frozen validation floor, and Ed25519
// signature verification. All persistence is delegated to a per-season SQLite
// Durable Object (see leaderboard-do.ts). Replaces the in-memory Node stub that
// used to live in server/index.js, preserving its HTTP API byte-for-byte.

import { LeaderboardSeason, type SubmitResult } from './leaderboard-do';
import { rebuildMessage, validateSubmission, DEFAULT_CATEGORIES } from './contract';

export { LeaderboardSeason };

export interface Env {
  LEADERBOARD: DurableObjectNamespace<LeaderboardSeason>;
  // Comma-separated category allowlist; defaults to DEFAULT_CATEGORIES.
  TAPCLASH_CATEGORIES?: string;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// Lenient base64 → bytes, matching Node's Buffer.from(s, 'base64') tolerance so
// signature handling is byte-identical to the frozen stub.
function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

// `classic` (and v1, no-category) routes to the BARE seasonId DO — the same
// instance the shipped v1 app already populates — so classic data is never
// forked. Non-classic categories get their own `${seasonId}:${category}` DO.
function doName(seasonId: string, category: string): string {
  return category === 'classic' ? seasonId : `${seasonId}:${category}`;
}

function bucketStub(env: Env, seasonId: string, category: string): DurableObjectStub<LeaderboardSeason> {
  return env.LEADERBOARD.get(env.LEADERBOARD.idFromName(doName(seasonId, category)));
}

function allowedCategories(env: Env): ReadonlySet<string> {
  const raw = env.TAPCLASH_CATEGORIES;
  if (typeof raw === 'string' && raw.trim()) {
    return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  }
  return DEFAULT_CATEGORIES;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health banner — outside the frozen API; lets the operator eyeball a deploy.
    if (req.method === 'GET' && (pathname === '/' || pathname === '/health')) {
      return json(200, { ok: true, service: 'tapclash-leaderboard', version: 2 });
    }

    // POST /scores  (v1 classic + v2 per-category)
    if (req.method === 'POST' && pathname === '/scores') {
      return handleSubmit(req, env);
    }

    // GET /leaderboard/:seasonId/:category  (v2)
    const lb2 = pathname.match(/^\/leaderboard\/(\d+)\/([a-z0-9_-]{1,32})$/);
    if (req.method === 'GET' && lb2) {
      if (!allowedCategories(env).has(lb2[2])) return json(400, { error: 'bad_category' });
      const { entries } = await bucketStub(env, lb2[1], lb2[2]).leaderboard();
      return json(200, { entries });
    }

    // GET /leaderboard/:seasonId  (v1 → classic, unchanged)
    const lb = pathname.match(/^\/leaderboard\/(\d+)$/);
    if (req.method === 'GET' && lb) {
      const { entries } = await bucketStub(env, lb[1], 'classic').leaderboard();
      return json(200, { entries });
    }

    // GET /players/:seasonId/:category/:wallet  (v2)
    const pl2 = pathname.match(/^\/players\/(\d+)\/([a-z0-9_-]{1,32})\/([A-Za-z0-9]+)$/);
    if (req.method === 'GET' && pl2) {
      if (!allowedCategories(env).has(pl2[2])) return json(400, { error: 'bad_category' });
      return json(200, await bucketStub(env, pl2[1], pl2[2]).player(pl2[3]));
    }

    // GET /players/:seasonId/:wallet  (v1 → classic, unchanged)
    const pl = pathname.match(/^\/players\/(\d+)\/([A-Za-z0-9]+)$/);
    if (req.method === 'GET' && pl) {
      return json(200, await bucketStub(env, pl[1], 'classic').player(pl[2]));
    }

    return json(404, { error: 'not_found' });
  },
} satisfies ExportedHandler<Env>;

async function handleSubmit(req: Request, env: Env): Promise<Response> {
  // Mirror the stub: empty body → {} (→ missing_wallet), bad JSON → invalid_json.
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const invalid = validateSubmission(body, base64ToBytes, allowedCategories(env));
  if (invalid) return json(invalid.status, { error: invalid.error });

  // Resolve the bucket: explicit category (v2) or classic (v1). Signature is
  // verified against the matching message version, so the category is bound.
  const category = typeof body.category === 'string' ? body.category : 'classic';
  const res: SubmitResult = await bucketStub(env, String(body.seasonId), category).submit({
    wallet: body.wallet as string,
    score: body.score as number,
    hits: body.hits as number,
    misses: body.misses as number,
    nonce: body.nonce as string,
  });

  if ('error' in res) return json(409, { error: res.error });
  return json(200, { ok: true, rank: res.rank });
}

// Re-exported for tests/tooling that want the canonical message without pulling
// in the Worker entrypoint.
export { rebuildMessage };
