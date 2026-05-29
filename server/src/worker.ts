// TapClash leaderboard — Cloudflare Worker front end.
//
// Stateless edge layer: CORS, routing, the frozen validation floor, and Ed25519
// signature verification. All persistence is delegated to a per-season SQLite
// Durable Object (see leaderboard-do.ts). Replaces the in-memory Node stub that
// used to live in server/index.js, preserving its HTTP API byte-for-byte.

import { LeaderboardSeason, type SubmitResult } from './leaderboard-do';
import { rebuildMessage, validateSubmission } from './contract';

export { LeaderboardSeason };

export interface Env {
  LEADERBOARD: DurableObjectNamespace<LeaderboardSeason>;
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

function seasonStub(env: Env, seasonId: string): DurableObjectStub<LeaderboardSeason> {
  return env.LEADERBOARD.get(env.LEADERBOARD.idFromName(seasonId));
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
      return json(200, { ok: true, service: 'tapclash-leaderboard', version: 1 });
    }

    // POST /scores
    if (req.method === 'POST' && pathname === '/scores') {
      return handleSubmit(req, env);
    }

    // GET /leaderboard/:seasonId
    const lb = pathname.match(/^\/leaderboard\/(\d+)$/);
    if (req.method === 'GET' && lb) {
      const { entries } = await seasonStub(env, lb[1]).leaderboard();
      return json(200, { entries });
    }

    // GET /players/:seasonId/:wallet
    const pl = pathname.match(/^\/players\/(\d+)\/([A-Za-z0-9]+)$/);
    if (req.method === 'GET' && pl) {
      const result = await seasonStub(env, pl[1]).player(pl[2]);
      return json(200, result);
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

  const invalid = validateSubmission(body, base64ToBytes);
  if (invalid) return json(invalid.status, { error: invalid.error });

  // Signature verified — hand the replay check + storage to the season DO.
  const res: SubmitResult = await seasonStub(env, String(body.seasonId)).submit({
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
