// FROZEN CONTRACT — mirror of services/leaderboard.ts → buildScoreMessage() and
// the server-side validation floor in COORDINATION.md. Pure, dependency-light
// (bs58 + tweetnacl only) so it can be unit-tested without the Workers runtime.
//
// Do NOT change anything here without the other agent's sign-off (SP3). The
// signed AAB in the field depends on byte-for-byte agreement.

import bs58 from 'bs58';
import nacl from 'tweetnacl';

export const ROUND_MS = 30_000;
export const MAX_SCORE = 50_000;
export const MAX_HITS = 200;

// Fields the POST /scores body MUST carry (accuracy is optional — the stub never
// validated or stored it, so neither do we).
export const REQUIRED_FIELDS = [
  'wallet',
  'seasonId',
  'score',
  'hits',
  'misses',
  'durationMs',
  'nonce',
  'signature',
] as const;

export type ScoreSubmission = {
  wallet: string;
  seasonId: number;
  score: number;
  hits: number;
  misses: number;
  accuracy?: number;
  durationMs: number;
  nonce: string;
  signature: string;
};

// Canonical score-signing message — byte-for-byte identical to the app's
// buildScoreMessage() (note `dur=`, not `durationMs=`, and NO trailing newline).
export function rebuildMessage(p: {
  wallet: string;
  seasonId: number | string;
  score: number | string;
  hits: number | string;
  misses: number | string;
  durationMs: number | string;
  nonce: string;
}): string {
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

// Replicates `new PublicKey(wallet).toBytes()`: the web3.js v1 string
// constructor base58-decodes and throws unless the result is EXACTLY 32 bytes
// (it does not left-pad short inputs — that path only exists for the BN/number
// constructor). So any decoded length != 32 must throw here too, so the caller
// maps it to `bad_wallet`/400 — not `signature_invalid`/401. Throws on invalid
// base58 alphabet or any non-32-byte length.
export function decodePubkey(wallet: string): Uint8Array {
  const decoded = bs58.decode(wallet); // throws on invalid base58 alphabet
  if (decoded.length !== 32) throw new Error('public key must be 32 bytes');
  return decoded;
}

export type ValidationError =
  | { error: string; status: 400 | 401 };

// Runs the full frozen validation floor (steps 1–9 of the stub) on an
// already-parsed body. Returns null if the submission is structurally valid and
// the signature verifies; otherwise the exact {error, status} the stub returned.
// Order of checks is contractual — do not reorder.
export function validateSubmission(
  body: Record<string, unknown>,
  b64decode: (s: string) => Uint8Array,
): ValidationError | null {
  for (const k of REQUIRED_FIELDS) {
    if (body[k] === undefined || body[k] === null) {
      return { error: `missing_${k}`, status: 400 };
    }
  }

  const durationMs = body.durationMs as number;
  const score = body.score as number;
  const hits = body.hits as number;
  const misses = body.misses as number;

  if (durationMs !== ROUND_MS) return { error: 'bad_duration', status: 400 };
  if (score < 0 || score > MAX_SCORE) return { error: 'bad_score_range', status: 400 };
  if (hits < 0 || misses < 0) return { error: 'bad_counts', status: 400 };
  if (hits > MAX_HITS) return { error: 'impossible_hits', status: 400 };

  let pubkey: Uint8Array;
  try {
    pubkey = decodePubkey(body.wallet as string);
  } catch {
    return { error: 'bad_wallet', status: 400 };
  }

  const msg = new TextEncoder().encode(
    rebuildMessage(body as Parameters<typeof rebuildMessage>[0]),
  );

  let sig: Uint8Array;
  try {
    sig = b64decode(String(body.signature));
  } catch {
    // Unparseable base64 → treat as wrong length, matching the lenient stub
    // which would have produced a non-64-byte buffer.
    return { error: 'bad_signature_len', status: 400 };
  }
  if (sig.length !== 64) return { error: 'bad_signature_len', status: 400 };

  if (!nacl.sign.detached.verify(msg, sig, pubkey)) {
    return { error: 'signature_invalid', status: 401 };
  }

  return null;
}
