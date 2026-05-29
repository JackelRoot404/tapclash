# TapClash Leaderboard — Cloudflare Worker

Signed-score leaderboard backend for TapClash. Replaces the original in-memory
Node stub (`legacy-stub.js`, kept for reference — the frozen contract was
captured from it) with an edge Worker fronting a strongly-consistent store.

## Architecture

```
client ──HTTP──▶ Worker (src/worker.ts)           stateless edge:
                   │  CORS · routing · validation     - frozen validation floor
                   │  · Ed25519 signature verify       - tweetnacl + bs58 (byte-parity)
                   ▼
                 Durable Object per season           strongly consistent:
                 (src/leaderboard-do.ts, SQLite)      - atomic nonce replay reject
                                                       - best-score + accumulation
                                                       - ORDER BY score DESC ranking
```

Why a **Durable Object** instead of bare KV: the frozen contract requires atomic
nonce-replay rejection, best-score-per-wallet with hits/misses/rounds
accumulation, and a score-desc ranking. A single-threaded, strongly-consistent
DO makes the read-modify-write in `submit()` race-free and gives native SQL
ranking — neither of which Workers KV (eventually consistent, no read-modify-write
atomicity, no sort) can guarantee. One DO instance per `seasonId`
(`idFromName(String(seasonId))`). SQLite-in-DO is available on the **free** plan.

## Frozen contract (do not change without Agent A sign-off — SP3)

- Canonical signing message rebuilt in `src/contract.ts → rebuildMessage()`
  (byte-identical to the app's `services/leaderboard.ts → buildScoreMessage()`).
- `POST /scores` → `{ ok: true, rank: number|null }`; every failure returns
  `{ error: <code> }` with the frozen status (the app reads `error`, e.g.
  `nonce_used`).
- `GET /leaderboard/:seasonId` → `{ entries: [{ rank, wallet, score, rounds }] }`
  (top 100, score desc).
- `GET /players/:seasonId/:wallet` → `{ bestScore, rank: number|null, rounds }`.
- CORS `*`, methods `GET,POST,OPTIONS`.

A ranking refinement vs the stub (format unchanged): ties break deterministically
by `(score DESC, wallet ASC)`, so `/players` rank always equals the player's
index in `/leaderboard`. The old stub used Map-insertion order for ties, which
was non-deterministic.

## Local dev

```bash
npm install
npm run dev          # wrangler dev on http://localhost:8787  (the same port the
                     # old stub used → the Android emulator's 10.0.2.2:8787 keeps
                     # working with no app change)
```

## Tests

```bash
npm test             # 21 contract tests in the real workerd runtime
                     # (@cloudflare/vitest-pool-workers — DO + SQLite, not mocked)
```

Covers every frozen error code, replay (incl. per-season nonce isolation),
best-score + accumulation, ranking, CORS, and routing.

## Deploy (USER ACTION — Agent B will not run this; see GUARDRAILS)

Deploying writes to the user's real Cloudflare account, so run these yourself:

```bash
cd server
npx wrangler login                 # one-time, opens browser
npm test                           # confirm green before shipping
npx wrangler deploy                # creates the Worker + the LeaderboardSeason
                                   # DO namespace (migration v1) in one step
```

`wrangler deploy` prints the production URL, e.g.
`https://tapclash-leaderboard.<your-subdomain>.workers.dev`.

### After deploy — hand off to Agent A (SP1)

1. Smoke-test it:
   ```bash
   curl https://<your-worker-url>/                       # {ok:true,...}
   curl https://<your-worker-url>/leaderboard/202605     # {entries:[]}
   ```
2. Post `SP1: URL=https://<your-worker-url>` in `COORDINATION.md`. Agent A then
   sets `EXPO_PUBLIC_LEADERBOARD_URL` and rebuilds the AAB. (The shipped app now
   leaves the prod URL empty until this is wired, so the leaderboard is dark
   until SP1 lands.)

No secrets/env vars are required by the Worker.
