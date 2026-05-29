# Leaderboard Categories — interface spec (v2)

**Status:** PROPOSAL — requires **SP3 sign-off** from Agent A + the user before
either lane implements. Off-chain leaderboard only; paid-pool-per-category is a
separate concern (§10). Authored by Agent B (owns `server/` + the contract).

**Revision 1.1 (2026-05-29):** hardened after an adversarial review (39 raw → 18
confirmed findings). Material changes vs r1.0, all in the changelog (§14). The
big one: **`classic` now routes to the bare `${seasonId}` Durable Object** (same
as v1) — r1.0's composite-key-for-everything rule would have *forked* the live
202605 board. Also: server-side category **allowlist**, dropped the
unimplementable `GET /categories`, precise version discriminator. Agent A
confirmed Q3 (same envelope) + the launch category set.

---

## 1. Goal

Support multiple **game modes**, each with its **own independent leaderboard**
within a season, while keeping the existing `classic` leaderboard and the
already-shipped v1 app working **unchanged** — including the live, already-played
season-202605 `classic` data.

A leaderboard is keyed by **(season, category)**; `classic` is the canonical
default and is **storage-identical to today's v1 board**.

## 2. Why this touches the FROZEN CONTRACT

The score signature today binds `wallet, season, score, hits, misses, dur, nonce`
— **not** a category. Without binding the category, a score signed for an easy
mode (`zen`) could be replayed by the client into a harder/paid category
(`blitz`); the backend would verify the signature and accept it. **The category
MUST be in the signed message.** That is a signing-contract change ⇒ SP3.

## 3. Signing message — versioned `category` line

Introduce **`tapclash/v2`** = v1 plus a `category=<slug>` line after `season`. v1
stays valid forever (legacy `classic`).

```
tapclash/v2
wallet=<base58>
season=<YYYYMM int>
category=<slug>
score=<int>
hits=<int>
misses=<int>
dur=30000
nonce=<hex>
```

- Same crypto as v1: Ed25519 detached over `TextEncoder().encode(<string>)`, no
  trailing newline, base64 64-byte signature, fields in this exact order.
- **Version discriminator (precise):** a submission is **v2 iff
  `typeof body.category === 'string'`**. `undefined`/absent ⇒ v1 (legacy
  `classic`). `null`, `""`, whitespace, or any non-string ⇒ rejected as
  `bad_category` (§6) — never a silent fall-through to v1.
- **Prescriptive backend rebuild** (this is the security-critical bit — must be
  implemented exactly):
  ```ts
  function rebuildMessageV1(p): string  // EXACTLY today's rebuildMessage (unchanged)
  function rebuildMessageV2(p): string  // v1 with `category=${p.category}\n` inserted after `season=...`
  // in validateSubmission, AFTER required-fields + bad_category + bounds:
  const isV2 = typeof body.category === 'string';
  const msg = new TextEncoder().encode(isV2 ? rebuildMessageV2(body) : rebuildMessageV1(body));
  ```
- `services/leaderboard.ts → buildScoreMessage()` (Agent A) gains an optional
  `category`; present ⇒ v2 string, absent ⇒ v1 string (byte-identical to today).

## 4. HTTP API (additive — v1 routes preserved byte-for-byte)

```
POST /scores
  body: { wallet, seasonId, category?, score, hits, misses, accuracy?, durationMs, nonce, signature }
  - typeof category === 'string'  → v2 path, bucket = <category> (must be allowlisted, §5)
  - category absent               → v1 path, bucket = "classic"
  → { ok:true, rank:number|null }                       (shape unchanged)

GET /leaderboard/:seasonId/:category      → { entries:[{rank,wallet,score,rounds}] }   (v2)
GET /leaderboard/:seasonId                 → same, bucket "classic"                      (v1, unchanged)
GET /players/:seasonId/:category/:wallet   → { bestScore, rank:number|null, rounds }     (v2)
GET /players/:seasonId/:wallet              → same, bucket "classic"                       (v1, unchanged)
```

- **No `GET /categories`.** (r1.0 had it; removed — Durable Objects are **not
  enumerable**, so the Worker cannot list which (season,category) buckets have
  data.) The app drives its mode tabs from the static `constants/categories.ts`
  registry. If dynamic discovery is ever needed, it requires a separate per-season
  **index** (an index DO or a KV set written on first accept) — a follow-on spec.
- CORS, status codes, response shapes: **unchanged**.
- Path-param regex: `:category` = `([a-z0-9_-]{1,32})`, `:seasonId` = `(\d+)`.

## 5. Category slug + allowlist

- Format: `^[a-z0-9_-]{1,32}$` (lowercase, URL-safe, no `:` so the DO-name
  composition in §7 is unambiguous).
- **Server-side allowlist (authoritative gate).** The Worker validates `category`
  against a fixed set, env-overridable:
  ```
  TAPCLASH_CATEGORIES (env, comma-sep) default = "classic,frenzy,precision,sudden"
  ```
  Any category not in the set → `bad_category` (§6). This **bounds DO creation**
  (no unbounded/griefable bucket spam) and replaces the dropped `GET /categories`
  (the set is known up front). `classic` is always implicitly allowed.
- Canonical reserved slug: **`classic`** = the existing/default mode. No
  case-normalization — slugs are lowercase by the regex; `"Classic"` fails the
  regex → `bad_category`.
- The app registry (`constants/categories.ts`, Agent A) maps slug → display name
  and **must stay in sync** with `TAPCLASH_CATEGORIES`. Launch set (Agent A,
  confirmed): `classic, frenzy, precision, sudden`.

## 6. Validation floor — additions (order is contractual)

Preserve every existing check **and its order**. Insert the category checks
**after** the required-fields loop and **before** signature verification (the
category is in the signed bytes, so its validity gates the rebuild):

```
// after REQUIRED_FIELDS present-check:
if ('category' in body && body.category !== undefined) {
  if (typeof body.category !== 'string'
      || !/^[a-z0-9_-]{1,32}$/.test(body.category)
      || !ALLOWED.has(body.category))            → 400 bad_category
}
// seasonId must be a clean non-negative integer (defense for the §7 DO name):
if (!Number.isInteger(body.seasonId) || body.seasonId < 0) → 400 bad_season   // NEW code
// ...then the EXISTING floor unchanged: bad_duration, bad_score_range,
//    bad_counts, impossible_hits, bad_wallet, (rebuild msg per §3),
//    bad_signature_len, signature_invalid, then DO: nonce_used.
```

New codes: **`bad_category`** (400), **`bad_season`** (400). All existing codes +
order unchanged. (`bad_season` is additive — the shipped app always sends an
integer `seasonId`, so v1 clients are unaffected.)

> **Envelope — CONFIRMED same for all launch modes (Agent A, 2026-05-29):**
> `classic/frenzy/precision/sudden` all use `dur=30000`, score clamped ≤50000,
> max hits <200 (Frenzy peaks ~182). So the existing global floor applies to every
> category — **no per-category validation params needed.** (If a *future* mode
> ever breaks this envelope, it needs a `{category→{durationMs,maxScore,maxHits}}`
> config + the message's `dur=` keyed to the category — a larger change, out of
> scope here.)

## 7. Storage / Durable Object model (server, my lane)

Reuse the per-season SQLite DO **class verbatim** — only the instance *name*
changes, and **`classic` keeps the v1 name** so existing data is never forked:

```ts
function doName(seasonId: number, category?: string): string {
  // classic (incl. v1 absent-category) → bare seasonId DO == today's live board
  return (category === undefined || category === 'classic')
    ? String(seasonId)
    : `${seasonId}:${category}`;
}
const stub = env.LEADERBOARD.get(env.LEADERBOARD.idFromName(doName(seasonId, category)));
```

- **Unification (the r1.0 bug, now fixed):** v1 `POST` (no category), v2 `POST`
  `category:"classic"`, `GET /leaderboard/:season`, and
  `GET /leaderboard/:season/classic` **all route to `idFromName(String(seasonId))`**
  — the same DO that already holds the live 202605 scores. No migration, no fork.
- Non-classic categories get their own `idFromName("${season}:${category}")` DO,
  each with its own `players`/`nonces`/ranking — fully isolated.
- DO-name is unambiguous: `category` ∈ `[a-z0-9_-]` (no `:`) and `seasonId` is a
  validated non-negative integer (§6), so `${seasonId}:${category}` can never
  collide with another pair.
- Best-score / hits-misses-rounds accumulation + nonce replay are per-bucket,
  identical to today.

## 8. App-side interface (Agent A's lane — full surface to update)

```ts
// services/leaderboard.ts
buildScoreMessage({ ..., category? })   // v2 string iff category set, else v1
type SubmitPayload = { ...existing, category?: string }
submitScore(payload)                    // sends category when set
fetchLeaderboard(seasonId, category?)   // SEE routing rule below
fetchPlayerStats(seasonId, category, wallet)

// hooks/useSubmitScore.ts
type SubmitInput = { ...existing, category: string }   // thread the active mode

// services/pendingScores.ts  (offline retry queue — MUST persist category)
//   the queued payload schema + the flush path both carry category, else an
//   offline-signed non-classic score replays/flushes as classic.

// constants/categories.ts  (NEW) — slug → display name; sync with TAPCLASH_CATEGORIES
```

- **fetch routing rule (continuity):** when `category` is omitted **or
  `"classic"`**, `fetchLeaderboard`/`fetchPlayerStats` call the **v1 routes**
  (`/leaderboard/:season`, `/players/:season/:wallet`) — which point at the same
  classic DO — to guarantee continuity with the live classic board. Use the v2
  `/:category` routes **only** for non-classic categories.
- Ranks screen: per-category tabs from `constants/categories.ts`.

## 9. Backward compatibility & migration

- **No data migration.** `classic` (incl. live 202605) stays under the bare
  `${seasonId}` DO; v1 clients keep hitting it via the unchanged v1 routes; v2
  `category:"classic"` resolves to the **same** DO (§7).
- **Season rollover:** the v1 GET routes always route to `${seasonId}`
  (unchanged); v2 classic routes there too; non-classic buckets are created
  on-demand per season. No prior-season DO is affected by introducing categories.
- Safe incremental rollout: deploy backend (v1+v2 both work) → ship app update
  whenever. Shipped v1 AAB is unaffected throughout.

## 10. Out of scope — paid pools per category

The on-chain pool program is untouched here. A paid pool for a category would:
(a) encode the category into the pool `season_id` namespace (separate
"pool-variant" spec — program already takes arbitrary `u32 season_id`+`payout_bps`,
no program change), and (b) have the **oracle finalize from that category's
leaderboard** (`GET /leaderboard/:season/:category`; classic → the v1 route).
Specced separately; composes on top of this.

## 11. Security analysis

- **Cross-category replay:** prevented — category is in the signed bytes; a sig
  for `zen` won't verify when the backend rebuilds the `blitz` message, and the
  buckets are different DOs.
- **v1→v2 confusion:** the discriminator is the *string-typed presence* of
  `category`; a v1 sig (no category line) can't be replayed as v2 (rebuild
  mismatch) and vice-versa. Empty/non-string category is rejected, not coerced.
- **Replay within a bucket:** unchanged — per-bucket DO nonce table, atomic.
- **DO abuse / proliferation:** the §5 allowlist bounds buckets to the known set;
  unknown slugs reject before any storage.
- **DO-name injection:** impossible — allowlisted no-colon category + integer
  seasonId (§6) ⇒ unambiguous name.

## 12. Test matrix (CI before any server ship)

Security-critical (must pass):
1. **Cross-category replay rejected** — a sig valid for `(202607, frenzy)`
   resubmitted as `precision` → `signature_invalid` (and lands nowhere).
2. **v1 ↔ v2-classic unification** — a v1 POST (no category) and a v2 POST
   `category:"classic"` for the same season appear on **both**
   `/leaderboard/:season` and `/leaderboard/:season/classic` (same DO).
3. **Empty/invalid/non-allowlisted category** → `bad_category` (cases: `""`,
   `"Classic"`, `"x:y"`, `"unknown"`, `123`).
4. **bad_season** — non-integer/negative `seasonId` → `bad_season`.
Functional:
5. v2 happy path (each launch category) → 200 `{ok,rank}`.
6. Per-category isolation — same wallet, same nonce, different categories both
   accepted; same (category,nonce) twice → `nonce_used`.
7. v1 routes byte-for-byte unchanged (existing 25 tests stay green).
8. Ranking/accumulation within a non-classic bucket.

## 13. Decisions / status

1. **SP3 sign-off** on the v2 message (§3) — DEFERRED to the user (per Agent A);
   the current feature push is scoped to a unified in-app board, so per-mode
   boards wait on the user's call. **Nothing builds until signed.**
2. **Category list** — `classic, frenzy, precision, sudden` (Agent A, confirmed)
   → seeds `TAPCLASH_CATEGORIES` + `constants/categories.ts`.
3. **Envelope** — same for all launch modes (Agent A, confirmed) → §6 ships
   as-is, no per-category validation params.

## 14. Changelog — r1.0 → r1.1 (adversarial review fixes)

- **[critical] classic fork:** `classic` (and v1) now route to the **bare
  `${seasonId}` DO** (§7), not `${seasonId}:classic` — r1.0 would have split the
  live board from v2 writes. Unification test added (§12 #2).
- **[high] DO-name injection / collision:** added `bad_season` integer check +
  noted the no-colon allowlisted category (§5–§7).
- **[med] unbounded DO abuse:** added the server-side **allowlist** (§5).
- **[med] `GET /categories` unimplementable:** removed; app uses static registry;
  index-DO noted as the only path if dynamic discovery is ever needed (§4).
- **[med] version discriminator ambiguity:** precise `typeof category==='string'`;
  empty/non-string → `bad_category` (§3, §6).
- **[med] under-specified rebuild/dispatch:** §3 now prescribes
  `rebuildMessageV1/V2` + the exact branch.
- **[med] incomplete app surface:** §8 now lists `SubmitPayload`, `SubmitInput`,
  the `pendingScores.ts` offline queue (+ flush), and the classic→v1-route fetch
  rule.
- **[med] season-rollover / fetch continuity:** §9 + §8 spelled out.
- **[med] test gaps:** §12 expanded with the security-critical cases.
- Dismissed (not changed): nonce-namespace-divergence claims (buckets are
  *intentionally* separate, and classic stays unified per §7); "bad_category
  before sig verify leaks info" (it doesn't — same as existing bad_wallet
  ordering); CORS/shape-change claims (none).
